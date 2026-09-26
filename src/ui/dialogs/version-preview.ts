// SPDX-License-Identifier: MIT
import { X } from 'lucide';
import { AppState } from '../../app/app-state';
import { Commands, type UiPort } from '../../app/commands';
import { t } from '../../app/i18n';
import { decodeRsfHistorySnapshot, type RsfHistorySnapshot } from '../../core/rsf-codec';
import { RsfDocument } from '../../core/rsf-document';
import { el, focusWithoutKeyboard } from '../dom';
import { Grid } from '../grid';
import { createIcon } from '../icon';
import { SheetBar } from '../sheet-bar';
import { dialogButton, openDialog } from './shared';

/**
 * A `UiPort` that never shows anything and always resolves as if the user
 * cancelled it — everything the read-only preview shell below could reach
 * either (a) opens a picker/confirmation dialog *before* attempting to
 * mutate anything, which this answers immediately with "cancelled, nothing
 * changed", or (b) mutates directly through `AppState`, which already
 * refuses a write on a `readOnly` tab (`refuseReadOnlyWrite`,
 * `refuseLockedSheetWrite`) before this port would ever be consulted. Purely
 * informational actions that never mutate (Copy, cell navigation, the
 * built-in SQL/Diff panels) are unaffected — they don't go through `UiPort`
 * at all.
 */
function noOpUiPort(): UiPort {
  return {
    confirmValidation: async () => false,
    confirmUnsaved: async () => 'cancel',
    chooseSaveOptions: async () => null,
    promptDriveName: async () => null,
    confirmUnrepresentable: async () => false,
    notifyNcr: async () => undefined,
    confirmUndecodableEdit: async () => false,
    chooseReopen: async () => null,
    chooseRecentFile: async () => null,
    confirmConvert: async () => false,
    explainRsfSave: async () => false,
    chooseExportCsv: async () => null,
    chooseInsertShift: async () => null,
    confirmFlashFill: async () => false,
    chooseFilter: async () => null,
    chooseColumnMenu: async () => null,
    chooseSort: async () => null,
    chooseDataValidation: async () => null,
    chooseConditionalFormat: async () => null,
    chooseCellComment: async () => null,
    promptSheetName: async () => null,
    confirmDeleteSheet: async () => false,
    chooseExportSheet: async () => null,
    confirmExportXlsx: async () => false,
    confirmExportJson: async () => false,
    confirm: async () => false,
    showMessage: async () => undefined,
    notify: () => {},
    openFindBar: () => {},
    findNext: () => {},
    showAbout: () => {},
    showFormulaHelp: () => {},
    showSqlQuery: async () => undefined,
    showDiff: async () => undefined,
    confirmReplaceAllWorkbook: async () => false,
    confirmRangeMoveOverwrite: async () => false,
    promptMoveTarget: async () => null,
    promptGoToCell: async () => null,
    chooseSettings: async () => null,
    chooseTimezone: async () => null,
    chooseDisplayLanguage: async () => null,
    chooseVersionHistory: async () => null,
    confirmHistoryCapExceeded: async () => false,
    chooseTextColor: async () => null,
    chooseRichText: async () => null,
    chooseBackgroundColor: async () => null,
    chooseBorders: async () => null,
    chooseNumberFormat: async () => null,
    setBusy: () => {},
  };
}

/** A plain error dialog for a snapshot that fails to decode, or decodes to a workbook with no worksheets at all. */
function openDecodeFailedDialog(title: string): void {
  void openDialog<void>(title, undefined, (body, buttons, close) => {
    body.append(el('p', { className: 'dialog-note', text: t('dialog.versionHistoryPreview.decodeFailed') }));
    buttons.append(dialogButton(t('dialog.close'), true, true, () => close(undefined)));
  });
}

/**
 * Sheet ▸ File Version History…'s "Preview" action (#533), redesigned by
 * #536 into a full-screen, read-only book: the real virtualized `Grid` and
 * `SheetBar` against the snapshot's actual, evaluated content — every
 * worksheet, no row/column cap — instead of a bounded plain-HTML table of
 * raw (unevaluated) cell inputs.
 *
 * Built from a private, throwaway `AppState`/`Commands` pair, never the live
 * app's: one `Tab` whose document is `RsfDocument.fromWorkbookData` from
 * this snapshot's decoded bytes, marked `readOnly` from creation so every
 * edit path is refused centrally by `AppState` itself, with `noOpUiPort`
 * above suppressing what would otherwise be a "this book is protected"
 * warning dialog (see Commit 8 / `warnProtectedAndOfferUnlock`) on every
 * attempt. `Restore` (on the version-history dialog underneath, which this
 * stacks on top of rather than replaces) is completely unaffected — this
 * view never touches it.
 */
export function openVersionHistoryPreview(snapshot: RsfHistorySnapshot, when: string): void {
  const title = t('dialog.versionHistoryPreview.title', { when });
  const decoded = decodeRsfHistorySnapshot(snapshot);
  if (!decoded.ok || decoded.data.sheets.length === 0) {
    openDecodeFailedDialog(title);
    return;
  }

  const state = new AppState();
  const commands = new Commands(state, noOpUiPort(), document);
  const doc = RsfDocument.fromWorkbookData(decoded.data, title);
  state.addTab(doc.name, doc, null, true);

  const grid = new Grid(state, commands);
  const sheetBar = new SheetBar(state, commands);
  // Mirrors the live app's own vertical order (Commit 6): the worksheet
  // strip sits below the grid, not above it.
  const mainRow = el('div', { className: 'main-row' }, [grid.element]);
  const body = el('div', { className: 'version-preview-body' }, [mainRow, sheetBar.element]);

  const dialog = el('dialog', {
    className: 'version-preview-dialog',
    attrs: { 'aria-labelledby': 'version-preview-title' },
  });
  const titleEl = el('span', { text: title, attrs: { id: 'version-preview-title' } });
  const closeBtn = el('button', {
    className: 'markdown-preview-panel-close',
    attrs: { type: 'button', 'aria-label': t('dialog.close') },
  });
  closeBtn.append(createIcon(X, 'markdown-preview-panel-close-icon', 16));
  const heading = el('div', { className: 'dialog-title version-preview-title' }, [titleEl, closeBtn]);
  dialog.append(heading, body);

  const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;
  const unsubscribe = state.subscribe((event) => {
    switch (event) {
      case 'sheets':
      case 'doc':
        sheetBar.render();
        grid.refresh();
        return;
      case 'selection':
        grid.refreshSelection();
        return;
      default:
        return;
    }
  });
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe();
    grid.dispose();
    if (dialog.open) {
      dialog.close();
    }
    dialog.remove();
    if (restoreFocus && restoreFocus.isConnected) {
      restoreFocus.focus();
    }
  };
  closeBtn.addEventListener('click', finish);
  // Escape triggers 'cancel'; some environments never fire 'close', so
  // teardown runs from both (idempotent via the `closed` guard above) —
  // mirrors `openDialog` in `./shared.ts`.
  dialog.addEventListener('cancel', finish);
  dialog.addEventListener('close', finish);

  document.body.append(dialog);
  dialog.showModal();
  grid.refresh();
  focusWithoutKeyboard(grid.element);
}
