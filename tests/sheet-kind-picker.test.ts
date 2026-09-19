// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The worksheet-kind picker in the Add-worksheet dialog (#557):
 * `promptSheetName`'s `kindOptions` renders a radio group (grid/Markdown/
 * JSON/YAML/text) above the name field, re-suggests the name as the kind
 * changes until the user types one of their own, and resolves with the
 * chosen `{ name, kind }` pair. `mode !== 'add'` (or `mode === 'add'`
 * without `kindOptions`) renders no picker at all, matching the pre-#557
 * behavior exactly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';

function enter(el: Element): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('promptSheetName kind picker', () => {
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

  it('renders no kind picker when kindOptions is omitted, even in add mode', () => {
    void new Dialogs().promptSheetName('add', 'Sheet1', () => null);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it('renders no kind picker for rename or duplicate, even if a caller mistakenly passed kindOptions', () => {
    // `kindOptions` isn't restricted to `mode === 'add'` at the type level
    // (nothing stops a caller from passing it alongside another mode), so
    // the dialog itself guards on mode directly — this is the behavior that
    // actually keeps a rename/duplicate prompt from growing a picker it has
    // no business showing.
    void new Dialogs().promptSheetName('rename', 'Sheet1', () => null, {
      initialKind: 'grid',
      suggestName: () => 'ignored',
    });
    const dialog = document.querySelector('dialog')!;
    expect(dialog.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it('renders one radio per worksheet kind, defaulting to initialKind', () => {
    void new Dialogs().promptSheetName('add', 'Sheet1', () => null, {
      initialKind: 'grid',
      suggestName: (kind) => `suggested-${kind}`,
    });
    const dialog = document.querySelector('dialog')!;
    const radios = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(5);
    expect(radios.map((r) => r.value)).toEqual(['grid', 'markdown', 'json', 'yaml', 'text']);
    expect(radios.find((r) => r.value === 'grid')!.checked).toBe(true);
    expect(radios.filter((r) => r.checked)).toHaveLength(1);
  });

  it('labels each option with its localized worksheet-kind name', () => {
    void new Dialogs().promptSheetName('add', 'Sheet1', () => null, {
      initialKind: 'grid',
      suggestName: () => '',
    });
    const dialog = document.querySelector('dialog')!;
    const labels = Array.from(dialog.querySelectorAll('.sheet-kind-picker-option')).map(
      (label) => label.textContent,
    );
    expect(labels).toEqual([
      t('sheets.kind.grid'),
      t('sheets.kind.markdown'),
      t('sheets.kind.json'),
      t('sheets.kind.yaml'),
      t('sheets.kind.text'),
    ]);
  });

  it('re-suggests the name when the kind changes, as long as the user has not typed one', async () => {
    const promise = new Dialogs().promptSheetName('add', 'Sheet1', () => null, {
      initialKind: 'grid',
      suggestName: (kind) => `Suggested-${kind}`,
    });
    const dialog = document.querySelector('dialog')!;
    const nameInput = dialog.querySelector<HTMLInputElement>('.sheet-name-input')!;
    expect(nameInput.value).toBe('Sheet1');

    const jsonRadio = dialog.querySelector<HTMLInputElement>('input[type="radio"][value="json"]')!;
    jsonRadio.checked = true;
    jsonRadio.dispatchEvent(new Event('change', { bubbles: true }));
    expect(nameInput.value).toBe('Suggested-json');

    const yamlRadio = dialog.querySelector<HTMLInputElement>('input[type="radio"][value="yaml"]')!;
    yamlRadio.checked = true;
    yamlRadio.dispatchEvent(new Event('change', { bubbles: true }));
    expect(nameInput.value).toBe('Suggested-yaml');

    enter(nameInput);
    expect(await promise).toEqual({ name: 'Suggested-yaml', kind: 'yaml' });
  });

  it('stops re-suggesting the name once the user has typed their own', async () => {
    const promise = new Dialogs().promptSheetName('add', 'Sheet1', () => null, {
      initialKind: 'grid',
      suggestName: (kind) => `Suggested-${kind}`,
    });
    const dialog = document.querySelector('dialog')!;
    const nameInput = dialog.querySelector<HTMLInputElement>('.sheet-name-input')!;

    nameInput.value = 'My Custom Name';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    const textRadio = dialog.querySelector<HTMLInputElement>('input[type="radio"][value="text"]')!;
    textRadio.checked = true;
    textRadio.dispatchEvent(new Event('change', { bubbles: true }));

    // The kind change is still recorded even though the name is left alone.
    expect(nameInput.value).toBe('My Custom Name');

    enter(nameInput);
    expect(await promise).toEqual({ name: 'My Custom Name', kind: 'text' });
  });

  it('resolves the default (grid) kind unchanged when the user never touches the picker', async () => {
    const promise = new Dialogs().promptSheetName('add', 'Sheet2', () => null, {
      initialKind: 'grid',
      suggestName: (kind) => `Suggested-${kind}`,
    });
    const dialog = document.querySelector('dialog')!;
    const nameInput = dialog.querySelector<HTMLInputElement>('.sheet-name-input')!;

    enter(nameInput);
    expect(await promise).toEqual({ name: 'Sheet2', kind: 'grid' });
  });
});
