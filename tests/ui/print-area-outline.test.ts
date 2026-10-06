// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The print-area outline on the grid: drawn over the rendered part of the
 * area, open on an edge the rendered window cuts, and gone when no area is
 * set or the sheet is sorted.
 */
import { describe, expect, it } from 'vitest';
import { AppState } from '../../src/app/state';
import { setPrintArea } from '../../src/app/state/print-area';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { placePrintAreaOutline } from '../../src/ui/grid/print-area-outline';

/** A canvas holding cells for rows `from`–`to` and columns 0–3. */
function canvasWithRows(from: number, to: number): HTMLElement {
  const canvas = document.createElement('div');
  for (let row = from; row <= to; row++) {
    for (let col = 0; col < 4; col++) {
      const cell = document.createElement('div');
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      canvas.append(cell);
    }
  }
  return canvas;
}

function setup() {
  const state = new AppState();
  const tab = state.addTab('b.rsf', RsfDocument.empty('b.rsf', 50, 6), null);
  tab.readOnly = false;
  return { state, tab };
}

describe('placePrintAreaOutline', () => {
  it('outlines the area, leaving open the edges the rendered rows cut', () => {
    const { state, tab } = setup();
    const canvas = canvasWithRows(0, 9);
    placePrintAreaOutline(canvas, tab);
    expect(canvas.querySelector('.print-area-outline')).toBeNull();

    setPrintArea(state, tab, { top: 2, left: 1, bottom: 5, right: 2 });
    placePrintAreaOutline(canvas, tab);
    const whole = canvas.querySelector('.print-area-outline')!;
    expect([...whole.classList]).toEqual(['print-area-outline']);

    setPrintArea(state, tab, { top: 5, left: 0, bottom: 30, right: 5 });
    placePrintAreaOutline(canvas, tab);
    const cut = canvas.querySelectorAll('.print-area-outline');
    expect(cut).toHaveLength(1);
    expect([...cut[0].classList].sort()).toEqual(['open-bottom', 'open-right', 'print-area-outline']);
  });

  it('draws nothing while the area is scrolled away or the sheet is sorted', () => {
    const { state, tab } = setup();
    setPrintArea(state, tab, { top: 20, left: 0, bottom: 30, right: 1 });
    const canvas = canvasWithRows(0, 9);
    placePrintAreaOutline(canvas, tab);
    expect(canvas.querySelector('.print-area-outline')).toBeNull();
    setPrintArea(state, tab, { top: 0, left: 0, bottom: 1, right: 1 });
    (tab.doc as RsfDocument).activeSheet.sort = {
      top: 0,
      left: 0,
      bottom: 49,
      right: 5,
      headerRow: false,
      keys: [],
    };
    placePrintAreaOutline(canvas, tab);
    expect(canvas.querySelector('.print-area-outline')).toBeNull();
  });
});
