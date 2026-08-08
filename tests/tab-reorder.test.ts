// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { TabBar } from '../src/ui/tab-bar';
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
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    chooseConditionalFormat: vi.fn(async () => null),
    chooseCellComment: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    promptGoToCell: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showSqlQuery: vi.fn(async () => undefined),
    showDiff: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

function setup(names: string[] = ['a.csv', 'b.csv', 'c.csv']) {
  const state = new AppState();
  const ui = stubUi();
  const commands = new Commands(state, ui, document);
  for (const name of names) {
    state.addTab(name, doc(`${name}\n`), null);
  }
  const bar = new TabBar(state, commands);
  state.subscribe(() => bar.render());
  document.body.append(bar.element);
  return { state, commands, bar, ui };
}

function tabNames(state: AppState): string[] {
  return state.tabs.map((t) => t.name);
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('AppState.moveTab', () => {
  it('reorders tabs while preserving the tab objects and the active tab', () => {
    const { state } = setup();
    const active = state.activeTab!;
    const [first] = state.tabs;
    state.editCell(first, 0, 0, 'edited'); // give the first tab some state
    expect(state.moveTab(first.id, 2)).toBe(true);
    expect(tabNames(state)).toEqual(['b.csv', 'c.csv', 'a.csv']);
    // Same object, same history/doc/dirty state — only the order changed.
    expect(state.tabs[2]).toBe(first);
    expect(state.tabs[2].doc.getValue(0, 0)).toBe('edited');
    expect(state.tabs[2].history.canUndo).toBe(true);
    expect(state.activeTab).toBe(active);
  });

  it('clamps the target index and rejects unknown ids', () => {
    const { state } = setup();
    const [first] = state.tabs;
    expect(state.moveTab(first.id, 99)).toBe(true);
    expect(tabNames(state)).toEqual(['b.csv', 'c.csv', 'a.csv']);
    expect(state.moveTab('nope', 0)).toBe(false);
    expect(state.moveTab(first.id, 2)).toBe(false); // already there
  });
});

describe('tab movement commands', () => {
  it('moves the active tab left/right/first/last and announces it', async () => {
    const { state, commands, ui } = setup();
    // Active tab is c.csv (last added).
    expect(commands.isEnabled('tab.moveRight')).toBe(false);
    expect(commands.isEnabled('tab.moveLast')).toBe(false);
    expect(commands.isEnabled('tab.moveLeft')).toBe(true);
    await commands.run('tab.moveLeft');
    expect(tabNames(state)).toEqual(['a.csv', 'c.csv', 'b.csv']);
    expect(ui.notify).toHaveBeenCalled();
    await commands.run('tab.moveFirst');
    expect(tabNames(state)).toEqual(['c.csv', 'a.csv', 'b.csv']);
    await commands.run('tab.moveLast');
    expect(tabNames(state)).toEqual(['a.csv', 'b.csv', 'c.csv']);
    await commands.run('tab.moveRight');
    expect(tabNames(state)).toEqual(['a.csv', 'b.csv', 'c.csv']); // already last
    // The active tab followed all moves.
    expect(state.activeTab!.name).toBe('c.csv');
  });
});

describe('TabBar keyboard model', () => {
  const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  };

  function tabEls(bar: TabBar): HTMLElement[] {
    return Array.from(bar.element.querySelectorAll<HTMLElement>('.tab'));
  }

  it('moves between document tabs with arrows and Home/End', () => {
    const { state, bar } = setup();
    press(tabEls(bar)[0], 'ArrowRight');
    expect(state.activeTab!.name).toBe('b.csv');
    press(tabEls(bar)[state.tabIndex(state.activeTabId!)], 'End');
    expect(state.activeTab!.name).toBe('c.csv');
    press(tabEls(bar)[state.tabIndex(state.activeTabId!)], 'Home');
    expect(state.activeTab!.name).toBe('a.csv');
    press(tabEls(bar)[0], 'ArrowLeft'); // already first: stays
    expect(state.activeTab!.name).toBe('a.csv');
  });

  it('reorders without a pointer using Alt+arrows and Alt+Home/End', async () => {
    const { state, bar } = setup();
    // Activate c.csv, then move it left and to the first position.
    press(tabEls(bar)[0], 'End');
    expect(state.activeTab!.name).toBe('c.csv');
    press(tabEls(bar)[2], 'ArrowLeft', { altKey: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(tabNames(state)).toEqual(['a.csv', 'c.csv', 'b.csv']);
    press(tabEls(bar)[1], 'Home', { altKey: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(tabNames(state)).toEqual(['c.csv', 'a.csv', 'b.csv']);
    // The moved tab stays the active one.
    expect(state.activeTab!.name).toBe('c.csv');
  });

  it('activates with Enter and Space', () => {
    const { state, bar } = setup();
    press(tabEls(bar)[1], 'Enter');
    expect(state.activeTab!.name).toBe('b.csv');
    press(tabEls(bar)[0], ' ');
    expect(state.activeTab!.name).toBe('a.csv');
  });
});

describe('TabBar drag-and-drop reordering', () => {
  function tabEl(bar: TabBar, name: string): HTMLElement {
    for (const el of bar.element.querySelectorAll<HTMLElement>('.tab')) {
      if (el.querySelector('.tab-label')?.textContent === name) {
        return el;
      }
    }
    throw new Error(`tab ${name} not rendered`);
  }

  it('renders draggable tabs', () => {
    const { bar } = setup();
    for (const el of bar.element.querySelectorAll<HTMLElement>('.tab')) {
      expect(el.getAttribute('draggable')).toBe('true');
    }
  });

  it('shows a drop indicator during dragover and reorders on drop', () => {
    const { state, bar } = setup();
    const source = tabEl(bar, 'a.csv');
    const target = tabEl(bar, 'c.csv');
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    target.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    // Drop-position indicator (before/after) is shown on the target.
    expect(target.classList.contains('drop-before') || target.classList.contains('drop-after')).toBe(true);
    target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    // Zero-width jsdom rects resolve as "after the target".
    expect(tabNames(state)).toEqual(['b.csv', 'c.csv', 'a.csv']);
  });

  it('announces the drag move through the live region', () => {
    const { bar } = setup();
    const source = tabEl(bar, 'a.csv');
    const target = tabEl(bar, 'b.csv');
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    const live = bar.element.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain('a.csv');
  });

  it('dropping a tab onto itself changes nothing', () => {
    const { state, bar } = setup();
    const source = tabEl(bar, 'b.csv');
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    source.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    expect(tabNames(state)).toEqual(['a.csv', 'b.csv', 'c.csv']);
  });

  it('keeps dirty state, selection, and undo history across drag reordering', () => {
    const { state, bar } = setup();
    const first = state.tabs[0];
    state.editCell(first, 0, 0, 'changed');
    state.setSelection(first, { row: 0, col: 0 }, null);
    const source = tabEl(bar, 'a.csv');
    const target = tabEl(bar, 'c.csv');
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    const moved = state.tabs.find((t) => t.name === 'a.csv')!;
    expect(moved).toBe(first);
    expect(moved.doc.isDirty).toBe(true);
    expect(moved.doc.getValue(0, 0)).toBe('changed');
    expect(moved.history.canUndo).toBe(true);
    expect(moved.selection).toEqual({ row: 0, col: 0 });
  });

  it('opens a context menu with move commands', () => {
    const { bar } = setup();
    const target = tabEl(bar, 'b.csv');
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const menu = document.querySelector('.context-menu');
    expect(menu).not.toBeNull();
    expect(menu!.querySelectorAll('.menu-item').length).toBeGreaterThanOrEqual(5);
  });
});
