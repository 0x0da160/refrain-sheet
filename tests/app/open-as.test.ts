// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Opening a file whose name does not say its kind, reopening a tab as another
 * kind, and adding a document tab to a workbook as a sheet. Each goes through
 * `Commands`, as the menus and the drop on the sheet bar do.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { warnProtectedAndOfferUnlock } from '../../src/app/commands/shared';
import type { OpenedFile } from '../../src/app/file-access';
import { setLocale, t } from '../../src/app/i18n';
import { initCsvEngine } from '../../src/core/csv/csv-engine';
import { isCsv, isWorkbook } from '../../src/core/editor-document';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { doc } from '../helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    confirmChangedOnDisk: vi.fn(async () => 'overwrite' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    chooseFileType: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    confirmExportJson: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    chooseColumnMenu: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    chooseConditionalFormat: vi.fn(async () => null),
    chooseCellComment: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    chooseSheetTabColor: vi.fn(async () => null),
    promptFolderName: vi.fn(async () => null),
    chooseFolder: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    promptGoToCell: vi.fn(async () => null),
    promptRowHeight: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showSqlQuery: vi.fn(async () => undefined),
    showAiAssistant: vi.fn(),
    showDiff: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseVersionHistory: vi.fn(async () => null),
    confirmHistoryCapExceeded: vi.fn(async () => true),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    chooseFont: vi.fn(async () => null),
    chooseRecentFile: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

/** A picked file holding `content` (text, or bytes as they are), as the open paths receive it. */
function openedFile(name: string, content: Uint8Array | string): OpenedFile {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { name, bytes, handle: null, size: bytes.length };
}

/** The worksheets of a tab that holds a workbook (every document tab but a CSV table). */
function sheetsOf(tab: Tab) {
  if (!isWorkbook(tab.doc)) {
    throw new Error(`${tab.name} holds no workbook`);
  }
  return tab.doc.sheets;
}

/** A session with one unprotected workbook, `book.rsf`, as the active tab. */
function setup(ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const book = state.addTab('book.rsf', RsfDocument.empty('book.rsf', 5, 3, 'Sheet1'), null);
  return { state, commands, ui, book };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The unlock prompt for a refused write, wired as the app shell wires it (`installProtectedWarning`). */
function promptToUnlock(state: AppState, ui: UiPort): void {
  state.warnBlocked = (tab, scope, retry, sheetId) => {
    void warnProtectedAndOfferUnlock(ui, state, tab, scope, sheetId).then((unlocked) => {
      if (unlocked) {
        retry();
      }
    });
  };
}

beforeAll(async () => {
  await initCsvEngine();
});

beforeEach(() => {
  globalThis.localStorage?.clear();
  setLocale('en');
});

describe('opening a file whose name does not say its kind', () => {
  it('opens a JSON document as a JSON sheet, without asking', async () => {
    const { state, commands, ui } = setup();
    await commands.openFiles([openedFile('payload.dat', '{"a": 1}\n')]);
    expect(ui.chooseFileType).not.toHaveBeenCalled();
    const opened = state.activeTab!;
    expect(opened.name).toBe('payload.dat');
    expect(sheetsOf(opened)[0].kind).toBe('json');
    expect(sheetsOf(opened)[0].getValue(0, 0)).toBe('{"a": 1}\n');
  });

  it('opens an RSF workbook under a name that does not say so, as a workbook', async () => {
    const { state, commands, ui } = setup();
    const rsf = RsfDocument.empty('book.rsf', 5, 3, 'Sheet1').toBytes();
    await commands.openFiles([openedFile('workbook.dat', rsf)]);
    expect(ui.chooseFileType).not.toHaveBeenCalled();
    const opened = state.activeTab!;
    expect(opened.name).toBe('workbook.dat');
    expect(isWorkbook(opened.doc)).toBe(true);
  });

  it('asks which kind a file is when neither its name nor its content says, and opens it as the kind picked', async () => {
    const ui = stubUi({ chooseFileType: vi.fn(async () => 'csv' as const) });
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('table.dat', 'Item,Qty\nPen,2\n')]);
    expect(ui.chooseFileType).toHaveBeenCalledWith('table.dat', 'open');
    expect(state.tabs).toHaveLength(2);
    expect(isCsv(state.activeTab!.doc)).toBe(true);
  });

  it('opens a file as the kind its name gives, even when its content looks like another kind', async () => {
    const { state, commands, ui } = setup();
    await commands.openFiles([openedFile('notes.md', '{"a": 1}\n')]);
    expect(ui.chooseFileType).not.toHaveBeenCalled();
    expect(sheetsOf(state.activeTab!)[0].kind).toBe('markdown');
  });
});

