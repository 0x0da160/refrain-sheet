// SPDX-License-Identifier: MIT
/**
 * Conditional row-height wrapping: measuring wrapped text, and the
 * off-screen, time-sliced pass that computes row heights for the whole
 * document without blocking the grid.
 *
 * A collaborator of the grid (see `./core.ts`): it owns no state of its own
 * beyond what is declared here, and reaches shared grid state through
 * `this.core`.
 */
import type { Tab } from '../../app/state';
import { t } from '../../app/i18n';
import type { RowHeightIndex } from '../../core/row-height-index';
import { forEachIndexSliced } from '../../core/scheduler';
import { countVisualLines, rowHeightForLines, type WrapMeasure } from '../../core/text-wrap';
import { MAX_WRAP_LINES, WRAP_PASS_BUSY_ROWS } from './geometry';
import { createTextMeasurer } from './dom-support';
import type { GridCore, RenderWindow } from './core';

export class WrapLayout {
  constructor(private readonly core: GridCore) {}

  /**
   * Test seam: install a deterministic text measurer so wrapping can be
   * exercised without a real 2D canvas (jsdom returns none). Pass null to
   * restore canvas-based measurement. Also clears cached heights so the next
   * render re-measures with the new measurer.
   */
  setTextMeasurer(measure: WrapMeasure | null): void {
    this.core.measurerOverride = measure;
    this.core.cachedMeasurer = null;
    this.core.wrapPassSig = null;
    this.core.metrics.clearRowHeights(this.core.state.tabs);
  }

  // ----- Conditional row-height wrapping -----

  /**
   * Build a text measurer + horizontal cell chrome for wrap measurement, or
   * null when no measurement is possible (no 2D canvas, e.g. jsdom, and no test
   * override). The measurer reports rendered pixel widths under the active
   * sheet font — wrapping is never decided from character or byte counts.
   */
  buildWrapMeasurer(): { measure: WrapMeasure; chrome: number } | null {
    if (this.core.measurerOverride) {
      return { measure: this.core.measurerOverride, chrome: this.horizontalChrome() };
    }
    const sig = this.core.renderer.fontSignature();
    if (this.core.cachedMeasurer && this.core.cachedMeasurer.sig === sig) {
      return this.core.cachedMeasurer;
    }
    const measure = createTextMeasurer(this.core.measureCell);
    if (!measure) {
      return null;
    }
    this.core.cachedMeasurer = { sig, measure, chrome: this.horizontalChrome() };
    return this.core.cachedMeasurer;
  }

  /** Horizontal chrome (padding + left/right borders) of a cell box, in px. */
  private horizontalChrome(): number {
    if (typeof getComputedStyle !== 'function') {
      return 0;
    }
    const cs = getComputedStyle(this.core.measureCell);
    const px = (v: string): number => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    return px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
  }

  /**
   * Measured pixel height of a data row: the tallest of its cells' wrapped
   * heights, each measured against that cell's own column width (a formula
   * cell contributes its displayed result). Only rows whose content genuinely
   * needs more than one visual line exceed the single-line height. Pinned
   * rows wrap like any other row, so the first row looks the same whether or
   * not it currently follows the scroll.
   */
  private computeRowHeight(tab: Tab, row: number, measure: WrapMeasure, chrome: number): number {
    if (this.core.metrics.hiddenOf(tab)?.has(row)) {
      return 0; // filtered out: the row's band collapses entirely
    }
    const sized = this.core.metrics.sizedRowH(tab, row);
    if (sized !== null) {
      return sized; // a height the person set wins over the wrapped one
    }
    const doc = tab.doc;
    const fields = doc.fieldCount(row);
    let maxLines = 1;
    for (let c = 0; c < fields; c++) {
      const contentWidth = this.core.metrics.colWidth(tab, c) - chrome;
      const lines = countVisualLines(doc.getDisplayValue(row, c), measure, contentWidth, MAX_WRAP_LINES);
      if (lines > maxLines) {
        maxLines = lines;
      }
      if (maxLines >= MAX_WRAP_LINES) {
        break;
      }
    }
    return rowHeightForLines(
      maxLines,
      this.core.metrics.rowH(tab),
      this.core.metrics.wrapLineH(tab),
      this.core.metrics.wrapPad(tab),
    );
  }

