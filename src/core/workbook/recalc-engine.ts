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
 * any mutation anywhere invalidates everything, and results are recomputed
 * lazily on next access — there is no dependency graph and no timer.
 */
import {
  errorValue,
  evaluateAst,
  evaluateAstArray,
  isFormula,
  literalToValue,
  type EvalContext,
} from '../formula';
import {
  buildSpillMap,
  canSpill,
  cellKey,
  EMPTY_SPILL_MAP,
  isEmptySpillMap,
  type SpillAnchor,
  type SpillMap,
} from '../formula/spill';
import type { FormulaValue, ValueGrid } from '../formula/value';
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

/** Cached per-rule statistics — see {@link RecalcEngine.conditionalFormatStats}. */
type ConditionalFormatRuleStats =
  { kind: 'duplicate'; keys: Set<string> } | { kind: 'colorScale'; min: number; max: number };

export class RecalcEngine {
  /**
   * Workbook-wide evaluation memo, keyed by worksheet id + cell. Cleared by
   * every mutation (see {@link invalidate}) because a cross-sheet reference
   * means a change in one worksheet can invalidate a formula in another.
   */
  private memo = new Map<string, FormulaValue>();
  /** Cells currently being evaluated; a re-entry is a circular reference. */
  private readonly inProgress = new Set<string>();
  /** Per-worksheet evaluation contexts, rebuilt after any mutation. */
  private evalContexts = new Map<string, EvalContext>();

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
   * loaded, on any mutation (which invalidates the memo anyway), and when
   * {@link recalculate} is called explicitly. There is deliberately **no
   * background timer**: an idle workbook never recalculates on its own, so a
   * left-open tab cannot burn CPU or make a document appear to change by
   * itself.
   */
  private clockMs = Date.now();

  constructor(private readonly host: RecalcHost) {}

  /**
   * Drop every derived value after a mutation. The spill maps are dropped,
   * not rebuilt: the next evaluation rebuilds them lazily, so a burst of
   * edits costs one spill rebuild rather than one per edit. A mutation is a
   * recalculation event, so volatile functions advance here too.
   */
  invalidate(): void {
    this.recalculate();
  }

  /**
   * Recompute everything, advancing the clock the volatile functions read.
   * No timer exists, so this (and {@link invalidate}) is the only way a
   * `TODAY()` in an untouched workbook changes.
   */
  recalculate(): void {
    this.clockMs = Date.now();
    this.memo = new Map();
    this.evalContexts = new Map();
    this.spillMaps = null;
  }

  // ----- Evaluation -----

  /**
   * Evaluate a cell on a worksheet. Formula results are memoized until the
   * next mutation; circular references — including ones that travel through
   * another worksheet — resolve to #CYCLE! instead of recursing forever.
   */
  evaluate(sheet: Worksheet, row: number, col: number): FormulaValue {
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
    const key = `${sheet.id}|${row},${col}`;
    const cached = this.memo.get(key);
    if (cached) {
      return cached;
    }
    if (this.inProgress.has(key)) {
      return errorValue('#CYCLE!');
    }
    const compiled = sheet.compiled(row, col, input);
    let result: FormulaValue;
    if (!compiled.parsed.ok) {
      result = errorValue(compiled.parsed.code);
    } else {
      this.inProgress.add(key);
      try {
        result = evaluateAst(compiled.parsed.ast, this.contextFor(sheet));
      } finally {
        this.inProgress.delete(key);
      }
    }
    this.memo.set(key, result);
    return result;
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
   * workbook — sharing this workbook's memo and in-progress set, which is what
   * makes cross-worksheet cycles detectable.
   */
  private contextFor(sheet: Worksheet): EvalContext {
    const existing = this.evalContexts.get(sheet.id);
    if (existing) {
      return existing;
    }
    const ctx: EvalContext = {
      getCell: (r, c) => this.evaluate(sheet, r, c),
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      getSheetCell: (name, r, c) => {
        const target = this.host.sheetByName(name);
        return target ? this.evaluate(target, r, c) : errorValue('#REF!');
      },
      getSheetBounds: (name) => {
        const target = this.host.sheetByName(name);
        return target ? { rowCount: target.rowCount, columnCount: target.columnCount } : null;
      },
      // Shifted by the workbook's own timezone offset (0 for UTC) before it
      // ever reaches formula/date.ts, which does pure UTC math on whatever
      // instant it is handed — see that module's "Timezone policy".
      nowMs: this.clockMs + timeZoneOffsetMs(this.clockMs, this.host.timezone),
      displayLanguage: this.host.displayLanguage,
    };
    this.evalContexts.set(sheet.id, ctx);
    return ctx;
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
    this.spillMaps = maps;
  }

  /**
   * The array results of one worksheet's formulas, in row-major order.
   *
   * {@link canSpill} rejects any formula that cannot possibly return an array
   * before it is evaluated, so a worksheet of ordinary formulas costs one
   * cheap AST walk each and no evaluation at all.
   */
  private evaluateArrayFormulas(
    sheet: Worksheet,
  ): Array<{ row: number; col: number; grid: ValueGrid | null }> {
    const out: Array<{ row: number; col: number; grid: ValueGrid | null }> = [];
    for (const { row, col, src } of sheet.listFormulaCells()) {
      const compiled = sheet.compiled(row, col, src);
      if (!compiled.parsed.ok || !canSpill(compiled.parsed.ast)) {
        continue;
      }
      // The same in-progress guard ordinary evaluation uses, so a self-
      // referential array formula resolves to #CYCLE! instead of recursing.
      const key = `${sheet.id}|${row},${col}`;
      if (this.inProgress.has(key)) {
        continue;
      }
      this.inProgress.add(key);
      try {
        const { grid } = evaluateAstArray(compiled.parsed.ast, this.contextFor(sheet));
        out.push({ row, col, grid });
      } finally {
        this.inProgress.delete(key);
      }
    }
    return out;
  }

  /** The spill anchor covering a cell, whether the cell is the anchor or derived. */
  spillAnchorAt(sheet: Worksheet, row: number, col: number): SpillAnchor | null {
    const spill = this.spillFor(sheet);
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
    return this.spillFor(sheet).derived.has(cellKey(row, col));
  }

  /** True when the worksheet has any dynamic array at all (placed or blocked). */
  hasSpills(sheet: Worksheet): boolean {
    return !isEmptySpillMap(this.spillFor(sheet));
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
