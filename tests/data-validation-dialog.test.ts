// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The data-validation dialog (`Dialogs.chooseDataValidation`): the list rule
 * silently kept only the first `MAX_VALIDATION_LIST_VALUES` values with no
 * indication anything was dropped. See #296. Mirrors the truncation-notice
 * pattern already used by `chooseFilter`'s distinct-value list, tested in
 * `filter-popover.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataValidationDialogInput } from '../src/app/commands';
import { getLocale, setLocale, t } from '../src/app/i18n';
import { MAX_VALIDATION_LIST_VALUES } from '../src/core/data-validation';
import { Dialogs } from '../src/ui/dialogs';

function dataValidationInput(overrides: Partial<DataValidationDialogInput> = {}): DataValidationDialogInput {
  return {
    rangeLabel: 'A1:A20',
    existing: null,
    ...overrides,
  };
}

function dialogButton(dialog: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!button) {
    throw new Error(`button "${label}" not found`);
  }
  return button;
}

describe('the data-validation dialog list rule', () => {
  const locale = getLocale();

  // jsdom does not implement <dialog>.showModal(); the shim only needs to
  // make the element "open" so its content is queryable (see branding.test.ts).
  beforeEach(() => {
    document.body.textContent = '';
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
    document.querySelectorAll('dialog').forEach((n) => n.remove());
  });

  it('shows no truncation note and applies every value when within the cap', async () => {
    const dialogs = new Dialogs();
    const promise = dialogs.chooseDataValidation(dataValidationInput());
    const dialog = document.querySelector<HTMLElement>('dialog')!;

    const listValues = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    listValues.value = 'a\nb\nc';
    listValues.dispatchEvent(new Event('input', { bubbles: true }));

    expect(dialog.querySelector('.dialog-error')?.textContent).toBe('');
    const noteTexts = Array.from(dialog.querySelectorAll('.dialog-note')).map((n) => n.textContent);
    expect(noteTexts).not.toContain(
      t('dialog.dataValidation.listTruncated', { n: MAX_VALIDATION_LIST_VALUES }),
    );

    dialogButton(dialog, t('dialog.dataValidation.apply')).click();
    const result = await promise;
    expect(result).toMatchObject({ action: 'apply', rule: { kind: 'list', values: ['a', 'b', 'c'] } });
  });

  it('shows a truncation note and keeps only the first values when the cap is exceeded', async () => {
    const dialogs = new Dialogs();
    const promise = dialogs.chooseDataValidation(dataValidationInput());
    const dialog = document.querySelector<HTMLElement>('dialog')!;

    const values = Array.from({ length: MAX_VALIDATION_LIST_VALUES + 100 }, (_, i) => `v${i}`);
    const listValues = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    listValues.value = values.join('\n');
    listValues.dispatchEvent(new Event('input', { bubbles: true }));

    const expectedNote = t('dialog.dataValidation.listTruncated', { n: MAX_VALIDATION_LIST_VALUES });
    const noteTexts = Array.from(dialog.querySelectorAll('.dialog-note')).map((n) => n.textContent);
    expect(noteTexts).toContain(expectedNote);
    // Apply is not blocked by truncation itself — only the missing-rule case is.
    expect(dialogButton(dialog, t('dialog.dataValidation.apply')).disabled).toBe(false);

    dialogButton(dialog, t('dialog.dataValidation.apply')).click();
    const result = await promise;
    expect(result).toMatchObject({ action: 'apply' });
    if (result?.action === 'apply' && result.rule.kind === 'list') {
      expect(result.rule.values).toHaveLength(MAX_VALIDATION_LIST_VALUES);
      expect(result.rule.values[0]).toBe('v0');
      expect(result.rule.values[MAX_VALIDATION_LIST_VALUES - 1]).toBe(`v${MAX_VALIDATION_LIST_VALUES - 1}`);
    } else {
      throw new Error('expected an applied list rule');
    }
  });

  it('clears the truncation note again once the list is trimmed back under the cap', async () => {
    const dialogs = new Dialogs();
    const promise = dialogs.chooseDataValidation(dataValidationInput());
    const dialog = document.querySelector<HTMLElement>('dialog')!;

    const values = Array.from({ length: MAX_VALIDATION_LIST_VALUES + 5 }, (_, i) => `v${i}`);
    const listValues = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    listValues.value = values.join('\n');
    listValues.dispatchEvent(new Event('input', { bubbles: true }));
    const expectedNote = t('dialog.dataValidation.listTruncated', { n: MAX_VALIDATION_LIST_VALUES });
    expect(Array.from(dialog.querySelectorAll('.dialog-note')).map((n) => n.textContent)).toContain(
      expectedNote,
    );

    listValues.value = 'a\nb';
    listValues.dispatchEvent(new Event('input', { bubbles: true }));
    expect(Array.from(dialog.querySelectorAll('.dialog-note')).map((n) => n.textContent)).not.toContain(
      expectedNote,
    );

    dialog.dispatchEvent(new Event('cancel'));
    await promise;
  });
});
