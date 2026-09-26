// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { t, type LocaleId } from '../src/app/i18n';
import type { OpenedFile } from '../src/app/file-access';
import { setSuppressHistoryCapWarning } from '../src/app/settings';
import { compileQuery } from '../src/core/search';
import { decodeBytes } from '../src/core/encoding';
import { encodeRsf } from './rsf-single-sheet';
import { buildXlsxExport, type XlsxSheetInput } from '../src/core/xlsx-export';
import { asCsv, enc, utf8 } from './helpers';

// Simulates a hosted build with Drive sync configured and a cached access
// token, without going through the real Google Identity Services sign-in.
vi.mock('../src/app/drive/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/app/drive/config')>();
  return { ...actual, driveConfigured: () => true };
});
vi.mock('../src/app/drive/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/app/drive/auth')>();
  return { ...actual, getAccessToken: vi.fn(async () => 'test-token') };
});

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseExportCsv: vi.fn(async () => ({
      encoding: 'utf-8' as const,
      bom: false,
      lineEnding: 'lf' as const,
      delimiter: 'keep' as const,
      quoteStyle: 'minimal' as const,
    })),
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
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    promptGoToCell: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showSqlQuery: vi.fn(async () => undefined),
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
    chooseRecentFile: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

function opened(name: string, bytes: Uint8Array, handle: FileSystemFileHandle | null = null): OpenedFile {
  return { name, bytes, handle, size: bytes.length };
}

interface FakeHandle {
  handle: FileSystemFileHandle;
  written: () => Uint8Array | null;
}

function fakeHandle(options: { failWrite?: boolean } = {}): FakeHandle {
  let captured: Uint8Array | null = null;
  const handle = {
    kind: 'file',
    name: 'fake.csv',
    isSameEntry: async () => false,
    createWritable: async () => {
      if (options.failWrite) {
        throw new DOMException('denied', 'NotAllowedError');
      }
      return {
        write: async (data: Uint8Array) => {
          captured = new Uint8Array(data);
        },
        close: async () => undefined,
      };
    },
  } as unknown as FileSystemFileHandle;
  return { handle, written: () => captured };
}

function setup(ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  return { state, commands, ui };
}

const KEEP = { encoding: 'keep', bom: 'keep', lineEnding: 'keep' } as const;

describe('opening files', () => {
  it('opens a file into a new active tab', async () => {
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('x,y\n'))], { confirmNonCsv: false });
    expect(state.tabs.length).toBe(1);
    expect(state.activeTab?.name).toBe('a.csv');
  });

  it('shows validation results and honours Cancel', async () => {
    const ui = stubUi({ confirmValidation: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('bad.csv', utf8('a,"unclosed\n'))], { confirmNonCsv: false });
    expect(ui.confirmValidation).toHaveBeenCalledOnce();
    expect(state.tabs.length).toBe(0);
  });

  it('opens malformed files losslessly when the user chooses Open Anyway', async () => {
    const ui = stubUi();
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('bad.csv', utf8('a,"unclosed\n'))], { confirmNonCsv: false });
    expect(state.tabs.length).toBe(1);
  });

  it('activates the existing tab when the same file is opened twice', async () => {
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('x\n'))], { confirmNonCsv: false });
    await commands.openFiles([opened('b.csv', utf8('y\n'))], { confirmNonCsv: false });
    await commands.openFiles([opened('a.csv', utf8('x\n'))], { confirmNonCsv: false });
    expect(state.tabs.length).toBe(2);
    expect(state.activeTab?.name).toBe('a.csv');
  });

  it('refuses files over the 512 MiB limit', async () => {
    const ui = stubUi();
    const { state, commands } = setup(ui);
    const file = { name: 'huge.csv', bytes: utf8('tiny'), handle: null, size: 513 * 1024 * 1024 };
    await commands.openFiles([file], { confirmNonCsv: false });
    expect(state.tabs.length).toBe(0);
    expect(ui.showMessage).toHaveBeenCalledOnce();
  });

  it('asks before opening dropped files without a CSV-like extension', async () => {
    const ui = stubUi({ confirm: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('image.png', utf8('a,b\n'))], { confirmNonCsv: true });
    expect(ui.confirm).toHaveBeenCalledOnce();
    expect(state.tabs.length).toBe(0);
  });

  it('defaults an opened file to read-only protection (issue #443)', async () => {
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('x,y\n'))], { confirmNonCsv: false });
    const tab = state.activeTab!;
    expect(tab.readOnly).toBe(true);
    expect(state.editCell(tab, 0, 0, 'z')).toBe(false);
    expect(tab.doc.isDirty).toBe(false);
    // The status bar / File menu toggle unlocks it explicitly.
    state.setReadOnly(tab, false);
    expect(state.editCell(tab, 0, 0, 'z')).toBe(true);
  });
});

