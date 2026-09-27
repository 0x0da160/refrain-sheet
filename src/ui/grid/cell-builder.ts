// SPDX-License-Identifier: MIT
/**
 * Building and painting the header, corner, and data cells of the rendered
 * window — values as text, never HTML — plus the formula-reference overlay
 * and the header filter buttons.
 *
 * A collaborator of the grid (see `./core.ts`): it owns no state of its own
 * beyond what is declared here, and reaches shared grid state through
 * `this.core`.
 */
import { isCsv, isWorkbook } from '../../core/editor-document';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, GripVertical, ListFilter, Plus } from 'lucide';
import type { Tab } from '../../app/state';
import { t } from '../../app/i18n';
import { runsForText, type TextRun } from '../../core/workbook/rich-text';
import { columnLabel, type FormulaRefRange } from '../../core/formula';
import { el } from '../dom';
import type { FormulaLivePreview } from '../formula-bar';
import { createIcon } from '../icon';
import {
  clampFormulaRefs,
  matchFormulaRefCell,
  formulaRefsExceedViewport,
  type ClampedFormulaRef,
} from './formula-ref-overlay';
import { malformedFieldTooltip, paintCellStyle } from './cell-paint';
import { richTextNodes } from '../rich-text-render';
import type { GridCore, RenderWindow } from './core';

export class CellBuilder {
  constructor(private readonly core: GridCore) {}

