// SPDX-License-Identifier: MIT
/**
 * Dialogs that edit a rule attached to the selected range: sort keys, data
 * validation, and the cell comment.
 */
import type {
  ApplyHandler,
  CellCommentDialogInput,
  CellCommentDialogResult,
  DataValidationDialogInput,
  DataValidationDialogResult,
  SortDialogInput,
  SortDialogResult,
} from '../../app/commands';
import { t } from '../../app/i18n';
import { MAX_COMMENT_LENGTH } from '../../core/workbook/cell-comment';
import { MAX_VALIDATION_LIST_VALUES, type ValidationRule } from '../../core/workbook/data-validation';
import { MAX_SHEET_SORT_KEYS, type SortKey } from '../../core/workbook/sort';
import { el } from '../dom';
import { createIcon } from '../icon';
import { ArrowDownAZ, CheckSquare, Trash2 } from 'lucide';
import { dialogButton, helpDetails, openDialog } from './shared';
import { panelCheck, panelField, panelSection } from './side-panel';
import { openSidePanel } from './side-panel';

export class RangeRuleDialogs {
  /**
   * The accessible sort dialog: a header-row assumption (editable only when
   * creating the sort — an active sort's range/header are fixed until it is
   * cleared, mirroring `chooseFilter`'s header-row lock) and a compound list
   * of sort levels (column + ascending/descending), each addable/removable
   * up to {@link MAX_SHEET_SORT_KEYS}, always keeping at least one level.
   * Resolves with the chosen action or null (cancel).
   */
  chooseSort(
    input: SortDialogInput,
    onApply?: ApplyHandler<SortDialogResult>,
  ): Promise<SortDialogResult | null> {
    return openSidePanel<SortDialogResult | null>(
      { title: t('dialog.sort.title'), icon: ArrowDownAZ, fallback: null, onApply },
      (body, buttons, apply) => {
        const headerCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
        headerCheck.checked = input.headerRow;
        headerCheck.disabled = input.hasActiveSort;
        const intro: Node[] = [
          el('p', { className: 'panel-lead', text: t('dialog.sort.range', { range: input.rangeLabel }) }),
          panelCheck(headerCheck, t('dialog.sort.headerRow')),
        ];
        if (input.hasActiveSort) {
          intro.push(el('p', { className: 'dialog-note', text: t('dialog.sort.headerLocked') }));
        }
        body.append(panelSection(null, intro));

        const keysHost = el('div', { className: 'sort-keys panel-stack' });
        const keysSection = panelSection(t('dialog.sort.keys'), [keysHost]);
        body.append(keysSection);

        type Row = { col: HTMLSelectElement; dir: HTMLSelectElement; wrap: HTMLElement };
        const rows: Row[] = [];

        const addBtn = el('button', {
          className: 'panel-button',
          text: t('dialog.sort.addKey'),
          attrs: { type: 'button' },
        }) as HTMLButtonElement;

        const refreshRemoveButtons = (): void => {
          for (const row of rows) {
            const removeBtn = row.wrap.querySelector<HTMLButtonElement>('.sort-remove');
            if (removeBtn) {
              removeBtn.disabled = rows.length <= 1;
            }
          }
        };

        const makeRow = (key?: SortKey): void => {
          const colSelect = el('select', {
            attrs: { 'aria-label': t('dialog.sort.column') },
          }) as HTMLSelectElement;
          for (const column of input.columns) {
            colSelect.append(
              el('option', {
                text: column.header ? `${column.letter} — ${column.header}` : column.letter,
                attrs: { value: String(column.col) },
              }),
            );
          }
          const dirSelect = el('select', {
            attrs: { 'aria-label': t('dialog.sort.direction') },
          }) as HTMLSelectElement;
          dirSelect.append(
            el('option', { text: t('dialog.sort.ascending'), attrs: { value: 'asc' } }),
            el('option', { text: t('dialog.sort.descending'), attrs: { value: 'desc' } }),
          );
          if (key) {
            colSelect.value = String(key.col);
            dirSelect.value = key.ascending ? 'asc' : 'desc';
          }
          const removeBtn = el('button', {
            className: 'panel-button panel-icon-button sort-remove',
            attrs: {
              type: 'button',
              'aria-label': t('dialog.sort.removeKey'),
              title: t('dialog.sort.removeKey'),
            },
          }) as HTMLButtonElement;
          removeBtn.append(createIcon(Trash2, 'panel-button-icon', 14));
          const wrap = el('div', { className: 'sort-key-row' }, [colSelect, dirSelect, removeBtn]);
          removeBtn.addEventListener('click', () => {
            const i = rows.findIndex((r) => r.wrap === wrap);
            if (i < 0) {
              return;
            }
            rows.splice(i, 1);
            wrap.remove();
            refreshRemoveButtons();
            addBtn.disabled = rows.length >= MAX_SHEET_SORT_KEYS;
          });
          keysHost.append(wrap);
          rows.push({ col: colSelect, dir: dirSelect, wrap });
        };

        for (const key of input.existingKeys) {
          makeRow(key);
        }
        if (rows.length === 0) {
          makeRow();
        }
        refreshRemoveButtons();

        addBtn.addEventListener('click', () => {
          if (rows.length < MAX_SHEET_SORT_KEYS) {
            makeRow();
            refreshRemoveButtons();
          }
          addBtn.disabled = rows.length >= MAX_SHEET_SORT_KEYS;
        });
        addBtn.disabled = rows.length >= MAX_SHEET_SORT_KEYS;
        keysSection.append(
          el('div', { className: 'panel-row' }, [addBtn]),
          el('p', { className: 'dialog-note', text: t('dialog.sort.note') }),
          helpDetails(t('dialog.sort.help')),
        );

        if (input.hasActiveSort) {
          buttons.append(
            dialogButton(t('dialog.sort.clear'), false, false, () => apply({ action: 'clear' })),
          );
        }
        buttons.append(
          dialogButton(t('dialog.sort.apply'), true, false, () => {
            const keys: SortKey[] = rows.map((row) => ({
              col: Number(row.col.value),
              ascending: row.dir.value === 'asc',
            }));
            apply({ action: 'apply', headerRow: headerCheck.checked, keys });
          }),
        );
      },
    );
  }

