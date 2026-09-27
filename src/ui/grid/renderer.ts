// SPDX-License-Identifier: MIT
/**
 * Virtualized rendering: the layout signature, the rendered window of rows
 * and columns, scroll/resize/wheel handling, and the full render that
 * materializes only the visible cells (plus overscan).
 *
 * A collaborator of the grid (see `./core.ts`): it owns no state of its own
 * beyond what is declared here, and reaches shared grid state through
 * `this.core`.
 */
import type { Tab } from '../../app/state';
import { getLocale, t } from '../../app/i18n';
import { nextZoomLevel } from '../../app/settings';
import { el, clearChildren } from '../dom';
import { OVERSCAN_COLS, OVERSCAN_ROWS } from './geometry';
import type { RowHeightIndex } from '../../core/row-height-index';
import type { GridCore, LayoutSignature, RenderWindow } from './core';

export class GridRenderer {
  constructor(private readonly core: GridCore) {}

  /**
   * Position the "add row" / "add column" anchors at the true bottom/right
   * edge of the document content (#467) and sync their enabled state. Their
   * perpendicular axis (horizontal for add-row, vertical for add-column) is
   * handled entirely by CSS `position: sticky`, so only the axis that tracks
   * document size — not scroll position — needs updating here.
   */
  private positionGridAddButtons(totalW: number, totalH: number): void {
    this.core.addRowAnchor.hidden = false;
    this.core.addColAnchor.hidden = false;
    this.core.addRowAnchor.style.top = `${totalH}px`;
    this.core.addColAnchor.style.left = `${totalW}px`;
    this.core.addRowButton.disabled = !this.core.commands.isEnabled('sheet.addRow');
    this.core.addColButton.disabled = !this.core.commands.isEnabled('sheet.addColumn');
  }

  // ----- Rendering -----

  refresh(): void {
    const tab = this.core.state.activeTab;
    this.core.element.setAttribute('aria-label', t('grid.label'));
    if (!tab || tab.doc.rowCount === 0) {
      this.core.lastDoc = null;
      this.core.editing.closeEditor(false);
      this.core.window = null;
      this.core.layout = null;
      this.core.pointer.closeContextMenu();
      clearChildren(this.core.headerEl);
      clearChildren(this.core.stickyEl);
      clearChildren(this.core.rowsLayer);
      this.core.canvas.style.width = '';
      this.core.canvas.style.height = '';
      this.core.addRowAnchor.hidden = true;
      this.core.addColAnchor.hidden = true;
      this.core.emptyEl.textContent = t('grid.empty');
      if (!this.core.emptyEl.parentElement) {
        this.core.element.append(this.core.emptyEl);
      }
      return;
    }
    this.core.emptyEl.remove();
    if (tab.doc !== this.core.lastDoc) {
      this.core.editing.closeEditor(false);
      this.core.pointer.closeContextMenu();
      this.core.element.scrollTop = 0;
      this.core.element.scrollLeft = 0;
      this.core.lastDoc = tab.doc;
      // A document just became active (created, opened, switched to, or
      // replaced in place) with nothing else deliberately focused — typing
      // would otherwise silently go nowhere until the user first clicks a
      // cell. Only claim the keyboard when focus is sitting on the inert
      // default (<body>); a dialog, the formula bar, or any other control
      // the user is already in keeps its focus untouched. This is never an
      // explicit edit-entry gesture, so it always claims focus through the
      // keyboard-safe path — `focusGrid()`'s mouse/touch branch would
      // otherwise wrongly treat this as a mouse interaction (its default
      // before any pointer event has reached this grid instance) and pop
      // the on-screen keyboard right after a fresh workbook appears.
      if (document.activeElement === document.body) {
        this.core.editing.focusSinkSilently();
      }
    }
    // Only rebuild the rendered window when a layout input changed (document
    // identity, dimensions, row height, sticky mode, locale). A plain cell
    // edit keeps the signature stable, so `render` repaints the existing DOM
    // in place — no teardown, no layout shift, no focus loss.
    if (!this.sameLayout(tab)) {
      this.core.window = null; // force rebuild
    }
    this.render(tab);
  }

