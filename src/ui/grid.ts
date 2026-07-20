// SPDX-License-Identifier: MIT
import type { AppState, FormulaRefTarget, Tab } from '../app/app-state';
import { LARGE_OP_CELLS, type CommandId, type Commands } from '../app/commands';
import { getLocale, t } from '../app/i18n';
import { getEditHints } from '../app/settings';
import { normalizeRange, rangeContains, type CellRange } from '../core/clipboard';
import { cellLabel, columnLabel, extractFormulaRefs, type FormulaRefRange } from '../core/formula';
import { RowHeightIndex } from '../core/row-height-index';
import { forEachIndexSliced, yieldToBrowser } from '../core/scheduler';
import { countVisualLines, rowHeightForLines, type WrapMeasure } from '../core/text-wrap';
import { el, clearChildren } from './dom';
import { FormulaAutocomplete, FormulaFieldRef } from './formula-autocomplete';
import { beginsTextEntry, isComposingKey } from './ime';

/** Fixed row/column metrics for virtualization (px). ROW_HEIGHT must stay in
 * sync with the `--grid-row-height` CSS variable (see styles.css), which the
 * cell typography uses to vertically center single-line text via line-height. */
export const ROW_HEIGHT = 26;
/** Line box of a wrapped cell (px). Kept in sync with `--grid-wrap-line`. */
export const WRAP_LINE_HEIGHT = 18;
/** Vertical chrome (top+bottom padding) added around a wrapped cell's lines. */
export const WRAP_VERTICAL_PAD = 8;
/** Hard cap on the visual lines a single row may grow to when wrapping. */
export const MAX_WRAP_LINES = 12;
/** Row count above which the off-screen wrap-measure pass shows a busy label. */
export const WRAP_PASS_BUSY_ROWS = 4000;
export const COL_WIDTH = 132;
export const MIN_COL_WIDTH = 40;
export const MAX_COL_WIDTH = 1200;
export const ROW_HEAD_WIDTH = 64;
export const OVERSCAN_ROWS = 8;
export const OVERSCAN_COLS = 3;

interface RenderWindow {
  /** First document row of the scrolling region rendered (inclusive). */
  rowStart: number;
  /** One past the last document row rendered (exclusive). */
  rowEnd: number;
  colStart: number;
  colEnd: number;
  /** Row-height revision this window was computed against (see heightsVersion). */
  heights: number;
}

/**
 * Compute an auto-fit column width from measured content widths (visible cell
 * widths plus the header), clamped to [min, max]. The result is the width the
 * widest measured content needs — it may be **narrower or wider** than the
 * column's current width, so auto-fit both grows and shrinks. Extracted as a
 * pure function so the grow/shrink/clamp behavior is unit-testable without a
 * DOM (real measurement uses `scrollWidth`).
 */
export function autoFitWidth(contentWidths: number[], min = MIN_COL_WIDTH, max = MAX_COL_WIDTH): number {
  let needed = min;
  for (const w of contentWidths) {
    if (w > needed) {
      needed = w;
    }
  }
  return Math.max(min, Math.min(max, needed));
}

/** Cap of off-screen rows measured per auto-fit (documented sampling budget). */
export const AUTOFIT_SAMPLE_BUDGET = 1000;

export interface AutoFitInput {
  rowCount: number;
  /** Visible header text of the column (always measured). */
  header: string;
  /** Displayed cell text (formula cells contribute their calculated values). */
  getDisplayValue(row: number): string;
  /** Rows currently materialized in the virtualized grid (measured first). */
  visibleRows: number[];
  /** Text width in px under the active sheet font/size/spacing. */
  measure(text: string): number;
  /** Non-text horizontal chrome of a cell (padding + borders) in px. */
  cellChrome: number;
  /** Non-text horizontal chrome of the header (padding + resize handle) in px. */
  headerChrome: number;
  /** Maximum number of off-screen rows to sample (0 disables sampling). */
  sampleBudget: number;
  min?: number;
  max?: number;
}

export interface AutoFitResult {
  /** Clamped target width in px. */
  width: number;
  /** How many data rows were actually measured. */
  measuredRows: number;
  /** True when the width is based on a sample, not every row. */
  sampled: boolean;
}

/**
 * Plan an auto-fit width from *measured text widths* of the displayed values
 * (never character counts or average-width guesses). All currently visible
 * rows are measured, plus a deterministic, evenly spaced sample of off-screen
 * rows up to `sampleBudget` — the whole column is never rendered or measured
 * synchronously for large sheets. The result is recomputed from the current
 * content on every call (nothing is cached), so it freely shrinks as well as
 * grows and can never retain a stale historic maximum; font, locale, or
 * content changes are picked up on the next invocation automatically.
 */
export function planAutoFit(input: AutoFitInput): AutoFitResult {
  const min = input.min ?? MIN_COL_WIDTH;
  const max = input.max ?? MAX_COL_WIDTH;
  let needed = input.measure(input.header) + input.headerChrome;
  const rows = new Set<number>();
  for (const r of input.visibleRows) {
    if (r >= 0 && r < input.rowCount) {
      rows.add(r);
    }
  }
  if (input.sampleBudget > 0 && rows.size < input.rowCount) {
    // Deterministic, evenly spaced sample across the whole column so short
    // and long regions are both represented.
    const budget = Math.min(input.sampleBudget, input.rowCount);
    const step = input.rowCount / budget;
    for (let k = 0; k < budget; k++) {
      rows.add(Math.min(input.rowCount - 1, Math.floor(k * step)));
    }
  }
  let measuredRows = 0;
  for (const r of rows) {
    const w = input.measure(input.getDisplayValue(r)) + input.cellChrome;
    if (w > needed) {
      needed = w;
    }
    measuredRows += 1;
  }
  return {
    width: Math.max(min, Math.min(max, Math.ceil(needed))),
    measuredRows,
    sampled: measuredRows < input.rowCount,
  };
}

export interface MultiAutoFitOptions {
  /** Called between columns of a yielding run (done columns, total columns). */
  onProgress?: (done: number, total: number) => void;
  /** Checked after each yield; return true to abandon the remaining columns. */
  shouldStop?: () => boolean;
  /** Yield to the browser between columns (used for genuinely large jobs). */
  yieldBetween?: boolean;
}

export interface MultiAutoFitResult {
  /** Per-column plans, keyed by column index (partial when not completed). */
  plans: Map<number, AutoFitResult>;
  /** False when `shouldStop` abandoned the run — apply nothing in that case. */
  completed: boolean;
}

/**
 * Plan auto-fit widths for several columns. Every column is measured
 * independently with {@link planAutoFit} (its own header, displayed values,
 * and sampling), so each column can shrink or grow on its own. Large jobs
 * yield to the browser between columns and report per-column progress; a
 * cancelled run returns `completed: false` and its partial plans must be
 * discarded, so widths are only ever applied all-or-nothing.
 */
export async function planAutoFitColumns(
  cols: number[],
  makeInput: (col: number) => AutoFitInput,
  opts: MultiAutoFitOptions = {},
): Promise<MultiAutoFitResult> {
  const plans = new Map<number, AutoFitResult>();
  for (let i = 0; i < cols.length; i++) {
    if (opts.yieldBetween && i > 0) {
      opts.onProgress?.(i, cols.length);
      await yieldToBrowser();
      if (opts.shouldStop?.()) {
        return { plans, completed: false };
      }
    }
    plans.set(cols[i], planAutoFit(makeInput(cols[i])));
  }
  return { plans, completed: true };
}

/**
 * Create a text measurer configured from an element's *computed* style via
 * `CanvasRenderingContext2D.measureText` — the same font family, size,
 * weight, and style the grid actually renders with (letter spacing is added
 * per character; CSS box chrome is accounted for separately by the caller).
 * Returns null where no 2D canvas context exists (e.g. jsdom); callers fall
 * back to DOM `scrollWidth` measurement there.
 */
export function createTextMeasurer(sample: Element): ((text: string) => number) | null {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.measureText !== 'function') {
    return null;
  }
  const cs = getComputedStyle(sample);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const spacing = Number.parseFloat(cs.letterSpacing);
  const extra = Number.isFinite(spacing) && spacing > 0 ? spacing : 0;
  return (text: string) => ctx.measureText(text).width + extra * text.length;
}

/**
 * Layout inputs that require a full window rebuild when they change. While
 * the signature is stable, a document mutation only repaints the already
 * rendered cells in place (no DOM teardown), so a single-cell edit never
 * rebuilds the visible grid.
 */
interface LayoutSignature {
  doc: unknown;
  rows: number;
  cols: number;
  wrap: boolean;
  /** Active sheet font signature — changing it re-measures wrapped heights. */
  font: string;
  sticky: boolean;
  locale: string;
  /** Spreadsheet zoom percent — changing it rescales every grid metric. */
  zoom: number;
}

/**
 * Leading-edge per-frame coalescing for high-frequency pointer events (drag
 * selection, column resizing, fill preview). The first event applies
 * immediately for instant feedback; further events within the same frame
 * only remember the latest argument, which is applied on the next frame.
 */
function frameCoalesced<T>(apply: (arg: T) => void): (arg: T) => void {
  let queued: { arg: T } | null = null;
  let scheduled = false;
  return (arg: T) => {
    if (scheduled) {
      queued = { arg };
      return;
    }
    apply(arg);
    scheduled = true;
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame;
    const schedule = typeof raf === 'function' ? raf : (fn: () => void) => setTimeout(fn, 16);
    schedule(() => {
      scheduled = false;
      if (queued) {
        const { arg: latest } = queued;
        queued = null;
        apply(latest);
      }
    });
  };
}

