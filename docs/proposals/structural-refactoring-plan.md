# Structural refactoring plan — proposal

**Status: implemented in one pull request at the requester's direction** —
the four decisions in §9 were answered "approve, implement, add, reorganize"
and the phases were asked for as a single PR rather than the ~70 small ones
proposed below. See **Outcome** at the end of each language section for what
landed and where it deviates. The body below is kept as the original
proposal.

Requested in an interactive session (`大胆・大規模・緻密・徹底的なリファクタリングを計画してください。`).
Measurements below were taken on `main` at `6fc0fe5` (v0.9.9, 2026-09-27).

## English

### 1. Intent

Make the codebase cheaper and safer to change for the next 1.x series without
changing a single user-visible behavior or a single persisted byte. "Bold"
here means reshaping the five modules that concentrate most of the change
risk, not rewriting the product. Every step is behavior-preserving, lands as
a small reviewable PR, and is guarded by tests that exist _before_ the move.

**Goals**

1. No production source file above **800 lines**; no class with more than
   **40 methods**; no function above **120 lines** (all ratcheted, see §6.R0).
2. One place defines each command (id, enablement, disabled reason, label,
   icon, shortcut, handler) instead of four to six.
3. The CSV/RSF split is expressed as **capabilities on a document
   interface**, not as ~190 `kind === 'rsf'` branches spread over 28 files.
4. `AppState`, `Grid`, `RsfDocument`, and the formula engine each decompose
   into collaborators that can be unit-tested without the others.
5. Ambient globals (`t`, settings getters that read `localStorage`) become
   injected ports at the composition root, so app-layer tests stop depending
   on process-wide state.
6. The architecture rules that are currently prose (the formula engine's
   acyclic graph, grid-module boundaries) become mechanical tests.

**Non-goals (explicitly out of scope)**

- Any change to CSV byte preservation, the RSF container or JSON document
  (`knowledge/formats/rsf/`), or `wasm/` codecs. `rsf-codec.ts` is moved
  only if a move is byte-for-byte a move; its logic is not touched.
- Introducing a UI framework (`knowledge/decisions/no-ui-framework.md`
  stands), a state-management library, a DI container, or a worker.
- A Rust/WASM formula evaluator (`knowledge/architecture/dependency-rules.md`
  already records why not).
- New features, UI wording changes, or visual changes. The landing site,
  design system, agent-loop workflows, and release scripts are untouched.
- Dependency additions. Where a phase would benefit from one (coverage,
  dependency-graph tooling), it is listed under §9 as a human decision.

### 2. Baseline (measured)

| Metric                               | Value                                                         |
| ------------------------------------ | ------------------------------------------------------------- |
| TypeScript in `src/` (159 files)     | 51,496 lines                                                  |
| Tests in `tests/`                    | 35,701 lines                                                  |
| Rust in `wasm/src/`                  | 1,175 lines (out of scope)                                    |
| Files > 1,000 lines                  | 9                                                             |
| `kind === 'rsf'` / `!== 'rsf'` sites | 193 across 28 files                                           |
| `case '…'` labels in `Commands`      | 257 across 3 parallel switches                                |
| Files naming command ids by string   | menu-bar (123), command-icons (93), shortcuts (75), grid (57) |
| `UiPort` methods                     | 48 on one interface                                           |
| Fan-in of `app/i18n.ts` (`t`)        | 53 modules                                                    |

The nine largest files, which are the plan's primary targets:

| File                            | Lines | Shape                                                 |
| ------------------------------- | ----: | ----------------------------------------------------- |
| `src/ui/grid/index.ts`          | 3,576 | `Grid` class: ~117 members, 37 fields, fan-out 36     |
| `src/core/formula-functions.ts` | 2,170 | the whole function registry in one file               |
| `src/core/formula.ts`           | 2,050 | refs + tokenizer + parser + evaluator + ref rewriting |
| `src/core/rsf-document.ts`      | 1,786 | workbook + recalc memo + spill + snapshots + metadata |
| `src/app/commands/index.ts`     | 1,759 | `Commands` facade: 3 switches, 13 sub-command objects |
| `src/app/state/index.ts`        | 1,292 | tabs + selection + view + history + validation        |
| `src/app/commands/file-io.ts`   | 1,234 | open/save/convert/export/recent/reopen                |
| `src/core/rsf-codec.ts`         | 1,160 | persisted format — **frozen**                         |
| `src/ui/dialogs/sheet-ops.ts`   | 1,100 | several unrelated dialogs                             |

