// SPDX-License-Identifier: MIT
/**
 * Fill Down, the fill handle's drag-fill (with numeric-series AutoFill), and
 * Flash Fill — each one atomic, undoable operation over the selection.
 */
import type { CellRange } from '../../core/clipboard';
import { inferLinearSeries, seriesValueAt } from '../../core/fill-series';
import {
  flashFillRow,
  inferFlashFillCandidates,
  type FlashFillExample,
  type FlashFillOp,
} from '../../core/flash-fill';
import { cellLabel, columnLabel, isFormula, shiftFormulaRefs } from '../../core/formula';
import type { CellChange, HistoryEntry, Operation } from '../../core/workbook/history';
import { forEachIndexSliced } from '../../core/scheduler';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import type { Tab } from '../state';
import { t } from '../i18n';
import { LARGE_OP_CELLS, pct, withBusy } from './shared';

import type { PasteFillCommands } from './paste-fill';

export interface FlashFillPreview {
  /** Localized, human-readable description of the inferred operation. */
  description: string;
  /** Affected cell range in A1 notation (e.g. "C2:C120"). */
  range: string;
  /** Number of cells the fill would change. */
  changeCount: number;
  /** How many of those cells are currently non-empty (would be overwritten). */
  overwriteCount: number;
  /** Bounded before/after sample of the proposed changes. */
  sample: Array<{ cell: string; before: string; after: string }>;
}

/**
 * Flash Fill never looks beyond this many rows around the selection, so the
 * contiguous-block detection stays bounded on very large sheets.
 */
const FLASH_FILL_MAX_BLOCK_ROWS = 100_000;

/** Bounded number of before/after rows shown in the Flash Fill preview. */
const FLASH_FILL_SAMPLE_SIZE = 8;

/**
 * Localized, human-readable description of an inferred Flash Fill operation
 * (shown in the preview dialog so the user knows exactly what would run).
 */
function describeFlashFillOp(op: FlashFillOp): string {
  const casing = (c: 'none' | 'upper' | 'lower'): string =>
    c === 'none' ? '' : t(c === 'upper' ? 'flashFill.casing.upper' : 'flashFill.casing.lower');
  switch (op.kind) {
    case 'copy':
      return t('flashFill.op.copy', { col: columnLabel(op.col) }) + casing(op.casing);
    case 'concat': {
      const parts = op.parts.map((p) => (p.type === 'col' ? columnLabel(p.col) : `"${p.text}"`)).join(' + ');
      return t('flashFill.op.concat', { parts });
    }
    case 'split':
      return (
        t(op.fromEnd ? 'flashFill.op.splitEnd' : 'flashFill.op.split', {
          n: op.index + 1,
          col: columnLabel(op.col),
          sep: op.sep,
        }) + casing(op.casing)
      );
    case 'affix':
      return (
        t(op.side === 'prefix' ? 'flashFill.op.prefix' : 'flashFill.op.suffix', {
          n: op.length,
          col: columnLabel(op.col),
        }) + casing(op.casing)
      );
  }
}

export class FillCommands {
  constructor(private readonly core: PasteFillCommands) {}

  /**
   * Fill Down: the top row of the current selection is copied into the rows
   * below it (within the selection). Requires a selection spanning at least
   * two rows.
   */
  async fillDown(tab: Tab): Promise<boolean> {
    const range = this.core.state.selectedRange(tab);
    if (!range || range.bottom <= range.top) {
      return false;
    }
    const source: CellRange = {
      top: range.top,
      bottom: range.top,
      left: range.left,
      right: range.right,
    };
    return this.applyFill(tab, source, range);
  }

