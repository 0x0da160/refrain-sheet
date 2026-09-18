// SPDX-License-Identifier: MIT
/**
 * Sheet ▸ File Version History…'s "Preview" action (#533): each snapshot
 * entry gets a read-only preview next to Restore, so a user can confirm a
 * snapshot's content before committing to the (irreversible) restore.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../src/app/i18n';
import { encodeRsfBody, type RsfHistorySnapshot, type RsfWorkbookData } from '../src/core/rsf-codec';

// jsdom does not implement <dialog>.showModal(); the shim only needs to make
// the element "open" so its content is queryable (see about-dialog.test.ts).
beforeEach(() => {
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
  setLocale(getLocale());
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

function snapshotWithSheets(
  sheets: Array<{ name: string; cells: Array<[number, number, string]> }>,
): RsfHistorySnapshot {
  const workbook: RsfWorkbookData = {
    delimiter: ',',
    sheets: sheets.map((sheet, i) => ({
      id: `s${i + 1}`,
      name: sheet.name,
      rowCount: 1000,
      columnCount: 26,
      cells: sheet.cells,
    })),
  };
  return { timestamp: Date.UTC(2026, 0, 1, 12, 0, 0), bytes: encodeRsfBody(workbook) };
}

function snapshotWith(cells: Array<[number, number, string]>): RsfHistorySnapshot {
  return snapshotWithSheets([{ name: 'Sheet1', cells }]);
}

function clickPreviewButton(): void {
  const button = document.querySelector('.version-history-entry-actions button') as HTMLButtonElement;
  button.click();
}

describe('Version history: Preview action', () => {
  it('adds a Preview action alongside Restore for each entry', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().chooseVersionHistory(true, undefined, [snapshotWith([[0, 0, 'hello']])]);

    const labels = Array.from(document.querySelectorAll('.version-history-entry-actions button')).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual([t('dialog.versionHistory.preview'), t('dialog.versionHistory.restore')]);
  });

  it('shows the snapshot content read-only, without closing the version-history dialog', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().chooseVersionHistory(true, undefined, [
      snapshotWith([
        [0, 0, 'hello'],
        [1, 2, '42'],
      ]),
    ]);

    clickPreviewButton();

    const dialogs = document.querySelectorAll('dialog');
    expect(dialogs.length).toBe(2);
    const preview = dialogs[1];

    const colHeaders = Array.from(preview.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(colHeaders).toEqual(['', 'A', 'B', 'C']);
    const rowHeaders = Array.from(preview.querySelectorAll('tbody th')).map((th) => th.textContent);
    expect(rowHeaders).toEqual(['1', '2']);
    const cellTexts = Array.from(preview.querySelectorAll('tbody td')).map((td) => td.textContent);
    expect(cellTexts).toEqual(['hello', '', '', '', '', '42']);

    // Restore is unaffected: the original dialog is still open underneath.
    expect(dialogs[0].hasAttribute('open')).toBe(true);
  });

  it('labels each worksheet by name when a snapshot has more than one', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().chooseVersionHistory(true, undefined, [
      snapshotWithSheets([
        { name: 'Costs', cells: [[0, 0, 'a']] },
        { name: 'Revenue', cells: [[0, 0, 'b']] },
      ]),
    ]);

    clickPreviewButton();

    const preview = document.querySelectorAll('dialog')[1];
    const headings = Array.from(preview.querySelectorAll('.dialog-body h3')).map((h) => h.textContent);
    expect(headings).toEqual(['Costs', 'Revenue']);
  });

  it('reports a decode failure for bytes that are not a valid snapshot', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    const corrupt: RsfHistorySnapshot = { timestamp: Date.UTC(2026, 0, 1), bytes: new Uint8Array([1, 2, 3]) };
    void new Dialogs().chooseVersionHistory(true, undefined, [corrupt]);

    clickPreviewButton();

    const preview = document.querySelectorAll('dialog')[1];
    expect(preview.textContent).toContain(t('dialog.versionHistoryPreview.decodeFailed'));
  });

  it('reports an empty sheet without rendering a table', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().chooseVersionHistory(true, undefined, [snapshotWith([])]);

    clickPreviewButton();

    const preview = document.querySelectorAll('dialog')[1];
    expect(preview.textContent).toContain(t('dialog.versionHistoryPreview.emptySheet'));
    expect(preview.querySelector('table')).toBeNull();
  });

  it('bounds the table to the preview cap and notes the truncation', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().chooseVersionHistory(true, undefined, [snapshotWith([[250, 0, 'far']])]);

    clickPreviewButton();

    const preview = document.querySelectorAll('dialog')[1];
    const rowHeaders = preview.querySelectorAll('tbody tr');
    expect(rowHeaders.length).toBe(200);
    expect(preview.textContent).toContain(
      t('dialog.versionHistoryPreview.truncated', { rows: 200, cols: 1 }),
    );
  });
});