describe('reopening a tab as another kind', () => {
  it('reads a CSV tab again as Markdown, keeping its file name and asking with the reopen purpose', async () => {
    const ui = stubUi({ chooseFileType: vi.fn(async () => 'markdown' as const) });
    const { state, commands } = setup(ui);
    const tab = state.addTab('notes.csv', doc('# Title\n\nBody\n'), null);
    await commands.run('file.reopenAs');
    expect(ui.chooseFileType).toHaveBeenCalledWith('notes.csv', 'reopen');
    expect(tab.name).toBe('notes.csv');
    expect(tab.textFile?.kind).toBe('markdown');
    expect(sheetsOf(tab)[0].name).toBe('notes');
    expect(sheetsOf(tab)[0].kind).toBe('markdown');
    expect(sheetsOf(tab)[0].getValue(0, 0)).toBe('# Title\n\nBody\n');
  });

  it('refuses a file that holds a spreadsheet file, and leaves the tab as it was', async () => {
    const ui = stubUi();
    const { state, commands } = setup(ui);
    const tab = state.addTab('book.csv', doc(RsfDocument.empty('book.csv', 2, 2, 'Sheet1').toBytes()), null);
    await commands.run('file.reopenAs');
    expect(ui.chooseFileType).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith(t('notify.reopenWorkbook', { name: 'book.csv' }), 'warn');
    expect(isCsv(tab.doc)).toBe(true);
  });

  it('asks to unlock a protected tab first, and changes nothing when the user declines', async () => {
    const ui = stubUi({ confirm: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    const tab = state.addTab('notes.csv', doc('a,b\n'), null);
    state.setReadOnly(tab, true);
    await commands.run('file.reopenAs');
    expect(ui.confirm).toHaveBeenCalled();
    expect(ui.chooseFileType).not.toHaveBeenCalled();
    expect(isCsv(tab.doc)).toBe(true);
    expect(tab.readOnly).toBe(true);
  });

  it('is offered for a CSV or text tab, and not for a workbook', async () => {
    const { state, commands } = setup();
    expect(commands.isEnabled('file.reopenAs')).toBe(false);
    await commands.openFiles([openedFile('notes.md', '# Hi\n')]);
    expect(commands.isEnabled('file.reopenAs')).toBe(true);
    state.addTab('sales.csv', doc('Item\n'), null);
    expect(commands.isEnabled('file.reopenAs')).toBe(true);
  });

  it('unlocks a protected tab when the user agrees, and then reopens it', async () => {
    const ui = stubUi({ chooseFileType: vi.fn(async () => 'text' as const) });
    const { state, commands } = setup(ui);
    const tab = state.addTab('notes.csv', doc('a,b\n'), null);
    state.setReadOnly(tab, true);
    await commands.run('file.reopenAs');
    expect(tab.readOnly).toBe(false);
    expect(sheetsOf(tab)[0].kind).toBe('text');
  });
});

describe('adding a document tab to a workbook as a sheet', () => {
  it('adds a CSV tab as a grid sheet named after its file, and keeps the tab open', () => {
    const { state, commands, ui, book } = setup();
    const csv = state.addTab('sales.csv', doc('Item,Qty\nPen,2\n'), null);
    state.activateTab(book.id);
    expect(commands.addTabAsSheet(csv.id)).toBe(true);
    const sheets = sheetsOf(book);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Sheet1', 'sales']);
    expect(sheets[1].kind).toBe('grid');
    expect(sheets[1].getValue(0, 0)).toBe('Item');
    expect(sheets[1].getValue(0, 1)).toBe('Qty');
    expect(sheets[1].getValue(1, 0)).toBe('Pen');
    expect(sheets[1].getValue(1, 1)).toBe('2');
    expect(state.tabs).toContain(csv);
    expect(isCsv(csv.doc)).toBe(true);
    expect(ui.notify).toHaveBeenCalledWith(
      t('notify.tabAddedAsSheet', { name: 'sales', file: 'sales.csv' }),
      'info',
    );
  });

  it('adds a Markdown tab as a Markdown sheet holding the same text', async () => {
    const { state, commands, book } = setup();
    await commands.openFiles([openedFile('notes.md', '# Title\n\nBody\n')]);
    const notes = state.activeTab!;
    state.activateTab(book.id);
    expect(commands.addTabAsSheet(notes.id)).toBe(true);
    const added = sheetsOf(book)[1];
    expect(added.name).toBe('notes');
    expect(added.kind).toBe('markdown');
    expect(added.getValue(0, 0)).toBe('# Title\n\nBody\n');
    expect(state.tabs).toContain(notes);
  });

  it('refuses a spreadsheet file, and says why', async () => {
    const { state, commands, ui, book } = setup();
    const rsf = RsfDocument.empty('other.rsf', 2, 2, 'Data').toBytes();
    await commands.openFiles([openedFile('other.rsf', rsf)]);
    const other = state.activeTab!;
    state.activateTab(book.id);
    expect(commands.addTabAsSheet(other.id)).toBe(false);
    expect(sheetsOf(book)).toHaveLength(1);
    expect(ui.notify).toHaveBeenCalledWith(t('notify.tabNotSheet', { name: 'other.rsf' }), 'warn');
  });

  it('does nothing when the active tab is a CSV table rather than a workbook', async () => {
    const { state, commands } = setup();
    await commands.openFiles([openedFile('notes.md', '# Hi\n')]);
    const notes = state.activeTab!;
    const csv = state.addTab('sales.csv', doc('Item\n'), null);
    expect(state.activeTab).toBe(csv);
    expect(commands.addTabAsSheet(notes.id)).toBe(false);
    expect(isCsv(csv.doc)).toBe(true);
    expect(state.tabs).toHaveLength(3);
  });

  it('does nothing when a tab is added to itself', () => {
    const { commands, book } = setup();
    expect(commands.addTabAsSheet(book.id)).toBe(false);
    expect(sheetsOf(book)).toHaveLength(1);
  });

  it('asks to unlock a protected workbook, and adds nothing when the user declines', async () => {
    const ui = stubUi({ confirm: vi.fn(async () => false) });
    const { state, commands, book } = setup(ui);
    promptToUnlock(state, ui);
    const csv = state.addTab('sales.csv', doc('Item\n'), null);
    state.activateTab(book.id);
    state.setReadOnly(book, true);
    expect(commands.addTabAsSheet(csv.id)).toBe(false);
    await flush();
    expect(ui.confirm).toHaveBeenCalled();
    expect(sheetsOf(book)).toHaveLength(1);
    expect(book.readOnly).toBe(true);
  });

  it('adds the sheet once the user unlocks the workbook', async () => {
    const ui = stubUi();
    const { state, commands, book } = setup(ui);
    promptToUnlock(state, ui);
    const csv = state.addTab('sales.csv', doc('Item\n'), null);
    state.activateTab(book.id);
    state.setReadOnly(book, true);
    commands.addTabAsSheet(csv.id);
    await flush();
    expect(book.readOnly).toBe(false);
    expect(sheetsOf(book).map((sheet) => sheet.name)).toEqual(['Sheet1', 'sales']);
  });

  it('is undone by one step', async () => {
    const { state, commands, book } = setup();
    const csv = state.addTab('sales.csv', doc('Item\n'), null);
    state.activateTab(book.id);
    expect(commands.addTabAsSheet(csv.id)).toBe(true);
    expect(sheetsOf(book)).toHaveLength(2);
    await commands.run('edit.undo');
    expect(sheetsOf(book)).toHaveLength(1);
  });

  it('gives a second copy of the same file a sheet name of its own', () => {
    const { state, commands, book } = setup();
    const csv = state.addTab('sales.csv', doc('Item\n'), null);
    state.activateTab(book.id);
    expect(commands.addTabAsSheet(csv.id)).toBe(true);
    expect(commands.addTabAsSheet(csv.id)).toBe(true);
    const names = sheetsOf(book).map((sheet) => sheet.name);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('sales');
  });
});