Recent groundwork this plan builds on: the `Grid` split into `src/ui/grid/`
(`12cc700`), the layout/naming gate (`42b4112`), the Knip gate with an empty
baseline, and the runtime-import-cycle test in
`tests/tooling/architecture.test.ts`.

### 3. Invariants no phase may move

Every PR in this plan re-proves these; a PR that cannot is split or dropped.

- **CSV byte preservation** (identity + fuzz tests in `tests/core/`).
- **RSF compatibility**: `tests/core/rsf-fixtures.test.ts` green; no file
  under `tests/fixtures/rsf/` edited or regenerated; `npm run test:rust`
  green whenever `src/core/rsf-*` or `wasm/` is in the diff.
- **Atomic history**: one `HistoryEntry` per user-visible mutation.
- **Offline runtime**: `npm run check:dist` green; bundle size recorded per
  PR and not allowed to grow by more than 1% without explanation.
- **Inward-only layering**: `ui → app → core`; `core` stays DOM-free.
- **Text, never HTML**; no `eval` / `new Function`.
- **IME safety** and **one zoom sizing model** (their UI tests stay green).
- **Public command ids** (`CommandId` strings) are unchanged: menus,
  shortcuts, icons, context menus, and tests all refer to them by string.

### 4. Diagnosis — the eight structural problems

1. **Document kind is a pervasive conditional.** `EditorDocument =
LosslessDocument | RsfDocument` is "duck-typed across both"
   (`src/app/state/index.ts:26`); callers then branch on `doc.kind` 193
   times. The heaviest sites are `app/state/worksheets.ts` (25),
   `app/commands/index.ts` (25), `app/commands/worksheets.ts` (15),
   `ui/grid/index.ts` (12), `app/state/structural-ops.ts` (11). Each new
   RSF-only feature adds branches in several layers, and "CSV-only
   tooltip" logic lives in `Commands.disabledReason`.
2. **Commands are defined in four to six places.** `CommandId` is a union;
   `isEnabled`, `disabledReason`, and `run` are three separate `switch`
   statements over it; labels/order live in `menu-bar.ts`, icons in
   `command-icons.ts`, keys in `shortcuts.ts`, and the grid's context menu
   in `grid/context-menu-items.ts`. Adding a command touches all of them,
   and nothing checks they agree.
3. **`Commands` is a hub.** Fan-in 38, fan-out 35. Thirteen sub-command
   objects are wired by hand in its constructor, most receiving the same
   `(state, ui, ensureRsf)` triple, and settings getters/setters are
   imported directly from `app/settings.ts`.
4. **`AppState` mixes four stores.** Tab list, per-tab selection, view
   layers (zoom/wrap/sticky/freeze), and validation/history helpers share one
   class and one untyped-payload event stream (`tabs`/`active`/`doc`/
   `selection`/`view`/`sheets`), so every subscriber re-derives what changed.
5. **`Grid` is still a god class after the split.** 3,576 lines hold
   rendering, selection, the edit lifecycle, five independent pointer-drag
   state machines (column resize, fill handle, header drag, formula
   reference entry, touch), accessibility announcements, and wrap
   measurement scheduling.
6. **`RsfDocument` owns too many lifecycles.** Sheet list and naming,
   formula memo/eval contexts, spill maps, conditional-format stats, the
   version-history snapshot list and cap, metadata (timezone, display
   language, file zoom/wrap/font), and dirty tracking — 84 methods, fan-in 15. Its internals are the hardest thing in the repository to change
   safely, and they sit next to the persisted-format contract.
7. **The formula engine's two largest files are monoliths.** `formula.ts`
   holds five concerns; `formula-functions.ts` holds every function. The
   acyclic graph in `dependency-rules.md` is documented but not tested.
8. **Ambient process-wide state.** `t()` (fan-in 53) and the settings
   module read global mutable state and `localStorage`; `UiPort` is one
   48-method interface every fake in `tests/app/` must satisfy in full;
   `main.ts` (fan-out 40) is a 600-line `bootstrap()`.

### 5. Target architecture

