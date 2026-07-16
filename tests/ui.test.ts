// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { fileSystemAccessAvailable, saveBytes } from '../src/app/file-access';
import { Grid } from '../src/ui/grid';
import { StatusBar } from '../src/ui/status-bar';
import { TabBar } from '../src/ui/tab-bar';
import { doc, utf8 } from './helpers';

const noopUi: UiPort = {
  confirmValidation: async () => true,
  confirmUnsaved: async () => 'discard',
  chooseSaveOptions: async () => null,
  confirmUnrepresentable: async () => false,
  notifyNcr: async () => undefined,
  confirmUndecodableEdit: async () => true,
  chooseReopen: async () => null,
  confirm: async () => true,
  showMessage: async () => undefined,
  notify: () => undefined,
  openFindBar: () => undefined,
  findNext: () => undefined,
  showAbout: () => undefined,
};

function setup() {
  const state = new AppState();
  const commands = new Commands(state, noopUi, document);
  const grid = new Grid(state, commands);
  document.body.append(grid.element);
  return { state, commands, grid };
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('XSS safety', () => {
  it('renders HTML-like cell values as plain text, never as markup', () => {
    const { state, grid } = setup();
    const payload = '<img src=x onerror="window.__pwned=true"><script>window.__pwned=true</script>';
    state.addTab('evil.csv', doc(`name,payload\nrow,"${payload.replace(/"/g, '""')}"\n`), null);
    grid.refresh();
    const cells = grid.element.querySelectorAll('td[data-col]');
    const texts = Array.from(cells).map((c) => c.textContent);
    expect(texts).toContain(payload);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('renders hostile file names in tabs as text', () => {
    const state = new AppState();
    const commands = new Commands(state, noopUi, document);
    const tabBar = new TabBar(state, commands);
    state.addTab('<b>bold</b>.csv', doc('a\n'), null);
    tabBar.render();
    expect(tabBar.element.querySelector('b')).toBeNull();
    expect(tabBar.element.textContent).toContain('<b>bold</b>.csv');
  });
});

describe('grid rendering', () => {
  it('tints edited cells and exposes the original value as a text tooltip', () => {
    const { state, grid } = setup();
    const tab = state.addTab('a.csv', doc('a,b\n'), null);
    grid.refresh();
    state.editCell(tab, 0, 1, 'changed');
    grid.refresh();
    const td = grid.element.querySelector('td[data-row="0"][data-col="1"]')!;
    expect(td.classList.contains('edited')).toBe(true);
    expect(td.getAttribute('title')).toBe('b');
    expect(td.textContent).toBe('changed');
  });

  it('marks malformed fields', () => {
    const { state, grid } = setup();
    state.addTab('a.csv', doc('a,"x"junk\n'), null);
    grid.refresh();
    const td = grid.element.querySelector('td[data-row="0"][data-col="1"]')!;
    expect(td.classList.contains('malformed')).toBe(true);
  });

  it('shows an empty-state message when no file is open', () => {
    const { grid } = setup();
    grid.refresh();
    expect(grid.element.querySelector('.grid-empty')).not.toBeNull();
  });
});

describe('status bar', () => {
  it('shows encoding, delimiter, line endings, and size', () => {
    const state = new AppState();
    state.addTab('a.csv', doc('a,b\r\n1,2\r\n'), null);
    const statusBar = new StatusBar(state, () => undefined);
    statusBar.render();
    const text = statusBar.element.textContent ?? '';
    expect(text).toContain('UTF-8');
    expect(text).toContain('CRLF');
    expect(text).toContain('Comma');
    expect(text).toContain('10');
  });
});

describe('save fallback based on File System Access availability', () => {
  it('jsdom has no File System Access API', () => {
    expect(fileSystemAccessAvailable()).toBe(false);
  });

  it('saveBytes downloads when no handle is available', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const clicks: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    try {
      const outcome = await saveBytes(document, 'file.csv', utf8('a,b\n'), null);
      expect(outcome).toEqual({ mode: 'download', downloadName: 'file.csv', fellBack: false });
      expect(clicks).toEqual(['file.csv']);
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }
  });

  it('saveBytes reports a fallback when the handle write fails', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const handle = {
      createWritable: async () => {
        throw new DOMException('no', 'NotAllowedError');
      },
    } as unknown as FileSystemFileHandle;
    const outcome = await saveBytes(document, 'file.csv', utf8('x'), handle);
    expect(outcome.mode).toBe('download');
    expect(outcome.fellBack).toBe(true);
  });

  it('saveBytes overwrites through a working handle', async () => {
    let captured: Uint8Array | null = null;
    const handle = {
      createWritable: async () => ({
        write: async (data: Uint8Array) => {
          captured = new Uint8Array(data);
        },
        close: async () => undefined,
      }),
    } as unknown as FileSystemFileHandle;
    const outcome = await saveBytes(document, 'file.csv', utf8('x,y\n'), handle);
    expect(outcome).toEqual({ mode: 'overwrite', fellBack: false });
    expect(Array.from(captured!)).toEqual(Array.from(utf8('x,y\n')));
  });
});
