// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import {
  autoFitWidth,
  planAutoFit,
  planAutoFitColumns,
  AUTOFIT_SAMPLE_BUDGET,
  Grid,
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  type AutoFitInput,
} from '../src/ui/grid';
import { doc } from './helpers';

describe('autoFitWidth (grow and shrink)', () => {
  it('expands to fit content wider than a narrow column', () => {
    // A column previously 60px wide with 200px of content fits to 200px.
    expect(autoFitWidth([200])).toBe(200);
  });

  it('shrinks to fit when content is narrower than the current width', () => {
    // A column previously 300px wide whose widest content is 80px shrinks.
    const fitted = autoFitWidth([80]);
    expect(fitted).toBe(80);
    expect(fitted).toBeLessThan(300);
  });

  it('takes the widest of all measured content (cells + header)', () => {
    expect(autoFitWidth([50, 120, 90])).toBe(120);
  });

  it('clamps to the minimum and maximum widths', () => {
    expect(autoFitWidth([10])).toBe(MIN_COL_WIDTH);
    expect(autoFitWidth([99999])).toBe(MAX_COL_WIDTH);
  });

  it('falls back to the minimum width when nothing was measured', () => {
    expect(autoFitWidth([])).toBe(MIN_COL_WIDTH);
  });
});

/**
 * Fake text measurer: CJK characters 16px wide, everything else 8px. This
 * exercises variable-width measurement (never character counts with a fixed
 * width — 'あああ' is wider than 'aaaa' despite fewer characters).
 */
function fakeMeasure(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e7f ? 16 : 8;
  }
  return w;
}

function input(
  partial: Partial<AutoFitInput> & Pick<AutoFitInput, 'rowCount' | 'getDisplayValue'>,
): AutoFitInput {
  return {
    header: 'A',
    visibleRows: Array.from({ length: Math.min(partial.rowCount, 20) }, (_, i) => i),
    measure: fakeMeasure,
    cellChrome: 18,
    headerChrome: 28,
    sampleBudget: AUTOFIT_SAMPLE_BUDGET,
    ...partial,
  };
}

