---
type: architecture-concept
title: System overview
description: The four architectural layers, command flow, document/workbook data flow, the WASM boundary, the SQL engine, and long-running-operation slicing.
sources:
  - resource: ../../docs/architecture.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T11:00:47Z
---

# System overview

Four layers, dependencies flowing strictly inward (each layer may import
from the layers below it, never above — see
[module-boundaries.md](module-boundaries.md) for the enforcement rules):

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
keeps the whole layer unit-testable without a DOM (`tests/commands.test.ts`,
`tests/progress.test.ts`).

## Data flow and document kinds

Two document kinds share one duck-typed editing surface (`EditorDocument`):

- **`LosslessDocument`** (`kind: 'csv'`) — the original bytes are the
  document. A parse index (built in Rust/WASM, JS fallback with identical
  semantics) maps records/fields to byte ranges; edits are stored as an
  overlay, and saving reserializes **only** edited field ranges
  (`serializer.ts` plans verbatim-copy + replacement segments). An unedited
  save is byte-identical by construction — see
  [invariants.md](invariants.md).
- **`RsfDocument`** (`kind: 'rsf'`) — a **workbook** of one or more
  `Worksheet`s (`src/core/worksheet.ts`). Cell inputs are the document;
  formulas evaluate lazily with memoization and full memo invalidation per
  mutation. Saved as the versioned binary `.rsf` container
  (`src/core/rsf-codec.ts`; spec in `docs/rsf-format.md`); legacy `.rcsv`
  containers are read and migrated.

### Workbooks and worksheets

A `Worksheet` owns _data_: its grid, formula inputs, row/column structure,
filter, and display settings. It never evaluates anything, because a formula
may reference another worksheet (`Sheet1!A1`) — evaluation belongs to the
workbook, which holds the single shared memo and in-progress set.

The whole single-sheet editing surface (`rowCount`, `getValue`, `setCell`,
`insertRows`, `filter`, …) is delegated by `RsfDocument` to the **active**
worksheet. Operations that must target a _specific_ worksheet use the
explicit `…On(sheetId, …)` forms; history operations carry an optional
`sheetId` for exactly that reason, so a single history entry can span
worksheets and still undo atomically.

Two independent tab strips exist and must not be confused:

| Strip                   | Lists                                     | Owner                |
| ----------------------- | ----------------------------------------- | -------------------- |
| `TabBar` (above grid)   | open **documents** (files)                | `AppState.tabs`      |
| `SheetBar` (below grid) | **worksheets** inside the active workbook | `RsfDocument.sheets` |

Conversion between the two document kinds is **always explicit and
confirmed** (never silent), and CSV → RSF is documented as lossy with
respect to the original byte layout.

A worksheet also has a **kind** (`'grid'`, `'markdown'`, `'json'`, `'yaml'`,
or `'text'` — see `docs/rsf-format.md#worksheet-kind-body-version-12`): a
non-`grid` kind holds one document as its sole content (source lives in cell
A1) and is rendered by a docked source/preview surface in the spreadsheet
area instead of the grid while active. None of these kinds is ever evaluated
as a formula or exported to CSV.

## Floating surfaces (menus, context menus, submenus)

Every floating surface is placed by one viewport-aware helper,
`src/ui/popup.ts` (`positionPopup`): it measures the mounted element, then
flips or clamps it against the **visual** viewport, and caps the height with
`overflow-y: auto` when taller than the viewport. There are **no hard-coded
offsets** — a change that reintroduces a magic `innerWidth - 240` constant is
a regression. `src/ui/context-menu.ts` (`ContextMenu`) is the one surface
for every right-click menu (grid, document tab strip, worksheet strip),
owning placement, roving-focus keyboard navigation, submenu open/flip, and
dismissal.

## The WASM boundary

`src/core/csv-engine.ts` is the only module that touches the generated
bindings, exposing two narrow interfaces:

- `CsvEngine` — parsing, delimiter sniffing, serialization planning/apply,
  stats reduction, literal counting;
- `RsfCodec` — compression (Zstandard / LZ4 / DEFLATE / store), bounded
  decompression, CRC-32.

The WASM binary is embedded as Base64 and instantiated locally (no fetch —
this is what keeps `file://` working). A pure-TypeScript fallback with
byte-exact, parity-tested semantics (`tests/wasm-engine.test.ts`) is used
when WebAssembly is unavailable. There are no Web Workers: the engine is
synchronous, and long scans are time-sliced on the main thread instead (see
below).

## The SQL query engine

`src/core/sql-engine.ts` provides local, read-only SQL analysis (Data > Run
SQL Query…), executed by [sql.js](https://github.com/sql-js/sql.js) (SQLite
compiled to WebAssembly), embedded the same way as the Rust core (Base64,
`scripts/embed-sqljs.mjs` → `src/wasm-gen/sqljs-wasm-payload.ts`). The engine
has no dependency on the DOM or the command layer and never mutates its
input. A query is accepted only when it tokenizes to a single statement
whose first keyword is `SELECT` — not a keyword blacklist — so mutating
statements are rejected before SQLite ever sees the query.

## Long-running operations

`src/core/scheduler.ts` provides cooperative time slicing
(`forEachIndexSliced`: ~12 ms wall-clock budget per slice, hard index cap,
yield between slices), applied uniformly by the command layer:

1. **Slicing only wraps read-only scan phases.** Mutations are applied
   afterwards, synchronously, as one atomic, singly-undoable history entry.
2. **Stale-result rejection.** Every sliced operation checks `tab.doc !== doc`
   at each yield and again after completion.
3. **Honest progress.** 100% is never shown while work remains; phases with
   no honest percentage show a labeled indeterminate state instead.
4. The busy indicator is always cleared in a `finally`, success or not.

## Where to add things

| You want to…                      | Put the logic in…                               | Wire it via…                                    |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Add a new user command            | `Commands` (+ `CommandId` union)                | menu-bar/shortcut tables; `isEnabled` for state |
| Add a document operation          | `LosslessDocument` / `RsfDocument` + `AppState` | a `HistoryEntry` so it is atomically undoable   |
| Add a heavy scan                  | a pure function in `src/core/`                  | `forEachIndexSliced` + the busy/progress rules  |
| Add a dialog                      | `Dialogs` + a `UiPort` method                   | called from the command layer only              |
| Accelerate a byte-level primitive | `wasm/src/` + a JS fallback in `csv-engine.ts`  | parity tests in `tests/wasm-engine.test.ts`     |
