// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The password prompt for an encrypted `.rsf` file: it names the file, masks
 * the input, keeps OK disabled until something is typed, submits on Enter
 * (never during an IME composition), returns the password exactly as typed,
 * and gives no password on Cancel or Escape.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../../src/app/i18n';
import { Dialogs } from '../../src/ui/dialogs';

function dialogEl(): HTMLDialogElement {
  return document.querySelector<HTMLDialogElement>('dialog')!;
}

function passwordInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('dialog input')!;
}

function button(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find(
    (b) => b.textContent === label,
  )!;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function enter(input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('Password prompt for an encrypted .rsf file', () => {
  const locale = getLocale();

  // jsdom does not implement <dialog>.showModal(); make the element "open" so
  // its content is queryable (as in sheet-tab-color-dialog.test.ts).
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

  it('names the file, masks the input, and gives no password on Cancel', async () => {
    const promise = new Dialogs().promptRsfPassword('book.rsf', false);
    expect(dialogEl().textContent).toContain(t('dialog.rsfPassword.message', { name: 'book.rsf' }));
    expect(passwordInput().getAttribute('type')).toBe('password');
    expect(passwordInput().getAttribute('autocomplete')).toBe('current-password');
    button(t('dialog.rsfPassword.cancel')).click();
    expect(await promise).toBeNull();
  });

  it('keeps OK disabled until a password is typed', () => {
    void new Dialogs().promptRsfPassword('book.rsf', false);
    const ok = button(t('dialog.rsfPassword.ok'));
    expect(ok.disabled).toBe(true);
    type(passwordInput(), 'x');
    expect(ok.disabled).toBe(false);
    type(passwordInput(), '');
    expect(ok.disabled).toBe(true);
  });

  it('returns the password exactly as typed, without trimming it', async () => {
    const promise = new Dialogs().promptRsfPassword('book.rsf', false);
    type(passwordInput(), '  spaced pass phrase  ');
    enter(passwordInput());
    expect(await promise).toBe('  spaced pass phrase  ');
  });

  it('ignores Enter during an IME composition, and submits once it ends', async () => {
    const promise = new Dialogs().promptRsfPassword('book.rsf', false);
    const input = passwordInput();
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    type(input, 'かな');
    enter(input);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    input.dispatchEvent(new Event('compositionend', { bubbles: true }));
    enter(input);
    expect(await promise).toBe('かな');
  });

  it('gives no password on Escape, even with text typed', async () => {
    const promise = new Dialogs().promptRsfPassword('book.rsf', false);
    type(passwordInput(), 'typed but not confirmed');
    dialogEl().dispatchEvent(new Event('cancel'));
    expect(await promise).toBeNull();
  });

  it('says the last password was refused only when asked again', () => {
    void new Dialogs().promptRsfPassword('book.rsf', false);
    expect(dialogEl().textContent).not.toContain(t('dialog.rsfPassword.retry'));
    document.querySelectorAll('dialog').forEach((d) => d.remove());
    void new Dialogs().promptRsfPassword('book.rsf', true);
    expect(dialogEl().textContent).toContain(t('dialog.rsfPassword.retry'));
  });
});
