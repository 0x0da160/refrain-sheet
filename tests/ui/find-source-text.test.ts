// @vitest-environment jsdom
/**
 * Find & Replace on a source-text worksheet (Markdown, JSON, YAML, plain text).
 * Its whole text is one cell, so each occurrence is a match: it is selected in
 * the worksheet's editor, marked there, and replaced one at a time or all at once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { Worksheet } from '../../src/core/workbook/worksheet';
import type { Grid } from '../../src/ui/grid';
import { FindBar } from '../../src/ui/find-bar';
import { TextSheetView } from '../../src/ui/text-sheet';
import { doc } from '../helpers';

/** Every dialog method is a no-op: none of these tests opens one. */
const ui = new Proxy({}, { get: () => vi.fn(async () => null) }) as unknown as UiPort;

interface Harness {
  state: AppState;
  tab: Tab;
  view: TextSheetView;
  findBar: FindBar;
  findInput: HTMLInputElement;
  replaceInput: HTMLInputElement;
  textarea: HTMLTextAreaElement;
  click(selector: string): void;
}

/** A workbook whose active worksheet is a plain-text sheet holding `text`, with its editor and find bar. */
function setup(text: string): Harness {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const workbook = RsfDocument.empty('book.rsf', 8, 4, 'Sheet1');
  const notes = Worksheet.text('t1', 'Notes', text);
  workbook.insertSheetAt(1, notes);
  workbook.setActiveSheetId(notes.id);
  const tab = state.addTab('book.rsf', workbook, null);
  const view = new TextSheetView(state, commands);
  const grid = { reveal: vi.fn(), setFindHighlight: vi.fn(), refresh: vi.fn() } as unknown as Grid;
  const findBar = new FindBar(state, commands, grid, [view]);
  document.body.append(view.element, findBar.element);
  // The shell refreshes the source view and the find bar on each of these events.
  state.subscribe((event) => {
    if (event === 'doc' || event === 'sheets' || event === 'active' || event === 'tabs') {
      view.refresh();
      findBar.refresh();
    }
  });
  view.refresh();
  const inputs = findBar.element.querySelectorAll<HTMLInputElement>('input[type="text"]');
  return {
    state,
    tab,
    view,
    findBar,
    findInput: inputs[0],
    replaceInput: inputs[1],
    textarea: view.element.querySelector('textarea') as HTMLTextAreaElement,
    click(selector) {
      findBar.element.querySelector<HTMLButtonElement>(selector)!.click();
    },
  };
}

function search(h: Harness, query: string, options: { regex?: boolean } = {}): void {
  if (options.regex) {
    const regexBox = h.findBar.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1];
    regexBox.checked = true;
    regexBox.dispatchEvent(new Event('change'));
  }
  h.findInput.value = query;
  h.findInput.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(200);
}

function selection(h: Harness): [number, number] {
  return [h.textarea.selectionStart, h.textarea.selectionEnd];
}

beforeEach(() => {
  document.body.textContent = '';
  vi.useFakeTimers();
});

