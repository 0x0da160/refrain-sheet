// SPDX-License-Identifier: MIT
/**
 * The hosted build's "a new version is ready" notice. Unlike a toast it does
 * not time out: it stays until the person acts on it or dismisses it. The shell
 * decides what the action does (see shell/update-flow.ts); this only shows it.
 */
import { X } from 'lucide';
import { t } from '../app/i18n';
import { el } from './dom';
import { createIcon } from './icon';

export class UpdateBanner {
  readonly element: HTMLElement;
  private readonly message: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly dismiss: HTMLButtonElement;

  constructor(onAction: () => void) {
    this.message = el('span', { className: 'update-banner-message' });
    this.action = el('button', { className: 'update-banner-action', attrs: { type: 'button' } });
    this.action.addEventListener('click', onAction);
    this.dismiss = el('button', { className: 'update-banner-close', attrs: { type: 'button' } });
    this.dismiss.append(createIcon(X, 'update-banner-close-icon', 14));
    this.dismiss.addEventListener('click', () => this.hide());
    this.element = el('div', { className: 'update-banner', attrs: { role: 'status' } }, [
      this.message,
      this.action,
      this.dismiss,
    ]);
    this.element.hidden = true;
  }

  /** Shows `text` with the reload action. Calling it again replaces the text. */
  show(text: string): void {
    this.message.textContent = text;
    this.action.textContent = t('update.reload');
    this.dismiss.setAttribute('aria-label', t('toast.close'));
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }
}