  /**
   * Fill a source range into a destination range that extends it downward
   * and/or rightward. The source pattern tiles into the destination; relative
   * formula references are adjusted by each cell's offset from its tiled
   * source cell. Filling is a spreadsheet-only operation, so a plain CSV must
   * be explicitly converted to RSF first (it modifies multiple cells and may
   * extend the grid). The whole fill — including any grid growth — is one
   * atomic, undoable operation. Absolute/mixed `$` reference components stay
   * fixed while relative components shift (handled by `shiftFormulaRefs`).
   *
   * **Numeric series (AutoFill):** a purely vertical (or purely horizontal)
   * fill whose seed lane holds **two or more** numeric values forming an
   * arithmetic progression continues that series in the fill direction
   * (`1, 2, 3` → `4, 5, 6`; `2, 4` → `6, 8`; `10, 7` → `4, 1`), per column
   * (or per row) independently, at the seeds' own decimal precision.
   * Documented fallbacks: a single seed copies its value; formulas always
   * use reference translation (never series inference); non-numeric, mixed,
   * or non-linear seeds keep the plain tiling behavior — ambiguity is never
   * guessed at. Rows hidden by an active filter are never modified (the
   * series continues across them so the visible sequence stays consecutive).
   */
  async applyFill(tab: Tab, source: CellRange, dest: CellRange): Promise<boolean> {
    if (
      dest.top !== source.top ||
      dest.left !== source.left ||
      dest.bottom < source.bottom ||
      dest.right < source.right
    ) {
      return false;
    }
    if (dest.bottom === source.bottom && dest.right === source.right) {
      return false; // nothing to fill
    }
    const doc = await this.core.ensureRsf(tab, 'fill');
    if (!doc) {
      return false;
    }

    const srcValues = readRange(doc, source);
    const ops = growOps(doc, dest);
    const hidden = this.core.state.hiddenRows(tab);
    const changes = fillChanges(doc, source, dest, srcValues, hidden);
    ops.push({ type: 'cells', changes });
    const entry: HistoryEntry = { label: 'history.fill', ops };
    const applied = this.core.state.pushEntry(tab, entry);
    if (applied) {
      this.core.state.setSelection(
        tab,
        { row: dest.top, col: dest.left },
        { row: dest.bottom, col: dest.right },
      );
      this.core.notifyHiddenRowsSkipped(dest.top, dest.bottom, hidden);
    }
    return applied;
  }

  /**
   * Flash Fill: infer a deterministic text transformation of nearby source
   * columns from the examples the user already typed into the target column,
   * preview it, and — only after explicit confirmation — apply it as one
   * atomic, undoable operation. RSF-only: on a plain CSV document the
   * explicit-conversion dialog explains that structural multi-cell
   * operations require converting to RSF and offers to do so right there
   * (`ensureRsf`, reason `'fill'`, same as Fill Down/Fill Range below);
   * declining leaves the document unchanged. The candidate agreement scan
   * runs in cooperative time slices with honest progress for large blocks;
   * cancellation (preview rejection, tab/document change while yielding, no
   * reliable pattern) always leaves the document untouched. Non-empty target
   * cells below the examples are never overwritten silently: any overwrite
   * is counted, called out in the preview, and requires the same explicit
   * confirmation.
   */
  async flashFill(tab: Tab): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    const doc = await this.core.ensureRsf(tab, 'fill');
    if (!doc) {
      return false;
    }
    const targetCol = tab.selection.col;
    const { top, bottom } = flashFillBlock(doc, tab.selection.row, this.core.state.selectedRange(tab));
    const { examples, firstFill } = leadingExamples(doc, top, bottom, targetCol);
    const sourceCols =
      examples.length > 0 && firstFill <= bottom ? sourceColumns(doc, top, bottom, targetCol) : [];
    const candidates =
      sourceCols.length > 0
        ? inferFlashFillCandidates(examples, sourceCols, (r, c) => doc.getValue(r, c))
        : [];
    const refusal =
      examples.length === 0
        ? 'dialog.flashFill.noExamples'
        : firstFill > bottom
          ? 'dialog.flashFill.nothing'
          : sourceCols.length === 0
            ? 'dialog.flashFill.noSources'
            : candidates.length === 0
              ? 'dialog.flashFill.noPattern'
              : null;
    if (refusal) {
      await this.core.ui.showMessage(t('dialog.flashFill.title'), t(refusal));
      return false;
    }

    // Agreement scan over the fill rows (read-only, sliced for large blocks;
    // aborts without touching anything when the document changes meanwhile).
    const scan = await this.scanFlashFill(tab, doc, candidates, firstFill, bottom, targetCol);
    if (!scan) {
      return false;
    }
    const { changes, overwriteCount, conflict } = scan;
    if (conflict) {
      await this.core.ui.showMessage(
        t('dialog.flashFill.title'),
        t('dialog.flashFill.ambiguous', { a: conflict.a || '(empty)', b: conflict.b || '(empty)' }),
      );
      return false;
    }
    if (changes.length === 0) {
      await this.core.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.nothing'));
      return false;
    }

