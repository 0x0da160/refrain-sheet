// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The docked plain-text worksheet view (`TextSheetView`, #557): a stripped-
 * down `JsonSheetView`/`YamlSheetView` with just the source textarea — no
 * preview panel, no Format action, since unstructured text has nothing to
 * render or pretty-print.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { RsfDocument } from '../src/core/rsf-document';
import { Worksheet } from '../src/core/worksheet';
import { TextSheetView } from '../src/ui/text-sheet';

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
    chooseRecentFile: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

/** An app state with one open workbook tab whose active worksheet is a plain-text worksheet. */
function setup(ui: UiPort = stubUi()): {
  view: TextSheetView;
  state: AppState;
  tab: Tab;
  workbook: RsfDocument;
  data: Worksheet;
  ui: UiPort;
} {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const workbook = RsfDocument.empty('book.rsf', 8, 4, 'Sheet1');
  const data = workbook.createTextWorksheet('Notes');
  workbook.insertSheetAt(1, data);
  workbook.setActiveSheetId(data.id);
  const tab = state.addTab('book.rsf', workbook, null);
  const view = new TextSheetView(state, commands);
  view.refresh();
  return { view, state, tab, workbook, data, ui };
}

describe('TextSheetView', () => {
  it('gives the source textarea the shared flex-sizing style class, not just its own id-scoped class', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea')!;
    expect(textarea.classList.contains('markdown-editor-source')).toBe(true);
  });

  it('has no preview panel and no Format button', () => {
    const { view } = setup();
    expect(view.element.querySelector('.markdown-editor-toolbar')).toBeNull();
    expect((view as unknown as { panelElement?: HTMLElement }).panelElement).toBeUndefined();
  });

  it('is hidden when there is no active tab, and shown once one is bound', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const view = new TextSheetView(state, commands);
    view.refresh();
    expect(view.element.hidden).toBe(true);
    expect(view.active).toBe(false);
  });

  it('loads the worksheet plain text into the textarea on refresh', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const workbook = RsfDocument.empty('book.rsf', 8, 4, 'Sheet1');
    const data = Worksheet.text('t1', 'Notes', 'hello world');
    workbook.insertSheetAt(1, data);
    workbook.setActiveSheetId(data.id);
    state.addTab('book.rsf', workbook, null);

    const view = new TextSheetView(state, commands);
    view.refresh();

    expect(view.element.hidden).toBe(false);
    expect(view.active).toBe(true);
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('hello world');
  });

  it('commits an edit to cell (0, 0) as an undoable operation, debounced then flushed on blur', () => {
    const { view, tab } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'some free-form text';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('blur'));

    expect(tab.doc.kind === 'rsf' ? tab.doc.activeSheet.plainText : '').toBe('some free-form text');
  });

  it('hides itself when the active worksheet is no longer a text sheet', () => {
    const { view, state, tab, workbook } = setup();
    expect(view.element.hidden).toBe(false);

    state.setActiveSheet(tab, workbook.sheets[0].id);
    view.refresh();

    expect(view.element.hidden).toBe(true);
    expect(view.active).toBe(false);
  });
  it('does not turn on Wrap Long Rows when the text gains a line break', () => {
    const { view, tab } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'line one\nline two';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('blur'));

    expect(tab.doc.kind === 'rsf' ? tab.doc.activeSheet.plainText : '').toBe('line one\nline two');
    expect(tab.wrapCells).toBe(false);
    // The single undo entry is the text edit alone, with no wrap operation.
    expect(tab.history.undo()?.ops.map((op) => op.type)).toEqual(['cells']);
  });

  it('types a tab character on Tab instead of moving focus, and indents selected lines', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'ab';
    textarea.setSelectionRange(1, 1);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    textarea.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('a\tb');

    textarea.value = 'one\ntwo';
    textarea.setSelectionRange(0, 7);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(textarea.value).toBe('\tone\n\ttwo');
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(textarea.value).toBe('one\ntwo');
  });

  it('lets Tab move focus on after Escape, so the keyboard is never trapped', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'ab';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    textarea.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(textarea.value).toBe('ab');
  });

  it('has no visible form label: the editor is named by aria-label', () => {
    const { view } = setup();
    expect(view.element.querySelector('label')).toBeNull();
    expect(view.element.querySelector('textarea')!.getAttribute('aria-label')).toBeTruthy();
  });
});
