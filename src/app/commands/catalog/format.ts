// SPDX-License-Identifier: MIT
/** Cell formatting commands (`format.*`). */
import { t } from '../../i18n';
import { promptRowHeight } from '../row-height';
import { hasCellSelection, hasSelection, sceneOf, type CommandContext, type CommandSpec } from './types';

/**
 * Why cell formatting does not apply here, or null when it does. Formatting
 * needs an RSF sheet of cells: a CSV has none (and, unlike sort/filter, no
 * dialog to run and explain the conversion from — toggling Bold there would
 * silently do nothing), a Markdown/JSON/YAML/text sheet has no cells, grid
 * paper's squares take no formatting, and picked shapes are formatted in
 * their own panel rather than the cell under them.
 */
function formattingBlocked(ctx: CommandContext): string | null {
  switch (sceneOf(ctx.tab)) {
    case 'none':
      return null;
    case 'csv':
      return t('menu.format.csvOnlyTooltip');
    case 'text':
      return t('menu.format.textSheetTooltip');
    case 'paper':
      return t('menu.format.paperTooltip');
    case 'grid':
      return ctx.tab && ctx.state.objectSelection.selected(ctx.tab).length > 0
        ? t('menu.format.objectsTooltip')
        : null;
  }
}

/** A cell-formatting command: enabled only on selected cells of an RSF sheet of cells (see {@link formattingBlocked}). */
export function workbookFormatting(run: CommandSpec['run']): CommandSpec {
  return {
    enabled: (ctx) => sceneOf(ctx.tab) === 'grid' && hasSelection(ctx) && formattingBlocked(ctx) === null,
    disabledReason: formattingBlocked,
    run,
  };
}

export const FORMAT_COMMANDS = {
  'format.bold': workbookFormatting(({ tab, commands }) => tab && commands.toggleBold(tab)),
  'format.italic': workbookFormatting(({ tab, commands }) => tab && commands.toggleItalic(tab)),
  'format.underline': workbookFormatting(({ tab, commands }) => tab && commands.toggleUnderline(tab)),
  'format.alignLeft': workbookFormatting(
    ({ tab, commands }) => tab && commands.setHorizontalAlign(tab, 'left'),
  ),
  'format.alignCenter': workbookFormatting(
    ({ tab, commands }) => tab && commands.setHorizontalAlign(tab, 'center'),
  ),
  'format.alignRight': workbookFormatting(
    ({ tab, commands }) => tab && commands.setHorizontalAlign(tab, 'right'),
  ),
  'format.alignTop': workbookFormatting(({ tab, commands }) => tab && commands.setVerticalAlign(tab, 'top')),
  'format.alignMiddle': workbookFormatting(
    ({ tab, commands }) => tab && commands.setVerticalAlign(tab, 'middle'),
  ),
  'format.alignBottom': workbookFormatting(
    ({ tab, commands }) => tab && commands.setVerticalAlign(tab, 'bottom'),
  ),
  'format.rowHeight': workbookFormatting(({ tab, state, ui }) => tab && promptRowHeight(state, ui, tab)),
  'format.textColor': workbookFormatting(({ tab, commands }) => tab && commands.promptTextColor(tab)),
  'format.backgroundColor': workbookFormatting(
    ({ tab, commands }) => tab && commands.promptBackgroundColor(tab),
  ),
  'format.borders': workbookFormatting(({ tab, commands }) => tab && commands.promptBorders(tab)),
  'format.font': workbookFormatting(({ tab, commands }) => tab && commands.promptFont(tab)),
  'format.numberFormat': workbookFormatting(({ tab, commands }) => tab && commands.promptNumberFormat(tab)),
  'format.clear': workbookFormatting(({ tab, commands }) => tab && commands.clearFormatting(tab)),
  'format.presetNumber': workbookFormatting(
    ({ tab, parts }) => tab && parts.format.applyNumberPreset(tab, 'number'),
  ),
  'format.presetCurrency': workbookFormatting(
    ({ tab, parts }) => tab && parts.format.applyNumberPreset(tab, 'currency'),
  ),
  'format.presetPercent': workbookFormatting(
    ({ tab, parts }) => tab && parts.format.applyNumberPreset(tab, 'percent'),
  ),
  // Stays clickable on a CSV tab: running it explains that it needs an RSF
  // spreadsheet document and offers to convert right there.
  'format.conditionalFormatting': {
    enabled: hasCellSelection,
    run: ({ tab, commands }) => tab && commands.conditionalFormatDialog(tab),
  },
} satisfies Record<string, CommandSpec>;