const CONTEXT_MENU_ITEMS: Array<{ command: CommandId; labelKey: string } | 'separator'> = [
  { command: 'edit.copy', labelKey: 'menu.edit.copy' },
  { command: 'edit.paste', labelKey: 'menu.edit.paste' },
  { command: 'edit.selectAll', labelKey: 'menu.edit.selectAll' },
  { command: 'edit.insertCopiedCells', labelKey: 'menu.edit.insertCopiedCells' },
  { command: 'edit.insertCopiedRows', labelKey: 'menu.edit.insertCopiedRows' },
  { command: 'edit.insertCopiedCols', labelKey: 'menu.edit.insertCopiedCols' },
  { command: 'edit.flashFill', labelKey: 'menu.edit.flashFill' },
  { command: 'edit.revertCell', labelKey: 'menu.edit.revertCell' },
  'separator',
  { command: 'sheet.insertRowAbove', labelKey: 'menu.sheet.insertRowAbove' },
  { command: 'sheet.insertRowBelow', labelKey: 'menu.sheet.insertRowBelow' },
  { command: 'sheet.deleteRows', labelKey: 'menu.sheet.deleteRows' },
  'separator',
  { command: 'sheet.insertColLeft', labelKey: 'menu.sheet.insertColLeft' },
  { command: 'sheet.insertColRight', labelKey: 'menu.sheet.insertColRight' },
  { command: 'sheet.deleteCols', labelKey: 'menu.sheet.deleteCols' },
  'separator',
  { command: 'sheet.autoFitCols', labelKey: 'menu.sheet.autoFitCols' },
];

/**
 * Virtualized CSV/RSF grid. Only the visible rows and columns (plus a small
 * overscan region) exist in the DOM, so files with hundreds of thousands of
 * rows never materialize millions of cells. The column header row is always
 * sticky; the first record row can optionally be pinned below it (visually
 * distinct from the header). All cell content is rendered via textContent,
 * never as HTML.
 */
export class Grid {
  readonly element: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly headerEl: HTMLElement;
  private readonly stickyEl: HTMLElement;
  private readonly rowsLayer: HTMLElement;
  private readonly emptyEl: HTMLElement;

