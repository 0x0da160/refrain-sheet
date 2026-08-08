# Architecture

This document is the engineering map of Refrain Sheet: the layers, the
direction dependencies are allowed to flow, how data moves through the app,
where the WASM boundary sits, and the invariants that every change must
preserve. The README describes the user-facing behavior; this file describes
how the code is organized to deliver it.

## Layers and allowed dependencies

Dependencies flow strictly inward (each layer may import from the layers
below it, never above):

```text
┌───────────────────────────────────────────────────────────────┐
│ UI (src/ui/)                                                  │
│   grid, menu bar, tab bar, formula bar, find bar, dialogs,    │
│   status bar, welcome screen, loading overlay, IME helpers    │
├───────────────────────────────────────────────────────────────┤
│ Application (src/app/)                                        │
│   AppState (tabs, selection, history integration),            │
│   Commands (typed command dispatch), file access, settings,   │
│   i18n, shortcuts, theme/font preferences, clipboard control  │
├───────────────────────────────────────────────────────────────┤
│ Core / domain (src/core/)                                     │
│   LosslessDocument (byte-preserving CSV), RsfDocument         │
│   (spreadsheet), formula engine, history, search, stats,      │
│   encoding, validation, serializer, RSF codec, scheduler      │
├───────────────────────────────────────────────────────────────┤
│ Infrastructure                                                │
│   csv-engine.ts (WASM bridge + JS fallback), wasm-gen/        │
│   (embedded WASM + glue), wasm/ (Rust crate), build scripts   │
└───────────────────────────────────────────────────────────────┘
```

- **Core modules never import DOM or UI code.** Everything in `src/core/`
  runs unchanged in Node (which is what makes the unit/property tests and the
  benchmarks deterministic and fast).
- **The UI never owns business logic.** UI surfaces render state and forward
  user intent to the command layer; every mutation goes through `AppState` so
  all surfaces observe the same state through its typed
  `subscribe`/`emit` events (`tabs` / `active` / `doc` / `selection` /
  `view` / `sheets`). `tabs` is about open _documents_; `sheets` is about the
  _worksheets inside_ the active workbook — two separate surfaces.
- One deliberate exception is measurement: column auto-fit needs real
  rendered text metrics, so `Commands` exposes a narrow `gridActions` port
  that the grid implements. The command still owns the flow; the grid only
  supplies DOM-dependent measurement.

### Inside the formula engine

The engine is split so that each piece has one job and the dependency graph
stays acyclic. Every module is DOM-free and testable in isolation.

```text
formula-value.ts    value model, error set, coercion rules, documented limits
      ↑
      ├── formula-criteria.ts   criteria parsing, safe wildcard matching
      ├── formula-date.ts       the UTC date-serial scale, DATEDIF
      ├── formula-text.ts       code-point-safe text helpers
      ├── formula-text-format.ts   TEXT()'s Excel-compatible format-code subset
      ↑
formula-functions.ts   the function registry: one FunctionDef per function
      ↑
formula.ts             tokenizer, parser, evaluator, reference rewriting
      ↑
spill.ts               dynamic-array placement (pure; takes a SpillSource)
      ↑
rsf-document.ts        the workbook: memo, spill maps, clock, cross-sheet eval
```

Two rules keep this honest:

- **The registry is the single source of truth.** `formula-functions.ts` drives
  which names the parser accepts, argument-count validation, evaluation,
  autocomplete, the help dialog's function table, and the localization key each
  function needs. A function cannot be implemented without being documented, or
  documented without being implemented; `tests/formula-help.test.ts` and the
  i18n parity test enforce both directions.
- **`formula.ts` owns plumbing, not semantics.** It turns AST nodes into lazy,
  memoized `FnArg` accessors and hands them to the registry. Laziness is a
  correctness requirement, not an optimization: `IF` and `IFERROR` must be able
  to leave a branch unevaluated whose evaluation would raise the very error the
  formula exists to avoid.

