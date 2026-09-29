// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../../app/state';
import type { Commands } from '../../app/commands';
import type { CellRange } from '../../core/clipboard';
import type { FormulaRefRange } from '../../core/formula';
import type { WrapMeasure } from '../../core/text-wrap';
import type { SheetObject } from '../../core/workbook/sheet-objects';
import type { FormulaLivePreview } from '../formula-bar';
import {
  autoFitWidth,
  planAutoFit,
  planAutoFitColumns,
  AUTOFIT_SAMPLE_BUDGET,
  type AutoFitInput,
} from './autofit';
import {
  clampFormulaRefs,
  matchFormulaRefCell,
  formulaRefsExceedViewport,
  type ClampedFormulaRef,
} from './formula-ref-overlay';
import {
  COL_WIDTH,
  MAX_COL_WIDTH,
  MAX_WRAP_LINES,
  MIN_COL_WIDTH,
  OVERSCAN_ROWS,
  ROW_HEAD_WIDTH,
  ROW_HEIGHT,
  WRAP_LINE_HEIGHT,
  WRAP_VERTICAL_PAD,
} from './geometry';
import { GridCore } from './core';

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
  /** Shared state and the collaborators that implement the grid — see `./core.ts`. */
  private readonly core: GridCore;

  constructor(state: AppState, commands: Commands) {
    this.core = new GridCore(state, commands);
    this.element = this.core.element;
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
    return this.core.editing.focusGrid();
  }

  /**
   * Test seam: install a deterministic text measurer so wrapping can be
   * exercised without a real 2D canvas (jsdom returns none). Pass null to
   * restore canvas-based measurement. Also clears cached heights so the next
   * render re-measures with the new measurer.
   */
  setTextMeasurer(measure: WrapMeasure | null): void {
    return this.core.wrap.setTextMeasurer(measure);
  }

  // ----- Rendering -----

  refresh(): void {
    return this.core.renderer.refresh();
  }

  /** Update selection highlighting only (cheap; used for selection events). */
  /** An object's top-left corner from the sheet's, in pixels at 100% zoom (the object list's X and Y). */
  objectPosition(tab: Tab, object: SheetObject): { x: number; y: number } {
    return this.core.objects.positionOf(tab, object);
  }

  /** The object moved so its top-left corner is at (`x`, `y`) from the sheet's, in pixels at 100%. */
  objectMovedTo(tab: Tab, object: SheetObject, x: number, y: number): SheetObject {
    return this.core.objects.movedTo(tab, object, x, y);
  }

  refreshSelection(): void {
    this.core.selectionView.refreshSelection();
    this.core.objects.render(this.core.state.activeTab);
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
    return this.core.selectionView.setCopySource(range);
  }

  /**
   * Mark cells of the active worksheet (the version-history preview's
   * changes) and repaint; null removes every mark.
   */
  setCellMarker(marker: ((row: number, col: number) => 'value' | 'format' | null) | null): void {
    this.core.cellMarker = marker;
    this.refresh();
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
    return this.core.cells.setFormulaRefs(refs);
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
    return this.core.cells.setFormulaLivePreview(preview);
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
  autoFitSelectedColumns(): Promise<void> {
    return this.core.autofit.autoFitSelectedColumns();
  }

  /**
   * Auto-fit every column of `tab`, regardless of selection — used by the
   * "auto-fit on open" preference (see `getAutoFitOnOpen`) right after a file
   * finishes loading.
   */
  autoFitAllColumns(tab: Tab): Promise<void> {
    return this.core.autofit.autoFitAllColumns(tab);
  }

  // ----- Selection movement -----

  select(tab: Tab, row: number, col: number, scroll = false): void {
    return this.core.navigation.select(tab, row, col, scroll);
  }

  /** Select a cell and scroll it into view (used by find). */
  reveal(row: number, col: number): void {
    return this.core.navigation.reveal(row, col);
  }

  /** The on-screen keyboard opened or closed — see `KeyboardViewport.openChanged`. */
  keyboardOpenChanged(open: boolean): void {
    return this.core.navigation.keyboardOpenChanged(open);
  }

  /** The visible area changed height while the keyboard is open (`onKeyboardResize`). */
  keyboardResized(): void {
    return this.core.navigation.keyboardResized();
  }

  /**
   * Register a field outside the grid that edits the selected cell (the
   * formula bar): when the on-screen keyboard opens for it, the selected cell
   * is centered in the shrunken grid just as for the in-cell editor.
   */
  addKeyboardEditField(field: Element): void {
    return this.core.navigation.addKeyboardEditField(field);
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
    return this.core.editing.openEditor(tab, row, col, initial, caretOffset);
  }

  /** Commit the inline editor if open. */
  commitEditor(): void {
    return this.core.editing.commitEditor();
  }

  /**
   * Discard any in-progress inline edit without committing it, tearing down
   * the autocomplete popup, the IME sink promotion, the formula-reference
   * capture, and the reference highlights. Called when the active worksheet or
   * document changes so an editor opened on one worksheet can never commit its
   * text into another.
   */
  cancelEditing(): void {
    return this.core.editing.cancelEditing();
  }

  /** True when the grid (not an editor input) should own copy/paste events. */
  isNavigating(): boolean {
    return this.core.editing.isNavigating();
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
    return this.core.dispose();
  }
}