  layoutSignature(tab: Tab): LayoutSignature {
    return {
      doc: tab.doc,
      rows: tab.doc.rowCount,
      cols: tab.doc.columnCount,
      wrap: this.core.state.wrapCells,
      font: this.fontSignature(),
      sticky: this.core.metrics.rowPinSignature(tab),
      stickyCol: this.core.metrics.frozenColCount(tab),
      locale: getLocale(),
      zoom: tab.zoom,
      hidden: this.core.metrics.hiddenOf(tab),
    };
  }

  private sameLayout(tab: Tab): boolean {
    const a = this.core.layout;
    if (a === null) {
      return false;
    }
    const b = this.layoutSignature(tab);
    return (
      a.doc === b.doc &&
      a.rows === b.rows &&
      a.cols === b.cols &&
      a.wrap === b.wrap &&
      a.font === b.font &&
      a.sticky === b.sticky &&
      a.stickyCol === b.stickyCol &&
      a.locale === b.locale &&
      a.zoom === b.zoom &&
      a.hidden === b.hidden
    );
  }

  /**
   * Whether the pinned row/column counts still match the rendered layout (a
   * grid resize can change how many fit without any other layout input).
   */
  private samePins(tab: Tab): boolean {
    return (
      this.core.layout?.sticky === this.core.metrics.rowPinSignature(tab) &&
      this.core.layout.stickyCol === this.core.metrics.frozenColCount(tab)
    );
  }

  /** Font family + size the grid currently measures/renders with. */
  fontSignature(): string {
    if (typeof getComputedStyle !== 'function') {
      return '';
    }
    const cs = getComputedStyle(this.core.measureCell);
    return `${cs.fontFamily}|${cs.fontSize}|${cs.letterSpacing}`;
  }

