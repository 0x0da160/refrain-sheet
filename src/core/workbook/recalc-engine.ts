// SPDX-License-Identifier: MIT
/**
 * The workbook's recalculation engine: formula evaluation, the workbook-wide
 * memo, dynamic-array spill placement, the volatile-function clock, and the
 * cached statistics conditional formatting reads.
 *
 * It is owned by `RsfDocument` and reads the workbook only through
 * {@link RecalcHost}, so the workbook keeps sole ownership of its worksheets
 * and persisted settings while every derived (never persisted) value lives
 * here. The rules it implements are documented on `RsfDocument` and in
 * knowledge/architecture/invariants.md ("Workbook-wide recalculation"):
 * results are recomputed lazily on next access and there is no timer. A
 * change to one cell's input drops the results that can read that cell
 * ({@link invalidate} with the cell, see `recalc-dependents.ts`); any other
 * mutation, and any workbook the narrow rule does not cover, drops
 * everything.
 */
import {
  errorValue,
  evaluateAst,
  evaluateAstArray,
  isFormula,
  literalToValue,
  type EvalContext,
} from '../formula';
import { dropCachedRanges } from '../formula/evaluator';
import {
  buildSpillMap,
  cellKey,
  EMPTY_SPILL_MAP,
  isEmptySpillMap,
  type SpillAnchor,
  type SpillMap,
} from '../formula/spill';
import type { ColumnData, FormulaValue, ValueGrid } from '../formula/value';
import { CellMemo } from './cell-memo';
import { ColumnStore } from './column-store';
import {
  colorScaleColor,
  colorScaleRange,
  duplicateKey,
  findDuplicateKeys,
  matchesCellValueRule,
  type CellConditionalFormat,
  type ConditionalFormatStyle,
} from './conditional-format';
import type { DisplayLanguageId } from './display-language';
import type { FormulaRun } from './formula-runs';
import { type CellRect, formulaCellsReading } from './recalc-dependents';
import { timeZoneOffsetMs } from './timezone';
import type { Worksheet } from './worksheet';

/** What the engine reads from the workbook that owns it. */
export interface RecalcHost {
  /** Every worksheet, in display order. */
  readonly sheets: readonly Worksheet[];
  /** Resolve a worksheet by display name (case-insensitive), for cross-sheet references. */
  sheetByName(name: string): Worksheet | null;
  /** The workbook's IANA timezone, read by `TODAY()`/`NOW()`. */
  readonly timezone: string;
  /** The workbook's display language, read by `TEXT()`. */
  readonly displayLanguage: DisplayLanguageId;
  /** The workbook's revision counter, which keys the conditional-format statistics cache. */
  readonly revisionCounter: number;
}

/** One cell whose input changed: the only kind of mutation the engine can follow narrowly. */
export interface CellChange {
  sheet: Worksheet;
  row: number;
  col: number;
}

/** Cached per-rule statistics — see {@link RecalcEngine.conditionalFormatStats}. */
type ConditionalFormatRuleStats =
  { kind: 'duplicate'; keys: Set<string> } | { kind: 'colorScale'; min: number; max: number };

/** Stands in the memo for a cell that is being evaluated; reading it is a circular reference. */
const EVALUATING: FormulaValue = { type: 'error', code: '#CYCLE!' };

/**
 * Cell changes followed one by one before the engine gives up and drops
 * everything: a paste or fill of this many cells is cheaper to recompute than
 * to trace.
 */
const MAX_TRACKED_CHANGES = 2000;

/** Run checks one narrow invalidation may spend (see `formulaCellsReading`). */
const DEPENDENT_SEARCH_BUDGET = 2_000_000;

export class RecalcEngine {
  /**
   * Workbook-wide evaluation memo, per worksheet. Dropped whole by any
   * mutation that is not a plain cell change (see {@link invalidate}),
   * because a cross-sheet reference means a change in one worksheet can
   * invalidate a formula in another.
   */
  private memo = new Map<Worksheet, CellMemo<FormulaValue>>();
  /** Array formulas being evaluated for the spill maps; a re-entry is a circular reference. */
  private readonly spilling = new Set<string>();
  /** Per-worksheet evaluation contexts, rebuilt after any full invalidation. */
  private evalContexts = new Map<Worksheet, EvalContext>();
  /** Typed copies of the columns long ranges scan (see `column-store.ts`), per worksheet and column. */
  private columns = new Map<Worksheet, Array<ColumnStore | undefined>>();
  /**
   * Cell changes since the last evaluation, not yet applied to the memo.
   * Applying them is deferred to the next read ({@link settle}), so a burst
   * of edits is traced once.
   */
  private changes: CellChange[] = [];
  /** When the latest of {@link changes} was made: the instant the clock advances to. */
  private changedAt = 0;
  /**
   * True once an evaluation met a circular reference since the memo was last
   * dropped whole. What a cell on a cycle shows depends on which cell was
   * asked first, so results kept across a change could differ from a fresh
   * recalculation; with this set, the next change drops everything, exactly
   * as every change used to.
   */
  private sawCycle = false;

