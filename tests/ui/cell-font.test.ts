// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * A cell's own font and size, and those of parts of its text: the style
 * model, the `.rsf` round trip (and that malformed values are refused),
 * Format > Font… with undo, the toolbar over selected text, and painting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type FontDialogResult, type UiPort } from '../../src/app/commands';
import { applyCellStylePatch } from '../../src/core/workbook/cell-style';
import { normalizeFontFamily, normalizeFontSize } from '../../src/core/workbook/text-font';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { t } from '../../src/app/i18n';
import { Grid } from '../../src/ui/grid';
import { fontFamilyCss, fontSizeCss } from '../../src/ui/font-choices';
import { chooseFont } from '../../src/ui/dialogs/font';
import { rsfFromTree, rsfTree } from '../rsf-single-sheet';

function setup(value = 'Hello world', chooseFontResult: FontDialogResult | null = null) {
  const state = new AppState();
  // Every dialog resolves as cancelled, except Format > Font…'s.
  const fakes = new Map<string | symbol, unknown>([['chooseFont', vi.fn(async () => chooseFontResult)]]);
  const ui = new Proxy({} as UiPort, {
    get: (_target, key) => {
      if (!fakes.has(key)) {
        fakes.set(
          key,
          vi.fn(async () => null),
        );
      }
      return fakes.get(key);
    },
  });
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
  return { state, grid, commands, tab, doc };
}

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('cell fonts: the model', () => {
  it('accepts half points from 6 to 96 and plain family names only', () => {
    expect([6, 10.5, 96].map(normalizeFontSize)).toEqual([6, 10.5, 96]);
    expect([5.5, 97, 10.25, Number.NaN].map(normalizeFontSize)).toEqual([null, null, null, null]);
    expect(normalizeFontFamily('  Meiryo UI ')).toBe('Meiryo UI');
    for (const bad of ['', '   ', 'a"b', 'a\\b', 'a\nb', 'x'.repeat(101)]) {
      expect(normalizeFontFamily(bad)).toBeNull();
    }
  });

  it('a font set on the whole cell replaces the parts’ own', () => {
    const style = applyCellStylePatch(null, {
      runs: [
        { text: 'ab', fontSize: 20 },
        { text: 'c', fontFamily: 'Arial', bold: true },
      ],
    });
    expect(applyCellStylePatch(style, { fontSize: 14 })).toEqual({
      fontSize: 14,
      runs: [{ text: 'ab' }, { text: 'c', fontFamily: 'Arial', bold: true }],
    });
    expect(
      applyCellStylePatch({ fontFamily: 'Arial', fontSize: 12 }, { fontFamily: null, fontSize: null }),
    ).toBeNull();
  });

  it('paints the stored font with the sheet font behind it', () => {
    expect(fontFamilyCss('Arial')).toBe('"Arial", var(--font-sheet)');
    expect(fontFamilyCss('MS Gothic')).toBe('var(--sheet-font-ms), var(--font-sheet)');
    expect(fontSizeCss(12)).toBe('calc(12pt * var(--sheet-zoom, 1))');
  });
});

describe('cell fonts: the .rsf file', () => {
  it('round-trips a cell font and a part’s font, keeping a font this device lacks', () => {
    const doc = RsfDocument.empty('t.rsf', 1, 1);
    doc.setCell(0, 0, 'Hello world');
    const style = {
      fontFamily: 'Some Font Not Installed',
      fontSize: 10.5,
      runs: [{ text: 'Hello ' }, { text: 'world', fontFamily: 'Courier New', fontSize: 18 }],
    };
    doc.setCellStyleOn(undefined, 0, 0, style);
    const tree = rsfTree(doc.toBytes()) as { sheets: Array<{ styles: Record<string, unknown> }> };
    expect(tree.sheets[0].styles.A1).toEqual(style);
    const loaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(loaded.ok && loaded.doc.getStyle(0, 0)).toEqual(style);
  });

  it('refuses a malformed font or size', () => {
    const file = (a1: unknown) =>
      rsfFromTree({
        format: 'refrain-sheet',
        version: 1,
        sheets: [{ id: 's1', name: 'Sheet1', rows: 1, cols: 1, cells: [['ab']], styles: { A1: a1 } }],
      });
    for (const style of [
      { fontFamily: '' },
      { fontFamily: 'a"b' },
      { fontFamily: 12 },
      { fontSize: 5 },
      { fontSize: 11.3 },
      { fontSize: '12' },
      { runs: [{ text: 'ab', fontSize: 200 }] },
      { runs: [{ text: 'ab', fontFamily: '' }] },
    ]) {
      const result = RsfDocument.fromBytes(file(style), 't.rsf');
      expect(result.ok ? 'ok' : result.error).toBe('bad-shape');
    }
  });
});

