// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The new password prompt for encrypting an .rsf file: the password must be long
 * enough and not too long, it is typed twice, and the two entries must match
 * after Unicode normalization. Enter confirms once it is valid. Cancel and Escape
 * give no password, and the password comes back exactly as typed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../../src/app/i18n';
import { Dialogs } from '../../src/ui/dialogs';

function dialogEl(): HTMLDialogElement {
  return document.querySelector<HTMLDialogElement>('dialog')!;
}

function inputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('dialog input'));
}

function button(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find(
    (b) => b.textContent === label,
  )!;
}

function okButton(): HTMLButtonElement {
  return button(t('dialog.rsfEncrypt.ok'));
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function enter(input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('New password prompt for an encrypted .rsf file', () => {
  const locale = getLocale();

  // jsdom does not implement <dialog>.showModal(); make the element "open" so
  // its content is queryable (as in rsf-password-dialog.test.ts).
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

  it('names the file, warns that a lost password cannot be recovered, and starts with OK disabled', () => {
    void new Dialogs().promptNewRsfPassword('book.rsf');
    expect(dialogEl().textContent).toContain(t('dialog.rsfEncrypt.message', { name: 'book.rsf' }));
    expect(dialogEl().textContent).toContain(t('dialog.rsfEncrypt.warning'));
    expect(inputs()).toHaveLength(2);
    for (const input of inputs()) {
      expect(input.getAttribute('type')).toBe('password');
      expect(input.getAttribute('autocomplete')).toBe('new-password');
    }
    expect(okButton().disabled).toBe(true);
  });

  it('keeps OK disabled while the password is too short, and says how long it must be', () => {
    void new Dialogs().promptNewRsfPassword('book.rsf');
    const [first, second] = inputs();
    type(first, 'short');
    type(second, 'short');
    expect(okButton().disabled).toBe(true);
    expect(dialogEl().textContent).toContain(t('dialog.rsfEncrypt.tooShort', { count: '12' }));
  });

  it('keeps OK disabled while the entries differ, and enables it once they match', () => {
    void new Dialogs().promptNewRsfPassword('book.rsf');
    const [first, second] = inputs();
    type(first, 'correct horse battery');
    type(second, 'correct horse batter');
    expect(okButton().disabled).toBe(true);
    expect(dialogEl().textContent).toContain(t('dialog.rsfEncrypt.mismatch'));
    type(second, 'correct horse battery');
    expect(okButton().disabled).toBe(false);
    expect(dialogEl().textContent).not.toContain(t('dialog.rsfEncrypt.mismatch'));
  });

  it('accepts entries that match after Unicode normalization, and returns the first as typed', async () => {
    const promise = new Dialogs().promptNewRsfPassword('book.rsf');
    const [first, second] = inputs();
    type(first, 'café passphrase'); // é as one code point
    type(second, 'café passphrase'); // e and a combining acute accent
    expect(okButton().disabled).toBe(false);
    okButton().click();
    expect(await promise).toBe('café passphrase');
  });

  it('returns the password exactly as typed, without trimming it', async () => {
    const promise = new Dialogs().promptNewRsfPassword('book.rsf');
    const [first, second] = inputs();
    type(first, '  spaced pass phrase  ');
    type(second, '  spaced pass phrase  ');
    enter(second);
    expect(await promise).toBe('  spaced pass phrase  ');
  });

  it('confirms with Enter only once the entries are valid', async () => {
    const promise = new Dialogs().promptNewRsfPassword('book.rsf');
    const [first, second] = inputs();
    type(first, 'twelve chars!');
    type(second, 'not the same');
    enter(second);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    type(second, 'twelve chars!');
    enter(second);
    expect(await promise).toBe('twelve chars!');
  });

  it('refuses a password longer than the byte limit', () => {
    void new Dialogs().promptNewRsfPassword('book.rsf');
    const [first, second] = inputs();
    const long = 'a'.repeat(1025);
    type(first, long);
    type(second, long);
    expect(okButton().disabled).toBe(true);
    expect(dialogEl().textContent).toContain(t('dialog.rsfEncrypt.tooLong'));
  });

  it('gives no password on Cancel, even with a valid password typed', async () => {
    const promise = new Dialogs().promptNewRsfPassword('book.rsf');
    const [first, second] = inputs();
    type(first, 'correct horse battery');
    type(second, 'correct horse battery');
    button(t('dialog.rsfPassword.cancel')).click();
    expect(await promise).toBeNull();
  });

  it('gives no password on Escape, even with a valid password typed', async () => {
    const promise = new Dialogs().promptNewRsfPassword('book.rsf');
    const [first, second] = inputs();
    type(first, 'correct horse battery');
    type(second, 'correct horse battery');
    dialogEl().dispatchEvent(new Event('cancel'));
    expect(await promise).toBeNull();
  });
});
