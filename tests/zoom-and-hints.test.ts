// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Spreadsheet zoom (grid-scoped scaling, shared command/state, CSV-byte
 * safety, per-tab + app-preference precedence), the label-free Select All
 * corner control, and the configurable editing-help tooltips.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { setLocale, t } from '../src/app/i18n';
import { clampSheetZoom, getEditHints, getSheetZoom, setEditHints } from '../src/app/settings';
import { RsfDocument } from '../src/core/rsf-document';
import { serializeDocument } from '../src/core/serializer';
import { FormulaBar } from '../src/ui/formula-bar';
import { Grid } from '../src/ui/grid';
import { doc as csvDoc } from './helpers';

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
    confirmFlashFill: vi.fn(async () => false),
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

function makeGrid(ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  state.subscribe((event) => {
    if (event === 'selection') {
      grid.refreshSelection();
    } else {
      grid.refresh();
    }
  });
  return { state, grid, commands };
}

function rsfDoc(rows = 5, cols = 4): RsfDocument {
  const doc = RsfDocument.empty('t.rsf', rows, cols);
  doc.setCell(0, 0, 'hello');
  doc.markSaved();
  return doc;
}

beforeEach(() => {
  localStorage.clear();
  setLocale('en');
  document.body.innerHTML = '';
});

describe('zoom state and commands', () => {
  it('zoom commands set the active tab zoom through the shared state', async () => {
    const { state, commands } = makeGrid();
    const tab = state.addTab('t.rsf', rsfDoc(), null);
    expect(tab.zoom).toBe(100);
    await commands.run('view.zoom.150');
    expect(tab.zoom).toBe(150);
    await commands.run('view.zoom.reset');
    expect(tab.zoom).toBe(100);
  });

  it('clamps zoom values into the supported range', () => {
    expect(clampSheetZoom(10)).toBe(50);
    expect(clampSheetZoom(1000)).toBe(200);
    expect(clampSheetZoom(Number.NaN)).toBe(100);
    expect(clampSheetZoom(125)).toBe(125);
  });

  it('zoom becomes the app preference and records into RSF documents', () => {
    const state = new AppState();
    const doc = rsfDoc();
    const tab = state.addTab('t.rsf', doc, null);
    state.setTabZoom(tab, 125);
    expect(tab.zoom).toBe(125);
    expect(doc.displayZoom).toBe(125);
    expect(getSheetZoom()).toBe(125);
    // A new tab without a stored document zoom picks up the app preference…
    const tab2 = state.addTab('u.rsf', RsfDocument.empty('u.rsf', 2, 2), null);
    expect(tab2.zoom).toBe(125);
    // …while a document with a stored zoom takes precedence over it.
    const stored = RsfDocument.empty('v.rsf', 2, 2);
    stored.displayZoom = 90;
    const tab3 = state.addTab('v.rsf', stored, null);
    expect(tab3.zoom).toBe(90);
  });

  it('zoom on a CSV document is view-only: bytes and dirty state untouched', () => {
    const state = new AppState();
    const input = 'a,b\r\n1,2\r\n';
    const document_ = csvDoc(input);
    const tab = state.addTab('a.csv', document_, null);
    state.setTabZoom(tab, 200);
    expect(tab.zoom).toBe(200);
    expect(document_.isDirty).toBe(false);
    const result = serializeDocument(document_);
    expect(result.ok && result.mode).toBe('identity');
  });

  it('zoom is disabled without a document', () => {
    const { commands } = makeGrid();
    expect(commands.isEnabled('view.zoom.150')).toBe(false);
    expect(commands.isEnabled('view.zoom.reset')).toBe(false);
  });
});

describe('zoomed grid rendering', () => {
  it('scales row heights, header sizes, and column widths consistently', () => {
    const { state, grid } = makeGrid();
    const tab = state.addTab('t.rsf', rsfDoc(), null);
    grid.refresh();
    const headerBefore = grid.element.querySelector<HTMLElement>('.vgrid-header')!;
    expect(headerBefore.style.height).toBe('26px');
    const cellBefore = grid.element.querySelector<HTMLElement>('[data-row="0"][data-col="0"]')!;
    expect(cellBefore.style.width).toBe('132px');

    state.setTabZoom(tab, 200);
    const header = grid.element.querySelector<HTMLElement>('.vgrid-header')!;
    expect(header.style.height).toBe('52px');
    const cell = grid.element.querySelector<HTMLElement>('[data-row="0"][data-col="0"]')!;
    expect(cell.style.width).toBe('264px');
    const row = grid.element.querySelector<HTMLElement>('.vgrid-row')!;
    expect(row.style.height).toBe('52px');
    // The zoom factor is published for CSS (fonts, padding, fill handle).
    expect(grid.element.style.getPropertyValue('--sheet-zoom')).toBe('2');
    expect(grid.element.style.getPropertyValue('--grid-row-height')).toBe('52px');
  });

  it('keeps selection, navigation, and editing working at non-default zoom', () => {
    const { state, grid } = makeGrid();
    const tab = state.addTab('t.rsf', rsfDoc(), null);
    state.setTabZoom(tab, 150);
    state.setSelection(tab, { row: 1, col: 1 }, null);
    const cell = grid.element.querySelector<HTMLElement>('[data-row="1"][data-col="1"]');
    expect(cell?.classList.contains('selected')).toBe(true);
    grid.openEditor(tab, 1, 1, null);
    const editor = grid.element.querySelector<HTMLTextAreaElement>('.grid-sink.cell-editor');
    expect(editor).not.toBeNull();
  });

  it('column widths are stored zoom-independently (rendered scaled)', () => {
    const { state, grid } = makeGrid();
    const tab = state.addTab('t.rsf', rsfDoc(), null);
    tab.colWidths[0] = 100; // base (100%) units
    state.setTabZoom(tab, 150);
    grid.refresh();
    const cell = grid.element.querySelector<HTMLElement>('[data-row="0"][data-col="0"]')!;
    expect(cell.style.width).toBe('150px');
  });
});

