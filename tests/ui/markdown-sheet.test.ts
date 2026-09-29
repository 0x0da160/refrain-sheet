// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The docked Markdown worksheet view (`MarkdownSheetView`, #486, #502): the
 * source textarea filling its pane (not a cramped default-sized box), and
 * the preview toggle, which opens/closes the preview's dockable
 * `panelElement` side panel.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import type { Worksheet } from '../../src/core/workbook/worksheet';
import { MarkdownSheetView } from '../../src/ui/markdown-sheet';

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

/** An app state with one open workbook tab whose active worksheet is a Markdown worksheet. */
function setup(): {
  view: MarkdownSheetView;
  state: AppState;
  tab: Tab;
  workbook: RsfDocument;
  notes: Worksheet;
} {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const workbook = RsfDocument.empty('book.rsf', 8, 4, 'Sheet1');
  const notes = workbook.createMarkdownWorksheet('Notes');
  workbook.insertSheetAt(1, notes);
  workbook.setActiveSheetId(notes.id);
  const tab = state.addTab('book.rsf', workbook, null);
  const view = new MarkdownSheetView(state, commands);
  view.refresh();
  return { view, state, tab, workbook, notes };
}

describe('MarkdownSheetView', () => {
  it('is read-only while its worksheet is locked, so nothing typed is refused later', () => {
    const { view, state, tab, notes } = setup();
    state.setSheetLocked(tab, notes.id, true);
    view.refresh();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);

    state.setSheetLocked(tab, notes.id, false);
    view.refresh();
    expect(textarea.readOnly).toBe(false);
  });

  it('gives the source textarea the shared flex-sizing style class, not just its own id-scoped class', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea')!;
    expect(textarea.classList.contains('markdown-editor-source')).toBe(true);
  });

  it('opens the preview panel by default', () => {
    const { view } = setup();
    expect(view.panelElement.hidden).toBe(false);
  });

  it('never closes the preview from the toolbar button: it is disabled while open and reopens after ×', () => {
    const { view } = setup();
    const toggle = view.element.querySelector('.markdown-preview-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);

    toggle.click();
    expect(view.panelElement.hidden).toBe(false);

    (view.panelElement.querySelector('.side-panel-close-btn') as HTMLButtonElement).click();
    expect(view.panelElement.hidden).toBe(true);
    expect(toggle.disabled).toBe(false);

    toggle.click();
    expect(view.panelElement.hidden).toBe(false);
    expect(toggle.disabled).toBe(true);
  });

  it('closes the preview panel when its own close button is clicked', () => {
    const { view } = setup();
    const closeBtn = view.panelElement.querySelector('.side-panel-close-btn') as HTMLButtonElement;

    closeBtn.click();
    expect(view.panelElement.hidden).toBe(true);
    const toggle = view.element.querySelector('.markdown-preview-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
  });

  it('renders the preview as rich Markdown (e.g. a table), reflecting the source', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const preview = view.panelElement.querySelector('.markdown-editor-preview')!;
    expect(preview.querySelector('table')).not.toBeNull();
    expect(preview.querySelector('th')?.textContent).toBe('A');
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

  it('hides the preview panel when the active worksheet is no longer a Markdown sheet', () => {
    const { view, state, tab, workbook } = setup();
    expect(view.panelElement.hidden).toBe(false);

    state.setActiveSheet(tab, workbook.sheets[0].id);
    view.refresh();

    expect(view.panelElement.hidden).toBe(true);
  });

  it('reopens the preview panel on returning to a Markdown sheet if it was left open', () => {
    const { view, state, tab, workbook, notes } = setup();

    state.setActiveSheet(tab, workbook.sheets[0].id);
    view.refresh();
    expect(view.panelElement.hidden).toBe(true);

    state.setActiveSheet(tab, notes.id);
    view.refresh();
    expect(view.panelElement.hidden).toBe(false);
  });

  it('switches to the formatted view, edits there, and saves Markdown text', async () => {
    const { view, state, tab, workbook, notes } = setup();
    await new Commands(state, stubUi(), document).commitCellEdit(tab, 0, 0, '# Plan\n\nDraft');
    view.refresh();
    const [markdownButton, formattedButton] = Array.from(
      view.element.querySelectorAll<HTMLButtonElement>('.markdown-mode-button'),
    );
    expect(markdownButton.getAttribute('aria-pressed')).toBe('true');

    formattedButton.click();
    expect(formattedButton.getAttribute('aria-pressed')).toBe('true');
    expect((view.element.querySelector('.markdown-editor-source')!.parentElement as HTMLElement).hidden).toBe(
      true,
    );
    expect(view.panelElement.hidden).toBe(true);
    const visual = view.element.querySelector('.markdown-visual')!;
    expect(visual.querySelector('h1')!.textContent).toBe('Plan');

    const paragraph = visual.querySelector('p')!;
    paragraph.textContent = 'Final';
    paragraph.dispatchEvent(new Event('input', { bubbles: true }));
    view.flushCommit();
    expect(workbook.sheetById(notes.id)!.markdownText).toBe('# Plan\n\nFinal');

    // Undo shows the earlier text again.
    state.undo(tab);
    view.refresh();
    expect(visual.querySelector('p')!.textContent).toBe('Draft');

    markdownButton.click();
    expect((view.element.querySelector('.markdown-editor-source') as HTMLTextAreaElement).value).toBe(
      '# Plan\n\nDraft',
    );
    expect(view.panelElement.hidden).toBe(false);
  });
});
