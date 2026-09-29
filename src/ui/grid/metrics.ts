// SPDX-License-Identifier: MIT
import { isWorkbook } from '../../core/editor-document';
import type { AppState, Tab } from '../../app/state';
import { ColOffsetIndex } from '../../core/col-offset-index';
import { RowHeightIndex } from '../../core/row-height-index';
import type { SheetSort } from '../../core/workbook/sort';
import { COL_WIDTH, ROW_HEAD_WIDTH, ROW_HEIGHT, WRAP_LINE_HEIGHT, WRAP_VERTICAL_PAD } from './geometry';

/** Cached column-offset index plus the state it was built from, for invalidation. */
interface ColOffsetCache {
  index: ColOffsetIndex;
  zoom: number;
  columnCount: number;
  /** Reference to the `colWidths` array the index was built from — a resize
   *  mutates that array in place, so an explicit invalidation call is also
   *  required (see `invalidateColOffsets`); this reference check catches the
   *  cases where a new array is assigned instead (e.g. restoring a tab). */
  widths: number[];
  /** The grid-paper square the index was built for (undefined: not paper). */
  paper: number | undefined;
}

/**
 * The grid's pixel metrics and pinned-pane layout, with the per-document
 * caches behind them (row-height index, column-offset index).
 *
 * All pixel metrics are zoom-aware: the tab's zoom percent scales the default
 * row height, header width, wrap line height, and column widths. Column
 * widths are *stored* at 100% zoom (per-tab session state; persisted by RSF
 * documents) and only *rendered* scaled, so a saved width means the same
 * thing at every zoom level.
 *
 * Owned by `Grid`; `element` is the grid's scrolling container, read only for
 * its client size (how many pinned rows/columns fit).
 */
export class GridMetrics {
  /**
   * Variable row heights keyed by the *document* object (empty/uniform unless
   * wrapping grows rows). Keying by the document means a replaced document
   * (convert/save/reopen) automatically starts from a fresh, correct index.
   */
  private readonly rowHeights = new WeakMap<object, RowHeightIndex>();
  /** Bumped whenever any row height changes, so the render window rebuilds. */
  heightsVersion = 0;
  /**
   * Cached column-offset prefix sum, keyed by document. Built lazily and
   * reused across every scroll/render until a resize, autofit, zoom, or
   * column-count change invalidates it — rebuilding from scratch on every
   * scroll would make horizontal scroll cost scale with total column count
   * instead of the visible window.
   */
  private readonly colOffsets = new WeakMap<object, ColOffsetCache>();
  /** Default row height the row-height index was built with (a grid-paper sheet's differs), per document. */
  private readonly indexBase = new WeakMap<object, number>();
  /** Zoom the row-height index was built for, per document. */
  private readonly indexZoom = new WeakMap<object, number>();
  /** Hidden-row snapshot the row-height index was seeded with, per document. */
  private readonly indexHidden = new WeakMap<object, Set<number> | null>();
  /** Active sort the row-height index was built against, per document. */
  private readonly indexSort = new WeakMap<object, SheetSort | null>();

  /**
   * @param onIndexReset called whenever a row-height index is rebuilt from
   *   scratch (zoom, filter, or sort change), so the grid re-measures wrapped
   *   heights.
   */
  constructor(
    private readonly state: AppState,
    private readonly element: HTMLElement,
    private readonly onIndexReset: () => void,
  ) {}

  /** Drop every measured row height (the text measurer changed). */
  clearRowHeights(tabs: readonly Tab[]): void {
    for (const tab of tabs) {
      this.rowHeights.get(tab.doc)?.clear();
    }
    this.heightsVersion += 1;
  }

  // All pixel metrics are zoom-aware: the tab's zoom percent scales the
  // default row height, header width, wrap line height, and column widths.
  // Column widths are *stored* at 100% zoom (per-tab session state; persisted
  // by RSF documents) and only *rendered* scaled, so a saved width means the
  // same thing at every zoom level.

  /** The active tab's zoom factor (1 = 100%). */
  zoomOf(tab: Tab): number {
    return (tab.zoom || 100) / 100;
  }

  /** The active filter's hidden-row set (null when nothing is filtered). */
  hiddenOf(tab: Tab): Set<number> | null {
    return this.state.hiddenRows(tab);
  }

  /**
   * The document row whose content belongs at display slot `row`. Identity
   * when nothing is sorted — see `AppState.docRow`/`core/workbook/sort.ts`.
   */
  docRowOf(tab: Tab, row: number): number {
    return this.state.docRow(tab, row);
  }

