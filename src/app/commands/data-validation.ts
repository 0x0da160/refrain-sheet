// SPDX-License-Identifier: MIT
import {
  validateValidation,
  validationRangesEqual,
  MAX_VALIDATION_RULES,
  type CellValidation,
} from '../../core/data-validation';
import { cellLabel } from '../../core/formula';
import type { RsfDocument } from '../../core/rsf-document';
import type { AppState, Tab } from '../app-state';
import { t } from '../i18n';
import type {
  ConvertReason,
  DataValidationDialogInput,
  DataValidationDialogResult,
  UiPort,
} from '../commands';
import { applyWhileOpen } from './shared';

/**
 * Data-validation commands for RSF spreadsheet documents: the dialog flow
 * for applying or clearing a rule on the selected range, and the query used
 * by the grid to show a value picker. Extracted from `Commands` as a
 * cohesive slice, mirroring `SortCommands` (`src/app/commands/sort.ts`) —
 * `Commands` still exposes the same public methods, delegating to an
 * instance of this class. This is the `Commands`-layer dispatch code,
 * distinct from (and a consumer of) the pure logic in
 * `src/core/data-validation.ts`.
 *
 * Like sorting, a worksheet's rules are session-only view state (see
 * `Worksheet.validations`): applying or clearing one is a direct state
 * change, not a `HistoryEntry` — never undoable and never marks the document
 * dirty. Writing a value that violates the rule covering its cell is refused
 * by `AppState` (`refuseInvalidWrite`), the same way `refuseSortedWrite`
 * protects a sorted range.
 */
export class ValidationCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly ensureRsf: (tab: Tab, reason: ConvertReason) => Promise<RsfDocument | null>,
  ) {}

  /** The rule applying to one cell on the active worksheet, or null. */
  validationAt(tab: Tab, row: number, col: number): CellValidation | null {
    return this.state.validationAt(tab, row, col);
  }

  /**
   * Data > Data Validation…: open the dialog for the selected range and
   * apply the result as one (non-undoable) view-state change.
   *
   * RSF-only: on a plain CSV document the explicit-conversion dialog explains
   * that data validation requires converting to RSF and offers to do so
   * right there (`ensureRsf`, same pattern as paste/fill); declining leaves
   * the document unchanged. The range is the current selection (1x1 when nothing is
   * dragged out); when a rule already covers that exact range, the dialog
   * preloads it for editing and offers a Clear button.
   */
  async validationDialog(tab: Tab): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    const doc = await this.ensureRsf(tab, 'validation');
    if (!doc) {
      return false;
    }
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    const existing = this.state.validationForRange(tab, range);

    const input: DataValidationDialogInput = {
      rangeLabel: `${cellLabel(range.top, range.left)}:${cellLabel(range.bottom, range.right)}`,
      existing: existing?.rule ?? null,
    };
    const sheet = doc.activeSheet;
    return applyWhileOpen<DataValidationDialogResult>(
      (onApply) => this.ui.chooseDataValidation(input, onApply),
      async (result) => {
        if (tab.doc !== doc || this.state.activeTab !== tab || doc.activeSheet !== sheet) {
          return false; // replaced document, or the user switched away: nothing changes
        }
        if (result.action === 'clear') {
          const applied = this.state.clearValidation(tab, range);
          if (applied) {
            this.ui.notify(t('notify.validationCleared'), 'info');
          }
          return applied;
        }

        const candidate = validateValidation({ ...range, rule: result.rule }, doc.rowCount, doc.columnCount);
        if (!candidate) {
          await this.ui.showMessage(t('dialog.dataValidation.title'), t('dialog.dataValidation.invalid'));
          return false;
        }
        const replacingExisting = doc.validations.some((v) => validationRangesEqual(v, range));
        if (!replacingExisting && doc.validations.length >= MAX_VALIDATION_RULES) {
          await this.ui.showMessage(t('dialog.dataValidation.title'), t('dialog.dataValidation.tooMany'));
          return false;
        }
        const applied = this.state.setValidation(tab, candidate);
        if (applied) {
          this.ui.notify(t('notify.validationApplied'), 'info');
        }
        return applied;
      },
    );
  }
}
