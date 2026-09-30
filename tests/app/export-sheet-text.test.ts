// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';

/** A UiPort whose every method is a spy resolving to undefined. */
function stubUi(): UiPort {
  const spies: Record<string | symbol, unknown> = {};
  return new Proxy(spies, {
    get: (target, key) => (target[key] ??= vi.fn(async () => undefined)),
  }) as unknown as UiPort;
}

/** Stands in for the browser's save picker, keeping what is written and the name asked for. */
function stubSavePicker(): { name: () => string; text: () => string } {
  let suggested = '';
  let written: Uint8Array<ArrayBufferLike> = new Uint8Array();
  vi.stubGlobal(
    'showSaveFilePicker',
    vi.fn(async (options: { suggestedName: string }) => {
      suggested = options.suggestedName;
      return {
        createWritable: async () => ({
          write: async (data: Uint8Array) => {
            written = data;
          },
          close: async () => undefined,
        }),
      };
    }),
  );
  return { name: () => suggested, text: () => new TextDecoder().decode(written) };
}

afterEach(() => vi.unstubAllGlobals());

describe('exporting a text sheet as its own file', () => {
  it.each([
    ['markdown', 'Notes', '# Title\r\n\r\nBody', 'Notes.md'],
    ['json', 'data.json', '{ "a": 1.0 }', 'data.json'],
    ['yaml', 'Config', 'aaa:\n# kept\n', 'Config.yaml'],
    ['text', 'Memo', 'plain text', 'Memo.txt'],
  ] as const)('writes a %s sheet exactly as it holds it', async (kind, sheetName, text, fileName) => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    state.addTab('book.rsf', RsfDocument.fromSourceText('book.rsf', kind, text, sheetName), null);
    const picker = stubSavePicker();
    expect(commands.isEnabled('sheet.exportSheetText')).toBe(true);
    await commands.run('sheet.exportSheetText');
    expect(picker.name()).toBe(fileName);
    expect(picker.text()).toBe(text);
  });

  it('is off on a sheet of cells', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    state.addTab('book.rsf', RsfDocument.empty('book.rsf', 3, 3, 'Sheet1'), null);
    expect(commands.isEnabled('sheet.exportSheetText')).toBe(false);
  });
});
