// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * File > Open Recent with Google Drive (hosted build): Drive files opened or
 * saved are remembered apart from files on this device, listed under their
 * own heading, and opened again with no Picker; a file Drive no longer has
 * is dropped from the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const drive = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock('../../src/app/drive/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/app/drive/config')>()),
  driveConfigured: () => true,
}));
vi.mock('../../src/app/drive/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/app/drive/auth')>()),
  getAccessToken: async () => 'token',
}));
vi.mock('../../src/app/drive/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/app/drive/client')>();
  return {
    ...actual,
    downloadFile: async (fileId: string) => {
      const text = drive.files.get(fileId);
      if (text === undefined) {
        throw new actual.DriveApiError(404, 'File not found');
      }
      return new TextEncoder().encode(text);
    },
  };
});

import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import type { RecentFileChoice } from '../../src/app/ui-port';
import { MemoryRecentFilesStore, recordRecentFile, setRecentFilesStore } from '../../src/app/recent-files';
import {
  listRecentDriveFiles,
  recordRecentDriveFile,
  removeRecentDriveFile,
} from '../../src/app/recent-drive-files';
import { MAX_RECENT_FILES } from '../../src/app/recent-files';
import { setLocale } from '../../src/app/i18n';
import { FileIoDialogs } from '../../src/ui/dialogs/file-io';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return new Proxy(
    { notify: vi.fn(), setBusy: vi.fn(), ...overrides },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn(async () => null)),
    },
  ) as unknown as UiPort;
}

const localHandle = {
  name: 'here.csv',
  isSameEntry: async () => false,
} as unknown as FileSystemFileHandle;

beforeEach(() => {
  setLocale('en');
  localStorage.clear();
  setRecentFilesStore(new MemoryRecentFilesStore());
  drive.files.clear();
  document.body.textContent = '';
});

afterEach(() => vi.unstubAllGlobals());

describe('recent Drive files list', () => {
  it('keeps one entry per Drive file, newest first, and at most MAX_RECENT_FILES', () => {
    recordRecentDriveFile('a', 'a.csv', 1);
    recordRecentDriveFile('b', 'b.csv', 2);
    recordRecentDriveFile('a', 'renamed.csv', 3);
    expect(listRecentDriveFiles().map((e) => [e.fileId, e.name])).toEqual([
      ['a', 'renamed.csv'],
      ['b', 'b.csv'],
    ]);
    for (let i = 0; i < MAX_RECENT_FILES + 3; i++) {
      recordRecentDriveFile(`f${i}`, `f${i}.csv`, 10 + i);
    }
    expect(listRecentDriveFiles()).toHaveLength(MAX_RECENT_FILES);
    removeRecentDriveFile(`f${MAX_RECENT_FILES + 2}`);
    expect(listRecentDriveFiles()[0].fileId).toBe(`f${MAX_RECENT_FILES + 1}`);
  });

  it('reads a damaged stored list as empty', () => {
    localStorage.setItem('refrain-sheet.recentDriveFiles', '{not json');
    expect(listRecentDriveFiles()).toEqual([]);
    localStorage.setItem('refrain-sheet.recentDriveFiles', JSON.stringify([{ fileId: 1 }, 'x']));
    expect(listRecentDriveFiles()).toEqual([]);
  });
});

describe('File > Open Recent with Google Drive', () => {
  it('lists Drive files apart from files on this device and opens one again', async () => {
    drive.files.set('d1', 'a,b\n1,2\n');
    recordRecentDriveFile('d1', 'report.csv', 5);
    await recordRecentFile(localHandle, 'here.csv', 9);
    const state = new AppState();
    const chooseRecentFile = vi.fn(
      async (entries: RecentFileChoice[]) => entries.find((e) => e.where === 'drive')!.id,
    );
    const commands = new Commands(state, stubUi({ chooseRecentFile }), document);
    expect(commands.isEnabled('file.openRecent')).toBe(true);
    await commands.run('file.openRecent');
    expect(chooseRecentFile.mock.calls[0][0].map((e) => [e.name, e.where])).toEqual([
      ['here.csv', 'device'],
      ['report.csv', 'drive'],
    ]);
    expect(state.activeTab?.name).toBe('report.csv');
    expect(state.activeTab?.drive).toEqual({ fileId: 'd1', name: 'report.csv' });
    expect(state.activeTab?.doc.getValue(1, 1)).toBe('2');
    expect(listRecentDriveFiles()[0].openedAt).toBeGreaterThan(5);
  });

  it('drops a Drive file that is gone and says so', async () => {
    recordRecentDriveFile('gone', 'gone.csv');
    const notify = vi.fn();
    const state = new AppState();
    const commands = new Commands(
      state,
      stubUi({ notify, chooseRecentFile: async (entries) => entries[0].id }),
      document,
    );
    await commands.run('file.openRecent');
    expect(state.tabs).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('gone.csv'), 'warn');
    expect(listRecentDriveFiles()).toEqual([]);
  });

  it('clears both lists from the dialog', async () => {
    recordRecentDriveFile('d1', 'report.csv');
    await recordRecentFile(localHandle, 'here.csv');
    const commands = new Commands(
      new AppState(),
      stubUi({ chooseRecentFile: async () => 'clear' }),
      document,
    );
    await commands.run('file.openRecent');
    expect(listRecentDriveFiles()).toEqual([]);
  });

  it('names Google Drive when there is nothing to list yet', async () => {
    const notify = vi.fn();
    const commands = new Commands(new AppState(), stubUi({ notify }), document);
    await commands.run('file.openRecent');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Google Drive'), 'info');
  });
});

describe('the Open Recent dialog', () => {
  // jsdom does not implement <dialog>.showModal(); make the element "open" so its content is queryable.
  beforeEach(() => {
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
    if (typeof proto.showModal !== 'function') {
      proto.showModal = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      proto.close = function (this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  });

  const row = (name: string, where: 'device' | 'drive'): RecentFileChoice => ({
    id: `${where}-${name}`,
    name,
    openedAt: 0,
    where,
  });

  it('puts each kind under its own heading', async () => {
    const choice = new FileIoDialogs().chooseRecentFile([
      row('here.csv', 'device'),
      row('report.csv', 'drive'),
    ]);
    const headings = Array.from(document.querySelectorAll('.recent-files-heading')).map((h) => h.textContent);
    expect(headings).toEqual(['On This Device', 'Google Drive']);
    const lists = Array.from(document.querySelectorAll<HTMLElement>('.recent-files-list'));
    expect(lists.map((list) => list.textContent?.includes('report.csv'))).toEqual([false, true]);
    lists[1].querySelector<HTMLButtonElement>('.recent-file')!.click();
    expect(await choice).toBe('drive-report.csv');
  });

  it('shows no heading when only one kind is listed', async () => {
    const choice = new FileIoDialogs().chooseRecentFile([row('report.csv', 'drive')]);
    expect(document.querySelector('.recent-files-heading')).toBeNull();
    document.querySelector<HTMLButtonElement>('.recent-file')!.click();
    expect(await choice).toBe('drive-report.csv');
  });
});
