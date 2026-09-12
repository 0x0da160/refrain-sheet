// SPDX-License-Identifier: MIT
import { FilePlus, FilePlus2, FolderOpen } from 'lucide';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { createAppIcon } from './app-icon';
import { el, clearChildren } from './dom';
import { createIcon } from './icon';

/**
 * The initial screen: shown on first launch and restored whenever the last
 * document tab is closed, so the application never sits on an empty tab strip
 * or a blank grid. It offers the primary entry points — open a file, create a
 * new RSF spreadsheet, drag & drop — plus short offline / local-file usage
 * guidance. Application-level preferences (language, sheet font, file-size
 * limit) live outside the tab lifecycle and are unaffected; the screen simply
 * re-renders in the active locale.
 */
export class WelcomeScreen {
  readonly element: HTMLElement;

  constructor(private readonly commands: Commands) {
    this.element = el('div', {
      className:
        'welcome-screen flex flex-1 flex-col items-center justify-center gap-3 overflow-auto bg-surface p-10 text-center',
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
      'welcome-action inline-flex items-center gap-2 rounded-[5px] border border-accent px-[18px] py-[9px] text-[14px] cursor-pointer hover:bg-accent-soft hover:text-accent';
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
    this.element.append(
      // Decorative: the welcome title states the product name, so the icon is
      // hidden from assistive technology. Sized via width/height attributes;
      // vector SVG stays crisp at any display density, and it follows the
      // light/dark theme.
      createAppIcon('welcome-icon block flex-none rounded-2xl', 72),
      el('h1', { className: 'm-0 text-[22px]', text: t('app.title') }),
      el('p', { className: 'm-0 text-dim', text: t('app.subtitle') }),
      el('div', { className: 'mt-[10px] mb-[2px] flex flex-wrap justify-center gap-[10px]' }, [
        open,
        create,
        createCsv,
      ]),
      el('p', {
        className:
          'welcome-drop mt-[6px] rounded-lg border-2 border-dashed border-line px-[26px] py-[14px] text-dim',
        text: t('welcome.drop'),
      }),
      el('p', {
        className: 'welcome-note m-0 max-w-[560px] text-[12px] leading-[1.6] text-dim',
        text: t('welcome.offline'),
      }),
    );
  }
}
