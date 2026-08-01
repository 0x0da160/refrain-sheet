// SPDX-License-Identifier: MIT
import type { CellRange } from '../../core/clipboard';
import { inferLinearSeries, seriesValueAt } from '../../core/fill-series';
import {
  flashFillRow,
  inferFlashFillCandidates,
  type FlashFillExample,
  type FlashFillOp,
} from '../../core/flash-fill';
import { cellLabel, columnLabel, isFormula, shiftFormulaRefs } from '../../core/formula';
import type { CellChange, HistoryEntry, Operation } from '../../core/history';
import type { RsfDocument } from '../../core/rsf-document';
import { forEachIndexSliced } from '../../core/scheduler';
import { AppState, type Selection, type Tab } from '../app-state';
import { t } from '../i18n';
import type { ConvertReason, UiPort } from '../commands';
import { LARGE_OP_CELLS, pct, withBusy } from './shared';

/** Everything the Flash Fill preview dialog shows before anything is applied. */
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

/**
 * Paste, Insert Copied …, Fill Down / drag-fill, and Flash Fill — the
 * paste/fill/flash-fill command group. Extracted from `Commands` as a
 * cohesive slice (see issue #130, following the composition pattern
 * `FileIoCommands` established for issue #68) — `Commands` still exposes the
 * same public/private methods, delegating to an instance of this class.
 */
