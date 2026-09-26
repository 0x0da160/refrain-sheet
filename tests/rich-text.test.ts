// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Rich text in RSF cells: parts of a cell's text with their own bold/
 * italic/underline/text color. The pure run model, the `.rsf` round trip
 * (and that older, stale, or malformed runs are handled), the commit path
 * with undo, the cell editor's Ctrl+B on selected text, and rendering.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { applyCellStylePatch } from '../src/core/cell-style';
import {
  charFormats,
  isFormatOn,
  remapFormats,
  remapRuns,
  runsForText,
  runsFromChars,
  setFormatKey,
  type TextRun,
} from '../src/core/rich-text';
import { RsfDocument } from '../src/core/rsf-document';
import { t } from '../src/app/i18n';
import { Grid } from '../src/ui/grid';
import { rsfFromTree, rsfTree } from './rsf-single-sheet';

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

function setup(value = 'Hello world') {
  const state = new AppState();
  const ui = stubUi();
  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
  document.body.append(grid.element);
  state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
  const doc = RsfDocument.empty('t.rsf', 3, 3);
  doc.setCell(0, 0, value);
  const tab = state.addTab('t.rsf', doc, null);
  grid.refresh();
  return { state, grid, commands, tab, doc, ui };
}

const WORLD_BOLD: TextRun[] = [{ text: 'Hello ' }, { text: 'world', bold: true }];

const ctrl = (key: string) =>
  new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('rich text: the run model', () => {
  it('merges equal neighbours and stores nothing for plain text', () => {
    const formats = setFormatKey(charFormats([{ text: 'Hello world' }]), 6, 11, 'bold', true);
    expect(runsFromChars('Hello world', formats)).toEqual(WORLD_BOLD);
    expect(runsFromChars('Hello', charFormats([{ text: 'Hello' }]))).toBeNull();
  });

  it('never splits a surrogate pair', () => {
    const text = 'a\u{1F600}b';
    const formats = setFormatKey(charFormats([{ text }]), 0, 2, 'bold', true);
    const runs = runsFromChars(text, formats)!;
    expect(runs.map((r) => r.text)).toEqual(['a\u{1F600}', 'b']);
  });

  it('applies runs only while they spell out the text, and never to a formula', () => {
    expect(runsForText(WORLD_BOLD, 'Hello world')).toBe(WORLD_BOLD);
    expect(runsForText(WORLD_BOLD, 'Hello there')).toBeNull();
    expect(runsForText([{ text: '=A1', bold: true }], '=A1')).toBeNull();
  });

  it('carries formats across an edit: new text takes the format it follows', () => {
    const after = remapRuns('Hello world', 'Hello world!!', WORLD_BOLD);
    expect(after).toEqual([{ text: 'Hello ' }, { text: 'world!!', bold: true }]);
    const front = remapFormats('world', 'my world', charFormats([{ text: 'world', bold: true }]));
    expect(front.every((f) => f.bold)).toBe(true);
    expect(remapRuns('Hello world', 'Hello', WORLD_BOLD)).toBeNull();
  });

  it('decides a toggle from the whole selection, counting the cell style', () => {
    const formats = charFormats(WORLD_BOLD);
    expect(isFormatOn(formats, 6, 11, 'bold', false)).toBe(true);
    expect(isFormatOn(formats, 0, 11, 'bold', false)).toBe(false);
    expect(isFormatOn(formats, 0, 11, 'bold', true)).toBe(true);
  });

  it('setting a property on the whole cell removes it from the parts', () => {
    const style = applyCellStylePatch({ runs: WORLD_BOLD }, { bold: true });
    expect(style).toEqual({ bold: true });
    const colored = applyCellStylePatch(
      { runs: [{ text: 'a', textColor: '#ff0000', bold: true }] },
      { bold: false },
    );
    expect(colored).toEqual({ runs: [{ text: 'a', textColor: '#ff0000' }] });
  });
});

