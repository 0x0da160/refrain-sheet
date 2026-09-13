# Performance and responsiveness

This document records how Refrain Sheet is tuned for perceived
responsiveness, how to reproduce the measurements, and the numbers measured
for the current revision. The README's
[Performance and responsiveness](../README.md#performance-and-responsiveness)
section summarizes the user-facing behavior; this file is the engineering
record.

## Principles

- **Feedback first.** Selection, focus, editing, and menu interactions give
  visual feedback immediately; aggregate results (statistics, match counts)
  may arrive a moment later with an honest "Calculating…" / progress state —
  never a frozen UI and never a misleading "done" state.
- **The main thread is for input and paint.** Long scans are sliced
  (~12 ms budget per slice, hard index cap per slice) with yields in between;
  byte-heavy work runs in Rust/WASM.
- **Mutations are atomic.** Slicing only ever wraps _read-only_ scan phases.
  Mutations are applied synchronously in one undoable operation after a scan
  completes, so cancellation or interleaving can never leave a
  partially-mutated document.

## What is optimized where

| Path                                                             | Mechanism                                                                                                                                                         | Code                                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Opening / parsing CSV                                            | Rust/WASM byte parser + indexer, busy indicator painted first                                                                                                     | `wasm/src/csv.rs`, `src/core/csv-engine.ts`, `withBusy` in `src/app/commands.ts` |
| Startup                                                          | WASM engine initializes in the background; UI paints without waiting; first open awaits the same idempotent promise                                               | `src/main.ts`, `initCsvEngine`                                                   |
| Grid rendering                                                   | Virtualization (visible window + overscan), in-place repaint unless a layout input changed                                                                        | `src/ui/grid.ts` (`LayoutSignature`)                                             |
| Scroll / drag selection / column resize / fill preview           | Passive scroll listener; rAF-scheduled re-render; leading-edge frame coalescing for pointer drags                                                                 | `src/ui/grid.ts` (`frameCoalesced`)                                              |
| Selection statistics                                             | ≤ 20,000 cells synchronous; larger selections deferred: debounce, time-sliced scan, cancellation on newer selection/edit/tab, "Calculating…" placeholder          | `src/ui/status-bar.ts`, `src/core/stats.ts` (`SelectionStatsAccumulator`)        |
| Replace All                                                      | Time-sliced read-only match scan with % progress and cancellation, then one synchronous atomic `bulkEdit`                                                         | `src/app/commands.ts` (`replaceAll`), `src/core/scheduler.ts`                    |
| Find-as-you-type counts                                          | 120 ms debounce + wall-clock search budget (partial results instead of a freeze)                                                                                  | `src/ui/find-bar.ts`, `src/core/search.ts`                                       |
| Formula recalculation                                            | Lazy evaluation with memoization; only displayed cells are computed, so edits never force a full-sheet pass                                                       | `src/core/rsf-document.ts`                                                       |
| Formula-cell enumeration                                         | Per-row formula index (built lazily, maintained by every mutator) so the status-bar count and the structural-edit reference-rewrite scan skip formula-free rows   | `src/core/rsf-document.ts` (`formulaPerRow`)                                     |
| `.rsf` save / open                                               | WASM DEFLATE + CRC-32 behind the busy indicator; decompression bounded by the header length (512 MiB ceiling)                                                     | `src/core/rsf-codec.ts`, `wasm/src/compress.rs`                                  |
| CSV field decoding (per-cell text, every field, every load/save) | One cached `TextDecoder` per (encoding, fatal) pair, reused across all fields, instead of constructing a new decoder per field                                    | `src/core/encoding.ts` (`decodeBytes`, `decodesCleanly`)                         |
| `VLOOKUP` / `MATCH` / `XLOOKUP` exact-match lookup               | Hash index over the lookup range, built once and cached per (range grid, revision); a wildcard needle (`*`/`?`/`~`) or an approximate lookup still scans linearly | `src/core/formula-functions.ts` (`findExactIndexed`, `exactIndexCache`)          |

Deliberate non-optimizations, and why:

- **No Web Workers (yet).** The WASM engine is synchronous and fast enough
  that the busy indicator + time slicing meet the responsiveness targets for
  the supported file-size limit; a worker would add a full data-copy (or
  transfer-and-restructure) cost per operation plus significant lifecycle
  complexity. Profiling that shows a specific operation exceeding its budget
  on reference hardware is the trigger for moving it to a worker.
- **No formula dependency graph.** Evaluation is lazy and memoized, and only
  the visible window plus the status bar ever request values, so the work per
  edit is bounded by the viewport, not the sheet. A precise dependency tracker
  would speed up dense cross-sheet graphs but risks correctness bugs in
  exchange for a case the lazy model already bounds. The one case profiling
  did find worth fixing this way — many formula cells doing an exact-match
  lookup against the same range — was addressed with a scoped, per-function
  cached index (see the `VLOOKUP`/`MATCH`/`XLOOKUP` row above), not a
  general dependency graph.
- **No WASM multi-threading (`SharedArrayBuffer`).** Rejected by design, not
  merely deferred: `SharedArrayBuffer` requires cross-origin-isolation
  (`COOP`/`COEP` response headers), which have no `file://` equivalent, so it
  is structurally incompatible with this project's "open `index.html`
  directly in a browser, no server required" invariant (`README.md`). See
  Issue #54 (round-2 audit, Candidate 4) for the analysis that ruled this out.

## Further WASM-offload candidates (surveyed, Issue #408)

A follow-up sweep of `src/core/` and `src/app/` for CPU-heavy JavaScript paths
not yet backed by `wasm/src/*.rs`, done in response to a request to look for
more opportunities. None of the areas below were adopted; each is recorded so
the same ground isn't re-covered blind in a future pass. The two mechanisms
already in `wasm/src/ops.rs` (`aggregate` for selection statistics,
`count_literal` for long literal search) remain the only general-purpose data
primitives moved into the Rust core; everything below stayed in JavaScript for
a documented reason.

- **Column/range sort** (`src/core/sort.ts`, `computeSortOrder`). The
  comparator calls back into JavaScript once per key per comparison via an
  injected `get(row, col)` closure that reads the live document/formula-value
  model — there is no flat buffer to hand across the WASM boundary without
  first materializing every cell's displayed text for the whole sort range,
  which would cost more than the sort itself. A closure-per-comparison
  boundary crossing is strictly worse than doing the comparison in JS. (The
  `SORT()` spill formula, which already benchmarks at ~68 ms for 25,000 rows —
  see the measured-results table above — uses the same strategy.)
- **Filter row matching** (`src/core/filter.ts`, `computeHiddenRows`). A
  linear scan doing plain `includes`/`startsWith`/`===`/`Number()` comparisons
  per cell — no regex. Like `statsAggregate` (see the note below the measured
  results table), the cost is dominated by `Number()` parsing and string
  comparisons V8 already optimizes well, not by anything a Rust loop would
  meaningfully speed up; offloading it would hit the same
  `get(row, col)`-closure-per-cell problem as sort, at a larger call count.
- **`SUMIFS`/`COUNTIFS`/wildcard criteria matching**
  (`src/core/formula-functions.ts` `scanCriteria`,
  `src/core/formula-criteria.ts` `matchWildcard`). The measured cost
  (~166–244 ms per 100,000 cells; see the measured-results table above) is the
  closest thing to a real candidate found in this survey, but the values being
  compared are `FormulaValue`s (a discriminated union with error-propagation
  semantics produced by the formula evaluator, not raw bytes), so only the
  numeric/text comparison core could move to Rust while type dispatch and
  error handling stayed in JS — splitting one function's logic across two
  languages, which risks the comparison-semantics drifting out of sync the
  same way a WASM formula evaluator would (see `docs/architecture.md` on why
  formula evaluation itself stays JS-only). Unlike the `VLOOKUP`/`XLOOKUP`
  shared-range case (which amortizes a JS-side cached index across many
  formula cells reading the same range), each `SUMIFS`/`COUNTIFS` call
  recomputes over its own criteria range, so there is no equivalent caching
  win available either. **Revisit only if profiling shows a specific
  `SUMIFS`/`COUNTIFS`-heavy sheet exceeding its responsiveness budget** — the
  same bar the "No Web Workers (yet)" decision above uses.
- **CSV/XLSX export quoting and escaping** (`src/core/csv-export.ts`,
  `src/core/xlsx-export.ts`). Per-field `includes`/`replace`/XML-escaping
  work; no benchmark in this repo suggests it is a bottleneck, and the actual
  byte-heavy step for `.rsf` (DEFLATE + CRC-32) is already WASM. One low-risk,
  performance-orthogonal cleanup surfaced here: `xlsx-export.ts` hand-rolls
  its own JS CRC-32 table for the ZIP container instead of reusing the CRC-32
  export the WASM compression module already exposes for `.rsf`
  (`wasm/src/compress.rs`, called via `rsf-codec.ts`). That's a code-reuse
  opportunity, not a measured performance gain — worth a small separate Issue
  if pursued, not part of this survey's scope.
- **XLSX import XML parsing** (`src/core/xlsx-import.ts`,
  `parseWorksheetCells`). Already reuses the project's WASM DEFLATE/CRC-32 for
  the byte-heavy decompression step (`readZipEntryBytes`, `codec.crc32`); the
  remaining work is regex-based XML text extraction, which needs to stay
  lenient JS regex logic rather than a rigid byte-level Rust parser.
- **Diff review** (`src/core/diff-engine.ts`). Hash-map/string-key based row
  matching (`Map` lookups, not a sequence-alignment algorithm), amortized
  `O(baselineRows + currentRows)`. JS's native `Map` and string hashing are
  already efficient at this, and the path only runs on-demand (diff review),
  not continuously.
- **Flash Fill** (`src/core/flash-fill.ts`). Inference runs only over the
  user-typed examples (tiny); applying an inferred pattern to the rest of a
  column is a handful of `String.prototype` calls per row per candidate,
  already time-sliced for large blocks. Too branchy/heterogeneous (four
  distinct op kinds) to benefit from a tight Rust loop.
- **Column autofit and text wrapping** (`src/ui/grid.ts`,
  `src/core/text-wrap.ts`). Autofit samples at most 1,000 rows per column
  regardless of sheet size, and both paths are dominated by canvas
  `measureText`, which needs the browser's font-shaping engine and cannot
  move to WASM at all; the wrapping-position bookkeeping around it is cheap
  arithmetic over an already-short string, not a meaningful cost on its own.
- **SQL view** (`src/core/sql-engine.ts`). Already WASM-accelerated, just via
  a different module than this project's own Rust core: query execution runs
  entirely inside the embedded sql.js (SQLite-compiled-to-WASM) engine. The
  remaining JS (a hand-written tokenizer used only for the read-only/
  single-statement safety gate, and a per-row bind-value scan) is either
  security-critical logic that should stay simple and auditable, or a cheap
  single pass — nothing left to offload.

## Reproducing the measurements

```sh
docker compose run --rm app npm run bench
```

Benchmarks live in `bench/perf.bench.ts` and generate deterministic in-code
fixtures (no fixture files, no randomness), so runs are comparable across
machines and revisions. They run in Node (V8) and measure pure data-processing
cost; DOM-related responsiveness is covered by the deterministic structural
tests in `tests/perf.test.ts` and `tests/virtual-grid.test.ts`.

### Manual browser profiling

The benchmarks intentionally exclude the DOM. To profile the real UI:

1. `docker compose up dev`, open `http://localhost:5173` in Chromium.
2. Generate a large CSV (e.g. 200,000 rows) and open it via drag & drop.
3. In DevTools → Performance, record while: scrolling the grid; drag-selecting
   a large range; typing into a cell; running Replace All.
4. Verify: no long tasks (> 50 ms) during scrolling/typing; selection updates
   in the same frame as the pointer event; Replace All shows only ~12 ms tasks
   separated by idle time; the status bar shows "Calculating…" during large
   selections.

## Measured results (this revision)

Environment: Node v22 (V8) inside the project's Docker container
(`docker compose run --rm app npm run bench`), Docker Desktop on a
Windows 11 developer machine. Wall-clock numbers are means over 5 iterations
and vary with host hardware and load (observed rme up to ±30%); the _ratios_
and orders of magnitude are the meaningful signal. Numbers are pasted from an
actual run — do not edit them by hand; re-run the bench instead.

| Scenario (deterministic fixture)                            | Mean                  | Notes                                                                    |
| ----------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| Parse + index 200,000×6 CSV (~11 MB), WASM engine           | ~391 ms               | 2.3–2.4× faster than the JS fallback (~954 ms)                           |
| Parse + index 10,000×2 CSV, 500-char values (~10 MB), WASM  | ~66 ms                | long-value documents                                                     |
| Unedited CSV save, 200,000×6 (~11 MB), identity path        | ~212 ms               | dominated by re-parsing the baseline; output bytes verbatim              |
| 10-cell minimal-diff CSV save, same document (patch path)   | ~226 ms               | only edited field ranges reserialize                                     |
| CSV → RSF conversion, 200,000×6 (value collection)          | ~3.7 s                | time-sliced with % progress in the app                                   |
| Selection statistics, 1,000,000-cell range (full scan)      | ~124–130 ms           | see below — this cost is now _off_ the selection-event path              |
| Replace-All match scan, 200,000×6 cells                     | ~86–140 ms            | now sliced into ~12 ms tasks with % progress                             |
| `.rsf` encode, 100,000 cells: Zstandard / LZ4 / DEFLATE     | ~494 / ~585 / ~857 ms | behind the busy indicator                                                |
| `.rsf` decode, 100,000 cells (any method)                   | ~110–130 ms           | validate + decompress, bounded by the header length                      |
| Insert 1 row into 100,000×6 sheet with 1,000 formulas       | ~6–8 ms               | structural op incl. index-assisted formula-reference rewrite scan        |
| `listFormulaCells`, same sheet (indexed walk)               | ~1.2–1.4 ms           | vs ~5.1 ms for the pre-index full-sheet scan (kept as a reference bench) |
| Bulk edit apply, 120,000 cells (paste/fill mutation path)   | ~50 ms                | one atomic, singly-undoable `bulkEdit`                                   |
| Formula evaluation, 5,000-cell dependency chain (cold memo) | ~25–35 ms             | lazy + memoized thereafter                                               |

### Formula expansion (measured on this revision)

A separate run on a smaller machine — Node v22.23.1 (x64) in the project's
Docker container, Intel N100, 4 cores — so these numbers are **not** comparable
with the table above; only the rows within this table compare with each other.
Each figure is the mean of 5 iterations and includes **building the fixture
worksheet**, not just evaluating it, because that is the cost a user actually
pays when a file is opened. Observed rme is high (up to ±93%) on this host;
treat the orders of magnitude as the signal.

| Scenario (deterministic fixture)                               | Mean    | Notes                                                  |
| -------------------------------------------------------------- | ------- | ------------------------------------------------------ |
| `COUNTIF` numeric comparison over 100,000 cells                | ~232 ms | includes writing the 100,000-cell fixture              |
| `COUNTIF` wildcard text criterion over 100,000 cells           | ~166 ms | the hand-written matcher, no regular expression        |
| `SUMIFS` with two criteria pairs over 100,000 cells            | ~244 ms | two full scans plus the sum                            |
| `XLOOKUP` exact match, 100,000 rows, worst case (no match)     | ~357 ms | full linear scan; a hit returns earlier                |
| `VLOOKUP` exact match, 100,000 rows, worst case (no match)     | ~121 ms |                                                        |
| `SUM` across four worksheets of 25,000 rows                    | ~150 ms | cross-sheet recalculation, shared memo                 |
| `SEQUENCE` spilling 50,000 cells                               | ~31 ms  | materialize + place the spill map                      |
| `SORT` spilling 25,000 rows                                    | ~68 ms  | stable decorated sort, source untouched                |
| Spill-map rebuild on a 20,000-formula sheet with **no** arrays | ~59 ms  | what `canSpill()` costs when there is nothing to spill |

The last row is the one that matters for the design: an ordinary formula-heavy
worksheet pays only a static AST walk per formula, because `canSpill()` rejects
anything that cannot return an array before it is ever evaluated. Without that
check, every mutation would evaluate every formula eagerly.

**Not measured, and therefore not claimed:** these benches run in Node, so they
say nothing about paint or interaction latency in a browser, and no
before/after comparison exists for the formula engine because these functions
did not exist before this revision.

Multi-column auto-fit is not benchmarked in Node: it measures real rendered
text via the canvas `measureText` API, which jsdom/Node does not implement.
Its structural behavior (sampling caps, cache invalidation, sliced progress)
is asserted by `tests/autofit.test.ts`; browser-level cost is covered by the
manual profiling steps above.

Note: the WASM and JS `statsAggregate` reductions measure the same (~125 ms)
on this fixture because the scan cost is dominated by JS-side `Number()`
parsing, which stays in JS deliberately so its semantics remain the single
source of truth. The WASM reduction still avoids a JS loop for the final
sum/min/max pass.

### Before / after (the changes in this tuning pass)

These compare the _structure_ of the work, using the measured costs above:

| Interaction                                                        | Before                                                                                                                             | After                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selecting / drag-extending a 1,000,000-cell range                  | every `selection` event ran the full ~125 ms statistics scan synchronously (multi-frame stall per mousemove)                       | selection paints immediately; "Calculating…" shown; scan runs in ~8 ms slices in the background and is cancelled by newer selections                                                                                                                                                                                                                                                                                                                                 |
| Single-cell edit in a large file                                   | the entire visible window (~hundreds of cells) was torn down and rebuilt                                                           | 0 DOM nodes created — existing cells repaint in place (asserted by `tests/perf.test.ts`)                                                                                                                                                                                                                                                                                                                                                                             |
| Column resize / drag selection / fill preview                      | every mousemove re-rendered synchronously                                                                                          | first event applies immediately, the rest coalesce to ≤ 1 update per frame                                                                                                                                                                                                                                                                                                                                                                                           |
| Replace All on 200,000×6 cells                                     | one ~86 ms+ blocking task (scan + apply) after the busy indicator painted                                                          | ~12 ms slices with yields and % progress; the apply phase remains one atomic synchronous `bulkEdit`                                                                                                                                                                                                                                                                                                                                                                  |
| First paint at startup                                             | blocked on Base64-decoding + compiling the embedded WASM engine                                                                    | UI paints immediately; the engine finishes initializing in the background and the first open awaits it                                                                                                                                                                                                                                                                                                                                                               |
| Formula-cell enumeration (status bar, structural edits)            | every `countFormulaCells`/`listFormulaCells` call scanned all rows × columns (~5.1 ms measured on 600,000 cells)                   | per-row index skips formula-free rows: ~1.3 ms measured on the same sheet (~3.7×), and the gap grows with sheet size while the formula count stays sparse                                                                                                                                                                                                                                                                                                            |
| CSV field decoding on load/save/convert (every field)              | `decodeBytes`/`decodesCleanly` each constructed a new `TextDecoder` per call — 2 decoders × every field                            | one cached `TextDecoder` per (encoding, fatal) pair, reused for the life of the module; `RsfDocument.fromLossless` on a 200,000×6 CSV dropped from ~872 ms to ~647 ms mean (~26% faster), measured with `npm run bench` on this change's CI runner (not the pinned Docker/Windows reference environment above — re-run `docker compose run --rm app npm run bench` to refresh the pinned figures)                                                                    |
| `VLOOKUP`/`MATCH`/`XLOOKUP`, same range read by many formula cells | each exact-match call re-scanned the whole lookup column/row linearly, so N formula cells against the same M-row range cost O(N×M) | the lookup column is hashed into a cached index the first time a formula reads it; later cells against the same range are O(1) average — "VLOOKUP table shared by 2,000 formula cells" (`bench/perf.bench.ts`) dropped from ~2,259 ms to ~75 ms mean (~30×), measured with `npm run bench` on this change's CI runner (not the pinned Docker/Windows reference environment above — re-run `docker compose run --rm app npm run bench` to refresh the pinned figures) |

## Limits and assumptions

- Documents are held in memory; the open-size limit (configurable in
  Settings) exists to keep worst-case memory bounded. Browser memory is the
  hard ceiling for very large files.
- Responsiveness targets (~100 ms feedback for common interactions on the
  reference environment) are engineering goals, not guarantees on every
  browser or device; low-end hardware, background load, and extremely wide
  sheets or dense formula graphs cost proportionally more.
- jsdom-based tests assert structure (DOM counts, element identity, deferred
  states), never wall-clock timings, so CI results are deterministic.
- The Node benchmark numbers approximate browser JS/WASM engine behavior but
  are not identical to it; use the manual profiling steps above for
  browser-level verification.