  /**
   * Per-worksheet dynamic-array spill maps, rebuilt lazily after any mutation.
   * Null means "not built yet"; see {@link spillFor}. Derived spill values are
   * never stored in a worksheet and never written to a `.rsf` file — they are
   * recomputed from the anchor formulas, which is what makes undo/redo,
   * structural edits, and persistence need no spill-specific handling.
   */
  private spillMaps: Map<string, SpillMap> | null = null;
  /**
   * True while the spill maps are being built. Derived-cell lookups read as
   * blank during that window, which is the documented rule that a
   * dynamic-array formula cannot see another spill's output — and is what
   * makes the build terminate.
   */
  private buildingSpill = false;

  /**
   * Per-rule cached statistics for `colorScale`/`duplicate` conditional-format
   * rules (the range's numeric min/max, or its set of duplicate keys), keyed
   * by the rule object itself and the workbook `revision` at computation
   * time. Recomputed lazily on first use after any value-changing mutation —
   * a style-only or filter-only change bumps `revision` too, so it costs one
   * harmless extra recompute rather than risking a stale stat. Never
   * persisted, like the rules themselves.
   */
  private conditionalFormatStats = new WeakMap<
    CellConditionalFormat,
    { revision: number; stats: ConditionalFormatRuleStats }
  >();

  /**
   * The clock every volatile function (`TODAY`, `NOW`) in this workbook reads,
   * fixed so that all of them agree within one recalculation.
   *
   * It advances at exactly three moments: when the workbook is created or
   * loaded, on any mutation (which invalidates every volatile formula and
   * whatever reads it), and when {@link recalculate} is called explicitly.
   * There is deliberately **no background timer**: an idle workbook never
   * recalculates on its own, so a left-open tab cannot burn CPU or make a
   * document appear to change by itself.
   */
  private clockMs = Date.now();

  constructor(private readonly host: RecalcHost) {}

  /**
   * Drop the derived values a mutation may have changed. A mutation is a
   * recalculation event, so volatile functions advance here too.
   *
   * With `change` — one cell's input was replaced, nothing else — only what
   * can read that cell is dropped, on the next evaluation ({@link settle}).
   * Without it everything is dropped. Either way the spill maps and results
   * are rebuilt lazily, so a burst of edits costs one rebuild rather than one
   * per edit.
   */
  invalidate(change?: CellChange): void {
    if (change && this.changes.length < MAX_TRACKED_CHANGES) {
      this.changes.push(change);
      this.changedAt = Date.now();
    } else {
      this.recalculate();
    }
  }

  /**
   * Recompute everything, advancing the clock the volatile functions read.
   * No timer exists, so this (and {@link invalidate}) is the only way a
   * `TODAY()` in an untouched workbook changes.
   */
  recalculate(): void {
    this.dropAll(Date.now());
  }

  /** Drop every derived value and set the clock to `now`. */
  private dropAll(now: number): void {
    this.clockMs = now;
    this.memo = new Map();
    this.evalContexts = new Map();
    this.columns = new Map();
    this.changes = [];
    this.sawCycle = false;
    this.spillMaps = null;
  }

