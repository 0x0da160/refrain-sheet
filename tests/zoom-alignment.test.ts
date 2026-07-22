// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Vertical alignment across spreadsheet zoom levels. The single sizing model
 * derives every row's height from ROW_HEIGHT × zoom and exposes it through the
 * inline --grid-row-height variable that the cell line box tracks, so text
 * stays centered at 50–200% for any sheet font and for wrapped/multiline rows.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { setSheetFont, SHEET_FONTS } from '../src/app/sheet-font';
import { rowHeightForLines } from '../src/core/text-wrap';
import { RsfDocument } from '../src/core/rsf-document';
import { Grid, ROW_HEIGHT, WRAP_LINE_HEIGHT, WRAP_VERTICAL_PAD } from '../src/ui/grid';

const ZOOMS = [50, 75, 90, 100, 125, 150, 200] as const;

function stubUi(): UiPort {
  return {
    confirmValidation: async () => true,
    confirmUnsaved: async () => 'discard',
    chooseSaveOptions: async () => null,
    confirmUnrepresentable: async () => false,
    notifyNcr: async () => undefined,
    confirmUndecodableEdit: async () => true,
    chooseReopen: async () => null,
    confirmConvert: async () => true,
    explainRsfSave: async () => true,
    chooseRsfSave: async () => 2,
    chooseExportCsv: async () => null,
    chooseInsertShift: async () => null,
    confirmFlashFill: async () => false,
    chooseFilter: async () => null,
    promptSheetName: async () => null,
    confirmDeleteSheet: async () => true,
    chooseExportSheet: async () => null,
    confirm: async () => true,
    showMessage: async () => undefined,
    notify: () => undefined,
    openFindBar: () => undefined,
    findNext: () => undefined,
    showAbout: () => undefined,
    showFormulaHelp: () => undefined,
    chooseSettings: async () => null,
    setBusy: () => undefined,
  };
}

function setup() {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 600, configurable: true });
  document.body.append(grid.element);
  const doc = RsfDocument.empty('t.rsf', 20, 4);
  doc.setCell(0, 0, '日本語');
  doc.setCell(0, 1, 'latin');
  doc.setCell(0, 2, '42');
  const tab = state.addTab('t.rsf', doc, null);
  grid.refresh();
  return { state, grid, tab };
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('single-line geometry scales with zoom for every font', () => {
  for (const font of SHEET_FONTS) {
    for (const zoom of ZOOMS) {
      it(`row height = round(ROW_HEIGHT × ${zoom}%) with font ${font}`, () => {
        setSheetFont(font);
        const { state, grid, tab } = setup();
        state.setTabZoom(tab, zoom);
        grid.refresh();
        const expected = Math.round(ROW_HEIGHT * (zoom / 100));
        for (const rowEl of grid.element.querySelectorAll<HTMLElement>('.vgrid-row')) {
          expect(rowEl.style.height).toBe(`${expected}px`);
        }
        const header = grid.element.querySelector<HTMLElement>('.vgrid-header')!;
        expect(header.style.height).toBe(`${expected}px`);
        // The inline variables the CSS line box tracks are set from the same
        // scaled value, so the line box and element height cannot diverge.
        expect(grid.element.style.getPropertyValue('--grid-row-height')).toBe(`${expected}px`);
        expect(grid.element.style.getPropertyValue('--sheet-zoom')).toBe(String(zoom / 100));
      });
    }
  }
});

describe('wrapped rows scale with zoom too', () => {
  for (const zoom of [50, 100, 150, 200] as const) {
    it(`a wrapped row uses the zoom-scaled wrap geometry at ${zoom}%`, () => {
      const { state, grid, tab } = setup();
      // Deterministic measurer that forces the long value to wrap regardless of
      // the (absent) canvas metrics.
      state.wrapCells = true;
      grid.setTextMeasurer((text: string) => text.length * 40);
      const rsf = tab.doc as RsfDocument;
      rsf.setCell(1, 0, 'a very long wrapping value that needs several visual lines here');
      state.setTabZoom(tab, zoom);
      grid.refresh();
      const z = zoom / 100;
      const rowEl = grid.element.querySelector<HTMLElement>('.vgrid-row[data-row="1"]');
      expect(rowEl).not.toBeNull();
      const height = Number.parseInt(rowEl!.style.height, 10);
      const single = Math.round(ROW_HEIGHT * z);
      const lineH = Math.round(WRAP_LINE_HEIGHT * z);
      const pad = Math.round(WRAP_VERTICAL_PAD * z);
      // A wrapped row is taller than a single line and is exactly the vertical
      // chrome plus a whole number of zoom-scaled line boxes — no fixed
      // 100%-only pixel offset survives at other zooms.
      expect(height).toBeGreaterThan(single);
      const lines = (height - pad) / lineH;
      expect(Number.isInteger(lines)).toBe(true);
      expect(lines).toBeGreaterThanOrEqual(2);
      expect(height).toBe(rowHeightForLines(lines, single, lineH, pad));
    });
  }
});
