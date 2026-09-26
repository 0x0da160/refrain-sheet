// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Vertical centering of grid text. jsdom performs no layout and vitest stubs
 * CSS imports, so the typography *model* is asserted two ways: the stylesheet
 * source must implement line-height centering (font-independent — never
 * baseline metrics), and the DOM must apply the row-height geometry the model
 * depends on, for Japanese and Latin content alike.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { SHEET_FONTS } from '../src/app/sheet-font';
import { Grid, ROW_HEIGHT, WRAP_LINE_HEIGHT } from '../src/ui/grid';
import { doc, readBundledCss } from './helpers';

const css = readBundledCss();

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
  });

  it('cells pad 6px/3px (zoom-scaled) and center single-line text via a zoom-tracking line box', () => {
    const body = ruleBody('.vcell');
    // The line box is derived from the *inherited* --grid-row-height (the
    // grid sets the zoom-scaled value inline on the container), so it tracks
    // the row height at every zoom level instead of freezing at 100%. This is
    // the fix for text being mis-centered at non-100% zoom: the previous model
    // derived the line box once at :root, using the un-zoomed value.
    // It fills exactly the content height: row height - 1px grid line - the
    // 3px + 3px vertical padding (17px at 100%).
    expect(body).toMatch(
      /line-height:\s*calc\(var\(--grid-row-height\) - 1px - 6px \* var\(--sheet-zoom, 1\)\)/,
    );
    // The variable is NOT resolved at :root (which would freeze it at 100%).
    expect(css).not.toContain('--grid-cell-line');
    // 3px top/bottom and 6px left/right at 100%, both scaled with the zoom.
    expect(body).toMatch(
      /padding:\s*calc\(3px \* var\(--sheet-zoom, 1\)\) calc\(6px \* var\(--sheet-zoom, 1\)\)/,
    );
  });

  it('draws a single shared 1px grid line per cell (right + bottom only, inside the box)', () => {
    const body = ruleBody('.vcell');
    expect(body).toMatch(/border-right:\s*1px solid var\(--canvas-grid\)/);
    expect(body).toMatch(/border-bottom:\s*1px solid var\(--canvas-grid\)/);
    // A left/top border would double every line between neighbours.
    expect(body).not.toMatch(/border-(left|top)\s*:/);
    expect(body).not.toMatch(/(^|[^-])border\s*:/);
  });

  it('the cell editor lines its text up with the rendered cell text at every zoom', () => {
    const body = ruleBody('.vgrid-canvas .grid-sink.cell-editor');
    // Its 2px border replaces the first 2px of the cell padding …
    expect(body).toMatch(/border:\s*2px solid/);
    expect(body).toMatch(
      /padding:\s*max\(0px, calc\(3px \* var\(--sheet-zoom, 1\) - 2px\)\) max\(0px, calc\(6px \* var\(--sheet-zoom, 1\) - 2px\)\)/,
    );
    // … and its line box is the cell's single-line box, so an IME
    // composition does not jump when it is committed.
    expect(body).toMatch(
      /line-height:\s*calc\(var\(--grid-row-height\) - 1px - 6px \* var\(--sheet-zoom, 1\)\)/,
    );
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
  promptDriveName: async () => null,
  confirmUnrepresentable: async () => false,
  notifyNcr: async () => undefined,
  confirmUndecodableEdit: async () => true,
  chooseReopen: async () => null,
  confirmConvert: async () => true,
  explainRsfSave: async () => true,
  chooseExportCsv: async () => null,
  confirmExportXlsx: async () => true,
  confirmExportJson: async () => true,
  chooseInsertShift: async () => null,
  confirmFlashFill: async () => false,
  chooseFilter: async () => null,
  chooseColumnMenu: async () => null,
  chooseSort: async () => null,
  chooseDataValidation: async () => null,
  chooseConditionalFormat: async () => null,
  chooseCellComment: async () => null,
  promptSheetName: async () => null,
  confirmDeleteSheet: async () => true,
  chooseExportSheet: async () => null,
  confirmReplaceAllWorkbook: async () => true,
  confirmRangeMoveOverwrite: async () => true,
  promptMoveTarget: async () => null,
  promptGoToCell: async () => null,
  confirm: async () => true,
  showMessage: async () => undefined,
  notify: () => undefined,
  openFindBar: () => undefined,
  findNext: () => undefined,
  showAbout: () => undefined,
  showFormulaHelp: () => undefined,
  showSqlQuery: vi.fn(async () => undefined),
  showDiff: vi.fn(async () => undefined),
  chooseSettings: async () => null,
  chooseTimezone: async () => null,
  chooseDisplayLanguage: async () => null,
  chooseVersionHistory: async () => null,
  confirmHistoryCapExceeded: async () => true,
  chooseTextColor: async () => null,
  chooseRichText: async () => null,
  chooseBackgroundColor: async () => null,
  chooseBorders: async () => null,
  chooseNumberFormat: async () => null,
  chooseRecentFile: async () => null,
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