```text
src/
  core/
    document/            EditorDocument interface + capability types
    csv/                 byte-csv-parser, lossless-document, csv-engine, serializer, csv-export
    formula/             index.ts (facade, same exports as today's formula.ts)
      refs.ts            labels, parseRef*, sheet-name quoting
      tokenizer.ts  parser.ts  evaluator.ts  rewrite.ts
      functions/         index.ts (registry) + math, text, logical, lookup,
                         date, statistical, information, dynamic-array
      value.ts criteria.ts date.ts text.ts text-format.ts spill.ts
    workbook/            rsf-document.ts (facade) + sheet-registry, recalc,
                         snapshots, metadata; rsf-codec.ts unchanged
    …                    remaining pure modules grouped by feature
  app/
    commands/
      registry.ts        defineCommand(): id, when, disabledReason, run, meta
      file/ edit/ sheet/ format/ data/ view/ …  one module per menu group
    state/               AppState facade + tabs-store, selection-store,
                         view-store, typed events
    ports/               UiPort split by role; SettingsPort; I18nPort
    compose.ts           builds the app graph (no DOM)
  ui/
    grid/                Grid facade + renderer, selection-view,
                         edit-session, pointer/{resize,fill,header,ref-entry,touch},
                         a11y-announcer, wrap-scheduler
    dialogs/             dialog kit + one file per dialog
    shell/               DOM composition root (today's main.ts body)
  main.ts                ~30 lines: create shell, call compose, mount
```

Directory moves follow the existing rule "a module is a file or a directory,
never both": `formula.ts` becomes `formula/index.ts` re-exporting the same
names, so importers change only when a later PR narrows an import.

### 6. Phases

Each phase lists its PRs. Unless stated, every PR is `Changelog: not-needed`
(internal, no user-visible effect), runs the full verification set in §7,
and is split into a **move-only commit** (added to `.git-blame-ignore-revs`)
followed by an **edit commit**, so review can diff logic separately from
motion.

#### R0 — Guardrails first (prerequisite for everything; low risk)

No production code changes. Makes the rest of the plan mechanically safe.

