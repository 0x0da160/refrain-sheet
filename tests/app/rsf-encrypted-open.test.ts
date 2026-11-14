// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Opening an encrypted `.rsf` file through `Commands`: the password is asked
 * for before anything is shown, a wrong or changed file asks again and opens
 * nothing, cancelling opens nothing, a plain `.rsf` file never asks, and a save
 * keeps an opened encrypted file encrypted under the same keys.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import type { OpenedFile } from '../../src/app/file-access';
import { setLocale } from '../../src/app/i18n';
import { initCsvEngine } from '../../src/core/csv/csv-engine';
import { isWorkbook } from '../../src/core/editor-document';
import { KEEP_SAVE_OPTIONS } from '../../src/core/csv/serializer';
import { unpackRsfJsonText } from '../../src/core/workbook/rsf-codec';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { openEncryptedRsf } from '../../src/core/workbook/rsf-encrypted-file';
import {
  type Argon2Params,
  createRsfEncryptedContainer,
  defaultRsfEncryptionDeps,
  isRsfEncryptedContainer,
} from '../../src/core/workbook/rsf-encryption';

const SMALL: Argon2Params = { memoryKiB: 8, passes: 1, lanes: 1 };
const PASSWORD = 'correct horse battery';
const MARKER = 'Q3 revenue 4200';

/** A UI port whose dialogs are spies that answer nothing, except the overrides. */
function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  const spies = new Map<PropertyKey, unknown>();
  return new Proxy(overrides, {
    get(target, key) {
      if (key in target) {
        return target[key as keyof UiPort];
      }
      if (!spies.has(key)) {
        spies.set(key, vi.fn());
      }
      return spies.get(key);
    },
  }) as unknown as UiPort;
}

function plainBook(): Uint8Array {
  return RsfDocument.fromSheetValues('book.rsf', [
    { name: 'Budget', rows: [[MARKER, '4200']], columnCount: 2 },
  ]).toBytes();
}

async function encryptedBook(): Promise<Uint8Array> {
  const text = unpackRsfJsonText(plainBook());
  if (text === null) {
    throw new Error('the fixture is not a plain .rsf file');
  }
  const created = await createRsfEncryptedContainer(
    new TextEncoder().encode(text),
    PASSWORD,
    defaultRsfEncryptionDeps(),
    SMALL,
  );
  return created.bytes;
}

function openedFile(name: string, bytes: Uint8Array, handle: FileSystemFileHandle | null = null): OpenedFile {
  return { name, bytes, handle, size: bytes.length };
}

/** A file handle over `current`: reads return its bytes, and each write replaces them and is recorded. */
function fileHandle(current: { bytes: Uint8Array }, writes: Uint8Array[]): FileSystemFileHandle {
  return {
    getFile: async () => new File([current.bytes.slice()], 'book.rsf', { lastModified: 1 }),
    createWritable: async () => ({
      write: async (data: Uint8Array) => {
        writes.push(data);
        current.bytes = data;
      },
      close: async () => undefined,
    }),
  } as unknown as FileSystemFileHandle;
}

function setup(ui: UiPort) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  return { state, commands };
}

function sheetsOf(tab: Tab) {
  if (!isWorkbook(tab.doc)) {
    throw new Error(`${tab.name} holds no workbook`);
  }
  return tab.doc.sheets;
}

function firstCell(tab: Tab): string {
  return sheetsOf(tab)[0].getValue(0, 0);
}

function contains(haystack: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((byte, i) => haystack[start + i] === byte)) {
      return true;
    }
  }
  return false;
}

beforeAll(async () => {
  await initCsvEngine();
});

beforeEach(() => {
  globalThis.localStorage?.clear();
  setLocale('en');
});

