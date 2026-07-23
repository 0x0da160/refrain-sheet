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
import { el } from './dom';
import { positionPopup, type AnchorRect } from './popup';

export interface ContextMenuItem {
  /** Already-localized label text (rendered via textContent, never as HTML). */
  label: string;
  disabled?: boolean;
  /** Invoked after the menu closes. Omitted for a pure submenu parent. */
  onSelect?: () => void;
  /** Nested items; renders this entry as a submenu parent. */
  submenu?: ContextMenuEntry[];
}

export type ContextMenuEntry = ContextMenuItem | 'separator';

export interface ContextMenuOptions {
  /** Called after the menu closes, for whatever reason. */
  onClose?: () => void;
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

  private constructor(
    entries: ContextMenuEntry[],
    private readonly placementX: number,
    private readonly placementY: number,
    options: ContextMenuOptions,
  ) {
    this.onClose = options.onClose;
    const active = document.activeElement;
    this.restoreFocus = active instanceof HTMLElement ? active : null;
    this.element = this.buildList(entries);
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
    if (this.restoreFocus && this.restoreFocus.isConnected) {
      this.restoreFocus.focus();
    }
    this.onClose?.();
  }

  private focusFirst(): void {
    const items = enabledItems(this.element);
    items[0]?.focus();
  }

  private buildList(entries: ContextMenuEntry[]): HTMLElement {
    const list = el('div', { className: 'context-menu', attrs: { role: 'menu' } });
    for (const entry of entries) {
      if (entry === 'separator') {
        list.append(el('hr', { className: 'menu-separator' }));
        continue;
      }
      const hasSubmenu = (entry.submenu?.length ?? 0) > 0;
      const button = el(
        'button',
        {
          className: hasSubmenu ? 'menu-item has-submenu' : 'menu-item',
          attrs: {
            type: 'button',
            role: 'menuitem',
            ...(hasSubmenu ? { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } : {}),
          },
        },
        [
          el('span', { className: 'label', text: entry.label }),
          ...(hasSubmenu
            ? [el('span', { className: 'submenu-arrow', attrs: { 'aria-hidden': 'true' } })]
            : []),
        ],
      );
      button.disabled = entry.disabled === true;
      if (hasSubmenu) {
        const open = (): void => this.openSubmenu(button, entry.submenu ?? []);
        button.addEventListener('click', open);
        button.addEventListener('mouseenter', open);
      } else {
        button.addEventListener('mouseenter', () => this.closeSubmenu());
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

function rectOf(node: HTMLElement): AnchorRect {
  const r = node.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}
