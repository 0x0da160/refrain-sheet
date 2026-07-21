// SPDX-License-Identifier: MIT
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { el, clearChildren } from './dom';
// Bundled at build time (base:'./' → relative, hashed URL): works under a
// GitHub Pages base path and via file://, with no network request.
import iconUrl from '../assets/icon.svg';

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
    this.element = el('div', { className: 'welcome-screen' });
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
    const open = el('button', {
      className: 'welcome-action primary',
      attrs: { type: 'button' },
      text: t('welcome.open'),
    });
    open.addEventListener('click', () => void this.commands.run('file.open'));
    const create = el('button', {
      className: 'welcome-action',
      attrs: { type: 'button' },
      text: t('welcome.new'),
    });
    create.addEventListener('click', () => void this.commands.run('file.new'));
    this.element.append(
      // Decorative: the welcome title states the product name, so the icon is
      // hidden from assistive technology. Sized in CSS; vector SVG stays crisp
      // at any display density.
      el('img', {
        className: 'welcome-icon',
        attrs: {
          src: iconUrl,
          alt: '',
          'aria-hidden': 'true',
          width: '72',
          height: '72',
          draggable: 'false',
        },
      }),
      el('h1', { className: 'welcome-title', text: t('app.title') }),
      el('p', { className: 'welcome-subtitle', text: t('app.subtitle') }),
      el('div', { className: 'welcome-actions' }, [open, create]),
      el('p', { className: 'welcome-drop', text: t('welcome.drop') }),
      el('p', { className: 'welcome-note', text: t('welcome.offline') }),
    );
  }
}
