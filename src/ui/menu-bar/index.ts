// SPDX-License-Identifier: MIT
import { Check, Menu } from 'lucide';
import type { Commands } from '../../app/commands';
import { t } from '../../app/i18n';
import { createAppIcon, createAppLogotype } from '../app-icon';
import { el, clearChildren } from '../dom';
import { ICON_BY_COMMAND } from '../command-icons';
import { createIcon } from '../icon';
import { onViewportResize, positionPopup, type AnchorRect } from '../popup';

import { defaultMenus, shortcutLabel, type MenuChecks, type MenuDef, type MenuItemDef } from './menus';

/**
 * Desktop-style menu bar. Fully keyboard operable: Enter/Space or ArrowDown
 * opens a menu, arrows navigate, Esc closes, Left/Right switch menus, and
 * ArrowRight/ArrowLeft open and close a submenu (and a submenu's own
 * submenu, one level deeper at most by convention). Every item simply runs a
 * command; the command layer is shared with context menus, shortcuts, and
 * drag-and-drop.
 *
 * Both the drop-down and any open submenu are placed by the shared
 * viewport-aware helper (`positionPopup`), so they flip or clamp instead of
 * being clipped near a window edge, and become scrollable rather than
 * overflowing when the viewport is shorter than the menu. Placement is
 * recomputed on every render — which is what a locale switch, a zoom change,
 * or opening a submenu triggers — and on window/visual-viewport resize.
 */
export class MenuBar {
  readonly element: HTMLElement;
  /**
   * Mobile only (hidden by desktop-width CSS): the hamburger button that
   * expands `.menu-row` below the logo row. A separate top-level element
   * from `.element` — rather than a child of it, as it used to be — purely
   * so the mobile grid (`@media (max-width: 43.75em)` in styles.css) can place
   * it in its own trailing column, past the status bar, in a three-column
   * `[app icon | status bar | hamburger]` layout (#478). The caller mounts
   * it as a sibling of `.element` and `StatusBar.element`; `MenuBar` still
   * owns all of its state and behavior.
   */
  readonly toggleElement: HTMLButtonElement;
  private menus: MenuDef[];
  private openIndex: number | null = null;
  /**
   * `labelKey`s of the open submenu parents, outermost first: `[a]` is a
   * submenu open in the current menu, `[a, b]` one open inside it.
   */
  private openPath: string[] = [];
  /** The mounted submenu lists, outermost first (in `document.body`, so they are never clipped). */
  private submenuEls: HTMLElement[] = [];
  /**
   * Mobile only: whether `.menu-row` (File / Edit / …) is expanded below the
   * logo row. Toggled by `.menu-bar-toggle`, ignored by desktop-width CSS
   * where the row stays inline as before.
   */
  private mobileMenuOpen = false;

  constructor(
    private readonly commands: Commands,
    checks: MenuChecks,
  ) {
    this.menus = defaultMenus(checks);
    this.element = el('div', { className: 'menu-bar', attrs: { role: 'menubar' } });
    // Mobile only (hidden by desktop-width CSS): expands `.menu-row` below
    // the logo row instead of it scrolling horizontally beside the logo. The
    // old horizontal-scroll strip combined with iOS Safari dispatching a
    // synthetic click at the finger's original touch coordinates after
    // inertial scroll, so a tap could open a different item than the one
    // touched (#267); replacing the scroll interaction removes that failure
    // mode entirely rather than trying to compensate for it. Built once
    // (rather than rebuilt every `render()`, like the rest of the bar) so
    // moving it to its own grid column (#478) doesn't cost a detach/reattach
    // on every open/close; only its `aria-expanded`/label attributes below
    // need to track state or locale changes.
    this.toggleElement = el(
      'button',
      {
        className: 'menu-bar-toggle',
        attrs: { type: 'button', 'aria-controls': 'menu-bar-row' },
      },
      [createIcon(Menu, 'menu-bar-toggle-icon', 18)],
    );
    this.toggleElement.addEventListener('click', () => {
      this.mobileMenuOpen = !this.mobileMenuOpen;
      this.render();
    });
    document.addEventListener('mousedown', (event) => {
      const target = event.target as Node | null;
      const insideBar = this.element.contains(target) || this.toggleElement.contains(target);
      const insideSubmenu = Boolean(target && this.submenuEls.some((list) => list.contains(target)));
      if (insideBar || insideSubmenu) {
        return;
      }
      if (this.openIndex !== null || this.mobileMenuOpen) {
        this.openIndex = null;
        this.openPath = [];
        this.mobileMenuOpen = false;
        this.render();
      }
    });
    // The open menu must stay inside the viewport when it changes size.
    const replace = (): void => {
      if (this.openIndex !== null) {
        this.placePopups();
      }
    };
    window.addEventListener('resize', replace);
    // Coalesced across every subscriber onto one shared rAF tick — see
    // `onViewportResize` — rather than the menu bar doing its own
    // independent measure/write on every `visualViewport` resize event.
    // `MenuBar` is a session-lived singleton with no teardown path, same as
    // the plain `window` listener just above, so the returned unsubscribe
    // is intentionally left unused.
    onViewportResize(replace);
    this.render();
  }