`spill.ts` is pure and knows nothing about worksheets: it receives a
`SpillSource` (dimensions, a cell reader, and the already-evaluated array
results) and returns a placement map. `RsfDocument` owns the impure parts —
when to rebuild, the evaluation memo, and the workbook-wide clock that volatile
functions read.

**Why no Rust/WASM formula evaluator, and no formula worker.** The WASM crate
accelerates CSV parsing, compression, and bulk scans — data-parallel work with
one obvious implementation. Formula evaluation is neither. A second
implementation would have to agree with the TypeScript one bit for bit on
coercion, rounding, comparison ordering, and every error case, or a workbook
would compute different values depending on whether WASM loaded; that
divergence risk is a poor trade for work that is already lazy and memoized
(only cells the grid actually displays are ever evaluated). The same reasoning
applies to moving evaluation into a worker: the engine has no worker
infrastructure, and the existing cooperative time-slicer (`scheduler.ts`) is
the established pattern for keeping long _scans_ responsive. If profiling later
shows a real bottleneck, `docs/performance.md` records the measurements to
argue from.

## Command flow

Every user command — menu item, context menu, keyboard shortcut,
drag-and-drop, welcome-screen button — dispatches through the single typed
command layer:

```text
input surface ─▶ resolveShortcut / menu / context menu
                      │  (CommandId, a closed union type)
                      ▼
              Commands.run(id) ── isEnabled(id) drives menu state
                      │
        ┌─────────────┼──────────────────┐
        ▼             ▼                  ▼
     UiPort       AppState           file-access
  (dialogs,    (atomic mutations,   (File System Access
   toasts,      history entries,     API + download
   busy UI)     events)              fallback)
```

`UiPort` is an interface, not a concrete class: the command layer drives
dialogs, notifications, and the busy indicator only through this port, which
keeps the whole layer unit-testable without a DOM (see
`tests/commands.test.ts`, `tests/progress.test.ts`).

## Data flow and document kinds

Two document kinds share one duck-typed editing surface (`EditorDocument`):

- **`LosslessDocument`** (`kind: 'csv'`) — the original bytes are the
  document. A parse index (built in Rust/WASM, JS fallback with identical
  semantics) maps records/fields to byte ranges; edits are stored as an
  overlay, and saving reserializes **only** edited field ranges
  (`serializer.ts` plans verbatim-copy + replacement segments). An unedited
  save is byte-identical by construction.
- **`RsfDocument`** (`kind: 'rsf'`) — a **workbook** of one or more
  `Worksheet`s (`worksheet.ts`). Cell inputs are the document; formulas
  evaluate lazily with memoization and full memo invalidation per mutation.
  Saved as the versioned binary `.rsf` container (`rsf-codec.ts`,
  spec in [rsf-format.md](rsf-format.md)); legacy `.rcsv` containers are read
  and migrated.

### Workbooks and worksheets

A `Worksheet` owns _data_: its grid, formula inputs, row/column structure,
filter, and display settings. It never evaluates anything, because a formula
may reference another worksheet (`Sheet1!A1`) — evaluation belongs to the
workbook, which holds the single shared memo and in-progress set. That is what
makes results consistent across worksheets and makes circular references
detectable _across_ worksheet boundaries.

The whole single-sheet editing surface (`rowCount`, `getValue`, `setCell`,
`insertRows`, `filter`, …) is delegated by `RsfDocument` to the **active**
worksheet, so the grid, the command layer, and the history layer keep operating
on "the sheet" without knowing about workbooks. Operations that must target a
_specific_ worksheet — undoing an edit made on another one, or the cross-sheet
formula rewrites a rename or delete implies — use the explicit
`…On(sheetId, …)` forms, and history operations carry an optional `sheetId`
for exactly that reason. A single history entry can therefore span worksheets
and still undo atomically.

Two independent tab strips exist and must not be confused:

| Strip                   | Lists                                     | Owner                |
| ----------------------- | ----------------------------------------- | -------------------- |
| `TabBar` (above grid)   | open **documents** (files)                | `AppState.tabs`      |
| `SheetBar` (below grid) | **worksheets** inside the active workbook | `RsfDocument.sheets` |

