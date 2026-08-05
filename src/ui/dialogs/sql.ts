// SPDX-License-Identifier: MIT
import type { SqlQueryDialogInput } from '../../app/commands';
import { getLocale, t } from '../../app/i18n';
import {
  addSqlHistoryEntry,
  clearSqlHistory,
  deleteSqlSavedQuery,
  getSqlHistory,
  getSqlSavedQueries,
  removeSqlHistoryEntry,
  saveSqlQuery,
  SQL_MAX_SAVED_NAME_LENGTH,
  SQL_MAX_SAVED_QUERIES,
} from '../../app/sql-queries';
import {
  checkSqlSyntax,
  formatSqlQuery,
  suggestSqlCompletions,
  SQL_MAX_SOURCE_ROWS,
  type SqlQueryResult,
} from '../../core/sql-engine';
import { el } from '../dom';
import { dialogButton, openDialog } from './shared';

/** Formats a stored timestamp for display, in the app's current UI language. */
function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(getLocale() === 'ja' ? 'ja-JP' : 'en-US');
}

/** Replace the run of identifier characters immediately before the caret with `text`, then refocus. */
function insertSuggestion(textarea: HTMLTextAreaElement, text: string): void {
  const value = textarea.value;
  const caret = textarea.selectionStart ?? value.length;
  const before = value.slice(0, caret);
  const match = /[A-Za-z0-9_]+$/.exec(before);
  const start = match ? caret - match[0].length : caret;
  textarea.value = value.slice(0, start) + text + value.slice(caret);
  const nextCaret = start + text.length;
  textarea.setSelectionRange(nextCaret, nextCaret);
  textarea.focus();
}

