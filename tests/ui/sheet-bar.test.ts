// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The worksheet tab strip: its accessibility semantics, keyboard model
 * (including the pointer-free reordering equivalents), the distinction from
 * the application document-tab strip, and its behavior for plain CSV
 * documents.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { setLocale, t } from '../../src/app/i18n';
import { getSheetTabsVertical, getSheetTabsWidth } from '../../src/app/settings';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { SheetBar } from '../../src/ui/sheet-bar';
import { TabBar } from '../../src/ui/tab-bar';
import { doc as csvDoc } from '../helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    confirmChangedOnDisk: vi.fn(async () => 'overwrite' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    confirmExportJson: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    chooseColumnMenu: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    chooseConditionalFormat: vi.fn(async () => null),
    chooseCellComment: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    chooseSheetTabColor: vi.fn(async () => null),
    promptFolderName: vi.fn(async () => null),
    chooseFolder: vi.fn(async () => null),
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
    chooseVersionHistory: vi.fn(async () => null),
    confirmHistoryCapExceeded: vi.fn(async () => true),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    chooseFont: vi.fn(async () => null),
    chooseRecentFile: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

interface Harness {
  state: AppState;
  commands: Commands;
  bar: SheetBar;
  tab: Tab;
  doc: RsfDocument;
}

function setup(sheetNames: string[] = ['Sheet1'], ui: UiPort = stubUi()): Harness {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const workbook = RsfDocument.empty('book.rsf', 5, 3, sheetNames[0]);
  const tab = state.addTab('book.rsf', workbook, null);
  for (const name of sheetNames.slice(1)) {
    state.addSheet(tab, name);
  }
  state.setActiveSheet(tab, workbook.sheets[0].id);
  const bar = new SheetBar(state, commands);
  document.body.append(bar.element);
  // Re-render after the sheets exist (the constructor renders once).
  bar.render(true);
  return { state, commands, bar, tab, doc: workbook };
}

function tabs(bar: SheetBar): HTMLElement[] {
  return Array.from(bar.element.querySelectorAll<HTMLElement>('.sheet-tab'));
}

beforeEach(() => {
  document.body.textContent = '';
  setLocale('en');
});

