// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The Sheet Tab Color dialog: the shared color picker, where picking a
 * color applies it at once, "No Color" removes it and Cancel keeps it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../../src/app/i18n';
import { Dialogs } from '../../src/ui/dialogs';

function button(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find(
    (b) => b.textContent === label,
  )!;
}

describe('Sheet Tab Color dialog', () => {
  const locale = getLocale();

  // jsdom does not implement <dialog>.showModal(); make the element "open"
  // so its content is queryable (as in sheet-kind-picker.test.ts).
  beforeEach(() => {
    setLocale('en');
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
    if (typeof proto.showModal !== 'function') {
      proto.showModal = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      proto.close = function (this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  });

  afterEach(() => {
    setLocale(locale);
    document.querySelectorAll('dialog').forEach((d) => d.remove());
  });

  it("shows the palette with the tab's color pressed", () => {
    void new Dialogs().chooseSheetTabColor('#287ccf');
    const swatches = document.querySelectorAll<HTMLButtonElement>('dialog .color-swatch');
    expect(swatches.length).toBeGreaterThanOrEqual(65);
    const pressed = document.querySelectorAll<HTMLButtonElement>('dialog .color-swatch[aria-pressed="true"]');
    expect([...pressed].map((b) => b.dataset.color)).toEqual(['#287ccf']);
    expect(pressed[0].getAttribute('aria-label')).toBe('Blue 5 (#287ccf)');
  });

  it('applies a palette color as soon as it is picked', async () => {
    const result = new Dialogs().chooseSheetTabColor(null);
    document.querySelector<HTMLButtonElement>('dialog .color-swatch[data-color="#1b9247"]')!.click();
    await expect(result).resolves.toEqual({ action: 'apply', color: '#1b9247' });
  });

  it('applies a color code or a CSS color name typed under More colors', async () => {
    const result = new Dialogs().chooseSheetTabColor(null);
    const code = document.querySelector<HTMLInputElement>('dialog .color-picker-code')!;
    code.value = 'tomato';
    code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await expect(result).resolves.toEqual({ action: 'apply', color: '#ff6347' });
  });

  it('resolves clear for No Color and null for Cancel', async () => {
    const cleared = new Dialogs().chooseSheetTabColor('#287ccf');
    button(t('colorPicker.none')).click();
    await expect(cleared).resolves.toEqual({ action: 'clear' });
    const cancelled = new Dialogs().chooseSheetTabColor(null);
    button(t('dialog.tabColor.cancel')).click();
    await expect(cancelled).resolves.toBeNull();
  });
});
