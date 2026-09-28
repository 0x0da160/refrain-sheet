// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The Sheet Tab Color dialog: ready-made colors fill the "other color"
 * picker (so the picker always shows what Apply sets), the chosen one is
 * marked pressed, and the three buttons resolve apply / clear / cancel.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../../src/app/i18n';
import { Dialogs } from '../../src/ui/dialogs';
import { SHEET_TAB_PRESETS } from '../../src/ui/document-colors';

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

  it('shows one labeled button per ready-made color, the current one pressed', () => {
    void new Dialogs().chooseSheetTabColor('#1b9247');
    const presets = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-color-preset'));
    expect(presets.map((p) => p.dataset.color)).toEqual(SHEET_TAB_PRESETS.map((p) => p.color));
    expect(presets.every((p) => p.getAttribute('aria-label'))).toBe(true);
    const pressed = presets.filter((p) => p.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((p) => p.dataset.color)).toEqual(['#1b9247']);
  });

  it('shows no ready-made color as chosen while the tab has none', () => {
    void new Dialogs().chooseSheetTabColor(null);
    expect(document.querySelectorAll('.tab-color-preset[aria-pressed="true"]')).toHaveLength(0);
  });

  it('applies a ready-made color after it is picked', async () => {
    const result = new Dialogs().chooseSheetTabColor(null);
    const blue = document.querySelector<HTMLButtonElement>('.tab-color-preset[data-color="#287ccf"]')!;
    blue.click();
    expect(document.querySelector<HTMLInputElement>('#sheet-tab-color-input')!.value).toBe('#287ccf');
    expect(blue.getAttribute('aria-pressed')).toBe('true');
    button(t('dialog.tabColor.apply')).click();
    await expect(result).resolves.toEqual({ action: 'apply', color: '#287ccf' });
  });

  it('applies any other color from the picker', async () => {
    const result = new Dialogs().chooseSheetTabColor(null);
    const picker = document.querySelector<HTMLInputElement>('#sheet-tab-color-input')!;
    picker.value = '#123456';
    picker.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.tab-color-preset[aria-pressed="true"]')).toHaveLength(0);
    button(t('dialog.tabColor.apply')).click();
    await expect(result).resolves.toEqual({ action: 'apply', color: '#123456' });
  });

  it('resolves clear for No Color and null for Cancel', async () => {
    const cleared = new Dialogs().chooseSheetTabColor('#287ccf');
    button(t('dialog.tabColor.clear')).click();
    await expect(cleared).resolves.toEqual({ action: 'clear' });
    const cancelled = new Dialogs().chooseSheetTabColor(null);
    button(t('dialog.tabColor.cancel')).click();
    await expect(cancelled).resolves.toBeNull();
  });
});