describe('rich text: the .rsf file', () => {
  it('round-trips runs, false values and colors included', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    doc.setCell(0, 0, 'Hello world');
    const runs: TextRun[] = [
      { text: 'Hello ', bold: false },
      { text: 'world', italic: true, underline: true, textColor: '#cc0000' },
    ];
    doc.setCellStyleOn(undefined, 0, 0, { bold: true, runs });
    const loaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.getStyle(0, 0)).toEqual({ bold: true, runs });
  });

  it('writes runs as text segments under the cell style', () => {
    const doc = RsfDocument.empty('t.rsf', 1, 1);
    doc.setCell(0, 0, 'Hello world');
    doc.setCellStyleOn(undefined, 0, 0, { runs: WORLD_BOLD });
    const tree = rsfTree(doc.toBytes()) as { sheets: Array<{ styles: Record<string, unknown> }> };
    expect(tree.sheets[0].styles.A1).toEqual({ runs: [{ text: 'Hello ' }, { text: 'world', bold: true }] });
  });

  it('drops runs that no longer match the cell text when saving', () => {
    const doc = RsfDocument.empty('t.rsf', 1, 1);
    doc.setCell(0, 0, 'Changed');
    doc.setCellStyleOn(undefined, 0, 0, { italic: true, runs: WORLD_BOLD });
    const tree = rsfTree(doc.toBytes()) as { sheets: Array<{ styles: Record<string, unknown> }> };
    expect(tree.sheets[0].styles.A1).toEqual({ italic: true });
  });

  it('refuses malformed runs', () => {
    const base = (runs: unknown) => ({
      format: 'refrain-sheet',
      version: 1,
      sheets: [{ id: 's1', name: 'Sheet1', rows: 1, cols: 1, cells: [['ab']], styles: { A1: { runs } } }],
    });
    for (const runs of [
      'ab',
      [{ bold: true }],
      [{ text: 'ab', bold: 'yes' }],
      [{ text: 'ab', textColor: 'red' }],
    ]) {
      const result = RsfDocument.fromBytes(rsfFromTree(base(runs)), 't.rsf');
      expect(result.ok ? 'ok' : result.error).toBe('bad-shape');
    }
    const tooMany = Array.from({ length: 10_001 }, () => ({ text: '' }));
    const result = RsfDocument.fromBytes(rsfFromTree(base(tooMany)), 't.rsf');
    expect(result.ok ? 'ok' : result.error).toBe('too-large');
  });
});

