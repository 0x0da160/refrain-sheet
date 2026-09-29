// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The CSV-only minimal edition (src/app/edition.ts): what it leaves out of
 * the menus and commands, what it refuses to open or convert, and that a
 * CSV it saves has the same bytes as one the regular edition saves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { COMMAND_IDS } from '../../src/app/commands/catalog';
import { isCommandAvailable, setMinimalEditionForTests } from '../../src/app/edition';
import { KEEP_SAVE_OPTIONS } from '../../src/core/csv/serializer';
import { defaultMenus, type MenuChecks, type MenuDef, type MenuItemDef } from '../../src/ui/menu-bar/menus';
import { contextMenuEntries } from '../../src/ui/grid/context-menu-items';
import { utf8 } from '../helpers';

function stubUi(): UiPort {
  const target: Record<string | symbol, unknown> = {
    notify: vi.fn(),
    setBusy: vi.fn(),
    confirmConvert: vi.fn(async () => true),
    confirmValidation: vi.fn(async () => true),
  };
  return new Proxy(target, {
    get: (t, key) => {
      if (!(key in t)) {
        t[key] = vi.fn(async () => null);
      }
      return t[key];
    },
  }) as unknown as UiPort;
}

const checks = new Proxy({} as MenuChecks, { get: () => () => false });

function commandsIn(items: ReadonlyArray<MenuItemDef | 'separator'>): string[] {
  return items.flatMap((item) =>
    item === 'separator' ? [] : [...(item.command ? [item.command] : []), ...commandsIn(item.submenu ?? [])],
  );
}

/** Separators only between entries, never first, last or doubled. */
function tidy(items: ReadonlyArray<MenuItemDef | 'separator'>): boolean {
  return items.every((item, i) => {
    if (item === 'separator') {
      return i > 0 && i < items.length - 1 && items[i - 1] !== 'separator';
    }
    return !item.submenu || (item.submenu.length > 0 && tidy(item.submenu));
  });
}

/** A handle that keeps what is written through it. */
function handle(name: string) {
  let written: Uint8Array | null = null;
  const h = {
    kind: 'file',
    name,
    isSameEntry: async () => false,
    createWritable: async () => ({
      write: async (data: Uint8Array) => {
        written = new Uint8Array(data);
      },
      close: async () => undefined,
    }),
  } as unknown as FileSystemFileHandle;
  return { h, written: () => written };
}

const SOURCE = '﻿id;name;note\r\n2;"Bob";x\r\n1;Ann;"a ""quoted"" note"\r\n3;Cy;\r\n';

/** Open the same CSV, sort and filter it, edit two cells, try a formula, and save. */
async function editAndSave(): Promise<Uint8Array | null> {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const disk = handle('people.csv');
  const bytes = utf8(SOURCE);
  await commands.openFiles([{ name: 'people.csv', bytes, handle: disk.h, size: bytes.length }], {
    confirmNonCsv: false,
  });
  const tab = state.activeTab!;
  tab.readOnly = false; // opened files start protected
  state.setSelection(tab, { row: 0, col: 0 }, null);
  await commands.toggleHeaderFilter(tab);
  await commands.commitCellEdit(tab, 3, 2, 'new note');
  await commands.commitCellEdit(tab, 1, 1, 'Robert');
  expect(tab.doc.kind).toBe('csv');
  await commands.save(tab, KEEP_SAVE_OPTIONS);
  return disk.written();
}

afterEach(() => setMinimalEditionForTests(false));

describe('the CSV-only minimal edition', () => {
  it('leaves workbook, formatting, object, SQL, comparison and Drive commands out of the menus', () => {
    setMinimalEditionForTests(true);
    const menus = defaultMenus(checks);
    const listed = menus.flatMap((m: MenuDef) => commandsIn(m.items));
    for (const id of ['file.open', 'file.save', 'edit.undo', 'search.find', 'sheet.sort', 'sheet.filter']) {
      expect(listed).toContain(id);
    }
    expect(listed.filter((id) => /^(data|drive|format|insert|object|worksheet)\./.test(id))).toEqual([]);
    expect(listed).not.toContain('file.new');
    expect(listed).not.toContain('sheet.convert');
    expect(menus.map((m) => m.labelKey)).not.toContain('menu.format');
    expect(menus.every((m) => m.items.length > 0 && tidy(m.items))).toBe(true);
    // The regular edition still has everything.
    setMinimalEditionForTests(false);
    expect(defaultMenus(checks).flatMap((m) => commandsIn(m.items))).toContain('data.runSqlQuery');
  });

  it('keeps every command it lists enabled-able and runs none it leaves out', async () => {
    setMinimalEditionForTests(true);
    const left = COMMAND_IDS.filter((id) => !isCommandAvailable(id));
    expect(left).toContain('data.compareDiff');
    expect(left).not.toContain('sheet.filter');
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    commands.newCsvDocument();
    expect(commands.isEnabled('file.new')).toBe(false);
    await commands.run('file.new');
    expect(state.tabs).toHaveLength(1);
    const entries = contextMenuEntries(commands, state.activeTab!);
    expect(entries.some((e) => e !== 'separator' && e.label === 'Comment…')).toBe(false);
  });

  it('keeps a typed formula as text and refuses what needs a workbook', async () => {
    setMinimalEditionForTests(true);
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const bytes = utf8('a,b\n1,2\n');
    await commands.openFiles([{ name: 't.csv', bytes, handle: null, size: bytes.length }], {
      confirmNonCsv: false,
    });
    const tab = state.activeTab!;
    tab.readOnly = false; // opened files start protected
    await commands.commitCellEdit(tab, 1, 0, '=1+1');
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.getValue(1, 0)).toBe('=1+1');
    expect(ui.confirmConvert).not.toHaveBeenCalled();
    expect(await commands.ensureRsf(tab, 'fill')).toBeNull();
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining('regular edition'), 'info');
  });

  it('opens CSV, TSV and text files, and turns away workbooks and other files', async () => {
    setMinimalEditionForTests(true);
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const file = (name: string, text: string) => {
      const bytes = utf8(text);
      return { name, bytes, handle: null, size: bytes.length };
    };
    await commands.openFiles([file('a.rsf', 'x'), file('b.json', '{}'), file('c.md', '# x')], {
      confirmNonCsv: false,
    });
    expect(state.tabs).toHaveLength(0);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining('a.rsf'), 'error');
    await commands.openFiles([file('d.txt', 'a\tb\n'), file('e.tsv', 'a\tb\n')], { confirmNonCsv: false });
    expect(state.tabs.map((t) => t.doc.kind)).toEqual(['csv', 'csv']);
  });

  it('saves the same bytes as the regular edition', async () => {
    const regular = await editAndSave();
    setMinimalEditionForTests(true);
    const minimal = await editAndSave();
    expect(regular).not.toBeNull();
    expect(minimal).toEqual(regular);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(regular!);
    expect(text).toBe('﻿id;name;note\r\n2;"Robert";x\r\n1;Ann;"a ""quoted"" note"\r\n3;Cy;new note\r\n');
  });
});
