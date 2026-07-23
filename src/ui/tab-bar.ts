// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app/app-state';
import type { CommandId, Commands } from '../app/commands';
import { t } from '../app/i18n';
import { ContextMenu, type ContextMenuEntry } from './context-menu';
import { el, clearChildren } from './dom';

/** Context-menu actions for a tab (all shared with the View menu commands). */
const TAB_MENU_ITEMS: Array<{ command: CommandId; labelKey: string }> = [
  { command: 'tab.moveFirst', labelKey: 'menu.view.moveTabFirst' },
  { command: 'tab.moveLeft', labelKey: 'menu.view.moveTabLeft' },
  { command: 'tab.moveRight', labelKey: 'menu.view.moveTabRight' },
  { command: 'tab.moveLast', labelKey: 'menu.view.moveTabLast' },
];

/**
 * Tab strip for open files with dirty indicators (●), close buttons,
 * drag-and-drop reordering (with a drop-position indicator), and a context
 * menu for keyboard/menu-driven movement. Reordering only changes the strip
 * order: each tab keeps its document, dirty state, selection, undo history,
 * file handle, and mode untouched, and the active tab stays active. Tab
 * order lives only in this session; it is never persisted.
 */
export class TabBar {
  readonly element: HTMLElement;
  /** Announces drag-reorder results to assistive technologies. */
  private readonly liveRegion: HTMLElement;
  private dragId: string | null = null;
  private contextMenu: ContextMenu | null = null;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    this.element = el('div', { className: 'tab-bar', attrs: { role: 'tablist' } });
    this.liveRegion = el('span', {
      className: 'visually-hidden',
      attrs: { 'aria-live': 'polite', role: 'status' },
    });
    this.element.append(this.liveRegion);
    this.element.addEventListener('dragend', () => this.clearDragState());
    this.render();
  }

  render(): void {
    this.closeContextMenu();
    clearChildren(this.element);
    this.element.append(this.liveRegion);
    this.element.setAttribute('aria-label', t('tabs.label'));
    for (const tab of this.state.tabs) {
      this.element.append(this.buildTab(tab));
    }
  }

  private buildTab(tab: Tab): HTMLElement {
    const active = tab.id === this.state.activeTabId;
    const dirty = tab.doc.isDirty;
    const tabEl = el(
      'div',
      {
        className: 'tab',
        attrs: {
          role: 'tab',
          draggable: 'true',
          'data-tab-id': tab.id,
          tabindex: active ? '0' : '-1',
          'aria-selected': active ? 'true' : 'false',
          title: dirty ? `${tab.name} — ${t('tab.dirty')}` : tab.name,
        },
      },
      [
        el('span', {
          className: 'dirty-mark',
          text: dirty ? '● ' : '',
          attrs: dirty ? { 'aria-label': t('tab.dirty') } : { 'aria-hidden': 'true' },
        }),
        el('span', { className: 'tab-label', text: tab.name }),
      ],
    );
    const close = el('button', {
      className: 'tab-close',
      text: '×',
      attrs: { type: 'button', 'aria-label': `${t('tab.close')}: ${tab.name}` },
    });
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.state.activateTab(tab.id);
      const target = this.state.activeTab;
      if (target) {
        void this.commands.closeTab(target);
      }
    });
    tabEl.append(close);
    tabEl.addEventListener('click', () => this.state.activateTab(tab.id));
    tabEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.state.activateTab(tab.id);
      }
    });

    // ----- Drag-and-drop reordering -----
    tabEl.addEventListener('dragstart', (event) => {
      this.dragId = tab.id;
      tabEl.classList.add('dragging');
      // dataTransfer may be absent in test environments; the drag still works
      // through the tracked dragId.
      event.dataTransfer?.setData('text/plain', tab.name);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    });
    tabEl.addEventListener('dragover', (event) => {
      if (!this.dragId || this.dragId === tab.id) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      // Indicate the drop position: before or after this tab, split at its
      // horizontal midpoint.
      const before = this.dropsBefore(event, tabEl);
      tabEl.classList.toggle('drop-before', before);
      tabEl.classList.toggle('drop-after', !before);
    });
    tabEl.addEventListener('dragleave', () => {
      tabEl.classList.remove('drop-before', 'drop-after');
    });
    tabEl.addEventListener('drop', (event) => {
      if (!this.dragId || this.dragId === tab.id) {
        return;
      }
      event.preventDefault();
      const dragged = this.dragId;
      const before = this.dropsBefore(event, tabEl);
      this.clearDragState();
      this.moveNextTo(dragged, tab.id, before);
    });

    // ----- Context menu: move commands + close -----
    tabEl.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      // The move commands act on the active tab, so activate this one first.
      this.state.activateTab(tab.id);
      this.openContextMenu(event.clientX, event.clientY);
    });
    return tabEl;
  }

  /** True when the pointer sits in the left half of the target tab. */
  private dropsBefore(event: MouseEvent, tabEl: HTMLElement): boolean {
    const rect = tabEl.getBoundingClientRect();
    return rect.width > 0 ? event.clientX < rect.left + rect.width / 2 : false;
  }

  /** Move `draggedId` immediately before/after `targetId` and announce it. */
  private moveNextTo(draggedId: string, targetId: string, before: boolean): void {
    const from = this.state.tabIndex(draggedId);
    const targetIndex = this.state.tabIndex(targetId);
    if (from < 0 || targetIndex < 0) {
      return;
    }
    let to = targetIndex + (before ? 0 : 1);
    if (from < to) {
      to -= 1; // account for the removal of the dragged tab
    }
    const tab = this.state.tabs[from];
    if (this.state.moveTab(draggedId, to)) {
      this.liveRegion.textContent = t('notify.tabMoved', {
        name: tab.name,
        pos: this.state.tabIndex(draggedId) + 1,
        total: this.state.tabs.length,
      });
    }
  }

  private clearDragState(): void {
    this.dragId = null;
    for (const tabEl of this.element.querySelectorAll('.tab')) {
      tabEl.classList.remove('dragging', 'drop-before', 'drop-after');
    }
  }

  private openContextMenu(x: number, y: number): void {
    this.closeContextMenu();
    const entries: ContextMenuEntry[] = TAB_MENU_ITEMS.map((item) => ({
      label: t(item.labelKey),
      disabled: !this.commands.isEnabled(item.command),
      onSelect: () => void this.commands.run(item.command),
    }));
    entries.push('separator', {
      label: t('tab.close'),
      onSelect: () => void this.commands.run('file.closeTab'),
    });
    this.contextMenu = ContextMenu.open(entries, x, y, { onClose: () => (this.contextMenu = null) });
  }

  private closeContextMenu(): void {
    this.contextMenu?.close();
    this.contextMenu = null;
  }
}
