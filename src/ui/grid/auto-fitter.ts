// SPDX-License-Identifier: MIT
/**
 * Auto-fit column width from measured display values (see `autofit.ts` and
 * `autofit-measure.ts` for the planning and measurement).
 *
 * A collaborator of the grid (see `./core.ts`): it owns no state of its own
 * beyond what is declared here, and reaches shared grid state through
 * `this.core`.
 */
import type { Tab } from '../../app/state';
import { t } from '../../app/i18n';
import { columnLabel } from '../../core/formula';
import { MAX_COL_WIDTH, MIN_COL_WIDTH } from './geometry';
import { measureAutoFitColumns } from './autofit-measure';
import type { GridCore } from './core';

export class AutoFitter {
  constructor(private readonly core: GridCore) {}

  /**
   * Auto-fit a column to the *measured* pixel width of its displayed values
   * (header included) under the active sheet font. Measurement uses
   * `CanvasRenderingContext2D.measureText` configured from the computed style
   * of a rendered cell, so font family/size/weight/style and letter spacing
   * are exact; cell padding and borders are read from the computed style and
   * added separately. Formula cells contribute their calculated display
   * values, never their hidden formula source. The result can be narrower or
   * wider than the current width — auto-fit both grows and shrinks, and no
   * measurement is cached across invocations (so edits, recalculation, font,
   * or locale changes are always reflected).
   *
   * Large sheets: all materialized (visible + overscan) rows are measured
   * plus an evenly spaced sample of off-screen rows (values are read from the
   * document — nothing extra is rendered). When the fit is based on a sample
   * the user is told so.
   */
  /**
   * Sheet > Rows & Columns > Auto-Fit Column Width: fit every column
   * intersecting the current selection (whole-column selections, Select All,
   * or any cell range). Each column is measured independently, so columns
   * can shrink and grow on their own.
   */
  async autoFitSelectedColumns(): Promise<void> {
    const tab = this.core.state.activeTab;
    if (!tab) {
      return;
    }
    const range = this.core.state.selectedRange(tab);
    if (!range) {
      return;
    }
    const last = Math.max(0, tab.doc.columnCount - 1);
    const cols: number[] = [];
    for (let c = Math.max(0, range.left); c <= Math.min(range.right, last); c++) {
      cols.push(c);
    }
    await this.autoFitColumns(tab, cols);
  }

  /**
   * Auto-fit every column of `tab`, regardless of selection — used by the
   * "auto-fit on open" preference (see `getAutoFitOnOpen`) right after a file
   * finishes loading.
   */
  async autoFitAllColumns(tab: Tab): Promise<void> {
    const count = tab.doc.columnCount;
    if (count <= 0) {
      return;
    }
    const cols: number[] = [];
    for (let c = 0; c < count; c++) {
      cols.push(c);
    }
    await this.autoFitColumns(tab, cols);
  }

  /**
   * Auto-fit the given columns using the measured-displayed-width algorithm
   * (see `planAutoFit`) with each column's own header and values. Large
   * jobs (many columns × many sampled rows) run column-by-column with yields
   * to the browser, a "N of M columns" + percentage busy label, and abort
   * safety: if the tab or document changes mid-run, no width is applied at
   * all (widths change all-or-nothing, so a cancelled run leaves every column
   * untouched). Column widths are per-tab view state — never document
   * content — so auto-fit cannot modify CSV bytes and is not an undoable
   * document operation.
   */
  async autoFitColumns(tab: Tab, cols: number[]): Promise<void> {
    if (cols.length === 0) {
      return;
    }
    const doc = tab.doc;
    const planned = measureAutoFitColumns({
      canvas: this.core.canvas,
      header: this.core.headerEl,
      doc,
      cols,
      setBusy: (label, pct) => this.core.commands.setBusy(label, pct),
      shouldStop: () => this.core.state.activeTab !== tab || tab.doc !== doc,
    });
    // Only the canvas-measured plan is asynchronous; the DOM fallback is
    // applied in this same task (awaiting it would defer the new widths).
    const result = planned instanceof Promise ? await planned : planned;
    if (!result.completed || this.core.state.activeTab !== tab || tab.doc !== doc) {
      return; // aborted: apply nothing
    }
    // Apply every fitted width, then re-lay-out once. Measurements were taken
    // under the zoomed font, so normalize back to 100%-zoom storage units.
    let changed = false;
    for (const [col, plan] of result.plans) {
      const w = Math.max(
        MIN_COL_WIDTH,
        Math.min(MAX_COL_WIDTH, Math.round(plan.width / this.core.metrics.zoomOf(tab))),
      );
      if (tab.colWidths[col] !== w) {
        tab.colWidths[col] = w;
        changed = true;
      }
    }
    if (changed) {
      // New column widths change wrapping, so cached wrap heights are stale.
      this.core.renderer.invalidateRowHeights(tab);
      this.core.metrics.invalidateColOffsets(tab);
      this.core.window = null;
      this.core.renderer.render(tab);
    }
    const sampledPlans = [...result.plans.entries()].filter(([, plan]) => plan.sampled);
    if (sampledPlans.length === 1 && cols.length === 1) {
      const [col, plan] = sampledPlans[0];
      this.core.commands.notify(
        t('grid.autoFitSampled', { letter: columnLabel(col), n: plan.measuredRows }),
        'info',
      );
    } else if (sampledPlans.length > 0) {
      this.core.commands.notify(t('grid.autoFitSampledMulti', { n: sampledPlans.length }), 'info');
    }
  }
}