describe('planAutoFit (measured displayed widths)', () => {
  it('expands a narrow column to fit the widest measured displayed value', () => {
    const values = ['short', 'a considerably longer value here', 'mid-length'];
    const plan = planAutoFit(input({ rowCount: 3, getDisplayValue: (r) => values[r] }));
    expect(plan.width).toBe(fakeMeasure(values[1]) + 18);
    expect(plan.sampled).toBe(false);
  });

  it('shrinks an overly wide column when the current content is shorter', () => {
    const plan = planAutoFit(input({ rowCount: 2, getDisplayValue: () => 'tiny' }));
    // Far below any previously-set 400px width; only current content counts.
    expect(plan.width).toBeLessThan(120);
    expect(plan.width).toBeGreaterThanOrEqual(MIN_COL_WIDTH);
  });

  it('measures Japanese text wider than the same count of Latin characters', () => {
    const ja = planAutoFit(input({ rowCount: 1, getDisplayValue: () => 'ああああああああああ' }));
    const latin = planAutoFit(input({ rowCount: 1, getDisplayValue: () => 'aaaaaaaaaa' }));
    expect(ja.width).toBeGreaterThan(latin.width);
  });

  it('includes the header in the measurement', () => {
    const plan = planAutoFit(
      input({
        rowCount: 1,
        getDisplayValue: () => 'x',
        header: 'EXTREMELY-WIDE-HEADER-LABEL',
        headerChrome: 28,
      }),
    );
    expect(plan.width).toBe(fakeMeasure('EXTREMELY-WIDE-HEADER-LABEL') + 28);
  });

  it('uses displayed formula results, not formula source text', () => {
    // The document reports the *display* value; a formula cell whose source
    // is long but whose result is short fits to the short result.
    const display = vi.fn(() => '42'); // =SUM(A1:A100) displays as 42
    const plan = planAutoFit(input({ rowCount: 1, getDisplayValue: display }));
    expect(plan.width).toBe(MIN_COL_WIDTH); // 2 chars + chrome clamps to min
    expect(display).toHaveBeenCalled();
  });

  it('a different measurer (font change) produces a different width', () => {
    const narrow = planAutoFit(input({ rowCount: 1, getDisplayValue: () => 'some cell content here' }));
    const wide = planAutoFit(
      input({
        rowCount: 1,
        getDisplayValue: () => 'some cell content here',
        measure: (t) => fakeMeasure(t) * 2,
      }),
    );
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it('clamps to min and max widths', () => {
    expect(planAutoFit(input({ rowCount: 1, getDisplayValue: () => '' })).width).toBe(MIN_COL_WIDTH);
    expect(planAutoFit(input({ rowCount: 1, getDisplayValue: () => 'w'.repeat(100_000) })).width).toBe(
      MAX_COL_WIDTH,
    );
  });

  it('samples large columns within the budget and reports it honestly', () => {
    const calls: number[] = [];
    const plan = planAutoFit(
      input({
        rowCount: 1_000_000,
        getDisplayValue: (r) => {
          calls.push(r);
          return 'v';
        },
        visibleRows: [0, 1, 2, 3, 4],
      }),
    );
    expect(plan.sampled).toBe(true);
    expect(plan.measuredRows).toBeLessThanOrEqual(AUTOFIT_SAMPLE_BUDGET + 5);
    // The operation touched only the sampled rows — never the whole column.
    expect(calls.length).toBe(plan.measuredRows);
    // The sample is spread across the column, not clustered at the top.
    expect(Math.max(...calls)).toBeGreaterThan(900_000);
  });

  it('a sampled result can still shrink (no stale historic maximum)', () => {
    const rowCount = 100_000;
    const wide = planAutoFit(input({ rowCount, getDisplayValue: () => 'a very very wide historic value' }));
    // Content later became short — replanning shrinks despite sampling.
    const narrow = planAutoFit(input({ rowCount, getDisplayValue: () => 'v' }));
    expect(narrow.width).toBeLessThan(wide.width);
    expect(narrow.sampled).toBe(true);
  });

  it('measures all visible rows even beyond the sample budget', () => {
    const seen = new Set<number>();
    planAutoFit(
      input({
        rowCount: 50_000,
        getDisplayValue: (r) => {
          seen.add(r);
          return 'v';
        },
        visibleRows: [49_990, 49_991, 49_992],
      }),
    );
    expect(seen.has(49_990)).toBe(true);
    expect(seen.has(49_991)).toBe(true);
    expect(seen.has(49_992)).toBe(true);
  });
});

describe('planAutoFitColumns (multi-column auto-fit)', () => {
  const columnValues: Record<number, string> = {
    0: 'a considerably longer value in column A',
    1: 'w',
    2: 'medium text col C',
  };

  function makeInput(col: number): AutoFitInput {
    return input({ rowCount: 3, getDisplayValue: () => columnValues[col] });
  }

  it('measures every selected column independently (each grows or shrinks on its own)', async () => {
    const { plans, completed } = await planAutoFitColumns([0, 1, 2], makeInput);
    expect(completed).toBe(true);
    expect(plans.size).toBe(3);
    const w0 = plans.get(0)!.width;
    const w1 = plans.get(1)!.width;
    const w2 = plans.get(2)!.width;
    expect(w0).toBe(fakeMeasure(columnValues[0]) + 18);
    expect(w1).toBe(MIN_COL_WIDTH); // shrinks to the minimum independently
    expect(w2).toBeGreaterThan(w1);
    expect(w0).toBeGreaterThan(w2);
  });

  it('supports non-adjacent column lists', async () => {
    const { plans } = await planAutoFitColumns([0, 2], makeInput);
    expect([...plans.keys()]).toEqual([0, 2]);
  });

  it('reports "N of M columns" progress while yielding between columns', async () => {
    const progress: Array<[number, number]> = [];
    const { completed } = await planAutoFitColumns([0, 1, 2], makeInput, {
      yieldBetween: true,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(completed).toBe(true);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
    ]);
  });

  it('cancellation abandons the run so partial widths are never applied', async () => {
    let calls = 0;
    const { plans, completed } = await planAutoFitColumns([0, 1, 2], makeInput, {
      yieldBetween: true,
      shouldStop: () => {
        calls += 1;
        return calls >= 2; // stop after the second column's yield
      },
    });
    expect(completed).toBe(false);
    expect(plans.size).toBeLessThan(3);
  });
});

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    chooseSettings: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

function gridSetup(csv: string) {
  document.body.textContent = '';
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  commands.gridActions = { autoFitSelectedColumns: () => grid.autoFitSelectedColumns() };
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('a.csv', doc(csv), null);
  grid.refresh();
  return { state, commands, grid, tab };
}

describe('auto-fit for all selected columns (grid integration)', () => {
  it('double-clicking a handle inside a whole-column selection fits every selected column', async () => {
    const { state, grid, tab } = gridSetup('a,b,c,d\ne,f,g,h\n');
    // Whole-column selection of columns 0..2 (as from column-header dragging).
    state.setSelection(tab, { row: 0, col: 2 }, { row: 1, col: 0 }, 'col');
    grid.element
      .querySelector<HTMLElement>('[data-colresize="1"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
    await Promise.resolve();
    // jsdom does no layout (scrollWidth 0), so every fitted column lands on
    // the minimum — the point is that all three selected columns were fitted.
    expect(tab.colWidths[0]).toBe(MIN_COL_WIDTH);
    expect(tab.colWidths[1]).toBe(MIN_COL_WIDTH);
    expect(tab.colWidths[2]).toBe(MIN_COL_WIDTH);
    expect(tab.colWidths[3]).toBeUndefined(); // outside the selection: untouched
  });

  it('double-clicking a handle outside the selection fits only that column', async () => {
    const { state, grid, tab } = gridSetup('a,b,c\nd,e,f\n');
    state.setSelection(tab, { row: 0, col: 1 }, { row: 1, col: 0 }, 'col');
    grid.element
      .querySelector<HTMLElement>('[data-colresize="2"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
    await Promise.resolve();
    expect(tab.colWidths[2]).toBe(MIN_COL_WIDTH);
    expect(tab.colWidths[0]).toBeUndefined();
    expect(tab.colWidths[1]).toBeUndefined();
  });

  it('the Sheet > Auto-Fit Column Width command fits the selected columns', async () => {
    const { state, commands, tab } = gridSetup('a,b,c\nd,e,f\n');
    state.setSelection(tab, { row: 1, col: 2 }, { row: 0, col: 1 });
    expect(commands.isEnabled('sheet.autoFitCols')).toBe(true);
    await commands.run('sheet.autoFitCols');
    expect(tab.colWidths[1]).toBe(MIN_COL_WIDTH);
    expect(tab.colWidths[2]).toBe(MIN_COL_WIDTH);
    expect(tab.colWidths[0]).toBeUndefined();
  });

  it('auto-fit never modifies the CSV document or its undo history', async () => {
    const { state, commands, tab } = gridSetup('a,b\nc,d\n');
    state.setSelection(tab, { row: 1, col: 1 }, { row: 0, col: 0 });
    await commands.run('sheet.autoFitCols');
    expect(tab.doc.isDirty).toBe(false);
    expect(tab.history.canUndo).toBe(false);
  });
});
