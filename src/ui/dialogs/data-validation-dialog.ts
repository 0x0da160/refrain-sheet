// SPDX-License-Identifier: MIT
/**
 * The data-validation side panel (Data > Data Validation…): the rule kind (a
 * list of values, a number, a text length, or a date) and its parameters,
 * whether a blank cell is allowed, and whether the rule covers the selected
 * columns to the last row (a column rule, optionally below a header row).
 */
import type { ApplyHandler, DataValidationDialogInput, DataValidationDialogResult } from '../../app/commands';
import { t } from '../../app/i18n';
import {
  MAX_VALIDATION_LIST_VALUES,
  MAX_VALIDATION_TEXT_LENGTH,
  isIsoDate,
  type ValidationRule,
} from '../../core/workbook/data-validation';
import { el } from '../dom';
import { CheckSquare } from 'lucide';
import { dialogButton } from './shared';
import { openSidePanel } from './side-panel';
import { formCheck, formField, formSection, formGrid } from './form-layout';

type Kind = ValidationRule['kind'];
const KINDS: readonly Kind[] = ['list', 'number', 'textLength', 'date'];

/**
 * The Apply button stays disabled, with an inline explanation, until the
 * current fields describe a usable rule. Resolves with the chosen action, or
 * null when cancelled (nothing changes).
 */
export function chooseDataValidation(
  input: DataValidationDialogInput,
  onApply?: ApplyHandler<DataValidationDialogResult>,
): Promise<DataValidationDialogResult | null> {
  return openSidePanel<DataValidationDialogResult | null>(
    { title: t('dialog.dataValidation.title'), icon: CheckSquare, fallback: null, onApply },
    (body, buttons, apply) => {
      const lead = el('p', { className: 'form-lead' });
      const kinds = kindChoice(input.existing?.kind ?? 'list');
      const fields = ruleFields(input.existing);
      const options = optionFields(input);
      const error = el('p', { className: 'dialog-error', attrs: { role: 'status', 'aria-live': 'polite' } });
      body.append(lead, kinds.section, ...KINDS.map((kind) => fields.sections[kind]), options.section, error);

      const applyBtn = dialogButton(t('dialog.dataValidation.apply'), true, false, () => {
        const { rule } = fields.build(kinds.current());
        if (rule) {
          apply({ action: 'apply', rule, ...options.result() });
        }
      });

      const refresh = (): void => {
        const current = kinds.current();
        for (const kind of KINDS) {
          fields.sections[kind].hidden = kind !== current;
        }
        const columns = options.columns();
        options.headerCheck.disabled = columns === null;
        lead.textContent =
          columns === null
            ? t('dialog.dataValidation.range', { range: input.rangeLabel })
            : t('dialog.dataValidation.columnsRange', { columns });
        const { rule, truncated } = fields.build(current);
        error.textContent = rule ? '' : t(`dialog.dataValidation.incomplete.${current}`);
        applyBtn.disabled = rule === null;
        fields.listTruncatedNote.textContent = truncated
          ? t('dialog.dataValidation.listTruncated', { n: MAX_VALIDATION_LIST_VALUES })
          : '';
      };
      for (const control of [...kinds.radios, ...fields.controls, options.columnsCheck]) {
        control.addEventListener('input', refresh);
        control.addEventListener('change', refresh);
      }
      refresh();

      if (input.existing) {
        buttons.append(
          dialogButton(t('dialog.dataValidation.clear'), false, false, () => apply({ action: 'clear' })),
        );
      }
      buttons.append(applyBtn);
    },
  );
}

/** The rule-kind radio group. */
function kindChoice(initial: Kind): {
  section: HTMLElement;
  radios: HTMLInputElement[];
  current: () => Kind;
} {
  const label: Record<Kind, string> = {
    list: t('dialog.dataValidation.kindList'),
    number: t('dialog.dataValidation.kindNumber'),
    textLength: t('dialog.dataValidation.kindTextLength'),
    date: t('dialog.dataValidation.kindDate'),
  };
  const radios = KINDS.map((kind) => {
    const radio = el('input', {
      attrs: { type: 'radio', name: 'validation-kind', id: `validation-kind-${kind}` },
    }) as HTMLInputElement;
    radio.checked = kind === initial;
    return radio;
  });
  const section = formSection(null, [
    el(
      'div',
      { className: 'form-choices', attrs: { role: 'radiogroup' } },
      KINDS.map((kind, i) => formCheck(radios[i], label[kind])),
    ),
  ]);
  return { section, radios, current: () => KINDS[radios.findIndex((r) => r.checked)] ?? 'list' };
}

