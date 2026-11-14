// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * A document tab dragged from the tab strip onto the worksheet strip of a
 * workbook: the worksheet strip takes the tab as a copy (its indicator shows
 * while the drag is over it), and the drop adds the tab's content to the
 * workbook as a sheet. jsdom has no DataTransfer, so the drag is plain DOM
 * events, as the other drag tests in tests/ui use.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { isWorkbook } from '../../src/core/editor-document';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { SheetBar } from '../../src/ui/sheet-bar';
import { TabBar } from '../../src/ui/tab-bar';
import { setDraggedTabId } from '../../src/ui/tab-drag';
import { doc } from '../helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    confirmChangedOnDisk: vi.fn(async () => 'overwrite' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    promptRsfPassword: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    chooseFileType: vi.fn(async () => null),
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
    promptRowHeight: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showSqlQuery: vi.fn(async () => undefined),
    showAiAssistant: vi.fn(),
    showDiff: vi.fn(async () => undefined),
    showPivot: vi.fn(async () => undefined),
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
  tabBar: TabBar;
  sheetBar: SheetBar;
  book: Tab;
  csv: Tab;
}

/** A workbook tab (active, unprotected) and a CSV tab, with both strips on the page. */
function setup(): Harness {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const book = state.addTab('book.rsf', RsfDocument.empty('book.rsf', 5, 3, 'Sheet1'), null);
  const csv = state.addTab('sales.csv', doc('Item,Qty\nPen,2\n'), null);
  state.activateTab(book.id);
  const tabBar = new TabBar(state, commands);
  const sheetBar = new SheetBar(state, commands);
  state.subscribe(() => {
    tabBar.render();
    sheetBar.render(true);
  });
  document.body.append(tabBar.element, sheetBar.element);
  tabBar.render();
  sheetBar.render(true);
  return { state, tabBar, sheetBar, book, csv };
}

function tabElement(tabBar: TabBar, id: string): HTMLElement {
  return tabBar.element.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!;
}

function worksheetStrip(sheetBar: SheetBar): HTMLElement {
  return sheetBar.element.querySelector<HTMLElement>('.sheet-strip')!;
}

/** Fire a drag event at `el` (it bubbles, as the browser's does) and return it, to read `defaultPrevented`. */
function dispatch(el: Element, type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

/** A dragleave on `el` whose `relatedTarget` (where the pointer went) is `to`. */
function dragLeave(el: Element, to: Element | null): void {
  const event = new Event('dragleave', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'relatedTarget', { value: to });
  el.dispatchEvent(event);
}

function sheetNames(tab: Tab): string[] {
  return isWorkbook(tab.doc) ? tab.doc.sheets.map((sheet) => sheet.name) : [];
}

beforeEach(() => {
  document.body.textContent = '';
  setDraggedTabId(null);
});

describe('dragging a document tab onto the worksheet strip', () => {
  it('is taken as a copy while it is over the strip, and the strip shows that it will be', () => {
    const { tabBar, sheetBar, csv } = setup();
    dispatch(tabElement(tabBar, csv.id), 'dragstart');
    const over = dispatch(worksheetStrip(sheetBar), 'dragover');
    expect(over.defaultPrevented).toBe(true);
    expect(worksheetStrip(sheetBar).classList.contains('drop-merge')).toBe(true);
  });

  it('is accepted over one of the worksheet tabs too', () => {
    const { tabBar, sheetBar, csv } = setup();
    dispatch(tabElement(tabBar, csv.id), 'dragstart');
    const sheetTab = sheetBar.element.querySelector<HTMLElement>('.sheet-tab')!;
    const over = dispatch(sheetTab, 'dragover');
    expect(over.defaultPrevented).toBe(true);
    expect(worksheetStrip(sheetBar).classList.contains('drop-merge')).toBe(true);
  });

  it('is added to the workbook as a sheet on drop, and the tab stays open', async () => {
    const { state, tabBar, sheetBar, book, csv } = setup();
    dispatch(tabElement(tabBar, csv.id), 'dragstart');
    dispatch(worksheetStrip(sheetBar), 'dragover');
    const drop = dispatch(worksheetStrip(sheetBar), 'drop');
    expect(drop.defaultPrevented).toBe(true);
    expect(worksheetStrip(sheetBar).classList.contains('drop-merge')).toBe(false);
    // The sheet is added a tick after the drop (see `onTabDrop`), once the drop itself is done.
    await Promise.resolve();
    expect(sheetNames(book)).toEqual(['Sheet1', 'sales']);
    expect(state.tabs).toContain(csv);
  });

  it('is refused for the active workbook itself, since it cannot be added to itself', () => {
    const { tabBar, sheetBar, book } = setup();
    dispatch(tabElement(tabBar, book.id), 'dragstart');
    const over = dispatch(worksheetStrip(sheetBar), 'dragover');
    expect(over.defaultPrevented).toBe(false);
    expect(worksheetStrip(sheetBar).classList.contains('drop-merge')).toBe(false);
  });

  it('is refused when no tab is being dragged', () => {
    const { sheetBar } = setup();
    const over = dispatch(worksheetStrip(sheetBar), 'dragover');
    expect(over.defaultPrevented).toBe(false);
    expect(worksheetStrip(sheetBar).classList.contains('drop-merge')).toBe(false);
  });

  it('is refused while the active tab is a CSV table, since there is no workbook to add it to', () => {
    const { state, tabBar, sheetBar, book, csv } = setup();
    state.activateTab(csv.id);
    dispatch(tabElement(tabBar, book.id), 'dragstart');
    const over = dispatch(worksheetStrip(sheetBar), 'dragover');
    expect(over.defaultPrevented).toBe(false);
    expect(sheetNames(book)).toEqual(['Sheet1']);
  });

  it('is refused once the drag has ended without a drop', () => {
    const { tabBar, sheetBar, csv } = setup();
    dispatch(tabElement(tabBar, csv.id), 'dragstart');
    dispatch(tabElement(tabBar, csv.id), 'dragend');
    const over = dispatch(worksheetStrip(sheetBar), 'dragover');
    expect(over.defaultPrevented).toBe(false);
  });

  it('clears its indicator when the drag leaves the strip, but keeps it while the drag moves over the strip', () => {
    const { tabBar, sheetBar, csv } = setup();
    dispatch(tabElement(tabBar, csv.id), 'dragstart');
    const strip = worksheetStrip(sheetBar);
    dispatch(strip, 'dragover');
    const sheetTab = sheetBar.element.querySelector<HTMLElement>('.sheet-tab')!;
    dragLeave(strip, sheetTab);
    expect(strip.classList.contains('drop-merge')).toBe(true);
    dragLeave(strip, document.body);
    expect(strip.classList.contains('drop-merge')).toBe(false);
  });
});
