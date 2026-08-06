// SPDX-License-Identifier: MIT
import type {
  DataValidationDialogInput,
  DataValidationDialogResult,
  FilterDialogInput,
  FilterDialogResult,
  RangeMoveConfirmInput,
  SortDialogInput,
  SortDialogResult,
  WorkbookReplaceConfirmInput,
} from '../../app/commands';
import { t } from '../../app/i18n';
import { MAX_VALIDATION_LIST_VALUES, type ValidationRule } from '../../core/data-validation';
import {
  FILTER_NUMBER_OPS,
  FILTER_TEXT_OPS,
  MAX_FILTER_CONDITIONS,
  type ColumnFilter,
  type FilterCondition,
  type FilterNumberOp,
  type FilterTextOp,
} from '../../core/filter';
import { MAX_SHEET_NAME_LENGTH } from '../../core/formula';
import { MAX_SHEET_SORT_KEYS, type SortKey } from '../../core/sort';
import { el } from '../dom';
import type { AnchorRect } from '../popup';
import { dialogButton, openDialog, openPopover } from './shared';

/**
 * Sheet/range/filter dialogs: the column-filter popover, insert-shift
 * direction prompt, sheet name/move/delete prompts, and the range-move/
 * replace-all confirmations. Extracted from `Dialogs` as a cohesive slice
 * (see issue #181, following the `FileIoDialogs` split from #133) —
 * `Dialogs` still implements the same `UiPort` dialog surface, delegating to
 * an instance of this class.
 */
