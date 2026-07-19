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

| Path                                                   | Mechanism                                                                                                                                                | Code                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Opening / parsing CSV                                  | Rust/WASM byte parser + indexer, busy indicator painted first                                                                                            | `wasm/src/csv.rs`, `src/core/csv-engine.ts`, `withBusy` in `src/app/commands.ts` |
| Startup                                                | WASM engine initializes in the background; UI paints without waiting; first open awaits the same idempotent promise                                      | `src/main.ts`, `initCsvEngine`                                                   |
| Grid rendering                                         | Virtualization (visible window + overscan), in-place repaint unless a layout input changed                                                               | `src/ui/grid.ts` (`LayoutSignature`)                                             |
| Scroll / drag selection / column resize / fill preview | Passive scroll listener; rAF-scheduled re-render; leading-edge frame coalescing for pointer drags                                                        | `src/ui/grid.ts` (`frameCoalesced`)                                              |
| Selection statistics                                   | ≤ 20,000 cells synchronous; larger selections deferred: debounce, time-sliced scan, cancellation on newer selection/edit/tab, "Calculating…" placeholder | `src/ui/status-bar.ts`, `src/core/stats.ts` (`SelectionStatsAccumulator`)        |
| Replace All                                            | Time-sliced read-only match scan with % progress and cancellation, then one synchronous atomic `bulkEdit`                                                | `src/app/commands.ts` (`replaceAll`), `src/core/scheduler.ts`                    |
| Find-as-you-type counts                                | 120 ms debounce + wall-clock search budget (partial results instead of a freeze)                                                                         | `src/ui/find-bar.ts`, `src/core/search.ts`                                       |
| Formula recalculation                                  | Lazy evaluation with memoization; only displayed cells are computed, so edits never force a full-sheet pass                                              | `src/core/rcsv-document.ts`                                                      |
| `.rcsv` save / open                                    | WASM DEFLATE + CRC-32 behind the busy indicator; decompression bounded by the header length (512 MiB ceiling)                                            | `src/core/rcsv-codec.ts`, `wasm/src/compress.rs`                                 |

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
  exchange for a case the lazy model already bounds.

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

| Scenario (deterministic fixture)                            | Mean        | Notes                                                       |
| ----------------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| Parse + index 200,000×6 CSV (~11 MB), WASM engine           | ~391 ms     | 2.4× faster than the JS fallback (~954 ms)                  |
| Parse + index 10,000×2 CSV, 500-char values (~10 MB), WASM  | ~66 ms      | long-value documents                                        |
| Selection statistics, 1,000,000-cell range (full scan)      | ~124–130 ms | see below — this cost is now _off_ the selection-event path |
| Replace-All match scan, 200,000×6 cells                     | ~86 ms      | now sliced into ~12 ms tasks with % progress                |
| `.rcsv` encode, 100,000 cells (WASM DEFLATE + CRC)          | ~806 ms     | behind the busy indicator                                   |
| `.rcsv` decode (validate + inflate), 100,000 cells          | ~170 ms     | behind the busy indicator                                   |
| Formula evaluation, 5,000-cell dependency chain (cold memo) | ~35 ms      | lazy + memoized thereafter                                  |

Note: the WASM and JS `statsAggregate` reductions measure the same (~125 ms)
on this fixture because the scan cost is dominated by JS-side `Number()`
parsing, which stays in JS deliberately so its semantics remain the single
source of truth. The WASM reduction still avoids a JS loop for the final
sum/min/max pass.

### Before / after (the changes in this tuning pass)

These compare the _structure_ of the work, using the measured costs above:

| Interaction                                       | Before                                                                                                       | After                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Selecting / drag-extending a 1,000,000-cell range | every `selection` event ran the full ~125 ms statistics scan synchronously (multi-frame stall per mousemove) | selection paints immediately; "Calculating…" shown; scan runs in ~8 ms slices in the background and is cancelled by newer selections |
| Single-cell edit in a large file                  | the entire visible window (~hundreds of cells) was torn down and rebuilt                                     | 0 DOM nodes created — existing cells repaint in place (asserted by `tests/perf.test.ts`)                                             |
| Column resize / drag selection / fill preview     | every mousemove re-rendered synchronously                                                                    | first event applies immediately, the rest coalesce to ≤ 1 update per frame                                                           |
| Replace All on 200,000×6 cells                    | one ~86 ms+ blocking task (scan + apply) after the busy indicator painted                                    | ~12 ms slices with yields and % progress; the apply phase remains one atomic synchronous `bulkEdit`                                  |
| First paint at startup                            | blocked on Base64-decoding + compiling the embedded WASM engine                                              | UI paints immediately; the engine finishes initializing in the background and the first open awaits it                               |

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
