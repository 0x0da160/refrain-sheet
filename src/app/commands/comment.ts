// SPDX-License-Identifier: MIT
import { normalizeCommentText } from '../../core/cell-comment';
import { cellLabel } from '../../core/formula';
import type { CommentChange } from '../../core/history';
import type { RsfDocument } from '../../core/rsf-document';
import { AppState, type Tab } from '../app-state';
import { t } from '../i18n';
import type { CellCommentDialogInput, ConvertReason, UiPort } from '../commands';

/**
 * Cell-comment commands for RSF spreadsheet documents: the dialog flow for
 * adding, editing, or clearing the comment on the active cell. Extracted
 * from `Commands` as a cohesive slice, mirroring `ValidationCommands`
 * (`src/app/commands/data-validation.ts`) — `Commands` still exposes the
 * same public methods, delegating to an instance of this class. This is the
 * `Commands`-layer dispatch code, distinct from (and a consumer of) the pure
 * logic in `src/core/cell-comment.ts`.
 *
 * Unlike data validation, comments are persisted in the saved container (RSF
 * body version 11+, see `src/core/rsf-codec.ts`): setting or clearing one is
 * an ordinary undoable `HistoryEntry` that marks the document dirty, built
 * and applied the same way `FormatCommands.applyPatch` builds a `'styles'`
 * operation (`src/app/commands/format.ts`).
 */
export class CommentCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly ensureRsf: (tab: Tab, reason: ConvertReason) => Promise<RsfDocument | null>,
  ) {}

  /** The comment on one cell of the active worksheet, or null. */
  commentAt(tab: Tab, row: number, col: number): string | null {
    return this.state.commentAt(tab, row, col);
  }

  /** Set (or clear, with `null`) one cell's comment on the active worksheet, undoably. */
  setComment(tab: Tab, row: number, col: number, text: string | null): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const before = doc.getComment(row, col);
    if (before === text) {
      return false;
    }
    const sheetId = doc.activeSheetId;
    const changes: CommentChange[] = [{ row, col, before, after: text }];
    return this.state.pushEntry(tab, {
      label: text === null ? 'history.clearComment' : 'history.setComment',
      sheetId,
      ops: [{ type: 'comments', changes, sheetId }],
    });
  }

  /**
   * Insert/Edit Comment: open the dialog for the active cell and apply the
   * result as one undoable history entry.
   *
   * RSF-only: on a plain CSV document the explicit-conversion dialog explains
   * that cell comments require converting to RSF and offers to do so right
   * there (`ensureRsf`, same pattern as paste/fill); declining leaves the
   * document unchanged. The target is the active cell (`tab.selection`), matching
   * every mainstream spreadsheet's single-cell comment model even when a
   * larger range is selected.
   */
  async commentDialog(tab: Tab): Promise<boolean> {
    const cell = tab.selection;
    if (!cell) {
      return false;
    }
    const doc = await this.ensureRsf(tab, 'comment');
    if (!doc) {
      return false;
    }
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
      const applied = this.setComment(tab, cell.row, cell.col, null);
      if (applied) {
        this.ui.notify(t('notify.commentCleared'), 'info');
      }
      return applied;
    }

    const text = normalizeCommentText(result.text);
    const applied = this.setComment(tab, cell.row, cell.col, text);
    if (applied) {
      this.ui.notify(text === null ? t('notify.commentCleared') : t('notify.commentApplied'), 'info');
    }
    return applied;
  }
}
