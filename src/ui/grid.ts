// SPDX-License-Identifier: MIT
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, ListFilter, Plus } from 'lucide';
import type { AppState, FormulaRefTarget, Tab } from '../app/app-state';
import { isGridSurface, LARGE_OP_CELLS, type Commands } from '../app/commands';
import { getLocale, t } from '../app/i18n';
import { getEditHints, nextZoomLevel } from '../app/settings';
import { dateStampKeyOf, localDateStamp } from '../app/shortcuts';
import {
  BORDER_WIDTH_PX,
  borderSideValue,
  resolveSharedBorder,
  type BorderSideValue,
} from '../core/cell-style';
import { normalizeRange, rangeContains, type CellRange } from '../core/clipboard';
import { ColOffsetIndex } from '../core/col-offset-index';
import { runsForText, type TextRun } from '../core/rich-text';
import { cellLabel, columnLabel, extractFormulaRefs, type FormulaRefRange } from '../core/formula';
import type { LosslessDocument } from '../core/lossless-document';
import { RowHeightIndex } from '../core/row-height-index';
import type { RsfDocument } from '../core/rsf-document';
import { forEachIndexSliced } from '../core/scheduler';
import type { SheetSort } from '../core/sort';
import { countVisualLines, rowHeightForLines, type WrapMeasure } from '../core/text-wrap';
import { ICON_BY_COMMAND } from './command-icons';
import { ContextMenu, type ContextMenuEntry } from './context-menu';
import { el, clearChildren } from './dom';
import { onKeyboardOpenChange, onKeyboardResize } from './popup';
import { centeredScrollOffset } from './grid/center-scroll';
import { FormulaAutocomplete, FormulaFieldRef, isRefToggleKey } from './formula-autocomplete';
import { findDataEdge } from './grid/data-edge';
import { pageStep } from './grid/page-step';
import { MOVE_EDGE_PX, onRangeEdge } from './grid/range-edge';
import type { FormulaLivePreview } from './formula-bar';
import { beginsTextEntry, isComposingKey } from './ime';
import { createIcon } from './icon';
import {
  autoFitWidth,
  planAutoFit,
  planAutoFitColumns,
  AUTOFIT_SAMPLE_BUDGET,
  type AutoFitInput,
  type AutoFitResult,
  type MultiAutoFitResult,
} from './grid/autofit';
import {
  CONTEXT_MENU_ITEMS,
  formatToolbarItems,
  type ContextMenuCommandDef,
  type ContextMenuGroupDef,
} from './grid/context-menu-items';
import {
  clampFormulaRefs,
  matchFormulaRefCell,
  formulaRefsExceedViewport,
  type ClampedFormulaRef,
} from './grid/formula-ref-overlay';
import {
  COL_WIDTH,
  MAX_COL_WIDTH,
  MAX_WRAP_LINES,
  MIN_COL_WIDTH,
  OVERSCAN_COLS,
  OVERSCAN_ROWS,
  ROW_HEAD_WIDTH,
  ROW_HEIGHT,
  WRAP_LINE_HEIGHT,
  WRAP_PASS_BUSY_ROWS,
  WRAP_VERTICAL_PAD,
} from './grid/geometry';
import { ValidationPicker } from './validation-picker';
import { RichCellEditor } from './rich-cell-editor';
import { richTextNodes } from './rich-text-render';

// The grid's pure helpers live in src/ui/grid/; re-exported for existing importers.
export {
  autoFitWidth,
  AUTOFIT_SAMPLE_BUDGET,
  clampFormulaRefs,
  COL_WIDTH,
  formulaRefsExceedViewport,
  matchFormulaRefCell,
  MAX_COL_WIDTH,
  MAX_WRAP_LINES,
  MIN_COL_WIDTH,
  OVERSCAN_ROWS,
  planAutoFit,
  planAutoFitColumns,
  ROW_HEAD_WIDTH,
  ROW_HEIGHT,
  WRAP_LINE_HEIGHT,
  WRAP_VERTICAL_PAD,
};
export type { AutoFitInput, ClampedFormulaRef };

/** Render a resolved border side as a CSS `border-*` shorthand value (`''` when unset). */
function cssBorder(border: BorderSideValue | null): string {
  return border ? `${BORDER_WIDTH_PX[border.width]}px ${border.lineStyle} ${border.color}` : '';
}

interface RenderWindow {
  /**
   * First *display slot* of the scrolling region rendered (inclusive). A
   * slot is a document row when nothing is sorted; under an active sort it
   * is a visual position, translated to the document row it shows via
   * `docRowOf` (see `heightIndex`, which is always slot-keyed).
   */
  rowStart: number;
  /** One past the last display slot rendered (exclusive). */
  rowEnd: number;
  colStart: number;
  colEnd: number;
  /** Row-height revision this window was computed against (see heightsVersion). */
  heights: number;
}

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
}

/**
 * Create a text measurer configured from an element's *computed* style via
 * `CanvasRenderingContext2D.measureText` — the same font family, size,
 * weight, and style the grid actually renders with (letter spacing is added
 * per character; CSS box chrome is accounted for separately by the caller).
 * Returns null where no 2D canvas context exists (e.g. jsdom); callers fall
 * back to DOM `scrollWidth` measurement there.
 */
function createTextMeasurer(sample: Element): ((text: string) => number) | null {
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
  /** Pinned row / column counts (sticky first row/column or freeze-at-selection). */
  sticky: number;
  stickyCol: number;
  locale: string;
  /** Spreadsheet zoom percent — changing it rescales every grid metric. */
  zoom: number;
  /** Hidden-row snapshot identity — a filter change rebuilds the window. */
  hidden: unknown;
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

/** The four arrow keys, for Ctrl+Arrow data-edge jumps. */
const ARROW_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * How long after an on-screen keyboard opens a further shrink of the visible
 * area still re-centers the edited cell (the keyboard sliding in).
 */
const KEYBOARD_SETTLE_MS = 1000;
/**
 * Auto-scroll tuning for drags that should nudge the viewport when the
 * pointer nears the grid's edge (range selection, fill handle, column
 * resize, range move): how close to the edge (px) triggers a nudge, the
 * largest single nudge (px), and how often nudges repeat (ms) while the
 * pointer holds at the edge.
 */
const AUTO_SCROLL_EDGE_PX = 24;
const AUTO_SCROLL_MAX_STEP_PX = 28;
const AUTO_SCROLL_INTERVAL_MS = 50;
/**
 * Touch/pen press-and-hold duration that arms a drag (cell-range selection or
 * a row/column header drag) — a quick tap stays a tap, handled by the
 * browser's own synthetic click, same as before touch support existed.
 */
const LONG_PRESS_MS = 400;
/** Movement past this distance during the long-press window reads as the
 * start of a scroll, not a drag, and cancels the pending long-press. */
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
/**
 * Touch/pen double-tap detection window: a second quick tap landing on the
 * same cell within this many ms of the first opens the inline editor, the
 * touch equivalent of a desktop double-click. Mobile browsers do not
 * reliably synthesize a `dblclick` DOM event from two taps on a plain
 * (non-form, non-anchor) element, so this is detected explicitly rather than
 * relying on `dblclick` for touch input.
 */
const DOUBLE_TAP_MS = 300;
/**
 * How far apart (px) the two taps of a double-tap may land, on top of both
 * hitting the same cell. A finger's second tap routinely lands 10–15px from
 * the first; the on-device log for #590 shows a 12px pair that the
 * long-press tolerance (10px) wrongly rejected.
 */
const DOUBLE_TAP_SLOP_PX = 30;

/** Ctrl+B / Ctrl+I / Ctrl+U (Cmd on macOS): the text property the key toggles, else null. */
function richFormatKeyOf(event: KeyboardEvent): 'bold' | 'italic' | 'underline' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  return key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : null;
}