describe('Select All corner control (no visible label)', () => {
  it('shows no visible text but keeps the localized accessible name', () => {
    const { state, grid } = makeGrid();
    state.addTab('t.rsf', rsfDoc(), null);
    grid.refresh();
    const corner = grid.element.querySelector<HTMLButtonElement>('.vcorner')!;
    expect(corner.textContent).toBe('');
    expect(corner.getAttribute('aria-label')).toBe(t('grid.selectAllCorner'));
    expect(corner.getAttribute('title')).toBe(t('grid.selectAllCorner'));
    setLocale('ja');
    grid.refresh();
    const cornerJa = grid.element.querySelector<HTMLButtonElement>('.vcorner')!;
    expect(cornerJa.getAttribute('aria-label')).toBe('すべてのセルを選択');
  });

  it('still selects every cell and reflects the pressed state', async () => {
    const { state, grid, commands } = makeGrid();
    const tab = state.addTab('t.rsf', rsfDoc(), null);
    grid.refresh();
    const corner = grid.element.querySelector<HTMLButtonElement>('.vcorner')!;
    expect(corner.getAttribute('aria-pressed')).toBe('false');
    await commands.run('edit.selectAll');
    const range = state.selectedRange(tab)!;
    expect(range).toEqual({ top: 0, left: 0, bottom: 4, right: 3 });
    const pressed = grid.element.querySelector<HTMLButtonElement>('.vcorner')!;
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('editing-help tooltips (configurable)', () => {
  it('defaults to enabled and toggles through the shared command', async () => {
    const { commands } = makeGrid();
    expect(getEditHints()).toBe(true);
    await commands.run('view.editHints');
    expect(getEditHints()).toBe(false);
    await commands.run('view.editHints');
    expect(getEditHints()).toBe(true);
  });

  it('formula bar shows no persistent hint text; guidance is title + ARIA', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    state.addTab('t.rsf', rsfDoc(), null);
    const bar = new FormulaBar(state, commands, () => undefined);
    document.body.append(bar.element);
    bar.refresh(true);
    // The guidance element is visually hidden (no persistent visible chrome).
    const hint = bar.element.querySelector('#formula-hint')!;
    expect(hint.classList.contains('visually-hidden')).toBe(true);
    expect(hint.textContent).toBe(t('formulaBar.hint'));
    const textarea = bar.element.querySelector('textarea')!;
    expect(textarea.getAttribute('title')).toBe(t('formulaBar.hint'));
    expect(textarea.getAttribute('aria-describedby')).toContain('formula-hint');
  });

  it('disabling the preference removes the tooltip and description text', () => {
    setEditHints(false);
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    state.addTab('t.rsf', rsfDoc(), null);
    const bar = new FormulaBar(state, commands, () => undefined);
    document.body.append(bar.element);
    bar.refresh(true);
    expect(bar.element.querySelector('#formula-hint')!.textContent).toBe('');
    expect(bar.element.querySelector('textarea')!.hasAttribute('title')).toBe(false);
  });

  it('the inline cell editor gets the tooltip when enabled, none when disabled', () => {
    const { state, grid } = makeGrid();
    const tab = state.addTab('t.rsf', rsfDoc(), null);
    grid.openEditor(tab, 0, 0, null);
    let editor = grid.element.querySelector<HTMLTextAreaElement>('.grid-sink.cell-editor')!;
    expect(editor.getAttribute('title')).toBe(t('formulaBar.hint'));
    expect(editor.getAttribute('aria-describedby')).toBe('grid-editor-hint');
    expect(document.getElementById('grid-editor-hint')?.textContent).toBe(t('formulaBar.hint'));
    grid.commitEditor();

    setEditHints(false);
    grid.openEditor(tab, 0, 0, null);
    editor = grid.element.querySelector<HTMLTextAreaElement>('.grid-sink.cell-editor')!;
    expect(editor.hasAttribute('title')).toBe(false);
    expect(editor.hasAttribute('aria-describedby')).toBe(false);
  });
});