  /**
   * Apply the cell changes recorded since the last evaluation: drop exactly
   * the results that can read a changed cell, or everything when the
   * workbook is one the narrow rule does not cover.
   *
   * The narrow rule covers a workbook whose every formula result is a pure
   * function of the cells it names: no dynamic array placed or blocked (a
   * spill's reach depends on which cells are empty) — before the change and,
   * checked on the formulas the change reaches, after it ({@link spillsIn});
   * no circular reference seen (see {@link sawCycle}); and no formula outside
   * the run index. Volatile formulas are handled inside it: each one counts
   * as changed on every mutation, which is what "the clock advances on any
   * mutation" means.
   */
  private settle(): void {
    const changes = this.changes;
    this.changes = [];
    if (!this.spillMaps) {
      // Nothing has been evaluated since everything was last dropped.
      this.dropAll(this.changedAt);
      return;
    }
    let narrow = !this.sawCycle;
    const changed: CellRect[] = changes.map(({ sheet, row, col }) => ({
      sheet,
      top: row,
      bottom: row,
      left: col,
      right: col,
    }));
    for (const sheet of this.host.sheets) {
      narrow &&=
        !sheet.formulas.hasStrays && isEmptySpillMap(this.spillMaps.get(sheet.id) ?? EMPTY_SPILL_MAP);
      for (const column of narrow ? sheet.formulas.runs() : []) {
        for (const run of column) {
          if (run.template.volatile) {
            changed.push({ sheet, top: run.start, bottom: run.end, left: run.col, right: run.col });
          }
        }
      }
    }
    const reached = narrow
      ? formulaCellsReading(
          changed,
          this.host.sheets,
          (name) => this.host.sheetByName(name),
          DEPENDENT_SEARCH_BUDGET,
        )
      : null;
    if (!reached) {
      this.dropAll(this.changedAt);
      return;
    }
    const stale = changed.concat(reached);
    this.clockMs = this.changedAt;
    for (const [sheet, ctx] of this.evalContexts) {
      ctx.nowMs = this.nowFor();
      dropCachedRanges(ctx, (name, top, bottom, left, right) => {
        const target = name === undefined ? sheet : this.host.sheetByName(name);
        return stale.some(
          (rect) =>
            rect.sheet === target &&
            rect.top <= bottom &&
            rect.bottom >= top &&
            rect.left <= right &&
            rect.right >= left,
        );
      });
    }
    for (const rect of stale) {
      const memo = this.memo.get(rect.sheet);
      const stores = this.columns.get(rect.sheet);
      for (let col = rect.left; col <= rect.right; col++) {
        memo?.clearRows(col, rect.top, rect.bottom);
        stores?.[col]?.invalidate(rect.top, rect.bottom);
      }
    }
    if (this.spillsIn(stale)) {
      this.dropAll(this.changedAt);
    }
  }

  /**
   * True when a formula in `stale` now returns an array, so the (empty) spill
   * maps no longer describe the workbook — or when finding that out met a
   * circular reference, after which nothing kept can be trusted either.
   *
   * Only formulas that could return an array at all are evaluated (`IFERROR`
   * and `INDEX` can, so this is what lets a workbook that uses them without
   * ever spilling be followed narrowly), and only the ones the change
   * reached: every other formula reads no changed cell, so it still returns
   * what it returned when the maps were built.
   */
  private spillsIn(stale: readonly CellRect[]): boolean {
    for (const { sheet, top, bottom, left, right } of stale) {
      for (let col = left; col <= right; col++) {
        for (const run of sheet.formulas.runsBetween(col, top, bottom)) {
          const parsed = run.template.parsed;
          if (!run.template.canSpill || !parsed.ok) {
            continue;
          }
          const last = Math.min(run.end, bottom);
          for (let row = Math.max(run.start, top); row <= last; row++) {
            const key = `${sheet.id}|${row},${col}`;
            this.spilling.add(key);
            try {
              const { grid } = evaluateAstArray(parsed.ast, this.contextFor(sheet), row - run.baseRow);
              if (grid || this.sawCycle) {
                return true;
              }
            } finally {
              this.spilling.delete(key);
            }
          }
        }
      }
    }
    return false;
  }

  /** The volatile functions' clock, in the workbook's timezone (see {@link contextFor}). */
  private nowFor(): number {
    return this.clockMs + timeZoneOffsetMs(this.clockMs, this.host.timezone);
  }

  // ----- Evaluation -----

  /**
   * Evaluate a cell on a worksheet. Formula results are memoized until a
   * mutation that can change them; circular references — including ones that
   * travel through another worksheet — resolve to #CYCLE! instead of
   * recursing forever.
   */
  evaluate(sheet: Worksheet, row: number, col: number): FormulaValue {
    if (this.changes.length > 0) {
      this.settle();
    }
    return this.read(sheet, row, col);
  }