describe('FindBar on a source-text worksheet', () => {
  it('selects each occurrence in the editor in turn, wrapping at the end', () => {
    const h = setup('cat dog cat');
    h.findBar.open(false);
    search(h, 'cat');

    h.findBar.next(1);
    expect(selection(h)).toEqual([0, 3]);
    h.findBar.next(1);
    expect(selection(h)).toEqual([8, 11]);
    h.findBar.next(1);
    expect(selection(h)).toEqual([0, 3]);
  });

  it('marks every occurrence in the editor and emphasizes the current one', () => {
    const h = setup('cat dog cat');
    h.findBar.open(false);
    search(h, 'cat');
    h.findBar.next(1);

    const marks = Array.from(h.view.element.querySelectorAll('mark.find-hit'));
    expect(marks.map((m) => m.textContent)).toEqual(['cat', 'cat']);
    expect(h.view.element.querySelectorAll('mark.find-hit-current')).toHaveLength(1);
    expect(h.view.element.querySelector('mark.find-hit-current')?.previousSibling).toBeNull();
    expect(h.textarea.classList.contains('find-matches')).toBe(true);
  });

  it('replaces the selected occurrence, then selects the next one', () => {
    const h = setup('cat dog cat');
    h.findBar.open(false);
    search(h, 'cat');
    h.findBar.next(1);

    h.replaceInput.value = 'bird';
    h.click('.find-replace');

    expect(h.tab.doc.getValue(0, 0)).toBe('bird dog cat');
    expect(h.textarea.value).toBe('bird dog cat');
    expect(selection(h)).toEqual([9, 12]);
  });

  it('replaces a regex occurrence using its own groups', () => {
    const h = setup('x1 x2');
    h.findBar.open(false);
    search(h, 'x(\\d)', { regex: true });
    h.findBar.next(1);

    h.replaceInput.value = 'y$1';
    h.click('.find-replace');

    expect(h.textarea.value).toBe('y1 x2');
  });

  it('leaves the text alone when the selection is not on a match', () => {
    const h = setup('cat dog cat');
    h.findBar.open(false);
    search(h, 'cat');
    h.findBar.next(1);
    h.textarea.setSelectionRange(4, 7);

    h.replaceInput.value = 'bird';
    h.click('.find-replace');

    expect(h.tab.doc.getValue(0, 0)).toBe('cat dog cat');
  });

  it('replaces every occurrence in the text and shows the result in the editor', async () => {
    const h = setup('cat dog cat');
    h.findBar.open(false);
    search(h, 'cat');

    h.replaceInput.value = 'bird';
    h.click('.find-replace-all');
    await vi.runAllTimersAsync();

    expect(h.tab.doc.getValue(0, 0)).toBe('bird dog bird');
    expect(h.textarea.value).toBe('bird dog bird');

    // One undoable step: a single undo restores the text, and the editor shows it.
    h.state.undo(h.tab);
    expect(h.tab.doc.getValue(0, 0)).toBe('cat dog cat');
    expect(h.textarea.value).toBe('cat dog cat');
  });

  it('includes typing that has not committed yet in Replace All', async () => {
    const h = setup('cat dog cat');
    h.findBar.open(false);
    h.textarea.value = 'cat dog cat cat';
    h.textarea.dispatchEvent(new Event('input'));
    search(h, 'cat');

    h.replaceInput.value = 'bird';
    h.click('.find-replace-all');
    await vi.runAllTimersAsync();

    expect(h.tab.doc.getValue(0, 0)).toBe('bird dog bird bird');
    expect(h.textarea.value).toBe('bird dog bird bird');
  });

  it('lists each occurrence by its line and column, with its line marked', () => {
    const h = setup('a cat\ncat dog cat');
    h.findBar.open(false);
    h.findInput.value = 'cat';
    h.findBar.findAll();

    const rows = Array.from(h.findBar.element.querySelectorAll('.find-result'));
    expect(rows.map((row) => row.querySelector('.find-result-ref')?.textContent)).toEqual([
      '1:3',
      '2:1',
      '2:9',
    ]);
    // A row marks the occurrence it lists, so the two on line 2 mark one each.
    expect(rows[0].querySelectorAll('.find-result-text mark.find-hit')).toHaveLength(1);
    expect(rows[1].querySelectorAll('.find-result-text mark.find-hit')).toHaveLength(1);
    expect(rows[2].querySelector('.find-result-text mark.find-hit')?.previousSibling?.textContent).toBe(
      'cat dog ',
    );
  });

  it('selects the occurrence before the caret when going back, then the one before that', () => {
    const h = setup('cat dog cat');
    h.findBar.open(false);
    search(h, 'cat');
    h.textarea.setSelectionRange(5, 5);

    h.findBar.next(-1);
    expect(selection(h)).toEqual([0, 3]);
    h.findBar.next(-1);
    expect(selection(h)).toEqual([8, 11]);
  });

  it('continues from a caret the user moved by hand', () => {
    const h = setup('cat dog cat dog cat');
    h.findBar.open(false);
    search(h, 'cat');
    h.findBar.next(1);
    expect(selection(h)).toEqual([0, 3]);

    h.textarea.setSelectionRange(9, 9);
    h.findBar.next(1);

    expect(selection(h)).toEqual([16, 19]);
  });

  it('drops the marks while text is typed, and repaints them once the text commits', () => {
    const h = setup('cat dog cat');
    h.findBar.open(false);
    search(h, 'cat');
    h.findBar.next(1);

    h.textarea.value = 'cat dog cat!';
    h.textarea.dispatchEvent(new Event('input'));
    expect(h.view.element.querySelectorAll('mark.find-hit')).toHaveLength(0);

    // The 600 ms commit debounce, then the find's 120 ms recompute.
    vi.advanceTimersByTime(800);
    expect(h.view.element.querySelectorAll('mark.find-hit')).toHaveLength(2);
  });

  it('removes the marks when the panel closes', () => {
    const h = setup('cat dog cat');
    h.findBar.open(false);
    search(h, 'cat');
    h.findBar.next(1);
    expect(h.view.element.querySelectorAll('mark.find-hit').length).toBeGreaterThan(0);

    h.findBar.close();

    expect(h.view.element.querySelectorAll('mark.find-hit')).toHaveLength(0);
    expect(h.textarea.classList.contains('find-matches')).toBe(false);
  });
});

describe('FindBar highlights on a grid sheet', () => {
  it('gives the grid the query and the current cell to paint', () => {
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const grid = { reveal: vi.fn(), setFindHighlight: vi.fn(), refresh: vi.fn() } as unknown as Grid;
    state.addTab('data.csv', doc('foo,x\nfoo,y\n'), null);
    const findBar = new FindBar(state, commands, grid);
    document.body.append(findBar.element);
    findBar.open(false);
    const findInput = findBar.element.querySelector<HTMLInputElement>('input[type="text"]')!;
    findInput.value = 'foo';
    findInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);

    findBar.next(1);

    const last = vi.mocked(grid.setFindHighlight).mock.lastCall?.[0];
    expect(last?.query).toMatchObject({ ok: true, kind: 'text' });
    expect(last?.current).toEqual({ row: 0, col: 0 });
  });

  it('marks a match past the first 120 characters of its cell in the Find All row', () => {
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const grid = { reveal: vi.fn(), setFindHighlight: vi.fn(), refresh: vi.fn() } as unknown as Grid;
    state.addTab('data.csv', doc(`${'x'.repeat(200)} cat\n`), null);
    const findBar = new FindBar(state, commands, grid);
    document.body.append(findBar.element);
    findBar.open(false);
    const findInput = findBar.element.querySelector<HTMLInputElement>('input[type="text"]')!;
    findInput.value = 'cat';
    findInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);

    findBar.findAll();

    const mark = findBar.element.querySelector('.find-result .find-result-text mark.find-hit');
    expect(mark?.textContent).toBe('cat');
  });
});
