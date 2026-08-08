// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Closing a modal dialog restores focus to whatever triggered it (issue #298).
 * `openPopover` (src/ui/dialogs/shared.ts) already did this; `openDialog` did
 * not, so every menu-driven modal (Format Cells, Sort, Settings, etc.) dropped
 * keyboard focus to <body> on close.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';

describe('closing a dialog restores focus', () => {
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
    document.body.innerHTML = '';
  });

  it('returns focus to the element that was focused before the dialog opened', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const promise = new Dialogs().promptGoToCell('A1', () => null);
    const dialog = document.querySelector('dialog')!;
    expect(document.activeElement).not.toBe(trigger);

    dialog.querySelector<HTMLButtonElement>('.dialog-buttons button')!.click();
    await promise;

    expect(document.activeElement).toBe(trigger);
  });

  it('does not restore focus to an element that was removed from the document while open', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const promise = new Dialogs().promptGoToCell('A1', () => null);
    const dialog = document.querySelector('dialog')!;
    trigger.remove();

    dialog.querySelector<HTMLButtonElement>('.dialog-buttons button')!.click();
    await promise;

    expect(document.activeElement).not.toBe(trigger);
  });
});
