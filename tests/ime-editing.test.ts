// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Japanese-IME-safe cell editing. jsdom cannot run a real IME, so these tests
 * assert the *contract* the browser relies on: typing opens an empty editor
 * without synthesizing the key, and composition state (compositionstart /
 * compositionend, tracked alongside event.isComposing / keyCode 229) gates
 * every commit / navigation / autocomplete decision.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { FormulaBar } from '../src/ui/formula-bar';
import { Grid } from '../src/ui/grid';
import { beginsTextEntry, isComposingKey } from '../src/ui/ime';
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
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
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

function setupGrid(csv = 'a,b\nc,d\n') {
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

const editor = (grid: Grid): HTMLTextAreaElement =>
  grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('IME composition detection (pure)', () => {
  it('treats isComposing, keyCode 229, and the tracked flag as composing', () => {
    expect(isComposingKey({ isComposing: true, keyCode: 0 } as KeyboardEvent)).toBe(true);
    expect(isComposingKey({ isComposing: false, keyCode: 229 } as KeyboardEvent)).toBe(true);
    expect(isComposingKey({ isComposing: false, keyCode: 0 } as KeyboardEvent, true)).toBe(true);
    expect(isComposingKey({ isComposing: false, keyCode: 0 } as KeyboardEvent, false)).toBe(false);
  });

  it('begins text entry for printable keys and the IME sentinel, not chords/nav', () => {
    const base = { ctrlKey: false, metaKey: false, altKey: false, keyCode: 0 };
    expect(beginsTextEntry({ ...base, key: 'a' } as KeyboardEvent)).toBe(true);
    expect(beginsTextEntry({ ...base, key: ' ' } as KeyboardEvent)).toBe(true);
    expect(beginsTextEntry({ ...base, key: 'Process' } as KeyboardEvent)).toBe(true);
    expect(beginsTextEntry({ ...base, key: 'Unidentified', keyCode: 229 } as KeyboardEvent)).toBe(true);
    expect(beginsTextEntry({ ...base, key: 'Enter' } as KeyboardEvent)).toBe(false);
    expect(beginsTextEntry({ ...base, key: 'ArrowDown' } as KeyboardEvent)).toBe(false);
    // A modifier chord (Ctrl+A etc.) is a shortcut, not text entry.
    expect(beginsTextEntry({ ...base, key: 'a', ctrlKey: true } as KeyboardEvent)).toBe(false);
    expect(beginsTextEntry({ ...base, key: 'a', metaKey: true } as KeyboardEvent)).toBe(false);
  });
});

describe('IME-safe cell editing', () => {
  it('typing opens an empty editor without synthesizing the key (regression)', () => {
    const { grid } = setupGrid();
    grid.element.focus();
    const ev = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
    grid.element.dispatchEvent(ev);
    // The first Romaji key must not be committed as literal Latin text: the
    // editor opens empty and the event is not consumed (the browser routes the
    // key/composition into the field, which jsdom does not simulate).
    expect(editor(grid)).not.toBeNull();
    expect(editor(grid).value).toBe('');
    expect(ev.defaultPrevented).toBe(false);
  });

  it('does not commit on Enter while a composition is active, then commits after it ends', async () => {
    const { grid, tab } = setupGrid();
    grid.openEditor(tab, 0, 0, '');
    const input = editor(grid);
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    // The user is mid-conversion; Enter confirms the IME candidate, never the cell.
    input.value = 'にほん';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(grid.element.querySelector('.cell-editor')).not.toBeNull();
    expect(tab.doc.getValue(0, 0)).toBe('a');
    // Composition ends; now Enter commits the composed value and moves down.
    input.dispatchEvent(new CompositionEvent('compositionend', { data: 'にほん' }));
    input.value = 'にほん';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(tab.doc.getValue(0, 0)).toBe('にほん'));
  });

  it('does not cancel the edit on Escape while composing', () => {
    const { grid, tab } = setupGrid();
    grid.openEditor(tab, 0, 0, null);
    const input = editor(grid);
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    // Escape belongs to the IME (cancel a candidate); the editor stays open.
    expect(grid.element.querySelector('.cell-editor')).not.toBeNull();
  });

  it('keeps the editor mounted through a rerender that happens mid-composition', () => {
    const { grid, tab } = setupGrid();
    grid.openEditor(tab, 0, 0, null);
    const input = editor(grid);
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    // A grid rerender (e.g. background wrap-measure completing) must not tear
    // the composing editor out of the DOM.
    grid.refresh();
    expect(grid.element.querySelector('.cell-editor')).toBe(input);
  });
});

describe('IME-safe formula bar', () => {
  it('does not commit on Enter while the formula bar is composing', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const commit = vi.spyOn(commands, 'commitCellEdit');
    const moveDown = vi.fn();
    const bar = new FormulaBar(state, commands, moveDown);
    document.body.append(bar.element);
    state.addTab('t.csv', doc('a,b\n'), null);
    bar.refresh(true);
    const ta = bar.element.querySelector('textarea')!;
    ta.focus();
    ta.dispatchEvent(new CompositionEvent('compositionstart'));
    ta.value = 'にほん';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(commit).not.toHaveBeenCalled();
    expect(moveDown).not.toHaveBeenCalled();
  });
});
