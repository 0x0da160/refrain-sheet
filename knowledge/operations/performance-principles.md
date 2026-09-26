---
type: operations-concept
title: Performance principles
description: The responsiveness principles, the "what is optimized where" map, and the deliberate non-optimizations, including the WASM-offload candidates surveyed in Issue #408.
sources:
  - resource: docs/performance.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:00:58Z
---

# Performance principles

## Principles

The targets follow the classic human response-time limits: about **0.1 s**
is perceived as instantaneous (direct manipulation must land here), about
**1 s** keeps the train of thought (a pause is noticed but tolerated
without a progress cue), and beyond that a wait needs visible, honest
progress.

- **Acknowledge the input before doing the work.** A pressed control shows
  its `:active` state on pointer-down (`src/styles/base.css`), selection
  and focus paint before any aggregate is computed, so even a slow action
  never reads as a missed click or tap.
- **No indicator for a wait nobody would notice.** The busy overlay is in
  the DOM (and announced) as soon as an operation starts, but reveals
  itself only after ~0.3 s through a compositor-driven opacity animation
  (`src/styles/loading-overlay.css`) — that still runs while a synchronous
  step holds the main thread, so a long wait is never left bare, while a
  short one no longer flashes a full-window scrim, which makes it feel
  slower than it is.
- **Feedback first.** Selection, focus, editing, and menu interactions
  give visual feedback immediately; aggregate results (statistics, match
  counts) may arrive a moment later with an honest "Calculating…" /
  progress state — never a frozen UI and never a misleading "done" state.
- **The main thread is for input and paint.** Long scans are sliced
  (~12 ms budget per slice, hard index cap per slice) with yields in
  between; byte-heavy work runs in Rust/WASM.
- **Mutations are atomic.** Slicing only ever wraps _read-only_ scan
  phases. Mutations are applied synchronously in one undoable operation
  after a scan completes, so cancellation or interleaving can never leave
  a partially-mutated document.

## What is optimized where

| Path                                                             | Mechanism                                                                                                                                                            | Code                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Opening / parsing CSV                                            | Rust/WASM byte parser + indexer, busy indicator painted first                                                                                                        | `wasm/src/csv.rs`, `src/core/csv-engine.ts`, `withBusy` in `src/app/commands.ts` |
| Startup                                                          | WASM engine initializes in the background; UI paints without waiting; first open awaits the same idempotent promise                                                  | `src/main.ts`, `initCsvEngine`                                                   |
| Grid rendering                                                   | Virtualization (visible window + overscan), in-place repaint unless a layout input changed                                                                           | `src/ui/grid.ts` (`LayoutSignature`)                                             |
| Scroll / drag selection / column resize / fill preview           | Passive scroll listener; rAF-scheduled re-render; leading-edge frame coalescing for pointer drags                                                                    | `src/ui/grid.ts` (`frameCoalesced`)                                              |
| Scroll within the overscan                                       | No DOM work while the rendered window (overscan included) still covers the viewport; rows rebuild once per overscan's worth of rows scrolled                         | `src/ui/grid.ts` (`windowCoversViewport`)                                        |
| CSV cell text (every value read: render, scans, conversion)      | Short pure-ASCII fields built directly from the bytes; value-only reads skip the `FieldNode` cache; per-field strict decode only when the file has undecodable bytes | `src/core/lossless-document.ts` (`decodeField`, `asciiString`)                   |
| Selection statistics                                             | ≤ 20,000 cells synchronous; larger selections deferred: debounce, time-sliced scan, cancellation on newer selection/edit/tab, "Calculating…" placeholder             | `src/ui/status-bar.ts`, `src/core/stats.ts` (`SelectionStatsAccumulator`)        |
| Replace All                                                      | Time-sliced read-only match scan with % progress and cancellation, then one synchronous atomic `bulkEdit`                                                            | `src/app/commands.ts` (`replaceAll`), `src/core/scheduler.ts`                    |
| Find-as-you-type counts                                          | 120 ms debounce + wall-clock search budget (partial results instead of a freeze)                                                                                     | `src/ui/find-bar.ts`, `src/core/search.ts`                                       |
| Formula recalculation                                            | Lazy evaluation with memoization; only displayed cells are computed                                                                                                  | `src/core/rsf-document.ts`                                                       |
| Formula-cell enumeration                                         | Per-row formula index (built lazily, maintained by every mutator) so the status-bar count and reference-rewrite scan skip formula-free rows                          | `src/core/rsf-document.ts` (`formulaPerRow`)                                     |
| `.rsf` save / open                                               | JSON + WASM Zstandard + CRC-32 behind the busy indicator; decompression bounded by the header length (512 MiB ceiling)                                               | `src/core/rsf-codec.ts`, `wasm/src/compress.rs`                                  |
| CSV field decoding (per-cell text, every field, every load/save) | One cached `TextDecoder` per (encoding, fatal) pair, reused across all fields                                                                                        | `src/core/encoding.ts` (`decodeBytes`, `decodesCleanly`)                         |
| `VLOOKUP` / `MATCH` / `XLOOKUP` exact-match lookup               | Hash index over the lookup range, built once and cached per (range grid, revision); a wildcard or approximate lookup still scans linearly                            | `src/core/formula-functions.ts` (`findExactIndexed`, `exactIndexCache`)          |

## Deliberate non-optimizations

- **No Web Workers (yet).** The WASM engine is synchronous and fast enough
  that the busy indicator + time slicing meet the responsiveness targets;
  a worker would add a full data-copy cost per operation plus significant
  lifecycle complexity. Profiling that shows a specific operation
  exceeding its budget on reference hardware is the trigger for moving it
  to a worker.