describe('rich text: editing in the cell', () => {
  const field = () => document.querySelector<HTMLElement>('.rich-cell-editor');
  const parts = () =>
    [...(field()?.querySelectorAll<HTMLElement>('.rich-run') ?? [])].map((span) => [
      span.textContent,
      span.style.fontWeight,
      span.style.color,
    ]);
  const toolbar = () => document.querySelector<HTMLElement>('.rich-text-toolbar')!;
  const toolButton = (label: string) =>
    toolbar().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

  it('Ctrl+B bolds only the selected text, shows it in the cell, and commits as one undoable edit', () => {
    const { state, grid, tab, doc } = setup();
    grid.openEditor(tab, 0, 0, null);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    input.setSelectionRange(6, 11);
    const event = ctrl('b');
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // The formatted field now edits the cell, showing the bold part.
    expect(parts()).toEqual([
      ['Hello ', 'normal', ''],
      ['world', 'bold', ''],
    ]);
    grid.commitEditor();
    expect(doc.getStyle(0, 0)?.runs).toEqual(WORLD_BOLD);
    expect(doc.getValue(0, 0)).toBe('Hello world');
    expect(field()).toBeNull();
    state.undo(tab);
    expect(doc.getStyle(0, 0)).toBeNull();
    expect(tab.history.canUndo).toBe(false);
  });

  it('opens a cell with formatted parts showing them, and typed text keeps its part', () => {
    const { grid, tab, doc } = setup();
    doc.setCellStyleOn(undefined, 0, 0, { runs: WORLD_BOLD });
    grid.openEditor(tab, 0, 0, null);
    expect(parts()).toEqual([
      ['Hello ', 'normal', ''],
      ['world', 'bold', ''],
    ]);
    const world = field()!.querySelectorAll('.rich-run')[1].firstChild as Text;
    world.data = 'world!';
    field()!.dispatchEvent(new Event('input', { bubbles: true }));
    grid.commitEditor();
    expect(doc.getValue(0, 0)).toBe('Hello world!');
    expect(doc.getStyle(0, 0)?.runs).toEqual([{ text: 'Hello ' }, { text: 'world!', bold: true }]);
  });

  it('the toolbar appears over selected text and colors it', () => {
    const { grid, tab, doc } = setup();
    grid.openEditor(tab, 0, 0, null);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    input.setSelectionRange(0, 5);
    document.dispatchEvent(new Event('selectionchange'));
    expect(toolbar().hidden).toBe(false);
    toolButton(t('richText.color.red')).click();
    expect(parts()).toEqual([
      ['Hello', 'normal', 'rgb(211, 47, 47)'],
      [' world', 'normal', ''],
    ]);
    grid.commitEditor();
    expect(doc.getStyle(0, 0)?.runs).toEqual([{ text: 'Hello', textColor: '#d32f2f' }, { text: ' world' }]);
    expect(document.querySelector('.rich-text-toolbar')).toBeNull();
  });

  it('removing the formatting of all the text clears the parts', () => {
    const { grid, tab, doc } = setup();
    doc.setCellStyleOn(undefined, 0, 0, { runs: WORLD_BOLD });
    grid.openEditor(tab, 0, 0, null);
    const range = document.createRange();
    range.selectNodeContents(field()!);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    toolButton(t('richText.clear')).click();
    grid.commitEditor();
    expect(doc.getStyle(0, 0)).toBeNull();
  });

  it('shows no toolbar without a selection or in a formula', () => {
    const { grid, tab } = setup('=1+1');
    grid.openEditor(tab, 0, 0, null);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    input.setSelectionRange(0, 3);
    document.dispatchEvent(new Event('selectionchange'));
    expect(toolbar().hidden).toBe(true);
    input.dispatchEvent(ctrl('b'));
    expect(field()).toBeNull();
  });

  it('typing over a cell replaces its formatted parts', () => {
    const { grid, tab, doc } = setup();
    doc.setCellStyleOn(undefined, 0, 0, { italic: true, runs: WORLD_BOLD });
    grid.openEditor(tab, 0, 0, 'New');
    grid.commitEditor();
    expect(doc.getValue(0, 0)).toBe('New');
    expect(doc.getStyle(0, 0)).toEqual({ italic: true });
  });

  it('an edit from elsewhere carries runs over, and undo restores both', async () => {
    const { state, commands, tab, doc } = setup();
    doc.setCellStyleOn(undefined, 0, 0, { runs: WORLD_BOLD });
    await commands.commitCellEdit(tab, 0, 0, 'Hi world');
    expect(doc.getStyle(0, 0)?.runs).toEqual([{ text: 'Hi ' }, { text: 'world', bold: true }]);
    state.undo(tab);
    expect(doc.getValue(0, 0)).toBe('Hello world');
    expect(doc.getStyle(0, 0)?.runs).toEqual(WORLD_BOLD);
  });
});

describe('rich text: rendering', () => {
  it("paints one span per part, with the part's own format", () => {
    const { state, grid, doc } = setup();
    state.pushEntry(state.activeTab!, {
      label: 'test',
      ops: [{ type: 'styles', changes: [{ row: 0, col: 0, before: null, after: { runs: WORLD_BOLD } }] }],
    });
    grid.refresh();
    const cell = grid.element.querySelector<HTMLElement>('[data-row="0"][data-col="0"]')!;
    // One wrapper child: a wrapped row's cell is a flex box, and loose spans
    // would each become a separate flex item.
    const bodies = [...cell.children].filter((child) => child.classList.contains('rich-text-body'));
    expect(bodies).toHaveLength(1);
    expect(cell.querySelectorAll(':scope > .rich-run')).toHaveLength(0);
    const spans = [...cell.querySelectorAll<HTMLElement>('.rich-run')];
    expect(spans.map((s) => s.textContent)).toEqual(['Hello ', 'world']);
    expect(spans[1].style.fontWeight).toBe('bold');
    expect(spans[0].style.fontWeight).toBe('normal');
    expect(doc.getValue(0, 0)).toBe('Hello world');
  });

  it('paints stale runs as plain text', () => {
    const { grid, doc } = setup('Other');
    doc.setCellStyleOn(undefined, 0, 0, { runs: WORLD_BOLD });
    grid.refresh();
    const cell = grid.element.querySelector<HTMLElement>('[data-row="0"][data-col="0"]')!;
    expect(cell.querySelector('.rich-run')).toBeNull();
    expect(cell.textContent).toBe('Other');
  });
});