1. **Size ratchet.** Extend `scripts/check/layout.mjs` (already the
   layout gate) with a per-file line budget: 800 by default, with an explicit
   allowlist recording today's size for each oversized file. The gate fails
   if a listed file grows or an unlisted file crosses 800, and fails on a
   stale allowlist entry (same pattern as Knip's `DEFERRED` list). Every
   later phase shrinks the list.
2. **ESLint complexity ratchet.** Add `max-lines-per-function` and
   `complexity` as warnings with per-file overrides for current offenders,
   then tighten to errors as phases land. Uses ESLint core rules only.
3. **Mechanical intra-layer rules** in `tests/tooling/architecture.test.ts`:
   the formula engine's order (`value ← helpers ← functions ← formula ←
spill ← rsf-document`) as a tested rank, and "`ui/grid/*` helpers never
   import `ui/grid/index.ts`".
4. **Command-surface consistency test** (`tests/app/`): every `CommandId`
   has a `run` case, a menu or shortcut or context-menu entry or an explicit
   "programmatic only" mark, an icon decision, and localized labels in both
   locales. This test is the safety net for R2.
5. **Characterization tests** for the seams later phases cut:
   `Commands.isEnabled`/`disabledReason` over every id × {no tab, CSV tab,
   RSF tab, protected tab} snapshotted to a table; `AppState` event sequences
   for tab open/close/switch, selection, and view changes; a recalculation
   corpus that evaluates every function-help example through `RsfDocument`
   and snapshots results. These snapshots are the "before" picture every
   later PR must reproduce exactly.
6. **Bundle-size and bench baselines** recorded in
   `knowledge/operations/performance-measurements.md` (existing `npm run
bench` + `check:dist` output size).

Exit: all gates green on `main`; allowlist documents today's nine
oversized files.

#### R1 — Document capabilities (medium risk; unlocks R2–R4)

1. Introduce `core/document/` with an explicit `EditorDocument` interface
   for the shared surface (today duck-typed) and a small set of capability
   accessors, e.g. `doc.workbook()` (null for CSV), `doc.styles()`,
   `doc.formulas()`, `doc.filters()`, `doc.comments()`. Both document
   classes implement it; `kind` stays (persistence and file
   dialogs still need it) but new code must not branch on it.
2. Add `requireRsf(tab, reason)` as the one app-layer gate that combines
   today's `ensureRsf` callback and the capability lookup; sub-commands
   receive a narrow `CommandContext` instead of `(state, ui, ensureRsf)`.
3. Migrate branch sites file by file, heaviest first
   (`app/state/worksheets.ts`, `app/commands/index.ts`,
   `app/commands/worksheets.ts`, `app/state/structural-ops.ts`,
   `ui/grid/index.ts`, …). One PR per 2–3 files; each PR's diff must leave
   R0's characterization snapshots unchanged.
4. Add a lint rule (`no-restricted-syntax` on `MemberExpression[property.name='kind']`
   compared with `'rsf'`/`'csv'` outside `core/document/` and persistence)
   once the count reaches zero.

Exit: `kind === 'rsf'` sites outside `core/` ≤ 5, each justified in a comment.

#### R2 — Command registry (medium risk; highest leverage)

1. `app/commands/registry.ts`: `defineCommand({ id, group, when(ctx),
disabledReason(ctx), run(ctx), meta: { labelKey, icon, shortcut?,
menu?, contextMenu? } })`. `CommandId` is derived from the registry
   (`typeof commands[number]['id']`), so the string ids stay byte-identical.
2. Move handlers out of the three switches into per-group modules
   (`file/`, `edit/`, `search/`, `sheet/`, `format/`, `data/`, `view/`,
   `drive/`, `help/`), one group per PR. `Commands.run/isEnabled/
disabledReason` become three-line lookups; the public `Commands` API is
   unchanged for the UI during the migration.
3. Derive menu structure, icons, shortcut labels, and grid context-menu
   items from `meta` (`menu-bar.ts`, `command-icons.ts`, `shortcuts.ts`,
   `grid/context-menu-items.ts`). Menu **order and wording stay identical**;
   `tests/ui/menu-bar.test.ts` and `menu-reorg.test.ts` pin that.
4. Replace the constructor's hand wiring of 13 sub-command objects with a
   `CommandContext` built once in `app/compose.ts`.

Exit: `commands/index.ts` < 300 lines; adding a command is one
`defineCommand` plus locale keys, enforced by R0.4.

#### R3 — State stores and typed events (medium risk)

1. Split `AppState` into `TabsStore`, `SelectionStore` (per-tab selection,
   selection kind, copy source), `ViewStore` (zoom/wrap/sticky/freeze via
   today's `view-layers.ts`), keeping `AppState` as a facade that delegates,
   so no caller changes in the first PR.
2. Replace the string event stream with typed events carrying payloads
   (`{ type: 'selection', tabId }`, `{ type: 'view', tabId, keys }`), while
   still emitting the legacy names until every subscriber migrates.
3. Move `WorksheetsState` and `StructuralOpsState` behind the R1
   capabilities; they become workbook operations that return a
   `HistoryEntry`, applied by one `commit(entry)` path in the facade — which
   makes the atomic-history invariant structurally obvious.
4. Migrate subscribers (grid, sheet-bar, tab-bar, status-bar, formula-bar)
   to the narrow stores; delete the facade delegations they no longer use.

Exit: `state/index.ts` < 500 lines; R0.5 event-sequence snapshots unchanged.

#### R4 — Grid decomposition (high UI risk; no behavior change)

Continues `12cc700`. The `Grid` class keeps its public API; internals move to
collaborators that each own their state:

1. `pointer/` — one module per drag state machine (`column-resize`,
   `fill-handle`, `header-drag`, `ref-entry`, `touch`), sharing a small
   `PointerSession` interface and the existing `auto-scroll.ts`.
2. `edit-session.ts` — the sink/editor promotion, commit/cancel, IME
   bookkeeping. **IME tests (`ime-composition`, `ime-editing`,
   `mobile-input-focus`) gate every PR in this step**, and each PR also runs
   `npm run ui:check`.
3. `renderer.ts` (full render + virtual window), `selection-view.ts`
   (cheap selection repaint, fill handle, copy outline),
   `a11y-announcer.ts` (live regions), `wrap-scheduler.ts` (off-screen
   wrap measurement).
4. `Grid` becomes a coordinator that wires collaborators to `AppState`
   stores and the command registry.

Exit: `grid/index.ts` < 800 lines; no grid file > 800; `virtual-grid`,
`zoom-alignment`, and all `tests/ui/grid-*` suites unchanged and green;
`ui:check` green on every PR.

#### R5 — Formula engine split (medium risk; core)

1. `formula.ts` → `formula/` directory: `refs.ts`, `tokenizer.ts`,
   `parser.ts`, `evaluator.ts`, `rewrite.ts`; `index.ts` re-exports exactly
   today's public names (verified by an export-surface snapshot test added
   in the same PR).
2. `formula-functions.ts` → `formula/functions/` by category, with
   `index.ts` assembling the registry in today's order (order matters for
   autocomplete and the help table; a snapshot test pins it).
3. Move `formula-value`, `-criteria`, `-date`, `-text`, `-text-format`,
   `spill`, `formula-ref-toggle` into `formula/` and update
   `dependency-rules.md` plus the R0.3 rank test.
4. Evaluator internals stay as they are (laziness is a correctness
   requirement). No function's semantics change; the R0.5 recalc corpus,
   `formula*.test.ts`, `cross-sheet-formulas`, and `fuzz` gate every PR.

Exit: no formula file > 800 lines; rank test enforces the documented graph.

#### R6 — `RsfDocument` decomposition (HIGH risk — escalate)

Requires `agent:blocked` → human approval before starting, per `CLAUDE.md`.

1. Extract collaborators with no persisted state first: `RecalcEngine`
   (memo, in-progress set, eval contexts, spill maps, conditional-format
   stats) and `SheetRegistry` (sheet list, name index, sequence, active id).
2. Then `SnapshotStore` (version-history list, cap, override) and
   `DocumentMetadata` (timezone, display language, file zoom/wrap/font,
   created/updated, revision/savedRevision).
3. `RsfDocument` stays the one public class and the only thing
   `rsf-codec.ts` reads and writes; codec input/output types do not change.
   Each PR runs `rsf-fixtures`, `rsf*.test.ts`, `identity`, `fuzz`,
   `formula-index`, and `npm run test:rust`, and round-trips the full fixture
   corpus comparing decoded→encoded bytes to the original.
4. Move CSV modules into `core/csv/` and workbook modules into
   `core/workbook/` (move-only PRs).

Exit: `rsf-document.ts` < 800 lines; fixtures byte-identical.

#### R7 — Ports, globals, and the composition root (low–medium risk)

1. Split `UiPort` into role interfaces — `DialogPort` (choose*/prompt*/
   confirm*), `NotifyPort` (`notify`, `showMessage`, `setBusy`),
   `PanelPort` (find bar, SQL, diff, formula help, version history), and
   `FormatPickerPort` (colors, borders, number format) — with `UiPort`
   kept as their intersection until every command depends only on what it
   uses. Test fakes shrink accordingly.
