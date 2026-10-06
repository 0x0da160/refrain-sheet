// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Every dialog follows the design system's layout rules: one of three widths
 * (D-50), the side panels' form layout in its body with labels above
 * full-width fields (D-47), and the footer's committing button last, Cancel
 * just before it, any other action marked to stand at the far left (D-49).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../../src/app/i18n';
import { Dialogs } from '../../src/ui/dialogs';

const locale = getLocale();
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

const dialog = (): HTMLDialogElement => document.querySelector('dialog')!;
const footer = (): HTMLButtonElement[] =>
  Array.from(dialog().querySelectorAll<HTMLButtonElement>('.dialog-buttons button'));

describe('dialog layout', () => {
  it('sizes a confirmation small and lays its body out as a form', () => {
    void new Dialogs().confirm('Delete rows', 'Delete 3 rows?', 'Delete', 'Cancel');
    expect(dialog().dataset.size).toBe('sm');
    expect(dialog().querySelector('.dialog-body')?.classList.contains('form-layout')).toBe(true);
    expect(footer().map((b) => b.textContent)).toEqual(['Cancel', 'Delete']);
  });

  it('puts Discard apart at the far left, Cancel before Save', () => {
    void new Dialogs().confirmUnsaved(['a.csv']);
    const buttons = footer();
    expect(buttons.map((b) => b.textContent)).toEqual([
      t('dialog.unsaved.discard'),
      t('dialog.unsaved.cancel'),
      t('dialog.unsaved.save'),
    ]);
    expect(buttons[0].classList.contains('dialog-button-start')).toBe(true);
    expect(buttons[2].classList.contains('primary')).toBe(true);
  });

  it('labels fields above their control, as the side panels do', () => {
    void new Dialogs().promptRowHeight(24);
    const field = dialog().querySelector('.form-field')!;
    const label = field.querySelector('label')!;
    const input = field.querySelector('input')!;
    expect(label.getAttribute('for')).toBe(input.id);
    expect(label.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer()[0].textContent).toBe(t('dialog.rowHeight.auto'));
    expect(footer()[0].classList.contains('dialog-button-start')).toBe(true);
  });

  it('opens Settings large', () => {
    void new Dialogs().chooseSettings({
      maxFileSize: 64 * 1024 * 1024,
      shiftPaste: 'values',
      showToolbar: true,
      showPets: false,
      browserDisplay: { zoom: undefined, wrap: undefined, font: undefined, look: {} },
      fileDisplay: null,
    });
    expect(dialog().dataset.size).toBe('lg');
    expect(dialog().querySelector('.form-row')).toBeNull();
  });
});
