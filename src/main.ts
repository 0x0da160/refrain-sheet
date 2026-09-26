// SPDX-License-Identifier: MIT
import './styles.css';
import { AppState } from './app/app-state';
import { ClipboardController } from './app/clipboard-controller';
import { Commands, type UiPort } from './app/commands';
import { warnProtectedAndOfferUnlock } from './app/commands/shared';
import { getLocale, initLocale, onLocaleChange, t } from './app/i18n';
import { getAutoFitOnOpen, getEditHints, getShiftPasteMode, getSheetZoom } from './app/settings';
import { applySheetFont, getSheetFont } from './app/sheet-font';
import { resolveShortcut } from './app/shortcuts';
import { applyTheme, getTheme } from './app/theme';
import { initCsvEngine } from './core/csv-engine';
import { initSqlEngine } from './core/sql-engine';
import { validateDocument } from './core/validation';
import { initAppIcons } from './ui/app-icon';
import { CommentsPanel } from './ui/comments-panel';
import { closeColumnMenu } from './ui/column-menu';
import { closeAllContextMenus } from './ui/context-menu';
import { Dialogs, Toasts } from './ui/dialogs';
import { el } from './ui/dom';
import { FindBar } from './ui/find-bar';
import { FormulaBar } from './ui/formula-bar';
import { Grid } from './ui/grid';
import { JsonSheetView } from './ui/json-sheet';
import { LoadingOverlay } from './ui/loading-overlay';
import { MarkdownSheetView } from './ui/markdown-sheet';
import { MenuBar } from './ui/menu-bar';
import { installKeyboardViewportFix } from './ui/popup';
import { SheetBar } from './ui/sheet-bar';
import { installShellLayout } from './ui/shell-layout';
import { StatusBar } from './ui/status-bar';
import { TabBar } from './ui/tab-bar';
import { TextSheetView } from './ui/text-sheet';
import { installViewportDebug } from './ui/viewport-debug';
import { WelcomeScreen } from './ui/welcome-screen';
import { YamlSheetView } from './ui/yaml-sheet';