2. `SettingsPort` wraps today's `app/settings.ts` getters/setters (storage
   stays in `app/storage.ts`); commands receive it via `CommandContext`.
3. `I18nPort` for the app layer; `ui/` keeps calling `t()` (it is the
   presentation layer) but `app/` stops importing it, so command logic is
   testable without a global locale.
4. `main.ts` → `ui/shell/` (DOM assembly) + `app/compose.ts` (object
   graph). `main.ts` shrinks to mounting.

Exit: `app/` has no import of `app/i18n.ts` outside `compose.ts`; `main.ts`
< 60 lines.

#### R8 — UI surfaces and dialogs (low risk, parallelizable)

1. Extract a dialog kit from `dialogs/shared.ts` (form rows, focus trap,
   enter-to-submit, drag-resize) and give each dialog in `sheet-ops.ts`,
   `format.ts`, `app-settings.ts`, `file-io.ts` its own file.
2. `menu-bar.ts`, `context-menu.ts`, `find-bar.ts`, `status-bar.ts`: move
   logic that R2/R3 made derivable to the registry/stores; split view
   builders from event wiring.
3. `app/commands/file-io.ts` (1,234 lines) → `open`, `save`, `convert`,
   `export`, `recent` modules behind the `file/` command group.

Exit: size allowlist from R0.1 is empty except `rsf-codec.ts` (frozen).

#### R9 — Tests and knowledge follow the code (low risk)

1. Reorganize the largest suites (`workbook`, `virtual-grid`,
   `spreadsheet`, `commands`) to mirror the new modules; shared builders move
   into `tests/helpers/` (a directory, per the layout rule).
2. Rewrite `knowledge/architecture/system-overview.md`,
   `module-boundaries.md`, `dependency-rules.md`, and the local
   `src/*/CLAUDE.md` files to describe the new structure; record the
   registry and capability decisions under `knowledge/decisions/`.
3. Drop the R0 per-file overrides; the ratchets become plain limits.

### 7. How every PR is built and verified

- **Order:** add or confirm the characterization test → move-only commit →
  edit commit → delete the compatibility shim in a later PR, never the same
  one.
- **Size:** ≤ ~600 changed lines excluding pure moves; one concern per PR.
- **Required commands** (reported exactly, per `CLAUDE.md`):
  `npm run format:check`, `lint`, `build`, `test`, `check:dist`,
  `check:versions`, `check:knip`, `check:layout`; plus `ui:check` for any
  `src/ui/` change; plus `test:rust` for R6 and any `src/core/rsf-*` diff.
