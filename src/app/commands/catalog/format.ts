// SPDX-License-Identifier: MIT
/** Cell formatting commands (`format.*`). */
import { isWorkbook } from '../../../core/editor-document';
import { t } from '../../i18n';
import { hasSelection, type CommandContext, type CommandSpec } from './types';

/**
 * Formatting is RSF-only, like sort/filter, but (unlike them) there is no
 * dialog to run and explain the required conversion from — toggling Bold on
 * a CSV tab would just silently do nothing — so it is disabled outright, with
 * a tooltip saying why.
 */
export function workbookFormatting(run: CommandSpec['run']): CommandSpec {
  return {
    enabled: (ctx) => isWorkbook(ctx.tab?.doc) && hasSelection(ctx),
    disabledReason: (ctx: CommandContext) =>
      ctx.tab !== null && !isWorkbook(ctx.tab.doc) ? t('menu.format.csvOnlyTooltip') : null,
    run,
  };
}

export const FORMAT_COMMANDS = {
  'format.bold': workbookFormatting(({ tab, commands }) => tab && commands.toggleBold(tab)),
  'format.italic': workbookFormatting(({ tab, commands }) => tab && commands.toggleItalic(tab)),
  'format.underline': workbookFormatting(({ tab, commands }) => tab && commands.toggleUnderline(tab)),
  'format.textColor': workbookFormatting(({ tab, commands }) => tab && commands.promptTextColor(tab)),
  'format.backgroundColor': workbookFormatting(
    ({ tab, commands }) => tab && commands.promptBackgroundColor(tab),
  ),
  'format.borders': workbookFormatting(({ tab, commands }) => tab && commands.promptBorders(tab)),
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
    enabled: hasSelection,
    run: ({ tab, commands }) => tab && commands.conditionalFormatDialog(tab),
  },
} satisfies Record<string, CommandSpec>;