function bootstrap(): void {
  initLocale();
  document.documentElement.lang = getLocale();
  // Apply the persisted spreadsheet font before first paint (pure CSS var).
  applySheetFont(getSheetFont());
  // Resolve and apply the color theme before first paint (no flash of the
  // wrong theme); a "system" choice tracks OS changes live via matchMedia.
  applyTheme(getTheme());
  // Keep every product-identity icon on the theme's variant, including live
  // `prefers-color-scheme` changes while the choice is "system".
  initAppIcons();
  // Works around an iOS Safari bug where the page stays visually shifted
  // upward after the on-screen keyboard closes (#402) — see
  // `installKeyboardViewportFix` for why.
  installKeyboardViewportFix();
  // Opt-in on-device diagnostics for the keyboard/viewport behavior above,
  // only with the URL hash `#debug-viewport` (#582).
  installViewportDebug();

  // Start instantiating the embedded WASM CSV core in the background (decoded
  // locally from Base64 — never fetched; falls back to the identical JS engine
  // if unavailable). The UI builds and paints immediately without waiting for
  // it; every code path that needs the engine awaits the same idempotent
  // promise before parsing/compressing, so the fast engine is still used for
  // the first opened file.
  void initCsvEngine();

  // Same idea for the embedded sql.js (SQLite/WASM) engine behind Data > Run
  // SQL Query…: start loading it now so it is normally already ready by the
  // time a user opens the dialog (see src/app/commands/sql.ts, which awaits
  // this same promise before running a query).
  void initSqlEngine();

  const state = new AppState();
  const dialogs = new Dialogs();
  const toasts = new Toasts();
  // Changes the application makes on the user's behalf (e.g. enabling wrapping
  // because a cell now holds a line break) are announced politely, never with a
  // blocking dialog. The toast surface is a polite live region.
  state.announce = (message) => toasts.notify(message, 'info');
  const loadingOverlay = new LoadingOverlay();

  // The UI port is late-bound so the command layer can drive the find bar,
  // which itself needs the command layer for Replace All.
  const ui: UiPort = {
    confirmValidation: (name, summary) => dialogs.confirmValidation(name, summary),
    confirmUnsaved: (names) => dialogs.confirmUnsaved(names),
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
    promptSheetName: (mode, current, validate) => dialogs.promptSheetName(mode, current, validate),
    confirmDeleteSheet: (name, references) => dialogs.confirmDeleteSheet(name, references),
    chooseExportSheet: (sheets, currentId) => dialogs.chooseExportSheet(sheets, currentId),
    confirm: (title, message, ok, cancel) => dialogs.confirm(title, message, ok, cancel),
    showMessage: (title, message) => dialogs.showMessage(title, message),
    notify: (text, kind) => toasts.notify(text, kind),
    openFindBar: (replaceMode) => findBar.open(replaceMode),
    findNext: (direction) => findBar.next(direction),
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

  // A refused edit against a protected book or a locked worksheet
  // (`AppState.refuseReadOnlyWrite`/`refuseLockedSheetWrite`) interrupts the
  // attempt with a blocking warning dialog offering to unlock, rather than a
  // passive toast — this covers every entry point uniformly, including the
  // Markdown/JSON worksheet textareas, since it is wired at the AppState
  // layer those already go through. `warningOpen` collapses a burst of
  // blocked attempts (e.g. held-key typing into a locked cell) into a single
  // dialog instead of stacking one per keystroke.
  let warningOpen = false;
  state.warnBlocked = (tab, scope) => {
    if (warningOpen) {
      return;
    }
    warningOpen = true;
    void warnProtectedAndOfferUnlock(ui, state, tab, scope).finally(() => {
      warningOpen = false;
    });
  };

  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  // The docked source/preview surface shown in place of the grid while a
  // Markdown worksheet is active (see `Worksheet.kind`) — a second surface
  // in the same spreadsheet area, not a replacement for the grid.
  const markdownSheetView = new MarkdownSheetView(state, commands);
  // The docked source/preview surface shown in place of the grid while a
  // JSON worksheet is active (see `Worksheet.kind`) — same pattern as
  // `markdownSheetView`, a sibling surface rather than a replacement.
  const jsonSheetView = new JsonSheetView(state, commands);
  // Same pattern again for a YAML worksheet.
  const yamlSheetView = new YamlSheetView(state, commands);
  // A plain-text worksheet's surface — the same source-textarea pattern but
  // with no preview panel or Format action (see `TextSheetView`).
  const textSheetView = new TextSheetView(state, commands);
  const refreshSourceSheetViews = (): void => {
    markdownSheetView.refresh();
    jsonSheetView.refresh();
    yamlSheetView.refresh();
    textSheetView.refresh();
    const sourceActive =
      markdownSheetView.active || jsonSheetView.active || yamlSheetView.active || textSheetView.active;
    grid.element.hidden = sourceActive;
    // The formula bar's name box and input field only mean anything for a
    // grid (row/column cell addressing); a Markdown/JSON/YAML/text worksheet
    // is a single whole-document cell, so showing it there put the entire
    // document's raw text into the formula bar under the label "A1" and let
    // editing there silently overwrite the whole document.
    formulaBar.element.hidden = sourceActive;
  };
  const clipboard = new ClipboardController(
    state,
    commands,
    (text, kind) => toasts.notify(text, kind),
    document,
    (range) => grid.setCopySource(range),
  );
  commands.clipboardActions = {
    cut: () => clipboard.cutViaApi(),
    copy: () => clipboard.copyViaApi(),
    copyScreenshot: () => clipboard.copyScreenshotAsPng(),
    copyAsMarkdown: () => clipboard.copyMarkdownTable(),
    paste: () => clipboard.pasteViaApi(),
    pasteValues: () => clipboard.pasteValuesViaApi(),
    pasteFormats: () => clipboard.pasteFormatsViaApi(),
    getCopied: () => clipboard.getCopied(),
    copiedKind: () => clipboard.copiedKind(),
  };
  commands.gridActions = {
    autoFitSelectedColumns: () => grid.autoFitSelectedColumns(),
    autoFitAllColumns: (tab) => grid.autoFitAllColumns(tab),
    goToCell: (row, col) => grid.reveal(row, col),
  };
  // The cell comments list: a dockable side panel like Filter/Sort/Format —
  // see src/ui/comments-panel.ts.
  const commentsPanel = new CommentsPanel(state, grid);
  commands.panelActions = {
    toggleComments: () => commentsPanel.toggle(),
  };
  const menuBar = new MenuBar(commands, {
    wrap: () => state.wrapCells,
    stickyFirstRow: () => state.stickyFirstRowShown,
    stickyFirstColumn: () => state.stickyFirstColumnShown,
    freezeAtSelection: () => state.activeTab?.freeze != null,
    sheetFont: () => getSheetFont(),
    theme: () => getTheme(),
    zoom: () => state.activeTab?.zoom ?? getSheetZoom(),
    editHints: () => getEditHints(),
    autoFitOnOpen: () => getAutoFitOnOpen(),
    commentsPanel: () => commentsPanel.isOpen,
    formatActive: (key) => {
      const tab = state.activeTab;
      return tab !== null && commands.isFormatActive(tab, key);
    },
    driveAvailable: () => commands.driveAvailable(),
    protectedDoc: () => state.activeTab?.readOnly ?? false,
    headerFilter: () => commands.hasFilter(state.activeTab),
    sheetLocked: () => {
      const doc = state.activeTab?.doc;
      return doc !== undefined && doc.kind === 'rsf' && doc.activeSheet.locked;
    },
  });
  const tabBar = new TabBar(state, commands);
  // The worksheet strip of the active RSF workbook, rendered below the grid —
  // a separate surface from the document tab strip above it.
  const sheetBar = new SheetBar(state, commands);
  const findBar = new FindBar(state, commands, grid);
  const welcome = new WelcomeScreen(commands);
  const moveSelectionDown = () => {
    const tab = state.activeTab;
    if (!tab || !tab.selection) return;
    const row = Math.min(tab.doc.rowCount - 1, tab.selection.row + 1);
    const col = Math.min(tab.selection.col, Math.max(0, (tab.doc.fieldCount(row) || 1) - 1));
    grid.reveal(row, col);
  };
  // The formula bar pushes live formula-reference highlights, and the
  // in-progress raw text of the cell being typed, into the grid.
  const formulaBar = new FormulaBar(
    state,
    commands,
    moveSelectionDown,
    (refs) => grid.setFormulaRefs(refs),
    (preview) => grid.setFormulaLivePreview(preview),
  );
  // Editing through the formula bar also centers the selected cell above
  // the on-screen keyboard (#584).
  grid.addKeyboardEditField(formulaBar.element);
  const statusBar = new StatusBar(
    state,
    () => {
      const tab = state.activeTab;
      if (tab && tab.doc.kind === 'csv' && tab.doc.diagnostics.length > 0) {
        void dialogs.confirmValidation(tab.name, validateDocument(tab.doc));
      }
    },
    () => void commands.run('file.toggleProtect'),
  );

  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  const mainRow = el('div', { className: 'main-row' }, [
    grid.element,
    markdownSheetView.element,
    jsonSheetView.element,
    yamlSheetView.element,
    textSheetView.element,
  ]);
  // Everything between the two tab strips (formula bar, welcome
  // screen, the sheet itself) lives in `#app-content`: a top/bottom-docked
  // side panel reserves space by padding this element rather than
  // `#app-body`, so it insets below the book tab strip and above the
  // worksheet tab strip instead of covering either of them (see
  // `applySidePanelPosition`, `src/ui/dialogs/shared.ts`, #399/#541).
  const appContent = el('div', { className: 'app-content', attrs: { id: 'app-content' } }, [
    formulaBar.element,
    welcome.element,
    mainRow,
  ]);
  const appBody = el('div', { className: 'app-body', attrs: { id: 'app-body' } }, [
    tabBar.element,
    appContent,
    sheetBar.element,
    findBar.element,
    commentsPanel.element,
    markdownSheetView.panelElement,
    jsonSheetView.panelElement,
    yamlSheetView.panelElement,
  ]);
  // `menuBar.toggleElement` is a separate top-level element from
  // `menuBar.element` (mobile only) so the narrow-viewport grid can place it
  // in its own trailing column, past the status bar — see the mobile layout
  // comment in styles.css and `MenuBar.toggleElement` (#478). Desktop-width
  // CSS keeps it `display: none` regardless of DOM position.
  app.append(menuBar.element, appBody, statusBar.element, menuBar.toggleElement);
  // Document tabs share the menu bar's row whenever they fit (#596).
  installShellLayout();

  const dropMessage = el('div', { className: 'drop-message' });
  const dropOverlay = el('div', { className: 'drop-overlay', attrs: { 'aria-hidden': 'true' } }, [
    dropMessage,
  ]);
  document.body.append(dropOverlay, loadingOverlay.element, toasts.element);

  const refreshAll = (selectionChanged: boolean) => {
    app.classList.toggle('wrap-cells', state.wrapCells);
    // No open document: restore the initial welcome screen and hide every
    // document-specific surface (tab strip, formula bar, find bar, grid).
    const noTabs = state.tabs.length === 0;
    app.classList.toggle('welcome-mode', noTabs);
    welcome.refresh(noTabs);
    menuBar.render();
    tabBar.render();
    sheetBar.render(true);
    refreshSourceSheetViews();
    grid.refresh();
    formulaBar.refresh(selectionChanged);
    statusBar.render();
    commentsPanel.render();
  };

  state.subscribe((event) => {
    // Any change of document, worksheet, or content invalidates the state a
    // context menu was built against (its enabled items, its anchor cell), so
    // the menu is dismissed rather than left pointing at something else.
    if (event !== 'selection') {
      closeAllContextMenus();
      closeColumnMenu();
    }
    switch (event) {
      case 'tabs':
      case 'active':
        // A different document is showing: an editor opened on the previous
        // one must never commit into this one. The copy-source outline
        // (see clipboard.ts's `onCopySourceChange`) is likewise scoped to a
        // single document, so it is cleared rather than carried over.
        clipboard.clearCopySource();
        grid.cancelEditing();
        refreshAll(true);
        findBar.refresh();
        return;
      case 'sheets':
        // A different worksheet of the same workbook: drop any in-progress
        // inline edit (and with it the IME composition, autocomplete popup,
        // and formula-reference highlights) before repainting, so nothing from
        // the previous worksheet survives the switch. Same reasoning for the
        // copy-source outline as the 'tabs'/'active' case above.
        clipboard.clearCopySource();
        grid.cancelEditing();
        menuBar.render();
        sheetBar.render();
        refreshSourceSheetViews();
        grid.refresh();
        formulaBar.refresh(true);
        statusBar.render();
        findBar.refresh();
        commentsPanel.render();
        return;
      case 'doc':
        // Any mutation of the active document (an edit, undo/redo, a
        // structural change) can move or invalidate what the copy-source
        // outline was pointing at, so it is cleared here too rather than
        // trying to track how a given mutation might have shifted it.
        clipboard.clearCopySource();
        tabBar.render();
        sheetBar.render();
        refreshSourceSheetViews();
        grid.refresh();
        formulaBar.refresh(false);
        statusBar.render();
        findBar.refresh();
        commentsPanel.render();
        return;
      case 'selection':
        grid.refreshSelection();
        formulaBar.refresh(true);
        statusBar.render();
        return;
      case 'view':
        // Wrap and sticky-first-row both change grid metrics. The comments
        // panel's own open/closed state (toggled via the View menu) also
        // flows through this event, like editHints above.
        app.classList.toggle('wrap-cells', state.wrapCells);
        menuBar.render();
        grid.refresh();
        commentsPanel.render();
        return;
    }
  });

  // ----- Clipboard: Ctrl+X / Ctrl+C / Ctrl+V via native cut/copy/paste events -----
  document.addEventListener('copy', (event) => {
    if (grid.isNavigating()) {
      clipboard.handleCopyEvent(event);
    }
  });
  document.addEventListener('cut', (event) => {
    if (grid.isNavigating()) {
      clipboard.handleCutEvent(event);
    }
  });
  document.addEventListener('paste', (event) => {
    if (grid.isNavigating()) {
      clipboard.handlePasteEvent(event);
    }
  });

  onLocaleChange(() => {
    document.documentElement.lang = getLocale();
    refreshAll(false);
    findBar.refresh();
    commentsPanel.refresh();
    dropMessage.textContent = t('drop.hint');
  });

  // ----- Keyboard shortcuts (shared command layer) -----
  // Routing lives in the pure `resolveShortcut` (unit-tested): it returns a
  // command only for recognized, non-reserved accelerators and never during
  // IME composition. We preventDefault only when a command is resolved and the
  // event is cancelable, so browser/OS/AT shortcuts are never suppressed.
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    // The grid's hidden IME sink is a textarea, but while the grid is merely
    // navigated (no cell editor open) it is not a text-editing surface —
    // grid accelerators (Undo/Redo/Fill Down/Select All) must keep working.
    const inTextField =
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true) &&
      !grid.isNavigating();
    const command = resolveShortcut(
      {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
      {
        inTextField,
        isComposing: event.isComposing,
        // Select All is only owned while the grid itself is focused (never a
        // text field or the rest of the page — the browser keeps Ctrl+A there).
        inGrid: grid.isNavigating(),
        shiftPaste: getShiftPasteMode(),
      },
    );
    if (!command) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    void commands.run(command);
  });

  // ----- Whole-window drag & drop with visual feedback -----
  let dragDepth = 0;
  const setOverlay = (active: boolean) => {
    dropOverlay.classList.toggle('active', active);
    if (active) {
      dropMessage.textContent = t('drop.hint');
    }
  };
  window.addEventListener('dragenter', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      dragDepth += 1;
      setOverlay(true);
    }
  });
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      setOverlay(false);
    }
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    setOverlay(false);
    const items = Array.from(event.dataTransfer?.items ?? []);
    const files: File[] = [];
    const handlePromises: Array<Promise<FileSystemFileHandle | null>> = [];
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      files.push(file);
      const getHandle = (
        item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }
      ).getAsFileSystemHandle;
      // Must be called synchronously inside the drop event to obtain a
      // writable handle for overwrite saves (Chromium only).
      handlePromises.push(
        typeof getHandle === 'function'
          ? getHandle
              .call(item)
              .then((h) => (h && h.kind === 'file' ? (h as FileSystemFileHandle) : null))
              .catch(() => null)
          : Promise.resolve(null),
      );
    }
    if (files.length === 0) return;
    void Promise.all(handlePromises).then((handles) => commands.openDroppedFiles(files, handles));
  });

  // ----- Leave-page confirmation -----
  // Browsers do not allow custom dialogs during unload; the standard
  // leave-page confirmation is used when any tab has unsaved changes.
  window.addEventListener('beforeunload', (event) => {
    // A pending debounced Markdown/JSON/YAML/text-sheet edit (see
    // `MarkdownSheetView`/`JsonSheetView`/`YamlSheetView`/`TextSheetView`)
    // has not yet marked its document dirty — flush it first so an edit made
    // in the last moment before closing is never silently lost nor missed by
    // the dirty check below.
    markdownSheetView.flushCommit();
    jsonSheetView.flushCommit();
    yamlSheetView.flushCommit();
    textSheetView.flushCommit();
    if (state.tabs.some((tab) => tab.doc.isDirty)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  refreshAll(true);
  dropMessage.textContent = t('drop.hint');
}

bootstrap();