describe('accessibility semantics', () => {
  it('is a labelled tablist of worksheet tabs with correct selected state', () => {
    const { bar, doc } = setup(['Sheet1', 'Second', 'Third']);
    const strip = bar.element.querySelector('.sheet-strip')!;
    expect(strip.getAttribute('role')).toBe('tablist');
    expect(strip.getAttribute('aria-label')).toBe(t('sheets.label'));
    const list = tabs(bar);
    expect(list).toHaveLength(3);
    expect(list.map((el) => el.textContent)).toEqual(['Sheet1', 'Second', 'Third']);
    for (const el of list) {
      expect(el.getAttribute('role')).toBe('tab');
    }
    const activeIndex = doc.sheetIndex(doc.activeSheetId);
    expect(list[activeIndex].getAttribute('aria-selected')).toBe('true');
    expect(list.filter((el) => el.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('uses a roving tabindex so the strip is one tab stop', () => {
    const { bar } = setup(['Sheet1', 'Second', 'Third']);
    const list = tabs(bar);
    expect(list.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(list.filter((el) => el.getAttribute('tabindex') === '-1')).toHaveLength(2);
  });

  it('hints that the tab can be renamed by double-click or F2', () => {
    const { bar } = setup(['Sheet1', 'Second']);
    const list = tabs(bar);
    expect(list[0].getAttribute('title')).toBe(t('sheets.tabTitle', { name: 'Sheet1' }));
    expect(list[1].getAttribute('title')).toBe(t('sheets.tabTitle', { name: 'Second' }));
  });

  it('marks each tab with a localized, icon-only worksheet-kind indicator (#506)', () => {
    const { state, bar, tab } = setup(['Sheet1']);
    state.addMarkdownSheet(tab, 'Notes');
    bar.render(true);
    const list = tabs(bar);
    expect(list).toHaveLength(2);
    const kindLabel = (el: HTMLElement): string | null =>
      el.querySelector('.sheet-kind')?.getAttribute('aria-label') ?? null;
    expect(kindLabel(list[0])).toBe(t('sheets.kind.grid'));
    expect(kindLabel(list[1])).toBe(t('sheets.kind.markdown'));
    // Icon-only: no extra visible text is added next to the sheet name.
    expect(list[0].textContent).toBe('Sheet1');
    expect(list[1].textContent).toBe('Notes');
  });

  it('marks YAML and plain-text worksheets with their own localized kind indicator (#557)', () => {
    const { state, bar, tab } = setup(['Sheet1']);
    state.addYamlSheet(tab, 'Config');
    state.addTextSheet(tab, 'Text');
    bar.render(true);
    const list = tabs(bar);
    expect(list).toHaveLength(3);
    const kindLabel = (el: HTMLElement): string | null =>
      el.querySelector('.sheet-kind')?.getAttribute('aria-label') ?? null;
    expect(kindLabel(list[1])).toBe(t('sheets.kind.yaml'));
    expect(kindLabel(list[2])).toBe(t('sheets.kind.text'));
  });

  it('offers an Add control with a localized accessible name', () => {
    const { bar } = setup();
    const add = bar.element.querySelector<HTMLButtonElement>('.sheet-add')!;
    expect(add.getAttribute('aria-label')).toBe(t('sheets.add'));
    expect(add.disabled).toBe(false);
  });

  it('announces worksheet switches through a live region', () => {
    const { state, bar, tab, doc } = setup(['Sheet1', 'Second']);
    const live = bar.element.querySelector('[aria-live="polite"]')!;
    tabs(bar)[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(doc.activeSheet.name).toBe('Second');
    expect(live.textContent).toContain('Second');
    expect(state.activeWorkbook()).toBe(tab.doc);
  });

  it('localizes its labels', () => {
    setLocale('ja');
    const { bar } = setup();
    const strip = bar.element.querySelector('.sheet-strip')!;
    expect(strip.getAttribute('aria-label')).toBe('このファイル内のシート');
    expect(bar.element.querySelector('.sheet-add')!.getAttribute('aria-label')).toBe('シートを追加');
    setLocale('en');
  });
});

describe('keyboard model', () => {
  const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  };

  it('moves between worksheets with arrows and Home/End', () => {
    const { bar, doc } = setup(['A', 'B', 'C']);
    press(tabs(bar)[0], 'ArrowRight');
    expect(doc.activeSheet.name).toBe('B');
    press(tabs(bar)[doc.sheetIndex(doc.activeSheetId)], 'End');
    expect(doc.activeSheet.name).toBe('C');
    press(tabs(bar)[doc.sheetIndex(doc.activeSheetId)], 'Home');
    expect(doc.activeSheet.name).toBe('A');
    press(tabs(bar)[0], 'ArrowLeft'); // already first: stays
    expect(doc.activeSheet.name).toBe('A');
  });

  it('reorders without a pointer using Alt+arrows and Alt+Home/End', () => {
    const { bar, doc } = setup(['A', 'B', 'C']);
    // Activate C, then move it left and to the first position.
    press(tabs(bar)[0], 'End');
    expect(doc.activeSheet.name).toBe('C');
    press(tabs(bar)[2], 'ArrowLeft', { altKey: true });
    expect(doc.sheets.map((s) => s.name)).toEqual(['A', 'C', 'B']);
    press(tabs(bar)[1], 'Home', { altKey: true });
    expect(doc.sheets.map((s) => s.name)).toEqual(['C', 'A', 'B']);
    // The moved worksheet stays the active one.
    expect(doc.activeSheet.name).toBe('C');
  });

  it('activates with Enter and Space', () => {
    const { bar, doc } = setup(['A', 'B']);
    press(tabs(bar)[1], 'Enter');
    expect(doc.activeSheet.name).toBe('B');
    press(tabs(bar)[0], ' ');
    expect(doc.activeSheet.name).toBe('A');
  });

  const nameField = (bar: SheetBar): HTMLInputElement | null =>
    bar.element.querySelector<HTMLInputElement>('.sheet-name-edit');
  const type = (field: HTMLInputElement, text: string, key: string): void => {
    field.value = text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    press(field, key);
  };

  it('F2 types a new name on the tab: Enter keeps it as one undo step, Escape puts the old one back', () => {
    const { bar, doc, state, tab } = setup(['A', 'B']);
    press(tabs(bar)[0], 'F2');
    const field = nameField(bar)!;
    expect(field.value).toBe('A');
    expect(field.getAttribute('aria-label')).toBe(t('sheets.nameField'));
    type(field, 'Renamed', 'Enter');
    expect(doc.sheets[0].name).toBe('Renamed');
    expect(nameField(bar)).toBeNull();
    expect(tabs(bar)[0].textContent).toBe('Renamed');
    state.undo(tab);
    expect(doc.sheets[0].name).toBe('A');
    bar.render(true);
    press(tabs(bar)[0], 'F2');
    type(nameField(bar)!, 'Other', 'Escape');
    expect(doc.sheets[0].name).toBe('A');
    expect(nameField(bar)).toBeNull();
  });

  it('keeps the field open and says why when the name cannot be used, and gives up on leaving it', () => {
    const { bar, doc } = setup(['A', 'B']);
    press(tabs(bar)[0], 'F2');
    const field = nameField(bar)!;
    type(field, 'b', 'Enter');
    expect(nameField(bar)).toBe(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.title).toBe(t('sheet.error.duplicate', { name: 'b' }));
    field.dispatchEvent(new FocusEvent('blur'));
    expect(nameField(bar)).toBeNull();
    expect(doc.sheets.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('types a new name on a tab double-clicked, even when the first click switched to it', () => {
    const { bar, doc } = setup(['A', 'B']);
    tabs(bar)[1].click();
    expect(doc.activeSheet.name).toBe('B');
    tabs(bar)[1].click();
    const field = nameField(bar)!;
    expect(field.value).toBe('B');
    type(field, 'Second', 'Enter');
    expect(doc.sheets[1].name).toBe('Second');
  });
});

describe('plain CSV documents', () => {
  it('hides the whole strip for a plain CSV document (#456)', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    state.addTab('data.csv', csvDoc('a,b\n1,2\n'), null);
    const bar = new SheetBar(state, commands);
    document.body.append(bar.element);
    bar.render(true);
    // No empty band under the grid: the row itself is hidden.
    expect(bar.element.hidden).toBe(true);
    expect(tabs(bar)).toHaveLength(0);
    expect(bar.element.querySelector('.sheet-note')).toBeNull();
    expect(bar.element.querySelector('.sheet-strip')!.textContent).toBe('');
    // The CSV strip is not a tablist — there are no worksheets to list.
    expect(bar.element.querySelector('.sheet-strip')!.getAttribute('role')).toBeNull();
  });

  it('comes back when a workbook tab becomes active', () => {
    const { state, bar, tab } = setup(['A']);
    const csv = state.addTab('data.csv', csvDoc('a,b\n1,2\n'), null);
    state.activateTab(csv.id);
    bar.render();
    expect(bar.element.hidden).toBe(true);
    state.activateTab(tab.id);
    bar.render();
    expect(bar.element.hidden).toBe(false);
    expect(tabs(bar)).toHaveLength(1);
  });

  it('hides itself entirely when no document is open', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const bar = new SheetBar(state, commands);
    expect(bar.element.hidden).toBe(true);
  });
});

describe('separation from the application document tabs', () => {
  it('labels the two strips differently and reorders them independently', () => {
    const { state, commands, bar, tab, doc } = setup(['A', 'B']);
    const second = state.addTab('other.rsf', RsfDocument.empty('other.rsf', 2, 2, 'S'), null);
    state.activateTab(tab.id);
    const tabBar = new TabBar(state, commands);
    document.body.append(tabBar.element);

    expect(tabBar.element.getAttribute('aria-label')).toBe(t('tabs.label'));
    expect(bar.element.querySelector('.sheet-strip')!.getAttribute('aria-label')).toBe(t('sheets.label'));
    expect(t('tabs.label')).not.toBe(t('sheets.label'));

    // Reordering worksheets leaves the document tabs alone…
    state.moveSheet(tab, doc.sheets[1].id, 0);
    expect(doc.sheets.map((s) => s.name)).toEqual(['B', 'A']);
    expect(state.tabs.map((x) => x.name)).toEqual(['book.rsf', 'other.rsf']);

    // …and reordering document tabs leaves the worksheets alone.
    state.moveTab(second.id, 0);
    expect(state.tabs.map((x) => x.name)).toEqual(['other.rsf', 'book.rsf']);
    expect(doc.sheets.map((s) => s.name)).toEqual(['B', 'A']);
  });

  it('re-renders only when the worksheet set or active worksheet actually changes', () => {
    const { bar, doc } = setup(['A', 'B']);
    const before = tabs(bar)[0];
    bar.render(); // no change: the existing nodes are kept
    expect(tabs(bar)[0]).toBe(before);
    doc.setActiveSheetId(doc.sheets[1].id);
    bar.render();
    expect(tabs(bar)[0]).not.toBe(before);
  });
});

describe('drag-and-drop reordering', () => {
  function tabEl(bar: SheetBar, name: string): HTMLElement {
    for (const el of bar.element.querySelectorAll<HTMLElement>('.sheet-tab')) {
      if (el.querySelector('.sheet-label')?.textContent === name) {
        return el;
      }
    }
    throw new Error(`sheet tab ${name} not rendered`);
  }

  it('reorders on drop, applied after the drag session rather than synchronously (#541)', async () => {
    const { doc, bar } = setup(['A', 'B', 'C']);
    const source = tabEl(bar, 'A');
    const target = tabEl(bar, 'C');
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    // The move is deferred a microtask past 'drop': a re-render that
    // detaches the dragged node while the browser's own drag session is
    // still live is what left the pointer stuck (the reported "hang up").
    // Immediately after 'drop' the order must therefore be unchanged...
    expect(doc.sheets.map((s) => s.name)).toEqual(['A', 'B', 'C']);
    await Promise.resolve();
    // ...and applied once the microtask runs.
    expect(doc.sheets.map((s) => s.name)).toEqual(['B', 'C', 'A']);
  });

  it('clears drag state once the browser fires dragend on the tab itself, even without a drop', () => {
    const { bar } = setup(['A', 'B']);
    const source = tabEl(bar, 'A');
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    expect(source.classList.contains('dragging')).toBe(true);
    source.dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(source.classList.contains('dragging')).toBe(false);
  });

  it('dropping a sheet tab onto itself changes nothing', async () => {
    const { doc, bar } = setup(['A', 'B']);
    const source = tabEl(bar, 'A');
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    source.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(doc.sheets.map((s) => s.name)).toEqual(['A', 'B']);
  });
});

describe('worksheet tab context menu — Lock/Unlock wording and checkmark (#541)', () => {
  function openMenu(bar: SheetBar): HTMLElement {
    tabs(bar)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return document.querySelector('.context-menu')!;
  }

  it('shows "Lock Sheet" with no checkmark while unlocked', () => {
    const { bar } = setup(['A']);
    const menu = openMenu(bar);
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.menu-item'));
    const lockItem = items.find((b) => b.textContent?.includes(t('menu.sheet.lockSheet')))!;
    expect(lockItem).toBeTruthy();
    expect(lockItem.getAttribute('aria-checked')).toBe('false');
  });

  it('shows "Unlock Sheet" with a checkmark once locked', async () => {
    const { bar, commands, doc } = setup(['A']);
    await commands.run('worksheet.toggleLock');
    expect(doc.sheets[0].locked).toBe(true);
    const menu = openMenu(bar);
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.menu-item'));
    const unlockItem = items.find((b) => b.textContent?.includes(t('menu.sheet.unlockSheet')))!;
    expect(unlockItem).toBeTruthy();
    expect(unlockItem.getAttribute('aria-checked')).toBe('true');
    expect(unlockItem.querySelector('.check-icon')).not.toBeNull();
  });
});

describe('SheetBar tab colors', () => {
  it('draws a colored tab only for a worksheet that has a tab color', () => {
    const { bar, state, tab, doc } = setup(['A', 'B']);
    state.setSheetTabColor(tab, doc.sheets[1].id, '#287ccf');
    bar.render();
    const [a, b] = tabs(bar);
    expect(a.classList.contains('has-color')).toBe(false);
    expect(b.classList.contains('has-color')).toBe(true);
    expect(b.style.getPropertyValue('--sheet-tab-color')).toBe('#287ccf');
  });

  it('groups the tab context menu: new sheets, folders and moves each open one level deeper', () => {
    const { bar } = setup(['A', 'B']);
    tabs(bar)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const top = Array.from(document.querySelectorAll('.context-menu:not(.submenu) > .menu-item .label')).map(
      (el) => el.textContent,
    );
    expect(top).toEqual([
      t('menu.sheet.newSheet'),
      t('menu.sheet.renameSheet'),
      t('menu.sheet.tabColor'),
      t('menu.sheet.duplicateSheet'),
      t('menu.sheet.deleteSheet'),
      t('menu.sheet.folders'),
      t('menu.sheet.lockSheet'),
      t('menu.sheet.moveSheet'),
    ]);
    Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu > .menu-item'))
      .find((b) => b.textContent?.includes(t('menu.sheet.newSheet')))!
      .click();
    const kinds = Array.from(document.querySelectorAll('.context-menu.submenu .label')).map(
      (el) => el.textContent,
    );
    expect(kinds).toContain(t('menu.sheet.addCsvSheet'));
    expect(kinds).toContain(t('menu.sheet.addMarkdownSheet'));
  });

  it('offers Sheet Tab Color… in the tab context menu', () => {
    const { bar } = setup(['A']);
    tabs(bar)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const labels = Array.from(document.querySelectorAll('.context-menu .menu-item')).map(
      (b) => b.textContent,
    );
    expect(labels.some((l) => l?.includes(t('menu.sheet.tabColor')))).toBe(true);
  });
});

describe('worksheet tabs on the left (View > Sheet Tabs on the Left)', () => {
  const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  };

  /** The column layout comes from sheet-bar.css, which jsdom does not load,
   * so the strip is stood up as a column inline, as the stylesheet would. */
  function setupVertical(names: string[]): Harness {
    const harness = setup(names);
    harness.bar.element.querySelector<HTMLElement>('.sheet-strip')!.style.flexDirection = 'column';
    harness.bar.render(true);
    return harness;
  }

  function stubRect(el: HTMLElement, top: number, height: number): void {
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top,
        right: 180,
        bottom: top + height,
        width: 180,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('is a browser setting toggled from the View menu command, off by default', async () => {
    const { commands } = setup(['A']);
    expect(getSheetTabsVertical()).toBe(false);
    await commands.run('view.sheetTabsVertical');
    expect(getSheetTabsVertical()).toBe(true);
    await commands.run('view.sheetTabsVertical');
    expect(getSheetTabsVertical()).toBe(false);
  });

  it('changes the sheet list’s width from its edge, kept in this browser within a range', () => {
    const { bar } = setup(['A']);
    const edge = bar.element.querySelector<HTMLElement>('.sheet-bar-resize')!;
    expect(edge.getAttribute('role')).toBe('separator');
    expect(bar.element.style.getPropertyValue('--sheet-tabs-width')).toBe('180px');
    edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(bar.element.style.getPropertyValue('--sheet-tabs-width')).toBe('196px');
    expect(getSheetTabsWidth()).toBe(196);
    edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(getSheetTabsWidth()).toBe(480);
    edge.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 300 }));
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 100 }));
    // jsdom lays nothing out (width 0), so the drag lands on the narrowest width.
    expect(getSheetTabsWidth()).toBe(120);
    edge.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(getSheetTabsWidth()).toBe(180);
    expect(edge.getAttribute('aria-valuenow')).toBe('180');
  });

  it('announces its orientation to assistive technologies', () => {
    const { bar } = setup(['A', 'B']);
    const strip = bar.element.querySelector<HTMLElement>('.sheet-strip')!;
    expect(strip.getAttribute('aria-orientation')).toBe('horizontal');
    strip.style.flexDirection = 'column';
    bar.render(true);
    expect(strip.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('moves between worksheets with Up/Down and reorders with Alt+Up/Down', () => {
    const { bar, doc } = setupVertical(['A', 'B', 'C']);
    press(tabs(bar)[0], 'ArrowDown');
    expect(doc.activeSheet.name).toBe('B');
    press(tabs(bar)[1], 'ArrowUp');
    expect(doc.activeSheet.name).toBe('A');
    press(tabs(bar)[0], 'ArrowDown', { altKey: true });
    expect(doc.sheets.map((s) => s.name)).toEqual(['B', 'A', 'C']);
    press(tabs(bar)[1], 'ArrowUp', { altKey: true });
    expect(doc.sheets.map((s) => s.name)).toEqual(['A', 'B', 'C']);
  });

  it('drops above or below a tab by the pointer height', async () => {
    const { bar, doc } = setupVertical(['A', 'B', 'C']);
    const [a, , c] = tabs(bar);
    stubRect(c, 100, 30);
    a.dispatchEvent(new Event('dragstart', { bubbles: true }));
    // Upper half of C: A lands before it.
    c.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 170, clientY: 105 }));
    await Promise.resolve();
    expect(doc.sheets.map((s) => s.name)).toEqual(['B', 'A', 'C']);
  });
});

