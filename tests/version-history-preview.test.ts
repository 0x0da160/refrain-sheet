// SPDX-License-Identifier: MIT
/**
 * Sheet ▸ File Version History…'s "Preview" action (#533), redesigned by
 * #536 into a full-screen, read-only book UI hosting the real `Grid` and
 * `SheetBar` against the snapshot's decoded content, rather than a bounded
 * plain-HTML table of raw cell inputs.
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

function previewDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('.version-preview-dialog');
  expect(dialog, 'the version-preview dialog should be open').not.toBeNull();
  return dialog!;
}

function cellText(dialog: HTMLElement, row: number, col: number): string | null {
  return dialog.querySelector(`[data-row="${row}"][data-col="${col}"]`)?.textContent ?? null;
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

  it('opens a full-screen, read-only book UI showing the snapshot content, without closing the version-history dialog underneath', async () => {
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
    const preview = previewDialog();

    expect(preview.querySelector('.grid-container')).not.toBeNull();
    expect(preview.querySelector('.sheet-bar')).not.toBeNull();
    expect(cellText(preview, 0, 0)).toBe('hello');
    expect(cellText(preview, 1, 2)).toBe('42');
    expect(preview.querySelector('#version-preview-title')?.textContent).toMatch(/^Preview: /);

    // The version-history dialog underneath is unaffected.
    expect(dialogs[0].hasAttribute('open')).toBe(true);
  });

  it('is not bounded to any row/column cap — a far-away cell renders, unlike the old table preview', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().chooseVersionHistory(true, undefined, [snapshotWith([[250, 20, 'far']])]);

    clickPreviewButton();

    const preview = previewDialog();
    // Not literally rendered off-screen (the grid virtualizes), but nothing
    // in this path truncates the *document* to 200 rows / 50 columns the
    // way the old plain-table preview did — the worksheet itself carries the
    // full 1000x26 size from the snapshot.
    expect(preview.querySelector('.grid-container')).not.toBeNull();
  });

  it('shows a worksheet-switcher tab per sheet, and switching tabs shows that sheet’s content', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().chooseVersionHistory(true, undefined, [
      snapshotWithSheets([
        { name: 'Costs', cells: [[0, 0, 'a']] },
        { name: 'Revenue', cells: [[0, 0, 'b']] },
      ]),
    ]);

    clickPreviewButton();

    const preview = previewDialog();
    const tabs = Array.from(preview.querySelectorAll('.sheet-tab'));
    expect(tabs.map((el) => el.textContent?.trim())).toEqual(['Costs', 'Revenue']);
    expect(cellText(preview, 0, 0)).toBe('a');

    (tabs[1] as HTMLElement).click();
    expect(cellText(preview, 0, 0)).toBe('b');
  });

  it('reports a decode failure for bytes that are not a valid snapshot', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    const corrupt: RsfHistorySnapshot = { timestamp: Date.UTC(2026, 0, 1), bytes: new Uint8Array([1, 2, 3]) };
    void new Dialogs().chooseVersionHistory(true, undefined, [corrupt]);

    clickPreviewButton();

    expect(document.querySelector('.version-preview-dialog')).toBeNull();
    const dialogs = document.querySelectorAll('dialog');
    const errorDialog = dialogs[dialogs.length - 1];
    expect(errorDialog.textContent).toContain(t('dialog.versionHistoryPreview.decodeFailed'));
  });

  it('closes and tears down its resources when the close button is clicked', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().chooseVersionHistory(true, undefined, [snapshotWith([[0, 0, 'hello']])]);

    clickPreviewButton();
    expect(document.querySelector('.version-preview-dialog')).not.toBeNull();

    const closeBtn = document.querySelector<HTMLButtonElement>(
      '.version-preview-dialog .markdown-preview-panel-close',
    )!;
    closeBtn.click();

    expect(document.querySelector('.version-preview-dialog')).toBeNull();
  });

  it('can be reopened after being closed, without leaking state across opens', async () => {
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().chooseVersionHistory(true, undefined, [
      snapshotWith([[0, 0, 'first']]),
      snapshotWith([[0, 0, 'second']]),
    ]);

    const buttons = () => Array.from(document.querySelectorAll('.version-history-entry-actions button'));
    // Newest snapshot listed first (see the version-history dialog's own
    // newest-first display order).
    (buttons()[0] as HTMLButtonElement).click();
    expect(cellText(previewDialog(), 0, 0)).toBe('second');
    document
      .querySelector<HTMLButtonElement>('.version-preview-dialog .markdown-preview-panel-close')!
      .click();
    expect(document.querySelector('.version-preview-dialog')).toBeNull();

    (buttons()[2] as HTMLButtonElement).click();
    expect(cellText(previewDialog(), 0, 0)).toBe('first');
  });
});