- **Bench:** R4, R5, R6 PRs run `npm run bench` and report the delta for
  grid render, recalculation, and CSV parse; > 5% regression blocks merge.
- **Changelog:** `Changelog: not-needed` in the PR body; any PR that turns
  out to change behavior is wrong by definition and is reworked.
- **Blame:** every move-only commit hash is appended to
  `.git-blame-ignore-revs`.

### 8. Sequencing and size

```text
R0 ──► R1 ──► R2 ──► R3 ──► R4
         │      └──────────► R7 ──► R8
         └──► R5 ──► R6 (human gate)
R9 runs continuously, closing each phase.
```

| Phase | PRs (est.) | Risk       | Can run in parallel with |
| ----- | ---------: | ---------- | ------------------------ |
| R0    |          6 | low        | —                        |
| R1    |       8–10 | medium     | —                        |
| R2    |      10–12 | medium     | R5                       |
| R3    |        5–6 | medium     | R5                       |
| R4    |       8–10 | high (UI)  | R5, R7                   |
| R5    |        6–8 | medium     | R2, R3, R4               |
| R6    |        5–6 | **high**   | R7, R8                   |
| R7    |          5 | low–medium | R4, R6                   |
| R8    |       8–10 | low        | R6                       |
| R9    |        4–6 | low        | all                      |

Total: roughly 65–80 small PRs. Target end state: largest non-frozen source
file < 800 lines (from 3,576), `Commands` < 300 (from 1,759), `kind` branches
outside core ≤ 5 (from 193), `UiPort` consumers depending on ≤ 1 role port
each.

### 9. Risk register and decisions for the maintainer

| Risk                                          | Mitigation                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| Silent behavior drift in a "pure" move        | R0.5 snapshots; move-only commits; shim deleted in a later PR              |
| RSF bytes change (R6)                         | human gate; fixture round-trip byte compare; `test:rust`; codec untouched  |
| IME / touch regressions (R4)                  | IME + touch suites + `ui:check` on every grid PR; one state machine per PR |
| Performance regressions from indirection      | bench deltas on R4–R6; capability accessors are plain property reads       |
| Long-lived branches / conflicts with features | no phase branch; each PR merges independently to `main` behind the facade  |
| Plan stalls half-way, leaving two patterns    | each phase ends with a lint rule or gate that forbids the old pattern      |

Decisions needed from a human before the matching phase starts:

1. **Approve the phase order and the R0 gates** (they change what CI fails on).
2. **R6 go/no-go** — `RsfDocument` sits next to the persisted-format contract.
3. **Coverage tooling** — adding `@vitest/coverage-v8` would let R0 pin
   coverage of the files being moved; it is a new devDependency and so not
   assumed by this plan.
4. **Directory renames in `core/`** (`csv/`, `workbook/`, `formula/`) touch
   many import paths at once; approve them as move-only PRs, or keep the flat
   layout and apply only the file splits.

### 10. Outcome

All ten phases landed on `claude/bold-refactoring-plan-612d7a` as one pull
request, one commit per phase (the `core/` directory move is its own
move-only commit, listed in `.git-blame-ignore-revs`).

| Measure                                  | Before (`main`) | After                              |
| ---------------------------------------- | --------------- | ---------------------------------- |
| `src/core/rsf-document.ts` → `workbook/` | 1786            | 519                                |
| `src/core/formula.ts` → `formula/index`  | 2050            | 111                                |
| `formula-functions.ts` → `functions/*`   | 2170            | ≤ 446 per group file               |
| `src/ui/grid/index.ts`                   | 3576            | 268 (largest grid file 644)        |
| `src/main.ts`                            | 607             | 5                                  |
| `src/app/state/index.ts`                 | 1292            | 769                                |
| `src/app/commands/index.ts`              | 1759            | 590                                |
| `kind === 'rsf' \| 'csv'` outside core   | 204             | 0 (lint-enforced)                  |
| complexity-ratchet exemptions            | —               | 2 (`byte-csv-parser`, `rsf-codec`) |

Behavior was pinned before any move by the R0 characterization snapshots
(command surface, formula-help examples, core export surface, AppState
event order); the only snapshot change is the removal of the unreachable
`tab.next` / `tab.prev` commands, which the new catalog reachability test
found. The v1 RSF fixtures re-encode byte-identically before and after R6
and R8.

