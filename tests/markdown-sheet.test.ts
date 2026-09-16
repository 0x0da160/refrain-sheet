// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The docked Markdown worksheet view (`MarkdownSheetView`, #486): the
 * source textarea filling its pane (not a cramped default-sized box), and
 * the preview-visibility toggle.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { RsfDocument } from '../src/core/rsf-document';
import { MarkdownSheetView } from '../src/ui/markdown-sheet';

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
    showMarkdownEditor: vi.fn(async () => undefined),
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

/** An app state with one open workbook tab whose active worksheet is a Markdown worksheet. */
function setup(): { view: MarkdownSheetView } {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const workbook = RsfDocument.empty('book.rsf', 8, 4, 'Sheet1');
  const notes = workbook.createMarkdownWorksheet('Notes');
  workbook.insertSheetAt(1, notes);
  workbook.setActiveSheetId(notes.id);
  state.addTab('book.rsf', workbook, null);
  const view = new MarkdownSheetView(state, commands);
  view.refresh();
  return { view };
}

describe('MarkdownSheetView', () => {
  it('gives the source textarea the shared flex-sizing style class, not just its own id-scoped class', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea')!;
    expect(textarea.classList.contains('markdown-editor-source')).toBe(true);
  });

  it('shows the preview pane by default', () => {
    const { view } = setup();
    const previewPane = view.element.querySelectorAll('.markdown-editor-pane')[1] as HTMLElement;
    expect(previewPane.hidden).toBe(false);
  });

  it('hides the preview pane when the toggle button is clicked, and shows it again on a second click', () => {
    const { view } = setup();
    const toggle = view.element.querySelector('.markdown-editor-toolbar button') as HTMLButtonElement;
    const previewPane = view.element.querySelectorAll('.markdown-editor-pane')[1] as HTMLElement;

    toggle.click();
    expect(previewPane.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    expect(previewPane.hidden).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the preview as rich Markdown (e.g. a table), reflecting the source', () => {
    const { view } = setup();
    const textarea = view.element.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const preview = view.element.querySelector('.markdown-editor-preview')!;
    expect(preview.querySelector('table')).not.toBeNull();
    expect(preview.querySelector('th')?.textContent).toBe('A');
  });
});
