// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Each open dialog is named by its own heading. A fixed id made every
 * `aria-labelledby` resolve to the first heading with that id in the page, so
 * a dialog opened from another one was announced with the first one's title.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDialog } from '../../src/ui/dialogs/shared';

describe('dialog titles', () => {
  // jsdom does not implement <dialog>.showModal(); the shim only needs to make the element "open".
  beforeEach(() => {
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
    document.querySelectorAll('dialog').forEach((d) => d.remove());
  });

  it('names each open dialog by its own heading', () => {
    void openDialog('First', null, () => undefined);
    void openDialog('Second', null, () => undefined);
    const dialogs = Array.from(document.querySelectorAll('dialog'));
    expect(dialogs).toHaveLength(2);
    const headings = dialogs.map((dialog) => {
      const heading = dialog.querySelector<HTMLElement>('.dialog-title');
      expect(heading).not.toBeNull();
      expect(dialog.getAttribute('aria-labelledby')).toBe(heading!.id);
      return heading!;
    });
    expect(headings.map((h) => h.textContent)).toEqual(['First', 'Second']);
    expect(headings[0].id).not.toBe(headings[1].id);
  });
});
