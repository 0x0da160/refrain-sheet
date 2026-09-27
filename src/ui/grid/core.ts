// SPDX-License-Identifier: MIT
/**
 * The grid's shared state and wiring. `Grid` (./index.ts) is the public
 * facade; `GridCore` owns the DOM it builds, every piece of state the
 * collaborators share, and one instance of each collaborator:
 *
 * - `editing` — `EditSession` (./edit-session.ts)
 * - `renderer` — `GridRenderer` (./renderer.ts)
 * - `wrap` — `WrapLayout` (./wrap-layout.ts)
 * - `cells` — `CellBuilder` (./cell-builder.ts)
 * - `selectionView` — `SelectionView` (./selection-view.ts)
 * - `pointer` — `PointerInput` (./pointer-input.ts)
 * - `drags` — `DragOperations` (./drag-operations.ts)
 * - `autofit` — `AutoFitter` (./auto-fitter.ts)
 * - `navigation` — `Navigator` (./navigation.ts)
 *
 * Collaborators reach each other through the core (`this.core.renderer`),
 * never by importing one another, so the import graph stays a star.
 */
import { Plus } from 'lucide';
import type { AppState, FormulaRefTarget, Tab } from '../../app/state';
import type { Commands } from '../../app/commands';
import { t } from '../../app/i18n';
import type { CellRange } from '../../core/clipboard';
import type { FormulaRefRange } from '../../core/formula';
import type { WrapMeasure } from '../../core/text-wrap';
import type { ContextMenu } from '../context-menu';
import { el } from '../dom';
import { onKeyboardOpenChange, onKeyboardResize } from '../popup';
import type { FormulaAutocomplete, FormulaFieldRef } from '../formula-autocomplete';
import type { FormulaLivePreview } from '../formula-bar';
import { createIcon } from '../icon';
import { EdgeAutoScroller } from './auto-scroll';
import { createSink } from './dom-support';
import { KeyboardViewport } from './keyboard-viewport';
import { DoubleTap, LongPress } from './touch-gestures';
import { GridMetrics } from './metrics';
import type { ValidationPicker } from '../validation-picker';
import type { RichCellEditor } from '../rich-cell-editor';
import { EditSession } from './edit-session';
import { GridRenderer } from './renderer';
import { WrapLayout } from './wrap-layout';
import { CellBuilder } from './cell-builder';
import { SelectionView } from './selection-view';
import { PointerInput } from './pointer-input';
import { DragOperations } from './drag-operations';
import { AutoFitter } from './auto-fitter';
import { Navigator } from './navigation';

export interface RenderWindow {
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

/**
 * Layout inputs that require a full window rebuild when they change. While
 * the signature is stable, a document mutation only repaints the already
 * rendered cells in place (no DOM teardown), so a single-cell edit never
 * rebuilds the visible grid.
 */
export interface LayoutSignature {
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

export class GridCore {
  readonly editing: EditSession;
  readonly renderer: GridRenderer;
  readonly wrap: WrapLayout;
  readonly cells: CellBuilder;
  readonly selectionView: SelectionView;
  readonly pointer: PointerInput;
  readonly drags: DragOperations;
  readonly autofit: AutoFitter;
  readonly navigation: Navigator;

  readonly element: HTMLElement;
  readonly canvas: HTMLElement;
  readonly headerEl: HTMLElement;
  readonly stickyEl: HTMLElement;
  readonly rowsLayer: HTMLElement;
  readonly emptyEl: HTMLElement;
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
  readonly addRowAnchor: HTMLElement;
  readonly addRowButton: HTMLButtonElement;
  readonly addColAnchor: HTMLElement;
  readonly addColButton: HTMLButtonElement;