  /**
   * Ctrl (Windows/Linux) / Cmd (macOS) + mouse wheel: step the spreadsheet
   * zoom through the shared presets, anchored at the pointer so the content
   * under the cursor stays put instead of jumping. Only the recognized
   * gesture over the grid is consumed; plain scrolling, IME composition,
   * open editors, and active drags (resize/fill/selection/reference entry)
   * are left alone, and the browser's own zoom shortcuts are never touched.
   */
  onWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return; // plain scroll (or an OS-level gesture): never intercepted
    }
    const tab = this.core.state.activeTab;
    if (!tab || tab.doc !== this.core.lastDoc) {
      return;
    }
    if (this.core.composing || this.core.editor !== null) {
      return; // text entry owns the interaction
    }
    if (
      this.core.resizing ||
      this.core.filling ||
      this.core.dragging ||
      this.core.headerDrag ||
      this.core.refDrag ||
      this.core.movingRange
    ) {
      return; // another pointer interaction owns the gesture
    }
    if (event.deltaY === 0) {
      return;
    }
    // The gesture is recognized and handled from here on; preventing the
    // default keeps the browser's page zoom out of the spreadsheet area
    // (including at the clamp ends, where a sudden page zoom would jar).
    event.preventDefault();
    const direction: 1 | -1 = event.deltaY < 0 ? 1 : -1;
    const oldZoom = this.core.metrics.zoomOf(tab);
    const next = nextZoomLevel(tab.zoom, direction);
    if (next === tab.zoom) {
      return; // already at the preset range's end
    }
    // Pointer anchor in content coordinates (inside the scrolling region).
    const rect = this.core.element.getBoundingClientRect();
    const px = Math.max(0, event.clientX - rect.left - this.core.metrics.overlayWidth(tab));
    const py = Math.max(0, event.clientY - rect.top - this.core.metrics.overlayHeight(tab));
    const contentX = this.core.element.scrollLeft + px;
    const contentY = this.core.element.scrollTop + py;
    // Shared zoom state/command path (same as the menu and shortcuts); the
    // 'view' event re-renders the grid synchronously with the new metrics.
    this.core.state.setTabZoom(tab, next);
    // Keep the content point under the pointer: content coordinates scale
    // (approximately, up to per-cell rounding) with the zoom ratio.
    const scale = this.core.metrics.zoomOf(tab) / oldZoom;
    this.core.element.scrollLeft = Math.max(0, Math.round(contentX * scale - px));
    this.core.element.scrollTop = Math.max(0, Math.round(contentY * scale - py));
  }

  onScroll(): void {
    if (this.core.scrollScheduled) {
      return;
    }
    this.core.scrollScheduled = true;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: () => void) => setTimeout(fn, 16);
    schedule(() => {
      this.core.scrollScheduled = false;
      const tab = this.core.state.activeTab;
      if (!tab || tab.doc !== this.core.lastDoc || this.windowCoversViewport(tab)) {
        return;
      }
      this.render(tab);
    });
  }

  /**
   * `entries` (from the `ResizeObserver` above) lets a *pure height* change
   * be told apart from a real layout shift. On iOS Safari, the predictive-
   * text bar above the on-screen keyboard resizes the visual viewport — and
   * therefore `#app`'s `100dvh` height, cascading down to this element's
   * `clientHeight` — as its candidates change, i.e. on every keystroke
   * (#402/#519). Re-rendering the grid on every keystroke for that would be
   * wasted work.
   *
   * While an editor is open, a resize whose width matches the last observed
   * width is treated as exactly that kind of height-only change: not
   * re-rendered, with the sink just re-placed so it keeps tracking the cell,
   * and the grid scrolled only if the edited cell has dropped out of view
   * (the app shrinking to fit above the keyboard). A real resize (the width actually changed, or
   * no editor is open) still re-renders as before. jsdom (tests) provides no
   * `ResizeObserverEntry`, so `entries` is undefined there and this always
   * falls through to a normal render.
   */
  onResize(entries?: readonly ResizeObserverEntry[]): void {
    const width = entries?.[0]?.contentRect.width;
    if (this.core.editor !== null && width !== undefined && width === this.core.lastResizeWidth) {
      const cell = this.core.pointer.cellAt(this.core.editor.row, this.core.editor.col);
      if (cell) {
        this.core.editing.placeSinkOverCell(cell);
      }
      // The grid got shorter (e.g. the app now fits above an on-screen
      // keyboard): scroll the edited cell back into view if it ended up below
      // the fold. The editor stays open (see `render`).
      const tab = this.core.state.activeTab;
      if (tab) {
        this.core.navigation.scrollCellIntoView(tab, this.core.editor.row, this.core.editor.col, false);
      }
      return;
    }
    if (width !== undefined) {
      this.core.lastResizeWidth = width;
    }
    if (this.core.resizeScheduled) {
      return;
    }
    this.core.resizeScheduled = true;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: () => void) => setTimeout(fn, 16);
    schedule(() => {
      this.core.resizeScheduled = false;
      const tab = this.core.state.activeTab;
      if (!tab || tab.doc !== this.core.lastDoc) {
        return;
      }
      this.render(tab);
    });
  }

  /**
   * The display slots and columns actually on screen, without overscan:
   * `[first, last)` rows and `[firstCol, lastCol)` columns, each clamped to
   * the scrolling region's start.
   */
  private viewportSpan(tab: Tab): { first: number; last: number; firstCol: number; lastCol: number } {
    const idx = this.core.metrics.heightIndex(tab);
    const viewH = Math.max(0, this.core.element.clientHeight - this.core.metrics.overlayHeight(tab));
    const viewW = Math.max(0, this.core.element.clientWidth - this.core.metrics.overlayWidth(tab));
    const scrollTop = this.core.element.scrollTop;
    const scrollLeft = this.core.element.scrollLeft;
    const rowCount = tab.doc.rowCount;
    const startRow = this.core.metrics.scrollRowBase(tab);
    // Row window from the height index: the scroll layer's content origin is
    // the top of the first scroll row, so add its offset to scrollTop. With a
    // uniform (unwrapped) index this reduces exactly to floor(scrollTop / H).
    const originY = idx.offsetOf(startRow);
    const first = Math.max(startRow, idx.rowAtOffset(originY + scrollTop, rowCount));
    const last = idx.rowAtOffset(originY + scrollTop + viewH, rowCount) + 1;
    // Columns have per-column widths; the cached offset index answers the
    // visible range in O(log n) instead of walking every column from 0.
    const colIdx = this.core.metrics.colOffsetIndex(tab);
    // Pinned columns sit over the start of the scrolled band, and the band
    // itself runs to the right edge of everything past the row numbers.
    const firstCol = Math.max(
      this.core.metrics.scrollColBase(tab),
      colIdx.colAtOrBefore(scrollLeft + this.core.metrics.frozenColsWidth(tab)),
    );
    const lastCol = colIdx.colAtOrAfter(scrollLeft + viewW + this.core.metrics.frozenColsWidth(tab));
    return { first, last, firstCol, lastCol };
  }

  private computeWindow(tab: Tab): RenderWindow {
    const { first, last, firstCol, lastCol } = this.viewportSpan(tab);
    const rowStart = Math.max(this.core.metrics.scrollRowBase(tab), first - OVERSCAN_ROWS);
    const rowEnd = Math.min(tab.doc.rowCount, last + OVERSCAN_ROWS);
    const colStart = Math.max(this.core.metrics.scrollColBase(tab), firstCol - OVERSCAN_COLS);
    const colEnd = Math.min(Math.max(1, tab.doc.columnCount), lastCol + OVERSCAN_COLS);
    return { rowStart, rowEnd, colStart, colEnd, heights: this.core.metrics.heightsVersion };
  }

  /**
   * True when the rendered window (overscan included) still covers every row
   * and column on screen, so a scroll step needs no DOM work at all: the rows
   * are absolutely positioned inside the scrolled canvas and the headers and
   * pinned cells are CSS-sticky. Scrolling then rebuilds the window once per
   * overscan's worth of rows instead of on every row boundary crossed.
   */
  private windowCoversViewport(tab: Tab): boolean {
    const win = this.core.window;
    if (win === null || win.heights !== this.core.metrics.heightsVersion || !this.samePins(tab)) {
      return false;
    }
    const { first, last, firstCol, lastCol } = this.viewportSpan(tab);
    return first >= win.rowStart && last <= win.rowEnd && firstCol >= win.colStart && lastCol <= win.colEnd;
  }

  private sameWindow(a: RenderWindow | null, b: RenderWindow): boolean {
    return (
      a !== null &&
      a.rowStart === b.rowStart &&
      a.rowEnd === b.rowEnd &&
      a.colStart === b.colStart &&
      a.colEnd === b.colEnd &&
      a.heights === b.heights
    );
  }

  render(tab: Tab): void {
    // Rendering reaches for the GLOBAL `document` (directly, and through the
    // `el` DOM builder), so it is only safe while a browsing context exists.
    // Three callers are deferred — the off-screen wrap-measure pass, the scroll
    // rAF, and async auto-fit — and any of them can resolve after that context
    // is gone (a torn-down test environment, a detached document). Guarding
    // here covers every caller; guarding one call site only moves the crash to
    // the next global the method touches. `typeof` is deliberate: it is safe
    // even when the binding has been removed outright, not merely set to
    // undefined. In a browser this is never taken.
    if (typeof document === 'undefined') {
      return;
    }
    // Never disrupt an active IME composition: any rebuild would tear the
    // focused editor out of the DOM mid-composition and drop it. Background
    // work (the wrap-measure pass, scroll coalescing) that calls render while
    // the user is composing simply defers until composition ends.
    if (this.core.editor && this.core.composing) {
      return;
    }
    const idx = this.core.metrics.heightIndex(tab);
    // Conditional wrapping: measure the rows about to be shown so their heights
    // are exact *now* (immediate correctness for the visible region), recompute
    // the window against the corrected offsets, and let the off-screen rows be
    // filled in incrementally. Without a measurer (wrapping off, or no canvas
    // metrics) every row keeps the single-line height.
    const measurer = this.core.state.wrapCells ? this.core.wrap.buildWrapMeasurer() : null;
    if (!measurer) {
      // No wrapping: every row is single-line — except rows an active filter
      // hides, whose collapsed (0-height) overrides must be preserved so the
      // virtualization still skips their bands.
      idx.clear();
      const hidden = this.core.metrics.hiddenOf(tab);
      if (hidden) {
        for (const row of hidden) {
          idx.set(row, 0);
        }
      }
      this.core.wrapPassSig = null;
    }
    let win = this.computeWindow(tab);
    if (measurer) {
      this.core.wrap.measureWindowRows(tab, win, measurer, idx);
      win = this.computeWindow(tab);
      this.core.wrap.scheduleWrapPass(tab, measurer);
    }
    if (this.sameWindow(this.core.window, win) && this.samePins(tab)) {
      this.core.cells.paintWindowCells(tab);
      this.core.selectionView.refreshSelection();
      this.core.cells.refreshFormulaRefs();
      return;
    }
    this.core.window = win;
    this.core.layout = this.layoutSignature(tab);
    const geometry = this.applyGeometry(tab, idx);
    this.buildHeaderRow(tab, win, geometry.totalW, geometry.originX);
    this.buildPinnedRows(tab, win, idx, geometry.totalW);
    this.buildDataRows(tab, win, idx, geometry);
    this.keepEditorPlaced();
    this.core.selectionView.refreshSelection();
    this.core.cells.refreshFormulaRefs();
  }

  /**
   * Size the canvas and apply the zoom metrics for a full rebuild, returning
   * the geometry the row builders position against.
   */
  private applyGeometry(
    tab: Tab,
    idx: RowHeightIndex,
  ): { totalW: number; originX: number; originY: number; layerHeight: number } {
    const doc = tab.doc;
    const totalW = this.core.metrics.totalWidth(tab);
    const startRow = this.core.metrics.scrollRowBase(tab);
    const originY = idx.offsetOf(startRow);
    const originX = this.core.metrics.colOffset(tab, this.core.metrics.scrollColBase(tab));
    const layerHeight = idx.rangeHeight(startRow, doc.rowCount);
    // Zoom is applied through CSS custom properties (font sizes, line boxes)
    // plus the scaled JS metrics; the JS-computed row height stays the source
    // of truth so CSS line heights and element heights can never drift apart.
    this.core.element.style.setProperty('--sheet-zoom', String(this.core.metrics.zoomOf(tab)));
    this.core.element.style.setProperty('--grid-row-height', `${this.core.metrics.rowH(tab)}px`);
    this.core.element.style.setProperty('--grid-wrap-line', `${this.core.metrics.wrapLineH(tab)}px`);
    // Use the element's own document, not the global `document`: a deferred
    // wrap pass (see runWrapPass) can still call render() after a torn-down
    // test environment has unbound the global `document` while this element's
    // ownerDocument reference is still alive.
    this.core.element.ownerDocument.documentElement.style.setProperty(
      '--sheet-zoom',
      String(this.core.metrics.zoomOf(tab)),
    );
    // Announce zoom changes politely (menu, shortcut, or wheel — one shared
    // path). The first render of a tab sets the baseline silently.
    if (this.core.announcedZoom === null) {
      this.core.announcedZoom = tab.zoom;
    } else if (this.core.announcedZoom !== tab.zoom) {
      this.core.announcedZoom = tab.zoom;
      this.core.zoomLive.textContent = t('grid.zoomAnnounce', { pct: tab.zoom });
    }
    this.core.canvas.style.width = `${totalW}px`;
    this.core.canvas.style.height = `${this.core.metrics.overlayHeight(tab) + layerHeight}px`;
    this.positionGridAddButtons(totalW, this.core.metrics.overlayHeight(tab) + layerHeight);
    this.core.element.setAttribute('aria-rowcount', String(doc.rowCount + 1));
    this.core.element.setAttribute('aria-colcount', String(doc.columnCount + 1));
    return { totalW, originX, originY, layerHeight };
  }

  /** The column header row: always sticky, single-line. */
  private buildHeaderRow(tab: Tab, win: RenderWindow, totalW: number, originX: number): void {
    clearChildren(this.core.headerEl);
    this.core.headerEl.style.width = `${totalW}px`;
    this.core.headerEl.style.height = `${this.core.metrics.rowH(tab)}px`;
    this.core.headerEl.append(this.core.cells.buildCorner(tab));
    const frozenCols = this.core.metrics.frozenColCount(tab);
    for (let c = 0; c < frozenCols; c++) {
      const pinnedHead = this.core.cells.buildColumnHeaderCell(tab, c, true);
      this.core.cells.pinColumnCell(tab, pinnedHead, c, frozenCols);
      this.core.headerEl.append(pinnedHead);
    }
    const headSpacer = el('div', { className: 'vspacer', attrs: { 'aria-hidden': 'true' } });
    headSpacer.style.width = `${this.core.metrics.colOffset(tab, win.colStart) - originX}px`;
    this.core.headerEl.append(headSpacer);
    for (let c = win.colStart; c < win.colEnd; c++) {
      this.core.headerEl.append(this.core.cells.buildColumnHeaderCell(tab, c, false));
    }
  }

  /** Pinned record rows (optional, single-line, visually distinct). */
  private buildPinnedRows(tab: Tab, win: RenderWindow, idx: RowHeightIndex, totalW: number): void {
    clearChildren(this.core.stickyEl);
    const pinned = this.core.metrics.pinnedSlots(tab);
    const autoPinned = this.core.metrics.autoPinnedRow(tab);
    this.core.stickyEl.classList.toggle('auto', autoPinned);
    if (pinned.length > 0) {
      this.core.stickyEl.hidden = false;
      this.core.stickyEl.style.width = `${totalW}px`;
      this.core.stickyEl.style.height = `${this.core.metrics.pinnedHeight(tab)}px`;
      this.core.stickyEl.style.top = `${this.core.metrics.rowH(tab)}px`;
      for (const slot of pinned) {
        const row = this.core.metrics.docRowOf(tab, slot);
        const rowEl = el('div', {
          className: `vgrid-stickyrow${slot % 2 === 1 ? ' alt' : ''}`,
          attrs: { role: 'row', 'data-row': String(row), 'aria-rowindex': String(slot + 2) },
        });
        const height = idx.heightOf(slot);
        if (height > this.core.metrics.rowH(tab)) {
          rowEl.classList.add('wrapped');
        }
        rowEl.style.width = `${totalW}px`;
        rowEl.style.height = `${height}px`;
        this.core.cells.buildRowCells(tab, rowEl, row, win, !autoPinned);
        this.core.stickyEl.append(rowEl);
      }
    } else {
      this.core.stickyEl.hidden = true;
    }
  }

  /** The virtualized data rows (variable height); filter-hidden rows get no DOM. */
  private buildDataRows(
    tab: Tab,
    win: RenderWindow,
    idx: RowHeightIndex,
    geometry: { totalW: number; originY: number; layerHeight: number },
  ): void {
    const { totalW, originY, layerHeight } = geometry;
    clearChildren(this.core.rowsLayer);
    this.core.rowsLayer.style.height = `${layerHeight}px`;
    for (let slot = win.rowStart; slot < win.rowEnd; slot++) {
      const height = idx.heightOf(slot);
      if (height === 0) {
        continue; // hidden by the active filter: no DOM is materialized
      }
      const row = this.core.metrics.docRowOf(tab, slot);
      const wrapped = height > this.core.metrics.rowH(tab);
      const rowEl = el('div', {
        className: `vgrid-row ${slot % 2 === 1 ? 'alt' : ''}${wrapped ? ' wrapped' : ''}`,
        attrs: { role: 'row', 'data-row': String(row), 'aria-rowindex': String(slot + 2) },
      });
      rowEl.style.top = `${idx.offsetOf(slot) - originY}px`;
      rowEl.style.height = `${height}px`;
      rowEl.style.width = `${totalW}px`;
      this.core.cells.buildRowCells(tab, rowEl, row, win, false);
      this.core.rowsLayer.append(rowEl);
    }
  }

  /**
   * The sink lives in the canvas, not in the rebuilt rows, so the editor
   * survives a window change. Keep it open while its cell is still rendered —
   * e.g. the grid scrolled a few rows to keep it above an on-screen keyboard —
   * and commit only once the cell has left the window.
   */
  private keepEditorPlaced(): void {
    if (!this.core.editor) {
      return;
    }
    const cell = this.core.pointer.cellAt(this.core.editor.row, this.core.editor.col);
    if (cell) {
      this.core.editing.placeSinkOverCell(cell);
    } else {
      this.core.editing.commitEditor();
    }
  }
  /** Update only the scroll extent (scrollbar) as off-screen heights fill in. */
  updateScrollExtent(tab: Tab): void {
    if (this.core.state.activeTab !== tab || tab.doc !== this.core.lastDoc) {
      return;
    }
    const idx = this.core.metrics.heightIndex(tab);
    const layerHeight = idx.rangeHeight(this.core.metrics.scrollRowBase(tab), tab.doc.rowCount);
    this.core.canvas.style.height = `${this.core.metrics.overlayHeight(tab) + layerHeight}px`;
    this.core.rowsLayer.style.height = `${layerHeight}px`;
    this.core.addRowAnchor.style.top = `${this.core.metrics.overlayHeight(tab) + layerHeight}px`;
  }

  /**
   * Invalidate cached row heights for a tab and restart the off-screen pass
   * (used after column-width changes / auto-fit, which change wrapping without
   * changing the layout signature).
   */
  invalidateRowHeights(tab: Tab): void {
    if (!this.core.state.wrapCells) {
      return;
    }
    this.core.metrics.heightIndex(tab).clear();
    this.core.wrapPassSig = null;
    this.core.metrics.heightsVersion += 1;
  }
}
