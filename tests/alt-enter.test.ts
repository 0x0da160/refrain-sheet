// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Alt+Enter inserts a literal newline while editing (inline cell editor and
 * formula bar) without committing, and multi-line values round-trip through
 * CSV minimal-diff quoting, RSF, undo/redo, and Wrap Long Rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { RsfDocument } from '../src/core/rsf-document';
import { FormulaBar } from '../src/ui/formula-bar';
import { Grid, ROW_HEIGHT } from '../src/ui/grid';
import { asCsv, doc, saved } from './helpers';

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
    chooseFilter: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
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

function setupGrid(csv = 'ab,cd\n') {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
  document.body.append(grid.element);
  state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
  const tab = state.addTab('t.csv', doc(csv), null);
  grid.refresh();
  return { state, grid, commands, tab };
}

const altEnter = () =>
  new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true });

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('Alt+Enter in the inline cell editor', () => {
  it('inserts a newline at the caret without committing or moving', () => {
    const { grid, tab } = setupGrid();
    grid.openEditor(tab, 0, 0, null);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    input.value = 'ab';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(altEnter());
    expect(input.value).toBe('a\nb');
    // Still editing (not committed) and the selection did not move.
    expect(grid.element.querySelector('.cell-editor')).not.toBeNull();
    expect(tab.doc.getValue(0, 0)).toBe('ab');
    expect(tab.selection).toEqual({ row: 0, col: 0 });
  });

  it('replaces a text selection with a single newline', () => {
    const { grid, tab } = setupGrid();
    grid.openEditor(tab, 0, 0, null);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    input.value = 'abcd';
    input.setSelectionRange(1, 3); // select "bc"
    input.dispatchEvent(altEnter());
    expect(input.value).toBe('a\nd');
  });
});

describe('Alt+Enter in the formula bar', () => {
  it('inserts a newline without committing the cell', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const commit = vi.spyOn(commands, 'commitCellEdit');
    const moveDown = vi.fn();
    const bar = new FormulaBar(state, commands, moveDown);
    document.body.append(bar.element);
    state.addTab('t.csv', doc('ab,cd\n'), null);
    bar.refresh(true);
    const ta = bar.element.querySelector('textarea')!;
    ta.value = 'ab';
    ta.setSelectionRange(1, 1);
    ta.dispatchEvent(altEnter());
    expect(ta.value).toBe('a\nb');
    expect(commit).not.toHaveBeenCalled();
    expect(moveDown).not.toHaveBeenCalled();
  });
});

describe('multi-line value round trips', () => {
  it('quotes an edited multi-line field in CSV output (minimal diff)', () => {
    const { state, tab } = setupGrid('ab,cd\n');
    state.editCell(tab, 0, 0, 'a\nb');
    const bytes = saved(asCsv(tab.doc));
    const text = new TextDecoder().decode(bytes);
    // A field containing a newline must be quoted on serialization.
    expect(text).toContain('"a\nb"');
  });

  it('preserves a multi-line cell through an RSF save/load round trip', () => {
    const rcsv = RsfDocument.empty('t.rcsv', 2, 2);
    rcsv.setCell(0, 0, 'line1\nline2');
    const result = RsfDocument.fromBytes(rcsv.toBytes(), 't.rcsv');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.getValue(0, 0)).toBe('line1\nline2');
  });

  it('undoes and redoes a multi-line edit atomically', () => {
    const { state, tab } = setupGrid('ab,cd\n');
    state.editCell(tab, 0, 0, 'a\nb');
    expect(tab.doc.getValue(0, 0)).toBe('a\nb');
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('ab');
    state.redo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('a\nb');
  });

  it('grows the row via Wrap Long Rows after a multi-line value is entered', () => {
    const { state, grid, tab } = setupGrid('ab,cd\n');
    state.setWrapCells(true);
    grid.setTextMeasurer((text: string) => text.length * 10);
    grid.refresh();
    // Single-line initially.
    expect(grid.element.querySelector<HTMLElement>('.vgrid-row[data-row="0"]')!.style.height).toBe(
      `${ROW_HEIGHT}px`,
    );
    // Enter a two-line value; the row grows and gets the wrapped class.
    state.editCell(tab, 0, 0, 'a\nb');
    grid.refresh();
    const rowEl = grid.element.querySelector<HTMLElement>('.vgrid-row[data-row="0"]')!;
    expect(rowEl.classList.contains('wrapped')).toBe(true);
    expect(Number.parseInt(rowEl.style.height, 10)).toBeGreaterThan(ROW_HEIGHT);
  });
});
