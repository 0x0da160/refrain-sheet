// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import type { LosslessDocument } from '../core/lossless-document';
import { el, clearChildren } from './dom';

const ROW_CHUNK = 500;

/**
 * The CSV grid. Rows are rendered in chunks as the user scrolls (a simple
 * incremental approach — no virtualization framework). Inline editing uses
 * an absolutely positioned input inside the cell so the row height and table
 * layout never shift while editing. All cell content is rendered via
 * textContent, never as HTML.
 */
export class Grid {
  readonly element: HTMLElement;
  private tbody: HTMLTableSectionElement | null = null;
  private moreNote: HTMLElement | null = null;
  private renderedRows = 0;
  private lastDoc: LosslessDocument | null = null;
  private editor: { row: number; col: number; input: HTMLInputElement; cancelled: boolean } | null = null;
  private contextMenu: HTMLElement | null = null;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    this.element = el('div', {
      className: 'grid-container',
      attrs: { tabindex: '0', role: 'region' },
    });
    this.element.addEventListener('scroll', () => this.maybeRenderMore());
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    document.addEventListener('mousedown', (event) => {
      if (this.contextMenu && !this.contextMenu.contains(event.target as Node)) {
        this.closeContextMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeContextMenu();
    });
  }

  refresh(): void {
    const tab = this.state.activeTab;
    this.element.setAttribute('aria-label', t('grid.label'));
    if (!tab) {
      this.lastDoc = null;
      this.editor = null;
      clearChildren(this.element);
      this.element.append(el('div', { className: 'grid-empty', text: t('grid.empty') }));
      return;
    }
    if (tab.doc !== this.lastDoc) {
      this.fullRender(tab);
    } else {
      this.updateCells(tab);
      this.updateSelectionClasses(tab);
    }
  }

  /** Update selection highlighting only (cheap; used for selection events). */
  refreshSelection(): void {
    const tab = this.state.activeTab;
    if (tab && tab.doc === this.lastDoc) {
      this.updateSelectionClasses(tab);
    }
  }

  private fullRender(tab: Tab): void {
    this.closeEditor(false);
    this.closeContextMenu();
    this.lastDoc = tab.doc;
    this.renderedRows = 0;
    clearChildren(this.element);

    const doc = tab.doc;
    if (doc.rowCount === 0) {
      this.element.append(el('div', { className: 'grid-empty', text: t('grid.empty') }));
      return;
    }

    const table = el('table', {
      className: 'grid',
      attrs: {
        role: 'grid',
        'aria-rowcount': String(doc.rowCount + 1),
        'aria-colcount': String(doc.columnCount + 1),
      },
    });
    const thead = el('thead');
    const headRow = el('tr', { attrs: { role: 'row' } });
    headRow.append(el('th', { className: 'row-head', text: t('grid.rowHeader'), attrs: { scope: 'col' } }));
    for (let c = 0; c < doc.columnCount; c++) {
      headRow.append(el('th', { text: String(c + 1), attrs: { scope: 'col' } }));
    }
    thead.append(headRow);
    table.append(thead);
    this.tbody = el('tbody');
    table.append(this.tbody);
    this.element.append(table);
    this.moreNote = el('div', { className: 'grid-more', attrs: { role: 'status' } });
    this.element.append(this.moreNote);

    this.renderChunk(tab);
    this.updateSelectionClasses(tab);
  }