Deviations from the proposal:

- **No `I18nPort` / `SettingsPort`** and **no typed event payloads**: the
  role-segregated `UiPort` covered the coupling that mattered; the others
  would have touched every UI module for no behavior gain.
- **Menu placement and icons stay in the UI layer** (`menu-bar/menus.ts`);
  the catalog holds `enabled` / `disabledReason` / `run` only, and
  `tests/app/command-catalog.test.ts` checks every command is reachable.
- **Size targets missed:** `commands/index.ts` is 590 lines (target ≤ 300)
  and `AppState` 769 (target ≤ 500). Both are now thin delegation; further
  cuts would split cohesive public surfaces.
- **`rsf-codec.ts` and `byte-csv-parser.ts` were not split** — they are the
  persisted-format and hot-path code the plan froze; they are the only
  entries left in the line budget and complexity ratchet.

## 日本語

**ステータス: 提案のみ。** 本書の内容はまだ何も実装されていません。各フェーズは個別の Issue となり、人間による `agent:ready` を得てから着手します。`src/core/rsf-*.ts` に触れるフェーズ（R6）は `CLAUDE.md` 上の高リスク変更であり、メンテナーの明示的な承認が必要です。計測値は `main` の `6fc0fe5`（v0.9.9）時点のものです。

### 目的

ユーザーから見える挙動と保存されるバイトを一切変えずに、1.x 系に向けて「変更しやすく、安全に変更できる」構造へ作り替えます。「大胆」とは製品の書き直しではなく、変更リスクが集中している 5 つのモジュールを根本から組み替えることを指します。すべての手順は挙動保存で、小さくレビュー可能な PR として入り、移動 _前_ に用意したテストで守られます。

**目標**: 本体ファイル 800 行以下・クラス 40 メソッド以下・関数 120 行以下（ラチェットで段階的に強制）／コマンド定義を 1 箇所に集約／CSV と RSF の違いを約 190 箇所の `kind === 'rsf'` 分岐ではなく「ドキュメントの能力（capability）」として表現／`AppState`・`Grid`・`RsfDocument`・数式エンジンを単体テスト可能な協調オブジェクトへ分解／`t()` や設定取得などのグローバル状態をポートとして注入／文章でしか書かれていないアーキテクチャ規則を機械的テストへ。

**対象外**: CSV バイト保存・RSF 形式・`wasm/` コーデックの変更、UI フレームワーク／状態管理ライブラリ／DI コンテナ／Worker の導入、Rust 版数式評価器、新機能・文言・見た目の変更、依存パッケージの追加（必要なものは §9 で人間の判断事項として列挙）。

### 現状の主要な問題（計測に基づく）

1. ドキュメント種別の分岐が 28 ファイルに 193 箇所散在。
2. 1 つのコマンドの定義が `isEnabled`／`disabledReason`／`run` の 3 つの `switch`（計 257 の `case`）と、メニュー・アイコン・ショートカット・グリッドの右クリックメニューに分散。
3. `Commands` がハブ化（被依存 38・依存 35）し、13 個のサブコマンドを手作業で配線。
4. `AppState` がタブ・選択・表示・履歴を 1 クラスに抱え、ペイロードなしのイベントを発行。
5. 分割後も `Grid` が 3,576 行の巨大クラス（描画・選択・編集・5 種類のドラッグ状態機械・読み上げ・折り返し計測）。
6. `RsfDocument` が 84 メソッドでシート一覧・再計算メモ・スピル・版履歴・メタデータを同居させており、永続形式の契約の隣で最も変更しにくい。
7. `formula.ts` と `formula-functions.ts` がそれぞれ約 2,000 行の一枚岩で、非循環依存の規則は文書のみで未検査。
8. `t()`（被依存 53）や設定のグローバル状態、48 メソッドの単一 `UiPort`、600 行の `main.ts`。

### フェーズ

