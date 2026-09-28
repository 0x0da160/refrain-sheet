// SPDX-License-Identifier: MIT
/**
 * The browser implementation of the command layer's `UiPort`: dialogs,
 * toasts, the busy overlay, and the find bar. The command layer never
 * imports the UI; it only ever sees this object.
 */
import type { UiPort } from '../../app/commands';
import { closeColumnMenu } from '../column-menu';
import { closeAllContextMenus } from '../context-menu';
import type { Dialogs, Toasts } from '../dialogs';
import type { FindBar } from '../find-bar';
import type { LoadingOverlay } from '../loading-overlay';

export interface UiPortParts {
  dialogs: Dialogs;
  toasts: Toasts;
  loadingOverlay: LoadingOverlay;
  /**
   * Late-bound: the find bar itself needs the command layer (for Replace
   * All), which needs this port, so it is created afterwards.
   */
  findBar: () => FindBar;
}

export function createUiPort({ dialogs, toasts, loadingOverlay, findBar }: UiPortParts): UiPort {
  return {
    confirmValidation: (name, summary) => dialogs.confirmValidation(name, summary),
    confirmUnsaved: (names) => dialogs.confirmUnsaved(names),
    confirmChangedOnDisk: (name) => dialogs.confirmChangedOnDisk(name),
    chooseSaveOptions: (tab, note) => dialogs.chooseSaveOptions(tab, note),
    promptDriveName: (suggested) => dialogs.promptDriveName(suggested),
    confirmUnrepresentable: (encoding, cells) => dialogs.confirmUnrepresentable(encoding, cells),
    notifyNcr: (reports) => dialogs.notifyNcr(reports),
    confirmUndecodableEdit: (cells) => dialogs.confirmUndecodableEdit(cells),
    chooseReopen: (tab) => dialogs.chooseReopen(tab),
    chooseRecentFile: (entries) => dialogs.chooseRecentFile(entries),
    confirmConvert: (reason, name) => dialogs.confirmConvert(reason, name),
    explainRsfSave: (name) => dialogs.explainRsfSave(name),
    chooseExportCsv: (name, currentDelimiter) => dialogs.chooseExportCsv(name, currentDelimiter),
    confirmExportXlsx: (name) => dialogs.confirmExportXlsx(name),
    confirmExportJson: (name) => dialogs.confirmExportJson(name),
    chooseInsertShift: (rows, cols) => dialogs.chooseInsertShift(rows, cols),
    confirmFlashFill: (preview) => dialogs.confirmFlashFill(preview),
    chooseFilter: (input, onApply) => dialogs.chooseFilter(input, onApply),
    chooseColumnMenu: (input) => dialogs.chooseColumnMenu(input),
    chooseSort: (input, onApply) => dialogs.chooseSort(input, onApply),
    chooseDataValidation: (input, onApply) => dialogs.chooseDataValidation(input, onApply),
    chooseConditionalFormat: (input, onApply) => dialogs.chooseConditionalFormat(input, onApply),
    chooseCellComment: (input) => dialogs.chooseCellComment(input),
    chooseSheetTabColor: (current) => dialogs.chooseSheetTabColor(current),
    promptFolderName: (mode, current, validate) => dialogs.promptFolderName(mode, current, validate),
    chooseFolder: (input) => dialogs.chooseFolder(input),
    promptSheetName: (mode, current, validate, kindOptions) =>
      dialogs.promptSheetName(mode, current, validate, kindOptions),
    confirmDeleteSheet: (name, references) => dialogs.confirmDeleteSheet(name, references),
    chooseExportSheet: (sheets, currentId) => dialogs.chooseExportSheet(sheets, currentId),
    confirm: (title, message, ok, cancel) => dialogs.confirm(title, message, ok, cancel),
    showMessage: (title, message) => dialogs.showMessage(title, message),
    notify: (text, kind) => toasts.notify(text, kind),
    openFindBar: (replaceMode) => findBar().open(replaceMode),
    findNext: (direction) => findBar().next(direction),
    confirmReplaceAllWorkbook: (input) => dialogs.confirmReplaceAllWorkbook(input),
    confirmRangeMoveOverwrite: (input) => dialogs.confirmRangeMoveOverwrite(input),
    promptMoveTarget: (source, suggestion, validate) =>
      dialogs.promptMoveTarget(source, suggestion, validate),
    promptGoToCell: (suggestion, validate) => dialogs.promptGoToCell(suggestion, validate),
    showAbout: (section) => void dialogs.showAbout(section),
    showFormulaHelp: () => void dialogs.showFormulaHelp(),
    showSqlQuery: (input) => dialogs.showSqlQuery(input),
    showDiff: (input) => dialogs.showDiff(input),
    chooseSettings: (current) => dialogs.chooseSettings(current),
    chooseTimezone: (current) => dialogs.chooseTimezone(current),
    chooseDisplayLanguage: (current) => dialogs.chooseDisplayLanguage(current),
    chooseVersionHistory: (current, maxOverride, history) =>
      dialogs.chooseVersionHistory(current, maxOverride, history),
    confirmHistoryCapExceeded: (name, max) => dialogs.confirmHistoryCapExceeded(name, max),
    chooseTextColor: (current, onApply) => dialogs.chooseTextColor(current, onApply),
    chooseBackgroundColor: (current, onApply) => dialogs.chooseBackgroundColor(current, onApply),
    chooseBorders: (current, currentLineStyle, currentWidth, onApply) =>
      dialogs.chooseBorders(current, currentLineStyle, currentWidth, onApply),
    chooseNumberFormat: (current, onApply) => dialogs.chooseNumberFormat(current, onApply),
    setBusy: (label, progress) => {
      // An operation is starting: a context menu built against the pre-operation
      // state must not survive into it.
      if (label !== null) {
        closeAllContextMenus();
        closeColumnMenu();
      }
      loadingOverlay.set(label, progress);
    },
  };
}
