// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import type { OpenedFile } from '../src/app/file-access';
import { compileQuery } from '../src/core/search';
import { decodeBytes } from '../src/core/encoding';
import { enc, utf8 } from './helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
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
});

describe('saving', () => {
  it('overwrites through a File System Access handle and resets the baseline', async () => {
    const fake = fakeHandle();
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('a,b\n'), fake.handle)], { confirmNonCsv: false });
    const tab = state.activeTab!;
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
    expect(messages.some((m) => m.includes('NOT overwritten'))).toBe(true);
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

  it('cancels the save when characters are unrepresentable and the user declines', async () => {
    const fake = fakeHandle();
    const ui = stubUi({ confirmUnrepresentable: vi.fn(async () => false) });
    const { state, commands } = setup(ui);
    // Real Japanese content so the file is detected as Shift_JIS.
    await commands.openFiles([opened('a.csv', enc('名前,値\n', 'shift_jis'), fake.handle)], {
      confirmNonCsv: false,
    });
    expect(state.activeTab!.doc.encoding).toBe('shift_jis');
    const tab = state.activeTab!;
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
    // Reinterpret as UTF-8 so the 0xff byte is undecodable.
    state.setBaseline(tab, tab.doc.reinterpret({ encoding: 'utf-8' }));
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
    state.editCell(state.activeTab!, 0, 0, 'X');
    await commands.closeTab(state.activeTab!);
    expect(state.tabs.length).toBe(1);
  });

  it('discard closes without saving', async () => {
    const ui = stubUi({ confirmUnsaved: vi.fn(async () => 'discard' as const) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a\n'))], { confirmNonCsv: false });
    state.editCell(state.activeTab!, 0, 0, 'X');
    await commands.closeTab(state.activeTab!);
    expect(state.tabs.length).toBe(0);
  });

  it('save saves and then closes', async () => {
    const fake = fakeHandle();
    const ui = stubUi({ confirmUnsaved: vi.fn(async () => 'save' as const) });
    const { state, commands } = setup(ui);
    await commands.openFiles([opened('a.csv', utf8('a\n'), fake.handle)], { confirmNonCsv: false });
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

describe('replace all', () => {
  it('is a single atomic undoable operation with counts', async () => {
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('cat,catalog\ndog,cat\n'))], { confirmNonCsv: false });
    const tab = state.activeTab!;
    const query = compileQuery({ text: 'cat', matchCase: false, regex: false });
    const result = commands.replaceAll(query, 'cow');
    expect(result).toEqual({ count: 3, cells: 3 });
    expect(tab.doc.getValue(0, 1)).toBe('cowalog');
    state.undo(tab);
    expect(tab.doc.isDirty).toBe(false);
    expect(tab.doc.getValue(0, 1)).toBe('catalog');
  });

  it('supports regex capture replacement across cells', async () => {
    const { state, commands } = setup();
    await commands.openFiles([opened('a.csv', utf8('2026-07-16,2025-01-02\n'))], { confirmNonCsv: false });
    const query = compileQuery({ text: '(\\d{4})-(\\d{2})-(\\d{2})', matchCase: false, regex: true });
    commands.replaceAll(query, '$3/$2/$1');
    expect(state.activeTab!.doc.getValue(0, 0)).toBe('16/07/2026');
    expect(state.activeTab!.doc.getValue(0, 1)).toBe('02/01/2025');
  });
});
