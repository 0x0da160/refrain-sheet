// SPDX-License-Identifier: MIT
import { CircleHelp, Database } from 'lucide';
import type { SqlQueryDialogInput, SqlRunOutcome } from '../../app/commands';
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
import { createIcon } from '../icon';
import { dialogButton } from './shared';
import { sqlQueryBuilder } from './sql-builder';
import { formField, formSection } from './form-layout';
import { openSidePanel } from './side-panel';

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
 * query engine and its documented scope/limits. Docked like Filter/Sort/
 * Format (`openSidePanel`) rather than a centered modal, so the sheet stays
 * visible and usable while a query runs (#399).
 *
 * The editor also offers auto-formatting, live (structural-only) syntax
 * checking, and prefix-match suggestions for keywords/functions/columns,
 * plus a locally-stored run history and named saved queries (see
 * `src/app/sql-queries.ts` — device-local `localStorage`, never embedded in
 * an exported CSV or RSF workbook).
 */
export class SqlQueryDialogs {
  showSqlQuery(input: SqlQueryDialogInput): Promise<void> {
    return openSidePanel<void>(
      { title: t('dialog.sqlQuery.title'), icon: Database, fallback: undefined },
      (body) => {
        body.classList.add('sql-query-dialog');

        // ----- Help (hidden until the help icon is pressed) -----
        const { helpPanel, helpToggle } = sqlHelp();

        // ----- Data source picker and query editor -----
        const { sourceSelect, queryText, editorSection } = queryEditor(input, helpPanel, helpToggle);

        // ----- Query builder: writes the query into the editor as choices change -----
        const builder = sqlQueryBuilder(input.columns(sourceSelect.value), (query) => {
          queryText.value = query;
          refreshSuggestions();
          refreshSyntaxStatus();
        });
        sourceSelect.addEventListener('change', () => builder.setColumns(input.columns(sourceSelect.value)));
        body.append(formSection(null, [builder.element]), editorSection);

        // ----- Suggestions (keywords / functions / columns) -----
        const suggestionsWrap = suggestionsGroup();
        editorSection.append(suggestionsWrap);

        const refreshSuggestions = (): void => {
          const caret = queryText.selectionStart ?? queryText.value.length;
          const columns = input.columns(sourceSelect.value);
          const matches = suggestSqlCompletions(queryText.value, caret, columns);
          suggestionsWrap.hidden = matches.length === 0;
          suggestionsWrap.replaceChildren(
            ...matches.map((suggestion) =>
              suggestionChip(suggestion, () => {
                insertSuggestion(queryText, suggestion.text);
                refreshSuggestions();
                refreshSyntaxStatus();
              }),
            ),
          );
        };

        // ----- Live (structural-only) syntax check -----
        const syntaxStatus = el('p', {
          className: 'sql-query-syntax-status',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        editorSection.append(syntaxStatus);

        const refreshSyntaxStatus = (): void => {
          const query = queryText.value;
          const err = query.trim() === '' ? null : checkSqlSyntax(query);
          syntaxStatus.classList.toggle('sql-query-syntax-status-error', err !== null);
          if (!err) {
            syntaxStatus.textContent = '';
            return;
          }
          syntaxStatus.textContent = sqlErrorText(err);
        };

        queryText.addEventListener('input', () => {
          refreshSuggestions();
          refreshSyntaxStatus();
        });
        queryText.addEventListener('click', refreshSuggestions);
        queryText.addEventListener('keyup', refreshSuggestions);
        sourceSelect.addEventListener('change', refreshSuggestions);

        // ----- Format / Run buttons (neither closes the dialog) -----
        const { runRow, runButton } = runControls(
          () => {
            queryText.value = formatSqlQuery(queryText.value);
            refreshSuggestions();
            refreshSyntaxStatus();
          },
          () => void runQuery(),
        );
        editorSection.append(runRow);

        // ----- Status (announced) and results -----
        const { resultsWrap, setStatus } = statusArea(editorSection);

        // ----- Put Results in New Sheet (shown once a query returned columns) -----
        const writeResult = writeResultButton(input, setStatus);
        editorSection.append(writeResult.button);

        const renderResult = (result: SqlQueryResult): void => {
          resultsWrap.replaceChildren();
          if (result.columns.length === 0) {
            setStatus(t('dialog.sqlQuery.status.noColumns'), false);
            return;
          }
          resultsWrap.append(sqlResultTable(result));
          setStatus(sqlStatusText(result), false);
          writeResult.offer(result);
        };

        // ----- Query history -----
        const { listsSection, historyBody } = historySection();
        body.append(listsSection);

        const loadEntry = (query: string, sourceId: string): void => {
          queryText.value = query;
          sourceSelect.value = sourceId;
          refreshSuggestions();
          refreshSyntaxStatus();
          queryText.focus();
        };

        const renderHistory = (): void => renderHistoryList(historyBody, loadEntry);
        renderHistory();

        // ----- Saved queries -----
        savedQueriesSection(listsSection, loadEntry, () => ({
          query: queryText.value,
          sourceId: sourceSelect.value,
        }));

        // ----- Run -----
        const runQuery = async (): Promise<void> => {
          resultsWrap.replaceChildren();
          writeResult.offer(null);
          const query = queryText.value;
          const sourceId = sourceSelect.value;
          runButton.disabled = true;
          setStatus(t('dialog.sqlQuery.status.running'), false);
          let outcome: SqlRunOutcome;
          try {
            outcome = await input.runQuery(sourceId, query);
          } finally {
            runButton.disabled = false;
          }
          if (query.trim() !== '') {
            const [latest] = getSqlHistory();
            if (!latest || latest.query !== query || latest.sourceId !== sourceId) {
              const sourceName = sourceSelect.selectedOptions[0]?.text ?? sourceId;
              addSqlHistoryEntry({ query, sourceId, sourceName, ranAt: Date.now() });
              renderHistory();
            }
          }
          if (!outcome.ok) {
            setStatus(sqlErrorText(outcome.error), true);
            return;
          }
          renderResult(outcome.result);
        };
      },
    );
  }
}

/** The query help panel (hidden until toggled) and its toggle button. */
function sqlHelp(): { helpPanel: HTMLElement; helpToggle: HTMLElement } {
  const helpPanel = el('div', { className: 'sql-query-help-panel', attrs: { id: 'sql-query-help-panel' } }, [
    el('p', { text: t('dialog.sqlQuery.intro') }),
    el('p', { className: 'sql-query-help-title', text: t('dialog.sqlQuery.help.summary') }),
    el('p', { text: t('dialog.sqlQuery.help.body') }),
    el('p', { className: 'help-examples' }, [
      el('code', {
        className: 'help-code',
        text: 'SELECT department, COUNT(*) AS n, SUM(amount) AS total FROM data WHERE amount > 0 GROUP BY department ORDER BY total DESC LIMIT 100',
      }),
    ]),
  ]);
  helpPanel.hidden = true;
  const helpToggle = el('button', {
    className: 'sql-query-help-toggle',
    attrs: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'sql-query-help-panel',
      'aria-label': t('dialog.sqlQuery.help.toggle'),
      title: t('dialog.sqlQuery.help.toggle'),
    },
  });
  helpToggle.append(createIcon(CircleHelp, 'sql-query-help-icon', 16));
  helpToggle.addEventListener('click', () => {
    helpPanel.hidden = !helpPanel.hidden;
    helpToggle.setAttribute('aria-expanded', String(!helpPanel.hidden));
  });
  return { helpPanel, helpToggle };
}

/**
 * Put Results in New Sheet: hidden until `offer` gives it a result, then
 * puts that result into a new sheet and reports where.
 */
function writeResultButton(
  input: SqlQueryDialogInput,
  setStatus: (text: string, isError: boolean) => void,
): { button: HTMLButtonElement; offer: (result: SqlQueryResult | null) => void } {
  let offered: SqlQueryResult | null = null;
  const button = dialogButton(t('dialog.sqlQuery.writeResult'), false, false, () => {
    if (!offered) {
      return;
    }
    const name = input.writeResult(offered);
    setStatus(
      name === null
        ? t('dialog.sqlQuery.writeFailed')
        : offered.truncated
          ? t('dialog.sqlQuery.writtenPartly', { name, rows: offered.rows.length })
          : t('dialog.sqlQuery.written', { name }),
      name === null,
    );
  });
  button.classList.add('panel-button', 'sql-query-write');
  button.hidden = true;
  const offer = (result: SqlQueryResult | null): void => {
    offered = result;
    button.hidden = result === null;
  };
  return { button, offer };
}

/** A localized query error, with its position when the engine reported one. */
function sqlErrorText(err: {
  code: string;
  params?: Record<string, string | number>;
  location?: { offset: number } | null;
}): string {
  const message = t(`sql.error.${err.code}`, err.params);
  return err.location
    ? `${message} ${t('sql.error.atPosition', { offset: err.location.offset + 1 })}`
    : message;
}

/** The accessible results table. */
function sqlResultTable(result: SqlQueryResult): HTMLElement {
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
  return table;
}

/** The announced result summary: rows shown, and whether results or the source were truncated. */
function sqlStatusText(result: SqlQueryResult): string {
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
  return parts.join(' ');
}

/** One history or saved-query entry: its label, the query, and Load / Delete buttons. */
function queryListItem(
  meta: string,
  query: string,
  labels: { load: string; delete: string },
  onLoad: () => void,
  onDelete: () => void,
): HTMLElement {
  const item = el('li', { className: 'sql-query-list-item' }, [
    el('div', { className: 'sql-query-list-text' }, [
      el('span', { className: 'sql-query-list-meta', text: meta }),
      el('code', { className: 'sql-query-list-code', text: query }),
    ]),
  ]);
  const loadButton = el('button', {
    className: 'panel-button',
    text: labels.load,
    attrs: { type: 'button' },
  });
  loadButton.addEventListener('click', onLoad);
  const deleteButton = el('button', {
    className: 'panel-button',
    text: labels.delete,
    attrs: { type: 'button' },
  });
  deleteButton.addEventListener('click', onDelete);
  item.append(el('div', { className: 'sql-query-list-actions' }, [loadButton, deleteButton]));
  return item;
}

/** The device-local run history (newest first), with Clear. */
function renderHistoryList(
  historyBody: HTMLElement,
  loadEntry: (query: string, sourceId: string) => void,
): void {
  historyBody.replaceChildren();
  const entries = getSqlHistory();
  if (entries.length === 0) {
    historyBody.append(el('p', { className: 'dialog-note', text: t('dialog.sqlQuery.history.empty') }));
    return;
  }
  const rerender = (): void => renderHistoryList(historyBody, loadEntry);
  const clearButton = el('button', {
    className: 'panel-button sql-query-list-clear',
    text: t('dialog.sqlQuery.history.clear'),
    attrs: { type: 'button' },
  });
  clearButton.addEventListener('click', () => {
    clearSqlHistory();
    rerender();
  });
  historyBody.append(clearButton);
  const labels = { load: t('dialog.sqlQuery.history.load'), delete: t('dialog.sqlQuery.history.delete') };
  const list = el('ul', { className: 'sql-query-list' });
  entries.forEach((entry, index) => {
    list.append(
      queryListItem(
        `${entry.sourceName} — ${formatWhen(entry.ranAt)}`,
        entry.query,
        labels,
        () => loadEntry(entry.query, entry.sourceId),
        () => {
          removeSqlHistoryEntry(index);
          rerender();
        },
      ),
    );
  });
  historyBody.append(list);
}

/** The named saved queries. */
function renderSavedList(
  savedListWrap: HTMLElement,
  loadEntry: (query: string, sourceId: string) => void,
): void {
  savedListWrap.replaceChildren();
  const entries = getSqlSavedQueries();
  if (entries.length === 0) {
    savedListWrap.append(el('p', { className: 'dialog-note', text: t('dialog.sqlQuery.saved.empty') }));
    return;
  }
  const labels = { load: t('dialog.sqlQuery.saved.load'), delete: t('dialog.sqlQuery.saved.delete') };
  const list = el('ul', { className: 'sql-query-list' });
  for (const entry of entries) {
    list.append(
      queryListItem(
        entry.name,
        entry.query,
        labels,
        () => loadEntry(entry.query, entry.sourceId),
        () => {
          deleteSqlSavedQuery(entry.id);
          renderSavedList(savedListWrap, loadEntry);
        },
      ),
    );
  }
  savedListWrap.append(list);
}

/** The data-source picker and the query textarea (with the help toggle in its label row). */
function queryEditor(
  input: SqlQueryDialogInput,
  helpPanel: HTMLElement,
  helpToggle: HTMLElement,
): { sourceSelect: HTMLSelectElement; queryText: HTMLTextAreaElement; editorSection: HTMLElement } {
  const sourceSelect = el('select', { attrs: { id: 'sql-query-source' } }) as HTMLSelectElement;
  for (const source of input.sources) {
    sourceSelect.append(el('option', { text: source.name, attrs: { value: source.id } }));
  }
  const queryLabel = el('label', {
    className: 'form-field-label',
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
  const editorSection = formSection(null, [
    formField(t('dialog.sqlQuery.source'), sourceSelect),
    el('div', { className: 'form-field' }, [
      el('div', { className: 'form-field-header' }, [queryLabel, helpToggle]),
      helpPanel,
      queryText,
    ]),
  ]);
  return { sourceSelect, queryText, editorSection };
}

/** The (initially hidden) row of suggestion chips. */
function suggestionsGroup(): HTMLElement {
  const wrap = el('div', {
    className: 'sql-query-suggestions',
    attrs: { role: 'group', 'aria-label': t('dialog.sqlQuery.suggestions.label') },
  });
  wrap.hidden = true;
  return wrap;
}

/** One keyword / function / column suggestion chip. */
function suggestionChip(suggestion: { kind: string; text: string }, onPick: () => void): HTMLElement {
  const chip = el('button', {
    className: `sql-query-suggestion sql-query-suggestion-${suggestion.kind}`,
    text: suggestion.text,
    attrs: { type: 'button' },
  });
  chip.addEventListener('click', onPick);
  return chip;
}

/** The saved-queries list and the name + Save form (bounded name length and count). */
function savedQueriesSection(
  listsSection: HTMLElement,
  loadEntry: (query: string, sourceId: string) => void,
  current: () => { query: string; sourceId: string },
): void {
  const savedDetails = el('details', { className: 'sql-query-saved' });
  const savedBody = el('div', { className: 'sql-query-saved-body' });
  savedDetails.append(el('summary', { text: t('dialog.sqlQuery.saved.title') }), savedBody);
  listsSection.append(savedDetails);
  const saveNameInput = el('input', {
    className: 'sql-query-save-name',
    attrs: {
      type: 'text',
      placeholder: t('dialog.sqlQuery.saved.namePlaceholder'),
      'aria-label': t('dialog.sqlQuery.saved.nameLabel'),
      maxlength: String(SQL_MAX_SAVED_NAME_LENGTH),
    },
  }) as HTMLInputElement;
  const saveError = el('p', { className: 'dialog-error', attrs: { role: 'status', 'aria-live': 'polite' } });
  const saveButton = el('button', {
    className: 'panel-button',
    text: t('dialog.sqlQuery.saved.save'),
    attrs: { type: 'button' },
  });
  const savedListWrap = el('div', { className: 'sql-query-saved-list' });
  savedBody.append(
    el('div', { className: 'form-inline sql-query-save-row' }, [saveNameInput, saveButton]),
    saveError,
    savedListWrap,
  );
  const renderSaved = (): void => renderSavedList(savedListWrap, loadEntry);
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
    const { query, sourceId } = current();
    saveSqlQuery(name, query, sourceId);
    saveNameInput.value = '';
    saveError.textContent = '';
    renderSaved();
  });
}

/** The Format and Run buttons (neither closes the panel). */
function runControls(
  onFormat: () => void,
  onRun: () => void,
): { runRow: HTMLElement; runButton: HTMLButtonElement } {
  const runRow = el('div', { className: 'form-inline form-inline-end sql-query-run-row' });
  const formatButton = dialogButton(t('dialog.sqlQuery.format'), false, false, onFormat);
  const runButton = dialogButton(t('dialog.sqlQuery.run'), true, false, onRun);
  formatButton.classList.add('panel-button');
  runButton.classList.add('panel-button');
  runRow.append(formatButton, runButton);
  return { runRow, runButton };
}

/** The announced status line and the results area, appended to `into`. */
function statusArea(into: HTMLElement): {
  resultsWrap: HTMLElement;
  setStatus: (text: string, isError: boolean) => void;
} {
  const status = el('p', { className: 'sql-query-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const resultsWrap = el('div', { className: 'sql-query-results', attrs: { tabindex: '0' } });
  into.append(status, resultsWrap);
  const setStatus = (text: string, isError: boolean): void => {
    status.textContent = text;
    status.setAttribute('role', isError ? 'alert' : 'status');
  };
  return { resultsWrap, setStatus };
}

/** The collapsible run-history list, in the section that also holds the saved queries. */
function historySection(): { listsSection: HTMLElement; historyBody: HTMLElement } {
  const historyDetails = el('details', { className: 'sql-query-history' });
  const historyBody = el('div', { className: 'sql-query-history-body' });
  historyDetails.append(el('summary', { text: t('dialog.sqlQuery.history.title') }), historyBody);
  return { listsSection: formSection(null, [historyDetails]), historyBody };
}
