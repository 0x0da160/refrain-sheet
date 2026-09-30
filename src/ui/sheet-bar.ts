// SPDX-License-Identifier: MIT
import { isWorkbook } from '../core/editor-document';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus2,
  FileJson,
  FileText,
  FileType,
  Folder,
  FolderPlus,
  Lock,
  LockOpen,
  Plus,
  Grid3x3,
  Table,
  type IconNode,
} from 'lucide';
import type { AppState } from '../app/state';
import type { CommandId, Commands } from '../app/commands';
import type { RsfDocument } from '../core/workbook/rsf-document';
import {
  buildSheetTree,
  folderPath,
  type SheetFolder,
  type SheetTreeNode,
} from '../core/workbook/sheet-folders';
import { t } from '../app/i18n';
import { sheetKindOf, type NewSheetKind } from '../core/workbook/grid-paper';
import { ICON_BY_COMMAND } from './command-icons';
import { ContextMenu, type ContextMenuEntry } from './context-menu';
import { el, clearChildren } from './dom';
import { createIcon } from './icon';
import { editNameInPlace } from './sheet-name-field';
import { buildSheetListResizer } from './sheet-list-resizer';

/**
 * Context-menu actions for a worksheet. Every one is also a command in the
 * shared command layer (and reachable from the Sheet menu and the keyboard),
 * so no business logic is duplicated across entry points.
 */
/** Localized kind label per worksheet kind, shown as the tab's icon tooltip. */
const SHEET_KIND_LABEL_KEY: Record<NewSheetKind, string> = {
  grid: 'sheets.kind.grid',
  paper: 'sheets.kind.paper',
  markdown: 'sheets.kind.markdown',
  json: 'sheets.kind.json',
  yaml: 'sheets.kind.yaml',
  text: 'sheets.kind.text',
};

/** Tab icon per worksheet kind. */
const SHEET_KIND_ICON: Record<NewSheetKind, IconNode> = {
  grid: Table,
  paper: Grid3x3,
  markdown: FileText,
  json: FileJson,
  yaml: FileCode,
  text: FileType,
};

/** Two clicks on one tab or folder this close together (ms) are a double-click. */
const DOUBLE_CLICK_MS = 500;

type SheetMenuDef =
  | { command: CommandId; labelKey: string }
  | { labelKey: string; icon: IconNode; submenu: SheetMenuDef[] }
  | 'separator';

