// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The worksheet tab strip: its accessibility semantics, keyboard model
 * (including the pointer-free reordering equivalents), the distinction from
 * the application document-tab strip, and its behavior for plain CSV
 * documents.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { setLocale, t } from '../src/app/i18n';
import { RsfDocument } from '../src/core/rsf-document';
import { SheetBar } from '../src/ui/sheet-bar';
import { TabBar } from '../src/ui/tab-bar';
import { doc as csvDoc } from './helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    confirmExportJson: vi.fn(async () => true),
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
    chooseVersionHistory: vi.fn(async () => null),
    confirmHistoryCapExceeded: vi.fn(async () => true),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
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
    expect(strip.getAttribute('aria-label')).toBe('このブック内のワークシート');
    expect(bar.element.querySelector('.sheet-add')!.getAttribute('aria-label')).toBe('ワークシートを追加');
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

  it('F2 starts a rename through the shared command', async () => {
    const promptSheetName = vi.fn(async () => ({ name: 'Renamed', kind: 'grid' as const }));
    const { bar, doc } = setup(['A'], stubUi({ promptSheetName }));
    press(tabs(bar)[0], 'F2');
    await Promise.resolve();
    await Promise.resolve();
    expect(promptSheetName).toHaveBeenCalled();
    expect(doc.sheets[0].name).toBe('Renamed');
  });
});

describe('plain CSV documents', () => {
  it('shows no worksheet tabs or explanatory note for a plain CSV document (#456)', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    state.addTab('data.csv', csvDoc('a,b\n1,2\n'), null);
    const bar = new SheetBar(state, commands);
    document.body.append(bar.element);
    bar.render(true);
    expect(tabs(bar)).toHaveLength(0);
    expect(bar.element.querySelector('.sheet-note')).toBeNull();
    expect(bar.element.querySelector('.sheet-strip')!.textContent).toBe('');
    // The CSV strip is not a tablist — there are no worksheets to list.
    expect(bar.element.querySelector('.sheet-strip')!.getAttribute('role')).toBeNull();
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
