// SPDX-License-Identifier: MIT
/**
 * The measuring half of column auto-fit: read the rendered cells' font and box
 * metrics and plan each column's width ({@link planAutoFitColumns}). Applying
 * the widths stays with the `Grid` class (`./index.ts`).
 */
import { t } from '../../app/i18n';
import { LARGE_OP_CELLS } from '../../app/commands';
import { columnLabel } from '../../core/formula';
import type { Tab } from '../../app/state';
import {
  autoFitWidth,
  planAutoFitColumns,
  AUTOFIT_SAMPLE_BUDGET,
  type AutoFitInput,
  type AutoFitResult,
  type MultiAutoFitResult,
} from './autofit';
import { createTextMeasurer } from './dom-support';

export interface AutoFitMeasureOptions {
  /** The grid's rendered cell layer (cells carry `data-row` / `data-col`). */
  canvas: HTMLElement;
  /** The column header row (`data-colhead` cells). */
  header: HTMLElement;
  doc: Tab['doc'];
  cols: number[];
  /** Shows (or, with `null`, clears) the busy label for a large job. */
  setBusy: (label: string | null, pct?: number) => void;
  /** True once the result would no longer apply (the tab or document changed). */
  shouldStop: () => boolean;
}

/**
 * Plan fitted widths for `cols`. Large jobs (many columns × many sampled rows)
 * run column-by-column with yields to the browser and a "N of M columns" +
 * percentage busy label. Without a 2D canvas context (e.g. jsdom) the
 * rendered cells' DOM `scrollWidth` is measured instead (visible rows only),
 * and that result is returned synchronously — not as a promise — so the
 * caller applies it in the same task, exactly as before this was split out.
 */
export function measureAutoFitColumns({
  canvas,
  header,
  doc,
  cols,
  setBusy,
  shouldStop,
}: AutoFitMeasureOptions): MultiAutoFitResult | Promise<MultiAutoFitResult> {
  const sampleCell = canvas.querySelector<HTMLElement>('.vcell[data-row][data-col]');
  const measure = sampleCell ? createTextMeasurer(sampleCell) : null;

  if (measure && sampleCell) {
    const cs = getComputedStyle(sampleCell);
    const px = (v: string): number => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    // +2px keeps content clear of the ellipsis threshold.
    const cellChrome =
      px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth) + 2;
    const makeInput = (col: number): AutoFitInput => {
      const visibleRows: number[] = [];
      for (const cell of canvas.querySelectorAll<HTMLElement>(`.vcell[data-row][data-col="${col}"]`)) {
        visibleRows.push(Number(cell.dataset.row));
      }
      return {
        rowCount: doc.rowCount,
        header: columnLabel(col),
        getDisplayValue: (r) => doc.getDisplayValue(r, col),
        visibleRows,
        measure,
        cellChrome,
        headerChrome: cellChrome + 10, // the header also holds the resize handle
        sampleBudget: AUTOFIT_SAMPLE_BUDGET,
      };
    };
    // Progress + yielding only for genuinely large jobs (measured cells
    // across all columns beyond the large-operation threshold).
    const heavy =
      cols.length > 1 && cols.length * Math.min(doc.rowCount, AUTOFIT_SAMPLE_BUDGET) > LARGE_OP_CELLS;
    if (heavy) {
      setBusy(t('loading.autoFitCols', { done: 0, total: cols.length, pct: 0 }), 0);
    }
    const planned = planAutoFitColumns(cols, makeInput, {
      yieldBetween: heavy,
      onProgress: (done, total) => {
        const pct = Math.floor((done / total) * 100);
        setBusy(t('loading.autoFitCols', { done, total, pct }), pct);
      },
      shouldStop,
    });
    return heavy ? planned.finally(() => setBusy(null)) : planned;
  } else {
    // Fallback without a 2D canvas context (e.g. jsdom): measure the
    // rendered cells' DOM scrollWidth per column (visible rows only).
    const plans = new Map<number, AutoFitResult>();
    for (const col of cols) {
      const widths: number[] = [];
      let measuredRows = 0;
      for (const cell of canvas.querySelectorAll<HTMLElement>(`.vcell[data-col="${col}"]`)) {
        widths.push(cell.scrollWidth + 2);
        measuredRows += 1;
      }
      const head = header.querySelector<HTMLElement>(`[data-colhead="${col}"]`);
      if (head) {
        widths.push(head.scrollWidth + 10);
      }
      plans.set(col, {
        width: autoFitWidth(widths),
        measuredRows,
        sampled: measuredRows < doc.rowCount,
      });
    }
    return { plans, completed: true };
  }
}
