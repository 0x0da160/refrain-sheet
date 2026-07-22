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