export class PasteFillCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly ensureRsf: (tab: Tab, reason: ConvertReason) => Promise<RsfDocument | null>,
    private readonly getCopied: () => Promise<{ matrix: string[][]; origin: Selection | null } | null>,
  ) {}

  /**
   * Paste a rectangular matrix as one atomic, undoable operation, preserving
   * the copied shape. Normally the paste starts at the active cell. When a
   * larger destination range is selected and each of its dimensions is an
   * exact multiple of the source's, the source pattern repeats to fill the
   * whole selected destination (documented behavior; otherwise the range is
   * pasted once at the active cell). For byte-preserving CSV documents the
   * paste must fit inside the existing cells; pastes that would change the
   * row/column structure require the explicit RSF conversion. `origin` is
   * set for app-internal pastes so relative formula references adjust like a
   * conventional spreadsheet (per tiled offset when the pattern repeats).
   */
  async applyPaste(tab: Tab, matrix: string[][], origin: Selection | null): Promise<boolean> {
    if (!tab.selection || matrix.length === 0 || matrix[0].length === 0) {
      return false;
    }
    const srcH = matrix.length;
    const srcW = matrix[0].length;
    // Pattern-repeat: fill a larger selected destination when its dimensions
    // are exact multiples of the source's. The paste then anchors at the
    // destination's top-left corner.
    let at = tab.selection;
    let height = srcH;
    let width = srcW;
    const dest = this.state.selectedRange(tab);
    if (dest) {
      const destRows = dest.bottom - dest.top + 1;
      const destCols = dest.right - dest.left + 1;
      if (
        (destRows > srcH || destCols > srcW) &&
        destRows % srcH === 0 &&
        destCols % srcW === 0 &&
        destRows >= srcH &&
        destCols >= srcW
      ) {
        at = { row: dest.top, col: dest.left };
        height = destRows;
        width = destCols;
      }
    }
    const containsFormula = matrix.some((row) => row.some((v) => isFormula(v)));

    if (tab.doc.kind === 'csv') {
      const doc = tab.doc;
      let fits = at.row + height <= doc.rowCount;
      if (fits) {
        for (let i = 0; i < height && fits; i++) {
          if (at.col + width > doc.fieldCount(at.row + i)) {
            fits = false;
          }
        }
      }
      if (!fits || containsFormula) {
        const converted = await this.ensureRsf(tab, !fits ? 'paste' : 'formula');
        if (!converted) {
          if (!fits) {
            return false;
          }
          // Formula paste declined: paste as plain literals below.
        }
      }
    }

    // Rows hidden by an active filter are never modified by a paste: the
    // change list skips them (documented, notified below when it happens).
    const hidden = this.state.hiddenRows(tab);

    // Small pastes apply synchronously; large ones build their change list in
    // cooperative time slices behind a percentage progress label (the mutation
    // itself is then applied atomically, so an abandoned scan changes nothing).
    if (height * width <= LARGE_OP_CELLS) {
      return this.applyPasteNow(tab, matrix, origin, at, height, width, hidden);
    }
    const doc = tab.doc;
    const totalCells = height * width;
    return withBusy(this.ui, t('loading.pasting'), async () => {
      const changes: CellChange[] = [];
      const completed = await forEachIndexSliced(
        height,
        (i) => this.buildPasteRowChanges(doc, matrix, origin, at, width, i, changes, hidden),
        {
          onProgress: (done, total) =>
            this.ui.setBusy(
              t('loading.pastingCells', {
                done: (done * width).toLocaleString('en-US'),
                total: totalCells.toLocaleString('en-US'),
                pct: pct(done, total),
              }),
            ),
          shouldStop: () => tab.doc !== doc,
        },
      );
      if (!completed || tab.doc !== doc) {
        return false;
      }
      return this.applyPasteChanges(tab, at, height, width, changes, hidden);
    });
  }

  /** Build and push the paste entry (synchronous, atomic; small pastes). */
  private applyPasteNow(
    tab: Tab,
    matrix: string[][],
    origin: Selection | null,
    at: Selection,
    height: number,
    width: number,
    hidden: Set<number> | null,
  ): boolean {
    const changes: CellChange[] = [];
    for (let i = 0; i < height; i++) {
      this.buildPasteRowChanges(tab.doc, matrix, origin, at, width, i, changes, hidden);
    }
    return this.applyPasteChanges(tab, at, height, width, changes, hidden);
  }

  /** Collect the changes for one destination row of a (possibly tiled) paste. */
  private buildPasteRowChanges(
    doc: Tab['doc'],
    matrix: string[][],
    origin: Selection | null,
    at: Selection,
    width: number,
    i: number,
    changes: CellChange[],
    hidden: Set<number> | null = null,
  ): void {
    const srcH = matrix.length;
    const srcW = matrix[0].length;
    const row = at.row + i;
    if (hidden?.has(row)) {
      return; // filtered-out rows are never modified by a paste
    }
    if (doc.kind === 'csv') {
      for (let j = 0; j < width; j++) {
        const col = at.col + j;
        const value = matrix[i % srcH][j % srcW];
        const current = doc.getValue(row, col);
        if (value === current) {
          continue;
        }
        const before = doc.isEdited(row, col) ? current : null;
        const after = value === doc.getOriginalValue(row, col) ? null : value;
        changes.push({ row, col, before, after });
      }
      return;
    }
    for (let j = 0; j < width; j++) {
      const col = at.col + j;
      let value = matrix[i % srcH][j % srcW];
      if (origin && isFormula(value)) {
        // Each cell shifts by its offset from its own tiled source cell.
        const deltaRow = row - (origin.row + (i % srcH));
        const deltaCol = col - (origin.col + (j % srcW));
        if (deltaRow !== 0 || deltaCol !== 0) {
          value = shiftFormulaRefs(value, deltaRow, deltaCol);
        }
      }
      const before = doc.getValue(row, col);
      if (before === value) {
        continue;
      }
      changes.push({ row, col, before, after: value });
    }
  }

  /** Apply prepared paste changes atomically (CSV bulk edit / RSF entry with grid growth). */
  private applyPasteChanges(
    tab: Tab,
    at: Selection,
    height: number,
    width: number,
    changes: CellChange[],
    hidden: Set<number> | null = null,
  ): boolean {
    const doc = tab.doc;
    let applied: boolean;
    if (doc.kind === 'csv') {
      applied = this.state.bulkEdit(tab, changes, 'history.paste');
    } else {
      // RSF: the grid may grow to fit the paste (atomically undoable).
      const needRows = Math.max(0, at.row + height - doc.rowCount);
      const needCols = Math.max(0, at.col + width - doc.columnCount);
      const ops: Operation[] = [];
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
      ops.push({ type: 'cells', changes });
      const entry: HistoryEntry = { label: 'history.paste', ops };
      applied = this.state.pushEntry(tab, entry);
    }
    if (applied) {
      this.state.setSelection(tab, at, { row: at.row + height - 1, col: at.col + width - 1 });
      this.notifyHiddenRowsSkipped(at.row, at.row + height - 1, hidden);
    }
    return applied;
  }

  /** Tell the user when an operation left filtered-out (hidden) rows untouched. */
  private notifyHiddenRowsSkipped(top: number, bottom: number, hidden: Set<number> | null): void {
    if (!hidden || hidden.size === 0) {
      return;
    }
    let skipped = 0;
    for (let r = top; r <= bottom; r++) {
      if (hidden.has(r)) {
        skipped += 1;
      }
    }
    if (skipped > 0) {
      this.ui.notify(t('notify.hiddenRowsSkipped', { n: skipped }), 'info');
    }
  }

  /**
   * Edit > Insert Copied Cells…: insert the most recently copied range at the
   * selection, shifting existing cells right (whole columns) or down (whole
   * rows). Structural insertion is a spreadsheet operation, so a plain CSV
   * document requires the explicit RSF conversion first (the confirmation
   * dialog explains why); declining leaves the document untouched.
   */
  async insertCopiedCells(tab: Tab): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    const copied = await this.getCopied();
    if (!copied || copied.matrix.length === 0 || copied.matrix[0].length === 0) {
      this.ui.notify(t('notify.nothingToInsert'), 'warn');
      return false;
    }
    const direction = await this.ui.chooseInsertShift(copied.matrix.length, copied.matrix[0].length);
    if (!direction) {
      return false;
    }
    const doc = await this.ensureRsf(tab, 'structure');
    if (!doc) {
      return false;
    }
    const at = tab.selection;
    if (!at) {
      return false;
    }
    const prepared = await this.prepareCopiedMatrix(tab, copied, at, 'loading.insertCells');
    if (!prepared) {
      return false;
    }
    const large = copied.matrix.length * copied.matrix[0].length > LARGE_OP_CELLS;
    const hadFilter = doc.filter !== null;
    const run = (): boolean =>
      this.state.insertCopiedCells(tab, at, prepared.matrix, direction, prepared.origin);
    const applied = large ? await withBusy(this.ui, t('loading.inserting'), run) : run();
    if (applied && hadFilter && doc.filter === null) {
      this.ui.notify(t('notify.filterClearedByStructure'), 'info');
    }
    return applied;
  }

  /**
   * Edit > Insert Copied Rows / Insert Copied Columns. The documented,
   * user-visible rule (also stated by the completion notification): copied
   * rows are inserted as whole rows **above** the selection's top row; copied
   * columns are inserted as whole columns **to the left of** the selection's
   * left column. Copied cells keep their source columns (rows) when the copy
   * origin is known — i.e. for in-app copies; a system-clipboard range of
   * unknown origin starts at column A (row 1). Existing rows/columns shift
   * without data loss; formula references adjust exactly like Insert
   * Rows/Columns, and relative references inside the inserted formulas shift
   * by their offset from the copied location. Structural insertion is a
   * spreadsheet operation, so a plain CSV document asks for the explicit RSF
   * conversion first; declining (or an aborted preparation) leaves the
   * document untouched. The whole insertion is one atomic, undoable entry,
   * and large ranges run behind the percentage progress indicator.
   */
  async insertCopiedAxis(tab: Tab, axis: 'rows' | 'cols'): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    const copied = await this.getCopied();
    if (!copied || copied.matrix.length === 0 || copied.matrix[0].length === 0) {
      this.ui.notify(t('notify.nothingToInsert'), 'warn');
      return false;
    }
    const doc = await this.ensureRsf(tab, 'structure');
    if (!doc) {
      return false;
    }
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    const at: Selection =
      axis === 'rows'
        ? { row: range.top, col: copied.origin?.col ?? 0 }
        : { row: copied.origin?.row ?? 0, col: range.left };
    const prepared = await this.prepareCopiedMatrix(
      tab,
      copied,
      at,
      axis === 'rows' ? 'loading.insertRows' : 'loading.insertCols',
    );
    if (!prepared) {
      return false;
    }
    const height = copied.matrix.length;
    const width = copied.matrix[0].length;
    const direction = axis === 'rows' ? ('down' as const) : ('right' as const);
    const large = height * width > LARGE_OP_CELLS;
    const hadFilter = doc.filter !== null;
    const run = (): boolean =>
      this.state.insertCopiedCells(tab, at, prepared.matrix, direction, prepared.origin);
    const applied = large ? await withBusy(this.ui, t('loading.inserting'), run) : run();
    if (applied && hadFilter && doc.filter === null) {
      this.ui.notify(t('notify.filterClearedByStructure'), 'info');
    }
    if (applied) {
      this.ui.notify(
        axis === 'rows'
          ? t('notify.insertedRows', { n: height, row: at.row + 1 })
          : t('notify.insertedCols', { n: width, col: columnLabel(at.col) }),
        'info',
      );
    }
    return applied;
  }

  /**
   * Prepare the matrix an Insert Copied … operation actually inserts.
   * Relative references in copied formulas shift by the offset from the copy
   * origin: small ranges are shifted synchronously inside the atomic state
   * operation, while large ranges are pre-shifted here in cooperative time
   * slices behind a percentage progress label and then inserted atomically
   * (returned with `origin: null` because they are already shifted). Returns
   * null when the preparation was abandoned because the tab's document
   * changed while yielding — nothing has been modified in that case.
   */
  private async prepareCopiedMatrix(
    tab: Tab,
    copied: { matrix: string[][]; origin: Selection | null },
    at: Selection,
    labelKey: string,
  ): Promise<{ matrix: string[][]; origin: Selection | null } | null> {
    const { matrix, origin } = copied;
    const height = matrix.length;
    const width = matrix[0].length;
    if (height * width <= LARGE_OP_CELLS) {
      return copied;
    }
    const doc = tab.doc;
    const deltaRow = origin ? at.row - origin.row : 0;
    const deltaCol = origin ? at.col - origin.col : 0;
    const totalCells = height * width;
    const shifted: string[][] = new Array<string[]>(height);
    const completed = await withBusy(
      this.ui,
      t(labelKey, { done: 0, total: totalCells.toLocaleString('en-US'), pct: 0 }),
      () =>
        forEachIndexSliced(
          height,
          (i) => {
            const out = matrix[i].slice();
            if (origin && (deltaRow !== 0 || deltaCol !== 0)) {
              for (let j = 0; j < out.length; j++) {
                if (isFormula(out[j])) {
                  out[j] = shiftFormulaRefs(out[j], deltaRow, deltaCol);
                }
              }
            }
            shifted[i] = out;
          },
          {
            onProgress: (done, total) =>
              this.ui.setBusy(
                t(labelKey, {
                  done: (done * width).toLocaleString('en-US'),
                  total: totalCells.toLocaleString('en-US'),
                  pct: pct(done, total),
                }),
              ),
            shouldStop: () => tab.doc !== doc,
          },
        ),
    );
    if (!completed || tab.doc !== doc) {
      return null;
    }
    return { matrix: shifted, origin: null };
  }

  /**
   * Fill Down: the top row of the current selection is copied into the rows
   * below it (within the selection). Requires a selection spanning at least
   * two rows.
   */
  async fillDown(tab: Tab): Promise<boolean> {
    const range = this.state.selectedRange(tab);
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
    const doc = await this.ensureRsf(tab, 'fill');
    if (!doc) {
      return false;
    }

    const srcH = source.bottom - source.top + 1;
    const srcW = source.right - source.left + 1;
    const srcValues: string[][] = [];
    for (let r = source.top; r <= source.bottom; r++) {
      const row: string[] = [];
      for (let c = source.left; c <= source.right; c++) {
        row.push(doc.getValue(r, c));
      }
      srcValues.push(row);
    }

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

    // Numeric-series inference per lane. Only single-axis fills continue
    // series; a fill extending both down and right always tiles.
    const vertical = dest.right === source.right && dest.bottom > source.bottom;
    const horizontal = dest.bottom === source.bottom && dest.right > source.right;
    const colSeries = new Map<number, ReturnType<typeof inferLinearSeries>>();
    const rowSeries = new Map<number, ReturnType<typeof inferLinearSeries>>();
    if (vertical && srcH >= 2) {
      for (let j = 0; j < srcW; j++) {
        colSeries.set(source.left + j, inferLinearSeries(srcValues.map((rowVals) => rowVals[j])));
      }
    } else if (horizontal && srcW >= 2) {
      for (let i = 0; i < srcH; i++) {
        rowSeries.set(source.top + i, inferLinearSeries(srcValues[i]));
      }
    }

    const hidden = this.state.hiddenRows(tab);
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
        if (before === value) {
          continue;
        }
        changes.push({ row: r, col: c, before, after: value });
      }
    }
    ops.push({ type: 'cells', changes });
    const entry: HistoryEntry = { label: 'history.fill', ops };
    const applied = this.state.pushEntry(tab, entry);
    if (applied) {
      this.state.setSelection(tab, { row: dest.top, col: dest.left }, { row: dest.bottom, col: dest.right });
      this.notifyHiddenRowsSkipped(dest.top, dest.bottom, hidden);
    }
    return applied;
  }

  /**
   * Flash Fill: infer a deterministic text transformation of nearby source
   * columns from the examples the user already typed into the target column,
   * preview it, and — only after explicit confirmation — apply it as one
   * atomic, undoable operation. RSF-only: on a plain CSV document a localized
   * message explains that structural multi-cell operations require the
   * explicit conversion to RSF, and nothing is changed. The candidate
   * agreement scan runs in cooperative time slices with honest progress for
   * large blocks; cancellation (preview rejection, tab/document change while
   * yielding, no reliable pattern) always leaves the document untouched.
   * Non-empty target cells below the examples are never overwritten silently:
   * any overwrite is counted, called out in the preview, and requires the
   * same explicit confirmation.
   */
  async flashFill(tab: Tab): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    if (tab.doc.kind !== 'rsf') {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.csvOnly'));
      return false;
    }
    const doc = tab.doc;
    const targetCol = tab.selection.col;
    const cols = doc.columnCount;

    // Target rows: an explicitly selected multi-row range, otherwise the
    // contiguous block of data rows around the selection (bounded).
    const rowHasData = (r: number): boolean => {
      for (let c = 0; c < cols; c++) {
        if (doc.getValue(r, c) !== '') {
          return true;
        }
      }
      return false;
    };
    const range = this.state.selectedRange(tab);
    let top: number;
    let bottom: number;
    if (range && range.bottom > range.top) {
      top = range.top;
      bottom = range.bottom;
    } else {
      top = tab.selection.row;
      bottom = tab.selection.row;
      while (top > 0 && bottom - top < FLASH_FILL_MAX_BLOCK_ROWS && rowHasData(top - 1)) {
        top -= 1;
      }
      while (
        bottom < doc.rowCount - 1 &&
        bottom - top < FLASH_FILL_MAX_BLOCK_ROWS &&
        rowHasData(bottom + 1)
      ) {
        bottom += 1;
      }
    }

    // Examples: the leading run of non-empty target cells; sources: every
    // other column with data in the block.
    const examples: FlashFillExample[] = [];
    let firstFill = top;
    while (firstFill <= bottom && doc.getValue(firstFill, targetCol) !== '') {
      examples.push({ row: firstFill, value: doc.getValue(firstFill, targetCol) });
      firstFill += 1;
    }
    if (examples.length === 0) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.noExamples'));
      return false;
    }
    if (firstFill > bottom) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.nothing'));
      return false;
    }
    const sourceCols: number[] = [];
    for (let c = 0; c < cols; c++) {
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
    if (sourceCols.length === 0) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.noSources'));
      return false;
    }

    const candidates = inferFlashFillCandidates(examples, sourceCols, (r, c) => doc.getValue(r, c));
    if (candidates.length === 0) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.noPattern'));
      return false;
    }

    // Agreement scan over the fill rows (read-only, sliced for large blocks;
    // aborts without touching anything when the document changes meanwhile).
    const changes: CellChange[] = [];
    let overwriteCount = 0;
    let conflict: { a: string; b: string } | null = null;
    const label = t('loading.flashFill');
    const rowCount = bottom - firstFill + 1;
    const hiddenRows = this.state.hiddenRows(tab);
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
      const completed = await withBusy(this.ui, label, () =>
        forEachIndexSliced(rowCount, scanRow, {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`),
          shouldStop: () => tab.doc !== doc || conflict !== null,
        }),
      );
      if ((!completed && !conflict) || tab.doc !== doc) {
        return false;
      }
    } else {
      for (let i = 0; i < rowCount; i++) {
        scanRow(i);
      }
    }
    if (conflict) {
      const c = conflict as { a: string; b: string };
      await this.ui.showMessage(
        t('dialog.flashFill.title'),
        t('dialog.flashFill.ambiguous', { a: c.a || '(empty)', b: c.b || '(empty)' }),
      );
      return false;
    }
    if (changes.length === 0) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.nothing'));
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
    const confirmed = await this.ui.confirmFlashFill(preview);
    if (!confirmed || tab.doc !== doc) {
      return false; // rejected preview (or replaced document): unchanged
    }
    const applied = this.state.bulkEdit(tab, changes, 'history.flashFill');
    if (applied) {
      this.ui.notify(t('notify.flashFilled', { n: changes.length }), 'info');
    }
    return applied;
  }
}
