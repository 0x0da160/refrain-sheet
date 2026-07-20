// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { t } from '../src/app/i18n';
import { resolveShortcut } from '../src/app/shortcuts';
import { rangeToTsv } from '../src/core/clipboard';
import { RsfDocument, NEW_DOC_ROWS, NEW_DOC_COLS } from '../src/core/rsf-document';
import { Grid } from '../src/ui/grid';
import { StatusBar } from '../src/ui/status-bar';
import { doc } from './helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    chooseInsertShift: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    chooseSettings: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

const ctrlA = { key: 'a', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };

describe('Select All shortcut routing (browser-safe)', () => {
  it('resolves Ctrl+A only while the grid has focus', () => {
    expect(resolveShortcut(ctrlA, { inTextField: false, isComposing: false, inGrid: true })).toBe(
      'edit.selectAll',
    );
  });

  it('never intercepts Ctrl+A outside the grid or in text fields', () => {
    expect(resolveShortcut(ctrlA, { inTextField: false, isComposing: false, inGrid: false })).toBeNull();
    expect(resolveShortcut(ctrlA, { inTextField: false, isComposing: false })).toBeNull();
    expect(resolveShortcut(ctrlA, { inTextField: true, isComposing: false, inGrid: true })).toBeNull();
    expect(resolveShortcut(ctrlA, { inTextField: false, isComposing: true, inGrid: true })).toBeNull();
  });
});

beforeEach(() => {
  document.body.textContent = '';
});

describe('Edit > Select All Cells', () => {
  it('selects the used range of a CSV document', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('a.csv', doc('a,b,c\nd,e,f\ng,h,i\n'), null);
    await commands.run('edit.selectAll');
    const range = state.selectedRange(tab)!;
    expect(range).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
    expect(tab.selection).toEqual({ row: 0, col: 0 });
  });

  it('selects the whole logical grid of a new (blank) RSF document', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = commands.newDocument();
    await commands.run('edit.selectAll');
    const range = state.selectedRange(tab)!;
    expect(range).toEqual({ top: 0, left: 0, bottom: NEW_DOC_ROWS - 1, right: NEW_DOC_COLS - 1 });
  });

  it('reports a clear no-data state for an empty CSV document', async () => {
    const notify = vi.fn();
    const ui = stubUi({ notify });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('empty.csv', doc(''), null);
    expect(commands.isEnabled('edit.selectAll')).toBe(true);
    await commands.run('edit.selectAll');
    expect(notify).toHaveBeenCalledWith(t('notify.selectAllEmpty'), 'info');
    expect(state.selectedRange(tab)).toBeNull();
  });

  it('is disabled without an open document', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    expect(commands.isEnabled('edit.selectAll')).toBe(false);
  });

  it('copy after Select All covers the whole document', async () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const tab = state.addTab('a.csv', doc('a,b\nc,d\n'), null);
    await commands.run('edit.selectAll');
    expect(rangeToTsv(tab.doc, state.selectedRange(tab)!)).toBe('a\tb\nc\td');
  });

  it('renders whole-sheet selection on a large virtualized document without materializing all cells', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const grid = new Grid(state, commands);
    Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
    Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
    document.body.append(grid.element);
    const rows = 10_000;
    const csv = Array.from({ length: rows }, (_, r) => `r${r},1,2`).join('\n') + '\n';
    const tab = state.addTab('big.csv', doc(csv), null);
    grid.refresh();
    await commands.run('edit.selectAll');
    grid.refreshSelection();
    // Only the virtualized window exists in the DOM — far fewer than 10,000 rows.
    const rendered = grid.element.querySelectorAll('[data-row][data-col]');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(500);
    // Every rendered cell reads as selected; the headers highlight too.
    const active = grid.element.querySelector('[data-row="0"][data-col="0"]')!;
    expect(active.classList.contains('selected')).toBe(true);
    expect(grid.element.querySelector('[data-row="1"][data-col="1"]')!.classList.contains('in-range')).toBe(
      true,
    );
    expect(grid.element.querySelector('[data-colhead="1"]')!.classList.contains('hdr-sel')).toBe(true);
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 0, bottom: rows - 1, right: 2 });
  });

  it('shows a pending "Calculating…" state for whole-sheet selection statistics', async () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const statusBar = new StatusBar(state, () => undefined);
    const rows = 10_000;
    const csv = Array.from({ length: rows }, () => '1,2,3').join('\n') + '\n';
    state.addTab('big.csv', doc(csv), null);
    await commands.run('edit.selectAll');
    statusBar.render();
    // 30,000 cells crosses the synchronous stats limit: the placeholder shows
    // immediately and the aggregate scan fills in from time slices.
    expect(statusBar.element.querySelector('.sel-stat.calculating')).not.toBeNull();
  });

  it('works with the structural row/column commands (delete-all stays guarded)', async () => {
    const notify = vi.fn();
    const ui = stubUi({ notify });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab(
      'd.rcsv',
      (() => {
        const d = RsfDocument.empty('d.rcsv', 3, 3);
        d.markSaved();
        return d;
      })(),
      null,
    );
    await commands.run('edit.selectAll');
    await commands.run('sheet.deleteRows');
    // Deleting every row of the sheet is refused, not partially applied.
    expect(notify).toHaveBeenCalledWith(t('notify.cannotDeleteAll'), 'warn');
    expect(tab.doc.rowCount).toBe(3);
  });
});
