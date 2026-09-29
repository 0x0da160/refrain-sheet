// SPDX-License-Identifier: MIT
/**
 * The main toolbar under the menu bar: one icon button per chosen command,
 * running the same shared commands as the menus. Which commands it holds and
 * in which order is this browser's choice (View > Customize Toolbar…,
 * `app/toolbar-prefs.ts`), never the file's. Any menu command with an icon
 * can go on it; its label, shortcut and checked state come from its menu
 * item, so the toolbar never words a command differently from the menus.
 */
import { Bold, Italic, Maximize, Settings2, Underline, WrapText, type IconNode } from 'lucide';
import type { CommandId, Commands } from '../app/commands';
import { t } from '../app/i18n';
import { getToolbarItems, getToolbarShown } from '../app/toolbar-prefs';
import { ICON_BY_COMMAND } from './command-icons';
import { el } from './dom';
import { createIcon } from './icon';
import { shortcutLabel, type MenuDef, type MenuItemDef } from './menu-bar/menus';
import { dropDetachedTooltip, hideTooltip, installTooltips } from './tooltip';

/**
 * Icons for commands the menus show with a check mark instead of an icon,
 * so they can go on the toolbar too.
 */
const CHECKABLE_ICONS: Partial<Record<CommandId, IconNode>> = {
  'format.bold': Bold,
  'format.italic': Italic,
  'format.underline': Underline,
  'view.wrap': WrapText,
  'view.fullscreen': Maximize,
};

/** A command the toolbar can hold. */
export interface ToolbarCommand {
  id: CommandId;
  icon: IconNode;
  /** The menu it is found in (its i18n key), for grouping. */
  menuKey: string;
  item: MenuItemDef;
}

/** The label a menu item shows now. */
export function toolbarLabel(item: MenuItemDef): string {
  const key = typeof item.labelKey === 'function' ? item.labelKey() : item.labelKey;
  return key.includes('.') ? t(key) : key;
}

/** Every command the toolbar can hold, in menu order (the first menu item for each). */
export function toolbarCommands(menus: readonly MenuDef[]): ToolbarCommand[] {
  const found = new Map<CommandId, ToolbarCommand>();
  const walk = (items: ReadonlyArray<MenuItemDef | 'separator'>, menuKey: string): void => {
    for (const item of items) {
      if (item === 'separator') {
        continue;
      }
      if (item.submenu) {
        walk(item.submenu, menuKey);
      }
      const icon = item.command && (ICON_BY_COMMAND[item.command] ?? CHECKABLE_ICONS[item.command]);
      if (item.command && icon && !item.heading && !found.has(item.command)) {
        found.set(item.command, { id: item.command, icon, menuKey, item });
      }
    }
  };
  for (const menu of menus) {
    walk(menu.items, menu.labelKey);
  }
  return [...found.values()];
}

/** The toolbar's commands as stored, skipping any this build does not offer. */
export function chosenToolbarCommands(available: readonly ToolbarCommand[]): ToolbarCommand[] {
  const byId = new Map(available.map((command) => [command.id as string, command]));
  return getToolbarItems().flatMap((id) => byId.get(id) ?? []);
}

export class AppToolbar {
  readonly element: HTMLElement;
  /** Every command the toolbar can hold. */
  readonly available: ToolbarCommand[];

  constructor(
    private readonly commands: Commands,
    menus: readonly MenuDef[],
  ) {
    this.available = toolbarCommands(menus);
    this.element = el('div', { className: 'app-toolbar', attrs: { role: 'toolbar' } });
    this.element.addEventListener('keydown', (event) => this.keyDown(event));
    installTooltips(this.element);
    this.render();
  }

  /** Rebuild the buttons: after a setting, locale, document or selection change. */
  render(): void {
    this.element.hidden = !getToolbarShown();
    this.element.setAttribute('aria-label', t('toolbar.label'));
    if (this.element.hidden) {
      this.element.replaceChildren();
      hideTooltip();
      return;
    }
    const nodes: HTMLElement[] = [];
    let lastMenu: string | null = null;
    for (const command of chosenToolbarCommands(this.available)) {
      // A thin divider wherever the next command comes from another menu.
      if (lastMenu !== null && command.menuKey !== lastMenu) {
        nodes.push(el('span', { className: 'app-toolbar-divider', attrs: { 'aria-hidden': 'true' } }));
      }
      lastMenu = command.menuKey;
      nodes.push(this.button(command));
    }
    nodes.push(el('span', { className: 'app-toolbar-spacer' }), this.customizeButton());
    this.element.replaceChildren(...nodes);
    const buttons = this.buttons();
    buttons.forEach((button, i) => (button.tabIndex = i === 0 ? 0 : -1));
    dropDetachedTooltip();
  }

  private button(command: ToolbarCommand): HTMLButtonElement {
    const label = toolbarLabel(command.item);
    const shortcut = shortcutLabel(command.item.shortcut);
    const enabled = this.commands.isEnabled(command.id);
    const reason = enabled ? null : this.commands.disabledReason(command.id);
    // The app's quick tooltip (tooltip.ts) rather than a slow `title`; a
    // disabled command says why on its second line, and to screen readers.
    const tooltip = [shortcut ? `${label} (${shortcut})` : label, reason].filter(Boolean).join('\n');
    const button = el('button', {
      className: 'app-toolbar-button',
      attrs: { type: 'button', 'data-tooltip': tooltip, 'aria-label': label, 'data-command': command.id },
    }) as HTMLButtonElement;
    if (reason) {
      button.setAttribute('aria-description', reason);
    }
    button.append(createIcon(command.icon, 'app-toolbar-icon', 16));
    // aria-disabled rather than disabled, so the reason stays reachable.
    button.setAttribute('aria-disabled', String(!enabled));
    if (command.item.checked) {
      button.setAttribute('aria-pressed', String(command.item.checked()));
    }
    this.keepFocus(button);
    button.addEventListener('click', () => {
      if (this.commands.isEnabled(command.id)) {
        void this.commands.run(command.id);
      }
    });
    return button;
  }

  private customizeButton(): HTMLButtonElement {
    const label = t('menu.view.customizeToolbar');
    const button = el('button', {
      className: 'app-toolbar-button app-toolbar-customize',
      attrs: { type: 'button', 'data-tooltip': label, 'aria-label': label },
    }) as HTMLButtonElement;
    button.append(createIcon(Settings2, 'app-toolbar-icon', 16));
    button.addEventListener('click', () => void this.commands.run('view.customizeToolbar'));
    return button;
  }

  /** A pointer press leaves focus where it was (the grid), like a menu does. */
  private keepFocus(button: HTMLButtonElement): void {
    button.addEventListener('mousedown', (event) => event.preventDefault());
  }

  private buttons(): HTMLButtonElement[] {
    return [...this.element.querySelectorAll<HTMLButtonElement>('.app-toolbar-button')];
  }

  /** Left/Right/Home/End move between the buttons (one tab stop for the whole toolbar). */
  private keyDown(event: KeyboardEvent): void {
    const buttons = this.buttons();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) {
      return;
    }
    const next =
      event.key === 'ArrowRight'
        ? (current + 1) % buttons.length
        : event.key === 'ArrowLeft'
          ? (current - 1 + buttons.length) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : -1;
    if (next < 0) {
      return;
    }
    event.preventDefault();
    buttons[current].tabIndex = -1;
    buttons[next].tabIndex = 0;
    buttons[next].focus();
  }
}