    // Accessible preview + explicit confirmation. Nothing is applied yet.
    const first = changes[0];
    const last = changes[changes.length - 1];
    const preview: FlashFillPreview = {
      description: describeFlashFillOp(candidates[0]),
      range: `${cellLabel(first.row, targetCol)}:${cellLabel(last.row, targetCol)}`,
      changeCount: changes.length,
      overwriteCount,
      sample: changes.slice(0, FLASH_FILL_SAMPLE_SIZE).map((ch) => ({
        cell: cellLabel(ch.row, ch.col),
        before: ch.before ?? '',
        after: ch.after ?? '',
      })),
    };
    const confirmed = await this.core.ui.confirmFlashFill(preview);
    if (!confirmed || tab.doc !== doc) {
      return false; // rejected preview (or replaced document): unchanged
    }
    const applied = this.core.state.bulkEdit(tab, changes, 'history.flashFill');
    if (applied) {
      this.core.ui.notify(t('notify.flashFilled', { n: changes.length }), 'info');
    }
    return applied;
  }

  /**
   * Evaluate the Flash Fill candidates on every fill row: the changes they
   * agree on, how many would overwrite a value, or the first disagreement.
   * Null when a long, sliced scan was cancelled or the document changed.
   */
  private async scanFlashFill(
    tab: Tab,
    doc: RsfDocument,
    candidates: FlashFillOp[],
    firstFill: number,
    bottom: number,
    targetCol: number,
  ): Promise<{
    changes: CellChange[];
    overwriteCount: number;
    conflict: { a: string; b: string } | null;
  } | null> {
    const changes: CellChange[] = [];
    let overwriteCount = 0;
    let conflict: { a: string; b: string } | null = null;
    const label = t('loading.flashFill');
    const rowCount = bottom - firstFill + 1;
    const hiddenRows = this.core.state.hiddenRows(tab);
    const scanRow = (i: number): void => {
      if (conflict) {
        return;
      }
      const row = firstFill + i;
      if (hiddenRows?.has(row)) {
        return; // filtered-out rows are never modified by Flash Fill
      }
      const outcome = flashFillRow(candidates, (c) => doc.getValue(row, c));
      if (outcome.kind === 'conflict') {
        conflict = { a: outcome.a ?? '', b: outcome.b ?? '' };
        return;
      }
      const value = outcome.value;
      if (value === null) {
        return; // no usable source data in this row — leave it untouched
      }
      const before = doc.getValue(row, targetCol);
      if (before === value) {
        return;
      }
      if (before !== '') {
        overwriteCount += 1;
      }
      changes.push({ row, col: targetCol, before, after: value });
    };
    if (rowCount > LARGE_OP_CELLS) {
      const completed = await withBusy(this.core.ui, label, () =>
        forEachIndexSliced(rowCount, scanRow, {
          onProgress: (done, total) =>
            this.core.ui.setBusy(`${label} (${pct(done, total)}%)`, pct(done, total)),
          shouldStop: () => tab.doc !== doc || conflict !== null,
        }),
      );
      if ((!completed && !conflict) || tab.doc !== doc) {
        return null;
      }
    } else {
      for (let i = 0; i < rowCount; i++) {
        scanRow(i);
      }
    }
    return { changes, overwriteCount, conflict };
  }
}

/** The values of a rectangle, row-major. */
function readRange(doc: RsfDocument, range: CellRange): string[][] {
  const values: string[][] = [];
  for (let r = range.top; r <= range.bottom; r++) {
    const row: string[] = [];
    for (let c = range.left; c <= range.right; c++) {
      row.push(doc.getValue(r, c));
    }
    values.push(row);
  }
  return values;
}

/** Row/column inserts that grow the grid to contain `dest`, in the same history entry. */
function growOps(doc: RsfDocument, dest: CellRange): Operation[] {
  const ops: Operation[] = [];
  const needRows = Math.max(0, dest.bottom + 1 - doc.rowCount);
  const needCols = Math.max(0, dest.right + 1 - doc.columnCount);
  if (needRows > 0) {
    ops.push({
      type: 'rows',
      action: 'insert',
      index: doc.rowCount,
      count: needRows,
      data: Array.from({ length: needRows }, () => []),
    });
  }
  if (needCols > 0) {
    ops.push({
      type: 'cols',
      action: 'insert',
      index: doc.columnCount,
      count: needCols,
      data: Array.from({ length: needCols }, () => []),
    });
  }
  return ops;
}

/**
 * The cell changes of a fill: tiled source values, continued numeric series
 * for single-axis fills, and formulas shifted by their offset. Filtered-out
 * rows are never modified.
 */
