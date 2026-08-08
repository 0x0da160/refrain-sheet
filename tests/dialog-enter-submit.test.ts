// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Enter-to-submit consistency across single-line dialog inputs (issue #297).
 * `promptSheetName`/`promptMoveTarget`/`promptGoToCell` already wired Enter
 * explicitly; the Number Format, Conditional Format, and Settings dialogs did
 * not, so pressing Enter in their text/number inputs silently did nothing.
 * All six now share `submitOnEnter` (`src/ui/dialogs/shared.ts`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../src/app/i18n';
import { clampMaxFileSize, miBToBytes } from '../src/app/settings';
import { Dialogs } from '../src/ui/dialogs';

function enter(el: Element): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('Enter submits single-line dialog inputs', () => {
  const locale = getLocale();

  // jsdom does not implement <dialog>.showModal(); the shim only needs to
  // make the element "open" so its content is queryable (see branding.test.ts).
  beforeEach(() => {
    setLocale('en');
    const proto = HTMLDialogElement.prototype as unknown as {
      showModal?: () => void;
      close?: () => void;
    };
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

  it('submits the Number Format dialog from the decimals input', async () => {
    const promise = new Dialogs().chooseNumberFormat(null);
    const dialog = document.querySelector('dialog')!;
    const decimals = dialog.querySelector<HTMLInputElement>('#format-number-decimals')!;
    decimals.value = '3';
    decimals.dispatchEvent(new Event('input', { bubbles: true }));

    enter(decimals);

    const result = await promise;
    expect(result).toMatchObject({ action: 'apply', format: { kind: 'number', decimals: 3 } });
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('submits the Number Format dialog from the currency symbol input', async () => {
    const promise = new Dialogs().chooseNumberFormat(null);
    const dialog = document.querySelector('dialog')!;
    const kind = dialog.querySelector<HTMLSelectElement>('#format-number-kind')!;
    kind.value = 'currency';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    const symbol = dialog.querySelector<HTMLInputElement>('#format-number-symbol')!;
    symbol.value = '€';
    symbol.dispatchEvent(new Event('input', { bubbles: true }));

    enter(symbol);

    const result = await promise;
    expect(result).toMatchObject({ action: 'apply', format: { kind: 'currency', currencySymbol: '€' } });
  });

  it('submits the Conditional Format dialog from the value input', async () => {
    const promise = new Dialogs().chooseConditionalFormat({ rangeLabel: 'A1:A10', existing: null });
    const dialog = document.querySelector('dialog')!;
    const value1 = dialog.querySelector<HTMLInputElement>('#cf-value1')!;
    value1.value = '10';
    value1.dispatchEvent(new Event('input', { bubbles: true }));

    enter(value1);

    const result = await promise;
    expect(result).toMatchObject({
      action: 'apply',
      rule: { kind: 'cellValue', operator: 'greaterThan', value1: '10' },
    });
  });

  it('does not submit the Conditional Format dialog on Enter while incomplete', async () => {
    const promise = new Dialogs().chooseConditionalFormat({ rangeLabel: 'A1:A10', existing: null });
    const dialog = document.querySelector('dialog')!;
    const value1 = dialog.querySelector<HTMLInputElement>('#cf-value1')!;
    value1.value = 'not-a-number';
    value1.dispatchEvent(new Event('input', { bubbles: true }));

    enter(value1);
    expect(document.querySelector('dialog')).not.toBeNull();

    dialog.querySelector<HTMLButtonElement>('.dialog-buttons button')!.click();
    await promise;
  });

  it('submits the Settings dialog from the max file size input', async () => {
    const promise = new Dialogs().chooseSettings(64 * 1024 * 1024);
    const dialog = document.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = '128';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    enter(input);

    const result = await promise;
    expect(result).toBe(clampMaxFileSize(miBToBytes(128)));
  });

  it('still submits the sheet-name prompt on Enter after sharing the helper', async () => {
    const promise = new Dialogs().promptSheetName('add', 'Sheet1', () => null);
    const dialog = document.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.value = 'Renamed';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    enter(input);

    expect(await promise).toBe('Renamed');
  });

  it('still submits the Go to Cell prompt on Enter after sharing the helper', async () => {
    const promise = new Dialogs().promptGoToCell('A1', () => null);
    const dialog = document.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.value = 'B2';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    enter(input);

    expect(await promise).toBe('B2');
  });

  it('ignores Enter that only ends an IME composition', async () => {
    const promise = new Dialogs().promptGoToCell('A1', () => null);
    const dialog = document.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.value = 'B2';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(document.querySelector('dialog')).not.toBeNull();

    input.dispatchEvent(new Event('compositionend', { bubbles: true }));
    enter(input);
    expect(await promise).toBe('B2');
  });
});