export class SheetOpsDialogs {
  /**
   * The accessible column-filter popover, anchored beside the triggering
   * column's header. Presents the filtered range and the header-row
   * assumption (editable only when creating the filter — an active filter's
   * range/header are fixed until all filters are cleared), an AND/OR-combined
   * list of comparison conditions, and a searchable, bounded checkbox list of
   * the column's distinct displayed values with select-all/deselect-all
   * (acting on the currently search-narrowed values, like the individual
   * checkboxes). All content is text-only. Resolves with the chosen action
   * or null (cancel).
   */
  chooseFilter(input: FilterDialogInput): Promise<FilterDialogResult | null> {
    const getAnchor = (): AnchorRect | null => {
      const header = document.querySelector<HTMLElement>(`[data-colhead="${input.col}"]`);
      return header ? header.getBoundingClientRect() : null;
    };
    return openPopover<FilterDialogResult | null>(
      getAnchor,
      t('dialog.filter.title'),
      null,
      (body, buttons, close) => {
        body.append(
          el('p', {
            text: t('dialog.filter.range', { range: input.rangeLabel, col: input.colLetter }),
          }),
        );
        if (input.header) {
          body.append(
            el('p', { className: 'dialog-note', text: t('dialog.filter.header', { header: input.header }) }),
          );
        }

        // Header-row assumption (only editable while creating the filter).
        const headerCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
        headerCheck.checked = input.headerRow;
        headerCheck.disabled = input.hasActiveFilter;
        body.append(
          el('div', { className: 'form-row' }, [
            el('label', {}, [headerCheck, el('span', { text: t('dialog.filter.headerRow') })]),
          ]),
        );
        if (input.hasActiveFilter) {
          body.append(el('p', { className: 'dialog-note', text: t('dialog.filter.headerLocked') }));
        }

        // ----- Conditions (AND/OR combined) -----
        body.append(el('h3', { className: 'dialog-subhead', text: t('dialog.filter.conditions') }));
        const joinWrap = el('div', { className: 'form-row' });
        const joinAnd = el('input', {
          attrs: { type: 'radio', name: 'filter-join' },
        }) as HTMLInputElement;
        const joinOr = el('input', {
          attrs: { type: 'radio', name: 'filter-join' },
        }) as HTMLInputElement;
        const existingJoin = input.existing?.join ?? 'and';
        joinAnd.checked = existingJoin === 'and';
        joinOr.checked = existingJoin === 'or';
        joinWrap.append(
          el('label', {}, [joinAnd, el('span', { text: t('dialog.filter.joinAnd') })]),
          el('label', {}, [joinOr, el('span', { text: t('dialog.filter.joinOr') })]),
        );
        body.append(joinWrap);

        const conditionsHost = el('div', { className: 'filter-conditions' });
        body.append(conditionsHost);

        type Row = { op: HTMLSelectElement; value: HTMLInputElement; value2: HTMLInputElement };
        const rows: Row[] = [];
        const allOps: Array<{ value: string; label: string }> = [
          ...FILTER_TEXT_OPS.map((op) => ({ value: op, label: t(`filter.op.${op}`) })),
          ...FILTER_NUMBER_OPS.map((op) => ({ value: op, label: t(`filter.op.${op}`) })),
        ];
        const isNumberOp = (op: string): boolean => (FILTER_NUMBER_OPS as readonly string[]).includes(op);
        const noValueOp = (op: string): boolean => op === 'blank' || op === 'notBlank';

        const makeRow = (cond?: FilterCondition): Row => {
          const op = el('select', {
            attrs: { 'aria-label': t('dialog.filter.condition') },
          }) as HTMLSelectElement;
          for (const o of allOps) {
            op.append(el('option', { text: o.label, attrs: { value: o.value } }));
          }
          const value = el('input', {
            attrs: { type: 'text', 'aria-label': t('dialog.filter.value') },
          }) as HTMLInputElement;
          const value2 = el('input', {
            attrs: { type: 'text', 'aria-label': t('dialog.filter.value2') },
          }) as HTMLInputElement;
          if (cond) {
            op.value = cond.op;
            if (cond.kind === 'text') {
              value.value = cond.value;
            } else {
              value.value = String(cond.value);
              if (cond.value2 !== undefined) {
                value2.value = String(cond.value2);
              }
            }
          }
          const sync = (): void => {
            value.hidden = noValueOp(op.value);
            value2.hidden = op.value !== 'numBetween';
          };
          op.addEventListener('change', sync);
          sync();
          const row = el('div', { className: 'filter-condition-row' }, [op, value, value2]);
          conditionsHost.append(row);
          return { op, value, value2 };
        };

        for (const cond of input.existing?.conditions ?? []) {
          rows.push(makeRow(cond));
        }
        if (rows.length === 0) {
          rows.push(makeRow());
        }
        const addBtn = el('button', {
          className: 'filter-add',
          text: t('dialog.filter.addCondition'),
          attrs: { type: 'button' },
        });
        addBtn.addEventListener('click', () => {
          if (rows.length < MAX_FILTER_CONDITIONS) {
            rows.push(makeRow());
          }
          addBtn.disabled = rows.length >= MAX_FILTER_CONDITIONS;
        });
        addBtn.disabled = rows.length >= MAX_FILTER_CONDITIONS;
        body.append(addBtn);

        // ----- Distinct-value selection (searchable, bounded) -----
        body.append(el('h3', { className: 'dialog-subhead', text: t('dialog.filter.values') }));
        const allValuesCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
        allValuesCheck.checked = input.existing?.values == null;
        body.append(
          el('div', { className: 'form-row' }, [
            el('label', {}, [allValuesCheck, el('span', { text: t('dialog.filter.allValues') })]),
          ]),
        );
        const search = el('input', {
          attrs: {
            type: 'search',
            placeholder: t('dialog.filter.searchValues'),
            'aria-label': t('dialog.filter.searchValues'),
          },
        }) as HTMLInputElement;
        body.append(search);
        const selectAllBtn = el('button', {
          className: 'filter-add',
          text: t('dialog.filter.selectAllValues'),
          attrs: { type: 'button' },
        }) as HTMLButtonElement;
        const deselectAllBtn = el('button', {
          className: 'filter-add',
          text: t('dialog.filter.deselectAllValues'),
          attrs: { type: 'button' },
        }) as HTMLButtonElement;
        body.append(el('div', { className: 'form-row' }, [selectAllBtn, deselectAllBtn]));
        const valueList = el('div', { className: 'filter-value-list', attrs: { role: 'group' } });
        body.append(valueList);
        if (input.valuesTruncated) {
          body.append(el('p', { className: 'dialog-note', text: t('dialog.filter.valuesTruncated') }));
        }
        const checkedValues = new Set<string>(input.existing?.values ?? input.values);
        const VALUE_DISPLAY_CAP = 200;
        // The currently search-narrowed values (not just the ones actually
        // rendered under VALUE_DISPLAY_CAP), kept in sync by renderValues()
        // so select-all/deselect-all act on the narrowed set, not the
        // column's full (possibly much larger) value set.
        let currentMatches: string[] = input.values;
        selectAllBtn.addEventListener('click', () => {
          for (const v of currentMatches) {
            checkedValues.add(v);
          }
          renderValues();
        });
        deselectAllBtn.addEventListener('click', () => {
          for (const v of currentMatches) {
            checkedValues.delete(v);
          }
          renderValues();
        });
        const renderValues = (): void => {
          const term = search.value.toLowerCase();
          const matches = input.values.filter((v) => v.toLowerCase().includes(term));
          currentMatches = matches;
          selectAllBtn.disabled = allValuesCheck.checked;
          deselectAllBtn.disabled = allValuesCheck.checked;
          const shown = matches.slice(0, VALUE_DISPLAY_CAP);
          const children: HTMLElement[] = shown.map((v) => {
            const cb = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
            cb.checked = checkedValues.has(v);
            cb.disabled = allValuesCheck.checked;
            cb.addEventListener('change', () => {
              if (cb.checked) {
                checkedValues.add(v);
              } else {
                checkedValues.delete(v);
              }
            });
            return el('label', { className: 'filter-value' }, [
              cb,
              el('span', { text: v === '' ? t('dialog.filter.blankValue') : v }),
            ]);
          });
          if (matches.length > shown.length) {
            children.push(
              el('p', {
                className: 'dialog-note',
                text: t('dialog.filter.valuesMore', { n: matches.length - shown.length }),
              }),
            );
          }
          valueList.replaceChildren(...children);
        };
        allValuesCheck.addEventListener('change', renderValues);
        search.addEventListener('input', renderValues);
        renderValues();

        body.append(
          el('p', { className: 'dialog-note', text: t('dialog.filter.combineNote') }),
          el('p', {
            className: 'dialog-note',
            text: t('dialog.filter.crossNote', { n: input.otherColumns }),
          }),
        );

        // ----- Build the result from the current inputs -----
        const buildColumn = (): ColumnFilter | null => {
          const conditions: FilterCondition[] = [];
          for (const row of rows) {
            const op = row.op.value;
            if (noValueOp(op)) {
              conditions.push({ kind: 'text', op: op as FilterTextOp, value: '' });
            } else if (isNumberOp(op)) {
              const n = Number(row.value.value.trim());
              if (row.value.value.trim() === '' || !Number.isFinite(n)) {
                continue; // skip an incomplete numeric condition
              }
              const cond: FilterCondition = { kind: 'number', op: op as FilterNumberOp, value: n };
              if (op === 'numBetween') {
                const n2 = Number(row.value2.value.trim());
                if (Number.isFinite(n2)) {
                  cond.value2 = n2;
                }
              }
              conditions.push(cond);
            } else {
              if (row.value.value === '') {
                continue; // skip an empty text condition
              }
              conditions.push({ kind: 'text', op: op as FilterTextOp, value: row.value.value });
            }
          }
          const values = allValuesCheck.checked ? null : [...checkedValues].sort();
          if (conditions.length === 0 && values === null) {
            return null; // no criteria: clears this column
          }
          return {
            col: input.col,
            join: joinOr.checked ? 'or' : 'and',
            conditions,
            values,
          };
        };

        // ----- Buttons -----
        buttons.append(dialogButton(t('dialog.filter.cancel'), false, true, () => close(null)));
        if (input.existing) {
          buttons.append(
            dialogButton(t('dialog.filter.clearColumn'), false, false, () =>
              close({ action: 'clearColumn' }),
            ),
          );
        }
        if (input.hasActiveFilter) {
          buttons.append(
            dialogButton(t('dialog.filter.clearAll'), false, false, () => close({ action: 'clearAll' })),
          );
        }
        buttons.append(
          dialogButton(t('dialog.filter.apply'), true, false, () =>
            close({ action: 'apply', headerRow: headerCheck.checked, column: buildColumn() }),
          ),
        );
      },
    );
  }

