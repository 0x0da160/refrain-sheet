// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Characterization of the command surface: for every command id and a fixed
 * set of tab situations, what `isEnabled` and `disabledReason` answer. The
 * snapshot is the behaviour the command layer had before it was restructured
 * (docs/proposals/structural-refactoring-plan.md, R0); any change to it must
 * be a deliberate, reviewed behaviour change.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, COMMAND_IDS as CATALOG_IDS, type CommandId, type UiPort } from '../../src/app/commands';
import { setLocale } from '../../src/app/i18n';
import { utf8 } from '../helpers';

const COMMAND_IDS: readonly CommandId[] = [
  'file.new',
  'file.newCsv',
  'file.open',
  'file.openRecent',
  'file.importJsonTable',
  'file.reopen',
  'file.toggleProtect',
  'file.save',
  'file.saveOptions',
  'file.print',
  'file.closeTab',
  'drive.open',
  'drive.save',
  'drive.saveAs',
  'drive.signOut',
  'edit.undo',
  'edit.redo',
  'edit.cut',
  'edit.copy',
  'edit.copyScreenshot',
  'edit.copyAsMarkdown',
  'edit.paste',
  'edit.pasteValues',
  'edit.pasteFormats',
  'edit.insertDate',
  'edit.insertTime',
  'edit.insertCopiedCells',
  'edit.insertCopiedRows',
  'edit.insertCopiedCols',
  'edit.selectAll',
  'edit.revertCell',
  'edit.revertAll',
  'edit.fillDown',
  'edit.flashFill',
  'edit.moveRange',
  'search.find',
  'search.replace',
  'search.findNext',
  'search.findPrev',
  'search.goToCell',
  'sheet.convert',
  'sheet.insertRowAbove',
  'sheet.insertRowBelow',
  'sheet.deleteRows',
  'sheet.insertColLeft',
  'sheet.insertColRight',
  'sheet.deleteCols',
  'sheet.addRow',
  'sheet.addColumn',
  'sheet.autoFitCols',
  'sheet.filter',
  'sheet.filterClear',
  'sheet.headerFilter',
  'sheet.sort',
  'sheet.sortClear',
  'format.bold',
  'format.italic',
  'format.underline',
  'format.textColor',
  'format.backgroundColor',
  'format.borders',
  'format.numberFormat',
  'format.conditionalFormatting',
  'format.clear',
  'format.font',
  'format.presetNumber',
  'format.presetCurrency',
  'format.presetPercent',
  'sheet.recalculate',
  'sheet.timezone',
  'sheet.displayLanguage',
  'sheet.versionHistory',
  'sheet.clearVersionHistory',
  'sheet.exportCsv',
  'sheet.exportXlsx',
  'sheet.exportJson',
  'data.runSqlQuery',
  'data.compareDiff',
  'data.validation',
  'data.checkValidation',
  'data.comment',
  'insert.rectangle',
  'insert.ellipse',
  'insert.line',
  'insert.arrow',
  'insert.textBox',
  'insert.image',
  'insert.chart',
  'insert.objectList',
  'object.bringToFront',
  'object.bringForward',
  'object.sendBackward',
  'object.sendToBack',
  'object.delete',
  'worksheet.add',
  'worksheet.addMarkdown',
  'worksheet.addJson',
  'worksheet.addYaml',
  'worksheet.addText',
  'worksheet.rename',
  'worksheet.tabColor',
  'worksheet.newFolder',
  'worksheet.moveToFolder',
  'worksheet.duplicate',
  'worksheet.delete',
  'worksheet.moveLeft',
  'worksheet.moveRight',
  'worksheet.moveFirst',
  'worksheet.moveLast',
  'worksheet.next',
  'worksheet.prev',
  'worksheet.toggleLock',
  'view.wrap',
  'view.stickyFirstRow',
  'view.stickyFirstColumn',
  'view.freezeAtSelection',
  'view.commentsPanel',
  'view.fullscreen',
  'view.zoom.in',
  'view.zoom.out',
  'view.zoom.50',
  'view.zoom.75',
  'view.zoom.90',
  'view.zoom.100',
  'view.zoom.110',
  'view.zoom.125',
  'view.zoom.150',
  'view.zoom.200',
  'view.zoom.reset',
  'view.toolbar',
  'view.customizeToolbar',
  'view.editHints',
  'view.sheetTabsVertical',
  'view.bandedRows',
  'view.gridlines',
  'view.highlightRow',
  'view.highlightCol',
  'view.autoFitOnOpen',
  'view.sheetFont.bizUd',
  'view.sheetFont.ms',
  'view.sheetFont.msUi',
  'view.sheetFont.notoSansJp',
  'view.sheetFont.meiryoUi',
  'view.sheetFont.yuGothicUi',
  'view.theme.system',
  'view.theme.light',
  'view.theme.dark',
  'view.theme.hybrid',
  'view.density.compact',
  'view.density.standard',
  'view.density.comfortable',
  'app.settings',
  'help.formula',
  'help.shortcuts',
  'lang.en',
  'lang.ja',
  'tab.moveLeft',
  'tab.moveRight',
  'tab.moveFirst',
  'tab.moveLast',
  'help.about',
];

function inertUi(): UiPort {
  return new Proxy({} as UiPort, { get: () => vi.fn(async () => null) });
}

type Situation = 'none' | 'csv' | 'csvReadOnly' | 'rsf' | 'rsfMarkdown';

async function build(situation: Situation): Promise<Commands> {
  const state = new AppState();
  const commands = new Commands(state, inertUi(), document);
  if (situation === 'csv' || situation === 'csvReadOnly') {
    const bytes = utf8('a,b\n1,2\n');
    await commands.openFiles([{ name: 'a.csv', bytes, handle: null, size: bytes.length }], {
      confirmNonCsv: false,
    });
    if (situation === 'csvReadOnly') state.setReadOnly(state.activeTab!, true);
  } else if (situation === 'rsf' || situation === 'rsfMarkdown') {
    await commands.run('file.new');
    if (situation === 'rsfMarkdown') state.addMarkdownSheet(state.activeTab!, 'Notes');
  }
  return commands;
}

describe('command surface (characterization)', () => {
  it('lists every CommandId exactly once', () => {
    expect([...COMMAND_IDS].sort()).toEqual([...CATALOG_IDS].sort());
  });

  for (const situation of ['none', 'csv', 'csvReadOnly', 'rsf', 'rsfMarkdown'] as const) {
    it(`enablement and disabled reasons: ${situation}`, async () => {
      setLocale('en');
      const commands = await build(situation);
      const table: Record<string, string> = {};
      for (const id of COMMAND_IDS) {
        const reason = commands.disabledReason(id);
        table[id] = commands.isEnabled(id) ? 'enabled' : `disabled${reason === null ? '' : `: ${reason}`}`;
      }
      expect(table).toMatchSnapshot();
    });
  }
});