  /**
   * The accessible data-validation dialog for the selected range: a rule
   * kind (a fixed list of choices, or a numeric range) and its parameters.
   * The Apply button stays disabled, with an inline explanation, until the
   * current fields describe a usable rule — mirroring `promptSheetName`'s
   * live-validation pattern. Resolves with the chosen action, or null when
   * cancelled (nothing changes).
   */
  chooseDataValidation(
    input: DataValidationDialogInput,
    onApply?: ApplyHandler<DataValidationDialogResult>,
  ): Promise<DataValidationDialogResult | null> {
    return openSidePanel<DataValidationDialogResult | null>(
      { title: t('dialog.dataValidation.title'), icon: CheckSquare, fallback: null, onApply },
      (body, buttons, apply) => {
        body.append(
          el('p', {
            className: 'panel-lead',
            text: t('dialog.dataValidation.range', { range: input.rangeLabel }),
          }),
        );

        const kindList = el('input', {
          attrs: { type: 'radio', name: 'validation-kind', id: 'validation-kind-list' },
        }) as HTMLInputElement;
        const kindNumber = el('input', {
          attrs: { type: 'radio', name: 'validation-kind', id: 'validation-kind-number' },
        }) as HTMLInputElement;
        const initialKind = input.existing?.kind ?? 'list';
        kindList.checked = initialKind === 'list';
        kindNumber.checked = initialKind === 'number';
        body.append(
          panelSection(null, [
            el('div', { className: 'panel-choices', attrs: { role: 'radiogroup' } }, [
              panelCheck(kindList, t('dialog.dataValidation.kindList')),
              panelCheck(kindNumber, t('dialog.dataValidation.kindNumber')),
            ]),
          ]),
        );

        const listValues = el('textarea', {
          className: 'validation-list-values',
          attrs: { rows: '6', 'aria-label': t('dialog.dataValidation.listValues'), 'data-autofocus': 'true' },
        }) as HTMLTextAreaElement;
        if (input.existing?.kind === 'list') {
          listValues.value = input.existing.values.join('\n');
        }
        const listTruncatedNote = el('p', { className: 'dialog-note' });
        const listSection = panelSection(null, [
          panelField(t('dialog.dataValidation.listValues'), listValues, t('dialog.dataValidation.listHint')),
          listTruncatedNote,
        ]);
        body.append(listSection);

        const minInput = el('input', {
          attrs: { type: 'number', 'aria-label': t('dialog.dataValidation.min') },
        }) as HTMLInputElement;
        const maxInput = el('input', {
          attrs: { type: 'number', 'aria-label': t('dialog.dataValidation.max') },
        }) as HTMLInputElement;
        if (input.existing?.kind === 'number') {
          if (input.existing.min !== null) {
            minInput.value = String(input.existing.min);
          }
          if (input.existing.max !== null) {
            maxInput.value = String(input.existing.max);
          }
        }
        const numberSection = panelSection(null, [
          el('div', { className: 'panel-grid' }, [
            panelField(t('dialog.dataValidation.min'), minInput),
            panelField(t('dialog.dataValidation.max'), maxInput),
          ]),
        ]);
        body.append(numberSection);

        const error = el('p', {
          className: 'dialog-error',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        body.append(error);

        // Set by buildRule() as a side effect, read by refresh() right after —
        // avoids parsing the textarea twice per keystroke just to learn
        // whether the list was cut off.
        let listTruncated = false;

        const buildRule = (): ValidationRule | null => {
          if (kindList.checked) {
            const parsed = parseListRule(listValues.value);
            listTruncated = parsed.truncated;
            return parsed.rule;
          }
          listTruncated = false;
          return parseNumberRule(minInput.value, maxInput.value);
        };

        const applyBtn = dialogButton(t('dialog.dataValidation.apply'), true, false, () => {
          const rule = buildRule();
          if (rule) {
            apply({ action: 'apply', rule });
          }
        });

        const refresh = (): void => {
          listSection.hidden = !kindList.checked;
          numberSection.hidden = !kindNumber.checked;
          const rule = buildRule();
          error.textContent = rule ? '' : t('dialog.dataValidation.incomplete');
          applyBtn.disabled = rule === null;
          listTruncatedNote.textContent = listTruncated
            ? t('dialog.dataValidation.listTruncated', { n: MAX_VALIDATION_LIST_VALUES })
            : '';
        };
        kindList.addEventListener('change', refresh);
        kindNumber.addEventListener('change', refresh);
        listValues.addEventListener('input', refresh);
        minInput.addEventListener('input', refresh);
        maxInput.addEventListener('input', refresh);
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

  /**
   * The accessible cell-comment dialog for the active cell: a single free-text
   * note, capped at {@link MAX_COMMENT_LENGTH}. Mirrors `chooseDataValidation`'s
   * Apply/Clear/Cancel layout: a Clear button appears only when the cell
   * already carries a comment. Resolves with the chosen action, or null when
   * cancelled (nothing changes).
   */
  chooseCellComment(input: CellCommentDialogInput): Promise<CellCommentDialogResult | null> {
    return openDialog<CellCommentDialogResult | null>(
      t('dialog.cellComment.title'),
      null,
      (body, buttons, close) => {
        body.append(el('p', { text: t('dialog.cellComment.cell', { cell: input.cellLabel }) }));

        const textArea = el('textarea', {
          className: 'cell-comment-text',
          attrs: {
            rows: '6',
            maxlength: String(MAX_COMMENT_LENGTH),
            'aria-label': t('dialog.cellComment.label'),
            'data-autofocus': 'true',
          },
        }) as HTMLTextAreaElement;
        textArea.value = input.existing ?? '';
        body.append(
          el('div', { className: 'form-row' }, [
            el('label', { text: t('dialog.cellComment.label') }),
            textArea,
          ]),
        );

        buttons.append(dialogButton(t('dialog.cellComment.cancel'), false, true, () => close(null)));
        if (input.existing !== null) {
          buttons.append(
            dialogButton(t('dialog.cellComment.clear'), false, false, () => close({ action: 'clear' })),
          );
        }
        buttons.append(
          dialogButton(t('dialog.cellComment.apply'), true, false, () =>
            close({ action: 'apply', text: textArea.value }),
          ),
        );
      },
    );
  }
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

/** A number-range rule from the min/max fields, or null when neither is set, either is invalid, or min > max. */
function parseNumberRule(minText: string, maxText: string): ValidationRule | null {
  const min = minText.trim() === '' ? null : Number(minText);
  const max = maxText.trim() === '' ? null : Number(maxText);
  if (min === null && max === null) {
    return null;
  }
  if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
    return null;
  }
  if (min !== null && max !== null && min > max) {
    return null;
  }
  return { kind: 'number', min, max };
}
