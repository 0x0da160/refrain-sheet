// SPDX-License-Identifier: MIT
/** Edit commands (`edit.*`): undo/redo, clipboard, fill, insert, revert. */
import { isCsv } from '../../../core/editor-document';
import { t } from '../../i18n';
import { localDateStamp } from '../../shortcuts';
import { workbookFormatting } from './format';
import { hasSelection, withTab, type CommandContext, type CommandSpec } from './types';

const copiedKind = (ctx: CommandContext) => ctx.commands.clipboardActions?.copiedKind() ?? null;

/** Insert today's date or the current time into the active cell (Ctrl+; / Ctrl+Shift+;). */
function insertStamp(kind: 'date' | 'time'): CommandSpec {
  return {
    enabled: hasSelection,
    run: async ({ tab, commands }) => {
      if (tab?.selection) {
        const { row, col } = tab.selection;
        await commands.commitCellEdit(tab, row, col, localDateStamp(kind));
      }
    },
  };
}

export const EDIT_COMMANDS = {
  'edit.undo': withTab(
    (ctx, tab) => ctx.state.undo(tab),
    (_, tab) => tab.history.canUndo,
  ),
  'edit.redo': withTab(
    (ctx, tab) => ctx.state.redo(tab),
    (_, tab) => tab.history.canRedo,
  ),
  'edit.cut': { enabled: hasSelection, run: (ctx) => ctx.commands.clipboardActions?.cut() },
  'edit.copy': { enabled: hasSelection, run: (ctx) => ctx.commands.clipboardActions?.copy() },
  // The async Clipboard API's image write has inconsistent browser support
  // (including on file://), so the item is disabled outright there rather
  // than failing at run time.
  'edit.copyScreenshot': {
    enabled: (ctx) =>
      hasSelection(ctx) &&
      typeof ClipboardItem !== 'undefined' &&
      typeof navigator.clipboard?.write === 'function',
    run: (ctx) => ctx.commands.clipboardActions?.copyScreenshot(),
  },
  'edit.copyAsMarkdown': {
    enabled: hasSelection,
    run: (ctx) => ctx.commands.clipboardActions?.copyAsMarkdown(),
  },
  'edit.paste': { enabled: hasSelection, run: (ctx) => ctx.commands.clipboardActions?.paste() },
  'edit.pasteValues': { enabled: hasSelection, run: (ctx) => ctx.commands.clipboardActions?.pasteValues() },
  'edit.pasteFormats': workbookFormatting((ctx) => ctx.commands.clipboardActions?.pasteFormats()),
  'edit.insertDate': insertStamp('date'),
  'edit.insertTime': insertStamp('time'),
  // The Insert Copied … commands additionally require a compatible kind in
  // the internal (in-app) clipboard: Cells accepts any copied kind;
  // Rows/Columns require a matching whole-row/whole-column copy. Nothing
  // copied yet (or a copy of the wrong kind) disables the item outright.
  'edit.insertCopiedCells': {
    enabled: (ctx) => hasSelection(ctx) && copiedKind(ctx) !== null,
    run: ({ tab, commands }) => tab && commands.insertCopiedCells(tab),
  },
  'edit.insertCopiedRows': {
    enabled: (ctx) => hasSelection(ctx) && copiedKind(ctx) === 'row',
    run: ({ tab, commands }) => tab && commands.insertCopiedAxis(tab, 'rows'),
  },
  'edit.insertCopiedCols': {
    enabled: (ctx) => hasSelection(ctx) && copiedKind(ctx) === 'col',
    run: ({ tab, commands }) => tab && commands.insertCopiedAxis(tab, 'cols'),
  },
  'edit.selectAll': withTab((ctx, tab) => ctx.commands.selectAllCells(tab)),
  'edit.revertCell': {
    enabled: ({ tab }) =>
      tab?.selection != null && isCsv(tab.doc) && tab.doc.isEdited(tab.selection.row, tab.selection.col),
    run: ({ tab, state }) => tab?.selection && state.revertCell(tab, tab.selection.row, tab.selection.col),
  },
  'edit.revertAll': withTab(
    (ctx, tab) => {
      if (ctx.state.revertAll(tab)) ctx.ui.notify(t('notify.reverted'), 'info');
    },
    (_, tab) => isCsv(tab.doc) && tab.doc.isDirty,
  ),
  // Flash Fill and Move Range stay clickable on a CSV tab: running one
  // explains that it needs an RSF spreadsheet document and offers to convert.
  'edit.fillDown': { enabled: hasSelection, run: ({ tab, commands }) => tab && commands.fillDown(tab) },
  'edit.flashFill': { enabled: hasSelection, run: ({ tab, commands }) => tab && commands.flashFill(tab) },
  'edit.moveRange': {
    enabled: hasSelection,
    run: ({ tab, commands }) => tab && commands.promptAndMoveRange(tab),
  },
} satisfies Record<string, CommandSpec>;
