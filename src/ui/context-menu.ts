// SPDX-License-Identifier: MIT
/**
 * The one context-menu surface used by every right-click menu in the
 * application (grid cells/headers, the document tab strip, the worksheet
 * strip). Callers describe *what* the menu contains; this owns *how* it
 * behaves — placement, keyboard navigation, ARIA semantics, dismissal, and
 * lifetime — so all three menus behave identically and can never drift apart.
 *
 * Placement goes through {@link positionPopup}: the menu is measured after it
 * is mounted and then flipped or clamped into the *visual* viewport, so it
 * stays fully visible near any edge, when the page is scrolled, at any browser
 * zoom or device pixel ratio, and in a narrow viewport. A menu taller than the
 * viewport becomes scrollable rather than overflowing, and keyboard navigation
 * scrolls the focused item into view. Nested submenus open beside their parent
 * item and mirror to the other side when they would overflow.
 *
 * Dismissal is deliberately eager: Escape, an outside pointer interaction, a
 * focus leak, window resize/scroll, and any application-level change of
 * document, worksheet, or busy state all close the menu (see
 * {@link closeAllContextMenus}) — a menu can therefore never act on state that
 * has moved on beneath it.
 */
import { Check } from 'lucide';
import type { IconNode } from 'lucide';
import { el } from './dom';
import { createIcon } from './icon';
import { positionPopup, type AnchorRect } from './popup';

export interface ContextMenuItem {
  /** Already-localized label text (rendered via textContent, never as HTML). */
  label: string;
  /** Same shortcut string shown for this command in the menu bar, if any. */
  shortcut?: string;
  disabled?: boolean;
  /**
   * When set (not `undefined`), renders as a checkable item
   * (`role="menuitemcheckbox"`, `aria-checked`) with a checkmark in place of
   * `icon` when true — the same model `MenuBar`'s own items use, so a
   * command's checked state (e.g. a worksheet's lock) shows identically in
   * both surfaces. Omit entirely for a plain, non-checkable item.
   */
  checked?: boolean;
  /**
   * A decorative leading icon, shown in the same reserved column as the
   * checkmark above (mutually exclusive with it, never both). Ignored for a
   * submenu-parent entry, which uses its own arrow glyph instead.
   */
  icon?: IconNode;
  /** Invoked after the menu closes. Omitted for a pure submenu parent. */
  onSelect?: () => void;
  /** Nested items; renders this entry as a submenu parent. */
  submenu?: ContextMenuEntry[];
}

export type ContextMenuEntry = ContextMenuItem | 'separator';

/**
 * A single icon button in the optional toolbar row (see {@link ContextMenuOptions.toolbar}).
 * Used for quick-access actions — e.g. Bold/Italic/Underline/colors/Borders on
 * the grid's right-click menu (#240) — that read better as a compact row of
 * icon buttons than as more text entries in the list below them.
 */
export interface ContextMenuToolbarItem {
  /**
   * Either a short glyph rendered via textContent (never HTML or an icon
   * font) — used for the letter-styled Bold/Italic/Underline/text-color
   * buttons — or a Lucide `IconNode`, rendered as an inline SVG the same way
   * as every other icon in the app (see {@link createIcon}), used where a
   * single character can't distinguish the action (#294).
   */
  icon: string | IconNode;
  /** Already-localized accessible name, also used as the tooltip. */
  label: string;
  /** Extra class for glyph-specific presentation (e.g. bold weight). */
  className?: string;
  /** Renders as a pressed toggle button when set; omitted for a plain action. */
  checked?: boolean;
  disabled?: boolean;
  /** Tooltip shown instead of `label` while disabled, when the reason isn't obvious. */
  disabledReason?: string | null;
  /** Invoked after the menu closes. */
  onSelect: () => void;
}

export interface ContextMenuOptions {
  /** Called after the menu closes, for whatever reason. */
  onClose?: () => void;
  /**
   * An optional row of icon buttons rendered above the item list (and above a
   * separator, when the list is non-empty). Never shown on a submenu — only
   * the top-level menu.
   */
  toolbar?: ContextMenuToolbarItem[];
}

/** Every open context menu, so application events can dismiss them all. */
const openMenus = new Set<ContextMenu>();

/**
 * Close every open context menu. Called when the active document, worksheet,
 * or dirty/busy state changes, and before a long operation starts — a menu
 * built against the previous state must never survive into the new one.
 */
export function closeAllContextMenus(): void {
  for (const menu of [...openMenus]) {
    menu.close();
  }
}