describe('cell fonts: Format > Font…', () => {
  it('applies the chosen font and size to the selection as one undoable step', async () => {
    const { state, commands, tab, doc } = setup('a', { fontFamily: 'Arial', fontSize: 14 });
    state.setSelection(tab, { row: 0, col: 0 }, { row: 1, col: 1 });
    expect(commands.isEnabled('format.font')).toBe(true);
    expect(await commands.promptFont(tab)).toBe(true);
    expect(doc.getStyle(1, 1)).toEqual({ fontFamily: 'Arial', fontSize: 14 });
    state.undo(tab);
    expect(doc.getStyle(0, 0)).toBeNull();
    expect(doc.getStyle(1, 1)).toBeNull();
  });

  it('Clear Formatting removes the font too', () => {
    const { state, commands, tab, doc } = setup();
    doc.setCellStyleOn(undefined, 0, 0, { fontFamily: 'Arial', fontSize: 14 });
    state.setSelection(tab, { row: 0, col: 0 }, { row: 0, col: 0 });
    commands.clearFormatting(tab);
    expect(doc.getStyle(0, 0)).toBeNull();
  });

  it('the panel starts from the current font and applies both lists', async () => {
    const onApply = vi.fn(() => true);
    void chooseFont({ fontFamily: 'Arial', fontSize: 12 }, onApply);
    const family = document.querySelector<HTMLSelectElement>('#format-font-family')!;
    const size = document.querySelector<HTMLSelectElement>('#format-font-size')!;
    expect(family.value).toBe('Arial');
    expect(size.value).toBe('12');
    family.value = 'Courier New';
    family.dispatchEvent(new Event('change'));
    size.value = '';
    size.dispatchEvent(new Event('change'));
    [...document.querySelectorAll<HTMLButtonElement>('.side-panel button')]
      .find((b) => b.textContent === t('dialog.font.apply'))!
      .click();
    expect(onApply).toHaveBeenCalledWith({ fontFamily: 'Courier New', fontSize: null });
  });

  it('lists a stored font this device does not offer under its own name', () => {
    void chooseFont({ fontFamily: 'Some Other Font', fontSize: null });
    const family = document.querySelector<HTMLSelectElement>('#format-font-family')!;
    expect(family.value).toBe('Some Other Font');
    expect(family.selectedOptions[0].textContent).toBe('Some Other Font');
  });
});

describe('cell fonts: painting and the toolbar', () => {
  it('paints the cell’s font and a part’s size', () => {
    const { grid, doc } = setup();
    doc.setCellStyleOn(undefined, 0, 0, {
      fontFamily: 'Arial',
      runs: [{ text: 'Hello ' }, { text: 'world', fontSize: 20 }],
    });
    grid.refresh();
    const cell = grid.element.querySelector<HTMLElement>('[data-row="0"][data-col="0"]')!;
    expect(cell.style.fontFamily).toContain('Arial');
    const spans = [...cell.querySelectorAll<HTMLElement>('.rich-run')];
    expect(spans[0].style.fontSize).toBe('');
    expect(spans[1].style.fontSize).toContain('20pt');
  });

  it('the toolbar sets the size of the selected text only', () => {
    const { grid, tab, doc } = setup();
    grid.openEditor(tab, 0, 0, null);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    input.setSelectionRange(6, 11);
    document.dispatchEvent(new Event('selectionchange'));
    const size = document.querySelector<HTMLSelectElement>(
      `.rich-text-toolbar select[aria-label="${t('richText.fontSize')}"]`,
    )!;
    expect(size.value).toBe('');
    size.value = '16';
    size.dispatchEvent(new Event('change'));
    grid.commitEditor();
    expect(doc.getStyle(0, 0)?.runs).toEqual([{ text: 'Hello ' }, { text: 'world', fontSize: 16 }]);
  });
});
