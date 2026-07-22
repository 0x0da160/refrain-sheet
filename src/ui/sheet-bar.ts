// SPDX-License-Identifier: MIT
import type { AppState } from '../app/app-state';
import type { CommandId, Commands } from '../app/commands';
import { t } from '../app/i18n';
import { el, clearChildren } from './dom';

/**
 * Context-menu actions for a worksheet. Every one is also a command in the
 * shared command layer (and reachable from the Sheet menu and the keyboard),
 * so no business logic is duplicated across entry points.
 */
const SHEET_MENU_ITEMS: Array<{ command: CommandId; labelKey: string; separatorBefore?: boolean }> = [
  { command: 'worksheet.rename', labelKey: 'menu.sheet.renameSheet' },
  { command: 'worksheet.duplicate', labelKey: 'menu.sheet.duplicateSheet' },
  { command: 'worksheet.delete', labelKey: 'menu.sheet.deleteSheet' },
  { command: 'worksheet.moveFirst', labelKey: 'menu.sheet.moveSheetFirst', separatorBefore: true },
  { command: 'worksheet.moveLeft', labelKey: 'menu.sheet.moveSheetLeft' },
  { command: 'worksheet.moveRight', labelKey: 'menu.sheet.moveSheetRight' },
  { command: 'worksheet.moveLast', labelKey: 'menu.sheet.moveSheetLast' },
];

/**
 * The worksheet strip of the active RSF **workbook**, shown below the grid.
 *
 * This is deliberately a different surface from the application tab strip
 * (`TabBar`), which lists the open *files*: these tabs are the worksheets
 * *inside* the current workbook. The two are independent — reordering
 * worksheets never touches the document tabs, and vice versa — and each
 * announces itself with its own localized label so screen-reader users can
 * tell them apart.
 *
 * Every action (add, rename, duplicate, delete, reorder, switch) goes through
 * the shared command layer. Pointer drag-and-drop reordering is offered as a
 * convenience; the identical moves are always available from the context menu,
 * the Sheet menu, and the keyboard, so nothing depends on a pointer.
 *
 * A plain CSV document is a single-sheet, byte-preserving document, so the
 * strip renders one disabled, explanatory chip instead of worksheet tabs
 * rather than disappearing without a reason.
 */