Reordering one never affects the other. Switching worksheets is a _view_
change (like zoom): it is persisted in the container but never marks the
workbook dirty; every worksheet remembers its own selection, zoom, and column
widths, which are swapped in and out of the tab on switch.

Conversion between the two is **always explicit and confirmed** (never
silent), and CSV → RSF is documented as lossy with respect to the original
byte layout.

## Floating surfaces (menus, context menus, submenus)

Every floating surface is placed by one viewport-aware helper,
`src/ui/popup.ts` (`positionPopup`): it measures the mounted element, then flips
or clamps it against the **visual** viewport (so browser/pinch zoom and on-screen
keyboards are respected), and caps the height with `overflow-y: auto` when the
surface is taller than the viewport. There are **no hard-coded offsets** — a
change that reintroduces a magic `innerWidth - 240` constant is a regression.
Right-click menus across the grid, the document tab strip, and the worksheet
strip all use one surface, `src/ui/context-menu.ts` (`ContextMenu`), which owns
placement, roving-focus keyboard navigation, submenu open/flip, and dismissal
(Escape, outside interaction, resize, scroll, and — via `closeAllContextMenus`,
called from the state subscription and the busy indicator — any change of
document, worksheet, content, or the start of a long operation). The menu-bar
drop-downs share the same placer and open their long lists (e.g. View ▸
Spreadsheet Zoom) as nested submenus mounted in `document.body` so a scrollable
parent can never clip them.

## The WASM boundary

`src/core/csv-engine.ts` is the only module that touches the generated
bindings. It exposes two narrow interfaces:

- `CsvEngine` — parsing, delimiter sniffing, serialization planning/apply,
  stats reduction, literal counting;
- `RsfCodec` — compression (Zstandard / LZ4 / DEFLATE / store), bounded
  decompression, CRC-32.

The WASM binary is embedded as Base64 and instantiated locally (no fetch —
this is what keeps `file://` working). Initialization is idempotent and
starts in the background at startup; every consumer awaits the same promise.
A pure-TypeScript fallback with byte-exact, parity-tested semantics
(`tests/wasm-engine.test.ts`) is used when WebAssembly is unavailable. There
are no Web Workers: the engine is synchronous, and long scans are instead
time-sliced on the main thread (see below) — the documented trigger for
introducing a worker is a profiled operation exceeding its budget
(docs/performance.md, "Deliberate non-optimizations").

## The SQL query engine

`src/core/sql-engine.ts` provides local, read-only SQL analysis (Data > Run
SQL Query…), executed by [sql.js](https://github.com/sql-js/sql.js) (SQLite
compiled to WebAssembly). An earlier iteration of this feature used a small
hand-written `SELECT`-only parser/evaluator instead, specifically to avoid
adding a WASM RDB dependency — see git history for that version. sql.js was
revisited and adopted once its loading model was confirmed compatible with
this app's constraints, using the same pattern already proven by the Rust
performance core above: no ES modules, no dynamic Worker spin-up, and the
`.wasm` binary embedded as Base64 (`scripts/embed-sqljs.mjs` →
`src/wasm-gen/sqljs-wasm-payload.ts`) and instantiated from those decoded
bytes via sql.js's `wasmBinary` option — `locateFile()` is never set, so the
`file://` / `connect-src 'none'` offline guarantee holds exactly as it does
for the Rust core (`scripts/check-dist.mjs` asserts both). This is now the
production runtime's second dependency (see `docs/security.md` "Dependency
policy"); like `encoding-japanese`, it has zero transitive dependencies.