  /** {@link evaluate} once the recorded changes are applied (every nested read comes here). */
  private read(sheet: Worksheet, row: number, col: number): FormulaValue {
    if (!sheet.contains(row, col)) {
      // References outside the worksheet behave like empty cells.
      return { type: 'empty' };
    }
    const input = sheet.getValue(row, col);
    if (!isFormula(input)) {
      return input === ''
        ? (this.derivedValue(sheet, row, col) ?? literalToValue(input))
        : literalToValue(input);
    }
    // A formula that produced an array reads its result from the spill map,
    // which already holds it: re-evaluating here could disagree with what the
    // derived cells show.
    const spill = this.spillFor(sheet);
    if (!isEmptySpillMap(spill)) {
      const key = cellKey(row, col);
      if (spill.blocked.has(key)) {
        return errorValue('#SPILL!');
      }
      const anchor = spill.anchors.get(key);
      if (anchor) {
        return anchor.grid.cells[0][0];
      }
    }
    const memo = this.memoFor(sheet);
    const cached = memo.get(row, col);
    if (cached !== undefined) {
      if (cached === EVALUATING) {
        this.sawCycle = true;
        return errorValue('#CYCLE!');
      }
      return cached;
    }
    if (this.spilling.size > 0 && this.spilling.has(`${sheet.id}|${row},${col}`)) {
      this.sawCycle = true;
      return errorValue('#CYCLE!');
    }
    // A filled-down formula shares the parsed form of the run it belongs to,
    // evaluated for this cell's row (see formula-runs.ts).
    const run = sheet.formulas.runAt(row, col);
    const parsed = run ? run.template.parsed : sheet.formulas.stray(row, col, input);
    let result: FormulaValue;
    if (!parsed.ok) {
      result = errorValue(parsed.code);
    } else {
      memo.set(row, col, EVALUATING);
      try {
        result = evaluateAst(parsed.ast, this.contextFor(sheet), run ? row - run.baseRow : 0);
      } catch (err) {
        memo.set(row, col, undefined);
        throw err;
      }
    }
    memo.set(row, col, result);
    return result;
  }

  private memoFor(sheet: Worksheet): CellMemo<FormulaValue> {
    let memo = this.memo.get(sheet);
    if (!memo) {
      memo = new CellMemo();
      this.memo.set(sheet, memo);
    }
    return memo;
  }

  /** The dynamic-array value an empty cell carries, if a spill covers it. */
  private derivedValue(sheet: Worksheet, row: number, col: number): FormulaValue | null {
    const spill = this.spillFor(sheet);
    if (spill.derived.size === 0) {
      return null;
    }
    const anchorKey = spill.derived.get(cellKey(row, col));
    if (anchorKey === undefined) {
      return null;
    }
    const anchor = spill.anchors.get(anchorKey);
    return anchor ? anchor.grid.cells[row - anchor.row][col - anchor.col] : null;
  }

  /**
   * The evaluation context for one worksheet: unqualified references resolve
   * against it, and worksheet-qualified references resolve by name through the
   * workbook — sharing this workbook's memo, which is what makes
   * cross-worksheet cycles detectable.
   */
  private contextFor(sheet: Worksheet): EvalContext {
    const existing = this.evalContexts.get(sheet);
    if (existing) {
      return existing;
    }
    const ctx: EvalContext = {
      getCell: (r, c) => this.read(sheet, r, c),
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      getSheetCell: (name, r, c) => {
        const target = this.host.sheetByName(name);
        return target ? this.read(target, r, c) : errorValue('#REF!');
      },
      getSheetBounds: (name) => {
        const target = this.host.sheetByName(name);
        return target ? { rowCount: target.rowCount, columnCount: target.columnCount } : null;
      },
      // Shifted by the workbook's own timezone offset (0 for UTC) before it
      // ever reaches formula/date.ts, which does pure UTC math on whatever
      // instant it is handed — see that module's "Timezone policy".
      nowMs: this.nowFor(),
      displayLanguage: this.host.displayLanguage,
      readColumn: (name, col, top, bottom) => {
        const target = name === undefined ? sheet : this.host.sheetByName(name);
        return target ? this.columnOf(target, col, top, bottom) : null;
      },
    };
    this.evalContexts.set(sheet, ctx);
    return ctx;
  }

