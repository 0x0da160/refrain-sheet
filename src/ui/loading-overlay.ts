// SPDX-License-Identifier: MIT
import { t } from '../app/i18n';
import { el } from './dom';

/**
 * A non-blocking, accessible busy indicator. While a heavy operation runs
 * (opening/parsing a large file) the overlay is shown with an operation
 * label; assistive technology is informed through `role="status"`,
 * `aria-live="polite"`, and `aria-busy`. The command layer shows it just
 * before a CPU-heavy step and, after yielding a paint, clears it when done.
 *
 * The indicator is intentionally lightweight: it never traps focus or blocks
 * pointer events on the rest of the app beyond a translucent scrim, so a slow
 * load never leaves the UI feeling frozen.
 */
export class LoadingOverlay {
  readonly element: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly spinner: HTMLElement;
  private readonly progressEl: HTMLProgressElement;

  constructor() {
    this.labelEl = el('div', { className: 'loading-label' });
    this.spinner = el('div', { className: 'loading-spinner', attrs: { 'aria-hidden': 'true' } });
    this.progressEl = el('progress', {
      className: 'loading-progress',
      attrs: { max: '100', hidden: 'hidden' },
    });
    this.element = el(
      'div',
      {
        className: 'loading-overlay',
        attrs: {
          role: 'status',
          'aria-live': 'polite',
          'aria-busy': 'false',
          hidden: 'hidden',
        },
      },
      [this.spinner, this.progressEl, this.labelEl],
    );
  }

  /**
   * Show the overlay with a localized operation label, or hide it when
   * `label` is null. `progress` is a real completion percentage (0-100);
   * when given, a determinate progress bar replaces the indeterminate
   * spinner — otherwise the operation has no honest percentage to show.
   */
  set(label: string | null, progress?: number | null): void {
    if (label === null) {
      this.element.hidden = true;
      this.element.setAttribute('aria-busy', 'false');
      this.labelEl.textContent = '';
      this.spinner.hidden = false;
      this.progressEl.hidden = true;
      return;
    }
    this.labelEl.textContent = label || t('loading.busy');
    this.element.hidden = false;
    this.element.setAttribute('aria-busy', 'true');
    const determinate = typeof progress === 'number';
    this.spinner.hidden = determinate;
    this.progressEl.hidden = !determinate;
    if (determinate) {
      this.progressEl.value = progress;
    }
  }
}
