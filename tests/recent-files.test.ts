// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * File > Open Recent (#598): files opened through the File System Access API
 * are remembered (newest first, one entry per file, at most
 * MAX_RECENT_FILES) and can be opened again from the list, after the
 * browser grants read permission; a file that has gone missing is dropped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import {
  MAX_RECENT_FILES,
  MemoryRecentFilesStore,
  listRecentFiles,
  recordRecentFile,
  setRecentFilesStore,
} from '../src/app/recent-files';

interface FakeHandle {
  name: string;
  getFile: () => Promise<File>;
  isSameEntry: (other: unknown) => Promise<boolean>;
  queryPermission: () => Promise<PermissionState>;
  requestPermission: () => Promise<PermissionState>;
}

function fakeHandle(
  name: string,
  text: string,
  opts: { permission?: PermissionState; missing?: boolean } = {},
): FileSystemFileHandle {
  const handle: FakeHandle = {
    name,
    getFile: async () => {
      if (opts.missing) {
        throw new DOMException('gone', 'NotFoundError');
      }
      // jsdom's File has no arrayBuffer(); provide just what readFileObject reads.
      const bytes = new TextEncoder().encode(text);
      return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer } as unknown as File;
    },
    isSameEntry: async (other) => (other as FakeHandle).name === name,
    queryPermission: async () => 'prompt',
    requestPermission: async () => opts.permission ?? 'granted',
  };
  return handle as unknown as FileSystemFileHandle;
}

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return new Proxy(
    { notify: vi.fn(), setBusy: vi.fn(), ...overrides },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn(async () => null)),
    },
  ) as unknown as UiPort;
}

beforeEach(() => {
  setRecentFilesStore(new MemoryRecentFilesStore());
  document.body.textContent = '';
});

describe('recent files list', () => {
  it('keeps one entry per file, newest first, and at most MAX_RECENT_FILES', async () => {
    await recordRecentFile(fakeHandle('a.csv', ''), 'a.csv', 1);
    await recordRecentFile(fakeHandle('b.csv', ''), 'b.csv', 2);
    await recordRecentFile(fakeHandle('a.csv', ''), 'a.csv', 3);
    expect((await listRecentFiles()).map((e) => e.name)).toEqual(['a.csv', 'b.csv']);

    for (let i = 0; i < MAX_RECENT_FILES + 3; i++) {
      await recordRecentFile(fakeHandle(`f${i}.csv`, ''), `f${i}.csv`, 10 + i);
    }
    const names = (await listRecentFiles()).map((e) => e.name);
    expect(names).toHaveLength(MAX_RECENT_FILES);
    expect(names[0]).toBe(`f${MAX_RECENT_FILES + 2}.csv`);
  });
});

describe('File > Open Recent', () => {
  it('records a file opened with a handle and opens it again from the list', async () => {
    const state = new AppState();
    const chooseRecentFile = vi.fn(async (entries: Array<{ id: string }>) => entries[0].id);
    const commands = new Commands(state, stubUi({ chooseRecentFile }), document);
    const handle = fakeHandle('data.csv', 'a,b\n1,2\n');
    const bytes = new TextEncoder().encode('a,b\n1,2\n');
    await commands.openFiles([{ name: 'data.csv', bytes, handle, size: bytes.length }], {
      confirmNonCsv: false,
    });
    expect((await listRecentFiles()).map((e) => e.name)).toEqual(['data.csv']);

    await commands.run('file.closeTab');
    expect(state.tabs).toHaveLength(0);
    await commands.run('file.openRecent');
    expect(chooseRecentFile).toHaveBeenCalledWith([expect.objectContaining({ name: 'data.csv' })]);
    expect(state.activeTab?.name).toBe('data.csv');
    expect(state.activeTab?.handle).toBe(handle);
    expect(state.activeTab?.doc.getValue(1, 1)).toBe('2');
  });

  it('does not record a file opened without a handle', async () => {
    const commands = new Commands(new AppState(), stubUi(), document);
    const bytes = new TextEncoder().encode('x\n');
    await commands.openFiles([{ name: 'x.csv', bytes, handle: null, size: bytes.length }], {
      confirmNonCsv: false,
    });
    expect(await listRecentFiles()).toEqual([]);
  });

  it('reports a denied permission and leaves the list alone', async () => {
    const notify = vi.fn();
    const state = new AppState();
    const commands = new Commands(
      state,
      stubUi({ notify, chooseRecentFile: async (entries) => entries[0].id }),
      document,
    );
    await recordRecentFile(fakeHandle('p.csv', 'x\n', { permission: 'denied' }), 'p.csv');
    await commands.run('file.openRecent');
    expect(state.tabs).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('p.csv'), 'warn');
    expect(await listRecentFiles()).toHaveLength(1);
  });

  it('drops a file that has been moved or deleted', async () => {
    const notify = vi.fn();
    const commands = new Commands(
      new AppState(),
      stubUi({ notify, chooseRecentFile: async (entries) => entries[0].id }),
      document,
    );
    await recordRecentFile(fakeHandle('gone.csv', '', { missing: true }), 'gone.csv');
    await commands.run('file.openRecent');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('gone.csv'), 'warn');
    expect(await listRecentFiles()).toEqual([]);
  });

  it('clears the list from the dialog', async () => {
    const commands = new Commands(
      new AppState(),
      stubUi({ chooseRecentFile: async () => 'clear' }),
      document,
    );
    await recordRecentFile(fakeHandle('a.csv', ''), 'a.csv');
    await commands.run('file.openRecent');
    expect(await listRecentFiles()).toEqual([]);
  });

  it('says so when the list is empty instead of showing an empty dialog', async () => {
    const notify = vi.fn();
    const chooseRecentFile = vi.fn(async () => null);
    const commands = new Commands(new AppState(), stubUi({ notify, chooseRecentFile }), document);
    await commands.run('file.openRecent');
    expect(chooseRecentFile).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'info');
  });
});
