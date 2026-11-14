// SPDX-License-Identifier: MIT
import type { PivotDialogInput } from '../../app/commands';
import { t } from '../../app/i18n';
import { PIVOT_AGGREGATIONS, type PivotRequest } from '../../core/pivot';
import { Sigma } from 'lucide';
import { el } from '../dom';
import { formField, formSection } from './form-layout';
import { dialogButton } from './shared';
import { openSidePanel } from './side-panel';

/**
 * A select over the table's field names, each option valued by its column
 * index. `withNone` adds a first option for no field, valued ''.
 */
function fieldSelect(columns: string[], selected: number, withNone: boolean): HTMLSelectElement {
  const select = el('select') as HTMLSelectElement;
  if (withNone) {
    select.append(el('option', { text: t('dialog.pivot.noColumnField'), attrs: { value: '' } }));
  }
  columns.forEach((name, index) => {
    select.append(el('option', { text: name, attrs: { value: String(index) } }));
  });
  select.value = withNone ? '' : String(selected);
  return select;
}

/**
 * The pivot table panel, a side panel beside the sheet like the SQL and
 * compare panels: choose a row field, an optional column field, a value field,
 * and how to summarize the value. Create in New Sheet puts the summary into a
 * new sheet, and the panel stays open for another summary of the same table.
 * Nothing here changes the source (see `src/core/pivot.ts`).
 */
export class PivotDialogs {
  showPivot(input: PivotDialogInput): Promise<void> {
    return openSidePanel<void>(
      { title: t('dialog.pivot.title'), icon: Sigma, fallback: undefined, key: 'data.pivotTable' },
      (body, buttons) => {
        const hasColumns = input.columns.length > 0;
        const rowSelect = fieldSelect(input.columns, 0, false);
        const columnSelect = fieldSelect(input.columns, 0, true);
        // The last column is the likeliest value (an amount or a score), so it is the default.
        const valueSelect = fieldSelect(input.columns, Math.max(0, input.columns.length - 1), false);
        const aggregationSelect = el('select') as HTMLSelectElement;
        for (const aggregation of PIVOT_AGGREGATIONS) {
          aggregationSelect.append(
            el('option', { text: t(`pivot.aggregation.${aggregation}`), attrs: { value: aggregation } }),
          );
        }
        aggregationSelect.value = 'sum';
        const status = el('p', {
          className: 'dialog-note',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        body.append(
          formSection(null, [
            el('p', { text: t('dialog.pivot.intro') }),
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
        const create = (): void => {
          const aggregation = PIVOT_AGGREGATIONS.find((name) => name === aggregationSelect.value) ?? 'sum';
          const request: PivotRequest = {
            rowField: Number(rowSelect.value),
            columnField: columnSelect.value === '' ? null : Number(columnSelect.value),
            valueField: Number(valueSelect.value),
            aggregation,
          };
          const outcome = input.create(request);
          if (!outcome.ok) {
            setStatus(t(`pivot.error.${outcome.error.code}`, outcome.error.params), true);
            return;
          }
          const created = t('dialog.pivot.status.created', { name: outcome.sheetName });
          setStatus(
            outcome.ignored > 0
              ? `${created} ${t('dialog.pivot.status.ignored', { count: outcome.ignored })}`
              : created,
            false,
          );
        };
        const createButton = dialogButton(t('dialog.pivot.create'), true, false, create);
        if (!hasColumns) {
          createButton.disabled = true;
          setStatus(t('pivot.error.noColumns'), true);
        }
        buttons.append(createButton);
      },
    );
  }
}
