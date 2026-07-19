// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  autoFitWidth,
  planAutoFit,
  AUTOFIT_SAMPLE_BUDGET,
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  type AutoFitInput,
} from '../src/ui/grid';

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
