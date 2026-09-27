// SPDX-License-Identifier: MIT
/** Find, replace, and Go to Cell (`search.*`). */
import { cellLabel, columnLabel, parseRef } from '../../../core/formula';
import { t } from '../../i18n';
import type { Tab } from '../../state';
import { hasTab, withTab, type CommandContext, type CommandSpec } from './types';

/**
 * "Go to Cell…": jump the selection straight to any cell reference (e.g.
 * "B12"). Unlike Move Selected Cells, this only moves the selection — it works
 * on CSV tabs too, and nothing is written to the document, so it needs no
 * history entry.
 */
async function promptAndGoToCell(ctx: CommandContext, tab: Tab): Promise<void> {
  const doc = tab.doc;
  const validate = (text: string): string | null => {
    const at = parseRef(text.trim());
    if (!at) {
      return t('goToCell.error.invalid');
    }
    if (at.row >= doc.rowCount || at.col >= doc.columnCount) {
      return t('goToCell.error.outOfBounds', {
        rows: doc.rowCount,
        cols: columnLabel(doc.columnCount - 1),
      });
    }
    return null;
  };
  const current = ctx.state.selectedRange(tab);
  const suggestion = current ? cellLabel(current.top, current.left) : 'A1';
  const answer = await ctx.ui.promptGoToCell(suggestion, validate);
  if (answer === null) {
    return;
  }
  const at = parseRef(answer.trim());
  if (!at || validate(answer) !== null || tab.doc !== doc) {
    return;
  }
  ctx.commands.gridActions?.goToCell(at.row, at.col);
}

export const SEARCH_COMMANDS = {
  'search.find': { enabled: hasTab, run: (ctx) => ctx.ui.openFindBar(false) },
  'search.replace': { enabled: hasTab, run: (ctx) => ctx.ui.openFindBar(true) },
  'search.findNext': { enabled: hasTab, run: (ctx) => ctx.ui.findNext(1) },
  'search.findPrev': { enabled: hasTab, run: (ctx) => ctx.ui.findNext(-1) },
  'search.goToCell': withTab(promptAndGoToCell),
} satisfies Record<string, CommandSpec>;
