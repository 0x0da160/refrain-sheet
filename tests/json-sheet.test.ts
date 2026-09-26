// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The docked JSON worksheet view (`JsonSheetView`, #529): the source
 * textarea filling its pane, the preview toggle (mirroring
 * `MarkdownSheetView`), the syntax-highlighted read-only preview, and the
 * explicit, button-triggered Format action.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
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

// The preview render is debounced (120 ms) and then painted on an animation
// frame. Let the last test's pending render finish while jsdom still exists,
// so it never fires after the environment is torn down.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
});
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

  it('renders the preview as syntax-highlighted tokens, reflecting the source', async () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '{"a": true}';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // The preview render is debounced and rAF-coalesced (see `editor-preview-perf.ts`)
    // rather than synchronous with the input event.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const preview = view.panelElement.querySelector('.markdown-editor-preview')!;
    expect(preview.querySelector('pre code')).not.toBeNull();
    expect(preview.querySelector('.tok-keyword')?.textContent).toBe('true');
  });

  it('skips syntax highlighting and shows a notice for a very large document', async () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    // Well past LARGE_PREVIEW_SOURCE_LENGTH (256 KB).
    textarea.value = `[${'"x",'.repeat(80_000)}"end"]`;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 200));

    const preview = view.panelElement.querySelector('.markdown-editor-preview')!;
    expect(preview.querySelector('pre code')).toBeNull();
    expect(preview.textContent).toContain('Too large');
  });

  it('keeps the source textarea and preview pane scroll positions in sync', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    const preview = view.panelElement.querySelector('.markdown-editor-preview') as HTMLElement;

    Object.defineProperty(textarea, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(textarea, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(textarea, 'scrollTop', { value: 450, configurable: true });
    Object.defineProperty(preview, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(preview, 'clientHeight', { value: 50, configurable: true });
    let previewScrollTop = 0;
    Object.defineProperty(preview, 'scrollTop', {
      get: () => previewScrollTop,
      set: (v: number) => {
        previewScrollTop = v;
      },
      configurable: true,
    });

    textarea.dispatchEvent(new Event('scroll'));

    // textarea is at (450 - 0) / (1000 - 100) = 50% scrolled; preview should
    // land at 50% of its own (500 - 50) scrollable range.
    expect(previewScrollTop).toBe(225);
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

  it('the auto-format-on-commit checkbox is unchecked by default', () => {
    const { view } = setup();
    const checkbox = view.element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
  });

  it('checking the auto-format-on-commit checkbox turns on autoFormatSource for the file', () => {
    const { view, workbook } = setup();
    const checkbox = view.element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(workbook.autoFormatSource).toBe(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(workbook.autoFormatSource).toBe(false);
  });

  it('auto-formats valid JSON on commit (blur) once the checkbox is checked', () => {
    const { view, tab, workbook } = setup();
    workbook.setAutoFormatSource(true);
    view.refresh();
    const checkbox = view.element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(true);

    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '{"a":1,"b":[1,2]}';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('blur'));

    expect(textarea.value).toBe(JSON.stringify({ a: 1, b: [1, 2] }, null, 2));
    expect(tab.doc.kind === 'rsf' ? tab.doc.activeSheet.jsonText : '').toBe(textarea.value);
  });

  it('leaves invalid JSON untouched on commit but still commits it, even with auto-format checked', () => {
    const notify = vi.fn();
    const { view, tab, workbook } = setup(stubUi({ notify }));
    workbook.setAutoFormatSource(true);
    view.refresh();

    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '{not valid json';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('blur'));

    expect(textarea.value).toBe('{not valid json');
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'error');
    // The edit is never blocked on a failed auto-format: the raw, invalid
    // text still commits.
    expect(tab.doc.kind === 'rsf' ? tab.doc.activeSheet.jsonText : '').toBe('{not valid json');
  });

  it('does not auto-format on commit when the checkbox is off (the default)', () => {
    const { view, tab } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '{"a":1,"b":[1,2]}';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('blur'));

    expect(textarea.value).toBe('{"a":1,"b":[1,2]}');
    expect(tab.doc.kind === 'rsf' ? tab.doc.activeSheet.jsonText : '').toBe('{"a":1,"b":[1,2]}');
  });
});