  /** The active sheet's square side when it is grid paper (px at 100%), else undefined. */
  paperOf(tab: Tab): number | undefined {
    return isWorkbook(tab.doc) ? tab.doc.activeSheet.paper : undefined;
  }

  /** Zoomed default (single-line) row height in px; on grid paper, one square. */
  rowH(tab: Tab): number {
    return Math.round((this.paperOf(tab) ?? ROW_HEIGHT) * this.zoomOf(tab));
  }

  /** Zoomed wrapped-line box height in px. */
  wrapLineH(tab: Tab): number {
    return Math.round(WRAP_LINE_HEIGHT * this.zoomOf(tab));
  }

  /** Zoomed vertical padding around wrapped lines in px. */
  wrapPad(tab: Tab): number {
    return Math.round(WRAP_VERTICAL_PAD * this.zoomOf(tab));
  }

  /** Zoomed row-header width in px. */
  headW(tab: Tab): number {
    return Math.round(ROW_HEAD_WIDTH * this.zoomOf(tab));
  }

  /**
   * The per-tab row-height index (created lazily; uniform until wrapping
   * grows a row or a filter hides one). It is keyed by **display slot**, not
   * document row: with an active sort, slot `i`'s height is the wrapped
   * height of whatever document row `docRowOf(tab, i)` currently shows there
   * (see `measureWindowRows`/`runWrapPass`), so scroll offsets are always
   * computed in the order rows are actually stacked on screen. Rows hidden
   * by the active filter are seeded with height 0 at their own row number —
   * a hidden row's slot always equals its document row (`computeSortOrder`
   * never moves it) — so the virtualization offsets, scroll extent, and hit
   * testing collapse them without any per-frame filtering work, and without
   * ever materializing DOM for them.
   */
  heightIndex(tab: Tab): RowHeightIndex {
    let index = this.rowHeights.get(tab.doc);
    const hidden = this.hiddenOf(tab);
    const sort = tab.doc.sort;
    if (
      !index ||
      this.indexZoom.get(tab.doc) !== tab.zoom ||
      this.indexBase.get(tab.doc) !== this.rowH(tab) ||
      this.indexHidden.get(tab.doc) !== hidden ||
      this.indexSort.get(tab.doc) !== sort
    ) {
      // A zoom, filter, or sort change invalidates every cached height (the
      // uniform default and any wrapped measurements — a sort change moves
      // which document row's content each slot's height came from), so the
      // index starts fresh.
      index = new RowHeightIndex(this.rowH(tab));
      if (hidden) {
        for (const row of hidden) {
          index.set(row, 0);
        }
      }
      this.rowHeights.set(tab.doc, index);
      this.indexZoom.set(tab.doc, tab.zoom);
      this.indexBase.set(tab.doc, this.rowH(tab));
      this.indexHidden.set(tab.doc, hidden ?? null);
      this.indexSort.set(tab.doc, sort);
      this.onIndexReset(); // re-measure wrapped heights for the new state
      this.heightsVersion += 1;
    }
    return index;
  }

  /**
   * Display slots `[0, n)` that stay pinned below the column header (the
   * sticky first row, or every row above a freeze-at-selection point). With
   * nothing frozen, the first row still follows the scroll on its own (see
   * `autoPinnedRow`). A frozen area whose rows are all hidden by the active
   * filter pins nothing (pinning them would show rows the filter hides).
   */
  frozenRowCount(tab: Tab): number {
    const frozen = this.state.frozenPanes(tab).rows;
    if (frozen === 0 && !this.firstRowHasValues(tab)) {
      return 0; // an empty first row has nothing worth following the scroll
    }
    let n = Math.max(1, frozen);
    // Keep at least one scrollable row on screen: a freeze point far down the
    // sheet pins only as many rows as fit (never measured without a layout).
    const viewH = this.element.clientHeight;
    if (viewH > 0) {
      n = Math.min(n, Math.max(1, Math.floor(viewH / this.rowH(tab)) - 2));
    }
    return n > 0 && this.pinnedSlots(tab, n).length > 0 ? n : 0;
  }

