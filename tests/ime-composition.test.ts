// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Full IME composition event sequences against the grid's persistent sink.
 *
 * The first-character bug: starting a Japanese Romaji composition on a
 * selected (not yet visibly editing) cell must never commit the first key as
 * a literal Latin letter. The fix keeps a permanently mounted, hidden
 * textarea (the "sink") focused while navigating, so the composition starts
 * inside an editable element and the sink is promoted in place — same
 * element, same focus — into the cell editor. These tests drive the exact
 * event orders browsers produce (keydown 229/"Process" → compositionstart →
 * compositionupdate* → compositionend → input) and assert that no literal
 * character, commit, navigation, or shortcut fires mid-composition.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { FormulaBar } from '../src/ui/formula-bar';
import { Grid } from '../src/ui/grid';
import { doc } from './helpers';

function stubUi(): UiPort {
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
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    chooseSettings: vi.fn(async () => null),
    setBusy: vi.fn(),
  };
}

function setup(csv = 'x,y\n1,2\n') {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
  document.body.append(grid.element);
  state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
  const tab = state.addTab('t.csv', doc(csv), null);
  grid.refresh();
  grid.element.focus();
  const sink = grid.element.querySelector<HTMLTextAreaElement>('.grid-sink')!;
  return { state, commands, grid, tab, sink };
}

/** The keydown a browser fires when the IME swallows a key (keyCode 229). */
function imeKeydown(target: HTMLElement, composing = false): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key: 'Process',
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'keyCode', { value: 229 });
  Object.defineProperty(ev, 'isComposing', { value: composing });
  target.dispatchEvent(ev);
  return ev;
}

function key(target: HTMLElement, init: KeyboardEventInit & { key: string }): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

const editorOf = (grid: Grid) => grid.element.querySelector<HTMLTextAreaElement>('.cell-editor');

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('sink focus management', () => {
  it('focusing the grid container forwards focus into the editable sink', () => {
    const { grid, sink } = setup();
    expect(document.activeElement).toBe(sink);
    // The sink is a real textarea, so composition events target an editable
    // element from the very first keystroke.
    expect(sink.tagName).toBe('TEXTAREA');
    expect(grid.isNavigating()).toBe(true);
  });

  it('promotion to editor reuses the focused sink — no focus move, no remount', () => {
    const { grid, sink } = setup();
    imeKeydown(sink);
    const editor = editorOf(grid);
    expect(editor).toBe(sink);
    expect(document.activeElement).toBe(sink);
  });
});

describe('initial Japanese Romaji composition on a selected cell', () => {
  it('composes the first character — never a literal Latin letter (regression)', async () => {
    const { grid, tab, sink } = setup();
    // 1. IME swallows the "a" key: keydown 229 arrives, nothing is inserted yet.
    const ev = imeKeydown(sink);
    expect(ev.defaultPrevented).toBe(false); // the key is never consumed
    expect(editorOf(grid)).toBe(sink); // editor opened in place, still empty
    expect(sink.value).toBe('');
    // 2. Composition begins and updates: "a" → "あ" (browser-owned text).
    sink.dispatchEvent(new CompositionEvent('compositionstart'));
    sink.value = 'a';
    sink.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'a' }));
    sink.dispatchEvent(new Event('input', { bubbles: true }));
    sink.value = 'あ';
    sink.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'あ' }));
    sink.dispatchEvent(new Event('input', { bubbles: true }));
    // Mid-composition nothing has been committed to the document.
    expect(tab.doc.getValue(0, 0)).toBe('x');
    // 3. Composition commits, then Enter commits the cell.
    sink.dispatchEvent(new CompositionEvent('compositionend', { data: 'あ' }));
    sink.dispatchEvent(new Event('input', { bubbles: true }));
    key(sink, { key: 'Enter' });
    await vi.waitFor(() => expect(tab.doc.getValue(0, 0)).toBe('あ'));
    // The literal first Latin letter never reached the document.
    expect(tab.doc.getValue(0, 0)).not.toContain('a');
  });

  it('handles multiple composition updates before compositionend', async () => {
    const { tab, sink } = setup();
    imeKeydown(sink);
    sink.dispatchEvent(new CompositionEvent('compositionstart'));
    for (const step of ['n', 'に', 'にh', 'にほ', 'にほn', 'にほん']) {
      sink.value = step;
      sink.dispatchEvent(new CompositionEvent('compositionupdate', { data: step }));
      sink.dispatchEvent(new Event('input', { bubbles: true }));
      expect(tab.doc.getValue(0, 0)).toBe('x'); // nothing commits mid-composition
    }
    sink.dispatchEvent(new CompositionEvent('compositionend', { data: 'にほん' }));
    key(sink, { key: 'Enter' });
    await vi.waitFor(() => expect(tab.doc.getValue(0, 0)).toBe('にほん'));
  });

  it('a cancelled composition leaves the cell unchanged', () => {
    const { grid, tab, sink } = setup();
    imeKeydown(sink);
    sink.dispatchEvent(new CompositionEvent('compositionstart'));
    sink.value = 'あ';
    sink.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'あ' }));
    sink.dispatchEvent(new Event('input', { bubbles: true }));
    // The user cancels the composition (e.g. Escape inside the IME).
    sink.value = '';
    sink.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
    sink.dispatchEvent(new Event('input', { bubbles: true }));
    // The editor is still open and empty; Escape closes it without a commit.
    expect(editorOf(grid)).toBe(sink);
    key(sink, { key: 'Escape' });
    expect(editorOf(grid)).toBeNull();
    expect(tab.doc.getValue(0, 0)).toBe('x');
  });
});

