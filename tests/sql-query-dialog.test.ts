// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The SQL query dialog (`SqlQueryDialogs.showSqlQuery`): now docked like
 * Filter/Sort/Format instead of a centered modal (`openSidePanel` in place of
 * `openDialog`), so the sheet stays visible while a query runs (#399).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlQueryDialogInput } from '../src/app/commands';
import { getLocale, setLocale } from '../src/app/i18n';
import { SqlQueryDialogs } from '../src/ui/dialogs/sql';

function sqlInput(overrides: Partial<SqlQueryDialogInput> = {}): SqlQueryDialogInput {
  return {
    sources: [{ id: 's1', name: 'Sheet1' }],
    runQuery: vi.fn(async () => ({
      ok: true as const,
      result: {
        columns: ['a'],
        rows: [[1]],
        sourceRows: 1,
        matchedRows: 1,
        truncated: false,
        sourceTruncated: false,
      },
    })),
    columns: () => ['a'],
    ...overrides,
  };
}

describe('SqlQueryDialogs.showSqlQuery', () => {
  const locale = getLocale();

  beforeEach(() => {
    document.body.textContent = '';
    setLocale('en');
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    setLocale(locale);
    document.body.innerHTML = '';
  });

  it('renders as a dockable side panel, not a centered modal dialog', async () => {
    const dialogs = new SqlQueryDialogs();
    const promise = dialogs.showSqlQuery(sqlInput());

    const panel = document.querySelector('.side-panel');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.sql-query-dialog')).not.toBeNull();
    expect(document.querySelector('dialog')).toBeNull();

    panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
    expect(document.querySelector('.side-panel')).toBeNull();
  });

  it('hides the explanatory text until the help icon is pressed', async () => {
    const dialogs = new SqlQueryDialogs();
    const promise = dialogs.showSqlQuery(sqlInput());
    const panel = document.querySelector('.side-panel')!;

    const helpPanel = panel.querySelector('.sql-query-help-panel') as HTMLElement;
    const helpToggle = panel.querySelector('.sql-query-help-toggle') as HTMLButtonElement;
    expect(helpPanel.hidden).toBe(true);
    expect(helpToggle.getAttribute('aria-expanded')).toBe('false');

    helpToggle.click();
    expect(helpPanel.hidden).toBe(false);
    expect(helpToggle.getAttribute('aria-expanded')).toBe('true');
    expect(helpPanel.textContent).toContain('read-only SQL query');

    helpToggle.click();
    expect(helpPanel.hidden).toBe(true);
    expect(helpToggle.getAttribute('aria-expanded')).toBe('false');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('still runs a query and renders results from within the docked panel', async () => {
    const dialogs = new SqlQueryDialogs();
    const promise = dialogs.showSqlQuery(sqlInput());
    const panel = document.querySelector('.side-panel')!;

    const runButton = Array.from(panel.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Run'),
    ) as HTMLButtonElement;
    runButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.querySelector('table.sql-query-table')).not.toBeNull();

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });
});