describe('sheet folders in the strip', () => {
  function withFolders(): Harness & { folder: string; inner: string } {
    const harness = setup(['A', 'B', 'C', 'D']);
    const { state, tab, doc } = harness;
    const id = (name: string): string => doc.sheetByName(name)!.id;
    const folder = state.folders.createFolder(tab, id('B'), 'Sales')!;
    state.folders.moveSheetToFolder(tab, id('C'), folder);
    const inner = state.folders.createFolder(tab, id('C'), '2026')!;
    harness.bar.render(true);
    return { ...harness, folder, inner };
  }

  const shown = (bar: SheetBar): string[] =>
    Array.from(
      bar.element.querySelectorAll<HTMLElement>('.sheet-tab .sheet-label, .sheet-folder-header .sheet-label'),
      (label) => label.textContent ?? '',
    );
  const header = (bar: SheetBar, name: string): HTMLElement =>
    Array.from(bar.element.querySelectorAll<HTMLElement>('.sheet-folder-header')).find(
      (h) => h.textContent === name,
    )!;

  it('shows each folder as a header followed by its worksheets, nested', () => {
    const { bar } = withFolders();
    expect(shown(bar)).toEqual(['A', 'Sales', 'B', '2026', 'C', 'D']);
    const inner = header(bar, '2026');
    expect(inner.closest('.sheet-folder-items')?.previousElementSibling).toBe(header(bar, 'Sales'));
    expect(inner.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes and opens a folder from its header, keeping the active worksheet in view', () => {
    const { bar, state, tab, doc } = withFolders();
    header(bar, 'Sales').click();
    tabs(bar)[0].click(); // anything else clicked in between: the next click is not a double-click
    expect(shown(bar)).toEqual(['A', 'Sales', 'D']);
    expect(header(bar, 'Sales').getAttribute('aria-expanded')).toBe('false');
    state.setActiveSheet(tab, doc.sheetByName('C')!.id);
    bar.render();
    expect(shown(bar)).toEqual(['A', 'Sales', 'C', 'D']);
    header(bar, 'Sales').click();
    expect(shown(bar)).toEqual(['A', 'Sales', 'B', '2026', 'C', 'D']);
  });

  it('moves with the arrows through the worksheets as shown, skipping closed folders', () => {
    const { bar, doc } = withFolders();
    header(bar, '2026').click();
    const press = (key: string): void => {
      bar.render();
      bar.element
        .querySelector<HTMLElement>('.sheet-tab[aria-selected="true"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    press('ArrowRight');
    expect(doc.activeSheet.name).toBe('B');
    press('ArrowRight');
    expect(doc.activeSheet.name).toBe('D');
  });

  it('moves a worksheet dropped on a folder header into that folder', async () => {
    const { bar, doc, folder } = withFolders();
    const d = bar.element.querySelector<HTMLElement>(
      `.sheet-tab[data-sheet-id="${doc.sheetByName('D')!.id}"]`,
    )!;
    d.dispatchEvent(new Event('dragstart', { bubbles: true }));
    header(bar, 'Sales').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(doc.sheetByName('D')!.folderId).toBe(folder);
    expect(doc.sheets.map((s) => s.name)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('puts a worksheet dropped next to another into that worksheet’s folder', async () => {
    const { bar, doc, folder } = withFolders();
    const a = bar.element.querySelector<HTMLElement>(
      `.sheet-tab[data-sheet-id="${doc.sheetByName('A')!.id}"]`,
    )!;
    const b = bar.element.querySelector<HTMLElement>(
      `.sheet-tab[data-sheet-id="${doc.sheetByName('B')!.id}"]`,
    )!;
    a.dispatchEvent(new Event('dragstart', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(doc.sheetByName('A')!.folderId).toBe(folder);
    bar.render();
    expect(shown(bar)).toEqual(['Sales', 'B', 'A', '2026', 'C', 'D']);
  });

  it('types a new name on a folder double-clicked, leaving it open', () => {
    const { bar, doc } = withFolders();
    header(bar, 'Sales').click();
    header(bar, 'Sales').click();
    const field = bar.element.querySelector<HTMLInputElement>('.sheet-name-edit')!;
    expect(field.value).toBe('Sales');
    expect(field.getAttribute('aria-label')).toBe(t('sheets.folder.nameField'));
    field.value = 'Revenue';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(doc.folders.find((f) => f.name === 'Revenue')).toBeDefined();
    expect(header(bar, 'Revenue').getAttribute('aria-expanded')).toBe('true');
  });

  it('puts the active worksheet in a new folder from the button next to Add', async () => {
    const promptFolderName = vi.fn(async () => 'New');
    const { bar, doc } = setup(['A', 'B'], stubUi({ promptFolderName }));
    const button = bar.element.querySelector<HTMLButtonElement>('.sheet-add-folder')!;
    expect(button.getAttribute('aria-label')).toBe(t('sheets.newFolder'));
    button.click();
    await vi.waitFor(() => expect(doc.folders.map((f) => f.name)).toEqual(['New']));
    expect(doc.sheets[0].folderId).toBe(doc.folders[0].id);
  });

  it('offers rename, move, remove, and delete on a folder’s context menu', () => {
    const { bar } = withFolders();
    header(bar, 'Sales').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const items = Array.from(
      document.querySelectorAll('.context-menu [role="menuitem"]'),
      (i) => i.textContent,
    );
    expect(items).toEqual([
      t('menu.sheet.renameFolder'),
      t('menu.sheet.moveFolder'),
      t('menu.sheet.ungroupFolder'),
      t('menu.sheet.deleteFolder'),
    ]);
  });
});