export class ContextMenu {
  readonly element: HTMLElement;
  private submenu: { parent: HTMLElement; element: HTMLElement } | null = null;
  private readonly restoreFocus: HTMLElement | null;
  private closed = false;
  private readonly onClose: (() => void) | undefined;
  private readonly listeners: Array<() => void> = [];
  /** Most recent pointer position, tracked so a submenu-closing hover check
   * can tell whether the pointer is still heading toward the open submenu
   * (see {@link onSiblingHover}). */
  private lastPointer: Point | null = null;

  private constructor(
    entries: ContextMenuEntry[],
    private readonly placementX: number,
    private readonly placementY: number,
    options: ContextMenuOptions,
  ) {
    this.onClose = options.onClose;
    const active = document.activeElement;
    this.restoreFocus = active instanceof HTMLElement ? active : null;
    this.element = this.buildList(entries, options.toolbar);
    document.body.append(this.element);
    this.reposition();

    // Dismissal. `mousedown`/`touchstart` in the capture phase catch an outside
    // interaction before it can act on whatever is underneath the menu.
    const onPointerDown = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && (this.element.contains(target) || this.submenu?.element.contains(target))) {
        return;
      }
      this.close();
    };
    const onResize = (): void => this.reposition();
    // Scrolling moves the anchor out from under the menu: closing is the only
    // honest outcome (a menu re-anchored mid-scroll would point at a different
    // cell). The menu's own scrolling never reaches here — it does not bubble
    // to the window in the capture phase from a different subtree.
    const onScroll = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && (this.element.contains(target) || this.submenu?.element.contains(target))) {
        return;
      }
      this.close();
    };
    this.on(document, 'mousedown', onPointerDown, true);
    this.on(document, 'touchstart', onPointerDown, true);
    this.on(document, 'scroll', onScroll, true);
    // Tracked for the triangle safe-zone test in `onSiblingHover`: it needs
    // the pointer's most recent position *before* the mouseenter that
    // triggered the check, to tell whether the pointer is travelling toward
    // the open submenu rather than merely instantaneously over it.
    this.on(document, 'mousemove', (event) => {
      const { clientX, clientY } = event as MouseEvent;
      this.lastPointer = { x: clientX, y: clientY };
    });
    this.on(window, 'resize', onResize);
    this.on(window, 'blur', () => this.close());
    if (globalThis.visualViewport) {
      this.on(globalThis.visualViewport, 'resize', onResize);
    }
    openMenus.add(this);
  }

  /** Open a context menu at a viewport position. */
  static open(
    entries: ContextMenuEntry[],
    x: number,
    y: number,
    options: ContextMenuOptions = {},
  ): ContextMenu {
    closeAllContextMenus();
    const menu = new ContextMenu(entries, x, y, options);
    menu.focusFirst();
    return menu;
  }

  private on(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    capture = false,
  ): void {
    target.addEventListener(type, handler, capture);
    this.listeners.push(() => target.removeEventListener(type, handler, capture));
  }

  /** Re-measure and re-place the menu (and any open submenu). */
  reposition(): void {
    positionPopup(this.element, { kind: 'point', x: this.placementX, y: this.placementY });
    if (this.submenu) {
      positionPopup(this.submenu.element, { kind: 'beside', rect: rectOf(this.submenu.parent) });
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    openMenus.delete(this);
    this.closeSubmenu();
    this.element.remove();
    for (const off of this.listeners) {
      off();
    }
    this.listeners.length = 0;
    // Return focus where it came from so keyboard users are never stranded.
    // Closing a menu — by an outside tap, Escape, or picking a command — is
    // never itself an explicit edit-entry gesture, even when the menu
    // happened to open from a focused text input (e.g. the grid's touch
    // keyboard-sink, see `Grid.focusGrid`). For text inputs, restore focus
    // the same read-only-around-the-focus-call way that sink uses, so a
    // dismissed menu never pops the mobile on-screen keyboard back up.
    const restoreFocus = this.restoreFocus;
    if (restoreFocus && restoreFocus.isConnected) {
      if (restoreFocus instanceof HTMLInputElement || restoreFocus instanceof HTMLTextAreaElement) {
        const wasReadOnly = restoreFocus.readOnly;
        restoreFocus.readOnly = true;
        restoreFocus.focus();
        restoreFocus.readOnly = wasReadOnly;
      } else {
        restoreFocus.focus();
      }
    }
    this.onClose?.();
  }

  private focusFirst(): void {
    const toolbar = this.element.querySelector<HTMLElement>(':scope > .context-menu-toolbar');
    const firstToolbarButton = toolbar ? enabledToolbarItems(toolbar)[0] : undefined;
    if (firstToolbarButton) {
      firstToolbarButton.focus();
      return;
    }
    const items = enabledItems(this.element);
    items[0]?.focus();
  }

  private buildList(entries: ContextMenuEntry[], toolbar?: ContextMenuToolbarItem[]): HTMLElement {
    const list = el('div', { className: 'context-menu', attrs: { role: 'menu' } });
    if (toolbar?.length) {
      list.append(this.buildToolbar(toolbar));
      if (entries.length > 0) {
        list.append(el('hr', { className: 'menu-separator' }));
      }
    }
    for (const entry of entries) {
      if (entry === 'separator') {
        list.append(el('hr', { className: 'menu-separator' }));
        continue;
      }
      const hasSubmenu = (entry.submenu?.length ?? 0) > 0;
      // A checkable item's checkmark and a plain item's decorative icon
      // share one reserved left-hand column — never both at once — mirroring
      // MenuBar.buildList exactly, so an item that appears in both surfaces
      // (e.g. a worksheet's lock state) looks the same in each.
      const checked = hasSubmenu ? undefined : entry.checked;
      const button = el(
        'button',
        {
          className: hasSubmenu ? 'menu-item has-submenu' : 'menu-item',
          attrs: {
            type: 'button',
            role: checked === undefined ? 'menuitem' : 'menuitemcheckbox',
            ...(checked === undefined ? {} : { 'aria-checked': String(checked) }),
            ...(hasSubmenu ? { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } : {}),
          },
        },
        [
          ...(hasSubmenu
            ? []
            : [
                el(
                  'span',
                  { className: 'check', attrs: { 'aria-hidden': 'true' } },
                  checked
                    ? [createIcon(Check, 'check-icon', 14)]
                    : entry.icon
                      ? [createIcon(entry.icon, 'item-icon', 14)]
                      : [],
                ),
              ]),
          el('span', { className: 'label', text: entry.label }),
          ...(hasSubmenu
            ? [el('span', { className: 'submenu-arrow', attrs: { 'aria-hidden': 'true' } })]
            : [el('span', { className: 'shortcut', text: entry.shortcut ?? '' })]),
        ],
      );
      button.disabled = entry.disabled === true;
      if (hasSubmenu) {
        const open = (): void => this.openSubmenu(button, entry.submenu ?? []);
        button.addEventListener('click', open);
        button.addEventListener('mouseenter', open);
      } else {
        button.addEventListener('mouseenter', (event) => this.onSiblingHover(event as MouseEvent, list));
        button.addEventListener('click', () => {
          const run = entry.onSelect;
          this.close();
          run?.();
        });
      }
      button.addEventListener('keydown', (event) => this.onItemKeyDown(event, list, button, entry));
      list.append(button);
    }
    return list;
  }

  private buildToolbar(items: ContextMenuToolbarItem[]): HTMLElement {
    const row = el('div', { className: 'context-menu-toolbar', attrs: { role: 'toolbar' } });
    for (const item of items) {
      const { icon } = item;
      const button = el(
        'button',
        {
          className: item.className ? `toolbar-item ${item.className}` : 'toolbar-item',
          text: typeof icon === 'string' ? icon : undefined,
          attrs: {
            type: 'button',
            title: (item.disabled && item.disabledReason) || item.label,
            'aria-label': item.label,
            ...(item.checked === undefined ? {} : { 'aria-pressed': String(item.checked) }),
          },
        },
        typeof icon === 'string' ? [] : [createIcon(icon, 'toolbar-item-icon')],
      );
      button.disabled = item.disabled === true;
      button.classList.toggle('active', item.checked === true);
      button.addEventListener('click', () => {
        const run = item.onSelect;
        this.close();
        run();
      });
      button.addEventListener('keydown', (event) => this.onToolbarKeyDown(event, row, button));
      row.append(button);
    }
    return row;
  }

  private onToolbarKeyDown(event: KeyboardEvent, row: HTMLElement, button: HTMLButtonElement): void {
    const items = enabledToolbarItems(row);
    const index = items.indexOf(button);
    const focusAt = (next: number): void => {
      items[(next + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusAt(index + 1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusAt(index - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        return;
      case 'End':
        event.preventDefault();
        focusAt(items.length - 1);
        return;
      case 'ArrowDown':
        // Move from the toolbar row down into the item list below it.
        event.preventDefault();
        enabledItems(this.element)[0]?.focus();
        return;
      case 'Escape':
        event.preventDefault();
        this.close();
        return;
      case 'Tab':
        // Never let focus escape into the page behind an open menu.
        event.preventDefault();
        this.close();
        return;
      default:
        return;
    }
  }

  private onItemKeyDown(
    event: KeyboardEvent,
    list: HTMLElement,
    button: HTMLButtonElement,
    entry: ContextMenuItem,
  ): void {
    const items = enabledItems(list);
    const index = items.indexOf(button);
    const focusAt = (next: number): void => {
      const target = items[(next + items.length) % items.length];
      target?.focus();
      // Keep the focused item visible when the menu had to become scrollable.
      target?.scrollIntoView?.({ block: 'nearest' });
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        return;
      case 'End':
        event.preventDefault();
        focusAt(items.length - 1);
        return;
      case 'ArrowRight':
        if (entry.submenu?.length) {
          event.preventDefault();
          this.openSubmenu(button, entry.submenu);
          enabledItems(this.submenu!.element)[0]?.focus();
        }
        return;
      case 'ArrowLeft':
        if (list !== this.element) {
          event.preventDefault();
          const parent = this.submenu?.parent;
          this.closeSubmenu();
          parent?.focus();
        }
        return;
      case 'Escape':
        event.preventDefault();
        if (list !== this.element) {
          const parent = this.submenu?.parent;
          this.closeSubmenu();
          parent?.focus();
          return;
        }
        this.close();
        return;
      case 'Tab':
        // Never let focus escape into the page behind an open menu.
        event.preventDefault();
        this.close();
        return;
      default:
        return;
    }
  }

  /**
   * Hovering an item with no submenu of its own normally closes whichever
   * submenu is currently open *from this same list* — e.g. moving from "B"
   * (which has a submenu) to sibling "A" closes B's submenu. But `buildList`
   * wires this same handler for every plain item at every depth, so it also
   * fires when the pointer enters a plain item *inside* an already-open
   * submenu; `list` there is the submenu's own element, not the list that
   * opened it, so the guard below leaves that submenu alone (previously it
   * closed itself the instant the pointer reached any of its own items).
   * For a genuine same-list sibling, the close is additionally deferred
   * while the pointer is still heading toward the submenu's bounding box —
   * a triangle "safe zone" test, the same technique behind Amazon's
   * mega-menu — so crossing sibling rows on a diagonal path toward an open
   * submenu no longer dismisses it before the pointer arrives (#399).
   */
  private onSiblingHover(event: MouseEvent, list: HTMLElement): void {
    if (!this.submenu || this.submenu.parent.parentElement !== list) {
      return;
    }
    if (this.pointerHeadingTowardSubmenu(event)) {
      return;
    }
    this.closeSubmenu();
  }

  /**
   * True while the pointer's short recent path still points into the open
   * submenu's bounding box: the triangle formed by the pointer's previous
   * position and the submenu's two corners on the side nearest the pointer.
   * Falls back to treating the pointer as heading toward the submenu when no
   * prior position is known yet (the first move after the menu opens).
   */
  private pointerHeadingTowardSubmenu(event: MouseEvent): boolean {
    if (!this.submenu) {
      return false;
    }
    const point: Point = { x: event.clientX, y: event.clientY };
    const origin = this.lastPointer ?? point;
    const rect = this.submenu.element.getBoundingClientRect();
    const nearX = rect.left >= point.x ? rect.left : rect.right;
    return pointInTriangle(point, origin, { x: nearX, y: rect.top }, { x: nearX, y: rect.bottom });
  }

  private openSubmenu(parent: HTMLElement, entries: ContextMenuEntry[]): void {
    if (this.submenu?.parent === parent) {
      return;
    }
    this.closeSubmenu();
    const element = this.buildList(entries);
    element.classList.add('submenu');
    document.body.append(element);
    this.submenu = { parent, element };
    parent.setAttribute('aria-expanded', 'true');
    positionPopup(element, { kind: 'beside', rect: rectOf(parent) });
  }

  private closeSubmenu(): void {
    if (!this.submenu) {
      return;
    }
    this.submenu.parent.setAttribute('aria-expanded', 'false');
    this.submenu.element.remove();
    this.submenu = null;
  }
}

function enabledItems(list: HTMLElement): HTMLButtonElement[] {
  return Array.from(list.querySelectorAll<HTMLButtonElement>(':scope > .menu-item')).filter(
    (item) => !item.disabled,
  );
}

function enabledToolbarItems(row: HTMLElement): HTMLButtonElement[] {
  return Array.from(row.querySelectorAll<HTMLButtonElement>(':scope > .toolbar-item')).filter(
    (item) => !item.disabled,
  );
}

function rectOf(node: HTMLElement): AnchorRect {
  const r = node.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

interface Point {
  x: number;
  y: number;
}

/** Twice the signed area of triangle (a, b, c); its sign gives which side `a` is on. */
function triangleSign(a: Point, b: Point, c: Point): number {
  return (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
}

/** Standard barycentric-sign point-in-triangle test (inclusive of the edges). */
function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = triangleSign(p, a, b);
  const d2 = triangleSign(p, b, c);
  const d3 = triangleSign(p, c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}