  /**
   * The accessible sort dialog: a header-row assumption (editable only when
   * creating the sort — an active sort's range/header are fixed until it is
   * cleared, mirroring `chooseFilter`'s header-row lock) and a compound list
   * of sort levels (column + ascending/descending), each addable/removable
   * up to {@link MAX_SHEET_SORT_KEYS}, always keeping at least one level.
   * Resolves with the chosen action or null (cancel).
   */
  chooseSort(input: SortDialogInput): Promise<SortDialogResult | null> {
    return openDialog<SortDialogResult | null>(t('dialog.sort.title'), null, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.sort.range', { range: input.rangeLabel }) }));

      const headerCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
      headerCheck.checked = input.headerRow;
      headerCheck.disabled = input.hasActiveSort;
      body.append(
        el('div', { className: 'form-row' }, [
          el('label', {}, [headerCheck, el('span', { text: t('dialog.sort.headerRow') })]),
        ]),
      );
      if (input.hasActiveSort) {
        body.append(el('p', { className: 'dialog-note', text: t('dialog.sort.headerLocked') }));
      }

      body.append(el('h3', { className: 'dialog-subhead', text: t('dialog.sort.keys') }));
      const keysHost = el('div', { className: 'sort-keys' });
      body.append(keysHost);

      type Row = { col: HTMLSelectElement; dir: HTMLSelectElement; wrap: HTMLElement };
      const rows: Row[] = [];

      const addBtn = el('button', {
        className: 'filter-add',
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
          className: 'filter-add sort-remove',
          text: t('dialog.sort.removeKey'),
          attrs: { type: 'button', 'aria-label': t('dialog.sort.removeKey') },
        }) as HTMLButtonElement;
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
      body.append(addBtn);

      body.append(el('p', { className: 'dialog-note', text: t('dialog.sort.note') }));

      buttons.append(dialogButton(t('dialog.sort.cancel'), false, true, () => close(null)));
      if (input.hasActiveSort) {
        buttons.append(dialogButton(t('dialog.sort.clear'), false, false, () => close({ action: 'clear' })));
      }
      buttons.append(
        dialogButton(t('dialog.sort.apply'), true, false, () => {
          const keys: SortKey[] = rows.map((row) => ({
            col: Number(row.col.value),
            ascending: row.dir.value === 'asc',
          }));
          close({ action: 'apply', headerRow: headerCheck.checked, keys });
        }),
      );
    });
  }

  /**
   * The accessible data-validation dialog for the selected range: a rule
   * kind (a fixed list of choices, or a numeric range) and its parameters.
   * The Apply button stays disabled, with an inline explanation, until the
   * current fields describe a usable rule — mirroring `promptSheetName`'s
   * live-validation pattern. Resolves with the chosen action, or null when
   * cancelled (nothing changes).
   */
  chooseDataValidation(input: DataValidationDialogInput): Promise<DataValidationDialogResult | null> {
    return openDialog<DataValidationDialogResult | null>(
      t('dialog.dataValidation.title'),
      null,
      (body, buttons, close) => {
        body.append(el('p', { text: t('dialog.dataValidation.range', { range: input.rangeLabel }) }));

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
          el('div', { className: 'form-row' }, [
            el('label', { attrs: { for: 'validation-kind-list' } }, [
              kindList,
              el('span', { text: t('dialog.dataValidation.kindList') }),
            ]),
            el('label', { attrs: { for: 'validation-kind-number' } }, [
              kindNumber,
              el('span', { text: t('dialog.dataValidation.kindNumber') }),
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
        const listSection = el('div', { className: 'form-row' }, [
          el('label', { text: t('dialog.dataValidation.listValues') }),
          listValues,
          el('p', { className: 'dialog-note', text: t('dialog.dataValidation.listHint') }),
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
        const numberSection = el('div', { className: 'form-row' }, [
          el('label', { text: t('dialog.dataValidation.min') }),
          minInput,
          el('label', { text: t('dialog.dataValidation.max') }),
          maxInput,
        ]);
        body.append(numberSection);

        const error = el('p', {
          className: 'dialog-error',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        body.append(error);

        const buildRule = (): ValidationRule | null => {
          if (kindList.checked) {
            const seen = new Set<string>();
            const values: string[] = [];
            for (const raw of listValues.value.split('\n')) {
              const v = raw.trim();
              if (v !== '' && !seen.has(v)) {
                seen.add(v);
                values.push(v);
              }
              if (values.length >= MAX_VALIDATION_LIST_VALUES) {
                break;
              }
            }
            return values.length > 0 ? { kind: 'list', values } : null;
          }
          const min = minInput.value.trim() === '' ? null : Number(minInput.value);
          const max = maxInput.value.trim() === '' ? null : Number(maxInput.value);
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
        };

        const applyBtn = dialogButton(t('dialog.dataValidation.apply'), true, false, () => {
          const rule = buildRule();
          if (rule) {
            close({ action: 'apply', rule });
          }
        });

        const refresh = (): void => {
          listSection.hidden = !kindList.checked;
          numberSection.hidden = !kindNumber.checked;
          const rule = buildRule();
          error.textContent = rule ? '' : t('dialog.dataValidation.incomplete');
          applyBtn.disabled = rule === null;
        };
        kindList.addEventListener('change', refresh);
        kindNumber.addEventListener('change', refresh);
        listValues.addEventListener('input', refresh);
        minInput.addEventListener('input', refresh);
        maxInput.addEventListener('input', refresh);
        refresh();

        buttons.append(dialogButton(t('dialog.dataValidation.cancel'), false, true, () => close(null)));
        if (input.existing) {
          buttons.append(
            dialogButton(t('dialog.dataValidation.clear'), false, false, () => close({ action: 'clear' })),
          );
        }
        buttons.append(applyBtn);
      },
    );
  }

  /** Choose the shift direction for Insert Copied Cells… (null cancels). */
  chooseInsertShift(rows: number, cols: number): Promise<'right' | 'down' | null> {
    return openDialog<'right' | 'down' | null>(
      t('dialog.insertCells.title'),
      null,
      (body, buttons, close) => {
        body.append(el('p', { text: t('dialog.insertCells.message', { rows, cols }) }));
        body.append(el('p', { className: 'dialog-note', text: t('dialog.insertCells.note') }));
        buttons.append(
          dialogButton(t('dialog.insertCells.cancel'), false, true, () => close(null)),
          dialogButton(t('dialog.insertCells.right'), false, false, () => close('right')),
          dialogButton(t('dialog.insertCells.down'), true, false, () => close('down')),
        );
      },
    );
  }

  /**
   * Ask for a worksheet name (add / rename / duplicate). Validation runs as
   * the user types and again on submit, reporting the problem inline through a
   * live region rather than silently refusing, and the confirm button stays
   * disabled while the name is unacceptable. Enter confirms and Escape cancels
   * — both ignored while an IME composition is in progress, so committing a
   * Japanese candidate with Enter never submits the dialog by accident.
   */
  promptSheetName(
    mode: 'add' | 'rename' | 'duplicate',
    current: string,
    validate: (name: string) => string | null,
  ): Promise<string | null> {
    return openDialog<string | null>(t(`dialog.sheetName.title.${mode}`), null, (body, buttons, close) => {
      const inputId = 'sheet-name-input';
      const errorId = 'sheet-name-error';
      const input = el('input', {
        className: 'sheet-name-input',
        attrs: {
          type: 'text',
          id: inputId,
          value: current,
          maxlength: String(MAX_SHEET_NAME_LENGTH),
          'aria-describedby': errorId,
          'data-autofocus': 'true',
        },
      }) as HTMLInputElement;
      input.value = current;
      const error = el('p', {
        className: 'dialog-error',
        attrs: { id: errorId, role: 'status', 'aria-live': 'polite' },
      });
      body.append(
        el('label', { text: t('dialog.sheetName.label'), attrs: { for: inputId } }),
        input,
        el('p', { className: 'dialog-note', text: t('dialog.sheetName.rules') }),
        error,
      );

      const okButton = dialogButton(t('dialog.sheetName.ok'), true, false, () => submit());
      const refresh = (): boolean => {
        const message = validate(input.value);
        error.textContent = message ?? '';
        okButton.disabled = message !== null;
        return message === null;
      };
      const submit = (): void => {
        if (refresh()) {
          close(input.value.trim());
        }
      };
      // Composition state is tracked explicitly: `isComposing` is not set on
      // the keydown that commits a candidate in every browser.
      let composing = false;
      input.addEventListener('compositionstart', () => {
        composing = true;
      });
      input.addEventListener('compositionend', () => {
        composing = false;
        refresh();
      });
      input.addEventListener('input', () => {
        if (!composing) {
          refresh();
        }
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !composing && !event.isComposing) {
          event.preventDefault();
          submit();
        }
      });
      refresh();
      buttons.append(
        dialogButton(t('dialog.sheetName.cancel'), false, false, () => close(null)),
        okButton,
      );
    });
  }

  /**
   * Confirm deleting a worksheet that holds content or is referenced by
   * formulas. The message states — truthfully — how many formulas elsewhere in
   * the workbook will become #REF!, because deletion never silently redirects
   * references to another worksheet.
   */
  confirmDeleteSheet(name: string, referenceCount: number): Promise<boolean> {
    return openDialog<boolean>(t('dialog.deleteSheet.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.deleteSheet.message', { name }) }));
      if (referenceCount > 0) {
        body.append(
          el('p', {
            className: 'dialog-note warn',
            text: t('dialog.deleteSheet.references', { n: referenceCount }),
          }),
        );
      }
      body.append(el('p', { className: 'dialog-note', text: t('dialog.deleteSheet.undo') }));
      buttons.append(
        dialogButton(t('dialog.deleteSheet.cancel'), false, true, () => close(false)),
        dialogButton(t('dialog.deleteSheet.ok'), true, false, () => close(true)),
      );
    });
  }

  /**
   * Confirm a range move whose destination already holds data. The destination
   * range and the exact number of cells that would be replaced are both stated,
   * and Cancel is the default action, so data is never replaced by accident.
   */
  confirmRangeMoveOverwrite(input: RangeMoveConfirmInput): Promise<boolean> {
    return openDialog<boolean>(t('dialog.moveRange.overwriteTitle'), false, (body, buttons, close) => {
      body.append(
        el('p', {
          text: t('dialog.moveRange.overwriteMessage', {
            target: input.target,
            n: input.overwriteCount,
          }),
        }),
        el('p', { className: 'dialog-note', text: t('dialog.moveRange.overwriteUndo') }),
      );
      buttons.append(
        dialogButton(t('dialog.moveRange.cancel'), false, true, () => close(false)),
        dialogButton(t('dialog.moveRange.overwriteOk'), true, false, () => close(true)),
      );
    });
  }

  /**
   * Ask where to move the selected cells — the keyboard path to the same move
   * the drag gesture performs. Validation runs on every keystroke and is shown
   * in a live region; OK stays disabled while the entry is unusable. Enter
   * confirms and Escape cancels, and neither fires while an IME composition is
   * in progress.
   */
  promptMoveTarget(
    source: string,
    suggestion: string,
    validate: (text: string) => string | null,
  ): Promise<string | null> {
    return openDialog<string | null>(t('dialog.moveRange.title'), null, (body, buttons, close) => {
      const inputId = 'move-target-input';
      const input = el('input', {
        className: 'move-target-input',
        attrs: { type: 'text', id: inputId, 'data-autofocus': 'true', autocomplete: 'off' },
      }) as HTMLInputElement;
      input.value = suggestion;
      const error = el('p', {
        className: 'dialog-error',
        attrs: { role: 'status', 'aria-live': 'polite' },
      });
      const ok = dialogButton(t('dialog.moveRange.ok'), true, false, () => close(input.value.trim()));
      const refresh = (): void => {
        const message = validate(input.value);
        error.textContent = message ?? '';
        ok.disabled = message !== null;
        input.setAttribute('aria-invalid', message === null ? 'false' : 'true');
      };
      let composing = false;
      input.addEventListener('compositionstart', () => (composing = true));
      input.addEventListener('compositionend', () => {
        composing = false;
        refresh();
      });
      input.addEventListener('input', () => {
        if (!composing) refresh();
      });
      input.addEventListener('keydown', (event) => {
        // Never act on Enter that is only ending an IME composition.
        if (event.key === 'Enter' && !composing && !event.isComposing && !ok.disabled) {
          event.preventDefault();
          close(input.value.trim());
        }
      });
      body.append(
        el('p', { text: t('dialog.moveRange.message', { source }) }),
        el('label', { attrs: { for: inputId }, text: t('dialog.moveRange.label') }),
        input,
        error,
        el('p', { className: 'dialog-note', text: t('dialog.moveRange.hint') }),
      );
      buttons.append(
        dialogButton(t('dialog.moveRange.cancel'), false, true, () => close(null)),
        ok,
      );
      refresh();
    });
  }

  /**
   * "Go to Cell…": ask for a cell reference to jump the selection to.
   * Validation runs on every keystroke and is shown in a live region; OK
   * stays disabled while the entry is unusable. Enter confirms and Escape
   * cancels, and neither fires while an IME composition is in progress.
   */
  promptGoToCell(suggestion: string, validate: (text: string) => string | null): Promise<string | null> {
    return openDialog<string | null>(t('dialog.goToCell.title'), null, (body, buttons, close) => {
      const inputId = 'go-to-cell-input';
      const input = el('input', {
        className: 'move-target-input',
        attrs: { type: 'text', id: inputId, 'data-autofocus': 'true', autocomplete: 'off' },
      }) as HTMLInputElement;
      input.value = suggestion;
      const error = el('p', {
        className: 'dialog-error',
        attrs: { role: 'status', 'aria-live': 'polite' },
      });
      const ok = dialogButton(t('dialog.goToCell.ok'), true, false, () => close(input.value.trim()));
      const refresh = (): void => {
        const message = validate(input.value);
        error.textContent = message ?? '';
        ok.disabled = message !== null;
        input.setAttribute('aria-invalid', message === null ? 'false' : 'true');
      };
      let composing = false;
      input.addEventListener('compositionstart', () => (composing = true));
      input.addEventListener('compositionend', () => {
        composing = false;
        refresh();
      });
      input.addEventListener('input', () => {
        if (!composing) refresh();
      });
      input.addEventListener('keydown', (event) => {
        // Never act on Enter that is only ending an IME composition.
        if (event.key === 'Enter' && !composing && !event.isComposing && !ok.disabled) {
          event.preventDefault();
          close(input.value.trim());
        }
      });
      body.append(
        el('label', { attrs: { for: inputId }, text: t('dialog.goToCell.label') }),
        input,
        error,
        el('p', { className: 'dialog-note', text: t('dialog.goToCell.hint') }),
      );
      buttons.append(
        dialogButton(t('dialog.goToCell.cancel'), false, true, () => close(null)),
        ok,
      );
      refresh();
    });
  }

  /**
   * Confirm a workbook-wide Replace All. The scope is stated explicitly — a
   * replace that reaches worksheets the user is not looking at must never be
   * a surprise — together with exactly how much it would change. Cancel is the
   * default action, and nothing is mutated until this resolves true.
   */
  confirmReplaceAllWorkbook(input: WorkbookReplaceConfirmInput): Promise<boolean> {
    return openDialog<boolean>(t('dialog.replaceWorkbook.title'), false, (body, buttons, close) => {
      body.append(
        el('p', {
          text: t('dialog.replaceWorkbook.message', {
            matches: input.matches,
            cells: input.cells,
            sheets: input.sheets,
            total: input.totalSheets,
          }),
        }),
        el('p', { className: 'dialog-note', text: t('dialog.replaceWorkbook.scope') }),
        el('p', { className: 'dialog-note', text: t('dialog.replaceWorkbook.undo') }),
      );
      buttons.append(
        dialogButton(t('dialog.replaceWorkbook.cancel'), false, true, () => close(false)),
        dialogButton(t('dialog.replaceWorkbook.ok'), true, false, () => close(true)),
      );
    });
  }
}