  /** Rows `top..bottom` of one worksheet column as typed arrays (see `column-store.ts`). */
  private columnOf(sheet: Worksheet, col: number, top: number, bottom: number): ColumnData | null {
    if (col >= sheet.columnCount || this.buildingSpill) {
      return null;
    }
    let stores = this.columns.get(sheet);
    if (!stores) {
      stores = [];
      this.columns.set(sheet, stores);
    }
    const store = (stores[col] ??= new ColumnStore(sheet.rowCount));
    return store.view(top, bottom, (row) => this.read(sheet, row, col));
  }

  // ----- Dynamic arrays (spill) -----

  /**
   * The spill map of a worksheet, built on first use after a mutation.
   *
   * While a build is in progress this returns the empty map, which implements
   * the documented rule that a dynamic-array formula reads other spills'
   * derived cells as blank — and, more importantly, is what stops the build
   * from re-entering itself.
   */
  private spillFor(sheet: Worksheet): SpillMap {
    if (this.buildingSpill) {
      return EMPTY_SPILL_MAP;
    }
    if (!this.spillMaps) {
      this.buildSpillMaps();
    }
    return this.spillMaps?.get(sheet.id) ?? EMPTY_SPILL_MAP;
  }

  /** {@link spillFor} for a caller outside evaluation: recorded changes are applied first. */
  private settledSpillFor(sheet: Worksheet): SpillMap {
    if (this.changes.length > 0) {
      this.settle();
    }
    return this.spillFor(sheet);
  }

  /**
   * Evaluate every array formula in the workbook and place the results.
   *
   * Anchors are evaluated first, all of them, and only then placed, so the
   * outcome cannot depend on the order two spills happen to appear in.
   * Afterwards the memo is dropped: entries computed during the build saw no
   * spill map, and every ordinary formula must see the finished one. The
   * evaluation contexts are dropped alongside it — the evaluator caches
   * materialized range grids per context, and a range read during the build
   * saw the same spill-blind view, so its context must not survive to be
   * reused (and its stale grids served) by evaluation after the build.
   */
  private buildSpillMaps(): void {
    this.buildingSpill = true;
    const maps = new Map<string, SpillMap>();
    try {
      for (const sheet of this.host.sheets) {
        maps.set(
          sheet.id,
          buildSpillMap({
            rowCount: sheet.rowCount,
            columnCount: sheet.columnCount,
            getValue: (r, c) => sheet.getValue(r, c),
            listArrayResults: () => this.evaluateArrayFormulas(sheet),
          }),
        );
      }
    } finally {
      this.buildingSpill = false;
    }
    this.memo = new Map();
    this.evalContexts = new Map();
    this.columns = new Map();
    this.spillMaps = maps;
  }

  /**
   * The array results of one worksheet's formulas, in row-major order.
   *
   * `canSpill` rejects any formula that cannot possibly return an array
   * before it is evaluated. It is asked once per run of filled-down formulas
   * (see formula-runs.ts), so a worksheet of ordinary formulas costs one
   * cheap AST walk per distinct formula and no evaluation at all.
   */
  private evaluateArrayFormulas(
    sheet: Worksheet,
  ): Array<{ row: number; col: number; grid: ValueGrid | null }> {
    const cells: Array<{ row: number; run: FormulaRun }> = [];
    for (const runs of sheet.formulas.runs()) {
      for (const run of runs) {
        if (run.template.canSpill && run.template.parsed.ok) {
          for (let row = run.start; row <= run.end; row++) {
            cells.push({ row, run });
          }
        }
      }
    }
    cells.sort((a, b) => a.row - b.row || a.run.col - b.run.col);
    const out: Array<{ row: number; col: number; grid: ValueGrid | null }> = [];
    for (const { row, run } of cells) {
      const parsed = run.template.parsed;
      if (!parsed.ok) {
        continue;
      }
      // An in-progress guard like ordinary evaluation's, so a self-
      // referential array formula resolves to #CYCLE! instead of recursing.
      const key = `${sheet.id}|${row},${run.col}`;
      if (this.spilling.has(key)) {
        continue;
      }
      this.spilling.add(key);
      try {
        const { grid } = evaluateAstArray(parsed.ast, this.contextFor(sheet), row - run.baseRow);
        out.push({ row, col: run.col, grid });
      } finally {
        this.spilling.delete(key);
      }
    }
    return out;
  }