/**
 * One section of parameters per kind, preloaded from `existing`, and
 * `build(kind)`: the rule they describe (null when incomplete) and whether a
 * list was cut to {@link MAX_VALIDATION_LIST_VALUES}.
 */
function ruleFields(existing: ValidationRule | null): {
  sections: Record<Kind, HTMLElement>;
  controls: HTMLElement[];
  listTruncatedNote: HTMLElement;
  build: (kind: Kind) => { rule: ValidationRule | null; truncated: boolean };
} {
  const listValues = el('textarea', {
    className: 'validation-list-values',
    attrs: { rows: '6', 'aria-label': t('dialog.dataValidation.listValues'), 'data-autofocus': 'true' },
  }) as HTMLTextAreaElement;
  if (existing?.kind === 'list') {
    listValues.value = existing.values.join('\n');
  }
  const listTruncatedNote = el('p', { className: 'dialog-note' });
  const numberMin = boundInput('number', t('dialog.dataValidation.min'));
  const numberMax = boundInput('number', t('dialog.dataValidation.max'));
  const integerCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  const lengthMin = boundInput('number', t('dialog.dataValidation.minLength'));
  const lengthMax = boundInput('number', t('dialog.dataValidation.maxLength'));
  lengthMin.min = lengthMax.min = '0';
  lengthMin.step = lengthMax.step = '1';
  const dateMin = boundInput('date', t('dialog.dataValidation.minDate'));
  const dateMax = boundInput('date', t('dialog.dataValidation.maxDate'));
  if (existing && existing.kind !== 'list') {
    const [min, max] =
      existing.kind === 'number'
        ? [numberMin, numberMax]
        : existing.kind === 'textLength'
          ? [lengthMin, lengthMax]
          : [dateMin, dateMax];
    min.value = existing.min === null ? '' : String(existing.min);
    max.value = existing.max === null ? '' : String(existing.max);
    integerCheck.checked = existing.kind === 'number' && existing.integer === true;
  }
  const pair = (min: HTMLInputElement, max: HTMLInputElement): HTMLElement =>
    formGrid([
      formField(min.getAttribute('aria-label') ?? '', min),
      formField(max.getAttribute('aria-label') ?? '', max),
    ]);
  const sections: Record<Kind, HTMLElement> = {
    list: formSection(null, [
      formField(t('dialog.dataValidation.listValues'), listValues, t('dialog.dataValidation.listHint')),
      listTruncatedNote,
    ]),
    number: formSection(null, [
      pair(numberMin, numberMax),
      formCheck(integerCheck, t('dialog.dataValidation.integer')),
    ]),
    textLength: formSection(null, [pair(lengthMin, lengthMax)]),
    date: formSection(null, [
      pair(dateMin, dateMax),
      el('p', { className: 'dialog-note', text: t('dialog.dataValidation.dateHint') }),
    ]),
  };
  const build = (kind: Kind): { rule: ValidationRule | null; truncated: boolean } => {
    switch (kind) {
      case 'list':
        return parseListRule(listValues.value);
      case 'number':
        return {
          rule: parseNumberRule(numberMin.value, numberMax.value, integerCheck.checked),
          truncated: false,
        };
      case 'textLength':
        return { rule: parseTextLengthRule(lengthMin.value, lengthMax.value), truncated: false };
      case 'date':
        return { rule: parseDateRule(dateMin.value, dateMax.value), truncated: false };
    }
  };
  const controls = [listValues, numberMin, numberMax, integerCheck, lengthMin, lengthMax, dateMin, dateMax];
  return { sections, controls, listTruncatedNote, build };
}