- **No formula dependency graph.** Evaluation is lazy and memoized, and
  only the visible window plus the status bar ever request values, so the
  work per edit is bounded by the viewport, not the sheet. The one case
  profiling did find worth fixing — many formula cells doing an
  exact-match lookup against the same range — was addressed with a
  scoped, per-function cached index (see `VLOOKUP`/`MATCH`/`XLOOKUP`
  above), not a general dependency graph.
- **No WASM multi-threading (`SharedArrayBuffer`).** Rejected by design,
  not merely deferred: `SharedArrayBuffer` requires cross-origin-isolation
  (`COOP`/`COEP` response headers), which have no `file://` equivalent, so
  it is structurally incompatible with the "open `index.html` directly in
  a browser, no server required" invariant. See Issue #54 (round-2 audit,
  Candidate 4).

## Where the time actually goes on the CSV read path (2026-09 profile)

A CPU profile of the CSV → RSF conversion (200,000×6 cells) found the
WASM parser itself was a small share of the time: the cost was on the
JavaScript side, **per field**, in the `FieldNode` object, a `subarray`
view, a bounded `Map` cache insert, and two `TextDecoder` calls (display
plus a strict undecodable check) — about 1 µs × 1.2 million fields. The
strict check is redundant whenever the whole file decodes cleanly
(structural bytes are ASCII and never split a character in any supported
encoding, as `hasUndecodableAnywhere` already relies on), and a short
ASCII field is cheaper to build by hand than to hand to `TextDecoder`.
Fixing those in JS took `RsfDocument.fromLossless` from ~1.42 s to
~0.39 s mean and a full value read of the same document from ~1.0–1.8 s to
~0.14 s on the same host.

Moving the decoding itself into Rust would not help: WebAssembly cannot
create JavaScript strings, so every string still crosses the boundary
through `TextDecoder`, and the per-call cost is exactly what dominated.
The one WASM-side change measured to pay off further is **fewer, larger
crossings**: decoding the whole buffer once and slicing it (~18 ms for the
same 1.2 million fields in a micro-benchmark, versus ~91 ms for the ASCII
fast path and ~171 ms for per-field `TextDecoder`). For a pure-ASCII file
byte offsets already equal string offsets; for anything else the parser
would have to emit a UTF-16 offset per field boundary, a change to the
`wasm/` index layout that needs the extra care and human review
`CLAUDE.md` requires. It also trades memory behavior — sliced strings keep
the whole decoded file alive — so it is recorded here as the next step to
take **if** profiling shows the remaining ~0.14 s mattering, not adopted.

The copy of the parse index out of WASM memory (`records`/`fields` as
fresh `Uint32Array`s) is the other visible WASM-side cost; reading them as
views into WASM memory would avoid it but makes every later memory growth
invalidate the arrays, which is not worth the risk at the measured size.

## WASM-offload candidates surveyed, not adopted (Issue #408)

A sweep of `src/core/` and `src/app/` for CPU-heavy JavaScript paths not
yet backed by `wasm/src/*.rs`. None were adopted; recorded so the same
ground isn't re-covered blind in a future pass. The two mechanisms already
in `wasm/src/ops.rs` (`aggregate` for selection statistics, `count_literal`
for long literal search) remain the only general-purpose data primitives
moved into the Rust core.

- **Column/range sort** (`src/core/sort.ts`) — the comparator calls back
  into JavaScript once per key per comparison via an injected
  `get(row, col)` closure; materializing every cell's displayed text
  first would cost more than the sort itself.
- **Filter row matching** (`src/core/filter.ts`, `computeHiddenRows`) — a
  linear scan of plain `includes`/`startsWith`/`===`/`Number()` comparisons
  per cell, no regex. Like `statsAggregate` (see the note in
  [performance-measurements.md](performance-measurements.md)), the cost is
  dominated by `Number()` parsing and string comparisons V8 already
  optimizes well, not by anything a Rust loop would meaningfully speed up;
  offloading it would hit the same `get(row, col)`-closure-per-cell problem
  as sort, at a larger call count.
- **`SUMIFS`/`COUNTIFS`/wildcard criteria matching**
  (`src/core/formula-functions.ts`, `src/core/formula-criteria.ts`) — the
  closest real candidate (~166–244 ms per 100,000 cells measured), but the
  values are `FormulaValue`s with error-propagation semantics, so only the
  comparison core could move to Rust while type dispatch stayed in JS —
  the same evaluator-language-split risk that keeps formula evaluation
  itself JS-only. **Revisit only if profiling shows a specific
  `SUMIFS`/`COUNTIFS`-heavy sheet exceeding its responsiveness budget.**
- **CSV/XLSX export quoting and escaping** — no benchmark suggests it's a
  bottleneck. One low-risk, performance-orthogonal cleanup surfaced here:
  `xlsx-export.ts` hand-rolls its own JS CRC-32 table instead of reusing
  the WASM compression module's CRC-32 export — a code-reuse opportunity,
  not a measured gain, worth a small separate Issue if pursued.
- **XLSX import XML parsing** — already reuses the WASM DEFLATE/CRC-32 for
  decompression; the remaining regex-based XML extraction needs to stay
  lenient JS.
- **Diff review** (`src/core/diff-engine.ts`) — `Map`-based row matching,
  already `O(baselineRows + currentRows)`, only runs on-demand.
- **Flash Fill** — inference runs only over tiny user-typed examples; too
  branchy (four distinct op kinds) to benefit from a tight Rust loop.
- **Column autofit and text wrapping** — dominated by canvas
  `measureText`, which needs the browser's font-shaping engine and cannot
  move to WASM at all.
- **SQL view** (`src/core/sql-engine.ts`) — already WASM-accelerated via
  the embedded sql.js engine; the remaining JS is security-critical logic
  that should stay simple and auditable.
