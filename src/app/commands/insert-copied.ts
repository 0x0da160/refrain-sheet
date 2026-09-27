// SPDX-License-Identifier: MIT
/**
 * Edit > Insert Copied Cells / Rows / Columns: shift the existing cells out
 * of the way and insert the most recent copy, as one undoable operation.
 */
import { columnLabel, isFormula, shiftFormulaRefs } from '../../core/formula';
import { forEachIndexSliced } from '../../core/scheduler';
import type { Selection, Tab } from '../state';
import { t } from '../i18n';
import { LARGE_OP_CELLS, nextPaint, pct, withBusy } from './shared';

import type { PasteFillCommands } from './paste-fill';

export class InsertCopiedCommands {
  constructor(private readonly core: PasteFillCommands) {}

  /**
   * Edit > Insert Copied > Insert Copied Cells…: insert the most recently
   * copied range at the selection, shifting existing cells right (whole
   * columns) or down (whole rows). Structural insertion is a spreadsheet
   * operation, so a plain CSV document requires the explicit RSF conversion
   * first (the confirmation dialog explains why); declining leaves the
   * document untouched.
   */
  async insertCopiedCells(tab: Tab): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    const copied = await this.core.getCopied();
    if (!copied || copied.matrix.length === 0 || copied.matrix[0].length === 0) {
      this.core.ui.notify(t('notify.nothingToInsert'), 'warn');
      return false;
    }
    const direction = await this.core.ui.chooseInsertShift(copied.matrix.length, copied.matrix[0].length);
    if (!direction) {
      return false;
    }
    const doc = await this.core.ensureRsf(tab, 'structure');
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
    const hadSort = doc.sort !== null;
    const run = (): boolean =>
      this.core.state.insertCopiedCells(tab, at, prepared.matrix, direction, prepared.origin);
    const applied = large ? await withBusy(this.core.ui, t('loading.inserting'), run) : run();
    if (applied && hadFilter && doc.filter === null) {
      this.core.ui.notify(t('notify.filterClearedByStructure'), 'info');
    }
    if (applied && hadSort && doc.sort === null) {
      this.core.ui.notify(t('notify.sortClearedByStructure'), 'info');
    }
    return applied;
  }

  /**
   * Edit > Insert Copied > Insert Copied Rows / Insert Copied Columns. The
   * documented, user-visible rule (also stated by the completion
   * notification): copied rows are inserted as whole rows **above** the
   * selection's top row; copied columns are inserted as whole columns **to
   * the left of** the selection's left column. Copied cells keep their
   * source columns (rows) when the copy origin is known — i.e. for in-app copies; a system-clipboard range of
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
    const copied = await this.core.getCopied();
    if (!copied || copied.matrix.length === 0 || copied.matrix[0].length === 0) {
      this.core.ui.notify(t('notify.nothingToInsert'), 'warn');
      return false;
    }
    const doc = await this.core.ensureRsf(tab, 'structure');
    if (!doc) {
      return false;
    }
    const range = this.core.state.selectedRange(tab);
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
    const hadSort = doc.sort !== null;
    const run = (): boolean =>
      this.core.state.insertCopiedCells(tab, at, prepared.matrix, direction, prepared.origin);
    const applied = large ? await withBusy(this.core.ui, t('loading.inserting'), run) : run();
    if (applied && hadFilter && doc.filter === null) {
      this.core.ui.notify(t('notify.filterClearedByStructure'), 'info');
    }
    if (applied && hadSort && doc.sort === null) {
      this.core.ui.notify(t('notify.sortClearedByStructure'), 'info');
    }
    if (applied) {
      this.core.ui.notify(
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
    // The initial label already carries an honest 0%, so (unlike withBusy's
    // other callers, whose initial label has no percentage yet) it is shown
    // with a determinate progress value from the start rather than a
    // momentary indeterminate spinner.
    this.core.ui.setBusy(t(labelKey, { done: 0, total: totalCells.toLocaleString('en-US'), pct: 0 }), 0);
    await nextPaint();
    let completed: boolean;
    try {
      completed = await forEachIndexSliced(
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
            this.core.ui.setBusy(
              t(labelKey, {
                done: (done * width).toLocaleString('en-US'),
                total: totalCells.toLocaleString('en-US'),
                pct: pct(done, total),
              }),
              pct(done, total),
            ),
          shouldStop: () => tab.doc !== doc,
        },
      );
    } finally {
      this.core.ui.setBusy(null);
    }
    if (!completed || tab.doc !== doc) {
      return null;
    }
    return { matrix: shifted, origin: null };
  }
}
