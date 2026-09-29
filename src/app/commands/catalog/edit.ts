// SPDX-License-Identifier: MIT
/** Edit commands (`edit.*`): undo/redo, clipboard, fill, insert, revert. */
import { isCsv } from '../../../core/editor-document';
import { t } from '../../i18n';
import { localDateStamp } from '../../shortcuts';
import { workbookFormatting } from './format';
import {
  hasCellSelection,
  hasGridSelection,
  sceneOf,
  withTab,
  type CommandContext,
  type CommandSpec,
} from './types';

const copiedKind = (ctx: CommandContext) => ctx.commands.clipboardActions?.copiedKind() ?? null;

/**
 * Cut, Copy and Paste: on cells (or picked shapes) as usual; on a Markdown,
 * JSON, YAML or text sheet they act on its text editor instead (see
 * `clipboardActions`), never on the cell that stores the whole text.
 */
const clipboardTarget = (ctx: CommandContext): boolean =>
  hasGridSelection(ctx) || sceneOf(ctx.tab) === 'text';

/** Insert today's date or the current time into the active cell (Ctrl+; / Ctrl+Shift+;). */
function insertStamp(kind: 'date' | 'time'): CommandSpec {
  return {
    enabled: hasCellSelection,
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
  'edit.cut': { enabled: clipboardTarget, run: (ctx) => ctx.commands.clipboardActions?.cut() },
  'edit.copy': { enabled: clipboardTarget, run: (ctx) => ctx.commands.clipboardActions?.copy() },
  // The async Clipboard API's image write has inconsistent browser support
  // (including on file://), so the item is disabled outright there rather
  // than failing at run time.
  'edit.copyScreenshot': {
    enabled: (ctx) =>
      hasCellSelection(ctx) &&
      typeof ClipboardItem !== 'undefined' &&
      typeof navigator.clipboard?.write === 'function',
    run: (ctx) => ctx.commands.clipboardActions?.copyScreenshot(),
  },
  'edit.copyAsMarkdown': {
    enabled: hasCellSelection,
    run: (ctx) => ctx.commands.clipboardActions?.copyAsMarkdown(),
  },
  'edit.paste': { enabled: clipboardTarget, run: (ctx) => ctx.commands.clipboardActions?.paste() },
  'edit.pasteValues': {
    enabled: hasCellSelection,
    run: (ctx) => ctx.commands.clipboardActions?.pasteValues(),
  },
  'edit.pasteFormats': workbookFormatting((ctx) => ctx.commands.clipboardActions?.pasteFormats()),
  'edit.insertDate': insertStamp('date'),
  'edit.insertTime': insertStamp('time'),
  // The Insert Copied … commands additionally require a compatible kind in
  // the internal (in-app) clipboard: Cells accepts any copied kind;
  // Rows/Columns require a matching whole-row/whole-column copy. Nothing
  // copied yet (or a copy of the wrong kind) disables the item outright.
  'edit.insertCopiedCells': {
    enabled: (ctx) => hasCellSelection(ctx) && copiedKind(ctx) !== null,
    run: ({ tab, commands }) => tab && commands.insertCopiedCells(tab),
  },
  'edit.insertCopiedRows': {
    enabled: (ctx) => hasCellSelection(ctx) && copiedKind(ctx) === 'row',
    run: ({ tab, commands }) => tab && commands.insertCopiedAxis(tab, 'rows'),
  },
  'edit.insertCopiedCols': {
    enabled: (ctx) => hasCellSelection(ctx) && copiedKind(ctx) === 'col',
    run: ({ tab, commands }) => tab && commands.insertCopiedAxis(tab, 'cols'),
  },
  'edit.selectAll': withTab(
    (ctx, tab) => ctx.commands.selectAllCells(tab),
    (_, tab) => sceneOf(tab) !== 'text',
  ),
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
  'edit.fillDown': { enabled: hasCellSelection, run: ({ tab, commands }) => tab && commands.fillDown(tab) },
  'edit.flashFill': { enabled: hasCellSelection, run: ({ tab, commands }) => tab && commands.flashFill(tab) },
  'edit.moveRange': {
    enabled: hasCellSelection,
    run: ({ tab, commands }) => tab && commands.promptAndMoveRange(tab),
  },
} satisfies Record<string, CommandSpec>;