/** Whether blanks are allowed, and the whole-column choice when the input offers one. */
function optionFields(input: DataValidationDialogInput): {
  section: HTMLElement;
  columnsCheck: HTMLInputElement;
  headerCheck: HTMLInputElement;
  /** The columns' label when the rule is a column rule, else null. */
  columns: () => string | null;
  result: () => { required?: boolean; columns?: { headerRow: boolean } };
} {
  const requiredCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  requiredCheck.checked = input.required === true;
  const options: Node[] = [formCheck(requiredCheck, t('dialog.dataValidation.required'))];
  const columnsCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  const headerCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  if (input.columns) {
    columnsCheck.checked = input.columns.checked;
    headerCheck.checked = input.columns.headerRow;
    options.push(
      formCheck(columnsCheck, t('dialog.dataValidation.wholeColumns', { columns: input.columns.label })),
      formCheck(headerCheck, t('dialog.dataValidation.skipHeader')),
    );
  }
  const columns = (): string | null => (input.columns && columnsCheck.checked ? input.columns.label : null);
  return {
    section: formSection(null, options),
    columnsCheck,
    headerCheck,
    columns,
    result: () => ({
      ...(requiredCheck.checked ? { required: true } : {}),
      ...(columns() !== null ? { columns: { headerRow: headerCheck.checked } } : {}),
    }),
  };
}

function boundInput(type: 'number' | 'date', label: string): HTMLInputElement {
  return el('input', { attrs: { type, 'aria-label': label } }) as HTMLInputElement;
}

/**
 * A list rule from one value per line: trimmed, blank lines and duplicates
 * dropped, at most `MAX_VALIDATION_LIST_VALUES` kept (`truncated` says whether
 * more distinct values were given). Null when no value remains.
 */
function parseListRule(text: string): { rule: ValidationRule | null; truncated: boolean } {
  const seen = new Set<string>();
  const values: string[] = [];
  let distinctCount = 0;
  for (const raw of text.split('\n')) {
    const v = raw.trim();
    if (v !== '' && !seen.has(v)) {
      seen.add(v);
      distinctCount++;
      if (values.length < MAX_VALIDATION_LIST_VALUES) {
        values.push(v);
      }
    }
  }
  return {
    rule: values.length > 0 ? { kind: 'list', values } : null,
    truncated: distinctCount > MAX_VALIDATION_LIST_VALUES,
  };
}

/** Each field blank (null) or passing `parse`; undefined when one fails or min > max. */
function parseBounds<T extends number | string>(
  minText: string,
  maxText: string,
  parse: (text: string) => T | undefined,
): { min: T | null; max: T | null } | undefined {
  const min = minText.trim() === '' ? null : parse(minText.trim());
  const max = maxText.trim() === '' ? null : parse(maxText.trim());
  if (min === undefined || max === undefined || (min !== null && max !== null && min > max)) {
    return undefined;
  }
  return { min, max };
}

/** A number rule; both bounds may be blank (any number). */
function parseNumberRule(minText: string, maxText: string, integer: boolean): ValidationRule | null {
  const bounds = parseBounds(minText, maxText, (text) => {
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  });
  return bounds ? { kind: 'number', ...bounds, ...(integer ? { integer: true } : {}) } : null;
}

/** A text-length rule: whole character counts, at least one of them. */
function parseTextLengthRule(minText: string, maxText: string): ValidationRule | null {
  const bounds = parseBounds(minText, maxText, (text) => {
    const n = Number(text);
    return Number.isInteger(n) && n >= 0 && n <= MAX_VALIDATION_TEXT_LENGTH ? n : undefined;
  });
  return bounds && (bounds.min !== null || bounds.max !== null) ? { kind: 'textLength', ...bounds } : null;
}

/** A date rule; both bounds may be blank (any date written YYYY-MM-DD). */
function parseDateRule(minText: string, maxText: string): ValidationRule | null {
  const bounds = parseBounds(minText, maxText, (text) => (isIsoDate(text) ? text : undefined));
  return bounds ? { kind: 'date', ...bounds } : null;
}