/** A worksheet tab's right-click menu: the commands, grouped the way Sheet > Manage Sheets is. */
const SHEET_MENU_ITEMS: SheetMenuDef[] = [
  {
    labelKey: 'menu.sheet.newSheet',
    icon: FilePlus2,
    submenu: [
      { command: 'worksheet.add', labelKey: 'menu.sheet.addSheet' },
      { command: 'worksheet.addPaper', labelKey: 'menu.sheet.addPaperSheet' },
      { command: 'worksheet.addMarkdown', labelKey: 'menu.sheet.addMarkdownSheet' },
      { command: 'worksheet.addJson', labelKey: 'menu.sheet.addJsonSheet' },
      { command: 'worksheet.addYaml', labelKey: 'menu.sheet.addYamlSheet' },
      { command: 'worksheet.addText', labelKey: 'menu.sheet.addTextSheet' },
      'separator',
      { command: 'worksheet.addFromCsv', labelKey: 'menu.sheet.addCsvSheet' },
    ],
  },
  'separator',
  { command: 'worksheet.rename', labelKey: 'menu.sheet.renameSheet' },
  { command: 'worksheet.tabColor', labelKey: 'menu.sheet.tabColor' },
  { command: 'worksheet.duplicate', labelKey: 'menu.sheet.duplicateSheet' },
  { command: 'sheet.exportSheetText', labelKey: 'menu.sheet.exportSheetText' },
  { command: 'worksheet.delete', labelKey: 'menu.sheet.deleteSheet' },
  {
    labelKey: 'menu.sheet.folders',
    icon: Folder,
    submenu: [
      { command: 'worksheet.newFolder', labelKey: 'menu.sheet.newFolder' },
      { command: 'worksheet.moveToFolder', labelKey: 'menu.sheet.moveToFolder' },
    ],
  },
  'separator',
  { command: 'worksheet.toggleLock', labelKey: 'menu.sheet.lockSheet' },
  {
    labelKey: 'menu.sheet.moveSheet',
    icon: ArrowLeftRight,
    submenu: [
      { command: 'worksheet.moveFirst', labelKey: 'menu.sheet.moveSheetFirst' },
      { command: 'worksheet.moveLeft', labelKey: 'menu.sheet.moveSheetLeft' },
      { command: 'worksheet.moveRight', labelKey: 'menu.sheet.moveSheetRight' },
      { command: 'worksheet.moveLast', labelKey: 'menu.sheet.moveSheetLast' },
    ],
  },
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
 * strip is hidden for it — there is nothing to switch between.
 */
export class SheetBar {
  readonly element: HTMLElement;
  /** Announces reorder / activation results to assistive technologies. */
  private readonly liveRegion: HTMLElement;
  private readonly strip: HTMLElement;
  private dragId: string | null = null;
  private contextMenu: ContextMenu | null = null;
  /**
   * Signature of what is currently rendered. Re-rendering the strip is skipped
   * unless the worksheet set, order, names, or active worksheet actually
   * changed, so unrelated document events (typing in a cell, scrolling) never
   * rebuild it — which is what keeps a workbook with many worksheets cheap.
   */
  private renderedKey = '';
  /** Folders shown closed, per workbook. Session-only: not saved in the file. */
  private readonly collapsed = new WeakMap<RsfDocument, Set<string>>();
  /** A tab's or folder's name is being typed on it; the strip waits until that ends. */
  private renaming = false;
  /**
   * The last click on a tab or folder. A click redraws the strip (it
   * activates a sheet or opens a folder), so the browser's own dblclick
   * never arrives: a second click here soon after is the double-click.
   */
  private lastClick: { key: string; at: number } | null = null;
  /** The edge that sets the width of the sheet list down the left side. */
  private readonly resizer: HTMLElement;

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
    this.resizer = buildSheetListResizer(this.element);
    this.element.append(this.liveRegion, this.strip, this.resizer);
    this.element.addEventListener('dragend', () => this.clearDragState());
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
    // A plain CSV document is a single sheet: there is nothing to list, so the
    // whole row goes away instead of leaving an empty band under the grid.
    this.element.hidden = !isWorkbook(doc);
    const key = isWorkbook(doc)
      ? `rsf|${doc.activeSheetId}|${doc.sheets.map((s) => `${s.id}:${s.name}:${s.locked ? 1 : 0}:${s.tabColor ?? ''}:${s.folderId ?? ''}`).join('')}|${JSON.stringify(doc.folders)}|${[...this.closedFolders(doc)].join()}`
      : 'csv';
    if ((!force && key === this.renderedKey) || (this.renaming && !force)) {
      return;
    }
    this.renaming = false;
    this.renderedKey = key;
    this.closeContextMenu();
    clearChildren(this.strip);
    this.strip.setAttribute('aria-label', t('sheets.label'));

    if (!isWorkbook(doc)) {
      // Plain CSV: no worksheet tabs (it is a single-sheet document) — nothing
      // else to render here.
      this.strip.removeAttribute('role');
      return;
    }
    this.strip.setAttribute('role', 'tablist');
    this.strip.setAttribute('aria-orientation', this.isVertical() ? 'vertical' : 'horizontal');
    const tree = buildSheetTree(
      doc.sheets.map((sheet) => sheet.id),
      (id) => doc.sheetById(id)?.folderId,
      doc.folders,
    );
    this.appendNodes(this.strip, doc, tree);
    const add = el(
      'button',
      {
        className: 'sheet-add',
        attrs: { type: 'button', 'aria-label': t('sheets.add'), title: t('sheets.add') },
      },
      [createIcon(Plus, 'sheet-add-icon', 14)],
    );
    add.disabled = !this.commands.isEnabled('worksheet.add');
    add.addEventListener('click', () => void this.commands.run('worksheet.add'));
    const folder = el(
      'button',
      {
        className: 'sheet-add sheet-add-folder',
        attrs: { type: 'button', 'aria-label': t('sheets.newFolder'), title: t('sheets.newFolder') },
      },
      [createIcon(FolderPlus, 'sheet-add-icon', 14)],
    );
    folder.disabled = !this.commands.isEnabled('worksheet.newFolder');
    folder.addEventListener('click', () => void this.commands.run('worksheet.newFolder'));
    this.strip.append(el('div', { className: 'sheet-add-buttons', attrs: { role: 'none' } }, [add, folder]));
    this.resizer.setAttribute('aria-label', t('sheets.resize'));
    this.resizer.title = t('sheets.resize');
    // Keep the active worksheet visible when the strip scrolls horizontally.
    // Guarded because scrollIntoView is not implemented in every environment.
    const activeTab = this.strip.querySelector<HTMLElement>('.sheet-tab[aria-selected="true"]');
    if (activeTab && typeof activeTab.scrollIntoView === 'function') {
      activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /** The folders shown closed in `doc` (created on first use). */
  private closedFolders(doc: RsfDocument): Set<string> {
    let closed = this.collapsed.get(doc);
    if (!closed) {
      closed = new Set();
      this.collapsed.set(doc, closed);
    }
    return closed;
  }

  /**
   * Render tree items: a worksheet as its tab, a folder as a group of a
   * header and its items. A closed folder still shows the active worksheet,
   * so the tab being edited never disappears.
   */
  private appendNodes(parent: HTMLElement, doc: RsfDocument, nodes: readonly SheetTreeNode[]): void {
    for (const node of nodes) {
      if (node.kind === 'sheet') {
        const sheet = doc.sheetById(node.id);
        if (sheet) {
          parent.append(
            this.buildSheetTab(
              sheet.id,
              sheet.name,
              sheetKindOf(sheet),
              sheet.locked,
              sheet.tabColor,
              sheet.id === doc.activeSheetId,
            ),
          );
        }
        continue;
      }
      const open = !this.closedFolders(doc).has(node.folder.id);
      const items = el('div', { className: 'sheet-folder-items', attrs: { role: 'none' } });
      if (open) {
        this.appendNodes(items, doc, node.children);
      } else if (folderPath(doc.folders, doc.activeSheet.folderId).includes(node.folder)) {
        this.appendNodes(items, doc, [{ kind: 'sheet', id: doc.activeSheetId }]);
      }
      parent.append(
        el('div', { className: `sheet-folder${open ? '' : ' closed'}`, attrs: { role: 'none' } }, [
          this.buildFolderHeader(doc, node.folder, open),
          items,
        ]),
      );
    }
  }

  /** A folder's header: click opens or closes it, a worksheet dropped on it moves in. */
  private buildFolderHeader(doc: RsfDocument, folder: SheetFolder, open: boolean): HTMLElement {
    const header = el(
      'button',
      {
        className: 'sheet-folder-header',
        attrs: {
          type: 'button',
          'data-folder-id': folder.id,
          'aria-expanded': open ? 'true' : 'false',
          title: t(open ? 'sheets.folder.close' : 'sheets.folder.open', { name: folder.name }),
        },
      },
      [
        createIcon(open ? ChevronDown : ChevronRight, 'sheet-folder-chevron', 12),
        createIcon(Folder, 'sheet-folder-icon', 14),
        el('span', { className: 'sheet-label', text: folder.name }),
      ],
    );
    const toggle = (): void => {
      const closed = this.closedFolders(doc);
      if (!closed.delete(folder.id)) {
        closed.add(folder.id);
      }
      this.render(true);
    };
    header.addEventListener('click', (event) => {
      // Each click opens or closes the folder, so a double-click (typing a
      // new name on it) leaves it as it was.
      toggle();
      if (this.secondClick(`folder:${folder.id}`, event)) {
        this.renameFolderInPlace(folder.id);
      } else {
        this.folderHeader(folder.id)?.focus();
      }
    });
    header.addEventListener('keydown', (event) => {
      if (event.key === 'F2') {
        event.preventDefault();
        this.renameFolderInPlace(folder.id);
      }
    });
    header.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.openFolderMenu(folder.id, event.clientX, event.clientY);
    });
    header.addEventListener('dragover', (event) => {
      if (!this.dragId) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      header.classList.add('drop-into');
    });
    header.addEventListener('dragleave', () => header.classList.remove('drop-into'));
    header.addEventListener('drop', (event) => {
      if (!this.dragId) {
        return;
      }
      event.preventDefault();
      const dragged = this.dragId;
      this.clearDragState();
      // Deferred for the same reason as a drop on a tab (see buildSheetTab).
      queueMicrotask(() => {
        if (this.commands.dropSheetOnFolder(dragged, folder.id)) {
          this.liveRegion.textContent = t('notify.sheetMovedToFolder', {
            name: doc.sheetById(dragged)?.name ?? '',
            folder: folder.name,
          });
        }
      });
    });
    return header;
  }

  private openFolderMenu(folderId: string, x: number, y: number): void {
    this.closeContextMenu();
    const run = (action: 'rename' | 'move' | 'ungroup' | 'delete') => () =>
      void this.commands.folderAction(action, folderId);
    const entries: ContextMenuEntry[] = [
      { label: t('menu.sheet.renameFolder'), onSelect: run('rename') },
      { label: t('menu.sheet.moveFolder'), onSelect: run('move') },
      { label: t('menu.sheet.ungroupFolder'), onSelect: run('ungroup') },
      'separator',
      { label: t('menu.sheet.deleteFolder'), onSelect: run('delete') },
    ];
    this.contextMenu = ContextMenu.open(entries, x, y, { onClose: () => (this.contextMenu = null) });
  }

  private buildSheetTab(
    id: string,
    name: string,
    kind: NewSheetKind,
    locked: boolean,
    tabColor: string | undefined,
    active: boolean,
  ): HTMLElement {
    const kindLabel = t(SHEET_KIND_LABEL_KEY[kind]);
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
          title: t('sheets.tabTitle', { name }),
        },
      },
      [
        el('span', { className: 'sheet-kind', attrs: { 'aria-label': kindLabel } }, [
          createIcon(SHEET_KIND_ICON[kind], 'sheet-kind-icon', 14),
        ]),
        ...(locked
          ? [
              el('span', { className: 'sheet-lock', attrs: { 'aria-label': t('sheets.locked') } }, [
                createIcon(Lock, 'sheet-lock-icon', 12),
              ]),
            ]
          : []),
        el('span', { className: 'sheet-label', text: name }),
      ],
    );
    if (tabColor !== undefined) {
      // A document color (drawn the same in every theme), shown as a bar
      // along the tab's edge so the name stays on the theme's own colors.
      tabEl.classList.add('has-color');
      tabEl.style.setProperty('--sheet-tab-color', tabColor);
    }
    tabEl.addEventListener('click', (event) => {
      this.activate(id);
      // A double-click types a new name on the tab.
      if (this.secondClick(`sheet:${id}`, event)) {
        this.renameSheetInPlace(id);
      }
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
      // Deferred a tick: `moveNextTo` triggers a `sheets`/`doc` state event,
      // which rebuilds this whole strip (`render()`'s `clearChildren`) and
      // detaches the very node the browser registered as this drag's source.
      // Doing that synchronously, while the native drag-and-drop session is
      // still live, leaves the browser holding a drag it can never finish
      // tearing down (its `dragend` never reaches a detached node) — observed
      // as the pointer becoming unresponsive until Escape is pressed.
      // Applying the move after the current task lets the browser finish its
      // own drop/dragend handling first.
      queueMicrotask(() => this.moveNextTo(dragged, id, before));
    });
    tabEl.addEventListener('dragend', () => this.clearDragState());
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
    // The tabs as shown: in folder order, without those in closed folders.
    const visible = Array.from(
      this.strip.querySelectorAll<HTMLElement>('.sheet-tab'),
      (tab) => tab.dataset.sheetId!,
    );
    const index = visible.indexOf(id);
    const last = visible.length - 1;
    const go = (target: number): void => {
      event.preventDefault();
      const next = visible[Math.max(0, Math.min(last, target))];
      if (next) {
        this.activate(next);
        this.focusActive();
      }
    };
    // Up/Down mirror Left/Right, so the strip works the same whether it is a
    // row under the grid or a column beside it (View > Sheet Tabs on the Left).
    if (event.altKey) {
      // Alt + arrow / Home / End reorders without a pointer.
      const command: CommandId | null =
        event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? 'worksheet.moveLeft'
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
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
      case 'ArrowUp':
        go(index - 1);
        return;
      case 'ArrowRight':
      case 'ArrowDown':
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
        this.renameSheetInPlace(id);
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

  /** Whether this click on `key` follows another click on it closely enough to make a double-click. */
  private secondClick(key: string, event: MouseEvent): boolean {
    const last = this.lastClick;
    const now = event.timeStamp;
    const second = last !== null && last.key === key && now - last.at <= DOUBLE_CLICK_MS;
    this.lastClick = second ? null : { key, at: now };
    return second;
  }

  private folderHeader(folderId: string): HTMLElement | null {
    return this.strip.querySelector<HTMLElement>(
      `.sheet-folder-header[data-folder-id="${CSS.escape(folderId)}"]`,
    );
  }

  // ----- Typing a new name on a tab or folder -----

  /** Type worksheet `id`'s new name on its tab. */
  private renameSheetInPlace(id: string): void {
    const tabEl = this.strip.querySelector<HTMLElement>(`.sheet-tab[data-sheet-id="${CSS.escape(id)}"]`);
    const label = tabEl?.querySelector<HTMLElement>('.sheet-label');
    const name = this.state.activeWorkbook()?.sheetById(id)?.name;
    if (!tabEl || !label || name === undefined || !this.commands.isEnabled('worksheet.rename')) {
      return;
    }
    tabEl.draggable = false;
    this.editName(
      label,
      name,
      t('sheets.nameField'),
      (next) => this.commands.renameSheetTo(id, next),
      () => this.focusActive(),
    );
  }

  /** Type folder `folderId`'s new name on its header. */
  private renameFolderInPlace(folderId: string): void {
    const header = this.folderHeader(folderId);
    const name = this.state.activeWorkbook()?.folders.find((f) => f.id === folderId)?.name;
    if (!header || name === undefined || !this.commands.isEnabled('worksheet.rename')) {
      return;
    }
    // A text field cannot sit inside the header's button: it takes the button's place while typing.
    const row = el('div', { className: 'sheet-folder-header editing', attrs: { role: 'none' } }, [
      createIcon(Folder, 'sheet-folder-icon', 14),
      el('span', { className: 'sheet-label' }),
    ]);
    header.replaceWith(row);
    this.editName(
      row.querySelector<HTMLElement>('.sheet-label')!,
      name,
      t('sheets.folder.nameField'),
      (next) => this.commands.renameFolderTo(folderId, next),
      () => this.folderHeader(folderId)?.focus(),
    );
  }

  /** Type a new name in place of `label`'s content (see `editNameInPlace`); the strip waits meanwhile. */
  private editName(
    label: HTMLElement,
    name: string,
    fieldLabel: string,
    rename: (next: string) => string | null,
    refocus: () => void,
  ): void {
    this.renaming = true;
    editNameInPlace(label, {
      name,
      label: fieldLabel,
      rename,
      announce: (message) => (this.liveRegion.textContent = message),
      done: () => {
        this.render(true);
        refocus();
      },
    });
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

  /** True when the pointer sits in the left half (top half, in a vertical
   * strip) of the target tab. */
  private dropsBefore(event: MouseEvent, tabEl: HTMLElement): boolean {
    const rect = tabEl.getBoundingClientRect();
    if (this.isVertical()) {
      return rect.height > 0 ? event.clientY < rect.top + rect.height / 2 : false;
    }
    return rect.width > 0 ? event.clientX < rect.left + rect.width / 2 : false;
  }

  /** Whether the strip is laid out as a column. Read from the layout rather
   * than the setting, because a narrow window keeps the row either way. */
  private isVertical(): boolean {
    return getComputedStyle(this.strip).flexDirection === 'column';
  }

  /** Move `draggedId` immediately before/after `targetId` and announce it. */
  private moveNextTo(draggedId: string, targetId: string, before: boolean): void {
    const tab = this.state.activeTab;
    const doc = this.state.activeWorkbook();
    if (!tab || !doc) {
      return;
    }
    const name = doc.sheetById(draggedId)?.name ?? '';
    // Dropping next to a worksheet also puts it in that worksheet's folder.
    if (this.state.folders.placeSheet(tab, draggedId, targetId, before)) {
      this.liveRegion.textContent = t('notify.sheetMoved', {
        name,
        pos: doc.sheetIndex(draggedId) + 1,
        total: doc.sheetCount,
      });
    }
  }

  private clearDragState(): void {
    this.dragId = null;
    for (const tabEl of this.strip.querySelectorAll('.sheet-tab, .sheet-folder-header')) {
      tabEl.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-into');
    }
  }

  private openContextMenu(x: number, y: number): void {
    this.closeContextMenu();
    const locked = this.state.activeWorkbook()?.activeSheet?.locked === true;
    const toEntry = (item: SheetMenuDef): ContextMenuEntry => {
      if (item === 'separator') {
        return item;
      }
      if ('submenu' in item) {
        return { label: t(item.labelKey), icon: item.icon, submenu: item.submenu.map(toEntry) };
      }
      const isLockItem = item.command === 'worksheet.toggleLock';
      return {
        // The lock item's label itself says Lock/Unlock (not just its
        // checkmark), and carries a matching icon — a checkable item's
        // checkmark and icon share one column, so `icon` here is only ever
        // seen if this stops being checkable.
        label: isLockItem ? t(locked ? 'menu.sheet.unlockSheet' : 'menu.sheet.lockSheet') : t(item.labelKey),
        icon: isLockItem ? (locked ? LockOpen : Lock) : ICON_BY_COMMAND[item.command],
        disabled: !this.commands.isEnabled(item.command),
        ...(isLockItem ? { checked: locked } : {}),
        onSelect: () => void this.commands.run(item.command).then(() => this.focusActive()),
      };
    };
    const entries = SHEET_MENU_ITEMS.map(toEntry);
    this.contextMenu = ContextMenu.open(entries, x, y, { onClose: () => (this.contextMenu = null) });
  }

  private closeContextMenu(): void {
    this.contextMenu?.close();
    this.contextMenu = null;
  }
}
