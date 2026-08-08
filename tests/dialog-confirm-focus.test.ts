// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Confirmation dialogs must default to the safe (non-destructive) action so
 * a reflexive Enter press never loses data (issue #295). `Dialogs.confirm()`
 * backs Delete Rows, Delete Columns, and the non-CSV open prompt; it now
 * autofocuses Cancel and gives the affirmative button `primary` styling,
 * matching `confirmDeleteSheet`/`confirmRangeMoveOverwrite`/
 * `confirmReplaceAllWorkbook`. `confirmUnrepresentable` previously inverted
 * this relative to its sibling `confirmUndecodableEdit`; it now matches too.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';

describe('confirmation dialogs default to the safe action', () => {
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

  it('autofocuses Cancel and styles OK as primary in Dialogs.confirm()', async () => {
    const promise = new Dialogs().confirm('Delete rows', 'Delete 3 rows?', 'Delete', 'Cancel');
    const dialog = document.querySelector('dialog')!;
    const buttons = dialog.querySelectorAll<HTMLButtonElement>('.dialog-buttons button');
    expect(buttons).toHaveLength(2);

    const [cancelButton, okButton] = buttons;
    expect(cancelButton.textContent).toBe('Cancel');
    expect(cancelButton.hasAttribute('data-autofocus')).toBe(true);
    expect(cancelButton.classList.contains('primary')).toBe(false);

    expect(okButton.textContent).toBe('Delete');
    expect(okButton.hasAttribute('data-autofocus')).toBe(false);
    expect(okButton.classList.contains('primary')).toBe(true);

    okButton.click();
    expect(await promise).toBe(true);
  });

  it('autofocuses Cancel and styles Continue as primary in confirmUnrepresentable, matching confirmUndecodableEdit', async () => {
    const promise = new Dialogs().confirmUnrepresentable('Shift-JIS', [{ row: 0, col: 0, chars: ['€'] }]);
    const dialog = document.querySelector('dialog')!;
    const buttons = dialog.querySelectorAll<HTMLButtonElement>('.dialog-buttons button');
    expect(buttons).toHaveLength(2);

    const [cancelButton, continueButton] = buttons;
    expect(cancelButton.hasAttribute('data-autofocus')).toBe(true);
    expect(cancelButton.classList.contains('primary')).toBe(false);

    expect(continueButton.hasAttribute('data-autofocus')).toBe(false);
    expect(continueButton.classList.contains('primary')).toBe(true);

    cancelButton.click();
    expect(await promise).toBe(false);
  });
});
