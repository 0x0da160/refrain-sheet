// SPDX-License-Identifier: MIT
import { FilePlus, FilePlus2, FolderClock, FolderOpen } from 'lucide';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { createAppLogotype } from './app-icon';
import { el, clearChildren } from './dom';
import { createIcon } from './icon';

/**
 * The initial screen: shown on first launch and restored whenever the last
 * document tab is closed, so the application never sits on an empty tab strip
 * or a blank grid. It offers the primary entry points — open a file, create a
 * new RSF spreadsheet, drag & drop. The fuller app description (what it does,
 * offline/network behavior) lives in Help ▸ About, not here. Application-level
 * preferences (language, sheet font, file-size limit) live outside the tab
 * lifecycle and are unaffected; the screen simply re-renders in the active
 * locale.
 */
export class WelcomeScreen {
  readonly element: HTMLElement;

  constructor(private readonly commands: Commands) {
    this.element = el('div', {
      className:
        'welcome-screen flex flex-1 flex-col items-center justify-center gap-(--space-5) overflow-auto bg-surface p-10 text-center',
    });
    this.element.hidden = true;
    this.render();
  }

  /** Re-render the localized content and show/hide the screen. */
  refresh(visible: boolean): void {
    this.render();
    this.element.hidden = !visible;
  }

  private render(): void {
    clearChildren(this.element);
    const actionClasses =
      'welcome-action inline-flex items-center justify-center gap-(--space-4) rounded-(--radius-md) border border-accent px-(--space-6) py-(--space-4) text-[14px] cursor-pointer hover:bg-accent-soft hover:text-accent';
    const open = el(
      'button',
      { className: `${actionClasses} primary bg-accent text-accent-contrast`, attrs: { type: 'button' } },
      [createIcon(FolderOpen, 'flex-none', 18), el('span', { text: t('welcome.open') })],
    );
    open.addEventListener('click', () => void this.commands.run('file.open'));
    const create = el(
      'button',
      { className: `${actionClasses} bg-surface text-accent`, attrs: { type: 'button' } },
      [createIcon(FilePlus, 'flex-none', 18), el('span', { text: t('welcome.new') })],
    );
    create.addEventListener('click', () => void this.commands.run('file.new'));
    const createCsv = el(
      'button',
      { className: `${actionClasses} bg-surface text-accent`, attrs: { type: 'button' } },
      [createIcon(FilePlus2, 'flex-none', 18), el('span', { text: t('welcome.newCsv') })],
    );
    createCsv.addEventListener('click', () => void this.commands.run('file.newCsv'));
    // A quieter link to File > Open Recent…, only where the browser can
    // reopen files at all (the File System Access API).
    const recent = el(
      'button',
      {
        className:
          'welcome-recent inline-flex items-center gap-(--space-3) rounded-(--radius-sm) border-0 bg-transparent px-(--space-3) py-(--space-2) text-[13px] text-accent cursor-pointer hover:underline',
        attrs: { type: 'button' },
      },
      [createIcon(FolderClock, 'flex-none', 16), el('span', { text: t('menu.file.openRecent') })],
    );
    recent.addEventListener('click', () => void this.commands.run('file.openRecent'));
    this.element.append(
      // The design system's fixed icon+wordmark logotype, not the icon and
      // product name re-set separately: nothing else here states the product
      // name, so (unlike the small app icon elsewhere) it carries a real
      // accessible name instead of being decorative. Wrapped in the page's
      // one <h1> for heading semantics; sized via width/height attributes so
      // it never shifts layout, and it follows the light/dark theme.
      el('h1', { className: 'm-0' }, [createAppLogotype('welcome-logotype block', 44)]),
      el('p', { className: 'm-0 text-dim', text: t('app.subtitle') }),
      // Equal-width buttons: one column on a phone, one row of equal
      // columns from the `sm` breakpoint up.
      el(
        'div',
        { className: 'mt-(--space-4) mb-(--space-1) grid gap-(--space-4) sm:grid-flow-col sm:auto-cols-fr' },
        [open, create, createCsv],
      ),
      ...(this.commands.isEnabled('file.openRecent') ? [recent] : []),
      el('p', {
        className:
          'welcome-drop mt-(--space-3) rounded-(--radius-md) border-2 border-dashed border-line px-(--space-7) py-(--space-5) text-dim',
        text: t('welcome.drop'),
      }),
    );
  }
}