describe('saving', () => {
  it('overwrites through a File System Access handle and resets the baseline', async () => {
    const fake = fakeHandle();
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('a,b\n'), fake.handle)], { confirmNonCsv: false });
    const tab = state.activeTab!;
    state.setReadOnly(tab, false);
    state.editCell(tab, 0, 0, 'X');
    const ok = await commands.save(tab, KEEP);
    expect(ok).toBe(true);
    expect(decodeBytes(fake.written()!, 'utf-8')).toBe('X,b\n');
    expect(tab.doc.isDirty).toBe(false);
    expect(tab.history.canUndo).toBe(false);
  });

  it('falls back to a download save when no handle exists and reports it', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const ui = stubUi();
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    const ok = await commands.save(state.activeTab!, KEEP);
    expect(ok).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    const messages = (ui.notify as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('was not overwritten'))).toBe(true);
  });

  it('falls back to a download when writing is denied', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const fake = fakeHandle({ failWrite: true });
    const ui = stubUi();
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a,b\n'), fake.handle)], { confirmNonCsv: false });
    const ok = await commands.save(state.activeTab!, KEEP);
    expect(ok).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it('overwrites the associated Drive file instead of saving locally (issue #429)', async () => {
    const fake = fakeHandle();
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const ui = stubUi();
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a,b\n'), fake.handle)], { confirmNonCsv: false });
    const tab = state.activeTab!;
    tab.drive = { fileId: 'drive-file-1', name: 'a.csv' };
    state.setReadOnly(tab, false);
    state.editCell(tab, 0, 0, 'X');

    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method });
        return new Response(JSON.stringify({ id: 'drive-file-1', name: 'a.csv' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    try {
      const ok = await commands.save(tab, KEEP);

      expect(ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('PATCH');
      expect(calls[0].url).toContain('/drive-file-1');
      // Neither the local file-system handle nor a browser download fired.
      expect(fake.written()).toBeNull();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(tab.doc.isDirty).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cancels the save when characters are unrepresentable and the user declines', async () => {
    const fake = fakeHandle();
    const ui = stubUi({ confirmUnrepresentable: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    // Real Japanese content so the file is detected as Shift_JIS.
    await commands.openFiles([opened('a.csv', enc('名前,値\n', 'shift_jis'), fake.handle)], {
      confirmNonCsv: false,
    });
    expect(asCsv(state.activeTab!.doc).encoding).toBe('shift_jis');
    const tab = state.activeTab!;
    state.setReadOnly(tab, false);
    state.editCell(tab, 0, 1, '😀');
    const ok = await commands.save(tab, KEEP);
    expect(ok).toBe(false);
    expect(fake.written()).toBeNull();
    expect(tab.doc.isDirty).toBe(true);
  });

  it('replaces unrepresentable characters with NCRs when the user continues, and reports it', async () => {
    const fake = fakeHandle();
    const ui = stubUi({ confirmUnrepresentable: vi.fn(async () => true) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', enc('名前,値\n', 'shift_jis'), fake.handle)], {
      confirmNonCsv: false,
    });
    const tab = state.activeTab!;
    state.setReadOnly(tab, false);
    state.editCell(tab, 0, 1, '😀');
    const ok = await commands.save(tab, KEEP);
    expect(ok).toBe(true);
    expect(decodeBytes(fake.written()!, 'shift_jis')).toBe('名前,&#128512;\n');
    expect(ui.notifyNcr).toHaveBeenCalledWith([{ row: 0, col: 1, count: 1 }]);
  });

  it('warns before saving when edited cells originally held undecodable bytes', async () => {
    const fake = fakeHandle();
    const ui = stubUi({ confirmUndecodableEdit: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    const bytes = new Uint8Array([...utf8('a,'), 0xff, ...utf8('\n')]);
    await commands.openFiles([opened('a.csv', bytes, fake.handle)], { confirmNonCsv: false });
    const tab = state.activeTab!;
    state.setReadOnly(tab, false);
    // Reinterpret as UTF-8 so the 0xff byte is undecodable.
    state.setBaseline(tab, asCsv(tab.doc).reinterpret({ encoding: 'utf-8' }));
    state.editCell(tab, 0, 1, 'clean');
    const ok = await commands.save(tab, KEEP);
    expect(ok).toBe(false);
    expect(ui.confirmUndecodableEdit).toHaveBeenCalledWith([{ row: 0, col: 1 }]);
    expect(fake.written()).toBeNull();
  });
});

describe('closing tabs', () => {
  it('cancel keeps the dirty tab open', async () => {
    const ui = stubUi({ confirmUnsaved: vi.fn(async () => 'cancel' as const) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a\n'))], { confirmNonCsv: false });
    state.setReadOnly(state.activeTab!, false);
    state.editCell(state.activeTab!, 0, 0, 'X');
    await commands.closeTab(state.activeTab!);
    expect(state.tabs.length).toBe(1);
  });

  it('discard closes without saving', async () => {
    const ui = stubUi({ confirmUnsaved: vi.fn(async () => 'discard' as const) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a\n'))], { confirmNonCsv: false });
    state.setReadOnly(state.activeTab!, false);
    state.editCell(state.activeTab!, 0, 0, 'X');
    await commands.closeTab(state.activeTab!);
    expect(state.tabs.length).toBe(0);
  });

  it('save saves and then closes', async () => {
    const fake = fakeHandle();
    const ui = stubUi({ confirmUnsaved: vi.fn(async () => 'save' as const) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a\n'), fake.handle)], { confirmNonCsv: false });
    state.setReadOnly(state.activeTab!, false);
    state.editCell(state.activeTab!, 0, 0, 'X');
    await commands.closeTab(state.activeTab!);
    expect(state.tabs.length).toBe(0);
    expect(decodeBytes(fake.written()!, 'utf-8')).toBe('X\n');
  });

  it('clean tabs close without confirmation', async () => {
    const ui = stubUi();
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a\n'))], { confirmNonCsv: false });
    await commands.closeTab(state.activeTab!);
    expect(state.tabs.length).toBe(0);
    expect(ui.confirmUnsaved).not.toHaveBeenCalled();
  });
});

describe('new document', () => {
  it('opens a blank unsaved RSF in a new active tab without touching others', async () => {
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('x,y\n'))], { confirmNonCsv: false });
    const csvTab = state.activeTab!;
    await commands.run('file.new');
    expect(state.tabs.length).toBe(2);
    const tab = state.activeTab!;
    expect(tab.id).not.toBe(csvTab.id);
    expect(tab.doc.kind).toBe('rsf');
    expect(tab.name.endsWith('.rsf')).toBe(true);
    // New documents are unsaved until the first save.
    expect(tab.doc.isDirty).toBe(true);
    // The original CSV tab is untouched (undo-safe).
    expect(csvTab.doc.kind).toBe('csv');
    expect(csvTab.doc.isDirty).toBe(false);
    // A newly created blank document starts editable, unlike the opened
    // existing file above (issue #443).
    expect(csvTab.readOnly).toBe(true);
    expect(tab.readOnly).toBe(false);
  });

  it('gives successive new documents distinct default names', async () => {
    const { state, commands } = setup();
    await commands.run('file.new');
    await commands.run('file.new');
    expect(state.tabs.map((t) => t.name)).toEqual(['untitled.rsf', 'untitled-2.rsf']);
  });
});

describe('convert to RSF command', () => {
  it('opens the converted sheet in a new tab and preserves the source CSV tab', async () => {
    const ui = stubUi();
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('data.csv', utf8('a,b\n1,2\n'))], { confirmNonCsv: false });
    const csvTab = state.activeTab!;
    state.setReadOnly(csvTab, false);
    // An unsaved edit must be carried into the conversion (current state).
    state.editCell(csvTab, 0, 0, 'X');
    await commands.run('sheet.convert');

    expect(ui.confirmConvert).toHaveBeenCalledWith('command', 'data.csv');
    expect(state.tabs.length).toBe(2);
    const rcsvTab = state.activeTab!;
    expect(rcsvTab.id).not.toBe(csvTab.id);
    expect(rcsvTab.doc.kind).toBe('rsf');
    expect(rcsvTab.name).toBe('data.rsf');
    expect(rcsvTab.doc.getValue(0, 0)).toBe('X');
    expect(rcsvTab.doc.isDirty).toBe(true);
    // Source CSV tab (and its edits) stay put.
    expect(state.tabs[0].id).toBe(csvTab.id);
    expect(csvTab.doc.kind).toBe('csv');
    expect(csvTab.doc.getValue(0, 0)).toBe('X');
    // The loading indicator was raised during conversion.
    const busyLabels = (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(busyLabels.some((l) => typeof l === 'string' && l.length > 0)).toBe(true);
    expect(busyLabels[busyLabels.length - 1]).toBeNull();
  });

  it('declining the confirmation leaves the CSV unchanged and opens no tab', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('data.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    await commands.run('sheet.convert');
    expect(state.tabs.length).toBe(1);
    expect(state.activeTab!.doc.kind).toBe('csv');
  });

  it('is enabled only for a not-yet-converted CSV document', async () => {
    const { commands } = setup();
    await commands.run('file.new');
    expect(commands.isEnabled('sheet.convert')).toBe(false); // already RSF
    await commands.openFiles([opened('c.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    expect(commands.isEnabled('sheet.convert')).toBe(true);
  });
});

describe('read-only protection (issue #443)', () => {
  it('ensureRsf refuses the implicit CSV -> RSF conversion on a protected tab while it stays protected', async () => {
    const ui = stubUi({ confirm: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    const tab = state.activeTab!;
    expect(tab.readOnly).toBe(true);
    const result = await commands.ensureRsf(tab, 'formula');
    expect(result).toBeNull();
    expect(ui.confirmConvert).not.toHaveBeenCalled();
    expect(tab.doc.kind).toBe('csv');
  });

  it('ensureRsf warns that the book is protected and offers to unlock it (#541)', async () => {
    const ui = stubUi({ confirm: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    const tab = state.activeTab!;

    const result = await commands.ensureRsf(tab, 'formula');
    expect(result).toBeNull();
    expect(ui.confirm).toHaveBeenCalledTimes(1);
    expect(ui.confirm).toHaveBeenCalledWith(
      t('dialog.warnProtected.bookTitle'),
      t('dialog.warnProtected.bookMessage', { name: tab.name }),
      t('dialog.warnProtected.unlock'),
      t('dialog.warnProtected.cancel'),
    );
    // Declining the offer leaves the tab exactly as protected as before.
    expect(tab.readOnly).toBe(true);
    expect(tab.doc.kind).toBe('csv');
  });

  it('ensureRsf goes on to the conversion prompt once the warning unlocks the book', async () => {
    const ui = stubUi({ confirm: vi.fn(async () => true) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    const tab = state.activeTab!;

    const result = await commands.ensureRsf(tab, 'formula');
    expect(tab.readOnly).toBe(false);
    // The action that needed RSF is not dropped: it continues to the usual prompt.
    expect(ui.confirmConvert).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(tab.doc.kind).toBe('rsf');
  });

  it('file.toggleProtect flips the active tab and back', async () => {
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    const tab = state.activeTab!;
    expect(tab.readOnly).toBe(true);
    await commands.run('file.toggleProtect');
    expect(tab.readOnly).toBe(false);
    await commands.run('file.toggleProtect');
    expect(tab.readOnly).toBe(true);
  });
});

describe('sheet timezone command', () => {
  it('is enabled only for an RSF (spreadsheet) tab', async () => {
    const { commands } = setup();
    await commands.run('file.new');
    expect(commands.isEnabled('sheet.timezone')).toBe(true);
    await commands.openFiles([opened('c.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    expect(commands.isEnabled('sheet.timezone')).toBe(false);
  });

  it('applies the chosen timezone, recalculates, and notifies', async () => {
    const ui = stubUi({ chooseTimezone: vi.fn(async () => 'Asia/Tokyo') });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    const before = tab.doc.timezone;
    await commands.run('sheet.timezone');
    expect(ui.chooseTimezone).toHaveBeenCalledWith(before);
    expect(tab.doc.timezone).toBe('Asia/Tokyo');
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining('Asia/Tokyo'), 'info');
  });

  it('cancelling leaves the timezone unchanged and does not notify', async () => {
    const ui = stubUi({ chooseTimezone: vi.fn(async () => null) });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    const before = tab.doc.timezone;
    await commands.run('sheet.timezone');
    expect(tab.doc.timezone).toBe(before);
    expect(ui.notify).not.toHaveBeenCalled();
  });
});

describe('sheet display language command', () => {
  it('is enabled only for an RSF (spreadsheet) tab', async () => {
    const { commands } = setup();
    await commands.run('file.new');
    expect(commands.isEnabled('sheet.displayLanguage')).toBe(true);
    await commands.openFiles([opened('c.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    expect(commands.isEnabled('sheet.displayLanguage')).toBe(false);
  });

  it('applies the chosen display language, recalculates, and notifies', async () => {
    const ui = stubUi({ chooseDisplayLanguage: vi.fn(async (): Promise<LocaleId | null> => 'ja') });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    const before = tab.doc.displayLanguage;
    await commands.run('sheet.displayLanguage');
    expect(ui.chooseDisplayLanguage).toHaveBeenCalledWith(before);
    expect(tab.doc.displayLanguage).toBe('ja');
    expect(ui.notify).toHaveBeenCalledWith(expect.any(String), 'info');
  });

  it('cancelling leaves the display language unchanged and does not notify', async () => {
    const ui = stubUi({ chooseDisplayLanguage: vi.fn(async () => null) });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    const before = tab.doc.displayLanguage;
    await commands.run('sheet.displayLanguage');
    expect(tab.doc.displayLanguage).toBe(before);
    expect(ui.notify).not.toHaveBeenCalled();
  });
});

describe('sheet version history commands', () => {
  it('is enabled only for an RSF (spreadsheet) tab', async () => {
    const { commands } = setup();
    await commands.run('file.new');
    expect(commands.isEnabled('sheet.versionHistory')).toBe(true);
    await commands.openFiles([opened('c.csv', utf8('a,b\n'))], { confirmNonCsv: false });
    expect(commands.isEnabled('sheet.versionHistory')).toBe(false);
  });

  it('clearVersionHistory is enabled only once a snapshot has been recorded', async () => {
    const { state, commands } = setup();
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    expect(commands.isEnabled('sheet.clearVersionHistory')).toBe(false);
    tab.doc.toBytes();
    expect(commands.isEnabled('sheet.clearVersionHistory')).toBe(true);
  });

  it('applies the chosen enabled state and notifies', async () => {
    const ui = stubUi({
      chooseVersionHistory: vi.fn(async () => ({
        kind: 'save' as const,
        enabled: false,
        maxOverride: undefined,
      })),
    });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    expect(tab.doc.historyEnabled).toBe(true);
    await commands.run('sheet.versionHistory');
    expect(ui.chooseVersionHistory).toHaveBeenCalledWith(true, undefined, []);
    expect(tab.doc.historyEnabled).toBe(false);
    expect(ui.notify).toHaveBeenCalledWith(expect.any(String), 'info');
  });

  it('applies a chosen retained-snapshot cap override and notifies distinctly from enabled/disabled', async () => {
    const ui = stubUi({
      chooseVersionHistory: vi.fn(async () => ({ kind: 'save' as const, enabled: true, maxOverride: 5 })),
    });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    await commands.run('sheet.versionHistory');
    expect(tab.doc.historyMaxOverride).toBe(5);
    expect(ui.notify).toHaveBeenCalledWith(expect.any(String), 'info');
  });

  it('cancelling the version history dialog changes nothing and does not notify', async () => {
    const ui = stubUi({ chooseVersionHistory: vi.fn(async () => null) });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    await commands.run('sheet.versionHistory');
    expect(tab.doc.historyEnabled).toBe(true);
    expect(ui.notify).not.toHaveBeenCalled();
  });

  it('restoring a snapshot asks for confirmation and, once confirmed, replaces content and clears undo/redo', async () => {
    const ui = stubUi({
      chooseVersionHistory: vi.fn(async () => ({ kind: 'restore' as const, index: 0 })),
      confirm: vi.fn(async () => true),
    });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    tab.doc.setCell(0, 0, 'v1');
    tab.doc.toBytes(); // snapshot 0
    tab.doc.setCell(0, 0, 'v2');
    tab.history.push({
      label: 'edit',
      ops: [{ type: 'cells', changes: [{ row: 0, col: 0, before: 'v1', after: 'v2' }] }],
    });
    expect(tab.history.canUndo).toBe(true);

    await commands.run('sheet.versionHistory');
    expect(ui.confirm).toHaveBeenCalled();
    expect(tab.doc.getValue(0, 0)).toBe('v1');
    expect(tab.history.canUndo).toBe(false);
    expect(ui.notify).toHaveBeenCalledWith(expect.any(String), 'info');
  });

  it('declining the restore confirmation changes nothing', async () => {
    const ui = stubUi({
      chooseVersionHistory: vi.fn(async () => ({ kind: 'restore' as const, index: 0 })),
      confirm: vi.fn(async () => false),
    });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    tab.doc.setCell(0, 0, 'v1');
    tab.doc.toBytes();
    tab.doc.setCell(0, 0, 'v2');
    await commands.run('sheet.versionHistory');
    expect(tab.doc.getValue(0, 0)).toBe('v2');
    expect(ui.notify).not.toHaveBeenCalled();
  });

  it('confirming clearVersionHistory discards every recorded snapshot', async () => {
    const ui = stubUi({ confirm: vi.fn(async () => true) });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    tab.doc.toBytes();
    expect(tab.doc.history.length).toBe(1);
    await commands.run('sheet.clearVersionHistory');
    expect(ui.confirm).toHaveBeenCalled();
    expect(tab.doc.history).toEqual([]);
    expect(ui.notify).toHaveBeenCalledWith(expect.any(String), 'info');
  });

  it('declining the clearVersionHistory confirmation keeps recorded snapshots', async () => {
    const ui = stubUi({ confirm: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    tab.doc.toBytes();
    await commands.run('sheet.clearVersionHistory');
    expect(tab.doc.history.length).toBe(1);
    expect(ui.notify).not.toHaveBeenCalled();
  });
});

describe('pre-save retained-snapshot cap warning', () => {
  beforeEach(() => {
    setSuppressHistoryCapWarning(false);
  });

  it('warns before saving when the save would drop the oldest snapshot, and cancelling aborts the save', async () => {
    const fake = fakeHandle();
    const ui = stubUi({ confirmHistoryCapExceeded: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    tab.handle = fake.handle;
    tab.doc.setHistoryMaxOverride(1);
    tab.doc.toBytes(); // fills the cap (1 snapshot)
    expect(tab.doc.willDropOldestOnNextSave).toBe(true);

    const ok = await commands.save(tab, KEEP);
    expect(ok).toBe(false);
    expect(ui.confirmHistoryCapExceeded).toHaveBeenCalledWith(tab.name, 1);
    expect(fake.written()).toBeNull();
  });

  it('proceeds with the save once the warning is confirmed', async () => {
    const fake = fakeHandle();
    const ui = stubUi({ confirmHistoryCapExceeded: vi.fn(async () => true) });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    tab.handle = fake.handle;
    tab.doc.setHistoryMaxOverride(1);
    tab.doc.toBytes();
    expect(tab.doc.willDropOldestOnNextSave).toBe(true);

    const ok = await commands.save(tab, KEEP);
    expect(ok).toBe(true);
    expect(ui.confirmHistoryCapExceeded).toHaveBeenCalled();
    expect(fake.written()).not.toBeNull();
  });

  it('skips the warning once suppressed, without ever asking', async () => {
    setSuppressHistoryCapWarning(true);
    const fake = fakeHandle();
    const ui = stubUi({ confirmHistoryCapExceeded: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    tab.handle = fake.handle;
    tab.doc.setHistoryMaxOverride(1);
    tab.doc.toBytes();
    expect(tab.doc.willDropOldestOnNextSave).toBe(true);

    const ok = await commands.save(tab, KEEP);
    expect(ok).toBe(true);
    expect(ui.confirmHistoryCapExceeded).not.toHaveBeenCalled();
  });

  it('never warns when the retained-snapshot cap is unlimited', async () => {
    const fake = fakeHandle();
    const ui = stubUi({ confirmHistoryCapExceeded: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    await commands.run('file.new');
    const tab = state.activeTab!;
    if (tab.doc.kind !== 'rsf') throw new Error('expected an RSF document');
    tab.handle = fake.handle;
    tab.doc.setHistoryMaxOverride(null);
    tab.doc.toBytes();
    expect(tab.doc.willDropOldestOnNextSave).toBe(false);

    const ok = await commands.save(tab, KEEP);
    expect(ok).toBe(true);
    expect(ui.confirmHistoryCapExceeded).not.toHaveBeenCalled();
  });
});

describe('opening files by format', () => {
  it('opens a current .rsf container as a spreadsheet tab', async () => {
    const { state, commands } = setup();
    const bytes = encodeRsf({
      name: 'Sheet1',
      delimiter: ',',
      rowCount: 2,
      columnCount: 2,
      cells: [[0, 0, 'hi']],
    });
    await commands.openFiles([opened('doc.rsf', bytes)], { confirmNonCsv: false });
    const tab = state.activeTab!;
    expect(tab.doc.kind).toBe('rsf');
    expect(tab.name).toBe('doc.rsf');
    expect(tab.doc.getValue(0, 0)).toBe('hi');
  });

  it('refuses a file in the older binary format with a clear message, opening no tab', async () => {
    const ui = stubUi();
    const { state, commands } = setup(ui);
    // The first bytes of the binary container earlier releases wrote.
    const bytes = new Uint8Array([0x52, 0x43, 0x53, 0x56, 2, 0, 0, 0, ...new Array(16).fill(0)]);
    await commands.openFiles([opened('old.rcsv', bytes)], { confirmNonCsv: false });
    expect(state.tabs).toHaveLength(0);
    expect(ui.showMessage).toHaveBeenCalledWith(
      t('dialog.rsfInvalid.title'),
      t('dialog.rsfInvalid.message', { name: 'old.rcsv', reason: t('dialog.rsfInvalid.legacyFormat') }),
    );
  });

  it('imports a .xlsx workbook as a new .rsf tab (never the .xlsx as a save target)', async () => {
    const ui = stubUi();
    const { state, commands } = setup(ui);
    const sheets: XlsxSheetInput[] = [
      { name: 'Alpha', rows: [['a', 'b']] },
      { name: 'Beta', rows: [['c']] },
    ];
    const bytes = buildXlsxExport(sheets);
    await commands.openFiles([opened('book.xlsx', bytes)], { confirmNonCsv: true });
    const tab = state.activeTab!;
    expect(tab.doc.kind).toBe('rsf');
    expect(tab.name).toBe('book.rsf');
    expect(tab.handle).toBeNull();
    expect(tab.doc.isDirty).toBe(true);
    expect(ui.confirm).not.toHaveBeenCalled(); // the "not a CSV" prompt must not fire for .xlsx
    if (tab.doc.kind === 'rsf') {
      expect(tab.doc.sheets.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
      expect(tab.doc.getSheetDisplayValue(tab.doc.sheets[0].id, 0, 0)).toBe('a');
    }
    const notes = (ui.notify as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(notes.some((n) => typeof n === 'string' && n.includes('book.rsf'))).toBe(true);
  });

  it('reports an unreadable .xlsx without creating a tab', async () => {
    const ui = stubUi();
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('broken.xlsx', utf8('not actually a zip'))], { confirmNonCsv: false });
    expect(state.tabs).toHaveLength(0);
    expect(ui.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('XLSX'),
      expect.stringContaining('broken.xlsx'),
    );
  });
});

describe('replace all', () => {
  it('is a single atomic undoable operation with counts', async () => {
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('cat,catalog\ndog,cat\n'))], { confirmNonCsv: false });
    const tab = state.activeTab!;
    state.setReadOnly(tab, false);
    const query = compileQuery({ text: 'cat', matchCase: false, regex: false });
    const result = await commands.replaceAll(query, 'cow');
    expect(result).toMatchObject({ count: 3, cells: 3 });
    expect(tab.doc.getValue(0, 1)).toBe('cowalog');
    state.undo(tab);
    expect(tab.doc.isDirty).toBe(false);
    expect(tab.doc.getValue(0, 1)).toBe('catalog');
  });

  it('supports regex capture replacement across cells', async () => {
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('2026-07-16,2025-01-02\n'))], { confirmNonCsv: false });
    state.setReadOnly(state.activeTab!, false);
    const query = compileQuery({ text: '(\\d{4})-(\\d{2})-(\\d{2})', matchCase: false, regex: true });
    await commands.replaceAll(query, '$3/$2/$1');
    expect(state.activeTab!.doc.getValue(0, 0)).toBe('16/07/2026');
    expect(state.activeTab!.doc.getValue(0, 1)).toBe('02/01/2025');
  });
});

describe('Help menu commands', () => {
  it('routes About and Keyboard Shortcuts to independent showAbout sections', async () => {
    const ui = stubUi();
    const { commands } = setup(ui);
    await commands.run('help.about');
    expect(ui.showAbout).toHaveBeenLastCalledWith('about');
    await commands.run('help.shortcuts');
    expect(ui.showAbout).toHaveBeenLastCalledWith('shortcuts');
    await commands.run('help.formula');
    expect(ui.showFormulaHelp).toHaveBeenCalled();
  });
});

describe('view.fullscreen', () => {
  function fakeDocument(enabled: boolean) {
    const fake = {
      fullscreenEnabled: enabled,
      fullscreenElement: null as Element | null,
      documentElement: {} as HTMLElement,
      exitFullscreen: vi.fn(async () => {
        fake.fullscreenElement = null;
      }),
    };
    fake.documentElement.requestFullscreen = vi.fn(async () => {
      fake.fullscreenElement = fake.documentElement;
    });
    return fake;
  }

  it('enters full screen, then leaves it on the next run', async () => {
    const dom = fakeDocument(true);
    const commands = new Commands(new AppState(), stubUi(), dom as unknown as Document);
    expect(commands.isEnabled('view.fullscreen')).toBe(true);
    await commands.run('view.fullscreen');
    expect(commands.isFullscreen()).toBe(true);
    await commands.run('view.fullscreen');
    expect(dom.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(commands.isFullscreen()).toBe(false);
  });

  it('is disabled where the page may not go full screen', () => {
    const commands = new Commands(new AppState(), stubUi(), fakeDocument(false) as unknown as Document);
    expect(commands.isEnabled('view.fullscreen')).toBe(false);
  });

  it('reports a refused request instead of failing silently', async () => {
    const dom = fakeDocument(true);
    dom.documentElement.requestFullscreen = vi.fn(async () => {
      throw new TypeError('denied');
    });
    const ui = stubUi();
    const commands = new Commands(new AppState(), ui, dom as unknown as Document);
    await commands.run('view.fullscreen');
    expect(ui.notify).toHaveBeenCalledWith(t('notify.fullscreenFailed'), 'error');
  });
});
