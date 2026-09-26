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
    document.querySelectorAll('.side-panel').forEach((d) => d.remove());
  });

  it('submits the Number Format dialog from the decimals input', async () => {
    const promise = new Dialogs().chooseNumberFormat(null);
    const panel = document.querySelector('.side-panel')!;
    const decimals = panel.querySelector<HTMLInputElement>('#format-number-decimals')!;
    decimals.value = '3';
    decimals.dispatchEvent(new Event('input', { bubbles: true }));

    enter(decimals);

    const result = await promise;
    expect(result).toMatchObject({ action: 'apply', format: { kind: 'number', decimals: 3 } });
    expect(document.querySelector('.side-panel')).toBeNull();
  });

  it('submits the Number Format dialog from the currency symbol input', async () => {
    const promise = new Dialogs().chooseNumberFormat(null);
    const panel = document.querySelector('.side-panel')!;
    const kind = panel.querySelector<HTMLSelectElement>('#format-number-kind')!;
    kind.value = 'currency';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    const symbol = panel.querySelector<HTMLInputElement>('#format-number-symbol')!;
    symbol.value = '€';
    symbol.dispatchEvent(new Event('input', { bubbles: true }));

    enter(symbol);

    const result = await promise;
    expect(result).toMatchObject({ action: 'apply', format: { kind: 'currency', currencySymbol: '€' } });
  });

  it('submits the Conditional Format dialog from the value input', async () => {
    const promise = new Dialogs().chooseConditionalFormat({ rangeLabel: 'A1:A10', existing: null });
    const panel = document.querySelector('.side-panel')!;
    const value1 = panel.querySelector<HTMLInputElement>('#cf-value1')!;
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
    const panel = document.querySelector('.side-panel')!;
    const value1 = panel.querySelector<HTMLInputElement>('#cf-value1')!;
    value1.value = 'not-a-number';
    value1.dispatchEvent(new Event('input', { bubbles: true }));

    enter(value1);
    expect(document.querySelector('.side-panel')).not.toBeNull();

    panel.querySelector<HTMLButtonElement>('.side-panel-footer-close')!.click();
    expect(await promise).toBeNull();
  });

  it('keeps Apply disabled for a blank or whitespace-only numeric value (issue #339)', async () => {
    const promise = new Dialogs().chooseConditionalFormat({ rangeLabel: 'A1:A10', existing: null });
    const panel = document.querySelector('.side-panel')!;
    const value1 = panel.querySelector<HTMLInputElement>('#cf-value1')!;
    const applyBtn = panel.querySelector<HTMLButtonElement>('.dialog-buttons button.primary')!;

    // Freshly opened with the default "greater than" operator and a blank value.
    expect(applyBtn.disabled).toBe(true);

    value1.value = '   ';
    value1.dispatchEvent(new Event('input', { bubbles: true }));
    expect(applyBtn.disabled).toBe(true);

    value1.value = '10';
    value1.dispatchEvent(new Event('input', { bubbles: true }));
    expect(applyBtn.disabled).toBe(false);

    applyBtn.click();
    const result = await promise;
    expect(result).toMatchObject({
      action: 'apply',
      rule: { kind: 'cellValue', operator: 'greaterThan', value1: '10' },
    });
  });

  it('keeps Apply disabled for a "between" rule with a blank second value', async () => {
    const promise = new Dialogs().chooseConditionalFormat({ rangeLabel: 'A1:A10', existing: null });
    const panel = document.querySelector('.side-panel')!;
    const operator = panel.querySelector<HTMLSelectElement>('#cf-operator')!;
    const value1 = panel.querySelector<HTMLInputElement>('#cf-value1')!;
    const value2 = panel.querySelector<HTMLInputElement>('#cf-value2')!;
    const applyBtn = panel.querySelector<HTMLButtonElement>('.dialog-buttons button.primary')!;

    operator.value = 'between';
    operator.dispatchEvent(new Event('change', { bubbles: true }));
    value1.value = '1';
    value1.dispatchEvent(new Event('input', { bubbles: true }));
    expect(applyBtn.disabled).toBe(true); // value2 still blank

    value2.value = '  ';
    value2.dispatchEvent(new Event('input', { bubbles: true }));
    expect(applyBtn.disabled).toBe(true);

    value2.value = '10';
    value2.dispatchEvent(new Event('input', { bubbles: true }));
    expect(applyBtn.disabled).toBe(false);

    applyBtn.click();
    const result = await promise;
    expect(result).toMatchObject({
      action: 'apply',
      rule: { kind: 'cellValue', operator: 'between', value1: '1', value2: '10' },
    });
  });

  it('submits the Settings dialog from the max file size input', async () => {
    const promise = new Dialogs().chooseSettings({
      maxFileSize: 64 * 1024 * 1024,
      shiftPaste: 'values',
      browserDisplay: { zoom: undefined, wrap: undefined, font: undefined, look: {} },
      fileDisplay: null,
    });
    const dialog = document.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = '128';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    enter(input);

    const result = await promise;
    expect(result).toEqual({
      maxFileSize: clampMaxFileSize(miBToBytes(128)),
      shiftPaste: 'values',
      browserDisplay: { zoom: undefined, wrap: undefined, font: undefined, look: {} },
      fileDisplay: null,
    });
  });

  it('saves the Ctrl+Shift+V choice from the Settings dialog', async () => {
    const promise = new Dialogs().chooseSettings({
      maxFileSize: 64 * 1024 * 1024,
      shiftPaste: 'values',
      browserDisplay: { zoom: undefined, wrap: undefined, font: undefined, look: {} },
      fileDisplay: null,
    });
    const dialog = document.querySelector('dialog')!;
    const select = dialog.querySelector<HTMLSelectElement>('#settings-shift-paste')!;
    select.value = 'formats';
    enter(dialog.querySelector<HTMLInputElement>('input[type="number"]')!);

    expect(await promise).toEqual({
      maxFileSize: 64 * 1024 * 1024,
      shiftPaste: 'formats',
      browserDisplay: { zoom: undefined, wrap: undefined, font: undefined, look: {} },
      fileDisplay: null,
    });
  });

  it('edits the browser- and file-level zoom and wrap in the Settings dialog', async () => {
    const promise = new Dialogs().chooseSettings({
      maxFileSize: 64 * 1024 * 1024,
      shiftPaste: 'values',
      browserDisplay: { zoom: undefined, wrap: true, font: 'ms', look: {} },
      fileDisplay: { zoom: 133, wrap: undefined, font: undefined, look: {} },
    });
    const dialog = document.querySelector('dialog')!;
    expect(dialog.querySelector<HTMLSelectElement>('#settings-browser-wrap')!.value).toBe('on');
    // A stored non-preset file zoom is still offered and preselected.
    expect(dialog.querySelector<HTMLSelectElement>('#settings-file-zoom')!.value).toBe('133');
    dialog.querySelector<HTMLSelectElement>('#settings-browser-zoom')!.value = '150';
    dialog.querySelector<HTMLSelectElement>('#settings-browser-wrap')!.value = '';
    dialog.querySelector<HTMLSelectElement>('#settings-file-wrap')!.value = 'off';
    expect(dialog.querySelector<HTMLSelectElement>('#settings-browser-font')!.value).toBe('ms');
    dialog.querySelector<HTMLSelectElement>('#settings-browser-font')!.value = '';
    dialog.querySelector<HTMLSelectElement>('#settings-file-font')!.value = 'meiryo-ui';
    enter(dialog.querySelector<HTMLInputElement>('input[type="number"]')!);

    expect(await promise).toMatchObject({
      browserDisplay: { zoom: 150, wrap: undefined, font: undefined, look: {} },
      fileDisplay: { zoom: 133, wrap: false, font: 'meiryo-ui', look: {} },
    });
  });

  it('edits the grid look at the browser and file levels', async () => {
    const promise = new Dialogs().chooseSettings({
      maxFileSize: 64 * 1024 * 1024,
      shiftPaste: 'values',
      browserDisplay: {
        zoom: undefined,
        wrap: undefined,
        font: undefined,
        look: { bands: true, bandLevel: 2 },
      },
      fileDisplay: { zoom: undefined, wrap: undefined, font: undefined, look: { gridlines: false } },
    });
    const dialog = document.querySelector('dialog')!;
    const select = (id: string): HTMLSelectElement => dialog.querySelector<HTMLSelectElement>(`#${id}`)!;
    expect(select('settings-browser-bands').value).toBe('on');
    expect(select('settings-browser-bandLevel').value).toBe('2');
    expect(select('settings-file-gridlines').value).toBe('off');
    expect(select('settings-file-colHighlight').value).toBe('');
    select('settings-browser-bandLevel').value = '1';
    select('settings-browser-colHighlight').value = 'on';
    select('settings-file-gridlines').value = '';
    select('settings-file-rowHighlight').value = 'off';
    dialog
      .querySelector<HTMLInputElement>('input[type="number"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await promise).toMatchObject({
      browserDisplay: { look: { bands: true, bandLevel: 1, colHighlight: true } },
      fileDisplay: { look: { rowHighlight: false } },
    });
  });

  it('omits the file level from the Settings dialog when no RSF file is active', async () => {
    const promise = new Dialogs().chooseSettings({
      maxFileSize: 64 * 1024 * 1024,
      shiftPaste: 'values',
      browserDisplay: { zoom: undefined, wrap: undefined, font: undefined, look: {} },
      fileDisplay: null,
    });
    const dialog = document.querySelector('dialog')!;
    expect(dialog.querySelector('#settings-file-zoom')).toBeNull();
    enter(dialog.querySelector<HTMLInputElement>('input[type="number"]')!);
    expect((await promise)?.fileDisplay).toBeNull();
  });

  it('still submits the sheet-name prompt on Enter after sharing the helper', async () => {
    const promise = new Dialogs().promptSheetName('add', 'Sheet1', () => null);
    const dialog = document.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.value = 'Renamed';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    enter(input);

    expect(await promise).toEqual({ name: 'Renamed', kind: 'grid' });
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