function fillChanges(
  doc: RsfDocument,
  source: CellRange,
  dest: CellRange,
  srcValues: string[][],
  hidden: Set<number> | null,
): CellChange[] {
  const srcH = source.bottom - source.top + 1;
  const srcW = source.right - source.left + 1;
  const { vertical, horizontal, colSeries, rowSeries } = laneSeries(source, dest, srcValues);
  const changes: CellChange[] = [];
  // Series step counter for vertical fills: advances only on visible
  // destination rows, so the visible sequence is consecutive.
  let verticalK = 0;
  for (let r = dest.top; r <= dest.bottom; r++) {
    const rowHidden = hidden?.has(r) === true;
    if (vertical && r > source.bottom && !rowHidden) {
      verticalK += 1;
    }
    if (rowHidden) {
      continue; // filtered-out rows are never modified by a fill
    }
    for (let c = dest.left; c <= dest.right; c++) {
      if (r <= source.bottom && c <= source.right) {
        continue; // the source block itself is unchanged
      }
      const si = (r - source.top) % srcH;
      const sj = (c - source.left) % srcW;
      const srcRow = source.top + si;
      const srcCol = source.left + sj;
      let value = srcValues[si][sj];
      const series = vertical ? colSeries.get(c) : horizontal ? rowSeries.get(r) : null;
      if (series) {
        value = seriesValueAt(series, vertical ? verticalK : c - source.right);
      } else if (isFormula(value) && (r !== srcRow || c !== srcCol)) {
        value = shiftFormulaRefs(value, r - srcRow, c - srcCol);
      }
      const before = doc.getValue(r, c);
      if (before !== value) {
        changes.push({ row: r, col: c, before, after: value });
      }
    }
  }
  return changes;
}

type LaneSeries = ReturnType<typeof inferLinearSeries>;

/**
 * Numeric-series inference per lane. Only single-axis fills continue series;
 * a fill extending both down and right always tiles.
 */
function laneSeries(
  source: CellRange,
  dest: CellRange,
  srcValues: string[][],
): {
  vertical: boolean;
  horizontal: boolean;
  colSeries: Map<number, LaneSeries>;
  rowSeries: Map<number, LaneSeries>;
} {
  const srcH = source.bottom - source.top + 1;
  const srcW = source.right - source.left + 1;
  const vertical = dest.right === source.right && dest.bottom > source.bottom;
  const horizontal = dest.bottom === source.bottom && dest.right > source.right;
  const colSeries = new Map<number, LaneSeries>();
  const rowSeries = new Map<number, LaneSeries>();
  if (vertical && srcH >= 2) {
    for (let j = 0; j < srcW; j++) {
      colSeries.set(source.left + j, inferLinearSeries(srcValues.map((rowVals) => rowVals[j])));
    }
  } else if (horizontal && srcW >= 2) {
    for (let i = 0; i < srcH; i++) {
      rowSeries.set(source.top + i, inferLinearSeries(srcValues[i]));
    }
  }
  return { vertical, horizontal, colSeries, rowSeries };
}

/**
 * The rows Flash Fill works on: an explicitly selected multi-row range,
 * otherwise the contiguous block of data rows around the selection (bounded).
 */
function flashFillBlock(
  doc: RsfDocument,
  row: number,
  range: CellRange | null,
): { top: number; bottom: number } {
  if (range && range.bottom > range.top) {
    return { top: range.top, bottom: range.bottom };
  }
  const rowHasData = (r: number): boolean => {
    for (let c = 0; c < doc.columnCount; c++) {
      if (doc.getValue(r, c) !== '') {
        return true;
      }
    }
    return false;
  };
  let top = row;
  let bottom = row;
  while (top > 0 && bottom - top < FLASH_FILL_MAX_BLOCK_ROWS && rowHasData(top - 1)) {
    top -= 1;
  }
  while (bottom < doc.rowCount - 1 && bottom - top < FLASH_FILL_MAX_BLOCK_ROWS && rowHasData(bottom + 1)) {
    bottom += 1;
  }
  return { top, bottom };
}

/** The leading run of non-empty target cells (the typed examples) and the first row to fill. */
function leadingExamples(
  doc: RsfDocument,
  top: number,
  bottom: number,
  targetCol: number,
): { examples: FlashFillExample[]; firstFill: number } {
  const examples: FlashFillExample[] = [];
  let firstFill = top;
  while (firstFill <= bottom && doc.getValue(firstFill, targetCol) !== '') {
    examples.push({ row: firstFill, value: doc.getValue(firstFill, targetCol) });
    firstFill += 1;
  }
  return { examples, firstFill };
}

/** Every other column with data in the block: the possible Flash Fill sources. */
function sourceColumns(doc: RsfDocument, top: number, bottom: number, targetCol: number): number[] {
  const sourceCols: number[] = [];
  for (let c = 0; c < doc.columnCount; c++) {
    if (c === targetCol) {
      continue;
    }
    for (let r = top; r <= bottom; r++) {
      if (doc.getValue(r, c) !== '') {
        sourceCols.push(c);
        break;
      }
    }
  }
  return sourceCols;
}
