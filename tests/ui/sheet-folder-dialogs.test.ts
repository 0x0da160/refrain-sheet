// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The sheet folder dialogs: the folder name prompt validates as you type,
 * and Move to Folder preselects where the item is now and resolves with the
 * chosen place.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../../src/app/i18n';
import { Dialogs } from '../../src/ui/dialogs';

function button(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find(
    (b) => b.textContent === label,
  )!;
}

describe('sheet folder dialogs', () => {
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

  it('asks for a folder name, blocking an empty one', async () => {
    const result = new Dialogs().promptFolderName('create', 'New Folder', (name) =>
      name.trim() ? null : 'Enter a folder name.',
    );
    const input = document.querySelector<HTMLInputElement>('#folder-name-input')!;
    const ok = button(t('dialog.folderName.ok.create'));
    expect(input.value).toBe('New Folder');
    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    expect(ok.disabled).toBe(true);
    expect(document.querySelector('#folder-name-error')!.textContent).toBe('Enter a folder name.');
    input.value = ' Sales ';
    input.dispatchEvent(new Event('input'));
    ok.click();
    await expect(result).resolves.toBe('Sales');
  });

  it('moves to the chosen folder, with the current place preselected', async () => {
    const result = new Dialogs().chooseFolder({
      subject: 'sheet',
      name: 'Q1',
      current: 'f1',
      options: [
        { id: null, name: '(Not in a folder)', depth: 0 },
        { id: 'f1', name: 'Sales', depth: 0 },
        { id: 'f2', name: '2026', depth: 1 },
      ],
    });
    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('.folder-picker input[type="radio"]'),
    );
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    expect(document.querySelector('.dialog-title')!.textContent).toBe(
      t('dialog.moveToFolder.title.sheet', { name: 'Q1' }),
    );
    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change'));
    button(t('dialog.moveToFolder.ok')).click();
    await expect(result).resolves.toEqual({ folderId: null });
  });

  it('changes nothing when Move to Folder is cancelled', async () => {
    const result = new Dialogs().chooseFolder({
      subject: 'folder',
      name: 'Sales',
      current: null,
      options: [{ id: null, name: '(Not in a folder)', depth: 0 }],
    });
    button(t('dialog.moveToFolder.cancel')).click();
    await expect(result).resolves.toBeNull();
  });
});
