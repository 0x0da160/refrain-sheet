// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Vertical centering of grid text. jsdom performs no layout and vitest stubs
 * CSS imports, so the typography *model* is asserted two ways: the stylesheet
 * source must implement line-height centering (font-independent — never
 * baseline metrics), and the DOM must apply the row-height geometry the model
 * depends on, for Japanese and Latin content alike.
 */
// `fs` is declared ambiently in tests/node-shims.d.ts (no @types/node needed).
import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { SHEET_FONTS } from '../src/app/sheet-font';
import { Grid, ROW_HEIGHT, WRAP_LINE_HEIGHT } from '../src/ui/grid';
import { doc } from './helpers';

const css = readFileSync('src/styles.css', 'utf8');

/** The declaration block for a CSS rule whose selector list starts a line. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `missing rule for ${selector}`).not.toBeNull();
  return match![1];
}

describe('grid typography model (stylesheet)', () => {
  it('defines the row-height variable in sync with the ROW_HEIGHT constant', () => {
    expect(css).toContain(`--grid-row-height: ${ROW_HEIGHT}px`);
    // The single-line box is the cell content height: row height minus the
    // 1px bottom border — that is what centers the text.
    expect(css).toContain('--grid-cell-line: calc(var(--grid-row-height) - 1px)');
  });

  it('cells center single-line text via line-height, with no vertical padding', () => {
    const body = ruleBody('.vcell');
    expect(body).toMatch(/line-height:\s*var\(--grid-cell-line\)/);
    // Horizontal padding only — vertical space is owned by the line box.
    expect(body).toMatch(/padding:\s*0 8px/);
  });

  it('uses border-box sizing everywhere (no baseline-dependent box math)', () => {
    expect(ruleBody('* ')).toMatch(/box-sizing:\s*border-box/);
  });

  it('only rows measured as wrapped switch to the multi-line centering box', () => {
    // Conditional wrapping: the multi-line box is keyed to `.vgrid-row.wrapped`
    // data cells (rows the grid measured as needing >1 visual line), never to a
    // global wrap-mode class that would grow every row. It stays vertically
    // centered (flex) and uses the wrap line box, in sync with WRAP_LINE_HEIGHT.
    const body = ruleBody('.vgrid-row.wrapped .vcell[data-col]');
    expect(body).toMatch(/white-space:\s*pre-wrap/);
    expect(body).toMatch(/overflow-wrap:\s*break-word/);
    expect(body).toMatch(/align-items:\s*center/);
    expect(body).toMatch(/line-height:\s*var\(--grid-wrap-line\)/);
    expect(css).toContain(`--grid-wrap-line: ${WRAP_LINE_HEIGHT}px`);
  });

  it('the centering is font-independent: no sheet font gets its own line-height', () => {
    // Every supported font is expressed only through the --sheet-font-*
    // variables; no rule may pair a font-family override with a line-height.
    for (const id of SHEET_FONTS) {
      expect(css).toContain(`--sheet-font-${id}`);
    }
    const fontRules = css.match(/[^{}]*font-family:[^}]*}/g) ?? [];
    for (const rule of fontRules) {
      expect(rule, `font-family rule must not set its own line-height: ${rule}`).not.toMatch(/line-height/);
    }
  });
});

const noopUi: UiPort = {
  confirmValidation: async () => true,
  confirmUnsaved: async () => 'discard',
  chooseSaveOptions: async () => null,
  confirmUnrepresentable: async () => false,
  notifyNcr: async () => undefined,
  confirmUndecodableEdit: async () => true,
  chooseReopen: async () => null,
  confirmConvert: async () => true,
  explainRcsvSave: async () => true,
  chooseRcsvSave: async () => 2,
  chooseExportCsv: async () => null,
  chooseInsertShift: async () => null,
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

beforeEach(() => {
  document.body.textContent = '';
});

function setup(csv: string) {
  const state = new AppState();
  const commands = new Commands(state, noopUi, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('t.csv', doc(csv), null);
  grid.refresh();
  return { state, grid, tab };
}

describe('grid typography model (DOM geometry)', () => {
  it('every rendered row (header, sticky, data) is exactly ROW_HEIGHT tall', () => {
    const { grid } = setup('見出し,header\n日本語テキスト,latin text\n12345,=SUM(1)\n');
    for (const rowEl of grid.element.querySelectorAll<HTMLElement>('.vgrid-row')) {
      expect(rowEl.style.height).toBe(`${ROW_HEIGHT}px`);
    }
    expect(grid.element.querySelector<HTMLElement>('.vgrid-header')!.style.height).toBe(`${ROW_HEIGHT}px`);
  });

  it('Japanese, Latin, and numeric values render as plain text with no per-cell alignment styles', () => {
    const { grid } = setup('日本語,latin,42\n');
    const cells = grid.element.querySelectorAll<HTMLElement>('[data-row][data-col]');
    expect(cells.length).toBeGreaterThanOrEqual(3);
    for (const cell of cells) {
      // Alignment comes from the shared stylesheet model, never from inline
      // per-cell vertical tweaks that could drift between scripts or fonts.
      expect(cell.style.lineHeight).toBe('');
      expect(cell.style.paddingTop).toBe('');
      expect(cell.style.verticalAlign).toBe('');
    }
    expect(cells[0].textContent).toBe('日本語');
    expect(cells[1].textContent).toBe('latin');
  });

  it('selection outline and fill handle attach to the same cell box after the typography change', () => {
    const { state, grid, tab } = setup('a,b\nc,d\n');
    state.setSelection(tab, { row: 1, col: 1 }, { row: 0, col: 0 });
    grid.refreshSelection();
    const active = grid.element.querySelector<HTMLElement>('[data-row="1"][data-col="1"]')!;
    expect(active.classList.contains('selected')).toBe(true);
    // The fill handle sits inside the selection's bottom-right cell.
    expect(active.querySelector('.fill-handle')).not.toBeNull();
  });
});