  /** The spill anchor covering a cell, whether the cell is the anchor or derived. */
  spillAnchorAt(sheet: Worksheet, row: number, col: number): SpillAnchor | null {
    const spill = this.settledSpillFor(sheet);
    const key = cellKey(row, col);
    const direct = spill.anchors.get(key);
    if (direct) {
      return direct;
    }
    const anchorKey = spill.derived.get(key);
    return anchorKey === undefined ? null : (spill.anchors.get(anchorKey) ?? null);
  }

  /** True when a cell holds a *derived* dynamic-array value — part of a spill but not its anchor. */
  isSpillDerivedCell(sheet: Worksheet, row: number, col: number): boolean {
    return this.settledSpillFor(sheet).derived.has(cellKey(row, col));
  }

  /** True when the worksheet has any dynamic array at all (placed or blocked). */
  hasSpills(sheet: Worksheet): boolean {
    return !isEmptySpillMap(this.settledSpillFor(sheet));
  }

  // ----- Conditional formatting -----

  /**
   * The background/text color a conditional-formatting rule paints on one
   * cell, from its *computed* value (a formula cell's result, not its source
   * text), or null when no rule applies. Rules are checked from most- to
   * least-recently applied, skipping any rule that covers the cell but whose
   * condition does not actually match it — the first (most recent) actual
   * match wins, mirroring `findValidation`'s "last rule wins" precedence.
   */
  conditionalFormatStyle(sheet: Worksheet, row: number, col: number): ConditionalFormatStyle | null {
    const rules = sheet.conditionalFormats;
    for (let i = rules.length - 1; i >= 0; i--) {
      const cf = rules[i];
      if (row < cf.top || row > cf.bottom || col < cf.left || col > cf.right) {
        continue;
      }
      const style = this.evaluateConditionalFormat(sheet, cf, row, col);
      if (style) {
        return style;
      }
    }
    return null;
  }

  private evaluateConditionalFormat(
    sheet: Worksheet,
    cf: CellConditionalFormat,
    row: number,
    col: number,
  ): ConditionalFormatStyle | null {
    const value = this.evaluate(sheet, row, col);
    const rule = cf.rule;
    if (rule.kind === 'cellValue') {
      return matchesCellValueRule(rule, value) ? rule.style : null;
    }
    if (rule.kind === 'duplicate') {
      const key = duplicateKey(value);
      return key !== null && this.duplicateKeysFor(sheet, cf).has(key) ? rule.style : null;
    }
    if (value.type !== 'number') {
      return null;
    }
    const range = this.colorScaleRangeFor(sheet, cf);
    return range ? { backgroundColor: colorScaleColor(rule, value.value, range) } : null;
  }

  /** The set of duplicate keys within a `duplicate` rule's range, cached per {@link conditionalFormatStats}. */
  private duplicateKeysFor(sheet: Worksheet, cf: CellConditionalFormat): Set<string> {
    const revision = this.host.revisionCounter;
    const cached = this.conditionalFormatStats.get(cf);
    if (cached && cached.revision === revision && cached.stats.kind === 'duplicate') {
      return cached.stats.keys;
    }
    const keys: Array<string | null> = [];
    for (let r = cf.top; r <= cf.bottom; r++) {
      for (let c = cf.left; c <= cf.right; c++) {
        keys.push(duplicateKey(this.evaluate(sheet, r, c)));
      }
    }
    const stats: ConditionalFormatRuleStats = { kind: 'duplicate', keys: findDuplicateKeys(keys) };
    this.conditionalFormatStats.set(cf, { revision, stats });
    return stats.keys;
  }

  /** The [min, max] of the numbers within a `colorScale` rule's range, cached per {@link conditionalFormatStats}. */
  private colorScaleRangeFor(
    sheet: Worksheet,
    cf: CellConditionalFormat,
  ): { min: number; max: number } | null {
    const revision = this.host.revisionCounter;
    const cached = this.conditionalFormatStats.get(cf);
    if (cached && cached.revision === revision && cached.stats.kind === 'colorScale') {
      return cached.stats;
    }
    const values: number[] = [];
    for (let r = cf.top; r <= cf.bottom; r++) {
      for (let c = cf.left; c <= cf.right; c++) {
        const value = this.evaluate(sheet, r, c);
        if (value.type === 'number') {
          values.push(value.value);
        }
      }
    }
    const range = colorScaleRange(values);
    if (!range) {
      return null;
    }
    const stats: ConditionalFormatRuleStats = { kind: 'colorScale', ...range };
    this.conditionalFormatStats.set(cf, { revision, stats });
    return range;
  }
}
