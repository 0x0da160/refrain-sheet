// SPDX-License-Identifier: MIT
import type { NotifyPort, EditDialogsPort } from '../ui-port';
import { isCsv } from '../../core/editor-document';
import type { CellRange } from '../../core/clipboard';
import { isFormula, shiftFormulaRefs } from '../../core/formula';
import type { CellChange, HistoryEntry, Operation } from '../../core/workbook/history';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import { forEachIndexSliced } from '../../core/scheduler';
import type { AppState, Selection, Tab } from '../state';
import { t } from '../i18n';
import type { ConvertReason } from '../commands';
import { LARGE_OP_CELLS, pct, withBusy } from './shared';
import { FillCommands } from './fill';
import { InsertCopiedCommands } from './insert-copied';

/** Everything the Flash Fill preview dialog shows before anything is applied. */
/**
 * Paste, Insert Copied …, Fill Down / drag-fill, and Flash Fill — the
 * paste/fill/flash-fill command group. Extracted from `Commands` as a
 * cohesive slice (see issue #130, following the composition pattern
 * `FileIoCommands` established for issue #68) — `Commands` still exposes the
 * same public/private methods, delegating to an instance of this class.
 */
export class PasteFillCommands {
  /** Fill Down, drag-fill (AutoFill), and Flash Fill. */
  readonly fill: FillCommands;

  /** Edit > Insert Copied Cells / Rows / Columns. */
  readonly insertCopied: InsertCopiedCommands;

  constructor(
    readonly state: AppState,
    readonly ui: NotifyPort & EditDialogsPort,
    readonly ensureRsf: (tab: Tab, reason: ConvertReason) => Promise<RsfDocument | null>,
    readonly getCopied: () => Promise<{ matrix: string[][]; origin: Selection | null } | null>,
  ) {
    this.fill = new FillCommands(this);
    this.insertCopied = new InsertCopiedCommands(this);
  }

  /**
   * Paste a rectangular matrix as one atomic, undoable operation, preserving
   * the copied shape. The paste starts at the selected range's top-left cell
   * (the active cell when only one cell is selected). When a
   * larger destination range is selected and each of its dimensions is an
   * exact multiple of the source's, the source pattern repeats to fill the
   * whole selected destination (documented behavior; otherwise the range is
   * pasted once at the range's top-left cell). For byte-preserving CSV documents the
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
    // A selected range anchors the paste at its top-left corner, wherever
    // the active cell sits inside it. Pattern-repeat: fill a larger selected
    // destination when its dimensions are exact multiples of the source's.
    let at = tab.selection;
    let height = srcH;
    let width = srcW;
    const dest = this.state.selectedRange(tab);
    if (dest) {
      at = { row: dest.top, col: dest.left };
      const destRows = dest.bottom - dest.top + 1;
      const destCols = dest.right - dest.left + 1;
      if (
        (destRows > srcH || destCols > srcW) &&
        destRows % srcH === 0 &&
        destCols % srcW === 0 &&
        destRows >= srcH &&
        destCols >= srcW
      ) {
        height = destRows;
        width = destCols;
      }
    }
    const containsFormula = matrix.some((row) => row.some((v) => isFormula(v)));

    if (isCsv(tab.doc)) {
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
              pct(done, total),
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
    if (isCsv(doc)) {
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
    if (isCsv(doc)) {
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
  notifyHiddenRowsSkipped(top: number, bottom: number, hidden: Set<number> | null): void {
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
   * Edit > Insert Copied > Insert Copied Cells…: insert the most recently
   * copied range at the selection, shifting existing cells right (whole
   * columns) or down (whole rows). Structural insertion is a spreadsheet
   * operation, so a plain CSV document requires the explicit RSF conversion
   * first (the confirmation dialog explains why); declining leaves the
   * document untouched.
   */
  insertCopiedCells(tab: Tab): Promise<boolean> {
    return this.insertCopied.insertCopiedCells(tab);
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
  insertCopiedAxis(tab: Tab, axis: 'rows' | 'cols'): Promise<boolean> {
    return this.insertCopied.insertCopiedAxis(tab, axis);
  }

  /**
   * Fill Down: the top row of the current selection is copied into the rows
   * below it (within the selection). Requires a selection spanning at least
   * two rows.
   */
  fillDown(tab: Tab): Promise<boolean> {
    return this.fill.fillDown(tab);
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
  applyFill(tab: Tab, source: CellRange, dest: CellRange): Promise<boolean> {
    return this.fill.applyFill(tab, source, dest);
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
  flashFill(tab: Tab): Promise<boolean> {
    return this.fill.flashFill(tab);
  }
}