describe('opening an encrypted .rsf file', () => {
  it('asks for the password before showing anything, and opens with the right one', async () => {
    const promptRsfPassword = vi
      .fn<(name: string, retry: boolean) => Promise<string | null>>()
      .mockResolvedValueOnce('not the password')
      .mockResolvedValueOnce(PASSWORD);
    const ui = stubUi({ promptRsfPassword });
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('book.rsf', await encryptedBook())]);
    expect(promptRsfPassword.mock.calls).toEqual([
      ['book.rsf', false],
      ['book.rsf', true],
    ]);
    expect(state.tabs).toHaveLength(1);
    const opened = state.activeTab!;
    expect(isWorkbook(opened.doc)).toBe(true);
    expect(firstCell(opened)).toBe(MARKER);
    expect(opened.encryption).not.toBeNull();
    expect(ui.showMessage).not.toHaveBeenCalled();
  });

  it('opens nothing when the password prompt is cancelled', async () => {
    const promptRsfPassword = vi.fn(async () => null);
    const ui = stubUi({ promptRsfPassword });
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('book.rsf', await encryptedBook())]);
    expect(promptRsfPassword).toHaveBeenCalledTimes(1);
    expect(state.tabs).toHaveLength(0);
    expect(ui.showMessage).not.toHaveBeenCalled();
  });

  it('asks again after each wrong password, and opens nothing once cancelled', async () => {
    const promptRsfPassword = vi
      .fn<(name: string, retry: boolean) => Promise<string | null>>()
      .mockResolvedValueOnce('wrong one')
      .mockResolvedValueOnce('wrong two')
      .mockResolvedValueOnce(null);
    const ui = stubUi({ promptRsfPassword });
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('book.rsf', await encryptedBook())]);
    expect(promptRsfPassword.mock.calls).toEqual([
      ['book.rsf', false],
      ['book.rsf', true],
      ['book.rsf', true],
    ]);
    expect(state.tabs).toHaveLength(0);
    expect(ui.showMessage).not.toHaveBeenCalled();
  });

  it('treats a damaged file like a wrong password: it asks again, and opens nothing once cancelled', async () => {
    const damaged = await encryptedBook();
    damaged[damaged.length - 1] ^= 0x01;
    const promptRsfPassword = vi
      .fn<(name: string, retry: boolean) => Promise<string | null>>()
      .mockResolvedValueOnce(PASSWORD)
      .mockResolvedValueOnce(null);
    const ui = stubUi({ promptRsfPassword });
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('book.rsf', damaged)]);
    expect(promptRsfPassword.mock.calls).toEqual([
      ['book.rsf', false],
      ['book.rsf', true],
    ]);
    expect(state.tabs).toHaveLength(0);
    expect(ui.showMessage).not.toHaveBeenCalled();
  });

  it('saves an opened encrypted file encrypted under the same password, without asking again', async () => {
    const written: Uint8Array[] = [];
    const current = { bytes: await encryptedBook() };
    const promptRsfPassword = vi.fn(async () => PASSWORD);
    const ui = stubUi({ promptRsfPassword });
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('book.rsf', current.bytes, fileHandle(current, written))]);
    const tab = state.activeTab!;
    expect(await commands.save(tab, KEEP_SAVE_OPTIONS)).toBe(true);
    expect(promptRsfPassword).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    const saved = written[0];
    expect(isRsfEncryptedContainer(saved)).toBe(true);
    expect(contains(saved, MARKER)).toBe(false);
    const reopened = await openEncryptedRsf(saved, PASSWORD, defaultRsfEncryptionDeps());
    expect(reopened.ok).toBe(true);
  });

  it('opens a plain .rsf file without asking for a password', async () => {
    const promptRsfPassword = vi.fn(async () => null);
    const ui = stubUi({ promptRsfPassword });
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('book.rsf', plainBook())]);
    expect(promptRsfPassword).not.toHaveBeenCalled();
    expect(state.activeTab!.encryption).toBeNull();
    expect(firstCell(state.activeTab!)).toBe(MARKER);
  });
});