  private lastDoc: unknown = null;
  private window: RenderWindow | null = null;
  private layout: LayoutSignature | null = null;
  /**
   * Variable row heights keyed by the *document* object (empty/uniform unless
   * wrapping grows rows). Keying by the document means a replaced document
   * (convert/save/reopen) automatically starts from a fresh, correct index.
   */
  private readonly rowHeights = new WeakMap<object, RowHeightIndex>();
  /** Bumped whenever any row height changes, so the render window rebuilds. */
  private heightsVersion = 0;
  /** Offscreen measuring cell for font/chrome metrics (never shows content). */
  private readonly measureCell: HTMLElement;
  /** Layout signature the off-screen wrap-measure pass is running for, if any. */
  private wrapPassSig: string | null = null;
  /** Stable ids per document object, so a wrap pass restarts on a new document. */
  private readonly docIds = new WeakMap<object, number>();
  private nextDocId = 1;
  /** Test seam: a deterministic text measurer that bypasses canvas metrics. */
  private measurerOverride: WrapMeasure | null = null;
  /** Cached canvas measurer, reused across frames until the font changes. */
  private cachedMeasurer: { sig: string; measure: WrapMeasure; chrome: number } | null = null;
  /** The top-left corner Select-All control (rebuilt each full render). */
  private cornerButton: HTMLElement | null = null;
  private editor: {
    row: number;
    col: number;
    input: HTMLTextAreaElement;
    autocomplete: FormulaAutocomplete;
    ref: FormulaFieldRef;
    prevRefTarget: FormulaRefTarget | null;
    /** Re-derives the highlighted formula references from the field value. */
    updateRefs: () => void;
  } | null = null;
  /**
   * The grid's real keyboard target: a permanently mounted, visually hidden
   * textarea that keeps focus while navigating. An IME composition begun on a
   * selected cell therefore starts INSIDE an editable element, and typing
   * promotes this same element in place into the visible cell editor — never
   * re-parented, never re-focused — so the first keystroke of a Japanese
   * Romaji sequence composes correctly instead of leaking a literal Latin
   * letter into the cell.
   */
  private readonly sink: HTMLTextAreaElement;
  /** Hidden description element backing the inline editor's help tooltip. */
  private readonly editorHint: HTMLElement;
  /** True between compositionstart and compositionend on the sink (IME is composing). */
  private composing = false;
  private contextMenu: HTMLElement | null = null;
  private dragging = false;
  private scrollScheduled = false;
  /** Active column-resize drag, if any. */
  private resizing: { col: number; startX: number; startWidth: number } | null = null;
  /** Active fill-handle drag, if any. */
  private filling: { source: CellRange; target: { row: number; col: number } } | null = null;
  /** Active whole-row / whole-column header drag, if any. */
  private headerDrag: { axis: 'row' | 'col'; anchor: number; last: number } | null = null;
  /** Active pointer reference entry into a formula editor, if any. */
  private refDrag: { anchor: { row: number; col: number } } | null = null;
  /** Ranges referenced by the formula currently being edited (highlighted). */
  private formulaRefs: FormulaRefRange[] = [];
  /** Floating note shown when a referenced range extends beyond the viewport. */
  private readonly refIndicator: HTMLElement;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    this.element = el('div', {
      className: 'grid-container',
      attrs: { tabindex: '0', role: 'grid' },
    });
    this.refIndicator = el('div', {
      className: 'ref-indicator',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.refIndicator.hidden = true;
    document.body.append(this.refIndicator);
    this.canvas = el('div', { className: 'vgrid-canvas' });
    this.headerEl = el('div', { className: 'vgrid-header', attrs: { role: 'row' } });
    this.stickyEl = el('div', { className: 'vgrid-stickyrow', attrs: { role: 'row' } });
    this.rowsLayer = el('div', { className: 'vgrid-rows' });
    this.emptyEl = el('div', { className: 'grid-empty' });
    // Hidden probe carrying the real cell font/box metrics (same `.vcell`
    // styling the grid renders with) so wrap measurement never depends on a
    // materialized cell being present.
    this.measureCell = el('div', {
      className: 'vcell vgrid-measure',
      attrs: { 'aria-hidden': 'true' },
    });
    this.sink = el('textarea', {
      className: 'grid-sink',
      attrs: {
        rows: '1',
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        tabindex: '-1',
        'aria-label': t('grid.label'),
      },
    });
    // Visually hidden, ARIA-linked editing guidance for the inline editor
    // (the visible tooltip is the `title` attribute; both follow the
    // editing-help preference and never obscure the cell or caret).
    this.editorHint = el('span', {
      className: 'visually-hidden',
      attrs: { id: 'grid-editor-hint' },
    });
    this.canvas.append(this.headerEl, this.stickyEl, this.rowsLayer, this.measureCell, this.sink);
    this.element.append(this.canvas, this.editorHint);

    // Scroll never calls preventDefault, so the listener is passive (the
    // browser can start compositor scrolling without waiting on the handler).
    this.element.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.element.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.element.addEventListener('mousemove', (event) => this.onMouseMove(event));
    this.element.addEventListener('dblclick', (event) => this.onDoubleClick(event));
    this.element.addEventListener('contextmenu', (event) => this.onContextMenu(event));
    document.addEventListener('mousemove', (event) => this.onResizeMove(event));
    document.addEventListener('mouseup', () => {
      this.dragging = false;
      this.headerDrag = null;
      this.endResize();
      this.endFill();
      this.endRefDrag();
    });
    document.addEventListener('mousedown', (event) => {
      if (this.contextMenu && !this.contextMenu.contains(event.target as Node)) {
        this.closeContextMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeContextMenu();
    });

    // ----- IME-safe keyboard target (the sink) -----
    // Focusing the grid container (tab stop, corner clicks, cell clicks)
    // forwards focus into the sink so keystrokes and IME compositions always
    // target an editable element.
    this.element.addEventListener('focus', () => this.focusGrid());
    this.sink.addEventListener('compositionstart', () => {
      this.composing = true;
      // A composition that starts while navigating promotes the sink into the
      // cell editor in place (no focus change, no value reset) so the composed
      // text lands in the cell — including engines that fire no keydown first.
      if (!this.editor) {
        this.beginTypedEdit();
      }
    });
    this.sink.addEventListener('compositionend', () => {
      this.composing = false;
      if (this.editor) {
        // Composition committed text; refresh completions/highlights from it.
        this.editor.autocomplete.update();
        this.editor.updateRefs();
      } else {
        // A composition that never had a target cell leaves no stray text.
        this.sink.value = '';
      }
    });
    this.sink.addEventListener('beforeinput', (event) => {
      // Text about to be inserted while no editor is open (an engine that
      // fires neither keydown 229 nor compositionstart first) still promotes
      // the sink before the value changes. Never synthesized from keydown.
      if (!this.editor && event.inputType.startsWith('insert')) {
        this.beginTypedEdit();
      }
    });
    this.sink.addEventListener('keydown', (event) => this.sinkKeyDown(event));
    this.sink.addEventListener('input', () => this.sinkInput());
    this.sink.addEventListener('click', () => this.editor?.autocomplete.update());
    this.sink.addEventListener('blur', () => this.commitEditor());
  }

  /** Focus the grid's keyboard target (the hidden IME-capturing sink). */
  focusGrid(): void {
    this.sink.focus({ preventScroll: true });
  }

  /** Promote the focused sink into an empty cell editor for type-to-edit. */
  private beginTypedEdit(): void {
    const tab = this.state.activeTab;
    if (tab?.selection && !this.editor) {
      this.openEditor(tab, tab.selection.row, tab.selection.col, '');
    }
  }

  // ----- Metrics -----
  // All pixel metrics are zoom-aware: the tab's zoom percent scales the
  // default row height, header width, wrap line height, and column widths.
  // Column widths are *stored* at 100% zoom (per-tab session state; persisted
  // by RSF documents) and only *rendered* scaled, so a saved width means the
  // same thing at every zoom level.

  /** The active tab's zoom factor (1 = 100%). */
  private zoomOf(tab: Tab): number {
    return (tab.zoom || 100) / 100;
  }

  /** Zoomed default (single-line) row height in px. */
  private rowH(tab: Tab): number {
    return Math.round(ROW_HEIGHT * this.zoomOf(tab));
  }

  /** Zoomed wrapped-line box height in px. */
  private wrapLineH(tab: Tab): number {
    return Math.round(WRAP_LINE_HEIGHT * this.zoomOf(tab));
  }

  /** Zoomed vertical padding around wrapped lines in px. */
  private wrapPad(tab: Tab): number {
    return Math.round(WRAP_VERTICAL_PAD * this.zoomOf(tab));
  }

  /** Zoomed row-header width in px. */
  private headW(tab: Tab): number {
    return Math.round(ROW_HEAD_WIDTH * this.zoomOf(tab));
  }

  /** Zoom the row-height index was built for, per document. */
  private readonly indexZoom = new WeakMap<object, number>();

  /** The per-tab row-height index (created lazily; uniform until wrapping grows a row). */
  private heightIndex(tab: Tab): RowHeightIndex {
    let index = this.rowHeights.get(tab.doc);
    if (!index || this.indexZoom.get(tab.doc) !== tab.zoom) {
      // A zoom change invalidates every cached height (the uniform default
      // and any wrapped measurements), so the index starts fresh.
      index = new RowHeightIndex(this.rowH(tab));
      this.rowHeights.set(tab.doc, index);
      this.indexZoom.set(tab.doc, tab.zoom);
      this.heightsVersion += 1;
    }
    return index;
  }

  /**
   * Test seam: install a deterministic text measurer so wrapping can be
   * exercised without a real 2D canvas (jsdom returns none). Pass null to
   * restore canvas-based measurement. Also clears cached heights so the next
   * render re-measures with the new measurer.
   */
  setTextMeasurer(measure: WrapMeasure | null): void {
    this.measurerOverride = measure;
    this.cachedMeasurer = null;
    this.wrapPassSig = null;
    for (const tab of this.state.tabs) {
      this.rowHeights.get(tab.doc)?.clear();
    }
    this.heightsVersion += 1;
  }

  private stickyEnabled(tab: Tab): boolean {
    return this.state.stickyFirstRow && tab.doc.rowCount > 0;
  }

  /** First document row of the scrolling region. */
  private scrollRowBase(tab: Tab): number {
    return this.stickyEnabled(tab) ? 1 : 0;
  }

  /**
   * Height of the sticky overlays (header + optional pinned first row). Both
   * overlays are always single-line so the pinned area stays a stable height
   * even when data rows below wrap to several lines.
   */
  private overlayHeight(tab: Tab): number {
    return this.rowH(tab) * (this.stickyEnabled(tab) ? 2 : 1);
  }

  /** Rendered pixel width of a column (per-tab override or default, zoomed). */
  private colWidth(tab: Tab, col: number): number {
    const w = tab.colWidths[col];
    return Math.round((w && w > 0 ? w : COL_WIDTH) * this.zoomOf(tab));
  }

  /** X offset (from the first column) of column `col`, i.e. the summed widths before it. */
  private colOffset(tab: Tab, col: number): number {
    let x = 0;
    for (let c = 0; c < col; c++) {
      x += this.colWidth(tab, c);
    }
    return x;
  }

  private totalColsWidth(tab: Tab): number {
    const cols = Math.max(1, tab.doc.columnCount);
    let x = 0;
    for (let c = 0; c < cols; c++) {
      x += this.colWidth(tab, c);
    }
    return x;
  }

  private totalWidth(tab: Tab): number {
    return this.headW(tab) + this.totalColsWidth(tab);
  }

  // ----- Rendering -----

  refresh(): void {
    const tab = this.state.activeTab;
    this.element.setAttribute('aria-label', t('grid.label'));
    if (!tab || tab.doc.rowCount === 0) {
      this.lastDoc = null;
      this.closeEditor(false);
      this.window = null;
      this.layout = null;
      this.closeContextMenu();
      clearChildren(this.headerEl);
      clearChildren(this.stickyEl);
      clearChildren(this.rowsLayer);
      this.canvas.style.width = '';
      this.canvas.style.height = '';
      this.emptyEl.textContent = t('grid.empty');
      if (!this.emptyEl.parentElement) {
        this.element.append(this.emptyEl);
      }
      return;
    }
    this.emptyEl.remove();
    if (tab.doc !== this.lastDoc) {
      this.closeEditor(false);
      this.closeContextMenu();
      this.element.scrollTop = 0;
      this.element.scrollLeft = 0;
      this.lastDoc = tab.doc;
    }
    // Only rebuild the rendered window when a layout input changed (document
    // identity, dimensions, row height, sticky mode, locale). A plain cell
    // edit keeps the signature stable, so `render` repaints the existing DOM
    // in place — no teardown, no layout shift, no focus loss.
    if (!this.sameLayout(tab)) {
      this.window = null; // force rebuild
    }
    this.render(tab);
  }

  private layoutSignature(tab: Tab): LayoutSignature {
    return {
      doc: tab.doc,
      rows: tab.doc.rowCount,
      cols: tab.doc.columnCount,
      wrap: this.state.wrapCells,
      font: this.fontSignature(),
      sticky: this.stickyEnabled(tab),
      locale: getLocale(),
      zoom: tab.zoom,
    };
  }

  private sameLayout(tab: Tab): boolean {
    const a = this.layout;
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
      a.locale === b.locale &&
      a.zoom === b.zoom
    );
  }

  /** Font family + size the grid currently measures/renders with. */
  private fontSignature(): string {
    if (typeof getComputedStyle !== 'function') {
      return '';
    }
    const cs = getComputedStyle(this.measureCell);
    return `${cs.fontFamily}|${cs.fontSize}|${cs.letterSpacing}`;
  }

  /** Update selection highlighting only (cheap; used for selection events). */
  refreshSelection(): void {
    const tab = this.state.activeTab;
    if (!tab || tab.doc !== this.lastDoc) {
      return;
    }
    const range = this.state.selectedRange(tab);
    const active = tab.selection;
    const anchor = tab.anchor;
    const kind = tab.selectionKind;
    // Container-level classes let CSS present whole-row / whole-column /
    // whole-sheet selections distinctly from an ordinary cell range.
    const whole =
      range !== null &&
      range.top === 0 &&
      range.left === 0 &&
      range.bottom === tab.doc.rowCount - 1 &&
      range.right === tab.doc.columnCount - 1 &&
      (tab.doc.rowCount > 1 || tab.doc.columnCount > 1);
    this.element.classList.toggle('sel-rows', kind === 'row');
    this.element.classList.toggle('sel-cols', kind === 'col');
    this.element.classList.toggle('sel-all', whole);
    this.syncCorner();
    const cells = this.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]');
    for (const cell of cells) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const inRange = range !== null && rangeContains(range, row, col);
      const isActive = active !== null && active.row === row && active.col === col;
      // The anchor is the opposite corner of a multi-cell range; mark it
      // distinctly from the active cell (but only when they differ).
      const isAnchor =
        anchor !== null && anchor.row === row && anchor.col === col && !isActive && range !== null;
      cell.classList.toggle('in-range', inRange && !isActive);
      cell.classList.toggle('selected', isActive);
      cell.classList.toggle('anchor', isAnchor);
      if (isActive) {
        cell.setAttribute('aria-selected', 'true');
      } else {
        cell.removeAttribute('aria-selected');
      }
    }
    const rows = this.canvas.querySelectorAll<HTMLElement>('.vgrid-row, .vgrid-stickyrow');
    for (const rowEl of rows) {
      const row = Number(rowEl.dataset.row);
      const inSelRows = range !== null && kind === 'row' && row >= range.top && row <= range.bottom;
      rowEl.classList.toggle('selected-row', inSelRows || (active !== null && active.row === row));
    }
    // Highlight the row/column headers intersecting the selection so whole-row
    // and whole-column selections read clearly even outside the data cells.
    for (const head of this.canvas.querySelectorAll<HTMLElement>('[data-rowhead]')) {
      const row = Number(head.dataset.rowhead);
      head.classList.toggle('hdr-sel', range !== null && row >= range.top && row <= range.bottom);
    }
    for (const head of this.headerEl.querySelectorAll<HTMLElement>('[data-colhead]')) {
      const col = Number(head.dataset.colhead);
      head.classList.toggle('hdr-sel', range !== null && col >= range.left && col <= range.right);
    }
    this.placeFillHandle(tab, range);
    this.positionSink();
  }

  /** Put the fill handle on the bottom-right cell of the current selection. */
  private placeFillHandle(tab: Tab, range: CellRange | null): void {
    for (const old of this.canvas.querySelectorAll('.fill-handle')) {
      old.remove();
    }
    if (!range || tab.doc.rowCount === 0) {
      return;
    }
    const cell = this.cellAt(range.bottom, range.right);
    if (!cell) {
      return; // the corner is scrolled out of view
    }
    const handle = el('div', {
      className: 'fill-handle',
      attrs: { 'data-fillhandle': 'true', 'aria-hidden': 'true', title: t('grid.fillTitle') },
    });
    cell.append(handle);
  }

  private onScroll(): void {
    if (this.scrollScheduled) {
      return;
    }
    this.scrollScheduled = true;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: () => void) => setTimeout(fn, 16);
    schedule(() => {
      this.scrollScheduled = false;
      const tab = this.state.activeTab;
      if (!tab || tab.doc !== this.lastDoc) {
        return;
      }
      this.render(tab);
    });
  }

  private computeWindow(tab: Tab): RenderWindow {
    const idx = this.heightIndex(tab);
    const overlay = this.overlayHeight(tab);
    const viewH = Math.max(0, this.element.clientHeight - overlay);
    const viewW = Math.max(0, this.element.clientWidth - this.headW(tab));
    const scrollTop = this.element.scrollTop;
    const scrollLeft = this.element.scrollLeft;
    const rowCount = tab.doc.rowCount;
    const startRow = this.scrollRowBase(tab);
    const totalCols = Math.max(1, tab.doc.columnCount);
    // Row window from the height index: the scroll layer's content origin is
    // the top of the first scroll row, so add its offset to scrollTop. With a
    // uniform (unwrapped) index this reduces exactly to floor(scrollTop / H).
    const originY = idx.offsetOf(startRow);
    const first = Math.max(startRow, idx.rowAtOffset(originY + scrollTop, rowCount));
    const last = idx.rowAtOffset(originY + scrollTop + viewH, rowCount) + 1;
    const rowStart = Math.max(startRow, first - OVERSCAN_ROWS);
    const rowEnd = Math.min(rowCount, last + OVERSCAN_ROWS);
    // Columns have per-column widths, so walk them to find the visible range.
    let firstVisible = 0;
    let x = 0;
    while (firstVisible < totalCols && x + this.colWidth(tab, firstVisible) <= scrollLeft) {
      x += this.colWidth(tab, firstVisible);
      firstVisible += 1;
    }
    const limit = scrollLeft + viewW;
    let lastVisible = firstVisible;
    while (lastVisible < totalCols && x < limit) {
      x += this.colWidth(tab, lastVisible);
      lastVisible += 1;
    }
    const colStart = Math.max(0, firstVisible - OVERSCAN_COLS);
    const colEnd = Math.min(totalCols, lastVisible + OVERSCAN_COLS);
    return { rowStart, rowEnd, colStart, colEnd, heights: this.heightsVersion };
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

  private render(tab: Tab): void {
    // Never disrupt an active IME composition: any rebuild would tear the
    // focused editor out of the DOM mid-composition and drop it. Background
    // work (the wrap-measure pass, scroll coalescing) that calls render while
    // the user is composing simply defers until composition ends.
    if (this.editor && this.composing) {
      return;
    }
    const doc = tab.doc;
    const idx = this.heightIndex(tab);
    // Conditional wrapping: measure the rows about to be shown so their heights
    // are exact *now* (immediate correctness for the visible region), recompute
    // the window against the corrected offsets, and let the off-screen rows be
    // filled in incrementally. Without a measurer (wrapping off, or no canvas
    // metrics) every row keeps the single-line height.
    const measurer = this.state.wrapCells ? this.buildWrapMeasurer() : null;
    if (!measurer) {
      idx.clear();
      this.wrapPassSig = null;
    }
    let win = this.computeWindow(tab);
    if (measurer) {
      this.measureWindowRows(tab, win, measurer, idx);
      win = this.computeWindow(tab);
      this.scheduleWrapPass(tab, measurer);
    }
    if (this.sameWindow(this.window, win)) {
      this.paintWindowCells(tab);
      this.refreshSelection();
      this.refreshFormulaRefs();
      return;
    }
    if (this.editor) {
      // The editor's cell may be about to leave the window; commit first.
      this.commitEditor();
    }
    this.window = win;
    this.layout = this.layoutSignature(tab);

    const totalW = this.totalWidth(tab);
    const startRow = this.scrollRowBase(tab);
    const originY = idx.offsetOf(startRow);
    const layerHeight = idx.rangeHeight(startRow, doc.rowCount);
    // Zoom is applied through CSS custom properties (font sizes, line boxes)
    // plus the scaled JS metrics; the JS-computed row height stays the source
    // of truth so CSS line heights and element heights can never drift apart.
    this.element.style.setProperty('--sheet-zoom', String(this.zoomOf(tab)));
    this.element.style.setProperty('--grid-row-height', `${this.rowH(tab)}px`);
    this.element.style.setProperty('--grid-wrap-line', `${this.wrapLineH(tab)}px`);
    document.documentElement.style.setProperty('--sheet-zoom', String(this.zoomOf(tab)));
    this.canvas.style.width = `${totalW}px`;
    this.canvas.style.height = `${this.overlayHeight(tab) + layerHeight}px`;
    this.element.setAttribute('aria-rowcount', String(doc.rowCount + 1));
    this.element.setAttribute('aria-colcount', String(doc.columnCount + 1));

    // ----- Column header (always sticky, single-line) -----
    clearChildren(this.headerEl);
    this.headerEl.style.width = `${totalW}px`;
    this.headerEl.style.height = `${this.rowH(tab)}px`;
    this.headerEl.append(this.buildCorner(tab));
    const headSpacer = el('div', { className: 'vspacer', attrs: { 'aria-hidden': 'true' } });
    headSpacer.style.width = `${this.colOffset(tab, win.colStart)}px`;
    this.headerEl.append(headSpacer);
    for (let c = win.colStart; c < win.colEnd; c++) {
      const head = el('div', {
        className: 'vcell vhead',
        text: columnLabel(c),
        attrs: {
          role: 'columnheader',
          'data-colhead': String(c),
          title: t('grid.colTitle', { letter: columnLabel(c), n: c + 1 }),
        },
      });
      head.style.width = `${this.colWidth(tab, c)}px`;
      // Draggable boundary to resize; double-click auto-fits to visible content.
      const handle = el('div', {
        className: 'col-resize-handle',
        attrs: { 'data-colresize': String(c), 'aria-hidden': 'true', title: t('grid.resizeTitle') },
      });
      head.append(handle);
      this.headerEl.append(head);
    }

    // ----- Sticky first record row (optional, single-line, distinct) -----
    clearChildren(this.stickyEl);
    if (this.stickyEnabled(tab)) {
      this.stickyEl.hidden = false;
      this.stickyEl.style.width = `${totalW}px`;
      this.stickyEl.style.height = `${this.rowH(tab)}px`;
      this.stickyEl.style.top = `${this.rowH(tab)}px`;
      this.stickyEl.dataset.row = '0';
      this.stickyEl.setAttribute('aria-rowindex', '2');
      this.buildRowCells(tab, this.stickyEl, 0, win, true);
    } else {
      this.stickyEl.hidden = true;
      delete this.stickyEl.dataset.row;
    }

    // ----- Virtualized data rows (variable height) -----
    clearChildren(this.rowsLayer);
    this.rowsLayer.style.height = `${layerHeight}px`;
    for (let row = win.rowStart; row < win.rowEnd; row++) {
      const height = idx.heightOf(row);
      const wrapped = height > this.rowH(tab);
      const rowEl = el('div', {
        className: `vgrid-row ${row % 2 === 1 ? 'alt' : ''}${wrapped ? ' wrapped' : ''}`,
        attrs: { role: 'row', 'data-row': String(row), 'aria-rowindex': String(row + 2) },
      });
      rowEl.style.top = `${idx.offsetOf(row) - originY}px`;
      rowEl.style.height = `${height}px`;
      rowEl.style.width = `${totalW}px`;
      this.buildRowCells(tab, rowEl, row, win, false);
      this.rowsLayer.append(rowEl);
    }
    this.refreshSelection();
    this.refreshFormulaRefs();
  }

  // ----- Conditional row-height wrapping -----

  /**
   * Build a text measurer + horizontal cell chrome for wrap measurement, or
   * null when no measurement is possible (no 2D canvas, e.g. jsdom, and no test
   * override). The measurer reports rendered pixel widths under the active
   * sheet font — wrapping is never decided from character or byte counts.
   */
  private buildWrapMeasurer(): { measure: WrapMeasure; chrome: number } | null {
    if (this.measurerOverride) {
      return { measure: this.measurerOverride, chrome: this.horizontalChrome() };
    }
    const sig = this.fontSignature();
    if (this.cachedMeasurer && this.cachedMeasurer.sig === sig) {
      return this.cachedMeasurer;
    }
    const measure = createTextMeasurer(this.measureCell);
    if (!measure) {
      return null;
    }
    this.cachedMeasurer = { sig, measure, chrome: this.horizontalChrome() };
    return this.cachedMeasurer;
  }

  /** Horizontal chrome (padding + left/right borders) of a cell box, in px. */
  private horizontalChrome(): number {
    if (typeof getComputedStyle !== 'function') {
      return 0;
    }
    const cs = getComputedStyle(this.measureCell);
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
   * needs more than one visual line exceed the single-line height. The pinned
   * sticky row is always single-line.
   */
  private computeRowHeight(tab: Tab, row: number, measure: WrapMeasure, chrome: number): number {
    if (this.stickyEnabled(tab) && row === 0) {
      return this.rowH(tab);
    }
    const doc = tab.doc;
    const fields = doc.fieldCount(row);
    let maxLines = 1;
    for (let c = 0; c < fields; c++) {
      const contentWidth = this.colWidth(tab, c) - chrome;
      const lines = countVisualLines(doc.getDisplayValue(row, c), measure, contentWidth, MAX_WRAP_LINES);
      if (lines > maxLines) {
        maxLines = lines;
      }
      if (maxLines >= MAX_WRAP_LINES) {
        break;
      }
    }
    return rowHeightForLines(maxLines, this.rowH(tab), this.wrapLineH(tab), this.wrapPad(tab));
  }

  /** Measure every row of the current window into the index (bumps the version on any change). */
  private measureWindowRows(
    tab: Tab,
    win: RenderWindow,
    m: { measure: WrapMeasure; chrome: number },
    idx: RowHeightIndex,
  ): void {
    let changed = false;
    for (let row = win.rowStart; row < win.rowEnd; row++) {
      if (idx.set(row, this.computeRowHeight(tab, row, m.measure, m.chrome))) {
        changed = true;
      }
    }
    if (changed) {
      this.heightsVersion += 1;
    }
  }

  /** Stable identifier for a document object (so a pass restarts on a new doc). */
  private docToken(doc: unknown): number {
    let id = this.docIds.get(doc as object);
    if (id === undefined) {
      id = this.nextDocId++;
      this.docIds.set(doc as object, id);
    }
    return id;
  }

  /** Signature the off-screen wrap pass is keyed to (font/locale/dims/doc). */
  private layoutToken(tab: Tab): string {
    const s = this.layoutSignature(tab);
    return `${this.docToken(tab.doc)}|${s.rows}x${s.cols}|${s.wrap}|${s.font}|${s.sticky}|${s.locale}|${s.zoom}`;
  }

  /**
   * Start (once) an incremental pass that measures every off-screen row's
   * height in cooperative time slices, so the scroll extent and off-screen
   * offsets become exact without a synchronous full-document loop. Idempotent
   * per layout: it no-ops while a pass for the same signature is already
   * running or finished, and restarts when the document, dimensions, font,
   * locale, or wrap mode change (which invalidate cached heights).
   */
  private scheduleWrapPass(tab: Tab, m: { measure: WrapMeasure; chrome: number }): void {
    const sig = this.layoutToken(tab);
    if (this.wrapPassSig === sig) {
      return;
    }
    this.wrapPassSig = sig;
    void this.runWrapPass(tab, m, sig);
  }

  private async runWrapPass(
    tab: Tab,
    m: { measure: WrapMeasure; chrome: number },
    sig: string,
  ): Promise<void> {
    const doc = tab.doc;
    const idx = this.heightIndex(tab);
    const startRow = this.scrollRowBase(tab);
    const total = doc.rowCount;
    const scrollRows = total - startRow;
    const large = scrollRows > WRAP_PASS_BUSY_ROWS;
    const current = () =>
      this.state.activeTab === tab && tab.doc === doc && this.state.wrapCells && this.wrapPassSig === sig;
    let dirty = false;
    if (large) {
      this.commands.setBusy(t('loading.wrapMeasure', { done: 0, total, pct: 0 }));
    }
    try {
      const ok = await forEachIndexSliced(
        total,
        (row) => {
          if (row < startRow) {
            return;
          }
          if (idx.set(row, this.computeRowHeight(tab, row, m.measure, m.chrome))) {
            dirty = true;
          }
        },
        {
          onProgress: (done) => {
            if (dirty) {
              this.heightsVersion += 1;
              this.updateScrollExtent(tab);
              dirty = false;
            }
            if (large) {
              const pct = Math.floor((done / total) * 100);
              this.commands.setBusy(t('loading.wrapMeasure', { done, total, pct }));
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
        this.commands.setBusy(null);
      }
    }
    // Re-lay-out once so every rendered row sits at its final measured height.
    if (dirty) {
      this.heightsVersion += 1;
    }
    this.window = null;
    this.render(tab);
  }

  /** Update only the scroll extent (scrollbar) as off-screen heights fill in. */
  private updateScrollExtent(tab: Tab): void {
    if (this.state.activeTab !== tab || tab.doc !== this.lastDoc) {
      return;
    }
    const idx = this.heightIndex(tab);
    const layerHeight = idx.rangeHeight(this.scrollRowBase(tab), tab.doc.rowCount);
    this.canvas.style.height = `${this.overlayHeight(tab) + layerHeight}px`;
    this.rowsLayer.style.height = `${layerHeight}px`;
  }

  /**
   * Invalidate cached row heights for a tab and restart the off-screen pass
   * (used after column-width changes / auto-fit, which change wrapping without
   * changing the layout signature).
   */
  private invalidateRowHeights(tab: Tab): void {
    if (!this.state.wrapCells) {
      return;
    }
    this.heightIndex(tab).clear();
    this.wrapPassSig = null;
    this.heightsVersion += 1;
  }

  /**
   * Build the interactive top-left corner Select All Cells control. It shows
   * no visible text by design (like conventional spreadsheet corner cells);
   * its purpose is conveyed by the localized accessible name and tooltip, and
   * its pressed state mirrors the whole-sheet selection.
   */
  private buildCorner(tab: Tab): HTMLElement {
    const corner = el('button', {
      className: 'vcell vhead vcorner',
      attrs: {
        type: 'button',
        'aria-label': t('grid.selectAllCorner'),
        title: t('grid.selectAllCorner'),
      },
    });
    corner.style.width = `${this.headW(tab)}px`;
    // Enter/Space activate natively; a pointer tap does the same. Focus the
    // grid afterward so keyboard navigation and copy keep working.
    corner.addEventListener('click', () => {
      this.focusGrid();
      void this.commands.run('edit.selectAll');
    });
    this.cornerButton = corner;
    this.syncCorner();
    return corner;
  }

  /** Reflect whole-sheet selection state onto the corner control for AT. */
  private syncCorner(): void {
    const corner = this.cornerButton;
    if (!corner) {
      return;
    }
    corner.setAttribute('aria-pressed', this.element.classList.contains('sel-all') ? 'true' : 'false');
  }

  // ----- Formula-reference highlighting -----

  /**
   * Highlight the given referenced ranges while a formula is being edited
   * (formula bar or inline editor). The highlight is fully separate from the
   * ordinary selection/active-cell rendering: it uses its own `fref-*`
   * classes, cycling through four visually distinct color + border-pattern
   * pairs (solid/dashed/dotted/double — never color alone). Pass an empty
   * array to clear. Only the currently rendered (virtualized) cells are
   * touched; a floating status note appears when a referenced range extends
   * beyond the rendered viewport.
   */
  setFormulaRefs(refs: FormulaRefRange[]): void {
    if (refs.length === 0 && this.formulaRefs.length === 0) {
      return;
    }
    this.formulaRefs = refs;
    this.refreshFormulaRefs();
  }

  private refreshFormulaRefs(): void {
    const tab = this.state.activeTab;
    const usable = tab !== null && tab.doc === this.lastDoc;
    const rows = usable ? tab.doc.rowCount : 0;
    const cols = usable ? tab.doc.columnCount : 0;
    // Whole-column / whole-row references clamp to the used grid.
    const ranges = (usable ? this.formulaRefs : [])
      .map((ref, i) => ({
        top: Math.max(0, ref.top),
        left: Math.max(0, ref.left),
        bottom: Math.min(ref.bottom, rows - 1),
        right: Math.min(ref.right, cols - 1),
        idx: i % 4,
      }))
      .filter((r) => r.top <= r.bottom && r.left <= r.right);
    for (const cell of this.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]')) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      let match: (typeof ranges)[number] | null = null;
      for (const r of ranges) {
        if (row >= r.top && row <= r.bottom && col >= r.left && col <= r.right) {
          match = r;
          break;
        }
      }
      cell.classList.toggle('fref', match !== null);
      for (let k = 0; k < 4; k++) {
        cell.classList.toggle(`fref-${k}`, match !== null && match.idx === k);
      }
      cell.classList.toggle('fref-top', match !== null && row === match.top);
      cell.classList.toggle('fref-bottom', match !== null && row === match.bottom);
      cell.classList.toggle('fref-left', match !== null && col === match.left);
      cell.classList.toggle('fref-right', match !== null && col === match.right);
    }
    this.updateRefIndicator(tab, ranges);
  }

  /** Show/hide the "reference extends beyond the visible area" status note. */
  private updateRefIndicator(
    tab: Tab | null,
    ranges: Array<{ top: number; bottom: number; left: number; right: number }>,
  ): void {
    const win = this.window;
    let clipped = false;
    if (tab && win && ranges.length > 0) {
      const base = this.scrollRowBase(tab);
      const firstRow = base + win.rowStart;
      const lastRow = base + win.rowEnd - 1;
      for (const r of ranges) {
        if (r.top < firstRow || r.bottom > lastRow || r.left < win.colStart || r.right > win.colEnd - 1) {
          clipped = true;
          break;
        }
      }
    }
    if (!clipped) {
      this.refIndicator.hidden = true;
      return;
    }
    this.refIndicator.textContent = t('grid.refsBeyond');
    const rect = this.element.getBoundingClientRect();
    this.refIndicator.style.left = `${rect.left + 8}px`;
    this.refIndicator.style.top = `${Math.max(0, rect.bottom - 34)}px`;
    this.refIndicator.hidden = false;
  }

  private buildRowCells(tab: Tab, rowEl: HTMLElement, row: number, win: RenderWindow, pinned: boolean): void {
    const doc = tab.doc;
    const head = el('div', {
      className: `vcell vrowhead${pinned ? ' pinned' : ''}`,
      text: pinned ? `📌 ${row + 1}` : String(row + 1),
      attrs: { role: 'rowheader', 'data-rowhead': String(row) },
    });
    if (pinned) {
      head.setAttribute('title', t('grid.stickyRowTitle'));
    }
    head.style.width = `${this.headW(tab)}px`;
    rowEl.append(head);
    const spacer = el('div', { className: 'vspacer', attrs: { 'aria-hidden': 'true' } });
    spacer.style.width = `${this.colOffset(tab, win.colStart)}px`;
    rowEl.append(spacer);
    const fieldCount = doc.fieldCount(row);
    for (let c = win.colStart; c < win.colEnd; c++) {
      if (c >= fieldCount) {
        const voidCell = el('div', { className: 'vcell void', attrs: { 'aria-hidden': 'true' } });
        voidCell.style.width = `${this.colWidth(tab, c)}px`;
        rowEl.append(voidCell);
        continue;
      }
      const cell = el('div', {
        className: 'vcell',
        attrs: {
          role: 'gridcell',
          'data-row': String(row),
          'data-col': String(c),
          'aria-colindex': String(c + 2),
        },
      });
      cell.style.width = `${this.colWidth(tab, c)}px`;
      this.paintCell(tab, cell, row, c);
      rowEl.append(cell);
    }
  }

  private paintCell(tab: Tab, cell: HTMLElement, row: number, col: number): void {
    const doc = tab.doc;
    const value = doc.getDisplayValue(row, col);
    if (cell.textContent !== value) {
      cell.textContent = value;
    }
    if (doc.kind === 'csv') {
      const field = doc.getField(row, col);
      const edited = doc.isEdited(row, col);
      cell.classList.toggle('edited', edited);
      cell.classList.toggle('malformed', field?.malformed ?? false);
      if (edited) {
        // Safe text-only tooltip showing the original value.
        cell.title = doc.getOriginalValue(row, col);
      } else if (cell.title !== '') {
        cell.removeAttribute('title');
      }
    } else {
      const formula = doc.isFormulaCell(row, col);
      cell.classList.toggle('formula', formula);
      const isError = formula && doc.evaluateCell(row, col).type === 'error';
      cell.classList.toggle('cell-error', isError);
      if (formula) {
        // Tooltip shows the underlying formula expression.
        cell.title = doc.getValue(row, col);
      } else if (cell.title !== '') {
        cell.removeAttribute('title');
      }
    }
  }

  /** Repaint the currently rendered cells in place (values/classes only). */
  private paintWindowCells(tab: Tab): void {
    const cells = this.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]');
    for (const cell of cells) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (this.editor && this.editor.row === row && this.editor.col === col) {
        continue; // never clobber the cell under an open inline editor
      }
      this.paintCell(tab, cell, row, col);
    }
  }

  // ----- Hit testing -----

  private cellFromEvent(event: Event): { row: number; col: number } | null {
    const target = event.target as HTMLElement | null;
    const cell = target?.closest<HTMLElement>('[data-row][data-col]');
    if (!cell) {
      return null;
    }
    return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
  }

  private cellAt(row: number, col: number): HTMLElement | null {
    return this.canvas.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
  }

  // ----- Mouse -----

  private onMouseDown(event: MouseEvent): void {
    const tab = this.state.activeTab;
    if (!tab || event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const resizeHandle = target?.closest<HTMLElement>('[data-colresize]');
    if (resizeHandle) {
      // Begin a column-resize drag (tracked via document mousemove/up).
      const col = Number(resizeHandle.dataset.colresize);
      this.commitEditor();
      this.resizing = { col, startX: event.clientX, startWidth: this.colWidth(tab, col) };
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (target?.closest<HTMLElement>('[data-fillhandle]')) {
      // Begin a fill-handle drag from the current selection.
      const range = this.state.selectedRange(tab);
      if (range) {
        this.commitEditor();
        this.filling = { source: range, target: { row: range.bottom, col: range.right } };
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    // While a formula is being edited, clicking/dragging cells enters
    // references into the formula instead of moving the grid selection. A
    // click on the inline editor's own input is left alone so the caret can be
    // positioned normally.
    const refTarget = this.state.formulaRefTarget;
    const onEditorInput = this.editor !== null && target === this.editor.input;
    if (refTarget?.isCapturing() && !onEditorInput) {
      const cell = this.cellFromEvent(event);
      if (cell) {
        // preventDefault keeps focus in the formula editor (no blur/commit).
        event.preventDefault();
        event.stopPropagation();
        this.refDrag = { anchor: cell };
        refTarget.beginRef();
        refTarget.setRef(cellLabel(cell.row, cell.col));
        return;
      }
    }
    const rowHead = target?.closest<HTMLElement>('[data-rowhead]');
    if (rowHead) {
      // Row header: whole-row selection. Shift+Click extends from the current
      // row-selection anchor; a plain click starts a row-header drag.
      const row = Number(rowHead.dataset.rowhead);
      this.commitEditor();
      if (event.shiftKey && tab.selectionKind === 'row' && tab.anchor) {
        this.selectRows(tab, tab.anchor.row, row);
      } else {
        this.selectRows(tab, row, row);
        this.headerDrag = { axis: 'row', anchor: row, last: row };
      }
      this.focusGrid();
      event.preventDefault();
      return;
    }
    const colHead = target?.closest<HTMLElement>('[data-colhead]');
    if (colHead) {
      // Column header: whole-column selection. Shift+Click extends from the
      // current column-selection anchor; a plain click starts a header drag.
      const col = Number(colHead.dataset.colhead);
      this.commitEditor();
      if (event.shiftKey && tab.selectionKind === 'col' && tab.anchor) {
        this.selectCols(tab, tab.anchor.col, col);
      } else {
        this.selectCols(tab, col, col);
        this.headerDrag = { axis: 'col', anchor: col, last: col };
      }
      this.focusGrid();
      event.preventDefault();
      return;
    }
    const cell = this.cellFromEvent(event);
    if (!cell) {
      return;
    }
    if (this.editor && (this.editor.row !== cell.row || this.editor.col !== cell.col)) {
      this.commitEditor();
    }
    if (event.shiftKey && tab.selection) {
      this.state.setSelection(tab, cell, tab.anchor ?? tab.selection);
    } else {
      this.state.setSelection(tab, cell, null);
      this.dragging = true;
    }
    if (!this.editor) {
      this.focusGrid();
      event.preventDefault();
    }
  }

  /**
   * Frame-coalesced pointer-drag appliers: the DOM/state updates for drag
   * selection and the fill preview run at most once per frame (the first
   * event in a frame applies immediately), so rapid mousemove streams never
   * queue redundant renders. Guards re-check the live drag state because a
   * trailing application may run just after the drag ended.
   */
  private readonly applyDragSelection = frameCoalesced<{ tab: Tab; cell: { row: number; col: number } }>(
    ({ tab, cell }) => {
      if (!this.dragging || this.state.activeTab !== tab || !tab.selection) {
        return;
      }
      this.state.setSelection(tab, cell, tab.anchor ?? tab.selection);
    },
  );

  private readonly applyFillPreview = frameCoalesced<null>(() => {
    if (this.filling) {
      this.updateFillPreview();
    }
  });

  /** Whole-row selection spanning rows [anchorRow, targetRow] across all columns. */
  private selectRows(tab: Tab, anchorRow: number, targetRow: number): void {
    const rows = tab.doc.rowCount;
    if (rows === 0) {
      return;
    }
    const a = Math.max(0, Math.min(rows - 1, anchorRow));
    const b = Math.max(0, Math.min(rows - 1, targetRow));
    const lastCol = Math.max(0, tab.doc.columnCount - 1);
    // Active cell at the target row (column 0); anchor at the far corner so the
    // normalized range covers every column of every selected row.
    this.state.setSelection(tab, { row: b, col: 0 }, { row: a, col: lastCol }, 'row');
  }

  /** Whole-column selection spanning columns [anchorCol, targetCol] across all rows. */
  private selectCols(tab: Tab, anchorCol: number, targetCol: number): void {
    const cols = tab.doc.columnCount;
    if (cols === 0 || tab.doc.rowCount === 0) {
      return;
    }
    const a = Math.max(0, Math.min(cols - 1, anchorCol));
    const b = Math.max(0, Math.min(cols - 1, targetCol));
    const lastRow = Math.max(0, tab.doc.rowCount - 1);
    this.state.setSelection(tab, { row: 0, col: b }, { row: lastRow, col: a }, 'col');
  }

  /** Row index under the pointer (a data cell or a row header), or null. */
  private rowFromEvent(event: Event): number | null {
    const target = event.target as HTMLElement | null;
    const head = target?.closest<HTMLElement>('[data-rowhead]');
    if (head) {
      return Number(head.dataset.rowhead);
    }
    const cell = target?.closest<HTMLElement>('[data-row]');
    return cell ? Number(cell.dataset.row) : null;
  }

  /** Column index under the pointer (a data cell or a column header), or null. */
  private colFromEvent(event: Event): number | null {
    const target = event.target as HTMLElement | null;
    const head = target?.closest<HTMLElement>('[data-colhead]');
    if (head) {
      return Number(head.dataset.colhead);
    }
    const cell = target?.closest<HTMLElement>('[data-col]');
    return cell ? Number(cell.dataset.col) : null;
  }

  private onMouseMove(event: MouseEvent): void {
    if (this.headerDrag) {
      const tab = this.state.activeTab;
      if (!tab) {
        return;
      }
      if (this.headerDrag.axis === 'row') {
        const row = this.rowFromEvent(event);
        if (row !== null && row !== this.headerDrag.last) {
          this.headerDrag.last = row;
          this.selectRows(tab, this.headerDrag.anchor, row);
        }
      } else {
        const col = this.colFromEvent(event);
        if (col !== null && col !== this.headerDrag.last) {
          this.headerDrag.last = col;
          this.selectCols(tab, this.headerDrag.anchor, col);
        }
      }
      return;
    }
    if (this.refDrag) {
      const cell = this.cellFromEvent(event);
      const refTarget = this.state.formulaRefTarget;
      if (cell && refTarget) {
        refTarget.setRef(this.refText(this.refDrag.anchor, cell));
      }
      return;
    }
    if (this.filling) {
      const cell = this.cellFromEvent(event);
      if (cell) {
        // Track the target synchronously (commit correctness), render the
        // lightweight preview at most once per frame.
        this.filling.target = cell;
        this.applyFillPreview(null);
      }
      return;
    }
    if (!this.dragging) {
      return;
    }
    const tab = this.state.activeTab;
    if (!tab || !tab.selection) {
      return;
    }
    const cell = this.cellFromEvent(event);
    if (!cell) {
      return;
    }
    if (cell.row === tab.selection.row && cell.col === tab.selection.col && tab.anchor !== null) {
      return; // no movement
    }
    this.applyDragSelection({ tab, cell });
  }

  private onDoubleClick(event: MouseEvent): void {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const resizeHandle = target?.closest<HTMLElement>('[data-colresize]');
    if (resizeHandle) {
      event.preventDefault();
      const col = Number(resizeHandle.dataset.colresize);
      // When whole columns are selected (column headers / Shift+Click / drag,
      // or any selection spanning every row — including Select All) and the
      // double-clicked handle belongs to one of them, auto-fit applies to
      // every selected column; otherwise only the handle's own column fits.
      const range = this.state.selectedRange(tab);
      const wholeCols =
        range !== null &&
        range.right > range.left &&
        col >= range.left &&
        col <= range.right &&
        (tab.selectionKind === 'col' || (range.top === 0 && range.bottom === tab.doc.rowCount - 1));
      const cols: number[] = [];
      if (wholeCols && range) {
        for (let c = range.left; c <= range.right; c++) {
          cols.push(c);
        }
      } else {
        cols.push(col);
      }
      void this.autoFitColumns(tab, cols);
      return;
    }
    const cell = this.cellFromEvent(event);
    if (cell) {
      this.openEditor(tab, cell.row, cell.col, null);
    }
  }

  // ----- Column resizing -----

  /**
   * Set a column's width from an on-screen pixel width and re-lay-out. The
   * stored width is normalized to 100% zoom (clamped), so resizing means the
   * same thing at every zoom level and persists zoom-independently. Never
   * marks the document dirty.
   */
  private setColWidth(tab: Tab, col: number, screenWidth: number): void {
    const w = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(screenWidth / this.zoomOf(tab))));
    if (tab.colWidths[col] === w) {
      return;
    }
    tab.colWidths[col] = w;
    // A width change alters which cells wrap, so cached wrap heights are stale.
    this.invalidateRowHeights(tab);
    this.window = null; // force a re-layout with the new width
    this.render(tab);
  }

  /** Frame-coalesced column-width application (a resize re-lays-out the window). */
  private readonly applyResize = frameCoalesced<{ tab: Tab; col: number; width: number }>(
    ({ tab, col, width }) => {
      if (this.state.activeTab !== tab) {
        return;
      }
      this.setColWidth(tab, col, width);
    },
  );

  private onResizeMove(event: MouseEvent): void {
    const drag = this.resizing;
    if (!drag) {
      return;
    }
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    this.applyResize({ tab, col: drag.col, width: drag.startWidth + (event.clientX - drag.startX) });
  }

  private endResize(): void {
    this.resizing = null;
  }

  // ----- Fill handle -----

  /**
   * The destination rectangle for the current fill drag: the source extended
   * along the dominant axis (downward or rightward) toward the drag target.
   */
  private fillDest(): CellRange | null {
    if (!this.filling) {
      return null;
    }
    const { source, target } = this.filling;
    const downExt = Math.max(0, target.row - source.bottom);
    const rightExt = Math.max(0, target.col - source.right);
    if (downExt === 0 && rightExt === 0) {
      return null;
    }
    if (downExt >= rightExt) {
      return { top: source.top, left: source.left, right: source.right, bottom: target.row };
    }
    return { top: source.top, left: source.left, bottom: source.bottom, right: target.col };
  }

  private updateFillPreview(): void {
    for (const cell of this.canvas.querySelectorAll('.fill-target')) {
      cell.classList.remove('fill-target');
    }
    const dest = this.fillDest();
    if (!dest || !this.filling) {
      return;
    }
    const { source } = this.filling;
    for (const cell of this.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]')) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const inDest = row >= dest.top && row <= dest.bottom && col >= dest.left && col <= dest.right;
      const inSource = row >= source.top && row <= source.bottom && col >= source.left && col <= source.right;
      if (inDest && !inSource) {
        cell.classList.add('fill-target');
      }
    }
  }

  // ----- Pointer reference entry -----

  /** Reference text for a single cell or a rectangle (`A1` or `A1:B3`). */
  private refText(anchor: { row: number; col: number }, cell: { row: number; col: number }): string {
    if (anchor.row === cell.row && anchor.col === cell.col) {
      return cellLabel(cell.row, cell.col);
    }
    const range = normalizeRange(anchor, cell);
    return `${cellLabel(range.top, range.left)}:${cellLabel(range.bottom, range.right)}`;
  }

  private endRefDrag(): void {
    if (!this.refDrag) {
      return;
    }
    this.refDrag = null;
    this.state.formulaRefTarget?.endRef();
  }

  private endFill(): void {
    const filling = this.filling;
    if (!filling) {
      return;
    }
    const dest = this.fillDest();
    const source = filling.source;
    const tab = this.state.activeTab;
    this.filling = null;
    for (const cell of this.canvas.querySelectorAll('.fill-target')) {
      cell.classList.remove('fill-target');
    }
    if (dest && tab && tab.doc === this.lastDoc) {
      void this.commands.applyFill(tab, source, dest);
    }
  }

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
   * Sheet > Auto-Fit Column Width: fit every column intersecting the current
   * selection (whole-column selections, Select All, or any cell range). Each
   * column is measured independently, so columns can shrink and grow on
   * their own.
   */
  async autoFitSelectedColumns(): Promise<void> {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    const range = this.state.selectedRange(tab);
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
   * Auto-fit the given columns using the measured-displayed-width algorithm
   * (see {@link planAutoFit}) with each column's own header and values. Large
   * jobs (many columns × many sampled rows) run column-by-column with yields
   * to the browser, a "N of M columns" + percentage busy label, and abort
   * safety: if the tab or document changes mid-run, no width is applied at
   * all (widths change all-or-nothing, so a cancelled run leaves every column
   * untouched). Column widths are per-tab view state — never document
   * content — so auto-fit cannot modify CSV bytes and is not an undoable
   * document operation.
   */
  private async autoFitColumns(tab: Tab, cols: number[]): Promise<void> {
    if (cols.length === 0) {
      return;
    }
    const doc = tab.doc;
    const sampleCell = this.canvas.querySelector<HTMLElement>('.vcell[data-row][data-col]');
    const measure = sampleCell ? createTextMeasurer(sampleCell) : null;
    let result: MultiAutoFitResult;
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
        for (const cell of this.canvas.querySelectorAll<HTMLElement>(`.vcell[data-row][data-col="${col}"]`)) {
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
        this.commands.setBusy(t('loading.autoFitCols', { done: 0, total: cols.length, pct: 0 }));
      }
      try {
        result = await planAutoFitColumns(cols, makeInput, {
          yieldBetween: heavy,
          onProgress: (done, total) =>
            this.commands.setBusy(
              t('loading.autoFitCols', { done, total, pct: Math.floor((done / total) * 100) }),
            ),
          shouldStop: () => this.state.activeTab !== tab || tab.doc !== doc,
        });
      } finally {
        if (heavy) {
          this.commands.setBusy(null);
        }
      }
    } else {
      // Fallback without a 2D canvas context (e.g. jsdom): measure the
      // rendered cells' DOM scrollWidth per column (visible rows only).
      const plans = new Map<number, AutoFitResult>();
      for (const col of cols) {
        const widths: number[] = [];
        let measuredRows = 0;
        for (const cell of this.canvas.querySelectorAll<HTMLElement>(`.vcell[data-col="${col}"]`)) {
          widths.push(cell.scrollWidth + 2);
          measuredRows += 1;
        }
        const head = this.headerEl.querySelector<HTMLElement>(`[data-colhead="${col}"]`);
        if (head) {
          widths.push(head.scrollWidth + 10);
        }
        plans.set(col, {
          width: autoFitWidth(widths),
          measuredRows,
          sampled: measuredRows < doc.rowCount,
        });
      }
      result = { plans, completed: true };
    }
    if (!result.completed || this.state.activeTab !== tab || tab.doc !== doc) {
      return; // aborted: apply nothing
    }
    // Apply every fitted width, then re-lay-out once. Measurements were taken
    // under the zoomed font, so normalize back to 100%-zoom storage units.
    let changed = false;
    for (const [col, plan] of result.plans) {
      const w = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(plan.width / this.zoomOf(tab))));
      if (tab.colWidths[col] !== w) {
        tab.colWidths[col] = w;
        changed = true;
      }
    }
    if (changed) {
      // New column widths change wrapping, so cached wrap heights are stale.
      this.invalidateRowHeights(tab);
      this.window = null;
      this.render(tab);
    }
    const sampledPlans = [...result.plans.entries()].filter(([, plan]) => plan.sampled);
    if (sampledPlans.length === 1 && cols.length === 1) {
      const [col, plan] = sampledPlans[0];
      this.commands.notify(
        t('grid.autoFitSampled', { letter: columnLabel(col), n: plan.measuredRows }),
        'info',
      );
    } else if (sampledPlans.length > 0) {
      this.commands.notify(t('grid.autoFitSampledMulti', { n: sampledPlans.length }), 'info');
    }
  }

  // ----- Selection movement -----

  select(tab: Tab, row: number, col: number, scroll = false): void {
    this.commitEditor();
    const clampedRow = Math.max(0, Math.min(tab.doc.rowCount - 1, row));
    const fieldCount = tab.doc.fieldCount(clampedRow);
    const clampedCol = Math.max(0, Math.min(Math.max(0, fieldCount - 1), col));
    this.state.setSelection(tab, { row: clampedRow, col: clampedCol }, null);
    if (scroll) {
      this.scrollCellIntoView(tab, clampedRow, clampedCol);
    }
  }

  /** Select a cell and scroll it into view (used by find). */
  reveal(row: number, col: number): void {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    this.select(tab, row, col, true);
  }

  private scrollCellIntoView(tab: Tab, row: number, col: number): void {
    const idx = this.heightIndex(tab);
    const overlay = this.overlayHeight(tab);
    if (!(this.stickyEnabled(tab) && row === 0)) {
      const startRow = this.scrollRowBase(tab);
      const y = idx.offsetOf(row) - idx.offsetOf(startRow);
      const rowH = idx.heightOf(row);
      const viewH = this.element.clientHeight - overlay;
      if (y < this.element.scrollTop) {
        this.element.scrollTop = y;
      } else if (y + rowH > this.element.scrollTop + viewH) {
        this.element.scrollTop = y + rowH - viewH;
      }
    }
    const x = this.colOffset(tab, col);
    const w = this.colWidth(tab, col);
    const viewW = this.element.clientWidth - this.headW(tab);
    if (x < this.element.scrollLeft) {
      this.element.scrollLeft = x;
    } else if (x + w > this.element.scrollLeft + viewW) {
      this.element.scrollLeft = x + w - viewW;
    }
    const current = this.state.activeTab;
    if (current) {
      this.render(current);
    }
  }

  private moveSelection(tab: Tab, dRow: number, dCol: number, extend: boolean): void {
    const sel = tab.selection ?? { row: 0, col: 0 };
    const row = Math.max(0, Math.min(tab.doc.rowCount - 1, sel.row + dRow));
    let col = sel.col + dCol;
    const fieldCount = tab.doc.fieldCount(row);
    if (col >= fieldCount) col = fieldCount - 1;
    if (col < 0) col = 0;
    this.commitEditor();
    if (extend) {
      this.state.setSelection(tab, { row, col }, tab.anchor ?? sel);
    } else {
      this.state.setSelection(tab, { row, col }, null);
    }
    this.scrollCellIntoView(tab, row, col);
    this.focusGrid();
  }

  // ----- Editing -----

  /**
   * Open the inline cell editor by promoting the permanent sink textarea in
   * place. `initial === null` edits the current value (the raw formula
   * expression for formula cells) with the text selected; `initial === ''`
   * opens an **empty** editor for type-to-edit — the sink already has focus
   * and may already be receiving the initiating keystroke or IME composition,
   * so its value, caret, and focus are deliberately left untouched (touching
   * them would abort the composition). Any other `initial` seeds the editor.
   * The editor is a `<textarea>`, so it holds multi-line values (Alt+Enter).
   */
  openEditor(tab: Tab, row: number, col: number, initial: string | null): void {
    this.commitEditor();
    if (row < 0 || row >= tab.doc.rowCount || col >= tab.doc.fieldCount(row)) {
      return;
    }
    this.select(tab, row, col, true);
    const cell = this.cellAt(row, col);
    if (!cell) {
      return;
    }
    const input = this.sink;
    input.classList.add('cell-editor');
    input.setAttribute('aria-label', t('formulaBar.label'));
    // Editing-help tooltip (preference-controlled): a native title for the
    // mouse plus an ARIA description for keyboard/screen-reader users.
    // Attribute-only changes — the value, caret, and any live IME
    // composition are untouched.
    if (getEditHints()) {
      input.setAttribute('title', t('formulaBar.hint'));
      this.editorHint.textContent = t('formulaBar.hint');
      input.setAttribute('aria-describedby', 'grid-editor-hint');
    } else {
      input.removeAttribute('title');
      input.removeAttribute('aria-describedby');
    }
    this.placeSinkOverCell(cell);
    if (initial !== null && initial !== '') {
      input.value = initial;
    } else if (initial === null) {
      input.value = tab.doc.getValue(row, col);
    }
    // Autocomplete and pointer references, identical to the formula bar. The
    // popup floats (position: fixed) so the narrow cell never clips it.
    const autocomplete = new FormulaAutocomplete(input, document.body, true);
    // Pointer-entered references rewrite the field without an input event, so
    // the highlight refresh hooks the reference writer directly.
    const updateRefs = () =>
      this.setFormulaRefs(input.value.startsWith('=') ? extractFormulaRefs(input.value) : []);
    const ref = new FormulaFieldRef(input, () => autocomplete.hide(), updateRefs);
    // While editing a formula inline, the grid routes cell clicks into this
    // field as references; restore whatever target was active (the formula
    // bar) when the editor closes.
    const prevRefTarget = this.state.formulaRefTarget;
    this.state.formulaRefTarget = ref;
    this.editor = { row, col, input, autocomplete, ref, prevRefTarget, updateRefs };
    input.focus({ preventScroll: true });
    if (initial === null) {
      input.select();
    } else if (!this.composing && initial !== '') {
      input.setSelectionRange(input.value.length, input.value.length);
    }
    // Offer completions immediately when a formula is being started/edited.
    autocomplete.update();
    updateRefs();
  }

  /** Handle a keydown on the sink while it is promoted to the cell editor. */
  private sinkKeyDown(event: KeyboardEvent): void {
    const editor = this.editor;
    if (!editor) {
      return; // navigating: the container-level onKeyDown handles it
    }
    // While the IME is composing, let it own every key (Enter confirms a
    // candidate, Escape cancels one, arrows move candidates). Never commit,
    // navigate, or run autocomplete on a composition keystroke.
    if (isComposingKey(event, this.composing)) {
      return;
    }
    const input = editor.input;
    if (event.key === 'Enter' && event.altKey) {
      // Insert a literal newline at the caret (replacing any selection); this
      // never commits, navigates, or opens a menu.
      event.preventDefault();
      event.stopPropagation();
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.setRangeText('\n', start, end, 'end');
      editor.autocomplete.update();
      editor.updateRefs();
      return;
    }
    if (editor.autocomplete.onKeyDown(event)) {
      return;
    }
    const tab = this.state.activeTab;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.commitEditor();
      if (tab) {
        this.moveSelection(tab, event.shiftKey ? -1 : 1, 0, false);
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.commitEditor();
      if (tab) {
        this.moveSelection(tab, 0, event.shiftKey ? -1 : 1, false);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // Restore the value the cell had when editing began.
      this.closeEditor(false);
      this.focusGrid();
    }
  }

  /** Handle an input event on the sink (both navigating and editing modes). */
  private sinkInput(): void {
    const editor = this.editor;
    if (!editor) {
      // Text reached the sink with no cell to edit (no tab/selection). Never
      // keep it — but never clear mid-composition, which would abort the IME.
      if (!this.composing) {
        this.sink.value = '';
      }
      return;
    }
    editor.ref.clear();
    // Don't recompute/overwrite completions mid-composition (compositionend
    // refreshes them from the committed text).
    if (!this.composing) {
      editor.autocomplete.update();
    }
    editor.updateRefs();
  }

  /** Position the sink exactly over a rendered cell (canvas coordinates). */
  private placeSinkOverCell(cell: HTMLElement): void {
    const rect = cell.getBoundingClientRect();
    const origin = this.canvas.getBoundingClientRect();
    const s = this.sink.style;
    s.left = `${rect.left - origin.left}px`;
    s.top = `${rect.top - origin.top}px`;
    s.width = `${rect.width}px`;
    s.height = `${rect.height}px`;
  }

  /**
   * While navigating, keep the hidden sink parked at the selected cell so the
   * IME candidate window opens next to the cell the composition will edit.
   */
  private positionSink(): void {
    if (this.editor) {
      return;
    }
    const tab = this.state.activeTab;
    const cell = tab?.selection ? this.cellAt(tab.selection.row, tab.selection.col) : null;
    if (cell) {
      this.placeSinkOverCell(cell);
    } else {
      const s = this.sink.style;
      s.left = '0px';
      s.top = '0px';
      s.width = '1px';
      s.height = '1px';
    }
  }

  /** Return the sink to its hidden navigating state (keeps focus untouched). */
  private demoteSink(): void {
    this.sink.classList.remove('cell-editor');
    this.sink.value = '';
    this.sink.setAttribute('aria-label', t('grid.label'));
    this.sink.removeAttribute('title');
    this.sink.removeAttribute('aria-describedby');
    this.positionSink();
  }

  /** Tear down the editor's autocomplete popup and restore the reference target. */
  private disposeEditor(editor: NonNullable<Grid['editor']>): void {
    editor.autocomplete.dispose();
    editor.ref.endRef();
    if (this.state.formulaRefTarget === editor.ref) {
      this.state.formulaRefTarget = editor.prevRefTarget;
    }
    // The inline editor's formula is no longer being edited.
    this.setFormulaRefs([]);
  }

  /** Commit the inline editor if open. */
  commitEditor(): void {
    const editor = this.editor;
    if (!editor) {
      return;
    }
    this.editor = null;
    const tab = this.state.activeTab;
    const value = editor.input.value;
    this.disposeEditor(editor);
    this.demoteSink();
    if (tab && tab.doc === this.lastDoc) {
      void this.commands.commitCellEdit(tab, editor.row, editor.col, value);
    }
  }

  private closeEditor(commit: boolean): void {
    if (commit) {
      this.commitEditor();
      return;
    }
    const editor = this.editor;
    if (!editor) {
      return;
    }
    this.editor = null;
    this.disposeEditor(editor);
    this.demoteSink();
  }

  /** True when the grid (not an editor input) should own copy/paste events. */
  isNavigating(): boolean {
    return (
      this.editor === null &&
      (document.activeElement === this.element || document.activeElement === this.sink)
    );
  }

  // ----- Keyboard -----

  private onKeyDown(event: KeyboardEvent): void {
    const tab = this.state.activeTab;
    if (!tab || this.editor) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    // A composition keystroke never navigates, commits, or runs a shortcut.
    // The very first one (keyCode 229 / "Process", which can arrive before
    // compositionstart) still begins a typed edit so the composition lands in
    // the promoted cell editor — the initiating key is never consumed or
    // synthesized; the browser delivers it into the already-focused sink.
    if (isComposingKey(event, this.composing)) {
      if (tab.selection && beginsTextEntry(event)) {
        this.openEditor(tab, tab.selection.row, tab.selection.col, '');
      }
      return;
    }
    const extend = event.shiftKey;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveSelection(tab, 1, 0, extend);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.moveSelection(tab, -1, 0, extend);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveSelection(tab, 0, -1, extend);
        return;
      case 'ArrowRight':
        event.preventDefault();
        this.moveSelection(tab, 0, 1, extend);
        return;
      case 'PageDown':
        event.preventDefault();
        this.moveSelection(tab, 20, 0, extend);
        return;
      case 'PageUp':
        event.preventDefault();
        this.moveSelection(tab, -20, 0, extend);
        return;
      case 'Home':
        event.preventDefault();
        this.moveSelection(tab, 0, -Number.MAX_SAFE_INTEGER, extend);
        return;
      case 'End':
        event.preventDefault();
        this.moveSelection(tab, 0, Number.MAX_SAFE_INTEGER, extend);
        return;
      case 'Enter':
        event.preventDefault();
        this.moveSelection(tab, 1, 0, false);
        return;
      case 'F2':
        event.preventDefault();
        if (tab.selection) this.openEditor(tab, tab.selection.row, tab.selection.col, null);
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.commands.clearRange(tab);
        return;
      default:
        // Typing starts a fresh edit — but IME-safely. We open an EMPTY editor
        // and focus it, then deliberately do NOT preventDefault and do NOT seed
        // the character ourselves: the browser routes this keystroke (and any
        // IME composition it begins) into the just-focused field, so Japanese
        // Romaji composes correctly from the very first key instead of leaking
        // a literal Latin character.
        if (tab.selection && beginsTextEntry(event)) {
          this.openEditor(tab, tab.selection.row, tab.selection.col, '');
        }
    }
  }

  // ----- Context menu -----

  private onContextMenu(event: MouseEvent): void {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const rowHead = target?.closest<HTMLElement>('[data-rowhead]');
    const colHead = target?.closest<HTMLElement>('[data-colhead]');
    const cell = this.cellFromEvent(event);
    if (!rowHead && !colHead && !cell) {
      return;
    }
    event.preventDefault();
    this.commitEditor();
    if (rowHead) {
      const row = Number(rowHead.dataset.rowhead);
      const range = this.state.selectedRange(tab);
      if (!range || row < range.top || row > range.bottom) {
        this.selectRows(tab, row, row);
      }
    } else if (colHead) {
      const col = Number(colHead.dataset.colhead);
      const range = this.state.selectedRange(tab);
      if (!range || col < range.left || col > range.right) {
        this.selectCols(tab, col, col);
      }
    } else if (cell) {
      const range = this.state.selectedRange(tab);
      if (!range || !rangeContains(range, cell.row, cell.col)) {
        this.state.setSelection(tab, cell, null);
      }
    }
    this.openContextMenu(event.clientX, event.clientY);
  }

  private openContextMenu(x: number, y: number): void {
    this.closeContextMenu();
    const menu = el('div', { className: 'context-menu', attrs: { role: 'menu' } });
    let firstEnabled: HTMLButtonElement | null = null;
    for (const item of CONTEXT_MENU_ITEMS) {
      if (item === 'separator') {
        menu.append(el('hr', { className: 'menu-separator' }));
        continue;
      }
      const button = el('button', {
        className: 'menu-item',
        attrs: { type: 'button', role: 'menuitem' },
        text: t(item.labelKey),
      });
      button.disabled = !this.commands.isEnabled(item.command);
      button.addEventListener('click', () => {
        this.closeContextMenu();
        void this.commands.run(item.command);
      });
      if (!button.disabled && !firstEnabled) {
        firstEnabled = button;
      }
      menu.append(button);
    }
    menu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 320)}px`;
    document.body.append(menu);
    this.contextMenu = menu;
    firstEnabled?.focus();
  }

  private closeContextMenu(): void {
    this.contextMenu?.remove();
    this.contextMenu = null;
  }
}