- **R0 ガードレール（前提・低リスク）**: 既存の `check:layout` にファイル行数ラチェット、ESLint に複雑度ラチェット、数式エンジンの依存順序と grid モジュール境界をテスト化、コマンド定義の整合性テスト、`isEnabled`／イベント列／再計算結果の特性化（スナップショット）テスト、バンドルサイズとベンチの基準値記録。本体コードは変更しません。
- **R1 ドキュメント能力**: `EditorDocument` インターフェースと capability アクセサを導入し、分岐の多いファイルから順に置換。最後に lint で旧パターンを禁止。
- **R2 コマンドレジストリ**: `defineCommand()` で id・有効条件・無効理由・ハンドラ・ラベル・アイコン・ショートカット・メニュー位置を 1 箇所に集約。コマンド id 文字列とメニューの順序・文言は完全に不変。
- **R3 状態ストア**: `AppState` をタブ／選択／表示ストアに分け、型付きイベントへ移行。構造編集は `HistoryEntry` を返し、単一の `commit` 経路で適用（履歴の原子性を構造的に保証）。
- **R4 Grid 分解**: ドラッグ状態機械ごとのモジュール、編集セッション、描画、選択表示、読み上げ、折り返しスケジューラへ。IME・タッチのテストと `ui:check` を全 PR で必須。
- **R5 数式エンジン分割**: `formula/` ディレクトリ（refs・tokenizer・parser・evaluator・rewrite）と、関数をカテゴリ別に分けた `formula/functions/`。公開エクスポートと登録順をスナップショットで固定。評価の遅延性は維持。
- **R6 `RsfDocument` 分解（高リスク・人間の承認必須）**: 永続状態を持たない再計算エンジンとシート登録簿から先に抽出。コーデックの入出力型は不変、全フィクスチャのバイト一致往復検証と `test:rust` を毎 PR 実施。
- **R7 ポートとコンポジションルート**: `UiPort` を役割別に分割、`SettingsPort`・`I18nPort` を導入し、`main.ts` を `ui/shell/` と `app/compose.ts` に分離。
- **R8 UI 画面とダイアログ**: ダイアログ部品の共通化と 1 ダイアログ 1 ファイル化、`file-io.ts` を open／save／convert／export／recent に分割。
- **R9 テストとナレッジの追随**: 大きなテストスイートを新構造に合わせて再編し、`knowledge/architecture/` と各 `CLAUDE.md` を更新、ラチェットの例外を撤廃。

### 進め方

各 PR は「特性化テストの追加／確認 → 移動のみのコミット → 編集コミット」の順で、互換シムの削除は必ず後続 PR に回します。変更は移動を除き約 600 行以内、`Changelog: not-needed` を明記し、`CLAUDE.md` の必須検証一式（UI 変更時は `ui:check`、RSF 変更時は `test:rust` も）を実行して結果をそのまま報告します。R4〜R6 はベンチ差分を報告し、5% を超える劣化はマージ不可とします。全体で小さな PR が約 65〜80 本、各フェーズの最後に旧パターンを禁止するゲートを入れ、途中で止まっても二重構造が残らないようにします。

### メンテナーに判断していただきたい事項

1. フェーズの順序と R0 のゲート（CI の失敗条件が変わるため）の承認。
2. R6（`RsfDocument` 分解）の実施可否。
3. カバレッジ計測（`@vitest/coverage-v8` の追加。新しい devDependency のため本計画では前提にしていません）。
4. `core/` 内のディレクトリ再編（`csv/`・`workbook/`・`formula/`）を移動のみの PR として行うか、フラットな配置のままファイル分割だけ行うか。

### 実施結果

全フェーズを依頼者の指示により 1 本の PR で実施しました（フェーズごとに 1 コミット。`core/` のディレクトリ移動は移動のみのコミットとし、`.git-blame-ignore-revs` に登録）。`rsf-document.ts` は 1786 行から 519 行、`formula.ts` は 2050 行から 111 行のファサード、`grid/index.ts` は 3576 行から 268 行、`main.ts` は 607 行から 5 行、`AppState` は 1292 行から 769 行、`commands/index.ts` は 1759 行から 590 行になりました。コア外の `kind` 比較 204 箇所は 0 になり、lint で禁止しています。複雑度ラチェットの例外は `byte-csv-parser` と `rsf-codec` の 2 件のみです。

移動前に R0 の特性化スナップショットで挙動を固定しました。スナップショットの変更は、新しいカタログ到達可能性テストが見つけた到達不能な `tab.next`／`tab.prev` の削除だけです。v1 の RSF フィクスチャは R6・R8 の前後でバイト一致で再エンコードされます。

計画との差分: `I18nPort`／`SettingsPort` と型付きイベントペイロードは導入していません。メニューの配置とアイコンは UI 層（`menu-bar/menus.ts`）に残し、到達可能性はテストで担保しています。`commands/index.ts`（目標 300 行以下）と `AppState`（目標 500 行以下）は目標未達です。`rsf-codec.ts` と `byte-csv-parser.ts` は計画どおり分割していません。