  render(): void {
    // Submenus live in document.body, so they must be torn down explicitly
    // before the list that owns them is rebuilt.
    this.submenuEls.forEach((list) => list.remove());
    this.submenuEls = [];
    clearChildren(this.element);
    // Mobile only: lets the mobile layout (`@media (max-width: 43.75em)` in
    // styles.css) grow `.menu-bar` to the full width of its shared row with
    // `.status-bar` and hide that row's sibling while the row expands, via a
    // plain CSS sibling selector — desktop-width CSS never reads this class.
    this.element.classList.toggle('mobile-menu-open', this.mobileMenuOpen);
    // Two theme-aware brand assets, CSS-toggled by viewport (see styles.css):
    // the full icon+wordmark logotype at desktop width, and the compact
    // decorative icon + visually-hidden name at the narrow/mobile width where
    // there isn't room for the logotype (the name stays in the accessibility
    // tree even though only the icon is shown to sighted mobile users — see
    // the mobile media query). Explicit width/height on both reserve space so
    // neither ever shifts layout or stretches; both stay crisp at any DPI and
    // swap to the dark-theme variant with the theme.
    this.element.append(
      createAppIcon('app-icon', 20),
      el('span', { className: 'app-name', text: t('app.title') }),
      createAppLogotype('app-logotype', 22),
    );
    // `toggleElement` is a persistent sibling element (built once in the
    // constructor, see there for why), so only its state/locale-dependent
    // attributes are refreshed here.
    this.toggleElement.setAttribute('aria-expanded', this.mobileMenuOpen ? 'true' : 'false');
    this.toggleElement.setAttribute('aria-label', t('menu.toggle'));
    this.toggleElement.title = t('menu.toggle');
    const row = el('div', {
      className: this.mobileMenuOpen ? 'menu-row open' : 'menu-row',
      attrs: { id: 'menu-bar-row' },
    });
    this.menus.forEach((menu, index) => {
      const wrapper = el('div', { className: 'menu' });
      const label = menu.labelKey.includes('.') ? t(menu.labelKey) : menu.labelKey;
      const button = el('button', {
        text: label,
        attrs: {
          type: 'button',
          'aria-haspopup': 'true',
          'aria-expanded': this.openIndex === index ? 'true' : 'false',
        },
      });
      button.addEventListener('click', () => {
        if (this.openIndex === index) {
          this.closeMenu();
        } else {
          this.openMenu(index);
        }
      });
      button.addEventListener('mouseenter', () => {
        if (this.openIndex !== null && this.openIndex !== index) {
          this.openMenu(index);
        }
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.openMenu(index);
        } else if (event.key === 'ArrowRight') {
          this.focusTopButton(index + 1);
        } else if (event.key === 'ArrowLeft') {
          this.focusTopButton(index - 1);
        }
      });
      wrapper.append(button);
      if (this.openIndex === index) {
        wrapper.append(this.buildList(menu.items, index));
      }
      row.append(wrapper);
    });
    this.element.append(row);
    document.body.append(...this.submenuEls);
    if (this.openIndex !== null) {
      this.placePopups();
    }
  }

  /**
   * Place the open drop-down (and any submenus) against the visual viewport.
   * Runs after every render, because a render is exactly what a locale change,
   * a state change, or opening a submenu produces. Each submenu is placed
   * after its parent list, beside that list's expanded item.
   */
  private placePopups(): void {
    const list = this.element.querySelector<HTMLElement>('.menu > .menu-list');
    const button = list?.parentElement?.querySelector('button');
    if (!list || !button) {
      return;
    }
    positionPopup(list, { kind: 'below', rect: rectOf(button) });
    let parentList = list;
    for (const submenu of this.submenuEls) {
      const parentItem = parentList.querySelector<HTMLElement>('.menu-item[aria-expanded="true"]');
      if (!parentItem) {
        return;
      }
      positionPopup(submenu, { kind: 'beside', rect: rectOf(parentItem) });
      parentList = submenu;
    }
  }

  /** One list of the open menu: `depth` 0 is the drop-down, 1 a submenu, 2 a submenu's submenu. */
  private buildList(items: Array<MenuItemDef | 'separator'>, menuIndex: number, depth = 0): HTMLElement {
    const nested = depth > 0;
    const list = el('div', {
      className: nested ? 'menu-list submenu' : 'menu-list',
      attrs: { role: 'menu' },
    });
    for (const item of items) {
      if (item === 'separator') {
        list.append(el('hr', { className: 'menu-separator' }));
        continue;
      }
      const resolvedLabelKey = typeof item.labelKey === 'function' ? item.labelKey() : item.labelKey;
      const label = resolvedLabelKey.includes('.') ? t(resolvedLabelKey) : resolvedLabelKey;
      if (item.submenu && item.submenu.length > 0) {
        list.append(this.buildSubmenuParent(item, item.submenu, list, menuIndex, label, depth));
        continue;
      }
      if (item.heading || !item.command) {
        // Non-interactive group heading (e.g. "Spreadsheet Font"). Skipped by
        // arrow-key navigation, which only visits `.menu-item` buttons.
        list.append(
          el('div', {
            className: 'menu-heading',
            text: label,
            attrs: { role: 'presentation' },
          }),
        );
        continue;
      }
      const command = item.command;
      const checked = item.checked ? item.checked() : null;
      // A checkable item's checkmark and a plain item's decorative icon
      // share the same reserved left-hand column — never both at once — so
      // adding icons never widens the menu (#393).
      const icon = checked === null ? (item.icon ?? ICON_BY_COMMAND[command]) : undefined;
      const button = el(
        'button',
        {
          className: 'menu-item',
          attrs: {
            type: 'button',
            role: checked === null ? 'menuitem' : 'menuitemcheckbox',
            ...(checked === null ? {} : { 'aria-checked': String(checked) }),
          },
        },
        [
          el(
            'span',
            { className: 'check', attrs: { 'aria-hidden': 'true' } },
            checked ? [createIcon(Check, 'check-icon', 14)] : icon ? [createIcon(icon, 'item-icon', 14)] : [],
          ),
          el('span', { className: 'label', text: label }),
          el('span', {
            className: 'shortcut',
            text: shortcutLabel(item.shortcut),
          }),
        ],
      );
      button.disabled = !this.commands.isEnabled(command);
      const disabledReason = button.disabled ? this.commands.disabledReason(command) : null;
      if (disabledReason) {
        button.title = disabledReason;
      }
      button.addEventListener('click', () => {
        // Also collapses the mobile expand-below-logo panel: on desktop-width
        // CSS this is a no-op, since the row stays inline there regardless.
        this.mobileMenuOpen = false;
        this.closeMenu();
        void this.commands.run(command);
      });
      button.addEventListener('mouseenter', () => {
        // Moving onto a plain item dismisses a sibling's open submenu.
        if (this.openPath.length > depth) {
          this.setOpenPath(this.openPath.slice(0, depth));
        }
      });
      button.addEventListener('keydown', (event) =>
        this.onItemKeyDown(event, list, button, menuIndex, depth),
      );
      list.append(button);
    }
    return list;
  }

  /** A menu entry that opens a nested list (e.g. View > Spreadsheet Zoom), at `depth` of its own list. */
  private buildSubmenuParent(
    item: MenuItemDef,
    submenu: Array<MenuItemDef | 'separator'>,
    list: HTMLElement,
    menuIndex: number,
    label: string,
    depth: number,
  ): HTMLButtonElement {
    // Submenu parents always use the plain-string form in practice (only
    // leaf items need state-dependent wording), but resolve defensively so
    // the identity key in openPath is always a plain string.
    const key = typeof item.labelKey === 'function' ? item.labelKey() : item.labelKey;
    const expanded = this.openPath[depth] === key;
    const button = el(
      'button',
      {
        className: 'menu-item has-submenu',
        attrs: {
          type: 'button',
          role: 'menuitem',
          'aria-haspopup': 'menu',
          'aria-expanded': String(expanded),
          'data-submenu': key,
        },
      },
      [
        el(
          'span',
          { className: 'check', attrs: { 'aria-hidden': 'true' } },
          item.icon ? [createIcon(item.icon, 'item-icon', 14)] : [],
        ),
        el('span', { className: 'label', text: label }),
        el('span', { className: 'submenu-arrow', attrs: { 'aria-hidden': 'true' } }),
      ],
    );
    const open = (focusFirst: boolean): void => {
      // Hovering an already open parent keeps any submenu open inside it.
      if (expanded && !focusFirst) {
        return;
      }
      this.setOpenPath([...this.openPath.slice(0, depth), key], focusFirst);
    };
    button.addEventListener('click', () => open(false));
    button.addEventListener('mouseenter', () => open(false));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open(true);
        return;
      }
      this.onItemKeyDown(event, list, button, menuIndex, depth);
    });
    if (expanded) {
      // Mounted in document.body (by render, outermost first) so a
      // scrollable parent list cannot clip it; positioned (and mirrored
      // when needed) after the render completes. Its slot is taken before
      // it is built, so a deeper submenu lands after it.
      const index = this.submenuEls.length;
      this.submenuEls.push(el('div'));
      this.submenuEls[index] = this.buildList(submenu, menuIndex, depth + 1);
    }
    return button;
  }

  private onItemKeyDown(
    event: KeyboardEvent,
    list: HTMLElement,
    button: HTMLButtonElement,
    menuIndex: number,
    depth: number,
  ): void {
    const nested = depth > 0;
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('.menu-item')).filter(
      (item) => !item.disabled,
    );
    const current = items.indexOf(button);
    const focusAt = (index: number): void => {
      const target = items[(index + items.length) % items.length];
      target?.focus();
      // Keeps the focused entry visible when the list had to become scrollable.
      target?.scrollIntoView?.({ block: 'nearest' });
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(current + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(current - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        return;
      case 'End':
        event.preventDefault();
        focusAt(items.length - 1);
        return;
      case 'Escape':
        event.preventDefault();
        if (nested) {
          // Escape leaves the submenu first, never the whole menu.
          this.setOpenPath(this.openPath.slice(0, depth - 1), false, true);
          return;
        }
        this.closeMenu();
        this.focusTopButton(menuIndex);
        return;
      case 'ArrowRight':
        if (nested) {
          return; // a plain item opens nothing deeper
        }
        this.openMenu(menuIndex + 1);
        return;
      case 'ArrowLeft':
        if (nested) {
          event.preventDefault();
          this.setOpenPath(this.openPath.slice(0, depth - 1), false, true);
          return;
        }
        this.openMenu(menuIndex - 1);
        return;
      default:
        return;
    }
  }

  /**
   * Open (or close) submenus down to `path` and re-render. `focusFirst` moves
   * focus into the innermost submenu for keyboard users; `focusParent`
   * returns it to the item whose submenu was dismissed with Escape /
   * ArrowLeft.
   */
  private setOpenPath(path: string[], focusFirst = false, focusParent = false): void {
    if (path.join('\n') === this.openPath.join('\n') && !focusFirst) {
      return;
    }
    const closed = this.openPath[path.length];
    this.openPath = path;
    this.render();
    const innermost = this.submenuEls[this.submenuEls.length - 1];
    const listAbove = (depth: number): HTMLElement | null =>
      depth === 0
        ? this.element.querySelector<HTMLElement>('.menu > .menu-list')
        : (this.submenuEls[depth - 1] ?? null);
    const parentItem = (depth: number, key: string | undefined): HTMLButtonElement | undefined =>
      Array.from(listAbove(depth)?.querySelectorAll<HTMLButtonElement>('.menu-item.has-submenu') ?? []).find(
        (item) => item.dataset.submenu === key,
      );
    if (focusFirst && innermost) {
      // With every entry disabled, focus stays on the item that opened it.
      const first = innermost.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)');
      (first ?? parentItem(path.length - 1, path[path.length - 1]))?.focus();
      return;
    }
    if (focusParent && closed !== undefined) {
      parentItem(path.length, closed)?.focus();
    }
  }

  private openMenu(index: number): void {
    const wrapped = (index + this.menus.length) % this.menus.length;
    this.openIndex = wrapped;
    this.openPath = [];
    this.render();
    const first = this.element.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)');
    first?.focus();
  }

  private closeMenu(): void {
    this.openIndex = null;
    this.openPath = [];
    this.render();
  }

  private focusTopButton(index: number): void {
    const buttons = this.element.querySelectorAll<HTMLButtonElement>('.menu > button');
    if (buttons.length === 0) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped].focus();
  }
}

function rectOf(node: Element): AnchorRect {
  const r = node.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}
