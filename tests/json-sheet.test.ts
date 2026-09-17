// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The docked JSON worksheet view (`JsonSheetView`, #529): the source
 * textarea filling its pane, the preview toggle (mirroring
 * `MarkdownSheetView`), the syntax-highlighted read-only preview, and the
 * explicit, button-triggered Format action.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { RsfDocument } from '../src/core/rsf-document';
import type { Worksheet } from '../src/core/worksheet';
import { JsonSheetView } from '../src/ui/json-sheet';

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

/** An app state with one open workbook tab whose active worksheet is a JSON worksheet. */
function setup(ui: UiPort = stubUi()): {
  view: JsonSheetView;
  state: AppState;
  tab: Tab;
  workbook: RsfDocument;
  data: Worksheet;
  ui: UiPort;
} {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const workbook = RsfDocument.empty('book.rsf', 8, 4, 'Sheet1');
  const data = workbook.createJsonWorksheet('Data');
  workbook.insertSheetAt(1, data);
  workbook.setActiveSheetId(data.id);
  const tab = state.addTab('book.rsf', workbook, null);
  const view = new JsonSheetView(state, commands);
  view.refresh();
  return { view, state, tab, workbook, data, ui };
}

describe('JsonSheetView', () => {
  it('gives the source textarea the shared flex-sizing style class, not just its own id-scoped class', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea')!;
    expect(textarea.classList.contains('markdown-editor-source')).toBe(true);
  });

  it('opens the preview panel by default', () => {
    const { view } = setup();
    expect(view.panelElement.hidden).toBe(false);
  });

  it('closes the preview panel when the toggle button is clicked, and reopens it on a second click', () => {
    const { view } = setup();
    const toggle = view.element.querySelector('.markdown-editor-toolbar button') as HTMLButtonElement;

    toggle.click();
    expect(view.panelElement.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    expect(view.panelElement.hidden).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the preview as syntax-highlighted tokens, reflecting the source', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '{"a": true}';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const preview = view.panelElement.querySelector('.markdown-editor-preview')!;
    expect(preview.querySelector('pre code')).not.toBeNull();
    expect(preview.querySelector('.tok-keyword')?.textContent).toBe('true');
  });

  it('hides the preview panel when the active worksheet is no longer a JSON sheet', () => {
    const { view, state, tab, workbook } = setup();
    expect(view.panelElement.hidden).toBe(false);

    state.setActiveSheet(tab, workbook.sheets[0].id);
    view.refresh();

    expect(view.panelElement.hidden).toBe(true);
  });

  it('reopens the preview panel on returning to a JSON sheet if it was left open', () => {
    const { view, state, tab, workbook, data } = setup();

    state.setActiveSheet(tab, workbook.sheets[0].id);
    view.refresh();
    expect(view.panelElement.hidden).toBe(true);

    state.setActiveSheet(tab, data.id);
    view.refresh();
    expect(view.panelElement.hidden).toBe(false);
  });

  it('pretty-prints valid JSON in place when Format is clicked, as an undoable edit', () => {
    const { view, tab } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '{"a":1,"b":[1,2]}';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const formatBtn = view.element.querySelector('.json-sheet-format') as HTMLButtonElement;
    formatBtn.click();

    expect(textarea.value).toBe(JSON.stringify({ a: 1, b: [1, 2] }, null, 2));
    expect(tab.doc.kind === 'rsf' ? tab.doc.activeSheet.jsonText : '').toBe(textarea.value);
  });

  it('leaves invalid JSON untouched and reports the parse error via notify, without touching the document', () => {
    const notify = vi.fn();
    const { view, tab } = setup(stubUi({ notify }));
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '{not valid json';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const formatBtn = view.element.querySelector('.json-sheet-format') as HTMLButtonElement;
    formatBtn.click();

    expect(textarea.value).toBe('{not valid json');
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(tab.doc.kind === 'rsf' ? tab.doc.activeSheet.jsonText : '').toBe('');
  });
});