  private renderChunk(tab: Tab): void {
    if (!this.tbody) return;
    const doc = tab.doc;
    const end = Math.min(doc.rowCount, this.renderedRows + ROW_CHUNK);
    for (let r = this.renderedRows; r < end; r++) {
      const tr = el('tr', { attrs: { role: 'row', 'data-row': String(r) } });
      tr.append(el('th', { className: 'row-head', text: String(r + 1), attrs: { scope: 'row' } }));
      const fields = doc.records[r].fields;
      for (let c = 0; c < doc.columnCount; c++) {
        if (c < fields.length) {
          const td = el('td', {
            attrs: { role: 'gridcell', 'data-row': String(r), 'data-col': String(c) },
          });
          this.paintCell(tab, td, r, c);
          td.addEventListener('mousedown', () => this.select(tab, r, c));
          td.addEventListener('dblclick', () => this.openEditor(tab, r, c, null));
          td.addEventListener('contextmenu', (event) => this.onContextMenu(event, tab, r, c));
          tr.append(td);
        } else {
          tr.append(el('td', { className: 'void', attrs: { 'aria-hidden': 'true' } }));
        }
      }
      this.tbody.append(tr);
    }
    this.renderedRows = end;
    if (this.moreNote) {
      this.moreNote.textContent =
        end < doc.rowCount ? t('grid.loadMore', { shown: end, total: doc.rowCount }) : '';
    }
  }

  private maybeRenderMore(): void {
    const tab = this.state.activeTab;
    if (!tab || tab.doc !== this.lastDoc) return;
    if (this.renderedRows >= tab.doc.rowCount) return;
    const nearBottom = this.element.scrollTop + this.element.clientHeight >= this.element.scrollHeight - 600;
    if (nearBottom) {
      this.renderChunk(tab);
    }
  }

  ensureRowRendered(row: number): void {
    const tab = this.state.activeTab;
    if (!tab || tab.doc !== this.lastDoc) return;
    while (this.renderedRows <= row && this.renderedRows < tab.doc.rowCount) {
      this.renderChunk(tab);
    }
  }

  private paintCell(tab: Tab, td: HTMLTableCellElement, row: number, col: number): void {
    const doc = tab.doc;
    const value = doc.getValue(row, col);
    if (td.textContent !== value) {
      td.textContent = value;
    }
    const field = doc.getField(row, col);
    const edited = doc.isEdited(row, col);
    td.classList.toggle('edited', edited);
    td.classList.toggle('malformed', field?.malformed ?? false);
    if (edited) {
      // Safe text-only tooltip showing the original value.
      td.title = doc.getOriginalValue(row, col);
    } else if (td.title !== '') {
      td.removeAttribute('title');
    }
  }

  private updateCells(tab: Tab): void {
    if (!this.tbody) return;
    const cells = this.tbody.querySelectorAll<HTMLTableCellElement>('td[data-col]');
    for (const td of cells) {
      const row = Number(td.dataset.row);
      const col = Number(td.dataset.col);
      this.paintCell(tab, td, row, col);
    }
  }

  private updateSelectionClasses(tab: Tab): void {
    if (!this.tbody) return;
    for (const selected of this.tbody.querySelectorAll('.selected')) {
      selected.classList.remove('selected');
      selected.removeAttribute('aria-selected');
    }
    for (const row of this.tbody.querySelectorAll('.selected-row')) {
      row.classList.remove('selected-row');
    }
    const sel = tab.selection;
    if (!sel) return;
    this.ensureRowRendered(sel.row);
    const td = this.cellAt(sel.row, sel.col);
    if (td) {
      td.classList.add('selected');
      td.setAttribute('aria-selected', 'true');
      td.closest('tr')?.classList.add('selected-row');
    }
  }

  private cellAt(row: number, col: number): HTMLTableCellElement | null {
    return (
      this.tbody?.querySelector<HTMLTableCellElement>(`td[data-row="${row}"][data-col="${col}"]`) ?? null
    );
  }