  /** Measure every row of the current window into the index (bumps the version on any change). */
  measureWindowRows(
    tab: Tab,
    win: RenderWindow,
    m: { measure: WrapMeasure; chrome: number },
    idx: RowHeightIndex,
  ): void {
    let changed = false;
    // The pinned rows are on screen too, above the scrolled window.
    const slots = [...this.core.metrics.pinnedSlots(tab)];
    for (let slot = win.rowStart; slot < win.rowEnd; slot++) {
      slots.push(slot);
    }
    for (const slot of slots) {
      const row = this.core.metrics.docRowOf(tab, slot);
      if (idx.set(slot, this.computeRowHeight(tab, row, m.measure, m.chrome))) {
        changed = true;
      }
    }
    if (changed) {
      this.core.metrics.heightsVersion += 1;
    }
  }

  /** Stable identifier for a document object (so a pass restarts on a new doc). */
  private docToken(doc: unknown): number {
    let id = this.core.docIds.get(doc as object);
    if (id === undefined) {
      id = this.core.nextDocId++;
      this.core.docIds.set(doc as object, id);
    }
    return id;
  }

  /** Signature the off-screen wrap pass is keyed to (font/locale/dims/doc). */
  private layoutToken(tab: Tab): string {
    const s = this.core.renderer.layoutSignature(tab);
    const hiddenToken = s.hidden ? this.docToken(s.hidden) : 0;
    return `${this.docToken(tab.doc)}|${s.rows}x${s.cols}|${s.wrap}|${s.font}|${s.sticky}|${s.locale}|${s.zoom}|${hiddenToken}`;
  }

  /**
   * Start (once) an incremental pass that measures every off-screen row's
   * height in cooperative time slices, so the scroll extent and off-screen
   * offsets become exact without a synchronous full-document loop. Idempotent
   * per layout: it no-ops while a pass for the same signature is already
   * running or finished, and restarts when the document, dimensions, font,
   * locale, or wrap mode change (which invalidate cached heights).
   */
  scheduleWrapPass(tab: Tab, m: { measure: WrapMeasure; chrome: number }): void {
    const sig = this.layoutToken(tab);
    if (this.core.wrapPassSig === sig) {
      return;
    }
    this.core.wrapPassSig = sig;
    void this.runWrapPass(tab, m, sig);
  }

  private async runWrapPass(
    tab: Tab,
    m: { measure: WrapMeasure; chrome: number },
    sig: string,
  ): Promise<void> {
    const doc = tab.doc;
    const idx = this.core.metrics.heightIndex(tab);
    const startRow = this.core.metrics.scrollRowBase(tab);
    const total = doc.rowCount;
    const scrollRows = total - startRow;
    const large = scrollRows > WRAP_PASS_BUSY_ROWS;
    const current = () =>
      this.core.state.activeTab === tab &&
      tab.doc === doc &&
      this.core.state.wrapCells &&
      this.core.wrapPassSig === sig;
    let dirty = false;
    if (large) {
      this.core.commands.setBusy(t('loading.wrapMeasure', { done: 0, total, pct: 0 }), 0);
    }
    try {
      const ok = await forEachIndexSliced(
        total,
        (slot) => {
          const row = this.core.metrics.docRowOf(tab, slot);
          if (idx.set(slot, this.computeRowHeight(tab, row, m.measure, m.chrome))) {
            dirty = true;
          }
        },
        {
          onProgress: (done) => {
            if (dirty) {
              this.core.metrics.heightsVersion += 1;
              this.core.renderer.updateScrollExtent(tab);
              dirty = false;
            }
            if (large) {
              const pct = Math.floor((done / total) * 100);
              this.core.commands.setBusy(t('loading.wrapMeasure', { done, total, pct }), pct);
            }
          },
          shouldStop: () => !current(),
        },
      );
      if (!ok || !current()) {
        return;
      }
    } finally {
      if (large) {
        this.core.commands.setBusy(null);
      }
    }
    // Re-lay-out once so every rendered row sits at its final measured height.
    if (dirty) {
      this.core.metrics.heightsVersion += 1;
    }
    if (!this.core.element.ownerDocument.defaultView) {
      // The element's document was detached from its view: skip the pointless
      // re-layout. NOTE this does NOT catch a torn-down test environment —
      // `ownerDocument.defaultView` stays truthy there while the *global*
      // `document` disappears. `render` itself carries that guard.
      return;
    }
    this.core.window = null;
    this.core.renderer.render(tab);
  }
}