  /** Pixel metrics, pinned-pane layout, and their per-document caches. */
  readonly metrics: GridMetrics;
  /** Nudges the viewport while a drag's pointer sits at the grid's edge. */
  readonly autoScroll: EdgeAutoScroller;
  lastDoc: unknown = null;
  window: RenderWindow | null = null;
  layout: LayoutSignature | null = null;
  /** Offscreen measuring cell for font/chrome metrics (never shows content). */
  readonly measureCell: HTMLElement;
  /** Layout signature the off-screen wrap-measure pass is running for, if any. */
  wrapPassSig: string | null = null;
  /** Stable ids per document object, so a wrap pass restarts on a new document. */
  readonly docIds = new WeakMap<object, number>();
  nextDocId = 1;
  /** Test seam: a deterministic text measurer that bypasses canvas metrics. */
  measurerOverride: WrapMeasure | null = null;
  /** Cached canvas measurer, reused across frames until the font changes. */
  cachedMeasurer: { sig: string; measure: WrapMeasure; chrome: number } | null = null;
  /** The top-left corner Select-All control (rebuilt each full render). */
  cornerButton: HTMLElement | null = null;
  editor: {
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
  sink: HTMLTextAreaElement;
  /** Hidden description element backing the inline editor's help tooltip. */
  readonly editorHint: HTMLElement;
  /** Polite live region announcing spreadsheet-zoom changes to AT. */
  readonly zoomLive: HTMLElement;
  /** Zoom last announced through the live region (null before first render). */
  announcedZoom: number | null = null;
  /** True between compositionstart and compositionend on the sink (IME is composing). */
  composing = false;
  contextMenu: ContextMenu | null = null;
  dragging = false;
  scrollScheduled = false;
  resizeScheduled = false;
  /** Active column-resize drag, if any. */
  resizing: { col: number; startX: number; startWidth: number } | null = null;
  /** Active fill-handle drag, if any. */
  filling: { source: CellRange; target: { row: number; col: number } } | null = null;
  /** The range currently outlined as a copy source (see `setCopySource`), or
   * null when nothing is being highlighted. */
  copySource: CellRange | null = null;
  /** Where each tab's selection was when Escape cleared it, so the next
   * arrow key moves on from there instead of from A1. */
  readonly clearedAt = new WeakMap<Tab, { row: number; col: number }>();
  /** Active whole-row / whole-column header drag, if any. */
  headerDrag: { axis: 'row' | 'col'; anchor: number; last: number } | null = null;
  /**
   * Active row/column move drag from a header's grip, if any: `count`
   * rows/columns from `from`, to be dropped at the boundary `to` (in the
   * current layout; null until the pointer is over a valid drop point).
   */
  axisMove: { axis: 'row' | 'col'; from: number; count: number; to: number | null } | null = null;
  /** Active pointer reference entry into a formula editor, if any. */
  refDrag: { anchor: { row: number; col: number } } | null = null;
  /** Touch/pen press-and-hold state (drag arming and the touch context menu). */
  readonly longPress = new LongPress();
  /** Touch/pen double-tap-to-edit state. */
  readonly doubleTap = new DoubleTap();
  /**
   * Active range-move drag, if any. `origin` is the cell under the pointer when
   * the drag began (so the destination tracks the pointer without snapping to a
   * corner); `delta` is the current move offset; `valid` is whether the current
   * destination is in bounds. Committed on mouseup — the move itself, with its
   * overwrite confirmation, runs through the shared command.
   */
  movingRange: {
    source: CellRange;
    origin: { row: number; col: number };
    delta: { row: number; col: number };
    valid: boolean;
  } | null = null;
  /** Ranges referenced by the formula currently being edited (highlighted). */
  formulaRefs: FormulaRefRange[] = [];
  /** In-progress raw text from the formula bar, rendered in place of the
   * active cell's committed value until it is committed or cleared. */
  formulaLivePreview: FormulaLivePreview | null = null;
  /** Floating note shown when a referenced range extends beyond the viewport. */
  readonly refIndicator: HTMLElement;
  /** `pointerType` of the most recent pointer gesture the grid handled,
   * updated in `onPointerDown` (see #469). Defaults to `'mouse'` so desktop,
   * programmatic, and keyboard-only focus paths are unaffected; `focusGrid()`
   * reads it to tell a plain touch/pen tap-to-select (which must not pop the
   * on-screen keyboard) apart from an actual mouse click. */
  lastPointerType: string = 'mouse';
  /** The resize-tracking observer created below, kept so `dispose()` can disconnect it. */
  resizeObserver: ResizeObserver | null = null;
  /**
   * `this.element`'s `contentRect.width` as of the last `onResize` call, so a
   * later call can tell a real layout change apart from a pure height change
   * (see `onResize`). `null` before the first observation.
   */
  lastResizeWidth: number | null = null;
  /** Unsubscribes `keyboardOpenChanged`; called by `dispose()`. */
  readonly offKeyboardOpenChange: () => void;
  /** Unsubscribes `keyboardResized`; called by `dispose()`. */
  readonly offKeyboardResize: () => void;
  /** Keeps the edited cell visible while an on-screen keyboard is open. */
  readonly keyboard: KeyboardViewport;

  constructor(
    readonly state: AppState,
    readonly commands: Commands,
  ) {
    this.editing = new EditSession(this);
    this.renderer = new GridRenderer(this);
    this.wrap = new WrapLayout(this);
    this.cells = new CellBuilder(this);
    this.selectionView = new SelectionView(this);
    this.pointer = new PointerInput(this);
    this.drags = new DragOperations(this);
    this.autofit = new AutoFitter(this);
    this.navigation = new Navigator(this);
    this.element = el('div', {
      className: 'grid-container',
      attrs: { tabindex: '0', role: 'grid' },
    });
    this.metrics = new GridMetrics(this.state, this.element, () => {
      this.wrapPassSig = null;
    });
    this.keyboard = new KeyboardViewport({
      element: this.element,
      sink: () => this.sink,
      showingActiveDocument: () => {
        const tab = this.state.activeTab;
        return tab !== null && tab.doc === this.lastDoc;
      },
      render: () => {
        const tab = this.state.activeTab;
        if (tab) {
          this.renderer.render(tab);
        }
      },
      centerTarget: () => {
        const tab = this.state.activeTab;
        if (tab) {
          this.navigation.centerKeyboardTarget(tab);
        }
      },
    });
    this.autoScroll = new EdgeAutoScroller(this.element, {
      dragActive: () => this.pointer.hasEdgeScrollableDrag(),
      hasTab: () => this.state.activeTab !== null,
      scrolled: (clientX, clientY) => {
        const tab = this.state.activeTab;
        if (tab) {
          this.renderer.render(tab);
          this.pointer.continueDragAt(tab, clientX, clientY);
        }
      },
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

    this.offKeyboardOpenChange = onKeyboardOpenChange((open) => this.navigation.keyboardOpenChanged(open));
    this.offKeyboardResize = onKeyboardResize(() => this.navigation.keyboardResized());
    this.wireEvents();
  }

  /** Attach the grid's DOM listeners, each routed to the collaborator that handles it. */
  private wireEvents(): void {
    // Scroll never calls preventDefault, so the listener is passive (the
    // browser can start compositor scrolling without waiting on the handler).
    this.element.addEventListener('scroll', () => this.renderer.onScroll(), { passive: true });
    // The container's width can change without a window resize (e.g. layout
    // shifts elsewhere in #app; see styles.css), so a ResizeObserver reflows
    // the grid instead of a plain window 'resize' listener. jsdom (tests) has
    // no ResizeObserver, so this is a no-op there.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => this.renderer.onResize(entries));
      this.resizeObserver.observe(this.element);
    }
    // Ctrl/Cmd + mouse wheel zooms the spreadsheet (grid area only). The
    // listener must be non-passive because the recognized gesture — and only
    // that gesture — prevents the browser's page-zoom default; a plain wheel
    // scroll is never touched.
    this.element.addEventListener('wheel', (event) => this.renderer.onWheel(event), { passive: false });
    this.element.addEventListener('keydown', (event) => this.navigation.onKeyDown(event));
    this.element.addEventListener('mousedown', (event) => this.pointer.onMouseDown(event));
    this.element.addEventListener('mousemove', (event) => this.pointer.onMouseMove(event));
    this.element.addEventListener('dblclick', (event) => this.pointer.onDoubleClick(event));
    this.element.addEventListener('contextmenu', (event) => this.pointer.onContextMenu(event));
    document.addEventListener('mousemove', (event) => this.drags.onResizeMove(event));
    // Mousemove bubbles to document regardless of which element the pointer
    // is over, so this alone drives auto-scroll for a drag whose pointer has
    // left the grid entirely, not just one still inside `this.element`.
    document.addEventListener('mousemove', (event) => this.autoScroll.track(event));
    document.addEventListener('mouseup', () => this.pointer.endActiveDrags());
    // Touch/pen equivalents of the mouse drag wiring above (#290). A real
    // mouse also dispatches pointer events, so every handler below bails out
    // on `pointerType === 'mouse'` and leaves that input to the mouse
    // listeners already registered.
    this.element.addEventListener('pointerdown', (event) => this.pointer.onPointerDown(event));
    this.element.addEventListener('pointermove', (event) => this.pointer.onPointerMove(event));
    this.element.addEventListener('pointerup', (event) => this.pointer.onPointerEnd(event));
    this.element.addEventListener('pointercancel', (event) => this.pointer.onPointerEnd(event));
    // Escape cancels an in-progress range-move, fill-handle, or column-resize
    // drag (rolling back safely, since nothing has been committed) before it
    // can reach the commit on mouseup.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (this.movingRange) {
        this.drags.cancelMove();
      }
      if (this.axisMove) {
        this.drags.cancelAxisMove();
      }
      if (this.filling) {
        this.drags.cancelFill();
      }
      if (this.resizing) {
        this.drags.cancelResize();
      }
      // Dismiss the copy-source outline, matching the conventional
      // spreadsheet Escape behavior (it only clears the visual marker; the
      // clipboard's own text/matrix — and its ability to still be pasted —
      // is untouched).
      this.selectionView.setCopySource(null);
    });
    // Escape / outside interaction / resize / scroll dismissal is owned by
    // `ContextMenu` itself, so every context menu in the application behaves
    // identically (see src/ui/context-menu.ts).

    // ----- IME-safe keyboard target (the sink) -----
    // Focusing the grid container (tab stop, corner clicks, cell clicks)
    // forwards focus into the sink so keystrokes and IME compositions always
    // target an editable element.
    this.element.addEventListener('focus', () => this.editing.focusGrid());
    this.editing.wireSink(this.sink);
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
}