The engine has no dependency on the DOM or the command layer, and never
mutates its input: `src/app/commands/sql.ts` adapts a `Tab`'s document into
the engine's plain `SqlTable` shape (a header row plus string rows, capped at
`SQL_MAX_SOURCE_ROWS`), loaded into a fresh, ephemeral in-memory SQLite
database per query (closed immediately after), and `src/ui/dialogs/sql.ts`
renders the result as a new, read-only table inside the existing dialog
system — nothing is written back to the CSV/RSF document or persisted in the
RSF format. A query is accepted only when it tokenizes to a single statement
whose first keyword is `SELECT` — not a keyword blacklist (string/quoted-
identifier contents and comments can never hide or fake a keyword) — so
`INSERT`/`UPDATE`/`DELETE`/`DROP`/`ATTACH`/`PRAGMA`/a second statement/etc.
are all rejected before SQLite ever sees the query. There is exactly one
queryable table per query — the fixed literal `data` in `FROM data` — so a
worksheet's display name never has to be parsed or escaped as a SQL
identifier. Because SQLite itself now executes the (gated) query, the
dialect available is a strict superset of the old hand-written grammar —
nested subqueries, joins, and CASE expressions all work — though `WITH` and
`EXPLAIN` are deliberately still rejected by the gate for this first
iteration (see the file's header comment for the exact scope and why).

## Long-running operations

`src/core/scheduler.ts` provides cooperative time slicing
(`forEachIndexSliced`: ~12 ms wall-clock budget per slice, hard index cap,
yield between slices). The rules, applied uniformly by the command layer:

1. **Slicing only wraps read-only scan phases.** Mutations are applied
   afterwards, synchronously, as **one atomic, singly-undoable history
   entry** — an abandoned scan can never leave a partially-mutated document.
2. **Stale-result rejection.** Every sliced operation captures the document
   reference it started from and checks `tab.doc !== doc` at each yield
   (`shouldStop`) and again after completion; a tab switch, edit, close, or
   newer operation abandons the scan without touching anything.
3. **Honest progress.** Percentages use a flooring helper so **100% is never
   shown while work remains**; phases with no honest percentage (e.g.
   compression inside the codec) show a labeled indeterminate state instead.
4. The busy indicator is always cleared in a `finally`, success or not.

## Key invariants

- **CSV byte preservation:** saving an unedited CSV writes the loaded bytes
  verbatim; edits reserialize only the affected field ranges. No performance
  or refactoring change may normalize or reserialize unaffected content
  (guarded by identity + fuzz tests).
- **Atomic history:** every user-visible mutation is exactly one
  `HistoryEntry`; undo/redo replays entries in reverse/forward order.
  Structural edits bundle their formula-reference rewrites into the same
  entry — including rewrites that land on _other_ worksheets, which is why an
  operation carries an optional `sheetId`. Worksheet lifecycle changes (add,
  rename, duplicate, delete, reorder) are ordinary entries too: a deleted
  worksheet travels inside its entry, so undo restores it with its data.
- **Presentational state rides with its edit:** enabling "wrap long rows"
  automatically because a committed value contains a line break is a `wrap`
  operation bundled into the **same** `HistoryEntry` as the edit, so one undo
  restores both the value and the prior wrap state. It is decided from the
  _displayed_ value (a formula's result, never its source), announced politely,
  and — for RSF — persisted per worksheet; it never marks a document dirty and
  never touches CSV bytes.
- **Range move rewrites references, never guesses:** moving a rectangle
  (`src/core/range-move.ts`, RSF-only) plans every cell write and formula
  rewrite from current values before touching the document, so the whole move
  is one atomic, undoable entry. A reference to a moved cell follows it (on the
  worksheet or through a cross-sheet qualifier); every other reference — and any
  range that only partially overlaps the move — is left exactly as written.
- **Workbook-wide recalculation:** any mutation to any worksheet clears the
  whole workbook memo, because a cross-sheet reference means a change anywhere
  can invalidate a formula anywhere. Recalculation stays lazy and memoized
  (values are recomputed on next access), which is the same model the
  single-worksheet document used — there is no separate dependency graph.
- **RSF container safety:** magic/version are validated as a pair, the body
  CRC is checked, decompression is bounded by the declared length (512 MiB
  ceiling), and parsing never executes anything. Display settings (zoom,
  column widths — body version 3) are presentational only: they are validated
  and clamped on load, never affect cell data, and never mark a document
  dirty. The sheet filter (body version 4) is pure, non-executable criteria
  data: it is fully validated against the sheet dimensions and documented
  bounds on load, and a structurally readable but invalid filter is dropped
  (never guessed at) with a warning so it can never corrupt the document (see
  docs/rsf-format.md).
- **Filter = hide only, never mutate:** a filter (`src/core/filter.ts`) only
  computes a hidden-row set; it never deletes, reorders, or rewrites cells,
  and formula evaluation is unaffected. The virtualized grid collapses hidden
  rows to zero height in the row-height index — no DOM is materialized for
  them — and copy/fill/clear/Flash Fill/selection-stats and keyboard
  navigation all skip hidden rows consistently. Applying/clearing a filter is
  one atomic `HistoryEntry` (a `filter` op); structural row/column edits bundle
  a filter-clear into the same entry so the stored range can never drift.
- **Sort = display order only, never mutate:** a sort (`src/core/sort.ts`)
  only computes a display-order mapping (document row → display slot); it
  never deletes, reorders, or rewrites cells, so formula evaluation and cell
  identity are unaffected. It combines with an active filter the same way a
  conventional sort combines with a filtered view: only rows the filter
  leaves visible take part in the reordering, and hidden rows keep their own
  position. Unlike a filter, a sort is session-only view state (like the
  current selection) — it is never persisted in the RSF container, is not an
  undoable `HistoryEntry`, and never marks the document dirty; editing a cell
  inside the sorted range is refused until the sort is cleared, and structural
  row/column edits drop the active sort outright (there is no stored range to
  keep consistent, unlike the filter's atomic clear-and-bundle).
- **One zoom sizing model:** the grid's per-tab zoom scales one set of JS
  metrics (row height, header width, wrap line box) and drives the CSS via
  inline custom properties set from those same values, so the line box a cell
  centers text in is derived from the _inherited_ zoom-scaled row height — the
  element height and CSS line box cannot diverge at any zoom level
  (`tests/zoom-alignment.test.ts`). Column widths are stored at 100% zoom.
- **Deterministic Flash Fill:** pattern inference (`src/core/flash-fill.ts`)
  is a bounded, deterministic search over closed data structures — no
  network, no model, no dynamic code — and a fill is proposed only when every
  matching candidate agrees on every affected cell; anything else is refused
  as ambiguous with an explanation.
- **Formula index:** `RsfDocument` maintains a per-row formula-cell count in
  parallel with the data (built lazily, updated by every mutator) so
  formula enumeration skips formula-free rows; consistency with the data is
  enforced by a property-based test (`tests/formula-index.test.ts`).
- **Offline runtime:** no runtime network access of any kind — no CDNs,
  remote fonts, analytics, or fetches. `npm run check:dist` asserts the
  production bundle is self-contained.
- **IME safety:** the grid's keyboard target is a persistent hidden sink
  textarea that is promoted in place into the cell editor, so composition
  never starts in a non-editable element and no printable character is ever
  synthesized from `keydown` (`tests/ime-composition.test.ts`).
- **Single version source:** `package.json` is the only place the app
  version is written; `src/app/version.ts` imports it and
  `scripts/check-versions.mjs` gates drift.

## Where to add things

| You want to…                      | Put the logic in…                               | Wire it via…                                    |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Add a new user command            | `Commands` (+ `CommandId` union)                | menu-bar/shortcut tables; `isEnabled` for state |
| Add a document operation          | `LosslessDocument` / `RsfDocument` + `AppState` | a `HistoryEntry` so it is atomically undoable   |
| Add a heavy scan                  | a pure function in `src/core/`                  | `forEachIndexSliced` + the busy/progress rules  |
| Add a dialog                      | `Dialogs` + a `UiPort` method                   | called from the command layer only              |
| Accelerate a byte-level primitive | `wasm/src/` + a JS fallback in `csv-engine.ts`  | parity tests in `tests/wasm-engine.test.ts`     |
