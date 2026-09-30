// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { setLocale, t } from '../../src/app/i18n';
import { getStatusItemPlace, setStatusItemPlace, STATUS_ITEMS } from '../../src/app/status-bar-prefs';
import { customizeStatusBar } from '../../src/ui/dialogs/status-bar-customize';
import { formatFileSize, StatusBar } from '../../src/ui/status-bar';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { doc } from '../helpers';

beforeEach(() => {
  document.body.textContent = '';
});

describe('StatusBar selection stats', () => {
  it('hides the Sum stat (as well as Average/Min/Max) when a multi-cell selection has no numeric cells', () => {
    const state = new AppState();
    const tab = state.addTab('names.csv', doc('alice\nbob\ncarol\n'), null);
    const statusBar = new StatusBar(
      state,
      () => undefined,
      () => undefined,
    );
    state.setSelection(tab, { row: 2, col: 0 }, { row: 0, col: 0 });
    statusBar.render();
    const text = statusBar.element.textContent ?? '';
    expect(text).toContain('Numeric 0');
    expect(text).not.toContain('Sum');
    expect(text).not.toContain('Avg');
    expect(text).not.toContain('Min');
    expect(text).not.toContain('Max');
  });

  it('shows the Sum stat when the selection has at least one numeric cell', () => {
    const state = new AppState();
    const tab = state.addTab('mixed.csv', doc('alice,1\nbob,2\ncarol,3\n'), null);
    const statusBar = new StatusBar(
      state,
      () => undefined,
      () => undefined,
    );
    state.setSelection(tab, { row: 2, col: 1 }, { row: 0, col: 1 });
    statusBar.render();
    const text = statusBar.element.textContent ?? '';
    expect(text).toContain('Sum 6');
  });
});

