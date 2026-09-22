---
type: operations-concept
title: Performance measurements
description: How to reproduce the benchmark suite, and the measured numbers for a specific revision. Time-sensitive — re-run before relying on the numbers for a new decision.
sources:
  - resource: docs/performance.md (migrated content; file removed after migration — see knowledge/log.md)
  - resource: ../../bench/perf.bench.ts
status: stable
stale_after: 2027-03-21T12:02:03Z
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:00:58Z
---

# Performance measurements

**These numbers are a snapshot, not a guarantee.** They were pasted from an
actual `npm run bench` run — do not edit them by hand; re-run the bench
instead. Treat orders of magnitude and ratios as the meaningful signal, not the
exact millisecond figures — re-run the suite before citing a number in a
new decision, especially once `stale_after` has passed.

## Reproducing the measurements

```sh
docker compose run --rm app npm run bench
```

Benchmarks live in `bench/perf.bench.ts` and generate deterministic
in-code fixtures (no fixture files, no randomness), so runs are comparable
across machines and revisions. They run in Node (V8) and measure pure
data-processing cost; DOM-related responsiveness is covered by the
deterministic structural tests in `tests/perf.test.ts` and
`tests/virtual-grid.test.ts`.

### Manual browser profiling

The benchmarks intentionally exclude the DOM. To profile the real UI:

1. `docker compose up dev`, open `http://localhost:5173` in Chromium.
2. Generate a large CSV (e.g. 200,000 rows) and open it via drag & drop.
3. In DevTools → Performance, record while: scrolling the grid;
   drag-selecting a large range; typing into a cell; running Replace All.
4. Verify: no long tasks (> 50 ms) during scrolling/typing; selection
   updates in the same frame as the pointer event; Replace All shows only
   ~12 ms tasks separated by idle time; the status bar shows
   "Calculating…" during large selections.

## Measured results (snapshot)

Environment: Node v22 (V8) inside the project's Docker container, Docker
Desktop on a Windows 11 developer machine. Wall-clock numbers are means
over 5 iterations and vary with host hardware and load (observed rme up to
±30%).

| Scenario (deterministic fixture)                            | Mean                  | Notes                                                             |
| ----------------------------------------------------------- | --------------------- | ----------------------------------------------------------------- |
| Parse + index 200,000×6 CSV (~11 MB), WASM engine           | ~391 ms               | 2.3–2.4× faster than the JS fallback (~954 ms)                    |
| Parse + index 10,000×2 CSV, 500-char values (~10 MB), WASM  | ~66 ms                | long-value documents                                              |
| Unedited CSV save, 200,000×6 (~11 MB), identity path        | ~212 ms               | dominated by re-parsing the baseline; output bytes verbatim       |
| 10-cell minimal-diff CSV save, same document (patch path)   | ~226 ms               | only edited field ranges reserialize                              |
| CSV → RSF conversion, 200,000×6 (value collection)          | ~3.7 s                | time-sliced with % progress in the app                            |
| Selection statistics, 1,000,000-cell range (full scan)      | ~124–130 ms           | this cost is off the selection-event path                         |
| Replace-All match scan, 200,000×6 cells                     | ~86–140 ms            | sliced into ~12 ms tasks with % progress                          |
| `.rsf` encode, 100,000 cells: Zstandard / LZ4 / DEFLATE     | ~494 / ~585 / ~857 ms | behind the busy indicator                                         |
| `.rsf` decode, 100,000 cells (any method)                   | ~110–130 ms           | validate + decompress, bounded by the header length               |
| Insert 1 row into 100,000×6 sheet with 1,000 formulas       | ~6–8 ms               | structural op incl. index-assisted formula-reference rewrite scan |
| `listFormulaCells`, same sheet (indexed walk)               | ~1.2–1.4 ms           | vs ~5.1 ms for the pre-index full-sheet scan                      |
| Bulk edit apply, 120,000 cells (paste/fill mutation path)   | ~50 ms                | one atomic, singly-undoable `bulkEdit`                            |
| Formula evaluation, 5,000-cell dependency chain (cold memo) | ~25–35 ms             | lazy + memoized thereafter                                        |

### Formula expansion

A separate run on a smaller machine (Node v22.23.1 x64, Intel N100, 4
cores) — **not comparable** with the table above; only rows within this
table compare with each other. Each figure includes **building the
fixture worksheet**, not just evaluating it (the cost a user actually pays
on open). Observed rme is high (up to ±93%) on this host.

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

The last row is the one that matters for the design: an ordinary
formula-heavy worksheet pays only a static AST walk per formula, because
`canSpill()` rejects anything that cannot return an array before it is
ever evaluated.

**Not measured, and therefore not claimed:** these benches run in Node, so
they say nothing about paint or interaction latency in a browser.
Multi-column auto-fit is not benchmarked in Node either — it measures real
rendered text via canvas `measureText`, which jsdom/Node does not
implement; its structural behavior is asserted by `tests/autofit.test.ts`.

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
  Settings) exists to keep worst-case memory bounded. Browser memory is
  the hard ceiling for very large files.
- Responsiveness targets (~100 ms feedback for common interactions on the
  reference environment) are engineering goals, not guarantees on every
  browser or device.
- jsdom-based tests assert structure (DOM counts, element identity,
  deferred states), never wall-clock timings, so CI results are
  deterministic.
- The Node benchmark numbers approximate browser JS/WASM engine behavior
  but are not identical to it; use the manual profiling steps above for
  browser-level verification.
