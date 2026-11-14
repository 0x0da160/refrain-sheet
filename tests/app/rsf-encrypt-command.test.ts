// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Encrypting an open .rsf file from File > This File > Encrypt with Password…:
 * the new password is asked for, and the file is written encrypted under it,
 * with the tab keeping those keys. A cancelled prompt, a refused password, or a
 * write that fails leaves the file and the tab as they were. A file that is
 * already encrypted, and a CSV tab, are not offered the command.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import type { OpenedFile } from '../../src/app/file-access';
import { setLocale, t } from '../../src/app/i18n';
import { initCsvEngine } from '../../src/core/csv/csv-engine';
import { isWorkbook } from '../../src/core/editor-document';
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

/** A file handle whose writes always fail, as a full disk or a locked file would. */
function failingHandle(current: { bytes: Uint8Array }): FileSystemFileHandle {
  return {
    getFile: async () => new File([current.bytes.slice()], 'book.rsf', { lastModified: 1 }),
    createWritable: async () => {
      throw new Error('disk full');
    },
  } as unknown as FileSystemFileHandle;
}

function setup(ui: UiPort) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  return { state, commands };
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

// Each run of the password step does one Argon2id run at the default cost, so these tests allow more time.
const SLOW = 60_000;

describe('encrypting an open .rsf file', () => {
  it(
    'writes the file encrypted under the new password, and the tab keeps those keys',
    async () => {
      const written: Uint8Array[] = [];
      const current = { bytes: plainBook() };
      const promptNewRsfPassword = vi.fn(async () => PASSWORD);
      const ui = stubUi({ promptNewRsfPassword });
      const { state, commands } = setup(ui);
      await commands.openFiles([openedFile('book.rsf', current.bytes, fileHandle(current, written))]);
      await commands.run('file.encrypt');
      expect(promptNewRsfPassword).toHaveBeenCalledWith('book.rsf');
      expect(written).toHaveLength(1);
      const saved = written[0];
      expect(isRsfEncryptedContainer(saved)).toBe(true);
      expect(contains(saved, MARKER)).toBe(false);
      expect(state.activeTab!.encryption).toBeTruthy();
      const reopened = await openEncryptedRsf(saved, PASSWORD, defaultRsfEncryptionDeps());
      expect(reopened.ok).toBe(true);
      if (reopened.ok) {
        const result = RsfDocument.fromBytes(reopened.plain, 'book.rsf');
        expect(result.ok && result.doc.sheets[0].getValue(0, 0)).toBe(MARKER);
      }
    },
    SLOW,
  );

  it('writes nothing and leaves the tab plain when the password prompt is cancelled', async () => {
    const written: Uint8Array[] = [];
    const current = { bytes: plainBook() };
    const original = current.bytes;
    const ui = stubUi({ promptNewRsfPassword: vi.fn(async () => null) });
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('book.rsf', current.bytes, fileHandle(current, written))]);
    await commands.run('file.encrypt');
    expect(written).toHaveLength(0);
    expect(current.bytes).toBe(original);
    expect(state.activeTab!.encryption ?? null).toBeNull();
  });

  it('reports a password the core refuses, and writes nothing', async () => {
    const written: Uint8Array[] = [];
    const current = { bytes: plainBook() };
    const ui = stubUi({ promptNewRsfPassword: vi.fn(async () => 'too short') });
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('book.rsf', current.bytes, fileHandle(current, written))]);
    await commands.run('file.encrypt');
    expect(written).toHaveLength(0);
    expect(ui.notify).toHaveBeenCalledWith(t('notify.rsfEncryptFailed', { name: 'book.rsf' }), 'error');
    expect(state.activeTab!.encryption ?? null).toBeNull();
  });

  it(
    'downloads the encrypted copy when the file cannot be written in place, and the tab stays encrypted',
    async () => {
      const current = { bytes: plainBook() };
      const original = current.bytes;
      const blobs: Blob[] = [];
      const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
        blobs.push(blob as Blob);
        return 'blob:encrypted-copy';
      });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      const ui = stubUi({ promptNewRsfPassword: vi.fn(async () => PASSWORD) });
      const { state, commands } = setup(ui);
      await commands.openFiles([openedFile('book.rsf', current.bytes, failingHandle(current))]);
      try {
        await commands.run('file.encrypt');
      } finally {
        createUrl.mockRestore();
        click.mockRestore();
      }
      expect(ui.notify).toHaveBeenCalledWith(t('notify.permissionDenied'), 'warn');
      expect(current.bytes).toBe(original);
      expect(state.activeTab!.encryption).toBeTruthy();
      expect(blobs).toHaveLength(1);
      const downloaded = await new Promise<Uint8Array>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.readAsArrayBuffer(blobs[0]);
      });
      expect(isRsfEncryptedContainer(downloaded)).toBe(true);
      expect(contains(downloaded, MARKER)).toBe(false);
    },
    SLOW,
  );

  it(
    'leaves the file and the tab plain when the file changed on disk and the overwrite is cancelled',
    async () => {
      const written: Uint8Array[] = [];
      const current = { bytes: plainBook() };
      const original = current.bytes;
      const confirmChangedOnDisk = vi.fn(async () => 'cancel' as const);
      const ui = stubUi({ promptNewRsfPassword: vi.fn(async () => PASSWORD), confirmChangedOnDisk });
      const { state, commands } = setup(ui);
      // A stamp that no longer matches the file on disk: the file changed after it was opened.
      const file = {
        ...openedFile('book.rsf', current.bytes, fileHandle(current, written)),
        stamp: { lastModified: 0, size: 0 },
      };
      await commands.openFiles([file]);
      await commands.run('file.encrypt');
      expect(confirmChangedOnDisk).toHaveBeenCalledWith('book.rsf');
      expect(written).toHaveLength(0);
      expect(current.bytes).toBe(original);
      expect(state.activeTab!.encryption ?? null).toBeNull();
    },
    SLOW,
  );

  it('is not offered again for a file that is already encrypted', async () => {
    const written: Uint8Array[] = [];
    const current = { bytes: await encryptedBook() };
    const promptNewRsfPassword = vi.fn(async () => PASSWORD);
    const ui = stubUi({ promptRsfPassword: vi.fn(async () => PASSWORD), promptNewRsfPassword });
    const { commands } = setup(ui);
    await commands.openFiles([openedFile('book.rsf', current.bytes, fileHandle(current, written))]);
    expect(commands.isEnabled('file.encrypt')).toBe(false);
    await commands.run('file.encrypt');
    expect(promptNewRsfPassword).not.toHaveBeenCalled();
    expect(written).toHaveLength(0);
  });

  it('is not offered for a CSV tab', async () => {
    const ui = stubUi();
    const { state, commands } = setup(ui);
    await commands.openFiles([openedFile('data.csv', new TextEncoder().encode('a,b\n1,2\n'))]);
    expect(state.activeTab && isWorkbook(state.activeTab.doc)).toBe(false);
    expect(commands.isEnabled('file.encrypt')).toBe(false);
  });
});