describe('StatusBar file details (#594)', () => {
  it('marks the file details and keeps the Details toggle state across re-renders', () => {
    const state = new AppState();
    state.addTab('names.csv', doc('alice\nbob\n'), null);
    const statusBar = new StatusBar(
      state,
      () => undefined,
      () => undefined,
    );
    const details = statusBar.element.querySelectorAll('.status-detail');
    // Kind, encoding, delimiter, line endings, size, engine, and version.
    expect(details.length).toBe(7);
    expect(statusBar.element.querySelector('.status-selection')?.classList.contains('status-detail')).toBe(
      false,
    );

    const toggle = statusBar.element.querySelector<HTMLButtonElement>('.status-details-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(statusBar.element.classList.contains('details-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    statusBar.render();
    const again = statusBar.element.querySelector('.status-details-toggle')!;
    expect(statusBar.element.classList.contains('details-open')).toBe(true);
    expect(again.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the version on its own, not as a detail, when no document is open', () => {
    const statusBar = new StatusBar(
      new AppState(),
      () => undefined,
      () => undefined,
    );
    expect(statusBar.element.querySelector('.status-version')?.classList.contains('status-detail')).toBe(
      false,
    );
    expect(statusBar.element.querySelector('.status-details-toggle')).toBeNull();
  });
});

describe('StatusBar items, zoom, full screen and protection', () => {
  function withCommands(csv = 'a,1\nb,2\n') {
    localStorage.clear();
    setLocale('en');
    const state = new AppState();
    const commands = new Commands(
      state,
      new Proxy({} as UiPort, { get: () => vi.fn(async () => null) }),
      document,
    );
    const tab = state.addTab('data.csv', doc(csv), null);
    const toggle = vi.fn();
    const statusBar = new StatusBar(state, () => undefined, toggle, commands);
    document.body.append(statusBar.element);
    return { state, commands, tab, toggle, statusBar };
  }

  it('shows each item in the bar, behind Details, or not at all, as chosen', () => {
    const { statusBar } = withCommands();
    expect(statusBar.element.textContent).toContain('Delimiter');
    // Details is always there on a desktop: it lists every file detail.
    expect(statusBar.element.querySelector('.status-more')).not.toBeNull();
    setStatusItemPlace('delimiter', 'details');
    setStatusItemPlace('engine', 'hidden');
    statusBar.render();
    const inDetails = statusBar.element.querySelectorAll('.status-in-details');
    expect([...inDetails].map((node) => node.textContent)).toEqual(['Delimiter: Comma']);
    expect(statusBar.element.textContent).not.toContain('Engine');
    const more = statusBar.element.querySelector<HTMLButtonElement>('.status-more')!;
    more.click();
    const popover = document.querySelector('.status-details-popover')!;
    expect(popover.textContent).toContain('Delimiter: Comma');
    // Hidden from the bar, still listed among the file's details.
    expect(popover.textContent).toContain('Engine');
    expect(popover.textContent).toContain('File:');
    expect(popover.textContent).toContain(t('menu.view.customizeStatusBar'));
  });

  it('shows the size of an RSF or text file once it was opened or saved, in bytes and KB', () => {
    const { state, statusBar } = withCommands();
    expect(formatFileSize(512)).toBe('512 bytes');
    expect(formatFileSize(2048)).toBe('2,048 bytes (2.0 KB)');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3,145,728 bytes (3.0 MB)');
    const book = state.addTab('book.rsf', RsfDocument.empty('book.rsf', 3, 3), null);
    statusBar.render();
    expect(statusBar.element.textContent).not.toContain('bytes');
    book.fileSize = 4096;
    statusBar.render();
    expect(statusBar.element.textContent).toContain('4,096 bytes (4.0 KB)');
  });

  it('keeps the places in this browser, ignoring anything unreadable', () => {
    localStorage.clear();
    setStatusItemPlace('size', 'hidden');
    expect(getStatusItemPlace('size')).toBe('hidden');
    setStatusItemPlace('size', 'bar');
    expect(localStorage.getItem('refrain-csv-html.statusItems')).toBeNull();
    localStorage.setItem('refrain-csv-html.statusItems', '{"size":"nowhere","kind":"details"}');
    expect(getStatusItemPlace('size')).toBe('bar');
    expect(getStatusItemPlace('kind')).toBe('details');
    localStorage.setItem('refrain-csv-html.statusItems', 'not json');
    expect(getStatusItemPlace('kind')).toBe('bar');
  });

  it('zooms the spreadsheet from − , the list of levels and +', async () => {
    const { tab, statusBar } = withCommands();
    const select = statusBar.element.querySelector<HTMLSelectElement>('.status-zoom-select')!;
    expect(select.value).toBe('100');
    expect([...select.options].map((o) => o.value)).toEqual([
      '50',
      '75',
      '90',
      '100',
      '110',
      '125',
      '150',
      '200',
    ]);
    select.value = '150';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(tab.zoom).toBe(150));
    statusBar.render();
    statusBar.element.querySelector<HTMLButtonElement>(`[aria-label="${t('menu.view.zoomIn')}"]`)!.click();
    await vi.waitFor(() => expect(tab.zoom).toBe(200));
    statusBar.render();
    statusBar.element.querySelector<HTMLButtonElement>(`[aria-label="${t('menu.view.zoomOut')}"]`)!.click();
    await vi.waitFor(() => expect(tab.zoom).toBe(150));
  });

  it('lists a zoom that is not one of the levels', () => {
    const { tab, statusBar } = withCommands();
    tab.zoom = 80;
    statusBar.render();
    const select = statusBar.element.querySelector<HTMLSelectElement>('.status-zoom-select')!;
    expect(select.value).toBe('80');
  });

  it('shows protection as one button that flips between Protected and Edit', () => {
    const { state, tab, toggle, statusBar } = withCommands();
    state.setReadOnly(tab, true);
    statusBar.render();
    expect(statusBar.element.querySelectorAll('.status-protect')).toHaveLength(1);
    const on = statusBar.element.querySelector<HTMLButtonElement>('.status-protect')!;
    expect(on.classList.contains('status-protect-on')).toBe(true);
    expect(on.textContent).toBe(t('status.protected'));
    expect(on.querySelector('svg')).not.toBeNull();
    on.click();
    expect(toggle).toHaveBeenCalledTimes(1);
    state.setReadOnly(tab, false);
    statusBar.render();
    const edit = statusBar.element.querySelector<HTMLButtonElement>('.status-protect')!;
    expect(edit.classList.contains('status-protect-edit')).toBe(true);
    expect(edit.textContent).toBe(t('status.protect.edit'));
    edit.click();
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('offers Customize Status Bar… on a right-click', () => {
    const { statusBar } = withCommands();
    statusBar.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(document.body.textContent).toContain(t('menu.view.customizeStatusBar'));
  });
});

describe('View > Customize Status Bar…', () => {
  it('lists every item with its place, saving and redrawing at each change', () => {
    localStorage.clear();
    setLocale('en');
    const onChange = vi.fn();
    void customizeStatusBar(onChange);
    const select = document.querySelector<HTMLSelectElement>('#status-item-encoding')!;
    expect(document.querySelectorAll('[data-item]')).toHaveLength(STATUS_ITEMS.length);
    expect(select.value).toBe('bar');
    select.value = 'details';
    select.dispatchEvent(new Event('change'));
    expect(getStatusItemPlace('encoding')).toBe('details');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