/**
 * The local SQL analysis panel: pick a data source (a worksheet of the
 * active workbook, or the open CSV), write a read-only SQL query, run it,
 * and view the result in an accessible, keyboard-navigable table. Nothing
 * here mutates the source document — see `src/core/sql-engine.ts` for the
 * query engine and its documented scope/limits.
 *
 * The editor also offers auto-formatting, live (structural-only) syntax
 * checking, and prefix-match suggestions for keywords/functions/columns,
 * plus a locally-stored run history and named saved queries (see
 * `src/app/sql-queries.ts` — device-local `localStorage`, never embedded in
 * an exported CSV or RSF workbook).
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
      }) as HTMLTextAreaElement;
      queryText.value = 'SELECT * FROM data';
      body.append(el('div', { className: 'form-row' }, [queryLabel, queryText]));

      // ----- Suggestions (keywords / functions / columns) -----
      const suggestionsWrap = el('div', {
        className: 'sql-query-suggestions',
        attrs: { role: 'group', 'aria-label': t('dialog.sqlQuery.suggestions.label') },
      });
      suggestionsWrap.hidden = true;
      body.append(suggestionsWrap);

      const refreshSuggestions = (): void => {
        const caret = queryText.selectionStart ?? queryText.value.length;
        const columns = input.columns(sourceSelect.value);
        const matches = suggestSqlCompletions(queryText.value, caret, columns);
        suggestionsWrap.replaceChildren();
        suggestionsWrap.hidden = matches.length === 0;
        for (const s of matches) {
          const chip = el('button', {
            className: `sql-query-suggestion sql-query-suggestion-${s.kind}`,
            text: s.text,
            attrs: { type: 'button' },
          });
          chip.addEventListener('click', () => {
            insertSuggestion(queryText, s.text);
            refreshSuggestions();
            refreshSyntaxStatus();
          });
          suggestionsWrap.append(chip);
        }
      };

      // ----- Live (structural-only) syntax check -----
      const syntaxStatus = el('p', {
        className: 'sql-query-syntax-status',
        attrs: { role: 'status', 'aria-live': 'polite' },
      });
      body.append(syntaxStatus);

      const refreshSyntaxStatus = (): void => {
        const query = queryText.value;
        const err = query.trim() === '' ? null : checkSqlSyntax(query);
        syntaxStatus.classList.toggle('sql-query-syntax-status-error', err !== null);
        if (!err) {
          syntaxStatus.textContent = '';
          return;
        }
        const message = t(`sql.error.${err.code}`, err.params);
        syntaxStatus.textContent = err.location
          ? `${message} ${t('sql.error.atPosition', { offset: err.location.offset + 1 })}`
          : message;
      };

      queryText.addEventListener('input', () => {
        refreshSuggestions();
        refreshSyntaxStatus();
      });
      queryText.addEventListener('click', refreshSuggestions);
      queryText.addEventListener('keyup', refreshSuggestions);
      sourceSelect.addEventListener('change', refreshSuggestions);

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

      // ----- Format / Run buttons (neither closes the dialog) -----
      const runRow = el('div', { className: 'form-row sql-query-run-row' });
      const formatButton = dialogButton(t('dialog.sqlQuery.format'), false, false, () => {
        queryText.value = formatSqlQuery(queryText.value);
        refreshSuggestions();
        refreshSyntaxStatus();
      });
      const runButton = dialogButton(t('dialog.sqlQuery.run'), true, false, () => void runQuery());
      runRow.append(formatButton, runButton);
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

      // ----- Query history -----
      const historyDetails = el('details', { className: 'sql-query-history' });
      const historyBody = el('div', { className: 'sql-query-history-body' });
      historyDetails.append(el('summary', { text: t('dialog.sqlQuery.history.title') }), historyBody);
      body.append(historyDetails);

      const loadEntry = (query: string, sourceId: string): void => {
        queryText.value = query;
        sourceSelect.value = sourceId;
        refreshSuggestions();
        refreshSyntaxStatus();
        queryText.focus();
      };

      const renderHistory = (): void => {
        historyBody.replaceChildren();
        const entries = getSqlHistory();
        if (entries.length === 0) {
          historyBody.append(el('p', { className: 'dialog-note', text: t('dialog.sqlQuery.history.empty') }));
          return;
        }
        const clearButton = el('button', {
          className: 'sql-query-list-clear',
          text: t('dialog.sqlQuery.history.clear'),
          attrs: { type: 'button' },
        });
        clearButton.addEventListener('click', () => {
          clearSqlHistory();
          renderHistory();
        });
        historyBody.append(clearButton);

        const list = el('ul', { className: 'sql-query-list' });
        entries.forEach((entry, index) => {
          const item = el('li', { className: 'sql-query-list-item' }, [
            el('div', { className: 'sql-query-list-text' }, [
              el('span', {
                className: 'sql-query-list-meta',
                text: `${entry.sourceName} — ${formatWhen(entry.ranAt)}`,
              }),
              el('code', { className: 'sql-query-list-code', text: entry.query }),
            ]),
          ]);
          const loadButton = el('button', {
            text: t('dialog.sqlQuery.history.load'),
            attrs: { type: 'button' },
          });
          loadButton.addEventListener('click', () => loadEntry(entry.query, entry.sourceId));
          const deleteButton = el('button', {
            text: t('dialog.sqlQuery.history.delete'),
            attrs: { type: 'button' },
          });
          deleteButton.addEventListener('click', () => {
            removeSqlHistoryEntry(index);
            renderHistory();
          });
          item.append(el('div', { className: 'sql-query-list-actions' }, [loadButton, deleteButton]));
          list.append(item);
        });
        historyBody.append(list);
      };
      renderHistory();

      // ----- Saved queries -----
      const savedDetails = el('details', { className: 'sql-query-saved' });
      const savedBody = el('div', { className: 'sql-query-saved-body' });
      savedDetails.append(el('summary', { text: t('dialog.sqlQuery.saved.title') }), savedBody);
      body.append(savedDetails);

      const saveNameInput = el('input', {
        className: 'sql-query-save-name',
        attrs: {
          type: 'text',
          placeholder: t('dialog.sqlQuery.saved.namePlaceholder'),
          'aria-label': t('dialog.sqlQuery.saved.nameLabel'),
          maxlength: String(SQL_MAX_SAVED_NAME_LENGTH),
        },
      }) as HTMLInputElement;
      const saveError = el('p', {
        className: 'dialog-error',
        attrs: { role: 'status', 'aria-live': 'polite' },
      });
      const saveButton = el('button', { text: t('dialog.sqlQuery.saved.save'), attrs: { type: 'button' } });
      const savedListWrap = el('div', { className: 'sql-query-saved-list' });
      savedBody.append(
        el('div', { className: 'form-row sql-query-save-row' }, [saveNameInput, saveButton]),
        saveError,
        savedListWrap,
      );

      const renderSaved = (): void => {
        savedListWrap.replaceChildren();
        const entries = getSqlSavedQueries();
        if (entries.length === 0) {
          savedListWrap.append(el('p', { className: 'dialog-note', text: t('dialog.sqlQuery.saved.empty') }));
          return;
        }
        const list = el('ul', { className: 'sql-query-list' });
        for (const entry of entries) {
          const item = el('li', { className: 'sql-query-list-item' }, [
            el('div', { className: 'sql-query-list-text' }, [
              el('span', { className: 'sql-query-list-meta', text: entry.name }),
              el('code', { className: 'sql-query-list-code', text: entry.query }),
            ]),
          ]);
          const loadButton = el('button', {
            text: t('dialog.sqlQuery.saved.load'),
            attrs: { type: 'button' },
          });
          loadButton.addEventListener('click', () => loadEntry(entry.query, entry.sourceId));
          const deleteButton = el('button', {
            text: t('dialog.sqlQuery.saved.delete'),
            attrs: { type: 'button' },
          });
          deleteButton.addEventListener('click', () => {
            deleteSqlSavedQuery(entry.id);
            renderSaved();
          });
          item.append(el('div', { className: 'sql-query-list-actions' }, [loadButton, deleteButton]));
          list.append(item);
        }
        savedListWrap.append(list);
      };
      renderSaved();

      saveButton.addEventListener('click', () => {
        const name = saveNameInput.value.trim();
        if (name === '') {
          saveError.textContent = t('dialog.sqlQuery.saved.nameRequired');
          return;
        }
        if (getSqlSavedQueries().length >= SQL_MAX_SAVED_QUERIES) {
          saveError.textContent = t('dialog.sqlQuery.saved.limitReached', { max: SQL_MAX_SAVED_QUERIES });
          return;
        }
        saveSqlQuery(name, queryText.value, sourceSelect.value);
        saveNameInput.value = '';
        saveError.textContent = '';
        renderSaved();
      });

      // ----- Run -----
      const runQuery = (): void => {
        resultsWrap.replaceChildren();
        const query = queryText.value;
        const sourceId = sourceSelect.value;
        const outcome = input.runQuery(sourceId, query);
        if (query.trim() !== '') {
          const [latest] = getSqlHistory();
          if (!latest || latest.query !== query || latest.sourceId !== sourceId) {
            const sourceName = sourceSelect.selectedOptions[0]?.text ?? sourceId;
            addSqlHistoryEntry({ query, sourceId, sourceName, ranAt: Date.now() });
            renderHistory();
          }
        }
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
