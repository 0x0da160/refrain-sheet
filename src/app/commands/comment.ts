// SPDX-License-Identifier: MIT
import { normalizeCommentText } from '../../core/cell-comment';
import { cellLabel } from '../../core/formula';
import { AppState, type Tab } from '../app-state';
import { t } from '../i18n';
import type { CellCommentDialogInput, UiPort } from '../commands';

/**
 * Cell-comment commands for RSF spreadsheet documents: the dialog flow for
 * adding, editing, or clearing the comment on the active cell. Extracted
 * from `Commands` as a cohesive slice, mirroring `ValidationCommands`
 * (`src/app/commands/data-validation.ts`) — `Commands` still exposes the
 * same public methods, delegating to an instance of this class. This is the
 * `Commands`-layer dispatch code, distinct from (and a consumer of) the pure
 * logic in `src/core/cell-comment.ts`.
 *
 * Like data validation, a worksheet's comments are session-only view state
 * (see `Worksheet` comment storage): setting or clearing one is a direct
 * state change, not a `HistoryEntry` — never undoable and never marks the
 * document dirty.
 */
export class CommentCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
  ) {}

  /** The comment on one cell of the active worksheet, or null. */
  commentAt(tab: Tab, row: number, col: number): string | null {
    return this.state.commentAt(tab, row, col);
  }

  /**
   * Insert/Edit Comment: open the dialog for the active cell and apply the
   * result as one (non-undoable) view-state change.
   *
   * RSF-only: on a plain CSV document a localized message explains that
   * cell comments require the explicit conversion to RSF, and nothing
   * changes. The target is the active cell (`tab.selection`), matching
   * every mainstream spreadsheet's single-cell comment model even when a
   * larger range is selected.
   */
  async commentDialog(tab: Tab): Promise<boolean> {
    const cell = tab.selection;
    if (!cell) {
      return false;
    }
    if (tab.doc.kind !== 'rsf') {
      await this.ui.showMessage(t('dialog.cellComment.title'), t('dialog.cellComment.csvOnly'));
      return false;
    }
    const doc = tab.doc;
    const existing = doc.getComment(cell.row, cell.col);

    const input: CellCommentDialogInput = {
      cellLabel: cellLabel(cell.row, cell.col),
      existing,
    };
    const result = await this.ui.chooseCellComment(input);
    if (!result || tab.doc !== doc) {
      return false; // cancelled (or replaced document): nothing changes
    }
    if (result.action === 'clear') {
      const applied = this.state.clearComment(tab, cell.row, cell.col);
      if (applied) {
        this.ui.notify(t('notify.commentCleared'), 'info');
      }
      return applied;
    }

    const text = normalizeCommentText(result.text);
    if (text === null) {
      const applied = this.state.clearComment(tab, cell.row, cell.col);
      if (applied) {
        this.ui.notify(t('notify.commentCleared'), 'info');
      }
      return applied;
    }
    const applied = this.state.setComment(tab, cell.row, cell.col, text);
    if (applied) {
      this.ui.notify(t('notify.commentApplied'), 'info');
    }
    return applied;
  }
}