describe('keys during an active composition', () => {
  function composing(csv?: string) {
    const ctx = setup(csv);
    imeKeydown(ctx.sink);
    ctx.sink.dispatchEvent(new CompositionEvent('compositionstart'));
    ctx.sink.value = 'にほ';
    ctx.sink.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'にほ' }));
    ctx.sink.dispatchEvent(new Event('input', { bubbles: true }));
    return ctx;
  }

  it('Enter confirms the IME candidate, never the cell', () => {
    const { grid, tab, sink } = composing();
    key(sink, { key: 'Enter', isComposing: true });
    expect(editorOf(grid)).toBe(sink); // still editing
    expect(tab.doc.getValue(0, 0)).toBe('x'); // nothing committed
    expect(tab.selection).toEqual({ row: 0, col: 0 }); // no navigation
  });

  it('arrow keys move IME candidates, never the grid selection', () => {
    const { tab, sink } = composing();
    key(sink, { key: 'ArrowDown', isComposing: true });
    key(sink, { key: 'ArrowRight', isComposing: true });
    expect(tab.selection).toEqual({ row: 0, col: 0 });
  });

  it('Alt+Enter inserts no newline while composing', () => {
    const { sink } = composing();
    key(sink, { key: 'Enter', altKey: true, isComposing: true });
    expect(sink.value).toBe('にほ'); // untouched: the IME owns the keystroke
  });

  it('Alt+Enter inserts a literal newline after composition ends', () => {
    const { sink } = composing();
    sink.dispatchEvent(new CompositionEvent('compositionend', { data: 'にほ' }));
    sink.setSelectionRange(sink.value.length, sink.value.length);
    key(sink, { key: 'Enter', altKey: true });
    expect(sink.value).toBe('にほ\n');
  });
});

describe('ordinary Latin typing (no IME)', () => {
  it('opens an empty editor on the first key and commits normally', async () => {
    const { grid, tab, sink } = setup();
    const ev = key(sink, { key: 'a' });
    expect(ev.defaultPrevented).toBe(false); // browser delivers "a" natively
    expect(editorOf(grid)).toBe(sink);
    expect(sink.value).toBe('');
    // Simulate the browser's default text insertion, then commit.
    sink.value = 'a';
    sink.dispatchEvent(new Event('input', { bubbles: true }));
    key(sink, { key: 'Enter' });
    await vi.waitFor(() => expect(tab.doc.getValue(0, 0)).toBe('a'));
    expect(tab.selection).toEqual({ row: 1, col: 0 }); // Enter moved down
  });

  it('keyboard navigation still works from the sink', () => {
    const { tab, sink } = setup();
    key(sink, { key: 'ArrowDown' });
    expect(tab.selection).toEqual({ row: 1, col: 0 });
    key(sink, { key: 'ArrowRight' });
    expect(tab.selection).toEqual({ row: 1, col: 1 });
  });

  it('stray text with no open editor is discarded', () => {
    const { grid, state, sink } = setup();
    state.closeTab(state.tabs[0].id);
    grid.refresh();
    sink.value = 'zz';
    sink.dispatchEvent(new Event('input', { bubbles: true }));
    expect(sink.value).toBe('');
  });
});

describe('formula bar during composition', () => {
  it('never commits or navigates mid-composition, commits after', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const commit = vi.spyOn(commands, 'commitCellEdit');
    const moveDown = vi.fn();
    const bar = new FormulaBar(state, commands, moveDown);
    document.body.append(bar.element);
    state.addTab('t.csv', doc('x,y\n'), null);
    bar.refresh(true);
    const ta = bar.element.querySelector('textarea')!;
    ta.focus();
    ta.dispatchEvent(new CompositionEvent('compositionstart'));
    ta.value = 'にほん';
    ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'にほん' }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(commit).not.toHaveBeenCalled();
    expect(moveDown).not.toHaveBeenCalled();
    ta.dispatchEvent(new CompositionEvent('compositionend', { data: 'にほん' }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(commit).toHaveBeenCalledWith(expect.anything(), 0, 0, 'にほん');
  });
});