  /** Whether the first displayed row has any non-empty cell (the automatic pin's condition). */
  private firstRowHasValues(tab: Tab): boolean {
    const doc = tab.doc;
    if (doc.rowCount === 0) {
      return false;
    }
    const row = this.docRowOf(tab, 0);
    const fields = doc.fieldCount(row);
    for (let c = 0; c < fields; c++) {
      if (doc.getValue(row, c) !== '') {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether the pinned first row is only the automatic one (no row frozen by
   * the user): it looks like an ordinary row, with no boundary rule.
   */
  autoPinnedRow(tab: Tab): boolean {
    return this.state.frozenPanes(tab).rows === 0;
  }

  /** Pinned-row count, negated for the automatic first row (a layout-signature input). */
  rowPinSignature(tab: Tab): number {
    const n = this.frozenRowCount(tab);
    return this.autoPinnedRow(tab) ? -n : n;
  }

  /** The visible (not filtered-out) display slots among the first `n`. */
  pinnedSlots(tab: Tab, n = this.frozenRowCount(tab)): number[] {
    const hidden = this.hiddenOf(tab);
    const slots: number[] = [];
    for (let slot = 0; slot < n; slot++) {
      if (!hidden?.has(this.docRowOf(tab, slot))) {
        slots.push(slot);
      }
    }
    return slots;
  }

  /** First display slot of the scrolling region. */
  scrollRowBase(tab: Tab): number {
    return this.frozenRowCount(tab);
  }

  /** Height of the sticky overlays: the single-line column header plus the pinned rows. */
  overlayHeight(tab: Tab): number {
    return this.rowH(tab) + this.pinnedHeight(tab);
  }

  /** Total height of the pinned rows (each at its own, possibly wrapped, height). */
  pinnedHeight(tab: Tab): number {
    const idx = this.heightIndex(tab);
    let h = 0;
    for (const slot of this.pinnedSlots(tab)) {
      h += idx.heightOf(slot);
    }
    return h;
  }

  /** Columns `[0, n)` that stay pinned right of the row numbers. */
  frozenColCount(tab: Tab): number {
    const n = this.state.frozenPanes(tab).cols;
    // Like rows: pin only as many columns as leave one scrollable column.
    const viewW = this.element.clientWidth - this.headW(tab);
    if (n <= 1 || viewW <= 0) {
      return n;
    }
    let fit = 1;
    while (fit < n && this.colOffset(tab, fit + 1) + COL_WIDTH * this.zoomOf(tab) <= viewW) {
      fit += 1;
    }
    return fit;
  }

  /** First document column of the horizontally scrolling region. */
  scrollColBase(tab: Tab): number {
    return this.frozenColCount(tab);
  }

  /** Width of the pinned columns (not counting the row-number column). */
  frozenColsWidth(tab: Tab): number {
    return this.colOffset(tab, this.frozenColCount(tab));
  }

  /**
   * Width of the sticky horizontal overlay (row headers + pinned columns)
   * that the scrollable column region starts after.
   */
  overlayWidth(tab: Tab): number {
    return this.headW(tab) + this.frozenColsWidth(tab);
  }

  /** Rendered pixel width of a column (per-tab override or default, zoomed; on grid paper, one square). */
  colWidth(tab: Tab, col: number): number {
    const paper = this.paperOf(tab);
    const w = paper ?? tab.colWidths[col];
    return Math.round((w && w > 0 ? w : COL_WIDTH) * this.zoomOf(tab));
  }

  /**
   * The column-offset index for `tab`, rebuilding it only when the widths
   * array, zoom, or column count it was built from have changed since the
   * last call.
   */
  colOffsetIndex(tab: Tab): ColOffsetIndex {
    const cached = this.colOffsets.get(tab.doc);
    const columnCount = tab.doc.columnCount;
    if (
      cached &&
      cached.zoom === tab.zoom &&
      cached.widths === tab.colWidths &&
      cached.columnCount === columnCount &&
      cached.paper === this.paperOf(tab)
    ) {
      return cached.index;
    }
    const index = new ColOffsetIndex(columnCount, (c) => this.colWidth(tab, c));
    this.colOffsets.set(tab.doc, {
      index,
      zoom: tab.zoom,
      columnCount,
      widths: tab.colWidths,
      paper: this.paperOf(tab),
    });
    return index;
  }

  /**
   * Drop the cached column-offset index for `tab`'s document (used after a
   * resize or autofit mutates `colWidths` in place, which the cache's
   * reference check alone would not catch).
   */
  invalidateColOffsets(tab: Tab): void {
    this.colOffsets.delete(tab.doc);
  }

  /** X offset (from the first column) of column `col`, i.e. the summed widths before it. */
  colOffset(tab: Tab, col: number): number {
    return this.colOffsetIndex(tab).offsetOf(col);
  }

  totalColsWidth(tab: Tab): number {
    return this.colOffsetIndex(tab).totalWidth;
  }

  totalWidth(tab: Tab): number {
    return this.headW(tab) + this.totalColsWidth(tab);
  }
}
