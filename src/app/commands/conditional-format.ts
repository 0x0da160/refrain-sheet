// SPDX-License-Identifier: MIT
import {
  conditionalFormatRangesEqual,
  validateConditionalFormat,
  MAX_CONDITIONAL_FORMAT_RULES,
} from '../../core/conditional-format';
import { cellLabel } from '../../core/formula';
import { AppState, type Tab } from '../app-state';
import { t } from '../i18n';
import type { ConditionalFormatDialogInput, UiPort } from '../commands';

/**
 * Conditional-formatting commands for RSF spreadsheet documents: the dialog
 * flow for applying or clearing a rule on the selected range. Extracted from
 * `Commands` as a cohesive slice, mirroring `ValidationCommands`
 * (`src/app/commands/data-validation.ts`) — `Commands` still exposes the same
 * public methods, delegating to an instance of this class. This is the
 * `Commands`-layer dispatch code, distinct from (and a consumer of) the pure
 * logic in `src/core/conditional-format.ts`.
 *
 * Like data validation, a worksheet's rules are session-only view state (see
 * `Worksheet.conditionalFormats`): applying or clearing one is a direct state
 * change, not a `HistoryEntry` — never undoable and never marks the document
 * dirty.
 */
export class ConditionalFormatCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
  ) {}

  /**
   * Format > Conditional Formatting…: open the dialog for the selected range
   * and apply the result as one (non-undoable) view-state change.
   *
   * RSF-only: on a plain CSV document a localized message explains that
   * conditional formatting requires the explicit conversion to RSF, and
   * nothing changes. The range is the current selection (1x1 when nothing is
   * dragged out); when a rule already covers that exact range, the dialog
   * preloads it for editing and offers a Clear button.
   */
  async conditionalFormatDialog(tab: Tab): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    if (tab.doc.kind !== 'rsf') {
      await this.ui.showMessage(t('dialog.conditionalFormat.title'), t('dialog.conditionalFormat.csvOnly'));
      return false;
    }
    const doc = tab.doc;
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    const existing = this.state.conditionalFormatForRange(tab, range);

    const input: ConditionalFormatDialogInput = {
      rangeLabel: `${cellLabel(range.top, range.left)}:${cellLabel(range.bottom, range.right)}`,
      existing: existing?.rule ?? null,
    };
    const result = await this.ui.chooseConditionalFormat(input);
    if (!result || tab.doc !== doc) {
      return false; // cancelled (or replaced document): nothing changes
    }
    if (result.action === 'clear') {
      const applied = this.state.clearConditionalFormat(tab, range);
      if (applied) {
        this.ui.notify(t('notify.conditionalFormatCleared'), 'info');
      }
      return applied;
    }

    const candidate = validateConditionalFormat({ ...range, rule: result.rule }, doc.rowCount, doc.columnCount);
    if (!candidate) {
      await this.ui.showMessage(t('dialog.conditionalFormat.title'), t('dialog.conditionalFormat.invalid'));
      return false;
    }
    const replacingExisting = doc.conditionalFormats.some((cf) => conditionalFormatRangesEqual(cf, range));
    if (!replacingExisting && doc.conditionalFormats.length >= MAX_CONDITIONAL_FORMAT_RULES) {
      await this.ui.showMessage(t('dialog.conditionalFormat.title'), t('dialog.conditionalFormat.tooMany'));
      return false;
    }
    const applied = this.state.setConditionalFormat(tab, candidate);
    if (applied) {
      this.ui.notify(t('notify.conditionalFormatApplied'), 'info');
    }
    return applied;
  }
}
