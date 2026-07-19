// SPDX-License-Identifier: MIT
import './styles.css';
import { AppState } from './app/app-state';
import { ClipboardController } from './app/clipboard-controller';
import { Commands, type UiPort } from './app/commands';
import { getLocale, initLocale, onLocaleChange, t } from './app/i18n';
import { applySheetFont, getSheetFont } from './app/sheet-font';
import { resolveShortcut } from './app/shortcuts';
import { initCsvEngine } from './core/csv-engine';
import { validateDocument } from './core/validation';
import { Dialogs, Toasts } from './ui/dialogs';
import { el } from './ui/dom';
import { FindBar } from './ui/find-bar';
import { FormulaBar } from './ui/formula-bar';
import { Grid } from './ui/grid';
import { LoadingOverlay } from './ui/loading-overlay';
import { MenuBar } from './ui/menu-bar';
import { StatusBar } from './ui/status-bar';
import { TabBar } from './ui/tab-bar';

function bootstrap(): void {
  initLocale();
  document.documentElement.lang = getLocale();
  // Apply the persisted spreadsheet font before first paint (pure CSS var).
  applySheetFont(getSheetFont());

  // Start instantiating the embedded WASM CSV core in the background (decoded
  // locally from Base64 — never fetched; falls back to the identical JS engine
  // if unavailable). The UI builds and paints immediately without waiting for
  // it; every code path that needs the engine awaits the same idempotent
  // promise before parsing/compressing, so the fast engine is still used for
  // the first opened file.
  void initCsvEngine();

  const state = new AppState();
  const dialogs = new Dialogs();
  const toasts = new Toasts();
  const loadingOverlay = new LoadingOverlay();

  // The UI port is late-bound so the command layer can drive the find bar,
  // which itself needs the command layer for Replace All.
  const ui: UiPort = {
    confirmValidation: (name, summary) => dialogs.confirmValidation(name, summary),
    confirmUnsaved: (names) => dialogs.confirmUnsaved(names),
    chooseSaveOptions: (tab, note) => dialogs.chooseSaveOptions(tab, note),
    confirmUnrepresentable: (encoding, cells) => dialogs.confirmUnrepresentable(encoding, cells),
    notifyNcr: (reports) => dialogs.notifyNcr(reports),
    confirmUndecodableEdit: (cells) => dialogs.confirmUndecodableEdit(cells),
    chooseReopen: (tab) => dialogs.chooseReopen(tab),
    confirmConvert: (reason, name) => dialogs.confirmConvert(reason, name),
    explainRcsvSave: (name) => dialogs.explainRcsvSave(name),
    chooseExportCsv: (name) => dialogs.chooseExportCsv(name),
    chooseInsertShift: (rows, cols) => dialogs.chooseInsertShift(rows, cols),
    confirm: (title, message, ok, cancel) => dialogs.confirm(title, message, ok, cancel),
    showMessage: (title, message) => dialogs.showMessage(title, message),
    notify: (text, kind) => toasts.notify(text, kind),
    openFindBar: (replaceMode) => findBar.open(replaceMode),
    findNext: (direction) => findBar.next(direction),
    showAbout: () => void dialogs.showAbout(),
    showFormulaHelp: () => void dialogs.showFormulaHelp(),
    chooseSettings: (current) => dialogs.chooseSettings(current),
    setBusy: (label) => loadingOverlay.set(label),
  };

  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  const clipboard = new ClipboardController(state, commands, (text, kind) => toasts.notify(text, kind));
  commands.clipboardActions = {
    copy: () => clipboard.copyViaApi(),
    paste: () => clipboard.pasteViaApi(),
    getCopied: () => clipboard.getCopied(),
  };
  const menuBar = new MenuBar(commands, {
    wrap: () => state.wrapCells,
    stickyFirstRow: () => state.stickyFirstRow,
    sheetFont: () => getSheetFont(),
  });
  const tabBar = new TabBar(state, commands);
  const findBar = new FindBar(state, commands, grid);
  const moveSelectionDown = () => {
    const tab = state.activeTab;
    if (!tab || !tab.selection) return;
    const row = Math.min(tab.doc.rowCount - 1, tab.selection.row + 1);
    const col = Math.min(tab.selection.col, Math.max(0, (tab.doc.fieldCount(row) || 1) - 1));
    grid.reveal(row, col);
  };
  // The formula bar pushes live formula-reference highlights into the grid.
  const formulaBar = new FormulaBar(state, commands, moveSelectionDown, (refs) => grid.setFormulaRefs(refs));
  const statusBar = new StatusBar(state, () => {
    const tab = state.activeTab;
    if (tab && tab.doc.kind === 'csv' && tab.doc.diagnostics.length > 0) {
      void dialogs.confirmValidation(tab.name, validateDocument(tab.doc));
    }
  });

  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  app.append(
    menuBar.element,
    tabBar.element,
    findBar.element,
    formulaBar.element,
    grid.element,
    statusBar.element,
  );

  const dropMessage = el('div', { className: 'drop-message' });
  const dropOverlay = el('div', { className: 'drop-overlay', attrs: { 'aria-hidden': 'true' } }, [
    dropMessage,
  ]);
  document.body.append(dropOverlay, loadingOverlay.element, toasts.element);

  const refreshAll = (selectionChanged: boolean) => {
    app.classList.toggle('wrap-cells', state.wrapCells);
    menuBar.render();
    tabBar.render();
    grid.refresh();
    formulaBar.refresh(selectionChanged);
    statusBar.render();
  };

  state.subscribe((event) => {
    switch (event) {
      case 'tabs':
      case 'active':
        refreshAll(true);
        findBar.refresh();
        return;
      case 'doc':
        tabBar.render();
        grid.refresh();
        formulaBar.refresh(false);
        statusBar.render();
        findBar.refresh();
        return;
      case 'selection':
        grid.refreshSelection();
        formulaBar.refresh(true);
        statusBar.render();
        return;
      case 'view':
        // Wrap and sticky-first-row both change grid metrics.
        app.classList.toggle('wrap-cells', state.wrapCells);
        menuBar.render();
        grid.refresh();
        return;
    }
  });

  // ----- Clipboard: Ctrl+C / Ctrl+V via native copy/paste events -----
  document.addEventListener('copy', (event) => {
    if (grid.isNavigating()) {
      clipboard.handleCopyEvent(event);
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
    dropMessage.textContent = t('drop.hint');
  });

  // ----- Keyboard shortcuts (shared command layer) -----
  // Routing lives in the pure `resolveShortcut` (unit-tested): it returns a
  // command only for recognized, non-reserved accelerators and never during
  // IME composition. We preventDefault only when a command is resolved and the
  // event is cancelable, so browser/OS/AT shortcuts are never suppressed.
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const inTextField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable === true;
    const command = resolveShortcut(event, {
      inTextField,
      isComposing: event.isComposing,
    });
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
    if (state.tabs.some((tab) => tab.doc.isDirty)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  refreshAll(true);
  dropMessage.textContent = t('drop.hint');
}

bootstrap();