  select(tab: Tab, row: number, col: number, scroll = false): void {
    this.commitEditor();
    const field = tab.doc.getField(row, col);
    if (!field) return;
    this.state.setSelection(tab, { row, col });
    if (scroll) {
      this.ensureRowRendered(row);
      this.cellAt(row, col)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /** Select a cell and scroll it into view (used by find). */
  reveal(row: number, col: number): void {
    const tab = this.state.activeTab;
    if (!tab) return;
    this.select(tab, row, col, true);
  }

  private moveSelection(tab: Tab, dRow: number, dCol: number): void {
    const sel = tab.selection ?? { row: 0, col: 0 };
    const row = Math.max(0, Math.min(tab.doc.rowCount - 1, sel.row + dRow));
    let col = sel.col + dCol;
    const fieldCount = tab.doc.records[row]?.fields.length ?? 0;
    if (col >= fieldCount) col = fieldCount - 1;
    if (col < 0) col = 0;
    this.select(tab, row, col, true);
    this.element.focus();
  }

  /**
   * Open the inline cell editor. `initial` replaces the content (typing
   * starts a fresh value, like a spreadsheet); null edits the current value.
   */
  openEditor(tab: Tab, row: number, col: number, initial: string | null): void {
    this.commitEditor();
    const field = tab.doc.getField(row, col);
    if (!field) return;
    this.select(tab, row, col, true);
    const td = this.cellAt(row, col);
    if (!td) return;
    const input = el('input', {
      className: 'cell-editor',
      attrs: { type: 'text', 'aria-label': t('formulaBar.label') },
    });
    input.value = initial !== null ? initial : tab.doc.getValue(row, col);
    this.editor = { row, col, input, cancelled: false };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        this.commitEditor();
        this.moveSelection(tab, 1, 0);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        this.commitEditor();
        this.moveSelection(tab, 0, event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        // Restore the value the cell had when editing began.
        this.closeEditor(false);
        this.element.focus();
      }
    });
    input.addEventListener('blur', () => this.commitEditor());
    td.append(input);
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
    if (!editor) return;
    this.editor = null;
    const tab = this.state.activeTab;
    const value = editor.input.value;
    editor.input.remove();
    if (tab && tab.doc === this.lastDoc) {
      this.state.editCell(tab, editor.row, editor.col, value);
    }
  }

  private closeEditor(commit: boolean): void {
    if (commit) {
      this.commitEditor();
      return;
    }
    const editor = this.editor;
    if (!editor) return;
    this.editor = null;
    editor.input.remove();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const tab = this.state.activeTab;
    if (!tab || this.editor) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveSelection(tab, 1, 0);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.moveSelection(tab, -1, 0);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveSelection(tab, 0, -1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        this.moveSelection(tab, 0, 1);
        return;
      case 'PageDown':
        event.preventDefault();
        this.moveSelection(tab, 20, 0);
        return;
      case 'PageUp':
        event.preventDefault();
        this.moveSelection(tab, -20, 0);
        return;
      case 'Home':
        event.preventDefault();
        this.moveSelection(tab, 0, -Number.MAX_SAFE_INTEGER);
        return;
      case 'End':
        event.preventDefault();
        this.moveSelection(tab, 0, Number.MAX_SAFE_INTEGER);
        return;
      case 'Enter':
        event.preventDefault();
        this.moveSelection(tab, 1, 0);
        return;
      case 'F2':
        event.preventDefault();
        if (tab.selection) this.openEditor(tab, tab.selection.row, tab.selection.col, null);
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        if (tab.selection) this.state.editCell(tab, tab.selection.row, tab.selection.col, '');
        return;
      default:
        if (event.key.length === 1 && tab.selection) {
          event.preventDefault();
          this.openEditor(tab, tab.selection.row, tab.selection.col, event.key);
        }
    }
  }

  private onContextMenu(event: MouseEvent, tab: Tab, row: number, col: number): void {
    event.preventDefault();
    this.select(tab, row, col);
    this.closeContextMenu();
    const menu = el('div', { className: 'context-menu', attrs: { role: 'menu' } });
    const revert = el('button', {
      className: 'menu-item',
      attrs: { type: 'button', role: 'menuitem' },
      text: t('menu.edit.revertCell'),
    });
    revert.disabled = !tab.doc.isEdited(row, col);
    revert.addEventListener('click', () => {
      this.closeContextMenu();
      void this.commands.run('edit.revertCell');
    });
    menu.append(revert);
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 60)}px`;
    document.body.append(menu);
    this.contextMenu = menu;
    revert.focus();
  }

  private closeContextMenu(): void {
    this.contextMenu?.remove();
    this.contextMenu = null;
  }
}
