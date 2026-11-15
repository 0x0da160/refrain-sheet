// SPDX-License-Identifier: MIT
import type { PivotCreateOutcome, PivotDialogInput } from '../../app/commands';
import { t } from '../../app/i18n';
import { PIVOT_AGGREGATIONS, type PivotRequest } from '../../core/pivot';
import { Sigma } from 'lucide';
import { el } from '../dom';
import { formField, formSection } from './form-layout';
import { dialogButton } from './shared';
import { openSidePanel } from './side-panel';

/**
 * A select over the table's field names, each option valued by its column
 * index. `withNone` adds a first option for no field, valued ''; a `selected`
 * of null picks that option.
 */
function fieldSelect(columns: string[], selected: number | null, withNone: boolean): HTMLSelectElement {
  const select = el('select') as HTMLSelectElement;
  if (withNone) {
    select.append(el('option', { text: t('dialog.pivot.noColumnField'), attrs: { value: '' } }));
  }
  columns.forEach((name, index) => {
    select.append(el('option', { text: name, attrs: { value: String(index) } }));
  });
  select.value = selected === null ? '' : String(selected);
  return select;
}

/** Whether every field a request names is a column of a table with `count` columns. */
function fieldsFit(request: PivotRequest, count: number): boolean {
  const inTable = (index: number): boolean => Number.isInteger(index) && index >= 0 && index < count;
  return (
    inTable(request.rowField) &&
    inTable(request.valueField) &&
    (request.columnField === null || inTable(request.columnField))
  );
}

/** The status line for a successful action: what was made or changed, and what the totals left out. */
function statusOf(outcome: Extract<PivotCreateOutcome, { ok: true }>): string {
  let message = t('dialog.pivot.status.created', { name: outcome.sheetName });
  if (outcome.mode === 'updated') {
    message = t('dialog.pivot.status.updated', { name: outcome.sheetName });
  } else if (outcome.mode === 'unchanged') {
    message = t('dialog.pivot.status.upToDate');
  }
  return outcome.ignored > 0
    ? `${message} ${t('dialog.pivot.status.ignored', { count: outcome.ignored })}`
    : message;
}

/**
 * The pivot table panel, a side panel beside the sheet like the SQL and
 * compare panels: choose a row field, an optional column field, a value field,
 * and how to summarize the value. On a new summary, Create in New Sheet puts it
 * into a new sheet. On a pivot table sheet, the panel opens with that sheet's
 * settings, and Update This Sheet rebuilds the sheet from its source; Create in
 * New Sheet still makes another summary of that source. Nothing here changes
 * the source (see `src/core/pivot.ts`).
 */
export class PivotDialogs {
  showPivot(input: PivotDialogInput): Promise<void> {
    return openSidePanel<void>(
      { title: t('dialog.pivot.title'), icon: Sigma, fallback: undefined, key: 'data.pivotTable' },
      (body, buttons) => {
        const hasColumns = input.columns.length > 0;
        // A pivot table sheet reopens with its own fields and summary, while they still fit the table.
        const start = input.initial && fieldsFit(input.initial, input.columns.length) ? input.initial : null;
        const rowSelect = fieldSelect(input.columns, start?.rowField ?? 0, false);
        const columnSelect = fieldSelect(input.columns, start ? start.columnField : null, true);
        // The last column is the likeliest value (an amount or a score), so it is the default.
        const valueSelect = fieldSelect(
          input.columns,
          start?.valueField ?? Math.max(0, input.columns.length - 1),
          false,
        );
        const aggregationSelect = el('select') as HTMLSelectElement;
        for (const aggregation of PIVOT_AGGREGATIONS) {
          aggregationSelect.append(
            el('option', { text: t(`pivot.aggregation.${aggregation}`), attrs: { value: aggregation } }),
          );
        }
        aggregationSelect.value = start?.aggregation ?? 'sum';
        const status = el('p', {
          className: 'dialog-note',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        body.append(
          formSection(null, [
            el('p', { text: input.update ? t('dialog.pivot.updateIntro') : t('dialog.pivot.intro') }),
            formField(t('dialog.pivot.rowField'), rowSelect),
            formField(t('dialog.pivot.columnField'), columnSelect),
            formField(t('dialog.pivot.valueField'), valueSelect),
            formField(t('dialog.pivot.aggregation'), aggregationSelect),
            status,
          ]),
        );

        const setStatus = (text: string, isError: boolean): void => {
          status.textContent = text;
          status.setAttribute('role', isError ? 'alert' : 'status');
        };
        const requestFromFields = (): PivotRequest => ({
          rowField: Number(rowSelect.value),
          columnField: columnSelect.value === '' ? null : Number(columnSelect.value),
          valueField: Number(valueSelect.value),
          aggregation: PIVOT_AGGREGATIONS.find((name) => name === aggregationSelect.value) ?? 'sum',
        });
        const run = (action: (request: PivotRequest) => PivotCreateOutcome): void => {
          const outcome = action(requestFromFields());
          if (!outcome.ok) {
            setStatus(t(`pivot.error.${outcome.error.code}`, outcome.error.params), true);
            return;
          }
          setStatus(statusOf(outcome), false);
        };
        const update = input.update;
        const createButton = dialogButton(t('dialog.pivot.create'), !update, false, () => run(input.create));
        const updateButton = update
          ? dialogButton(t('dialog.pivot.update'), true, false, () => run(update))
          : null;
        if (!hasColumns) {
          createButton.disabled = true;
          if (updateButton) {
            updateButton.disabled = true;
          }
          setStatus(t('pivot.error.noColumns'), true);
        }
        if (updateButton) {
          buttons.append(createButton, updateButton);
        } else {
          buttons.append(createButton);
        }
      },
    );
  }
}
