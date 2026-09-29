// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * File > Print…: the print-only layer built for the browser's print — the
 * displayed values and formatting, the active sheet as shown (sort and
 * filter), every sheet of a file, page runs, and refusals.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../../src/app/i18n';
import { AppState } from '../../src/app/state';
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from '../../src/core/print-layout';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { openPrintPanel } from '../../src/ui/dialogs/print-dialog';
import { printTab } from '../../src/ui/print-view';
import { doc as csvDoc } from '../helpers';

/** A window whose print() records the layer as it stands, then fires afterprint. */
function fakeWindow(): { win: Window; printed: string[][][]; titles: string[][] } {
  const printed: string[][][] = [];
  const titles: string[][] = [];
  const win = {
    document,
    onafterprint: null,
    addEventListener: (type: string, fn: () => void) => window.addEventListener(type, fn),
    removeEventListener: (type: string, fn: () => void) => window.removeEventListener(type, fn),
    print: () => {
      const root = document.querySelector('.print-root');
      titles.push(
        Array.from(root?.querySelectorAll('.print-sheet-title') ?? []).map((h) => h.textContent ?? ''),
      );
      for (const table of root?.querySelectorAll('.print-table') ?? []) {
        printed.push(
          Array.from(table.querySelectorAll('tr')).map((tr) =>
            Array.from(tr.children).map((cell) => cell.textContent ?? ''),
          ),
        );
      }
      window.dispatchEvent(new Event('afterprint'));
    },
  } as unknown as Window;
  return { win, printed, titles };
}

const settings = (patch: Partial<PrintSettings> = {}): PrintSettings => ({
  ...DEFAULT_PRINT_SETTINGS,
  ...patch,
});

afterEach(() => {
  document.body.textContent = '';
});

function book(values: string[][]) {
  const state = new AppState();
  const doc = RsfDocument.empty('b.rsf', 6, 4, 'Sheet1');
  values.forEach((row, r) => row.forEach((v, c) => doc.setCell(r, c, v)));
  const tab = state.addTab('b.rsf', doc, null);
  return { state, doc, tab };
}

describe('printTab', () => {
  it('prints the used cells with their displayed values, then removes the layer', () => {
    const { state, tab } = book([
      ['Item', 'Qty'],
      ['a', '=1+2'],
    ]);
    const { win, printed } = fakeWindow();
    expect(printTab(state, tab, settings(), win)).toBeNull();
    expect(printed).toEqual([
      [
        ['Item', 'Qty'],
        ['a', '3'],
      ],
    ]);
    expect(document.querySelector('.print-root')).toBeNull();
  });

  it('adds headings, repeats the first row in each page run, and breaks every n rows', () => {
    const { state, tab } = book([['h'], ['1'], ['2'], ['3'], ['4']]);
    const { win, printed } = fakeWindow();
    printTab(state, tab, settings({ headings: true, repeatFirstRow: true, rowsPerPage: 3 }), win);
    expect(printed).toEqual([
      [
        ['', 'A'],
        ['1', 'h'],
        ['2', '1'],
        ['3', '2'],
      ],
      [
        ['', 'A'],
        ['1', 'h'],
        ['4', '3'],
        ['5', '4'],
      ],
    ]);
  });

  it('prints the active sheet as shown: without rows its filter hides', () => {
    const { state, tab } = book([['k'], ['x'], ['y'], ['x']]);
    state.setFilter(tab, {
      top: 0,
      left: 0,
      bottom: 3,
      right: 0,
      headerRow: true,
      columns: [{ col: 0, join: 'and', conditions: [], values: ['x'] }],
    } as never);
    const { win, printed } = fakeWindow();
    printTab(state, tab, settings(), win);
    expect(printed[0].map((r) => r[0])).toEqual(['k', 'x', 'x']);
  });

  it('prints only the selected cells for Selected cells', () => {
    const { state, tab } = book([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    state.setSelection(tab, { row: 0, col: 1 }, { row: 1, col: 2 });
    const { win, printed } = fakeWindow();
    printTab(state, tab, settings({ scope: 'selection' }), win);
    expect(printed).toEqual([
      [
        ['b', 'c'],
        ['e', 'f'],
      ],
    ]);
  });

  it('prints every sheet of the file with its name, and a Markdown sheet as text', () => {
    const { state, doc, tab } = book([['one']]);
    const second = state.addMarkdownSheet(tab, 'Notes');
    second?.setCell(0, 0, '# Title\n\nBody');
    state.setActiveSheet(tab, doc.sheets[0].id);
    const { win, printed, titles } = fakeWindow();
    printTab(state, tab, settings({ scope: 'file' }), win);
    expect(titles[0]).toEqual(['Sheet1', 'Notes']);
    expect(printed).toEqual([[['one']]]);
  });

  it('keeps cell formatting', () => {
    const { state, doc, tab } = book([['bold']]);
    doc.setCellStyleOn(undefined, 0, 0, { bold: true, backgroundColor: '#ffee00' });
    let cell: HTMLElement | null = null;
    const { win } = fakeWindow();
    const print = win.print;
    win.print = () => {
      cell = document.querySelector('.print-table td');
      print();
    };
    printTab(state, tab, settings(), win);
    expect(cell!.classList.contains('cell-bold')).toBe(true);
    expect(cell!.style.backgroundColor).toBe('rgb(255, 238, 0)');
  });

  it('prints a CSV document', () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', csvDoc('x,y\n1,2\n'), null);
    const { win, printed } = fakeWindow();
    printTab(state, tab, settings(), win);
    expect(printed[0]).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('refuses an empty sheet and a print that is too large', () => {
    const { state, tab } = book([]);
    const { win } = fakeWindow();
    const print = vi.spyOn(win, 'print');
    expect(printTab(state, tab, settings(), win)).toBe('empty');
    const big = new AppState();
    const doc = RsfDocument.empty('big.rsf', 1000, 300, 'Sheet1');
    doc.setCell(999, 299, 'x');
    const bigTab = big.addTab('big.rsf', doc, null);
    expect(printTab(big, bigTab, settings(), win)).toBe('tooLarge');
    expect(print).not.toHaveBeenCalled();
  });
});

describe('the print panel', () => {
  it('prints with the chosen settings and stays open; a bad scale disables Print', () => {
    setLocale('en');
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
    const onPrint = vi.fn();
    void openPrintPanel({ settings: DEFAULT_PRINT_SETTINGS, canPrintFile: false }, onPrint);
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    const options = Array.from(panel.querySelectorAll('option')).map((o) => o.value);
    expect(options).not.toContain('file');
    const fit = Array.from(panel.querySelectorAll('label'))
      .find((l) => l.textContent === t('dialog.print.fitWidth'))!
      .querySelector('input')!;
    fit.click();
    const scale = panel.querySelector<HTMLInputElement>('input[type="number"][max="400"]')!;
    const print = Array.from(panel.querySelectorAll('button')).find(
      (b) => b.textContent === t('dialog.print.print'),
    )!;
    scale.value = '5';
    scale.dispatchEvent(new Event('input'));
    expect(print.disabled).toBe(true);
    scale.value = '150';
    scale.dispatchEvent(new Event('input'));
    print.click();
    expect(onPrint).toHaveBeenCalledWith({ ...DEFAULT_PRINT_SETTINGS, scale: 150 });
    expect(document.querySelector('.side-panel')).not.toBeNull();
    vi.unstubAllGlobals();
  });
});