export class SheetBar {
  readonly element: HTMLElement;
  /** Announces reorder / activation results to assistive technologies. */
  private readonly liveRegion: HTMLElement;
  private readonly strip: HTMLElement;
  private dragId: string | null = null;
  private contextMenu: HTMLElement | null = null;
  /**
   * Signature of what is currently rendered. Re-rendering the strip is skipped
   * unless the worksheet set, order, names, or active worksheet actually
   * changed, so unrelated document events (typing in a cell, scrolling) never
   * rebuild it — which is what keeps a workbook with many worksheets cheap.
   */
  private renderedKey = '';

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    this.element = el('div', { className: 'sheet-bar' });
    this.liveRegion = el('span', {
      className: 'visually-hidden',
      attrs: { 'aria-live': 'polite', role: 'status' },
    });
    this.strip = el('div', { className: 'sheet-strip', attrs: { role: 'tablist' } });
    this.element.append(this.liveRegion, this.strip);
    this.element.addEventListener('dragend', () => this.clearDragState());
    document.addEventListener('mousedown', (event) => {
      if (this.contextMenu && !this.contextMenu.contains(event.target as Node)) {
        this.closeContextMenu();
      }
    });
    this.render();
  }

  /** Rebuild the strip when (and only when) its content actually changed. */
  render(force = false): void {
    const tab = this.state.activeTab;
    const doc = tab?.doc ?? null;
    if (!tab || !doc) {
      this.element.hidden = true;
      this.renderedKey = '';
      return;
    }
    this.element.hidden = false;
    const key =
      doc.kind === 'rsf'
        ? `rsf|${doc.activeSheetId}|${doc.sheets.map((s) => `${s.id}:${s.name}`).join('')}`
        : 'csv';
    if (!force && key === this.renderedKey) {
      return;
    }
    this.renderedKey = key;
    this.closeContextMenu();
    clearChildren(this.strip);
    this.strip.setAttribute('aria-label', t('sheets.label'));

    if (doc.kind !== 'rsf') {
      // Plain CSV: one disabled chip explaining that worksheets need RSF.
      this.strip.removeAttribute('role');
      this.strip.append(
        el('span', {
          className: 'sheet-note',
          text: t('sheets.csvOnly'),
          attrs: { title: t('sheets.csvOnlyTitle') },
        }),
      );
      return;
    }
    this.strip.setAttribute('role', 'tablist');
    for (const sheet of doc.sheets) {
      this.strip.append(this.buildSheetTab(sheet.id, sheet.name, sheet.id === doc.activeSheetId));
    }
    const add = el('button', {
      className: 'sheet-add',
      text: '+',
      attrs: { type: 'button', 'aria-label': t('sheets.add'), title: t('sheets.add') },
    });
    add.disabled = !this.commands.isEnabled('worksheet.add');
    add.addEventListener('click', () => void this.commands.run('worksheet.add'));
    this.strip.append(add);
    // Keep the active worksheet visible when the strip scrolls horizontally.
    // Guarded because scrollIntoView is not implemented in every environment.
    const activeTab = this.strip.querySelector<HTMLElement>('.sheet-tab[aria-selected="true"]');
    if (activeTab && typeof activeTab.scrollIntoView === 'function') {
      activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  private buildSheetTab(id: string, name: string, active: boolean): HTMLElement {
    const tabEl = el(
      'div',
      {
        className: `sheet-tab${active ? ' active' : ''}`,
        attrs: {
          role: 'tab',
          draggable: 'true',
          'data-sheet-id': id,
          tabindex: active ? '0' : '-1',
          'aria-selected': active ? 'true' : 'false',
          title: name,
        },
      },
      [el('span', { className: 'sheet-label', text: name })],
    );
    tabEl.addEventListener('click', () => this.activate(id));
    tabEl.addEventListener('dblclick', () => {
      this.activate(id);
      void this.commands.run('worksheet.rename');
    });
    tabEl.addEventListener('keydown', (event) => this.onKeyDown(event, id));
    tabEl.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      // The worksheet commands act on the active worksheet, so activate first.
      this.activate(id);
      this.openContextMenu(event.clientX, event.clientY);
    });

    // ----- Pointer drag-and-drop reordering (keyboard equivalents always exist) -----
    tabEl.addEventListener('dragstart', (event) => {
      this.dragId = id;
      tabEl.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', name);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    });
    tabEl.addEventListener('dragover', (event) => {
      if (!this.dragId || this.dragId === id) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      const before = this.dropsBefore(event, tabEl);
      tabEl.classList.toggle('drop-before', before);
      tabEl.classList.toggle('drop-after', !before);
    });
    tabEl.addEventListener('dragleave', () => {
      tabEl.classList.remove('drop-before', 'drop-after');
    });
    tabEl.addEventListener('drop', (event) => {
      if (!this.dragId || this.dragId === id) {
        return;
      }
      event.preventDefault();
      const dragged = this.dragId;
      const before = this.dropsBefore(event, tabEl);
      this.clearDragState();
      this.moveNextTo(dragged, id, before);
    });
    return tabEl;
  }

  /**
   * Roving-tabindex keyboard model: arrows move between worksheets (and
   * activate), Home/End jump to the ends, F2 renames, and Alt+arrows reorder —
   * a complete pointer-free equivalent of the drag-and-drop above.
   */
  private onKeyDown(event: KeyboardEvent, id: string): void {
    const doc = this.state.activeWorkbook();
    if (!doc) {
      return;
    }
    const index = doc.sheetIndex(id);
    const last = doc.sheetCount - 1;
    const go = (target: number): void => {
      event.preventDefault();
      const next = doc.sheets[Math.max(0, Math.min(last, target))];
      if (next) {
        this.activate(next.id);
        this.focusActive();
      }
    };
    if (event.altKey) {
      // Alt + arrow / Home / End reorders without a pointer.
      const command: CommandId | null =
        event.key === 'ArrowLeft'
          ? 'worksheet.moveLeft'
          : event.key === 'ArrowRight'
            ? 'worksheet.moveRight'
            : event.key === 'Home'
              ? 'worksheet.moveFirst'
              : event.key === 'End'
                ? 'worksheet.moveLast'
                : null;
      if (command) {
        event.preventDefault();
        void this.commands.run(command).then(() => this.focusActive());
      }
      return;
    }
    switch (event.key) {
      case 'ArrowLeft':
        go(index - 1);
        return;
      case 'ArrowRight':
        go(index + 1);
        return;
      case 'Home':
        go(0);
        return;
      case 'End':
        go(last);
        return;
      case 'F2':
        event.preventDefault();
        void this.commands.run('worksheet.rename');
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.activate(id);
        return;
      default:
        return;
    }
  }

  /** Activate a worksheet and announce the switch. */
  private activate(id: string): void {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    const doc = this.state.activeWorkbook();
    if (this.state.setActiveSheet(tab, id) && doc) {
      this.liveRegion.textContent = t('notify.sheetActivated', {
        name: doc.activeSheet.name,
        pos: doc.sheetIndex(id) + 1,
        total: doc.sheetCount,
      });
    }
  }

  /** Return keyboard focus to the active worksheet tab after an action. */
  focusActive(): void {
    this.strip.querySelector<HTMLElement>('.sheet-tab[aria-selected="true"]')?.focus();
  }

  /** True when the pointer sits in the left half of the target tab. */
  private dropsBefore(event: MouseEvent, tabEl: HTMLElement): boolean {
    const rect = tabEl.getBoundingClientRect();
    return rect.width > 0 ? event.clientX < rect.left + rect.width / 2 : false;
  }

  /** Move `draggedId` immediately before/after `targetId` and announce it. */
  private moveNextTo(draggedId: string, targetId: string, before: boolean): void {
    const tab = this.state.activeTab;
    const doc = this.state.activeWorkbook();
    if (!tab || !doc) {
      return;
    }
    const from = doc.sheetIndex(draggedId);
    const targetIndex = doc.sheetIndex(targetId);
    if (from < 0 || targetIndex < 0) {
      return;
    }
    let to = targetIndex + (before ? 0 : 1);
    if (from < to) {
      to -= 1; // account for the removal of the dragged worksheet
    }
    const name = doc.sheetById(draggedId)?.name ?? '';
    if (this.state.moveSheet(tab, draggedId, to)) {
      this.liveRegion.textContent = t('notify.sheetMoved', {
        name,
        pos: doc.sheetIndex(draggedId) + 1,
        total: doc.sheetCount,
      });
    }
  }

  private clearDragState(): void {
    this.dragId = null;
    for (const tabEl of this.strip.querySelectorAll('.sheet-tab')) {
      tabEl.classList.remove('dragging', 'drop-before', 'drop-after');
    }
  }

  private openContextMenu(x: number, y: number): void {
    this.closeContextMenu();
    const menu = el('div', { className: 'context-menu', attrs: { role: 'menu' } });
    const addItem = el('button', {
      className: 'menu-item',
      attrs: { type: 'button', role: 'menuitem' },
      text: t('menu.sheet.addSheet'),
    });
    addItem.disabled = !this.commands.isEnabled('worksheet.add');
    addItem.addEventListener('click', () => {
      this.closeContextMenu();
      void this.commands.run('worksheet.add');
    });
    menu.append(addItem);
    for (const item of SHEET_MENU_ITEMS) {
      if (item.separatorBefore) {
        menu.append(el('hr', { className: 'menu-separator' }));
      }
      const button = el('button', {
        className: 'menu-item',
        attrs: { type: 'button', role: 'menuitem' },
        text: t(item.labelKey),
      });
      button.disabled = !this.commands.isEnabled(item.command);
      button.addEventListener('click', () => {
        this.closeContextMenu();
        void this.commands.run(item.command).then(() => this.focusActive());
      });
      menu.append(button);
    }
    menu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 260)}px`;
    document.body.append(menu);
    this.contextMenu = menu;
  }

  private closeContextMenu(): void {
    this.contextMenu?.remove();
    this.contextMenu = null;
  }
}
