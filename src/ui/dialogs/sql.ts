// SPDX-License-Identifier: MIT
import type { SqlQueryDialogInput } from '../../app/commands';
import { t } from '../../app/i18n';
import { SQL_MAX_SOURCE_ROWS, type SqlQueryResult } from '../../core/sql-engine';
import { el } from '../dom';
import { dialogButton, openDialog } from './shared';

/**
 * The local SQL analysis panel: pick a data source (a worksheet of the
 * active workbook, or the open CSV), write a read-only SQL query, run it,
 * and view the result in an accessible, keyboard-navigable table. Nothing
 * here mutates the source document — see `src/core/sql-engine.ts` for the
 * query engine and its documented scope/limits.
 */
export class SqlQueryDialogs {
  showSqlQuery(input: SqlQueryDialogInput): Promise<void> {
    return openDialog<void>(t('dialog.sqlQuery.title'), undefined, (body, buttons, close) => {
      body.classList.add('sql-query-dialog');
      body.append(el('p', { text: t('dialog.sqlQuery.intro') }));

      // ----- Data source picker -----
      const sourceLabel = el('label', {
        className: 'form-label',
        text: t('dialog.sqlQuery.source'),
        attrs: { for: 'sql-query-source' },
      });
      const sourceSelect = el('select', { attrs: { id: 'sql-query-source' } });
      for (const source of input.sources) {
        sourceSelect.append(el('option', { text: source.name, attrs: { value: source.id } }));
      }
      body.append(el('div', { className: 'form-row' }, [sourceLabel, sourceSelect]));

      // ----- Query editor -----
      const queryLabel = el('label', {
        className: 'form-label',
        text: t('dialog.sqlQuery.query'),
        attrs: { for: 'sql-query-text' },
      });
      const queryText = el('textarea', {
        className: 'sql-query-input',
        attrs: {
          id: 'sql-query-text',
          rows: '6',
          spellcheck: 'false',
          'data-autofocus': 'true',
          'aria-label': t('dialog.sqlQuery.query'),
        },
      });
      queryText.value = 'SELECT * FROM data';
      body.append(el('div', { className: 'form-row' }, [queryLabel, queryText]));

      const help = el('details', { className: 'sql-query-help' }, [
        el('summary', { text: t('dialog.sqlQuery.help.summary') }),
        el('p', { text: t('dialog.sqlQuery.help.body') }),
        el('p', { className: 'help-examples' }, [
          el('code', {
            className: 'help-code',
            text: 'SELECT department, COUNT(*) AS n, SUM(amount) AS total FROM data WHERE amount > 0 GROUP BY department ORDER BY total DESC LIMIT 100',
          }),
        ]),
      ]);
      body.append(help);

      // ----- Run button (does not close the dialog) -----
      const runRow = el('div', { className: 'form-row sql-query-run-row' });
      const runButton = dialogButton(t('dialog.sqlQuery.run'), true, false, () => void runQuery());
      runRow.append(runButton);
      body.append(runRow);

      // ----- Status (announced) and results -----
      const status = el('p', {
        className: 'sql-query-status',
        attrs: { role: 'status', 'aria-live': 'polite' },
      });
      body.append(status);
      const resultsWrap = el('div', { className: 'sql-query-results', attrs: { tabindex: '0' } });
      body.append(resultsWrap);

      const setStatus = (text: string, isError: boolean): void => {
        status.textContent = text;
        status.setAttribute('role', isError ? 'alert' : 'status');
      };

      const renderResult = (result: SqlQueryResult): void => {
        resultsWrap.replaceChildren();
        if (result.columns.length === 0) {
          setStatus(t('dialog.sqlQuery.status.noColumns'), false);
          return;
        }
        const table = el('table', { className: 'diag-table sql-query-table' });
        const caption = el('caption', {
          className: 'visually-hidden',
          text: t('dialog.sqlQuery.tableCaption', { rows: result.rows.length, cols: result.columns.length }),
        });
        const headRow = el(
          'tr',
          {},
          result.columns.map((name) => el('th', { text: name, attrs: { scope: 'col' } })),
        );
        const tbody = el('tbody');
        for (const row of result.rows) {
          tbody.append(
            el(
              'tr',
              {},
              row.map((cell) => el('td', { text: String(cell) })),
            ),
          );
        }
        table.append(caption, el('thead', {}, [headRow]), tbody);
        resultsWrap.append(table);

        const parts: string[] = [];
        if (result.truncated) {
          parts.push(
            t('dialog.sqlQuery.status.truncated', { shown: result.rows.length, matched: result.matchedRows }),
          );
        } else {
          parts.push(t('dialog.sqlQuery.status.success', { rows: result.rows.length }));
        }
        if (result.sourceTruncated) {
          parts.push(t('dialog.sqlQuery.status.sourceTruncated', { cap: SQL_MAX_SOURCE_ROWS }));
        }
        setStatus(parts.join(' '), false);
      };

      const runQuery = (): void => {
        resultsWrap.replaceChildren();
        const outcome = input.runQuery(sourceSelect.value, queryText.value);
        if (!outcome.ok) {
          const err = outcome.error;
          const message = t(`sql.error.${err.code}`, err.params);
          const located = err.location
            ? `${message} ${t('sql.error.atPosition', { offset: err.location.offset + 1 })}`
            : message;
          setStatus(located, true);
          return;
        }
        renderResult(outcome.result);
      };

      buttons.append(dialogButton(t('dialog.sqlQuery.close'), false, true, () => close(undefined)));
    });
  }
}
