// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app/app-state';
import type { CommandId, Commands } from '../app/commands';
import { t } from '../app/i18n';
import { normalizeRange, rangeContains, type CellRange } from '../core/clipboard';
import { cellLabel, columnLabel } from '../core/formula';
import { el, clearChildren } from './dom';

/** Fixed row/column metrics for virtualization (px). */
export const ROW_HEIGHT = 26;
export const WRAP_ROW_HEIGHT = 78;
export const COL_WIDTH = 132;
export const MIN_COL_WIDTH = 40;
export const MAX_COL_WIDTH = 1200;
export const ROW_HEAD_WIDTH = 64;
export const OVERSCAN_ROWS = 8;
export const OVERSCAN_COLS = 3;

interface RenderWindow {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

const CONTEXT_MENU_ITEMS: Array<{ command: CommandId; labelKey: string } | 'separator'> = [
  { command: 'edit.copy', labelKey: 'menu.edit.copy' },
  { command: 'edit.paste', labelKey: 'menu.edit.paste' },
  { command: 'edit.revertCell', labelKey: 'menu.edit.revertCell' },
  'separator',
  { command: 'sheet.insertRowAbove', labelKey: 'menu.sheet.insertRowAbove' },
  { command: 'sheet.insertRowBelow', labelKey: 'menu.sheet.insertRowBelow' },
  { command: 'sheet.deleteRows', labelKey: 'menu.sheet.deleteRows' },
  'separator',
  { command: 'sheet.insertColLeft', labelKey: 'menu.sheet.insertColLeft' },
  { command: 'sheet.insertColRight', labelKey: 'menu.sheet.insertColRight' },
  { command: 'sheet.deleteCols', labelKey: 'menu.sheet.deleteCols' },
];

/**
 * Virtualized CSV/RCSV grid. Only the visible rows and columns (plus a small
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
  private editor: { row: number; col: number; input: HTMLInputElement } | null = null;
  private contextMenu: HTMLElement | null = null;
  private dragging = false;
  private scrollScheduled = false;
  /** Active column-resize drag, if any. */
  private resizing: { col: number; startX: number; startWidth: number } | null = null;
  /** Active fill-handle drag, if any. */
  private filling: { source: CellRange; target: { row: number; col: number } } | null = null;
  /** Active pointer reference entry into a formula editor, if any. */
  private refDrag: { anchor: { row: number; col: number } } | null = null;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    this.element = el('div', {
      className: 'grid-container',
      attrs: { tabindex: '0', role: 'grid' },
    });
    this.canvas = el('div', { className: 'vgrid-canvas' });
    this.headerEl = el('div', { className: 'vgrid-header', attrs: { role: 'row' } });
    this.stickyEl = el('div', { className: 'vgrid-stickyrow', attrs: { role: 'row' } });
    this.rowsLayer = el('div', { className: 'vgrid-rows' });
    this.emptyEl = el('div', { className: 'grid-empty' });
    this.canvas.append(this.headerEl, this.stickyEl, this.rowsLayer);
    this.element.append(this.canvas);