  /**
   * Build one column-header cell (letter label, optional filter button, and
   * resize handle). Shared by the windowed header loop and the pinned first
   * column's header cell — the same cell markup either way, since only the
   * pinned copy's positioning (see `.colpin`) differs.
   */
  buildColumnHeaderCell(tab: Tab, c: number, pinned: boolean): HTMLElement {
    const doc = tab.doc;
    const filter = isWorkbook(doc) ? doc.filter : null;
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
    head.style.width = `${this.core.metrics.colWidth(tab, c)}px`;
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
        void this.core.commands.filterDialog(tab, c);
      });
      head.append(filterButton);
    }
    this.appendHeaderTools(tab, head, 'col', c);
    // Draggable boundary to resize; double-click auto-fits to visible content.
    const handle = el('div', {
      className: 'col-resize-handle',
      attrs: { 'data-colresize': String(c), 'aria-hidden': 'true', title: t('grid.resizeTitle') },
    });
    head.append(handle);
    return head;
  }

  /**
   * The row/column header's hover tools: a grip to drag the row/column (or
   * the selected rows/columns it belongs to) somewhere else, and a small +
   * that inserts one row below / one column to the right. CSS shows them
   * only while a mouse hovers the header; the same actions stay reachable
   * from the menus and the context menu. The grip is offered only where a
   * move is possible: an RSF worksheet (moving is a structural edit a
   * byte-preserving CSV cannot represent), and for rows not while a sort
   * reorders what is shown. A locked worksheet gets neither tool.
   */
  private appendHeaderTools(tab: Tab, head: HTMLElement, axis: 'row' | 'col', index: number): void {
    const doc = tab.doc;
    if (isWorkbook(doc) && doc.activeSheet.locked) {
      return;
    }
    if (isWorkbook(doc) && (axis === 'col' || doc.sort === null)) {
      const grip = el('span', {
        className: 'head-grip',
        attrs: {
          'data-axismove': axis,
          'aria-hidden': 'true',
          title: t(axis === 'row' ? 'grid.moveRowGrip' : 'grid.moveColGrip'),
        },
      });
      grip.append(createIcon(GripVertical, '', 12));
      head.append(grip);
    }
    const label = t(axis === 'row' ? 'grid.insertRowBelowButton' : 'grid.insertColRightButton');
    const insert = el('button', {
      className: 'head-insert',
      attrs: { type: 'button', tabindex: '-1', 'aria-label': label, title: label },
    });
    insert.append(createIcon(Plus, '', 12));
    insert.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    insert.addEventListener('click', (event) => {
      event.stopPropagation();
      const current = this.core.state.activeTab;
      if (!current) {
        return;
      }
      this.core.editing.commitEditor();
      if (axis === 'row') {
        this.core.pointer.selectRows(current, index, index);
      } else {
        this.core.pointer.selectCols(current, index, index);
      }
      this.core.editing.focusGrid();
      void this.core.commands.run(axis === 'row' ? 'sheet.insertRowBelow' : 'sheet.insertColRight');
    });
    head.append(insert);
  }

  /**
   * Build the interactive top-left corner Select All Cells control. It shows
   * no visible text by design (like conventional spreadsheet corner cells);
   * its purpose is conveyed by the localized accessible name and tooltip, and
   * its pressed state mirrors the whole-sheet selection.
   */
  buildCorner(tab: Tab): HTMLElement {
    const corner = el('button', {
      className: 'vcell vhead vcorner',
      attrs: {
        type: 'button',
        'aria-label': t('grid.selectAllCorner'),
        title: t('grid.selectAllCorner'),
      },
    });
    corner.style.width = `${this.core.metrics.headW(tab)}px`;
    // Enter/Space activate natively; a pointer tap does the same. Focus the
    // grid afterward so keyboard navigation and copy keep working.
    corner.addEventListener('click', () => {
      this.core.editing.focusGrid();
      void this.core.commands.run('edit.selectAll');
    });
    this.core.cornerButton = corner;
    this.syncCorner();
    return corner;
  }

  /** Reflect whole-sheet selection state onto the corner control for AT. */
  syncCorner(): void {
    const corner = this.core.cornerButton;
    if (!corner) {
      return;
    }
    corner.setAttribute('aria-pressed', this.core.element.classList.contains('sel-all') ? 'true' : 'false');
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
    if (refs.length === 0 && this.core.formulaRefs.length === 0) {
      return;
    }
    this.core.formulaRefs = refs;
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
    const prev = this.core.formulaLivePreview;
    this.core.formulaLivePreview = preview;
    const tab = this.core.state.activeTab;
    if (!tab) return;
    for (const p of [prev, preview]) {
      if (!p) continue;
      if (this.core.editor && this.core.editor.row === p.row && this.core.editor.col === p.col) continue;
      const cell = this.core.canvas.querySelector<HTMLElement>(`[data-row="${p.row}"][data-col="${p.col}"]`);
      if (cell) this.paintCell(tab, cell, p.row, p.col);
    }
  }

  refreshFormulaRefs(): void {
    const tab = this.core.state.activeTab;
    const usable = tab !== null && tab.doc === this.core.lastDoc;
    const rows = usable ? tab.doc.rowCount : 0;
    const cols = usable ? tab.doc.columnCount : 0;
    const ranges = clampFormulaRefs(usable ? this.core.formulaRefs : [], rows, cols);
    for (const cell of this.core.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]')) {
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
    const win = this.core.window;
    let clipped = false;
    if (tab && win && ranges.length > 0) {
      // The window's slots already start past the pinned rows; while it sits
      // right below them, the pinned rows extend the visible band to the top.
      const base = this.core.metrics.scrollRowBase(tab);
      clipped = formulaRefsExceedViewport(ranges, {
        firstRow: win.rowStart === base ? 0 : win.rowStart,
        lastRow: win.rowEnd - 1,
        colStart: win.colStart,
        colEnd: win.colEnd,
      });
    }
    if (!clipped) {
      this.core.refIndicator.hidden = true;
      return;
    }
    this.core.refIndicator.textContent = t('grid.refsBeyond');
    const rect = this.core.element.getBoundingClientRect();
    this.core.refIndicator.style.left = `${rect.left + 8}px`;
    this.core.refIndicator.style.top = `${Math.max(0, rect.bottom - 34)}px`;
    this.core.refIndicator.hidden = false;
  }

  buildRowCells(tab: Tab, rowEl: HTMLElement, row: number, win: RenderWindow, pinned: boolean): void {
    const doc = tab.doc;
    const head = el('div', {
      className: `vcell vrowhead${pinned ? ' pinned' : ''}`,
      text: String(row + 1),
      attrs: { role: 'rowheader', 'data-rowhead': String(row), 'aria-colindex': '1' },
    });
    if (pinned) {
      head.setAttribute('title', t('grid.stickyRowTitle', { n: row + 1 }));
    }
    head.style.width = `${this.core.metrics.headW(tab)}px`;
    this.appendHeaderTools(tab, head, 'row', row);
    rowEl.append(head);
    const fieldCount = doc.fieldCount(row);
    const frozenCols = this.core.metrics.frozenColCount(tab);
    for (let c = 0; c < frozenCols; c++) {
      const pinCell = this.buildDataCell(tab, row, c, fieldCount);
      this.pinColumnCell(tab, pinCell, c, frozenCols);
      rowEl.append(pinCell);
    }
    const originX = this.core.metrics.colOffset(tab, this.core.metrics.scrollColBase(tab));
    const spacer = el('div', { className: 'vspacer', attrs: { 'aria-hidden': 'true' } });
    spacer.style.width = `${this.core.metrics.colOffset(tab, win.colStart) - originX}px`;
    rowEl.append(spacer);
    for (let c = win.colStart; c < win.colEnd; c++) {
      rowEl.append(this.buildDataCell(tab, row, c, fieldCount));
    }
  }

  /** Make a cell of pinned column `c` stick right of the row numbers (and the pinned columns before it). */
  pinColumnCell(tab: Tab, cell: HTMLElement, c: number, frozenCols: number): void {
    cell.classList.add('colpin');
    cell.classList.toggle('colpin-edge', c === frozenCols - 1);
    cell.style.left = `${this.core.metrics.headW(tab) + this.core.metrics.colOffset(tab, c)}px`;
  }

  /** Build one data cell (or a void placeholder past the row's field count). */
  private buildDataCell(tab: Tab, row: number, c: number, fieldCount: number): HTMLElement {
    if (c >= fieldCount) {
      const voidCell = el('div', { className: 'vcell void', attrs: { 'aria-hidden': 'true' } });
      voidCell.style.width = `${this.core.metrics.colWidth(tab, c)}px`;
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
    cell.style.width = `${this.core.metrics.colWidth(tab, c)}px`;
    this.paintCell(tab, cell, row, c);
    return cell;
  }

  private paintCell(tab: Tab, cell: HTMLElement, row: number, col: number): void {
    const doc = tab.doc;
    const preview = this.core.formulaLivePreview;
    const value =
      preview && preview.row === row && preview.col === col ? preview.value : doc.getDisplayValue(row, col);
    const button = this.headerFilterButton(tab, row, col);
    const rich = this.richRuns(tab, row, col, value);
    cell.classList.toggle('rich-text', rich !== null);
    if (rich) {
      // Rich text: one span per formatted part (text only, never HTML).
      const conditionalColor = isWorkbook(doc)
        ? doc.getConditionalFormatStyle(row, col)?.textColor
        : undefined;
      const spans = richTextNodes(rich, isWorkbook(doc) ? doc.getStyle(row, col) : null, conditionalColor);
      // One wrapper, so a wrapped row's flex cell lays the parts out as one
      // run of text rather than as side-by-side flex items.
      const body = el('span', { className: 'rich-text-body' }, spans);
      cell.replaceChildren(body, ...(button ? [button] : []));
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
    if (isCsv(doc)) {
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
        cell.title = malformedFieldTooltip(doc, row, col);
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
      paintCellStyle(cell, doc, row, col);
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
    if (!isWorkbook(doc) || doc.activeSheet.kind !== 'grid') {
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
    if (!isWorkbook(doc) || !this.isHeaderFilterCell(tab, row, col)) {
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
  isHeaderFilterCell(tab: Tab, row: number, col: number): boolean {
    const filter = isWorkbook(tab.doc) ? tab.doc.filter : null;
    return (
      filter !== null && filter.headerRow && row === filter.top && col >= filter.left && col <= filter.right
    );
  }

  /** Open the column menu for `col` below `anchor`, then return focus to the grid. */
  openColumnMenu(tab: Tab, col: number, anchor: HTMLElement | null): void {
    const r = anchor?.getBoundingClientRect();
    const rect = r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    void this.core.commands.columnMenu(tab, col, rect).finally(() => {
      if (this.core.state.activeTab === tab) {
        this.core.editing.focusGrid();
      }
    });
  }

  /** Repaint the currently rendered cells in place (values/classes only). */
  paintWindowCells(tab: Tab): void {
    const cells = this.core.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]');
    for (const cell of cells) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (this.core.editor && this.core.editor.row === row && this.core.editor.col === col) {
        continue; // never clobber the cell under an open inline editor
      }
      this.paintCell(tab, cell, row, col);
    }
  }
}
