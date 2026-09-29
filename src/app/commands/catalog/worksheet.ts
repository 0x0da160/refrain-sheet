// SPDX-License-Identifier: MIT
/**
 * Worksheet commands (`worksheet.*`) — the worksheets inside the active RSF
 * workbook, distinct from the application's document tabs (`tab.*`).
 * Worksheet commands need an RSF workbook: plain CSV is a single-sheet,
 * byte-preserving document, so they are disabled there (the UI explains that
 * instead of hiding them).
 */
import { workbookOf } from '../../../core/editor-document';
import type { RsfDocument } from '../../../core/workbook/rsf-document';
import type { Tab } from '../../state';
import type { CommandContext, CommandSpec } from './types';

function onWorkbook(
  run: (ctx: CommandContext, tab: Tab) => unknown,
  enabled: (doc: RsfDocument) => boolean = () => true,
): CommandSpec {
  return {
    enabled: ({ tab }) => {
      const doc = workbookOf(tab?.doc);
      return doc !== null && enabled(doc);
    },
    run: (ctx) => (ctx.tab ? run(ctx, ctx.tab) : undefined),
  };
}

const severalSheets = (doc: RsfDocument): boolean => doc.sheetCount > 1;
const notFirst = (doc: RsfDocument): boolean => doc.sheetIndex(doc.activeSheetId) > 0;
const notLast = (doc: RsfDocument): boolean => doc.sheetIndex(doc.activeSheetId) < doc.sheetCount - 1;

export const WORKSHEET_COMMANDS = {
  'worksheet.add': onWorkbook(({ parts }, tab) => parts.worksheets.addWorksheet(tab)),
  'worksheet.addPaper': onWorkbook(({ parts }, tab) => parts.worksheets.addPaperWorksheet(tab)),
  'worksheet.addMarkdown': onWorkbook(({ parts }, tab) => parts.worksheets.addMarkdownWorksheet(tab)),
  'worksheet.addJson': onWorkbook(({ parts }, tab) => parts.worksheets.addJsonWorksheet(tab)),
  'worksheet.addYaml': onWorkbook(({ parts }, tab) => parts.worksheets.addYamlWorksheet(tab)),
  'worksheet.addText': onWorkbook(({ parts }, tab) => parts.worksheets.addTextWorksheet(tab)),
  'worksheet.rename': onWorkbook(({ parts }, tab) => parts.worksheets.renameWorksheet(tab)),
  'worksheet.tabColor': onWorkbook(({ parts }, tab) => parts.worksheets.chooseTabColor(tab)),
  'worksheet.newFolder': onWorkbook(({ parts }, tab) => parts.folders.newFolder(tab)),
  'worksheet.moveToFolder': onWorkbook(
    ({ parts }, tab) => parts.folders.moveSheetToFolder(tab),
    (doc) => doc.folders.length > 0,
  ),
  'worksheet.duplicate': onWorkbook(({ parts }, tab) => parts.worksheets.duplicateWorksheet(tab)),
  // A workbook always keeps at least one worksheet.
  'worksheet.delete': onWorkbook(({ parts }, tab) => parts.worksheets.deleteWorksheet(tab), severalSheets),
  'worksheet.moveLeft': onWorkbook(
    ({ parts }, tab) => parts.worksheets.moveActiveWorksheet(tab, 'worksheet.moveLeft'),
    notFirst,
  ),
  'worksheet.moveRight': onWorkbook(
    ({ parts }, tab) => parts.worksheets.moveActiveWorksheet(tab, 'worksheet.moveRight'),
    notLast,
  ),
  'worksheet.moveFirst': onWorkbook(
    ({ parts }, tab) => parts.worksheets.moveActiveWorksheet(tab, 'worksheet.moveFirst'),
    notFirst,
  ),
  'worksheet.moveLast': onWorkbook(
    ({ parts }, tab) => parts.worksheets.moveActiveWorksheet(tab, 'worksheet.moveLast'),
    notLast,
  ),
  'worksheet.next': onWorkbook(({ parts }, tab) => parts.worksheets.cycleWorksheet(tab, 1), severalSheets),
  'worksheet.prev': onWorkbook(({ parts }, tab) => parts.worksheets.cycleWorksheet(tab, -1), severalSheets),
  'worksheet.toggleLock': onWorkbook(({ state }, tab) => {
    const doc = workbookOf(tab.doc);
    if (doc) {
      state.setSheetLocked(tab, doc.activeSheetId, !doc.activeSheet.locked);
    }
  }),
} satisfies Record<string, CommandSpec>;