    this.element.addEventListener('scroll', () => this.onScroll());
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.element.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.element.addEventListener('mousemove', (event) => this.onMouseMove(event));
    this.element.addEventListener('dblclick', (event) => this.onDoubleClick(event));
    this.element.addEventListener('contextmenu', (event) => this.onContextMenu(event));
    document.addEventListener('mousemove', (event) => this.onResizeMove(event));
    document.addEventListener('mouseup', () => {
      this.dragging = false;
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
  }

  // ----- Metrics -----

  private get rowHeight(): number {
    return this.state.wrapCells ? WRAP_ROW_HEIGHT : ROW_HEIGHT;
  }

  private stickyEnabled(tab: Tab): boolean {
    return this.state.stickyFirstRow && tab.doc.rowCount > 0;
  }

  /** Number of rows rendered in the scrolling region. */
  private scrollRowCount(tab: Tab): number {
    return this.stickyEnabled(tab) ? tab.doc.rowCount - 1 : tab.doc.rowCount;
  }

  /** First document row of the scrolling region. */
  private scrollRowBase(tab: Tab): number {
    return this.stickyEnabled(tab) ? 1 : 0;
  }

  /** Height of the sticky overlays (header + optional pinned first row). */
  private overlayHeight(tab: Tab): number {
    return this.rowHeight * (this.stickyEnabled(tab) ? 2 : 1);
  }

  /** Pixel width of a column (per-tab override or the default). */
  private colWidth(tab: Tab, col: number): number {
    const w = tab.colWidths[col];
    return w && w > 0 ? w : COL_WIDTH;
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
    return ROW_HEAD_WIDTH + this.totalColsWidth(tab);
  }

  // ----- Rendering -----

  refresh(): void {
    const tab = this.state.activeTab;
    this.element.setAttribute('aria-label', t('grid.label'));
    if (!tab || tab.doc.rowCount === 0) {
      this.lastDoc = null;
      this.editor = null;
      this.window = null;
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
    this.window = null; // force rebuild
    this.render(tab);
  }

  /** Update selection highlighting only (cheap; used for selection events). */
  refreshSelection(): void {
    const tab = this.state.activeTab;
    if (!tab || tab.doc !== this.lastDoc) {
      return;
    }
    const range = this.state.selectedRange(tab);
    const active = tab.selection;
    const cells = this.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]');
    for (const cell of cells) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const inRange = range !== null && rangeContains(range, row, col);
      const isActive = active !== null && active.row === row && active.col === col;
      cell.classList.toggle('in-range', inRange && !isActive);
      cell.classList.toggle('selected', isActive);
      if (isActive) {
        cell.setAttribute('aria-selected', 'true');
      } else {
        cell.removeAttribute('aria-selected');
      }
    }
    const rows = this.canvas.querySelectorAll<HTMLElement>('.vgrid-row, .vgrid-stickyrow');
    for (const rowEl of rows) {
      const row = Number(rowEl.dataset.row);
      rowEl.classList.toggle('selected-row', active !== null && active.row === row);
    }
    this.placeFillHandle(tab, range);
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
    const rowH = this.rowHeight;
    const overlay = this.overlayHeight(tab);
    const viewH = Math.max(0, this.element.clientHeight - overlay);
    const viewW = Math.max(0, this.element.clientWidth - ROW_HEAD_WIDTH);
    const scrollTop = this.element.scrollTop;
    const scrollLeft = this.element.scrollLeft;
    const totalRows = this.scrollRowCount(tab);
    const totalCols = Math.max(1, tab.doc.columnCount);
    const rowStart = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN_ROWS);
    const rowEnd = Math.min(totalRows, Math.ceil((scrollTop + viewH) / rowH) + OVERSCAN_ROWS);
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
    return { rowStart, rowEnd, colStart, colEnd };
  }

  private sameWindow(a: RenderWindow | null, b: RenderWindow): boolean {
    return (
      a !== null &&
      a.rowStart === b.rowStart &&
      a.rowEnd === b.rowEnd &&
      a.colStart === b.colStart &&
      a.colEnd === b.colEnd
    );
  }

  private render(tab: Tab): void {
    const doc = tab.doc;
    const rowH = this.rowHeight;
    const win = this.computeWindow(tab);
    if (this.sameWindow(this.window, win)) {
      this.paintWindowCells(tab);
      this.refreshSelection();
      return;
    }
    if (this.editor) {
      // The editor's cell may be about to leave the window; commit first.
      this.commitEditor();
    }
    this.window = win;

    const totalW = this.totalWidth(tab);
    const scrollRows = this.scrollRowCount(tab);
    this.canvas.style.width = `${totalW}px`;
    this.canvas.style.height = `${this.overlayHeight(tab) + scrollRows * rowH}px`;
    this.element.setAttribute('aria-rowcount', String(doc.rowCount + 1));
    this.element.setAttribute('aria-colcount', String(doc.columnCount + 1));

    // ----- Column header (always sticky) -----
    clearChildren(this.headerEl);
    this.headerEl.style.width = `${totalW}px`;
    this.headerEl.style.height = `${rowH}px`;
    const corner = el('div', {
      className: 'vcell vhead vcorner',
      text: t('grid.rowHeader'),
      attrs: { role: 'columnheader' },
    });
    corner.style.width = `${ROW_HEAD_WIDTH}px`;
    this.headerEl.append(corner);
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

    // ----- Sticky first record row (optional, distinct from the header) -----
    clearChildren(this.stickyEl);
    if (this.stickyEnabled(tab)) {
      this.stickyEl.hidden = false;
      this.stickyEl.style.width = `${totalW}px`;
      this.stickyEl.style.height = `${rowH}px`;
      this.stickyEl.style.top = `${rowH}px`;
      this.stickyEl.dataset.row = '0';
      this.stickyEl.setAttribute('aria-rowindex', '2');
      this.buildRowCells(tab, this.stickyEl, 0, win, true);
    } else {
      this.stickyEl.hidden = true;
      delete this.stickyEl.dataset.row;
    }

    // ----- Virtualized data rows -----
    clearChildren(this.rowsLayer);
    this.rowsLayer.style.height = `${scrollRows * rowH}px`;
    const base = this.scrollRowBase(tab);
    for (let i = win.rowStart; i < win.rowEnd; i++) {
      const row = base + i;
      const rowEl = el('div', {
        className: `vgrid-row ${row % 2 === 1 ? 'alt' : ''}`,
        attrs: { role: 'row', 'data-row': String(row), 'aria-rowindex': String(row + 2) },
      });
      rowEl.style.top = `${i * rowH}px`;
      rowEl.style.height = `${rowH}px`;
      rowEl.style.width = `${totalW}px`;
      this.buildRowCells(tab, rowEl, row, win, false);
      this.rowsLayer.append(rowEl);
    }
    this.refreshSelection();
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
    head.style.width = `${ROW_HEAD_WIDTH}px`;
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
      this.paintCell(tab, cell, Number(cell.dataset.row), Number(cell.dataset.col));
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
    // references into the formula instead of moving the grid selection.
    const refTarget = this.state.formulaRefTarget;
    if (refTarget?.isCapturing()) {
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
      // Row header: select the whole row.
      const row = Number(rowHead.dataset.rowhead);
      this.commitEditor();
      const lastCol = Math.max(0, tab.doc.fieldCount(row) - 1);
      this.state.setSelection(tab, { row, col: 0 }, { row, col: lastCol });
      this.element.focus();
      event.preventDefault();
      return;
    }
    const colHead = target?.closest<HTMLElement>('[data-colhead]');
    if (colHead) {
      // Column header: select the whole column.
      const col = Number(colHead.dataset.colhead);
      this.commitEditor();
      this.state.setSelection(tab, { row: 0, col }, { row: Math.max(0, tab.doc.rowCount - 1), col });
      this.element.focus();
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
      this.element.focus();
      event.preventDefault();
    }
  }

  private onMouseMove(event: MouseEvent): void {
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
        this.filling.target = cell;
        this.updateFillPreview();
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
    this.state.setSelection(tab, cell, tab.anchor ?? tab.selection);
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
      this.autoFitColumn(tab, Number(resizeHandle.dataset.colresize));
      return;
    }
    const cell = this.cellFromEvent(event);
    if (cell) {
      this.openEditor(tab, cell.row, cell.col, null);
    }
  }

  // ----- Column resizing -----

  /** Set a column's width (clamped) and re-lay-out. Never marks the document dirty. */
  private setColWidth(tab: Tab, col: number, width: number): void {
    const w = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(width)));
    if (tab.colWidths[col] === w) {
      return;
    }
    tab.colWidths[col] = w;
    this.window = null; // force a re-layout with the new width
    this.render(tab);
  }

  private onResizeMove(event: MouseEvent): void {
    const drag = this.resizing;
    if (!drag) {
      return;
    }
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    this.setColWidth(tab, drag.col, drag.startWidth + (event.clientX - drag.startX));
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
   * Auto-fit a column to the widest currently rendered (visible) content plus
   * the header label — a documented sampled subset, since only the visible
   * window is materialized.
   */
  private autoFitColumn(tab: Tab, col: number): void {
    let max = MIN_COL_WIDTH;
    for (const cell of this.canvas.querySelectorAll<HTMLElement>(`.vcell[data-col="${col}"]`)) {
      const needed = cell.scrollWidth + 2;
      if (needed > max) max = needed;
    }
    const head = this.headerEl.querySelector<HTMLElement>(`[data-colhead="${col}"]`);
    if (head) {
      const needed = head.scrollWidth + 10;
      if (needed > max) max = needed;
    }
    this.setColWidth(tab, col, max);
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
    const rowH = this.rowHeight;
    const overlay = this.overlayHeight(tab);
    if (!(this.stickyEnabled(tab) && row === 0)) {
      const base = this.scrollRowBase(tab);
      const y = (row - base) * rowH;
      const viewH = this.element.clientHeight - overlay;
      if (y < this.element.scrollTop) {
        this.element.scrollTop = y;
      } else if (y + rowH > this.element.scrollTop + viewH) {
        this.element.scrollTop = y + rowH - viewH;
      }
    }
    const x = this.colOffset(tab, col);
    const w = this.colWidth(tab, col);
    const viewW = this.element.clientWidth - ROW_HEAD_WIDTH;
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
    this.element.focus();
  }

  // ----- Editing -----

  /**
   * Open the inline cell editor. `initial` replaces the content (typing
   * starts a fresh value, like a spreadsheet); null edits the current value
   * (the raw formula expression for formula cells).
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
    const input = el('input', {
      className: 'cell-editor',
      attrs: { type: 'text', 'aria-label': t('formulaBar.label') },
    });
    input.value = initial !== null ? initial : tab.doc.getValue(row, col);
    this.editor = { row, col, input };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        this.commitEditor();
        this.moveSelection(tab, event.shiftKey ? -1 : 1, 0, false);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        this.commitEditor();
        this.moveSelection(tab, 0, event.shiftKey ? -1 : 1, false);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        // Restore the value the cell had when editing began.
        this.closeEditor(false);
        this.element.focus();
      }
    });
    input.addEventListener('blur', () => this.commitEditor());
    cell.append(input);
    input.focus();
    if (initial !== null) {
      input.setSelectionRange(input.value.length, input.value.length);
    } else {
      input.select();
    }
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
    editor.input.remove();
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
    editor.input.remove();
  }

  /** True when the grid (not an editor input) should own copy/paste events. */
  isNavigating(): boolean {
    return this.editor === null && document.activeElement === this.element;
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
        // Typing (including Shift+letter) starts a fresh edit with that character.
        if (event.key.length === 1 && tab.selection) {
          event.preventDefault();
          this.openEditor(tab, tab.selection.row, tab.selection.col, event.key);
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
        const lastCol = Math.max(0, tab.doc.fieldCount(row) - 1);
        this.state.setSelection(tab, { row, col: 0 }, { row, col: lastCol });
      }
    } else if (colHead) {
      const col = Number(colHead.dataset.colhead);
      const range = this.state.selectedRange(tab);
      if (!range || col < range.left || col > range.right) {
        this.state.setSelection(tab, { row: 0, col }, { row: Math.max(0, tab.doc.rowCount - 1), col });
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