/** A new grid sink textarea (see `Grid.sink`), not yet wired or mounted. */
function createSink(): HTMLTextAreaElement {
  return el('textarea', {
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
}

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
  /**
   * "Add row" / "add column" icon buttons (#441, moved onto the grid's own
   * edges in #467). Each lives inside an anchor strip absolutely positioned
   * at the true bottom/right edge of the document content within `canvas`,
   * so it scrolls and re-zooms with the grid exactly like a header does; the
   * button itself is CSS-sticky along the perpendicular axis (`left: 0` /
   * `top: 0`, relative to the scrolling `element`) so it stays aligned under
   * the row-number column / right of the column-header row while scrolled,
   * without any JS repositioning on scroll.
   */
  private readonly addRowAnchor: HTMLElement;
  private readonly addRowButton: HTMLButtonElement;
  private readonly addColAnchor: HTMLElement;
  private readonly addColButton: HTMLButtonElement;

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
  /**
   * Cached column-offset prefix sum, keyed by document. Built lazily and
   * reused across every scroll/render until a resize, autofit, zoom, or
   * column-count change invalidates it — rebuilding from scratch on every
   * scroll would make horizontal scroll cost scale with total column count
   * instead of the visible window.
   */
  private readonly colOffsets = new WeakMap<object, ColOffsetCache>();
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
    /** The dropdown of allowed values, and the full set it picks from — see `refreshValidationPicker`. */
    picker: ValidationPicker;
    pickerValues: readonly string[] | null;
    /** Formatting parts of the text (RSF grid worksheets only) — see `RichCellEditor`. */
    rich: RichCellEditor | null;
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
  private sink: HTMLTextAreaElement;
  /** Hidden description element backing the inline editor's help tooltip. */
  private readonly editorHint: HTMLElement;
  /** Polite live region announcing spreadsheet-zoom changes to AT. */
  private readonly zoomLive: HTMLElement;
  /** Zoom last announced through the live region (null before first render). */
  private announcedZoom: number | null = null;
  /** True between compositionstart and compositionend on the sink (IME is composing). */
  private composing = false;
  private contextMenu: ContextMenu | null = null;
  private dragging = false;
  private scrollScheduled = false;
  private resizeScheduled = false;
  /** Active column-resize drag, if any. */
  private resizing: { col: number; startX: number; startWidth: number } | null = null;
  /** Active fill-handle drag, if any. */
  private filling: { source: CellRange; target: { row: number; col: number } } | null = null;
  /** The range currently outlined as a copy source (see `setCopySource`), or
   * null when nothing is being highlighted. */
  private copySource: CellRange | null = null;
  /** Active whole-row / whole-column header drag, if any. */
  private headerDrag: { axis: 'row' | 'col'; anchor: number; last: number } | null = null;
  /** Active pointer reference entry into a formula editor, if any. */
  private refDrag: { anchor: { row: number; col: number } } | null = null;
  /** Pending touch/pen long-press-to-drag timer (cell/header drags only — the
   * fill/move/resize handles start dragging immediately on touch, same as a
   * mouse press, since they already opt out of native panning in CSS). */
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  /** Origin of a pending long-press: used to detect cancel-by-movement and to
   * replay the original press once the hold is confirmed. */
  private longPressOrigin: { event: PointerEvent; x: number; y: number } | null = null;
  /** A completed long-press that has not yet turned into a drag — a mouse has
   * a right-click for the context menu, but touch has no equivalent input, so
   * a stationary press-and-hold (#406) opens it instead once the finger
   * lifts. `x`/`y` are the press origin, used to tell a held finger's own
   * sensor jitter apart from real movement (#475) — only movement past the
   * tolerance cancels this back to `null` and leaves the gesture to the
   * existing drag handling above. */
  private longPressMenuTarget: { event: PointerEvent; x: number; y: number } | null = null;
  /** A completed quick tap awaiting a possible second tap to complete a
   * touch double-tap-to-edit gesture (see `DOUBLE_TAP_MS`); cleared once the
   * window elapses with no matching second tap, or consumed immediately when
   * one lands on the same cell within the movement tolerance. */
  private pendingTap: {
    row: number;
    col: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /**
   * Active range-move drag, if any. `origin` is the cell under the pointer when
   * the drag began (so the destination tracks the pointer without snapping to a
   * corner); `delta` is the current move offset; `valid` is whether the current
   * destination is in bounds. Committed on mouseup — the move itself, with its
   * overwrite confirmation, runs through the shared command.
   */
  private movingRange: {
    source: CellRange;
    origin: { row: number; col: number };
    delta: { row: number; col: number };
    valid: boolean;
  } | null = null;
  /** Timer driving auto-scroll while an active drag's pointer sits at/beyond the grid edge. */
  private autoScrollTimer: ReturnType<typeof setInterval> | null = null;
  /** Scroll direction/speed and the pointer position it was computed from. */
  private autoScrollState: { dx: number; dy: number; clientX: number; clientY: number } | null = null;
  /** Ranges referenced by the formula currently being edited (highlighted). */
  private formulaRefs: FormulaRefRange[] = [];
  /** In-progress raw text from the formula bar, rendered in place of the
   * active cell's committed value until it is committed or cleared. */
  private formulaLivePreview: FormulaLivePreview | null = null;
  /** Floating note shown when a referenced range extends beyond the viewport. */
  private readonly refIndicator: HTMLElement;
  /** `pointerType` of the most recent pointer gesture the grid handled,
   * updated in `onPointerDown` (see #469). Defaults to `'mouse'` so desktop,
   * programmatic, and keyboard-only focus paths are unaffected; `focusGrid()`
   * reads it to tell a plain touch/pen tap-to-select (which must not pop the
   * on-screen keyboard) apart from an actual mouse click. */
  private lastPointerType: string = 'mouse';
  /** The resize-tracking observer created below, kept so `dispose()` can disconnect it. */
  private resizeObserver: ResizeObserver | null = null;
  /**
   * `this.element`'s `contentRect.width` as of the last `onResize` call, so a
   * later call can tell a real layout change apart from a pure height change
   * (see `onResize`). `null` before the first observation.
   */
  private lastResizeWidth: number | null = null;
  /**
   * The grid's scroll position just before an on-screen keyboard opened, put
   * back when it closes (see `keyboardOpenChanged`). `null` when the keyboard
   * is closed or its opening did not move the grid.
   */
  private preKeyboardScroll: { top: number; left: number } | null = null;
  /** Unsubscribes `keyboardOpenChanged`; called by `dispose()`. */
  private readonly offKeyboardOpenChange: () => void;
  /** Unsubscribes `keyboardResized`; called by `dispose()`. */
  private readonly offKeyboardResize: () => void;
  /**
   * Until this time (`Date.now()`), a change in the visible area's height
   * re-centers the edited cell: the keyboard can still be sliding in after
   * the first open notification. 0 when not settling.
   */
  private keyboardSettleUntil = 0;
  /**
   * Fields outside the grid that edit the selected cell (the formula bar), so
   * the keyboard opening for one of them centers that cell too
   * (`addKeyboardEditField`).
   */
  private readonly keyboardEditFields = new Set<Element>();

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
    this.stickyEl = el('div', { className: 'vgrid-sticky', attrs: { role: 'rowgroup' } });
    this.rowsLayer = el('div', { className: 'vgrid-rows' });
    this.emptyEl = el('div', { className: 'grid-empty' });
    this.addRowButton = el(
      'button',
      {
        className: 'sheet-grid-add sheet-grid-add-row',
        attrs: { type: 'button', 'aria-label': t('grid.addRow'), title: t('grid.addRow') },
      },
      [createIcon(Plus, 'sheet-grid-add-icon', 14)],
    );
    this.addRowButton.addEventListener('click', () => void this.commands.run('sheet.addRow'));
    this.addRowAnchor = el('div', { className: 'vgrid-add-row-anchor' }, [this.addRowButton]);
    this.addColButton = el(
      'button',
      {
        className: 'sheet-grid-add sheet-grid-add-col',
        attrs: { type: 'button', 'aria-label': t('grid.addColumn'), title: t('grid.addColumn') },
      },
      [createIcon(Plus, 'sheet-grid-add-icon', 14)],
    );
    this.addColButton.addEventListener('click', () => void this.commands.run('sheet.addColumn'));
    this.addColAnchor = el('div', { className: 'vgrid-add-col-anchor' }, [this.addColButton]);
    // Hidden probe carrying the real cell font/box metrics (same `.vcell`
    // styling the grid renders with) so wrap measurement never depends on a
    // materialized cell being present.
    this.measureCell = el('div', {
      className: 'vcell vgrid-measure',
      attrs: { 'aria-hidden': 'true' },
    });
    this.sink = createSink();
    // Visually hidden, ARIA-linked editing guidance for the inline editor
    // (the visible tooltip is the `title` attribute; both follow the
    // editing-help preference and never obscure the cell or caret).
    this.editorHint = el('span', {
      className: 'visually-hidden',
      attrs: { id: 'grid-editor-hint' },
    });
    // Zoom announcements ("Spreadsheet zoom: 125%") for screen readers; the
    // visual change itself is instantaneous (no animation — this also honors
    // reduced-motion preferences by construction).
    this.zoomLive = el('div', {
      className: 'visually-hidden',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.canvas.append(
      this.headerEl,
      this.stickyEl,
      this.rowsLayer,
      this.addRowAnchor,
      this.addColAnchor,
      this.measureCell,
      this.sink,
    );
    this.element.append(this.canvas, this.editorHint, this.zoomLive);

    // Scroll never calls preventDefault, so the listener is passive (the
    // browser can start compositor scrolling without waiting on the handler).
    this.element.addEventListener('scroll', () => this.onScroll(), { passive: true });
    // The container's width can change without a window resize (e.g. layout
    // shifts elsewhere in #app; see styles.css), so a ResizeObserver reflows
    // the grid instead of a plain window 'resize' listener. jsdom (tests) has
    // no ResizeObserver, so this is a no-op there.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => this.onResize(entries));
      this.resizeObserver.observe(this.element);
    }
    this.offKeyboardOpenChange = onKeyboardOpenChange((open) => this.keyboardOpenChanged(open));
    this.offKeyboardResize = onKeyboardResize(() => this.keyboardResized());
    // Ctrl/Cmd + mouse wheel zooms the spreadsheet (grid area only). The
    // listener must be non-passive because the recognized gesture — and only
    // that gesture — prevents the browser's page-zoom default; a plain wheel
    // scroll is never touched.
    this.element.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.element.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.element.addEventListener('mousemove', (event) => this.onMouseMove(event));
    this.element.addEventListener('dblclick', (event) => this.onDoubleClick(event));
    this.element.addEventListener('contextmenu', (event) => this.onContextMenu(event));
    document.addEventListener('mousemove', (event) => this.onResizeMove(event));
    // Mousemove bubbles to document regardless of which element the pointer
    // is over, so this alone drives auto-scroll for a drag whose pointer has
    // left the grid entirely, not just one still inside `this.element`.
    document.addEventListener('mousemove', (event) => this.trackAutoScroll(event));
    document.addEventListener('mouseup', () => this.endActiveDrags());
    // Touch/pen equivalents of the mouse drag wiring above (#290). A real
    // mouse also dispatches pointer events, so every handler below bails out
    // on `pointerType === 'mouse'` and leaves that input to the mouse
    // listeners already registered.
    this.element.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.element.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.element.addEventListener('pointerup', (event) => this.onPointerEnd(event));
    this.element.addEventListener('pointercancel', (event) => this.onPointerEnd(event));
    // Escape cancels an in-progress range-move, fill-handle, or column-resize
    // drag (rolling back safely, since nothing has been committed) before it
    // can reach the commit on mouseup.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (this.movingRange) {
        this.cancelMove();
      }
      if (this.filling) {
        this.cancelFill();
      }
      if (this.resizing) {
        this.cancelResize();
      }
      // Dismiss the copy-source outline, matching the conventional
      // spreadsheet Escape behavior (it only clears the visual marker; the
      // clipboard's own text/matrix — and its ability to still be pasted —
      // is untouched).
      this.setCopySource(null);
    });
    // Escape / outside interaction / resize / scroll dismissal is owned by
    // `ContextMenu` itself, so every context menu in the application behaves
    // identically (see src/ui/context-menu.ts).

    // ----- IME-safe keyboard target (the sink) -----
    // Focusing the grid container (tab stop, corner clicks, cell clicks)
    // forwards focus into the sink so keystrokes and IME compositions always
    // target an editable element.
    this.element.addEventListener('focus', () => this.focusGrid());
    this.wireSink(this.sink);
  }

  /** Attach the sink's IME and editing listeners (see `createSink`, `replaceSink`). */
  private wireSink(sink: HTMLTextAreaElement): void {
    sink.addEventListener('compositionstart', () => {
      this.composing = true;
      // A composition that starts while navigating promotes the sink into the
      // cell editor in place (no focus change, no value reset) so the composed
      // text lands in the cell — including engines that fire no keydown first.
      if (!this.editor) {
        this.beginTypedEdit();
      }
    });
    sink.addEventListener('compositionend', () => {
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
    sink.addEventListener('beforeinput', (event) => {
      // Text about to be inserted while no editor is open (an engine that
      // fires neither keydown 229 nor compositionstart first) still promotes
      // the sink before the value changes. Never synthesized from keydown.
      if (!this.editor && event.inputType.startsWith('insert')) {
        this.beginTypedEdit();
      }
    });
    sink.addEventListener('keydown', (event) => this.sinkKeyDown(event));
    sink.addEventListener('input', () => this.sinkInput());
    sink.addEventListener('click', () => this.editor?.autocomplete.update());
    sink.addEventListener('blur', (event) => {
      // Moving to the formatted field or its toolbar keeps the edit open.
      if (!this.editor?.rich?.owns(event.relatedTarget)) {
        this.commitEditor();
      }
    });
  }

  /**
   * Swap in a fresh sink element, focused by the caller. iOS Safari only
   * brings up the on-screen keyboard for a focus that moves to a *different*
   * element: blurring and refocusing the sink that a tap-to-select already
   * focused read-only (#469) never shows it, while focusing another field
   * from the same `pointerup` does (on-device keyboard probe, #588/#590).
   */
  private replaceSink(): void {
    const old = this.sink;
    const fresh = createSink();
    this.wireSink(fresh);
    this.sink = fresh;
    old.replaceWith(fresh);
  }

  /**
   * Focus the grid's keyboard target (the hidden IME-capturing sink). A plain
   * touch/pen tap only selects a cell — it must not pop the on-screen
   * keyboard (#469) — so DOM focus still moves (scroll-into-view, IME
   * readiness, and any attached physical keyboard keep working exactly as
   * before), but the virtual keyboard is suppressed for that one focus call
   * by briefly making the sink read-only around it, the standard technique
   * for focusing an input without triggering a mobile on-screen keyboard.
   * `openEditor`'s own direct `.focus()` call when editing actually starts
   * (double-tap, Enter, F2, the formula bar, …) is untouched, so the
   * keyboard still appears exactly then.
   */
  focusGrid(): void {
    if (this.lastPointerType === 'mouse') {
      this.sink.focus({ preventScroll: true });
      return;
    }
    this.focusSinkSilently();
  }

  /** Focus the sink without ever popping the mobile on-screen keyboard —
   * the standard technique of briefly marking the target read-only around
   * the focus call. Used for focus claims that are never themselves an
   * explicit edit-entry gesture (a touch tap-to-select, or a document
   * becoming active with nothing else focused), regardless of device. */
  private focusSinkSilently(): void {
    this.sink.readOnly = true;
    this.sink.focus({ preventScroll: true });
    this.sink.readOnly = false;
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

  /** The active filter's hidden-row set (null when nothing is filtered). */
  private hiddenOf(tab: Tab): Set<number> | null {
    return this.state.hiddenRows(tab);
  }

  /**
   * The document row whose content belongs at display slot `row`. Identity
   * when nothing is sorted — see `AppState.docRow`/`core/sort.ts`.
   */
  private docRowOf(tab: Tab, row: number): number {
    return this.state.docRow(tab, row);
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
  /** Hidden-row snapshot the row-height index was seeded with, per document. */
  private readonly indexHidden = new WeakMap<object, Set<number> | null>();
  /** Active sort the row-height index was built against, per document. */
  private readonly indexSort = new WeakMap<object, SheetSort | null>();

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
  private heightIndex(tab: Tab): RowHeightIndex {
    let index = this.rowHeights.get(tab.doc);
    const hidden = this.hiddenOf(tab);
    const sort = tab.doc.kind === 'rsf' ? tab.doc.sort : null;
    if (
      !index ||
      this.indexZoom.get(tab.doc) !== tab.zoom ||
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
      this.indexHidden.set(tab.doc, hidden ?? null);
      this.indexSort.set(tab.doc, sort);
      this.wrapPassSig = null; // re-measure wrapped heights for the new state
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

  /**
   * Display slots `[0, n)` that stay pinned below the column header (the
   * sticky first row, or every row above a freeze-at-selection point). With
   * nothing frozen, the first row still follows the scroll on its own (see
   * `autoPinnedRow`). A frozen area whose rows are all hidden by the active
   * filter pins nothing (pinning them would show rows the filter hides).
   */
  private frozenRowCount(tab: Tab): number {
    let n = Math.max(1, this.state.frozenPanes(tab).rows);
    // Keep at least one scrollable row on screen: a freeze point far down the
    // sheet pins only as many rows as fit (never measured without a layout).
    const viewH = this.element.clientHeight;
    if (viewH > 0) {
      n = Math.min(n, Math.max(1, Math.floor(viewH / this.rowH(tab)) - 2));
    }
    return n > 0 && this.pinnedSlots(tab, n).length > 0 ? n : 0;
  }

  /**
   * Whether the pinned first row is only the automatic one (no row frozen by
   * the user): it looks like an ordinary row, with no boundary rule.
   */
  private autoPinnedRow(tab: Tab): boolean {
    return this.state.frozenPanes(tab).rows === 0;
  }

  /** Pinned-row count, negated for the automatic first row (a layout-signature input). */
  private rowPinSignature(tab: Tab): number {
    const n = this.frozenRowCount(tab);
    return this.autoPinnedRow(tab) ? -n : n;
  }

  /** The visible (not filtered-out) display slots among the first `n`. */
  private pinnedSlots(tab: Tab, n = this.frozenRowCount(tab)): number[] {
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
  private scrollRowBase(tab: Tab): number {
    return this.frozenRowCount(tab);
  }

  /** Height of the sticky overlays: the single-line column header plus the pinned rows. */
  private overlayHeight(tab: Tab): number {
    return this.rowH(tab) + this.pinnedHeight(tab);
  }

  /** Total height of the pinned rows (each at its own, possibly wrapped, height). */
  private pinnedHeight(tab: Tab): number {
    const idx = this.heightIndex(tab);
    let h = 0;
    for (const slot of this.pinnedSlots(tab)) {
      h += idx.heightOf(slot);
    }
    return h;
  }

  /** Columns `[0, n)` that stay pinned right of the row numbers. */
  private frozenColCount(tab: Tab): number {
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
  private scrollColBase(tab: Tab): number {
    return this.frozenColCount(tab);
  }

  /** Width of the pinned columns (not counting the row-number column). */
  private frozenColsWidth(tab: Tab): number {
    return this.colOffset(tab, this.frozenColCount(tab));
  }

  /**
   * Width of the sticky horizontal overlay (row headers + pinned columns)
   * that the scrollable column region starts after.
   */
  private overlayWidth(tab: Tab): number {
    return this.headW(tab) + this.frozenColsWidth(tab);
  }

  /** Rendered pixel width of a column (per-tab override or default, zoomed). */
  private colWidth(tab: Tab, col: number): number {
    const w = tab.colWidths[col];
    return Math.round((w && w > 0 ? w : COL_WIDTH) * this.zoomOf(tab));
  }

  /**
   * The column-offset index for `tab`, rebuilding it only when the widths
   * array, zoom, or column count it was built from have changed since the
   * last call.
   */
  private colOffsetIndex(tab: Tab): ColOffsetIndex {
    const cached = this.colOffsets.get(tab.doc);
    const columnCount = tab.doc.columnCount;
    if (
      cached &&
      cached.zoom === tab.zoom &&
      cached.widths === tab.colWidths &&
      cached.columnCount === columnCount
    ) {
      return cached.index;
    }
    const index = new ColOffsetIndex(columnCount, (c) => this.colWidth(tab, c));
    this.colOffsets.set(tab.doc, { index, zoom: tab.zoom, columnCount, widths: tab.colWidths });
    return index;
  }

  /**
   * Drop the cached column-offset index for `tab`'s document (used after a
   * resize or autofit mutates `colWidths` in place, which the cache's
   * reference check alone would not catch).
   */
  private invalidateColOffsets(tab: Tab): void {
    this.colOffsets.delete(tab.doc);
  }

  /** X offset (from the first column) of column `col`, i.e. the summed widths before it. */
  private colOffset(tab: Tab, col: number): number {
    return this.colOffsetIndex(tab).offsetOf(col);
  }

  private totalColsWidth(tab: Tab): number {
    return this.colOffsetIndex(tab).totalWidth;
  }

  private totalWidth(tab: Tab): number {
    return this.headW(tab) + this.totalColsWidth(tab);
  }

  /**
   * Position the "add row" / "add column" anchors at the true bottom/right
   * edge of the document content (#467) and sync their enabled state. Their
   * perpendicular axis (horizontal for add-row, vertical for add-column) is
   * handled entirely by CSS `position: sticky`, so only the axis that tracks
   * document size — not scroll position — needs updating here.
   */
  private positionGridAddButtons(totalW: number, totalH: number): void {
    this.addRowAnchor.hidden = false;
    this.addColAnchor.hidden = false;
    this.addRowAnchor.style.top = `${totalH}px`;
    this.addColAnchor.style.left = `${totalW}px`;
    this.addRowButton.disabled = !this.commands.isEnabled('sheet.addRow');
    this.addColButton.disabled = !this.commands.isEnabled('sheet.addColumn');
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
      this.addRowAnchor.hidden = true;
      this.addColAnchor.hidden = true;
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
        this.focusSinkSilently();
      }
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
      sticky: this.rowPinSignature(tab),
      stickyCol: this.frozenColCount(tab),
      locale: getLocale(),
      zoom: tab.zoom,
      hidden: this.hiddenOf(tab),
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
      this.layout?.sticky === this.rowPinSignature(tab) && this.layout.stickyCol === this.frozenColCount(tab)
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
    // The active cell's row is highlighted only while a single cell is
    // selected; a multi-cell range already shows where the selection is.
    const multiCell = range !== null && (range.top !== range.bottom || range.left !== range.right);
    const rows = this.canvas.querySelectorAll<HTMLElement>('.vgrid-row, .vgrid-stickyrow');
    for (const rowEl of rows) {
      const row = Number(rowEl.dataset.row);
      const inSelRows = range !== null && kind === 'row' && row >= range.top && row <= range.bottom;
      rowEl.classList.toggle(
        'selected-row',
        inSelRows || (!multiCell && active !== null && active.row === row),
      );
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
    this.placeMoveHandle(tab, range);
    this.placeCopySourceOutline();
    this.positionSink();
  }

  /**
   * Put an accessible move handle on the top-left cell of the current selection
   * for RSF worksheets (moving a range is a structural edit a byte-preserving
   * CSV cannot represent, so it is offered only where it is possible). Dragging
   * it moves the selected range; the same move is available without a pointer
   * via the "Move Selected Cells…" command.
   */
  private placeMoveHandle(tab: Tab, range: CellRange | null): void {
    for (const old of this.canvas.querySelectorAll('.move-handle')) {
      old.remove();
    }
    if (!range || tab.doc.kind !== 'rsf' || tab.doc.rowCount === 0) {
      return;
    }
    const cell = this.cellAt(range.top, range.left);
    if (!cell) {
      return; // the corner is scrolled out of view
    }
    const handle = el('div', {
      className: 'move-handle',
      attrs: { 'data-movehandle': 'true', 'aria-hidden': 'true', title: t('grid.moveHandleTitle') },
    });
    cell.append(handle);
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

  /**
   * Set (or clear, with `null`) the range to outline as a copy source — an
   * animated "marching ants" border so the origin of an in-progress copy
   * stays visible while the user picks where to paste it. Purely a view
   * concern (`main.ts` drives it from `ClipboardController`), not part of
   * `Tab`/`AppState`: it never affects selection, is never persisted, and is
   * cleared independently of the selection itself.
   */
  setCopySource(range: CellRange | null): void {
    if (this.copySource === range) {
      return;
    }
    this.copySource = range;
    this.placeCopySourceOutline();
  }

  /**
   * Position a single overlay `div` over the copy-source range's rendered
   * pixel rect, the same way `placeMoveHandle`/`placeFillHandle` above
   * anchor to one corner cell — except this one must span the *whole*
   * rectangle, not just a corner, so it is measured from both corner cells'
   * `getBoundingClientRect()` relative to the canvas's own, the same
   * technique `placeSinkOverCell` uses. Like those handles, a corner that has
   * scrolled out of the rendered window simply means no overlay this frame —
   * it reappears once the range scrolls back into view.
   */
  private placeCopySourceOutline(): void {
    for (const old of this.canvas.querySelectorAll('.copy-source-outline')) {
      old.remove();
    }
    const range = this.copySource;
    if (!range) {
      return;
    }
    const topLeft = this.cellAt(range.top, range.left);
    const bottomRight = this.cellAt(range.bottom, range.right);
    if (!topLeft || !bottomRight) {
      return; // a corner is scrolled out of view
    }
    const origin = this.canvas.getBoundingClientRect();
    const tl = topLeft.getBoundingClientRect();
    const br = bottomRight.getBoundingClientRect();
    const outline = el('div', { className: 'copy-source-outline', attrs: { 'aria-hidden': 'true' } });
    outline.style.left = `${tl.left - origin.left}px`;
    outline.style.top = `${tl.top - origin.top}px`;
    outline.style.width = `${br.right - tl.left}px`;
    outline.style.height = `${br.bottom - tl.top}px`;
    this.canvas.append(outline);
  }

  /**
   * Ctrl (Windows/Linux) / Cmd (macOS) + mouse wheel: step the spreadsheet
   * zoom through the shared presets, anchored at the pointer so the content
   * under the cursor stays put instead of jumping. Only the recognized
   * gesture over the grid is consumed; plain scrolling, IME composition,
   * open editors, and active drags (resize/fill/selection/reference entry)
   * are left alone, and the browser's own zoom shortcuts are never touched.
   */
  private onWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return; // plain scroll (or an OS-level gesture): never intercepted
    }
    const tab = this.state.activeTab;
    if (!tab || tab.doc !== this.lastDoc) {
      return;
    }
    if (this.composing || this.editor !== null) {
      return; // text entry owns the interaction
    }
    if (
      this.resizing ||
      this.filling ||
      this.dragging ||
      this.headerDrag ||
      this.refDrag ||
      this.movingRange
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
    const oldZoom = this.zoomOf(tab);
    const next = nextZoomLevel(tab.zoom, direction);
    if (next === tab.zoom) {
      return; // already at the preset range's end
    }
    // Pointer anchor in content coordinates (inside the scrolling region).
    const rect = this.element.getBoundingClientRect();
    const px = Math.max(0, event.clientX - rect.left - this.overlayWidth(tab));
    const py = Math.max(0, event.clientY - rect.top - this.overlayHeight(tab));
    const contentX = this.element.scrollLeft + px;
    const contentY = this.element.scrollTop + py;
    // Shared zoom state/command path (same as the menu and shortcuts); the
    // 'view' event re-renders the grid synchronously with the new metrics.
    this.state.setTabZoom(tab, next);
    // Keep the content point under the pointer: content coordinates scale
    // (approximately, up to per-cell rounding) with the zoom ratio.
    const scale = this.zoomOf(tab) / oldZoom;
    this.element.scrollLeft = Math.max(0, Math.round(contentX * scale - px));
    this.element.scrollTop = Math.max(0, Math.round(contentY * scale - py));
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
  private onResize(entries?: readonly ResizeObserverEntry[]): void {
    const width = entries?.[0]?.contentRect.width;
    if (this.editor !== null && width !== undefined && width === this.lastResizeWidth) {
      const cell = this.cellAt(this.editor.row, this.editor.col);
      if (cell) {
        this.placeSinkOverCell(cell);
      }
      // The grid got shorter (e.g. the app now fits above an on-screen
      // keyboard): scroll the edited cell back into view if it ended up below
      // the fold. The editor stays open (see `render`).
      const tab = this.state.activeTab;
      if (tab) {
        this.scrollCellIntoView(tab, this.editor.row, this.editor.col, false);
      }
      return;
    }
    if (width !== undefined) {
      this.lastResizeWidth = width;
    }
    if (this.resizeScheduled) {
      return;
    }
    this.resizeScheduled = true;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: () => void) => setTimeout(fn, 16);
    schedule(() => {
      this.resizeScheduled = false;
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
    const viewW = Math.max(0, this.element.clientWidth - this.overlayWidth(tab));
    const scrollTop = this.element.scrollTop;
    const scrollLeft = this.element.scrollLeft;
    const rowCount = tab.doc.rowCount;
    const startRow = this.scrollRowBase(tab);
    const startCol = this.scrollColBase(tab);
    const totalCols = Math.max(1, tab.doc.columnCount);
    // Row window from the height index: the scroll layer's content origin is
    // the top of the first scroll row, so add its offset to scrollTop. With a
    // uniform (unwrapped) index this reduces exactly to floor(scrollTop / H).
    const originY = idx.offsetOf(startRow);
    const first = Math.max(startRow, idx.rowAtOffset(originY + scrollTop, rowCount));
    const last = idx.rowAtOffset(originY + scrollTop + viewH, rowCount) + 1;
    const rowStart = Math.max(startRow, first - OVERSCAN_ROWS);
    const rowEnd = Math.min(rowCount, last + OVERSCAN_ROWS);
    // Columns have per-column widths; the cached offset index answers the
    // visible range in O(log n) instead of walking every column from 0.
    const colIdx = this.colOffsetIndex(tab);
    // Pinned columns sit over the start of the scrolled band, and the band
    // itself runs to the right edge of everything past the row numbers.
    const firstVisible = colIdx.colAtOrBefore(scrollLeft + this.frozenColsWidth(tab));
    const limit = scrollLeft + viewW + this.frozenColsWidth(tab);
    const lastVisible = colIdx.colAtOrAfter(limit);
    const colStart = Math.max(startCol, firstVisible - OVERSCAN_COLS);
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
      // No wrapping: every row is single-line — except rows an active filter
      // hides, whose collapsed (0-height) overrides must be preserved so the
      // virtualization still skips their bands.
      idx.clear();
      const hidden = this.hiddenOf(tab);
      if (hidden) {
        for (const row of hidden) {
          idx.set(row, 0);
        }
      }
      this.wrapPassSig = null;
    }
    let win = this.computeWindow(tab);
    if (measurer) {
      this.measureWindowRows(tab, win, measurer, idx);
      win = this.computeWindow(tab);
      this.scheduleWrapPass(tab, measurer);
    }
    if (this.sameWindow(this.window, win) && this.samePins(tab)) {
      this.paintWindowCells(tab);
      this.refreshSelection();
      this.refreshFormulaRefs();
      return;
    }
    this.window = win;
    this.layout = this.layoutSignature(tab);

    const totalW = this.totalWidth(tab);
    const startRow = this.scrollRowBase(tab);
    const originY = idx.offsetOf(startRow);
    const originX = this.colOffset(tab, this.scrollColBase(tab));
    const layerHeight = idx.rangeHeight(startRow, doc.rowCount);
    // Zoom is applied through CSS custom properties (font sizes, line boxes)
    // plus the scaled JS metrics; the JS-computed row height stays the source
    // of truth so CSS line heights and element heights can never drift apart.
    this.element.style.setProperty('--sheet-zoom', String(this.zoomOf(tab)));
    this.element.style.setProperty('--grid-row-height', `${this.rowH(tab)}px`);
    this.element.style.setProperty('--grid-wrap-line', `${this.wrapLineH(tab)}px`);
    // Use the element's own document, not the global `document`: a deferred
    // wrap pass (see runWrapPass) can still call render() after a torn-down
    // test environment has unbound the global `document` while this element's
    // ownerDocument reference is still alive.
    this.element.ownerDocument.documentElement.style.setProperty('--sheet-zoom', String(this.zoomOf(tab)));
    // Announce zoom changes politely (menu, shortcut, or wheel — one shared
    // path). The first render of a tab sets the baseline silently.
    if (this.announcedZoom === null) {
      this.announcedZoom = tab.zoom;
    } else if (this.announcedZoom !== tab.zoom) {
      this.announcedZoom = tab.zoom;
      this.zoomLive.textContent = t('grid.zoomAnnounce', { pct: tab.zoom });
    }
    this.canvas.style.width = `${totalW}px`;
    this.canvas.style.height = `${this.overlayHeight(tab) + layerHeight}px`;
    this.positionGridAddButtons(totalW, this.overlayHeight(tab) + layerHeight);
    this.element.setAttribute('aria-rowcount', String(doc.rowCount + 1));
    this.element.setAttribute('aria-colcount', String(doc.columnCount + 1));

    // ----- Column header (always sticky, single-line) -----
    clearChildren(this.headerEl);
    this.headerEl.style.width = `${totalW}px`;
    this.headerEl.style.height = `${this.rowH(tab)}px`;
    this.headerEl.append(this.buildCorner(tab));
    const frozenCols = this.frozenColCount(tab);
    for (let c = 0; c < frozenCols; c++) {
      const pinnedHead = this.buildColumnHeaderCell(tab, c, true);
      this.pinColumnCell(tab, pinnedHead, c, frozenCols);
      this.headerEl.append(pinnedHead);
    }
    const headSpacer = el('div', { className: 'vspacer', attrs: { 'aria-hidden': 'true' } });
    headSpacer.style.width = `${this.colOffset(tab, win.colStart) - originX}px`;
    this.headerEl.append(headSpacer);
    for (let c = win.colStart; c < win.colEnd; c++) {
      this.headerEl.append(this.buildColumnHeaderCell(tab, c, false));
    }

    // ----- Pinned record rows (optional, single-line, distinct) -----
    clearChildren(this.stickyEl);
    const pinned = this.pinnedSlots(tab);
    const autoPinned = this.autoPinnedRow(tab);
    this.stickyEl.classList.toggle('auto', autoPinned);
    if (pinned.length > 0) {
      this.stickyEl.hidden = false;
      this.stickyEl.style.width = `${totalW}px`;
      this.stickyEl.style.height = `${this.pinnedHeight(tab)}px`;
      this.stickyEl.style.top = `${this.rowH(tab)}px`;
      for (const slot of pinned) {
        const row = this.docRowOf(tab, slot);
        const rowEl = el('div', {
          className: `vgrid-stickyrow${slot % 2 === 1 ? ' alt' : ''}`,
          attrs: { role: 'row', 'data-row': String(row), 'aria-rowindex': String(slot + 2) },
        });
        const height = idx.heightOf(slot);
        if (height > this.rowH(tab)) {
          rowEl.classList.add('wrapped');
        }
        rowEl.style.width = `${totalW}px`;
        rowEl.style.height = `${height}px`;
        this.buildRowCells(tab, rowEl, row, win, !autoPinned);
        this.stickyEl.append(rowEl);
      }
    } else {
      this.stickyEl.hidden = true;
    }

    // ----- Virtualized data rows (variable height) -----
    clearChildren(this.rowsLayer);
    this.rowsLayer.style.height = `${layerHeight}px`;
    for (let slot = win.rowStart; slot < win.rowEnd; slot++) {
      const height = idx.heightOf(slot);
      if (height === 0) {
        continue; // hidden by the active filter: no DOM is materialized
      }
      const row = this.docRowOf(tab, slot);
      const wrapped = height > this.rowH(tab);
      const rowEl = el('div', {
        className: `vgrid-row ${slot % 2 === 1 ? 'alt' : ''}${wrapped ? ' wrapped' : ''}`,
        attrs: { role: 'row', 'data-row': String(row), 'aria-rowindex': String(slot + 2) },
      });
      rowEl.style.top = `${idx.offsetOf(slot) - originY}px`;
      rowEl.style.height = `${height}px`;
      rowEl.style.width = `${totalW}px`;
      this.buildRowCells(tab, rowEl, row, win, false);
      this.rowsLayer.append(rowEl);
    }
    if (this.editor) {
      // The sink lives in the canvas, not in the rebuilt rows, so the editor
      // survives a window change. Keep it open while its cell is still
      // rendered — e.g. the grid scrolled a few rows to keep it above an
      // on-screen keyboard — and commit only once the cell has left the
      // window.
      const cell = this.cellAt(this.editor.row, this.editor.col);
      if (cell) {
        this.placeSinkOverCell(cell);
      } else {
        this.commitEditor();
      }
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
   * needs more than one visual line exceed the single-line height. Pinned
   * rows wrap like any other row, so the first row looks the same whether or
   * not it currently follows the scroll.
   */
  private computeRowHeight(tab: Tab, row: number, measure: WrapMeasure, chrome: number): number {
    if (this.hiddenOf(tab)?.has(row)) {
      return 0; // filtered out: the row's band collapses entirely
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
    // The pinned rows are on screen too, above the scrolled window.
    const slots = [...this.pinnedSlots(tab)];
    for (let slot = win.rowStart; slot < win.rowEnd; slot++) {
      slots.push(slot);
    }
    for (const slot of slots) {
      const row = this.docRowOf(tab, slot);
      if (idx.set(slot, this.computeRowHeight(tab, row, m.measure, m.chrome))) {
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
      this.commands.setBusy(t('loading.wrapMeasure', { done: 0, total, pct: 0 }), 0);
    }
    try {
      const ok = await forEachIndexSliced(
        total,
        (slot) => {
          const row = this.docRowOf(tab, slot);
          if (idx.set(slot, this.computeRowHeight(tab, row, m.measure, m.chrome))) {
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
              this.commands.setBusy(t('loading.wrapMeasure', { done, total, pct }), pct);
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
    if (!this.element.ownerDocument.defaultView) {
      // The element's document was detached from its view: skip the pointless
      // re-layout. NOTE this does NOT catch a torn-down test environment —
      // `ownerDocument.defaultView` stays truthy there while the *global*
      // `document` disappears. `render` itself carries that guard.
      return;
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
    this.addRowAnchor.style.top = `${this.overlayHeight(tab) + layerHeight}px`;
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
   * Build one column-header cell (letter label, optional filter button, and
   * resize handle). Shared by the windowed header loop and the pinned first
   * column's header cell — the same cell markup either way, since only the
   * pinned copy's positioning (see `.colpin`) differs.
   */
  private buildColumnHeaderCell(tab: Tab, c: number, pinned: boolean): HTMLElement {
    const doc = tab.doc;
    const filter = doc.kind === 'rsf' ? doc.filter : null;
    const head = el('div', {
      className: `vcell vhead${pinned ? ' pinned' : ''}`,
      text: columnLabel(c),
      attrs: {
        role: 'columnheader',
        'data-colhead': String(c),
        'aria-colindex': String(c + 2),
        title: pinned
          ? t('grid.stickyColTitle', { letter: columnLabel(c) })
          : t('grid.colTitle', { letter: columnLabel(c), n: c + 1 }),
      },
    });
    head.style.width = `${this.colWidth(tab, c)}px`;
    // Active filter: every column of the filtered range gets a keyboard-
    // accessible filter button in its header; columns that carry criteria
    // show it filled. The button dispatches the same shared filter command
    // as the menu and context menu.
    // With a header row, the buttons sit in the header row's own cells
    // instead (see `headerFilterButton`).
    if (filter && !filter.headerRow && c >= filter.left && c <= filter.right) {
      const filtered = filter.columns.some((column) => column.col === c);
      const key = filtered ? 'grid.filterButtonActive' : 'grid.filterButton';
      const filterButton = el('button', {
        className: `filter-indicator${filtered ? ' active' : ''}`,
        text: '▼',
        attrs: {
          type: 'button',
          'data-colfilter': String(c),
          'aria-label': t(key, { letter: columnLabel(c) }),
          title: t(key, { letter: columnLabel(c) }),
        },
      });
      filterButton.addEventListener('mousedown', (event) => event.stopPropagation());
      filterButton.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.commands.filterDialog(tab, c);
      });
      head.append(filterButton);
    }
    // Draggable boundary to resize; double-click auto-fits to visible content.
    const handle = el('div', {
      className: 'col-resize-handle',
      attrs: { 'data-colresize': String(c), 'aria-hidden': 'true', title: t('grid.resizeTitle') },
    });
    head.append(handle);
    return head;
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

  /**
   * Render the formula bar's in-progress raw text on the active cell,
   * ahead of the actual commit — mirrors how the grid's own inline editor
   * already shows uncommitted text live. Pass `null` to restore the cell's
   * committed value. Only repaints the previous and new preview cells (not
   * a full window repaint), and never touches a cell under an open inline
   * editor, which already renders its own live text.
   */
  setFormulaLivePreview(preview: FormulaLivePreview | null): void {
    const prev = this.formulaLivePreview;
    this.formulaLivePreview = preview;
    const tab = this.state.activeTab;
    if (!tab) return;
    for (const p of [prev, preview]) {
      if (!p) continue;
      if (this.editor && this.editor.row === p.row && this.editor.col === p.col) continue;
      const cell = this.canvas.querySelector<HTMLElement>(`[data-row="${p.row}"][data-col="${p.col}"]`);
      if (cell) this.paintCell(tab, cell, p.row, p.col);
    }
  }

  private refreshFormulaRefs(): void {
    const tab = this.state.activeTab;
    const usable = tab !== null && tab.doc === this.lastDoc;
    const rows = usable ? tab.doc.rowCount : 0;
    const cols = usable ? tab.doc.columnCount : 0;
    const ranges = clampFormulaRefs(usable ? this.formulaRefs : [], rows, cols);
    for (const cell of this.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]')) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const match = matchFormulaRefCell(row, col, ranges);
      cell.classList.toggle('fref', match !== null);
      for (let k = 0; k < 4; k++) {
        cell.classList.toggle(`fref-${k}`, match !== null && match.idx === k);
      }
      cell.classList.toggle('fref-top', match?.top ?? false);
      cell.classList.toggle('fref-bottom', match?.bottom ?? false);
      cell.classList.toggle('fref-left', match?.left ?? false);
      cell.classList.toggle('fref-right', match?.right ?? false);
    }
    this.updateRefIndicator(tab, ranges);
  }

  /** Show/hide the "reference extends beyond the visible area" status note. */
  private updateRefIndicator(tab: Tab | null, ranges: ClampedFormulaRef[]): void {
    const win = this.window;
    let clipped = false;
    if (tab && win && ranges.length > 0) {
      // The window's slots already start past the pinned rows; while it sits
      // right below them, the pinned rows extend the visible band to the top.
      const base = this.scrollRowBase(tab);
      clipped = formulaRefsExceedViewport(ranges, {
        firstRow: win.rowStart === base ? 0 : win.rowStart,
        lastRow: win.rowEnd - 1,
        colStart: win.colStart,
        colEnd: win.colEnd,
      });
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
      text: String(row + 1),
      attrs: { role: 'rowheader', 'data-rowhead': String(row), 'aria-colindex': '1' },
    });
    if (pinned) {
      head.setAttribute('title', t('grid.stickyRowTitle', { n: row + 1 }));
    }
    head.style.width = `${this.headW(tab)}px`;
    rowEl.append(head);
    const fieldCount = doc.fieldCount(row);
    const frozenCols = this.frozenColCount(tab);
    for (let c = 0; c < frozenCols; c++) {
      const pinCell = this.buildDataCell(tab, row, c, fieldCount);
      this.pinColumnCell(tab, pinCell, c, frozenCols);
      rowEl.append(pinCell);
    }
    const originX = this.colOffset(tab, this.scrollColBase(tab));
    const spacer = el('div', { className: 'vspacer', attrs: { 'aria-hidden': 'true' } });
    spacer.style.width = `${this.colOffset(tab, win.colStart) - originX}px`;
    rowEl.append(spacer);
    for (let c = win.colStart; c < win.colEnd; c++) {
      rowEl.append(this.buildDataCell(tab, row, c, fieldCount));
    }
  }

  /** Make a cell of pinned column `c` stick right of the row numbers (and the pinned columns before it). */
  private pinColumnCell(tab: Tab, cell: HTMLElement, c: number, frozenCols: number): void {
    cell.classList.add('colpin');
    cell.classList.toggle('colpin-edge', c === frozenCols - 1);
    cell.style.left = `${this.headW(tab) + this.colOffset(tab, c)}px`;
  }

  /** Build one data cell (or a void placeholder past the row's field count). */
  private buildDataCell(tab: Tab, row: number, c: number, fieldCount: number): HTMLElement {
    if (c >= fieldCount) {
      const voidCell = el('div', { className: 'vcell void', attrs: { 'aria-hidden': 'true' } });
      voidCell.style.width = `${this.colWidth(tab, c)}px`;
      return voidCell;
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
    return cell;
  }

  private paintCell(tab: Tab, cell: HTMLElement, row: number, col: number): void {
    const doc = tab.doc;
    const preview = this.formulaLivePreview;
    const value =
      preview && preview.row === row && preview.col === col ? preview.value : doc.getDisplayValue(row, col);
    const button = this.headerFilterButton(tab, row, col);
    const rich = this.richRuns(tab, row, col, value);
    cell.classList.toggle('rich-text', rich !== null);
    if (rich) {
      // Rich text: one span per formatted part (text only, never HTML).
      const conditionalColor =
        doc.kind === 'rsf' ? doc.getConditionalFormatStyle(row, col)?.textColor : undefined;
      const spans = richTextNodes(rich, doc.kind === 'rsf' ? doc.getStyle(row, col) : null, conditionalColor);
      cell.replaceChildren(...spans, ...(button ? [button] : []));
      cell.classList.toggle('has-filter-button', button !== null);
    } else if (button) {
      // A header-row filter cell: its text node plus the button (the text
      // stays the first child, so caret hit-testing keeps working).
      cell.replaceChildren(value, button);
      cell.classList.add('has-filter-button');
    } else {
      cell.classList.remove('has-filter-button');
      if (cell.textContent !== value || cell.childElementCount > 0) {
        cell.textContent = value;
      }
    }
    if (doc.kind === 'csv') {
      const field = doc.getField(row, col);
      // A brand-new CSV has no original file to differ from, so its edits
      // are not highlighted until the first save sets a baseline.
      const edited = !tab.neverSaved && doc.isEdited(row, col);
      cell.classList.toggle('edited', edited);
      cell.classList.toggle('malformed', field?.malformed ?? false);
      if (edited) {
        // Safe text-only tooltip showing the original value.
        cell.title = doc.getOriginalValue(row, col);
      } else if (field?.malformed) {
        // Safe text-only tooltip explaining the structural parsing problem.
        cell.title = this.malformedFieldTooltip(doc, row, col);
      } else if (cell.title !== '') {
        cell.removeAttribute('title');
      }
    } else {
      const formula = doc.isFormulaCell(row, col);
      cell.classList.toggle('formula', formula);
      const isError = formula && doc.evaluateCell(row, col).type === 'error';
      cell.classList.toggle('cell-error', isError);
      const comment = doc.getComment(row, col);
      cell.classList.toggle('cell-comment', comment !== null);
      // Tooltip shows the underlying formula expression and/or the comment
      // text, whichever apply; cleared when neither does.
      const titleParts: string[] = [];
      if (formula) {
        titleParts.push(doc.getValue(row, col));
      }
      if (comment !== null) {
        titleParts.push(comment);
      }
      if (titleParts.length > 0) {
        cell.title = titleParts.join('\n');
      } else if (cell.title !== '') {
        cell.removeAttribute('title');
      }
      this.paintCellStyle(cell, doc, row, col);
      if (rich) {
        // Each part carries its own underline; a cell-wide one could not be
        // switched off for a plain part.
        cell.classList.remove('cell-underline');
      }
    }
  }

  /**
   * The rich-text runs to paint for a cell, or null for plain text: only on
   * a grid worksheet, only while the runs still spell out the cell's input,
   * and only when the cell shows that input as-is (not a formula result or
   * a number format's rendering, and not a live formula preview).
   */
  private richRuns(tab: Tab, row: number, col: number, shown: string): readonly TextRun[] | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.activeSheet.kind !== 'grid') {
      return null;
    }
    const runs = doc.getStyle(row, col)?.runs;
    if (!runs) {
      return null;
    }
    const input = doc.getValue(row, col);
    return input === shown ? runsForText(runs, input) : null;
  }

  /**
   * The filter button of a header-row cell of the active filter range, or
   * null for any other cell. Shows whether the column narrows the rows
   * (filled) and whether the rows are ordered by it (an arrow); opens the
   * column menu (see `src/ui/column-menu.ts`).
   */
  private headerFilterButton(tab: Tab, row: number, col: number): HTMLButtonElement | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || !this.isHeaderFilterCell(tab, row, col)) {
      return null;
    }
    const filter = doc.filter!;
    const sort = doc.sort;
    const key = sort && sort.keys[0]?.col === col ? sort.keys[0] : null;
    const filtered = filter.columns.some((column) => column.col === col);
    const letter = columnLabel(col);
    const parts = [t('grid.headerFilterButton', { letter })];
    if (filtered) {
      parts.push(t('grid.headerFilterFiltered'));
    }
    if (key) {
      parts.push(t(key.ascending ? 'grid.headerFilterSortedAsc' : 'grid.headerFilterSortedDesc'));
    }
    const label = parts.join(' ');
    const button = el('button', {
      className: `header-filter-button${filtered ? ' filtered' : ''}${key ? ' sorted' : ''}`,
      attrs: {
        type: 'button',
        tabindex: '-1',
        'data-headerfilter': String(col),
        'aria-label': label,
        'aria-haspopup': 'dialog',
        title: label,
      },
    });
    if (filtered) {
      button.append(createIcon(ListFilter, 'header-filter-icon', 12));
    }
    if (key) {
      button.append(
        createIcon(key.ascending ? ArrowUpNarrowWide : ArrowDownWideNarrow, 'header-filter-icon', 12),
      );
    }
    if (!filtered && !key) {
      button.append(createIcon(ChevronDown, 'header-filter-icon', 12));
    }
    // Keep a press from starting a selection drag or opening the editor.
    button.addEventListener('mousedown', (event) => event.stopPropagation());
    button.addEventListener('dblclick', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openColumnMenu(tab, col, button);
    });
    return button;
  }

  /** True for a header-row cell of the active filter range (it carries a filter button). */
  private isHeaderFilterCell(tab: Tab, row: number, col: number): boolean {
    const filter = tab.doc.kind === 'rsf' ? tab.doc.filter : null;
    return (
      filter !== null && filter.headerRow && row === filter.top && col >= filter.left && col <= filter.right
    );
  }

  /** Open the column menu for `col` below `anchor`, then return focus to the grid. */
  private openColumnMenu(tab: Tab, col: number, anchor: HTMLElement | null): void {
    const r = anchor?.getBoundingClientRect();
    const rect = r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    void this.commands.columnMenu(tab, col, rect).finally(() => {
      if (this.state.activeTab === tab) {
        this.focusGrid();
      }
    });
  }

  /** Human-readable explanation of a malformed field's structural problem(s). */
  private malformedFieldTooltip(doc: LosslessDocument, row: number, col: number): string {
    const diags = doc.getFieldDiagnostics(row, col);
    if (diags.length === 0) {
      return '';
    }
    return diags
      .map(
        (d) =>
          `${t(`diag.${d.type}`)}: ${t(`diagDesc.${d.type}`, { expected: d.expected ?? 0, actual: d.actual ?? 0 })}`,
      )
      .join('\n');
  }

  /**
   * Apply (or clear) one cell's visual style — bold/italic/underline as CSS
   * classes, colors and borders as inline styles so any `#rrggbb` value works
   * without a matching stylesheet rule. Assigning `''` restores the normal
   * grid appearance (the default border/background from `.vcell` in
   * `src/styles.css`), so this is safe to call on a reused, previously
   * styled cell element.
   *
   * A border shared with a neighbor is painted exactly once, as a single
   * line, instead of each cell drawing its own side: this cell paints its
   * bottom/right edges as the merge of its own borderBottom/Right with the
   * neighbor below/right's borderTop/Left ({@link resolveSharedBorder}), and
   * never paints its top/left edges except at the grid's own top/left
   * boundary (row/col 0) — the cell above/to the left already painted that
   * shared edge as its own (merged) bottom/right.
   *
   * A matching conditional-formatting rule (Format > Conditional
   * Formatting…, `conditional-format.ts`) overrides the cell's own
   * background/text color — the same "computed appearance wins" precedence
   * every mainstream spreadsheet uses — but never its bold/italic/underline
   * or borders, which conditional formatting cannot set.
   */
  private paintCellStyle(cell: HTMLElement, doc: RsfDocument, row: number, col: number): void {
    const style = doc.getStyle(row, col);
    const conditional = doc.getConditionalFormatStyle(row, col);
    cell.classList.toggle('cell-bold', !!style?.bold);
    cell.classList.toggle('cell-italic', !!style?.italic);
    cell.classList.toggle('cell-underline', !!style?.underline);
    cell.style.color = conditional?.textColor ?? style?.textColor ?? '';
    cell.style.backgroundColor = conditional?.backgroundColor ?? style?.backgroundColor ?? '';
    const below = row + 1 < doc.rowCount ? doc.getStyle(row + 1, col) : null;
    const right = col + 1 < doc.columnCount ? doc.getStyle(row, col + 1) : null;
    const top = row === 0 ? borderSideValue(style, 'borderTop') : null;
    const left = col === 0 ? borderSideValue(style, 'borderLeft') : null;
    const bottom = resolveSharedBorder(
      borderSideValue(style, 'borderBottom'),
      borderSideValue(below, 'borderTop'),
    );
    const rightSide = resolveSharedBorder(
      borderSideValue(style, 'borderRight'),
      borderSideValue(right, 'borderLeft'),
    );
    cell.style.borderTop = cssBorder(top);
    cell.style.borderLeft = cssBorder(left);
    cell.style.borderBottom = cssBorder(bottom);
    cell.style.borderRight = cssBorder(rightSide);
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

  /**
   * Character offset within a rendered cell's text nearest a viewport point,
   * for seeding the editor's caret at the double-clicked position. Uses
   * whichever caret-hit-testing API the document exposes (the standards-track
   * `caretPositionFromPoint`, or the older `caretRangeFromPoint`); returns
   * null where neither is available (e.g. jsdom in tests) or the point misses
   * the cell's own text, so callers fall back to a sane default. The cell's
   * text is always a single text node (`paintCell` sets `textContent`
   * directly), so the returned offset is already the offset within the raw
   * cell value.
   */
  private caretOffsetFromPoint(cell: HTMLElement, clientX: number, clientY: number): number | null {
    const doc = cell.ownerDocument;
    let node: Node | null = null;
    let offset = 0;
    if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(clientX, clientY);
      if (!pos) {
        return null;
      }
      node = pos.offsetNode;
      offset = pos.offset;
    } else if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(clientX, clientY);
      if (!range) {
        return null;
      }
      node = range.startContainer;
      offset = range.startOffset;
    } else {
      return null;
    }
    if (node?.nodeType === Node.TEXT_NODE) {
      if (!cell.contains(node)) {
        return null;
      }
      // Plain cells hold one text node; a rich-text cell holds one per
      // formatted part (`span.rich-run`), so add the parts before this one.
      let before = 0;
      for (const run of cell.querySelectorAll('.rich-run')) {
        if (run.contains(node)) {
          break;
        }
        before += run.textContent?.length ?? 0;
      }
      return before + offset;
    }
    if (node === cell) {
      // The hit landed on the cell element itself (e.g. past the end of a
      // short value, or an empty cell), not inside its text. `offset` here
      // is a child index rather than a character count: 0 means "before the
      // text", any other value means "after it".
      return offset > 0 ? this.cellTextLength(cell) : 0;
    }
    return null;
  }

  /** Length of a rendered cell's own text (a header filter button adds none). */
  private cellTextLength(cell: HTMLElement): number {
    let length = 0;
    for (const child of cell.childNodes) {
      if (child.nodeType === Node.TEXT_NODE || (child as Element).classList?.contains('rich-run')) {
        length += child.textContent?.length ?? 0;
      }
    }
    return length;
  }

  /**
   * Hit-test by viewport coordinates instead of an event target. Used by
   * auto-scroll, where a nudge moves the grid's content under a pointer that
   * hasn't itself moved, so there is no fresh event target to read.
   */
  private cellFromPoint(clientX: number, clientY: number): { row: number; col: number } | null {
    const target =
      typeof document.elementFromPoint === 'function' ? document.elementFromPoint(clientX, clientY) : null;
    const cell = (target as HTMLElement | null)?.closest<HTMLElement>('[data-row][data-col]');
    return cell ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } : null;
  }

  // ----- Mouse -----

  /** Ends every in-progress drag (resize/fill/move/header/ref/selection), committing
   * whichever one was active — shared by the document `mouseup` and touch `pointerup`/
   * `pointercancel` listeners. */
  private endActiveDrags(): void {
    this.dragging = false;
    this.headerDrag = null;
    this.endResize();
    this.endFill();
    this.endRefDrag();
    this.endMove();
    this.stopAutoScroll();
  }

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
    if (target?.closest<HTMLElement>('[data-movehandle]')) {
      // Begin a range-move drag from the current selection (RSF only).
      const range = this.state.selectedRange(tab);
      if (range && tab.doc.kind === 'rsf') {
        this.beginMove(tab, range, { row: range.top, col: range.left }, event);
      }
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
    // Pressing on the selection's outer border (anywhere along it, not only
    // the corner handle) also drags the selected cells to move them.
    const edgeCell = event.shiftKey ? null : this.moveEdgeHit(tab, event);
    if (edgeCell) {
      const range = this.state.selectedRange(tab);
      if (range) {
        this.beginMove(tab, range, edgeCell, event);
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
    if (this.movingRange) {
      const tab = this.state.activeTab;
      const cell = this.cellFromEvent(event);
      if (tab && cell) {
        this.movingRange.delta = {
          row: cell.row - this.movingRange.origin.row,
          col: cell.col - this.movingRange.origin.col,
        };
        this.updateMovePreview(tab);
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
      // Hovering the selection's border shows the move cursor.
      const hoverTab = this.state.activeTab;
      this.element.classList.toggle(
        'move-edge',
        hoverTab !== null && this.moveEdgeHit(hoverTab, event) !== null,
      );
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

  // ----- Touch / pen (#290) -----
  //
  // The fill/resize/move handles begin dragging on the very first touch,
  // exactly like a mouse press — each already opts out of native panning via
  // `touch-action: none` in styles.css, so there is no scroll to conflict
  // with. A touch that starts anywhere else (a cell, or a row/column header)
  // could equally be the start of a scroll, so it only arms a drag after a
  // brief press-and-hold with no real movement; a quick tap is left alone
  // and keeps working exactly as before, through the browser's own
  // synthetic mousedown/click for that touch.

  private onPointerDown(event: PointerEvent): void {
    // Pointer events fire before their mouse-compatibility counterparts, so
    // this always lands before the `focusGrid()` call the resulting
    // mousedown/click triggers — see `lastPointerType`.
    this.lastPointerType = event.pointerType;
    if (event.pointerType === 'mouse') {
      return;
    }
    const target = event.target as HTMLElement | null;
    const onHandle = !!target?.closest('[data-colresize], [data-movehandle], [data-fillhandle]');
    if (onHandle) {
      this.onMouseDown(event);
      if (this.resizing || this.movingRange || this.filling) {
        this.capturePointer(event.pointerId);
      }
      return;
    }
    this.armLongPressDrag(event);
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      return;
    }
    const origin = this.longPressOrigin;
    if (origin) {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
        // Real movement before the hold completes reads as a scroll, not a
        // drag — cancel the pending long-press and leave the touch to the
        // browser's native panning.
        this.clearLongPress();
      }
      return;
    }
    if (
      !this.resizing &&
      !this.movingRange &&
      !this.filling &&
      !this.dragging &&
      !this.headerDrag &&
      !this.refDrag
    ) {
      return;
    }
    if (this.longPressMenuTarget) {
      const menuOrigin = this.longPressMenuTarget;
      if (
        Math.hypot(event.clientX - menuOrigin.x, event.clientY - menuOrigin.y) <= LONG_PRESS_MOVE_TOLERANCE_PX
      ) {
        // A held finger keeps reporting small jitter even while stationary —
        // only movement past the tolerance means the completed hold turned
        // into a drag (#475); a jittery `pointermove` here is not that.
        return;
      }
      // Real movement past the tolerance: the completed long-press turned
      // into a drag rather than a stationary hold — the pending
      // context-menu-on-release no longer applies.
      this.longPressMenuTarget = null;
    }
    // A drag is confirmed and moving: block the native scroll/pan this touch
    // would otherwise start, and drive the drag through the same code the
    // mouse path uses.
    event.preventDefault();
    this.onResizeMove(event);
    this.trackAutoScroll(event);
    this.onMouseMove(event);
  }

  private onPointerEnd(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      return;
    }
    // A quick tap is one that lifts before the long-press timer fires (and
    // without enough movement to have cancelled it already) — the same
    // gesture the browser's own synthetic click already treats as a plain
    // tap-to-select, and the only kind eligible to pair into a double-tap.
    const wasQuickTap = this.longPressOrigin !== null && this.longPressTimer !== null;
    this.clearLongPress();
    const menuTarget = this.longPressMenuTarget;
    this.longPressMenuTarget = null;
    this.releasePointerIfCaptured(event.pointerId);
    this.endActiveDrags();
    // The hold completed and lifted without ever turning into a drag: treat
    // it as the touch equivalent of a right-click. `pointercancel` (the OS
    // taking the gesture away, e.g. for a scroll or an interruption) does not
    // count as a completed press, so the menu only opens on a real lift.
    if (menuTarget && event.type === 'pointerup') {
      this.onContextMenu(menuTarget.event);
      return;
    }
    if (wasQuickTap && event.type === 'pointerup') {
      this.handleQuickTap(event);
    }
  }

  /**
   * Pairs successive quick taps into a double-tap that opens the inline
   * editor, mirroring `onDoubleClick` — see `DOUBLE_TAP_MS`. The first tap of
   * a pair only arms a pending-tap window; the second, landing on the same
   * cell within that window and the long-press move tolerance, opens the
   * editor with the caret placed under the tap, then clears the pending
   * state so a third tap doesn't retrigger it.
   */
  private handleQuickTap(event: PointerEvent): void {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    const cell = this.cellFromEvent(event);
    if (!cell) {
      return;
    }
    const pending = this.pendingTap;
    if (
      pending &&
      pending.row === cell.row &&
      pending.col === cell.col &&
      Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= DOUBLE_TAP_SLOP_PX
    ) {
      clearTimeout(pending.timer);
      this.pendingTap = null;
      const cellEl = this.cellAt(cell.row, cell.col);
      const caretOffset = cellEl ? this.caretOffsetFromPoint(cellEl, event.clientX, event.clientY) : null;
      this.openEditor(tab, cell.row, cell.col, null, caretOffset ?? undefined);
      return;
    }
    if (pending) {
      clearTimeout(pending.timer);
    }
    this.pendingTap = {
      row: cell.row,
      col: cell.col,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        this.pendingTap = null;
      }, DOUBLE_TAP_MS),
    };
  }

  /** Arms a drag-selection/header-drag after a press-and-hold with no real movement. */
  private armLongPressDrag(event: PointerEvent): void {
    this.clearLongPress();
    this.longPressMenuTarget = null;
    this.longPressOrigin = { event, x: event.clientX, y: event.clientY };
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      const origin = this.longPressOrigin;
      this.longPressOrigin = null;
      if (!origin) {
        return;
      }
      this.onMouseDown(origin.event);
      if (this.dragging || this.headerDrag || this.refDrag) {
        this.capturePointer(origin.event.pointerId);
      }
      // The hold just fired and nothing has moved yet: this is a candidate
      // for the context menu once the finger lifts (onPointerMove clears it
      // again the moment real movement turns this into an actual drag).
      this.longPressMenuTarget = { event: origin.event, x: origin.x, y: origin.y };
    }, LONG_PRESS_MS);
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressOrigin = null;
  }

  /** Pointer capture keeps a touch drag's move/up events targeted at the grid even
   * once the finger moves outside its bounds. jsdom (tests) implements neither
   * method, hence the feature checks. */
  private capturePointer(pointerId: number): void {
    if (typeof this.element.setPointerCapture === 'function') {
      this.element.setPointerCapture(pointerId);
    }
  }

  private releasePointerIfCaptured(pointerId: number): void {
    if (
      typeof this.element.hasPointerCapture !== 'function' ||
      typeof this.element.releasePointerCapture !== 'function'
    ) {
      return;
    }
    if (this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
  }

  // ----- Auto-scroll (drag past the grid edge) -----

  /** Whether a drag that should auto-scroll the viewport on approaching an edge is active. */
  private hasEdgeScrollableDrag(): boolean {
    return this.dragging || this.filling !== null || this.movingRange !== null || this.resizing !== null;
  }

  /**
   * Scroll direction/speed implied by a pointer position relative to the
   * grid's edges, or null when the pointer isn't close enough to nudge the
   * viewport. A zero-size rect means the grid isn't laid out (hidden, or an
   * environment without real geometry, e.g. an unmocked jsdom test) and
   * never nudges.
   */
  private edgeScrollDirection(clientX: number, clientY: number): { dx: number; dy: number } | null {
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    const step = (depth: number): number => Math.min(AUTO_SCROLL_MAX_STEP_PX, Math.max(4, Math.round(depth)));
    let dx = 0;
    if (clientX < rect.left + AUTO_SCROLL_EDGE_PX) {
      dx = -step(rect.left + AUTO_SCROLL_EDGE_PX - clientX);
    } else if (clientX > rect.right - AUTO_SCROLL_EDGE_PX) {
      dx = step(clientX - (rect.right - AUTO_SCROLL_EDGE_PX));
    }
    let dy = 0;
    if (clientY < rect.top + AUTO_SCROLL_EDGE_PX) {
      dy = -step(rect.top + AUTO_SCROLL_EDGE_PX - clientY);
    } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
      dy = step(clientY - (rect.bottom - AUTO_SCROLL_EDGE_PX));
    }
    return dx === 0 && dy === 0 ? null : { dx, dy };
  }

  /**
   * Runs on every document-level mousemove: starts, updates, or stops the
   * auto-scroll timer depending on whether an edge-scrollable drag is active
   * and how close its pointer is to the grid's edge.
   */
  private trackAutoScroll(event: MouseEvent): void {
    if (!this.hasEdgeScrollableDrag()) {
      this.stopAutoScroll();
      return;
    }
    const dir = this.edgeScrollDirection(event.clientX, event.clientY);
    if (!dir) {
      this.stopAutoScroll();
      return;
    }
    this.autoScrollState = { ...dir, clientX: event.clientX, clientY: event.clientY };
    if (this.autoScrollTimer === null) {
      this.autoScrollTimer = setInterval(() => this.tickAutoScroll(), AUTO_SCROLL_INTERVAL_MS);
    }
  }

  private stopAutoScroll(): void {
    if (this.autoScrollTimer !== null) {
      clearInterval(this.autoScrollTimer);
      this.autoScrollTimer = null;
    }
    this.autoScrollState = null;
  }

  /**
   * One auto-scroll nudge: move the viewport, re-render so the DOM reflects
   * the new window, then feed the pointer's now-different cell back into
   * whichever drag is active — the same update `onMouseMove` would have made
   * had the pointer actually moved onto that cell.
   */
  private tickAutoScroll(): void {
    const tab = this.state.activeTab;
    const state = this.autoScrollState;
    if (!tab || !state || !this.hasEdgeScrollableDrag()) {
      this.stopAutoScroll();
      return;
    }
    const before = { top: this.element.scrollTop, left: this.element.scrollLeft };
    this.element.scrollTop = Math.max(0, this.element.scrollTop + state.dy);
    this.element.scrollLeft = Math.max(0, this.element.scrollLeft + state.dx);
    if (this.element.scrollTop === before.top && this.element.scrollLeft === before.left) {
      return; // already at the scroll limit in every direction being nudged
    }
    this.render(tab);
    this.continueDragAt(tab, state.clientX, state.clientY);
  }

  /**
   * Re-applies the active drag's update for the cell now under
   * `(clientX, clientY)` — used after an auto-scroll nudge moves the grid
   * content under a pointer that hasn't itself moved.
   */
  private continueDragAt(tab: Tab, clientX: number, clientY: number): void {
    if (this.resizing) {
      this.applyResize({
        tab,
        col: this.resizing.col,
        width: this.resizing.startWidth + (clientX - this.resizing.startX),
      });
      return;
    }
    const cell = this.cellFromPoint(clientX, clientY);
    if (!cell) {
      return;
    }
    if (this.movingRange) {
      this.movingRange.delta = {
        row: cell.row - this.movingRange.origin.row,
        col: cell.col - this.movingRange.origin.col,
      };
      this.updateMovePreview(tab);
      return;
    }
    if (this.filling) {
      this.filling.target = cell;
      this.applyFillPreview(null);
      return;
    }
    if (this.dragging && tab.selection) {
      this.applyDragSelection({ tab, cell });
    }
  }

  private onDoubleClick(event: MouseEvent): void {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const resizeHandle = target?.closest<HTMLElement>('[data-colresize]');
    if (resizeHandle && isGridSurface(tab)) {
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
      const cellEl = this.cellAt(cell.row, cell.col);
      const caretOffset = cellEl ? this.caretOffsetFromPoint(cellEl, event.clientX, event.clientY) : null;
      this.openEditor(tab, cell.row, cell.col, null, caretOffset ?? undefined);
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
    this.invalidateColOffsets(tab);
    this.window = null; // force a re-layout with the new width
    this.render(tab);
  }

  /** Frame-coalesced column-width application (a resize re-lays-out the window). */
  private readonly applyResize = frameCoalesced<{ tab: Tab; col: number; width: number }>(
    ({ tab, col, width }) => {
      if (!this.resizing || this.state.activeTab !== tab) {
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

  /** Abort a column-resize drag, restoring the width it started at. */
  private cancelResize(): void {
    const drag = this.resizing;
    if (!drag) {
      return;
    }
    this.resizing = null;
    const tab = this.state.activeTab;
    if (tab) {
      this.setColWidth(tab, drag.col, drag.startWidth);
    }
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

  // ----- Range move (drag the selection to move it) -----

  /**
   * Start a range-move drag of `source`. `origin` is the cell the drag was
   * grabbed at, so the destination follows the pointer from there.
   */
  private beginMove(tab: Tab, source: CellRange, origin: { row: number; col: number }, event: Event): void {
    this.commitEditor();
    this.element.classList.remove('move-edge');
    this.movingRange = { source, origin, delta: { row: 0, col: 0 }, valid: false };
    this.updateMovePreview(tab);
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * The selected cell under a mouse event when the pointer sits on the
   * selection's outer border (see `onRangeEdge`), or null. Only RSF
   * worksheets can move ranges, and never while a cell is being edited.
   */
  private moveEdgeHit(tab: Tab, event: MouseEvent): { row: number; col: number } | null {
    if (tab.doc.kind !== 'rsf' || this.editor !== null || tab.doc !== this.lastDoc) {
      return null;
    }
    const range = this.state.selectedRange(tab);
    const cellEl = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-row][data-col]');
    if (!range || !cellEl) {
      return null;
    }
    const rect = cellEl.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) {
      return null; // not laid out (no geometry to measure the border against)
    }
    const row = Number(cellEl.dataset.row);
    const col = Number(cellEl.dataset.col);
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    return onRangeEdge(range, row, col, point, MOVE_EDGE_PX * this.zoomOf(tab)) ? { row, col } : null;
  }

  /** The current move destination rectangle, or null when nothing is dragging. */
  private moveDest(): CellRange | null {
    if (!this.movingRange) {
      return null;
    }
    const { source, delta } = this.movingRange;
    return normalizeRange(
      { row: source.top + delta.row, col: source.left + delta.col },
      { row: source.bottom + delta.row, col: source.right + delta.col },
    );
  }

  /**
   * Repaint the drag preview: the moved rectangle at its proposed destination,
   * marked valid or invalid. The invalid state is conveyed by a distinct class
   * (and a `not-allowed` cursor), never by color alone. Validity is whether the
   * destination fits inside the worksheet and actually moves the cells.
   */
  private updateMovePreview(tab: Tab): void {
    for (const cell of this.canvas.querySelectorAll('.move-target, .move-target-invalid, .move-source')) {
      cell.classList.remove('move-target', 'move-target-invalid', 'move-source');
    }
    const moving = this.movingRange;
    const dest = this.moveDest();
    if (!moving || !dest) {
      return;
    }
    const rows = tab.doc.rowCount;
    const cols = tab.doc.columnCount;
    const inBounds = dest.top >= 0 && dest.left >= 0 && dest.bottom < rows && dest.right < cols;
    const moved = moving.delta.row !== 0 || moving.delta.col !== 0;
    moving.valid = inBounds && moved;
    this.element.classList.toggle('moving-range', true);
    this.element.classList.toggle('move-invalid', !moving.valid);
    const source = moving.source;
    for (const cell of this.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]')) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (row >= source.top && row <= source.bottom && col >= source.left && col <= source.right) {
        cell.classList.add('move-source');
      }
      if (moved && row >= dest.top && row <= dest.bottom && col >= dest.left && col <= dest.right) {
        cell.classList.add(moving.valid ? 'move-target' : 'move-target-invalid');
      }
    }
  }

  /** Clear all move-preview styling and drag state. */
  private clearMoveState(): void {
    for (const cell of this.canvas.querySelectorAll('.move-target, .move-target-invalid, .move-source')) {
      cell.classList.remove('move-target', 'move-target-invalid', 'move-source');
    }
    this.element.classList.remove('moving-range', 'move-invalid');
    this.movingRange = null;
  }

  /** Abort a range-move drag without committing anything. */
  private cancelMove(): void {
    if (this.movingRange) {
      this.clearMoveState();
    }
  }

  /** Commit a range-move drag on mouseup (runs the shared, confirmed command). */
  private endMove(): void {
    const moving = this.movingRange;
    if (!moving) {
      return;
    }
    const tab = this.state.activeTab;
    const valid = moving.valid;
    const { source, delta } = moving;
    this.clearMoveState();
    if (valid && tab && tab.doc === this.lastDoc && (delta.row !== 0 || delta.col !== 0)) {
      void this.commands.moveRange(tab, source, delta.row, delta.col);
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

  /** Abort a fill-handle drag without committing anything. */
  private cancelFill(): void {
    if (!this.filling) {
      return;
    }
    this.filling = null;
    for (const cell of this.canvas.querySelectorAll('.fill-target')) {
      cell.classList.remove('fill-target');
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
   * Sheet > Rows & Columns > Auto-Fit Column Width: fit every column
   * intersecting the current selection (whole-column selections, Select All,
   * or any cell range). Each column is measured independently, so columns
   * can shrink and grow on their own.
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
        this.commands.setBusy(t('loading.autoFitCols', { done: 0, total: cols.length, pct: 0 }), 0);
      }
      try {
        result = await planAutoFitColumns(cols, makeInput, {
          yieldBetween: heavy,
          onProgress: (done, total) => {
            const pct = Math.floor((done / total) * 100);
            this.commands.setBusy(t('loading.autoFitCols', { done, total, pct }), pct);
          },
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
      this.invalidateColOffsets(tab);
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
    // Re-selecting the cell that is already active happens as a side effect of
    // opening the editor on it (typing, F2, IME start) mid Tab-entry pass —
    // that must not clear the remembered start column. An actual jump to a
    // different cell (a click, double-click, or `reveal`) does.
    const sameCell = tab.selection?.row === clampedRow && tab.selection?.col === clampedCol;
    this.state.setSelection(tab, { row: clampedRow, col: clampedCol }, null, 'cell', sameCell);
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

  /**
   * The on-screen keyboard opened or closed (`onKeyboardOpenChange`, fired
   * after `#app` has been refitted to the visible area). On open, when the
   * grid or a registered edit field (the formula bar, see
   * `addKeyboardEditField`) holds focus, the cell being edited — or the selected cell, for
   * type-to-edit — is scrolled to the vertical middle of the grid's now
   * shorter scroll area, and the scroll position from before editing started
   * is remembered. For a short while after, any further shrink of the
   * visible area (the keyboard still sliding in) re-centers it again
   * (`keyboardResized`). On close, the remembered position is put back.
   */
  keyboardOpenChanged(open: boolean): void {
    const tab = this.state.activeTab;
    if (!tab || tab.doc !== this.lastDoc) {
      this.preKeyboardScroll = null;
      this.keyboardSettleUntil = 0;
      return;
    }
    if (!open) {
      this.keyboardSettleUntil = 0;
      const saved = this.preKeyboardScroll;
      this.preKeyboardScroll = null;
      if (saved) {
        this.element.scrollTop = saved.top;
        this.element.scrollLeft = saved.left;
        this.render(tab);
      }
      return;
    }
    if (!this.keyboardEditsCell()) {
      this.preKeyboardScroll = null;
      return;
    }
    this.preKeyboardScroll ??= { top: this.element.scrollTop, left: this.element.scrollLeft };
    this.keyboardSettleUntil = Date.now() + KEYBOARD_SETTLE_MS;
    this.centerKeyboardTarget(tab);
  }

  /** The visible area changed height while the keyboard is open (`onKeyboardResize`). */
  keyboardResized(): void {
    if (Date.now() > this.keyboardSettleUntil) {
      return;
    }
    const tab = this.state.activeTab;
    if (tab && tab.doc === this.lastDoc && this.keyboardEditsCell()) {
      this.centerKeyboardTarget(tab);
    }
  }

  /**
   * Register a field outside the grid that edits the selected cell (the
   * formula bar): when the on-screen keyboard opens for it, the selected cell
   * is centered in the shrunken grid just as for the in-cell editor.
   */
  addKeyboardEditField(field: Element): void {
    this.keyboardEditFields.add(field);
  }

  /** Whether focus is on the in-cell editor or a registered edit field. */
  private keyboardEditsCell(): boolean {
    const active = this.element.ownerDocument.activeElement;
    if (!active) {
      return false;
    }
    if (active === this.sink) {
      return true;
    }
    for (const field of this.keyboardEditFields) {
      if (field.contains(active)) {
        return true;
      }
    }
    return false;
  }

  /** Scroll the edited (or selected) cell to the vertical middle of the grid's scroll area. */
  private centerKeyboardTarget(tab: Tab): void {
    const target = this.editor ?? tab.selection;
    if (!target) {
      return;
    }
    const slot = this.state.sortSlot(tab, target.row);
    if (slot >= this.scrollRowBase(tab)) {
      const idx = this.heightIndex(tab);
      const y = idx.offsetOf(slot) - idx.offsetOf(this.scrollRowBase(tab));
      // The scroll area is the grid minus the sticky header (and sticky
      // first row), i.e. exactly the band `scrollCellIntoView` keeps a cell in.
      const viewH = this.element.clientHeight - this.overlayHeight(tab);
      const maxScroll = this.element.scrollHeight - this.element.clientHeight;
      this.element.scrollTop = centeredScrollOffset(y, idx.heightOf(slot), viewH, maxScroll);
    }
    // Horizontal: just make sure the column is in view (renders either way).
    this.scrollCellIntoView(tab, target.row, target.col);
  }

  /** Rows one PageUp / PageDown moves: a screenful at the selected row's height. */
  private pageRows(tab: Tab): number {
    const slot = this.state.sortSlot(tab, tab.selection?.row ?? 0);
    const viewH = this.element.clientHeight - this.overlayHeight(tab);
    return pageStep(viewH, this.heightIndex(tab).heightOf(slot));
  }

  /** `renderIfUnmoved: false` skips the repaint when the cell was already in view. */
  private scrollCellIntoView(tab: Tab, row: number, col: number, renderIfUnmoved = true): void {
    const scrollTop = this.element.scrollTop;
    const scrollLeft = this.element.scrollLeft;
    const idx = this.heightIndex(tab);
    const overlay = this.overlayHeight(tab);
    // The height index is keyed by display slot, not document row.
    const slot = this.state.sortSlot(tab, row);
    if (slot >= this.scrollRowBase(tab)) {
      const startRow = this.scrollRowBase(tab);
      const y = idx.offsetOf(slot) - idx.offsetOf(startRow);
      const rowH = idx.heightOf(slot);
      const viewH = this.element.clientHeight - overlay;
      if (y < this.element.scrollTop) {
        this.element.scrollTop = y;
      } else if (y + rowH > this.element.scrollTop + viewH) {
        this.element.scrollTop = y + rowH - viewH;
      }
    }
    const frozenCols = this.frozenColCount(tab);
    if (col >= frozenCols) {
      // Scrolled columns keep their natural x; the pinned columns cover the
      // first `frozenW` pixels of the band right of the row numbers.
      const frozenW = this.frozenColsWidth(tab);
      const x = this.colOffset(tab, col) - frozenW;
      const w = this.colWidth(tab, col);
      const viewW = this.element.clientWidth - this.overlayWidth(tab);
      if (x < this.element.scrollLeft) {
        this.element.scrollLeft = Math.max(0, x);
      } else if (x + w > this.element.scrollLeft + viewW) {
        this.element.scrollLeft = x + w - viewW;
      }
    }
    if (!renderIfUnmoved && this.element.scrollTop === scrollTop && this.element.scrollLeft === scrollLeft) {
      return;
    }
    const current = this.state.activeTab;
    if (current) {
      this.render(current);
    }
  }

  /**
   * Step a document row by `delta` counting only visible *display slots*, so
   * keyboard navigation (arrows, PageUp/Down) walks the grid in the order
   * rows actually appear on screen — skipping rows hidden by an active
   * filter, and following an active sort's reordering — exactly like the
   * rows are stacked visually. Without a filter or sort this reduces to a
   * plain clamped addition (`from`'s slot equals `from` itself).
   */
  private stepVisibleRow(tab: Tab, from: number, delta: number): number {
    const hidden = this.hiddenOf(tab);
    const rowCount = tab.doc.rowCount;
    const sorted = tab.doc.kind === 'rsf' && tab.doc.sort !== null;
    if ((!hidden || hidden.size === 0) && !sorted) {
      return Math.max(0, Math.min(rowCount - 1, from + delta));
    }
    const dir = delta > 0 ? 1 : -1;
    let steps = Math.abs(delta);
    let slot = this.state.sortSlot(tab, from);
    while (steps > 0) {
      let next = slot + dir;
      while (next >= 0 && next < rowCount && hidden?.has(this.docRowOf(tab, next))) {
        next += dir;
      }
      if (next < 0 || next >= rowCount) {
        break; // no further visible row in this direction
      }
      slot = next;
      steps -= 1;
    }
    return this.docRowOf(tab, slot);
  }

  /**
   * Ctrl+Arrow: move (or, with Shift, extend) the selection to the edge of
   * the data in that direction (see `findDataEdge`). Vertical moves walk
   * visible rows in display order, so filtered-out rows are skipped and a
   * sorted view is followed as shown.
   */
  private jumpToDataEdge(tab: Tab, key: string, extend: boolean): void {
    const sel = tab.selection ?? { row: 0, col: 0 };
    const doc = tab.doc;
    let row = sel.row;
    let col = sel.col;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const last = doc.fieldCount(row) - 1;
      const step = key === 'ArrowRight' ? 1 : -1;
      col = findDataEdge(
        Math.max(0, Math.min(col, last)),
        (c) => (c + step >= 0 && c + step <= last ? c + step : null),
        (c) => doc.getValue(row, c) !== '',
      );
    } else {
      const delta = key === 'ArrowDown' ? 1 : -1;
      row = findDataEdge(
        row,
        (r) => {
          const next = this.stepVisibleRow(tab, r, delta);
          return next === r ? null : next;
        },
        (r) => col < doc.fieldCount(r) && doc.getValue(r, col) !== '',
      );
      col = Math.max(0, Math.min(col, doc.fieldCount(row) - 1));
    }
    this.commitEditor();
    this.state.setSelection(tab, { row, col }, extend ? (tab.anchor ?? sel) : null, 'cell');
    this.scrollCellIntoView(tab, row, col);
    this.focusGrid();
  }

  /**
   * `entryTracking` drives the Tab-then-Enter "return to start column"
   * convention (Excel/Sheets/Calc): `'tab'` remembers `tab.tabEntryCol` as the
   * column this call started from (only if a pass is not already in
   * progress); `'enter'` moves to that remembered column instead of `dCol`
   * when one is tracked. Both preserve the tracked column across the call.
   * The default, `'reset'`, is every other kind of move (arrows, PageUp/Down,
   * Home/End) and always clears it — those are exactly the moves that should
   * interrupt a Tab-entry pass.
   */
  private moveSelection(
    tab: Tab,
    dRow: number,
    dCol: number,
    extend: boolean,
    entryTracking: 'tab' | 'enter' | 'reset' = 'reset',
  ): void {
    const sel = tab.selection ?? { row: 0, col: 0 };
    const row = dRow === 0 ? sel.row : this.stepVisibleRow(tab, sel.row, dRow);
    let col = entryTracking === 'enter' && tab.tabEntryCol !== null ? tab.tabEntryCol : sel.col + dCol;
    const fieldCount = tab.doc.fieldCount(row);
    if (col >= fieldCount) col = fieldCount - 1;
    if (col < 0) col = 0;
    this.commitEditor();
    const preserveTabEntryCol = entryTracking !== 'reset';
    if (extend) {
      this.state.setSelection(tab, { row, col }, tab.anchor ?? sel, 'cell', preserveTabEntryCol);
    } else {
      this.state.setSelection(tab, { row, col }, null, 'cell', preserveTabEntryCol);
    }
    if (entryTracking === 'tab' && tab.tabEntryCol === null) {
      tab.tabEntryCol = sel.col;
    }
    this.scrollCellIntoView(tab, row, col);
    this.focusGrid();
  }

  // ----- Editing -----

  /**
   * Open the inline cell editor by promoting the permanent sink textarea in
   * place. `initial === null` edits the current value (the raw formula
   * expression for formula cells); the caret lands at `caretOffset` when
   * given (double-click: the clicked position) or at the end of the text
   * otherwise (F2: a common convention). `initial === ''` opens an **empty**
   * editor for type-to-edit — the sink already has focus and may already be
   * receiving the initiating keystroke or IME composition, so its value,
   * caret, and focus are deliberately left untouched (touching them would
   * abort the composition). Any other `initial` seeds the editor. The editor
   * is a `<textarea>`, so it holds multi-line values (Alt+Enter).
   */
  openEditor(tab: Tab, row: number, col: number, initial: string | null, caretOffset?: number): void {
    this.commitEditor();
    if (
      initial !== '' &&
      this.lastPointerType !== 'mouse' &&
      document.documentElement.dataset.keyboardOpen === undefined
    ) {
      // A touch edit-entry gesture (not type-to-edit, where a keyboard is
      // already delivering text) is about to bring up the on-screen keyboard.
      // Remember where the grid was before selecting the cell scrolls it:
      // restored when the keyboard closes (`keyboardOpenChanged`).
      this.preKeyboardScroll = { top: this.element.scrollTop, left: this.element.scrollLeft };
    }
    if (row < 0 || row >= tab.doc.rowCount || col >= tab.doc.fieldCount(row)) {
      return;
    }
    // A double-tap's first tap already focused the sink through `focusGrid()`'s
    // read-only suppression (#469). iOS Safari shows no on-screen keyboard
    // for refocusing that same element, even after a blur (on-device probe,
    // #588), but does for focus moving to a different one: so swap in a
    // fresh sink to focus below. Not for `initial === ''`, the type-to-edit
    // path, where the sink is deliberately already focused and mid-keystroke/
    // IME-composition (#487).
    if (initial !== '' && this.lastPointerType !== 'mouse' && document.activeElement === this.sink) {
      this.replaceSink();
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
    // The dropdown of allowed values for a `list`-kind data-validation rule
    // covering this cell, or null when none applies (including CSV
    // documents, where `validationAt` always returns null).
    const rule = this.commands.validationAt(tab, row, col);
    const pickerValues = rule?.rule.kind === 'list' ? rule.rule.values : null;
    const picker = new ValidationPicker(input, document.body);
    // Rich text applies only to a grid worksheet of an RSF file.
    const doc = tab.doc;
    const rich =
      doc.kind === 'rsf' && doc.activeSheet.kind === 'grid'
        ? new RichCellEditor(
            {
              input,
              container: this.canvas,
              cellStyle: () => (tab.doc.kind === 'rsf' ? tab.doc.getStyle(row, col) : null),
              navigationKey: (event) => this.editorNavigationKey(event),
              focusLeft: () => this.commitEditor(),
            },
            initial === null ? runsForText(doc.getStyle(row, col)?.runs, input.value) : null,
            initial !== null,
          )
        : null;
    this.editor = {
      row,
      col,
      input,
      autocomplete,
      ref,
      prevRefTarget,
      updateRefs,
      picker,
      pickerValues,
      rich,
    };
    input.focus({ preventScroll: true });
    if (initial === null) {
      // Never select-all here: that would silently replace the whole cell on
      // the next keystroke. Land the caret at the click position when known,
      // otherwise at the end of the text.
      const pos =
        caretOffset === undefined
          ? input.value.length
          : Math.max(0, Math.min(caretOffset, input.value.length));
      input.setSelectionRange(pos, pos);
    } else if (!this.composing && initial !== '') {
      input.setSelectionRange(input.value.length, input.value.length);
    }
    // Offer completions immediately when a formula is being started/edited.
    autocomplete.update();
    updateRefs();
    this.refreshValidationPicker(this.editor);
    // A cell that already has formatted parts is edited showing them.
    rich?.begin(input.selectionStart ?? input.value.length);
  }

  /**
   * Show or hide the value-picker dropdown for the open editor: shown only
   * when the cell carries a `list`-kind validation rule and the field is not
   * currently a formula (the autocomplete popup owns that case instead) —
   * the two floating popups are mutually exclusive.
   */
  private refreshValidationPicker(editor: NonNullable<Grid['editor']>): void {
    if (editor.pickerValues && !editor.autocomplete.isOpen) {
      editor.picker.update(editor.pickerValues);
    } else {
      editor.picker.hide();
    }
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
    // Ctrl+B / Ctrl+I / Ctrl+U format the selected part of the text.
    const richKey = richFormatKeyOf(event);
    if (richKey && editor.rich) {
      event.preventDefault();
      event.stopPropagation();
      editor.rich.toggle(richKey);
      return;
    }
    if (isRefToggleKey(event) && editor.ref.toggleReference()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Alt+Enter inserts a literal newline, Ctrl+; / Ctrl+Shift+; today's
    // date / the current time, at the caret (replacing any selection); none
    // of them commits, navigates, or opens a menu.
    const stamp = dateStampKeyOf(event);
    if ((event.key === 'Enter' && event.altKey) || stamp) {
      event.preventDefault();
      event.stopPropagation();
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.setRangeText(stamp ? localDateStamp(stamp) : '\n', start, end, 'end');
      editor.autocomplete.update();
      editor.updateRefs();
      editor.rich?.plainChanged();
      return;
    }
    if (editor.autocomplete.onKeyDown(event)) {
      return;
    }
    if (editor.picker.onKeyDown(event)) {
      return;
    }
    this.editorNavigationKey(event);
  }

  /** Enter / Tab commit (and move), Escape cancels — for either cell editor field. */
  private editorNavigationKey(event: KeyboardEvent): void {
    const tab = this.state.activeTab;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.commitEditor();
      // Ctrl+Enter (Cmd+Enter) commits and stays on the cell.
      if (tab && !event.ctrlKey && !event.metaKey) {
        this.moveSelection(tab, event.shiftKey ? -1 : 1, 0, false, 'enter');
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.commitEditor();
      if (tab) {
        this.moveSelection(tab, 0, event.shiftKey ? -1 : 1, false, 'tab');
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
      this.refreshValidationPicker(editor);
    }
    editor.updateRefs();
    editor.rich?.plainChanged();
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
    if (this.element.ownerDocument.documentElement.dataset.keyboardOpen === undefined) {
      // The editor closed without a keyboard ever opening (e.g. a hardware
      // keyboard): nothing to restore later.
      this.preKeyboardScroll = null;
    }
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
    editor.picker.dispose();
    editor.rich?.dispose();
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
    // Read the formatted field first: it writes its text back to the input.
    const runs = editor.rich?.runs();
    const value = editor.input.value;
    this.disposeEditor(editor);
    this.demoteSink();
    if (tab && tab.doc === this.lastDoc) {
      void this.commands.commitCellEdit(tab, editor.row, editor.col, value, runs);
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

  /**
   * Discard any in-progress inline edit without committing it, tearing down
   * the autocomplete popup, the IME sink promotion, the formula-reference
   * capture, and the reference highlights. Called when the active worksheet or
   * document changes so an editor opened on one worksheet can never commit its
   * text into another.
   */
  cancelEditing(): void {
    this.closeEditor(false);
  }

  /** True when the grid (not an editor input) should own copy/paste events. */
  isNavigating(): boolean {
    return (
      this.editor === null &&
      (document.activeElement === this.element || document.activeElement === this.sink)
    );
  }

  /**
   * Tear down this instance's own external resources: the resize observer
   * and the `refIndicator` live region, which is appended directly to
   * `document.body` rather than into `this.element`. The app's single
   * long-lived `Grid` (constructed once in `main.ts`) never calls this — it
   * lives for the whole session — but a second, short-lived instance (the
   * read-only version-history preview, `src/ui/dialogs/version-preview.ts`)
   * must call it on close so a series of opens doesn't accumulate observers
   * and orphaned DOM nodes.
   */
  dispose(): void {
    this.resizeObserver?.disconnect();
    this.offKeyboardOpenChange();
    this.offKeyboardResize();
    this.refIndicator.remove();
  }

  // ----- Keyboard -----

  private onKeyDown(event: KeyboardEvent): void {
    const tab = this.state.activeTab;
    if (!tab || this.editor) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    // Ctrl/Cmd+Arrow jumps to the edge of the data (Shift extends the
    // selection there). Like Ctrl+Home / Ctrl+End it is grid navigation, so
    // it is handled here rather than in `app/shortcuts.ts`.
    if (mod && !event.altKey && ARROW_KEYS.has(event.key) && !isComposingKey(event, this.composing)) {
      event.preventDefault();
      this.jumpToDataEdge(tab, event.key, event.shiftKey);
      return;
    }
    // Every other Ctrl/Cmd combination is left to the application shortcut
    // layer (`app/shortcuts.ts`) except Ctrl+Home / Ctrl+End, which are grid
    // navigation (jump to A1 / the last used cell) and so belong here
    // alongside the other navigation keys below.
    // Alt+Down on a header-row filter cell opens its column menu, the
    // keyboard route to what the cell's button does.
    if (event.altKey && !mod && event.key === 'ArrowDown' && tab.selection) {
      const { row, col } = tab.selection;
      if (this.isHeaderFilterCell(tab, row, col)) {
        event.preventDefault();
        this.openColumnMenu(tab, col, this.cellAt(row, col)?.querySelector('.header-filter-button') ?? null);
        return;
      }
    }
    if (event.altKey || (mod && event.key !== 'Home' && event.key !== 'End')) {
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
        this.moveSelection(tab, this.pageRows(tab), 0, extend);
        return;
      case 'PageUp':
        event.preventDefault();
        this.moveSelection(tab, -this.pageRows(tab), 0, extend);
        return;
      case 'Home':
        event.preventDefault();
        // Ctrl/Cmd+Home jumps to A1; plain Home only moves to column A of the
        // current row.
        this.moveSelection(tab, mod ? -Number.MAX_SAFE_INTEGER : 0, -Number.MAX_SAFE_INTEGER, extend);
        return;
      case 'End':
        event.preventDefault();
        // Ctrl/Cmd+End jumps to the last used cell; plain End only moves to
        // the last field of the current row.
        this.moveSelection(tab, mod ? Number.MAX_SAFE_INTEGER : 0, Number.MAX_SAFE_INTEGER, extend);
        return;
      case 'Enter':
        event.preventDefault();
        this.moveSelection(tab, event.shiftKey ? -1 : 1, 0, false, 'enter');
        return;
      case 'Tab': {
        // Tab / Shift+Tab move right / left within the row. At the row's
        // edge the key is left to the browser, so keyboard users can always
        // Tab out of the grid (no keyboard trap).
        const sel = tab.selection;
        if (!sel) return;
        const step = event.shiftKey ? -1 : 1;
        const target = sel.col + step;
        if (target < 0 || target >= tab.doc.fieldCount(sel.row)) return;
        event.preventDefault();
        this.moveSelection(tab, 0, step, false, 'tab');
        return;
      }
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
    this.openContextMenu(tab, event.clientX, event.clientY);
  }

  private buildContextEntry(
    item: ContextMenuCommandDef | ContextMenuGroupDef | 'separator',
  ): ContextMenuEntry {
    if (item === 'separator') {
      return 'separator';
    }
    if ('submenu' in item) {
      return {
        label: t(item.labelKey),
        icon: item.icon,
        submenu: item.submenu.map((sub) => this.buildContextEntry(sub)),
      };
    }
    return {
      label: t(item.labelKey),
      icon: ICON_BY_COMMAND[item.command],
      shortcut: item.shortcut,
      disabled: !this.commands.isEnabled(item.command),
      onSelect: () => void this.commands.run(item.command),
    };
  }

  private openContextMenu(tab: Tab, x: number, y: number): void {
    this.closeContextMenu();
    const entries: ContextMenuEntry[] = CONTEXT_MENU_ITEMS.map((item) => this.buildContextEntry(item));
    this.contextMenu = ContextMenu.open(entries, x, y, {
      onClose: () => (this.contextMenu = null),
      toolbar: formatToolbarItems(this.commands, tab),
    });
  }

  private closeContextMenu(): void {
    this.contextMenu?.close();
    this.contextMenu = null;
  }
}
