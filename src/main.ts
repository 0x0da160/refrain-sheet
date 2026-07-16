// SPDX-License-Identifier: MIT
import './styles.css';
import { AppState } from './app/app-state';
import { Commands, type UiPort } from './app/commands';
import { getLocale, initLocale, onLocaleChange, t } from './app/i18n';
import { validateDocument } from './core/validation';
import { Dialogs, Toasts } from './ui/dialogs';
import { el } from './ui/dom';
import { FindBar } from './ui/find-bar';
import { FormulaBar } from './ui/formula-bar';
import { Grid } from './ui/grid';
import { MenuBar } from './ui/menu-bar';
import { StatusBar } from './ui/status-bar';
import { TabBar } from './ui/tab-bar';
import { Toolbar } from './ui/toolbar';

function bootstrap(): void {
  initLocale();
  document.documentElement.lang = getLocale();

  const state = new AppState();
  const dialogs = new Dialogs();
  const toasts = new Toasts();

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
    confirm: (title, message, ok, cancel) => dialogs.confirm(title, message, ok, cancel),
    showMessage: (title, message) => dialogs.showMessage(title, message),
    notify: (text, kind) => toasts.notify(text, kind),
    openFindBar: (replaceMode) => findBar.open(replaceMode),
    findNext: (direction) => findBar.next(direction),
    showAbout: () => void dialogs.showAbout(),
  };

  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  const menuBar = new MenuBar(commands, () => state.wrapCells);
  const toolbar = new Toolbar(commands);
  const tabBar = new TabBar(state, commands);
  const findBar = new FindBar(state, commands, grid);
  const moveSelectionDown = () => {
    const tab = state.activeTab;
    if (!tab || !tab.selection) return;
    const row = Math.min(tab.doc.rowCount - 1, tab.selection.row + 1);
    const col = Math.min(tab.selection.col, Math.max(0, (tab.doc.records[row]?.fields.length ?? 1) - 1));
    grid.reveal(row, col);
  };
  const formulaBar = new FormulaBar(state, moveSelectionDown);
  const statusBar = new StatusBar(state, () => {
    const tab = state.activeTab;
    if (tab && tab.doc.diagnostics.length > 0) {
      void dialogs.confirmValidation(tab.name, validateDocument(tab.doc));
    }
  });

  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  app.append(
    menuBar.element,
    toolbar.element,
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
  document.body.append(dropOverlay, toasts.element);

  const refreshAll = (selectionChanged: boolean) => {
    app.classList.toggle('wrap-cells', state.wrapCells);
    menuBar.render();
    toolbar.render();
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
        toolbar.render();
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
        app.classList.toggle('wrap-cells', state.wrapCells);
        menuBar.render();
        return;
    }
  });

  onLocaleChange(() => {
    document.documentElement.lang = getLocale();
    refreshAll(false);
    findBar.refresh();
    dropMessage.textContent = t('drop.hint');
  });

  // ----- Keyboard shortcuts (shared command layer) -----
  window.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const target = event.target as HTMLElement | null;
    const inTextField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const key = event.key.toLowerCase();

    if (mod && !event.shiftKey && key === 'o') {
      event.preventDefault();
      void commands.run('file.open');
    } else if (mod && event.shiftKey && key === 's') {
      event.preventDefault();
      void commands.run('file.saveOptions');
    } else if (mod && key === 's') {
      event.preventDefault();
      void commands.run('file.save');
    } else if (mod && key === 'w') {
      // Browsers may reserve Ctrl+W for closing the browser tab; when the
      // page does receive it, it closes the active file tab instead.
      event.preventDefault();
      void commands.run('file.closeTab');
    } else if (mod && key === 'f') {
      event.preventDefault();
      void commands.run('search.find');
    } else if (mod && key === 'h') {
      event.preventDefault();
      void commands.run('search.replace');
    } else if (mod && key === 'z' && !inTextField) {
      event.preventDefault();
      void commands.run(event.shiftKey ? 'edit.redo' : 'edit.undo');
    } else if (mod && key === 'y' && !inTextField) {
      event.preventDefault();
      void commands.run('edit.redo');
    } else if (mod && (event.key === 'Tab' || event.key === 'PageDown')) {
      event.preventDefault();
      void commands.run(event.shiftKey && event.key === 'Tab' ? 'tab.prev' : 'tab.next');
    } else if (mod && event.key === 'PageUp') {
      event.preventDefault();
      void commands.run('tab.prev');
    } else if (event.key === 'F3') {
      event.preventDefault();
      void commands.run(event.shiftKey ? 'search.findPrev' : 'search.findNext');
    }
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
