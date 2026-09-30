// SPDX-License-Identifier: MIT
/**
 * Build every UI surface of the application window and connect the ones the
 * command layer drives back into (clipboard, grid measurement, panels).
 */
import { ClipboardController } from '../../app/clipboard-controller';
import type { Commands } from '../../app/commands';
import { getAutoFitOnOpen, getEditHints, getSheetTabsVertical, getSheetZoom } from '../../app/settings';
import type { AppState } from '../../app/state';
import { resolveGridLook, resolveSheetFont } from '../../app/state/view-layers';
import { getDensity } from '../../app/density';
import { getTheme } from '../../app/theme';
import { isCsv, isWorkbook } from '../../core/editor-document';
import { validateDocument } from '../../core/csv/validation';
import { CommentsPanel } from '../comments-panel';
import { ValidationCheckPanel } from '../validation-check-panel';
import { ObjectsPanel } from '../objects-panel';
import { openPrint } from '../print-view';
import { objectImageBytes, textMeasure } from '../object-export';
import type { Dialogs, Toasts } from '../dialogs';
import { FindBar } from '../find-bar';
import { FormulaBar } from '../formula-bar';
import { Grid } from '../grid';
import { JsonSheetView } from '../json-sheet';
import { MarkdownSheetView } from '../markdown-sheet';
import { MenuBar } from '../menu-bar';
import { defaultMenus, type MenuChecks } from '../menu-bar/menus';
import { AppToolbar } from '../app-toolbar';
import { customizeToolbar } from '../dialogs/toolbar-customize';
import { customizeStatusBar } from '../dialogs/status-bar-customize';
import { getToolbarShown } from '../../app/toolbar-prefs';
import { SheetBar } from '../sheet-bar';
import { StatusBar } from '../status-bar';
import { TabBar } from '../tab-bar';
import { TextSheetView } from '../text-sheet';
import { WelcomeScreen } from '../welcome-screen';
import { YamlSheetView } from '../yaml-sheet';
import { rememberTextEditors, textFieldClipboard } from '../text-field-clipboard';
import { setDocumentColorSource } from '../color-picker';
import { documentColorsOf } from '../document-colors';
import { t } from '../../app/i18n';

export interface Surfaces {
  grid: Grid;
  markdownSheetView: MarkdownSheetView;
  jsonSheetView: JsonSheetView;
  yamlSheetView: YamlSheetView;
  textSheetView: TextSheetView;
  clipboard: ClipboardController;
  commentsPanel: CommentsPanel;
  validationCheckPanel: ValidationCheckPanel;
  /** Insert > Object List… (the shapes on the sheet, their properties and locks). */
  objectsPanel: ObjectsPanel;
  menuBar: MenuBar;
  /** The main toolbar under the menu bar (View > Customize Toolbar…). */
  toolbar: AppToolbar;
  tabBar: TabBar;
  sheetBar: SheetBar;
  findBar: FindBar;
  welcome: WelcomeScreen;
  formulaBar: FormulaBar;
  statusBar: StatusBar;
  /** Show the grid or the active worksheet's source view, and refresh the source views. */
  refreshSourceSheetViews: () => void;
}

export function createSurfaces(
  state: AppState,
  commands: Commands,
  dialogs: Dialogs,
  toasts: Toasts,
): Surfaces {
  const grid = new Grid(state, commands);
  // The docked source/preview surfaces shown in place of the grid while a
  // Markdown, JSON, YAML, or plain-text worksheet is active (see
  // `Worksheet.kind`) — sibling surfaces in the same spreadsheet area, not
  // replacements for the grid. The text view has no preview or Format action.
  const markdownSheetView = new MarkdownSheetView(state, commands);
  const jsonSheetView = new JsonSheetView(state, commands);
  const yamlSheetView = new YamlSheetView(state, commands);
  const textSheetView = new TextSheetView(state, commands);
  const clipboard = new ClipboardController(
    state,
    commands,
    (text, kind) => toasts.notify(text, kind),
    document,
    (range) => grid.setCopySource(range),
  );
  wireCommandActions(state, commands, grid, clipboard, toasts);
  setDocumentColorSource(() => (state.activeTab ? documentColorsOf(state.activeTab.doc) : []));
  rememberTextEditors(document, [
    markdownSheetView.element,
    jsonSheetView.element,
    yamlSheetView.element,
    textSheetView.element,
  ]);
  // The cell comments list: a dockable side panel like Filter/Sort/Format —
  // see src/ui/comments-panel.ts.
  const commentsPanel = new CommentsPanel(state, grid);
  // Data > Check Data…: the same kind of panel, listing values that break a rule.
  const validationCheckPanel = new ValidationCheckPanel(state, grid);
  const objectsPanel = new ObjectsPanel(state, commands, grid);
  const checks = menuChecks(state, commands);
  const menuBar = new MenuBar(commands, checks);
  const toolbar = new AppToolbar(commands, defaultMenus(checks));
  commands.panelActions = {
    customizeToolbar: () => void customizeToolbar(toolbar.available, () => toolbar.render()),
    customizeStatusBar: () => void customizeStatusBar(() => statusBar.render()),
    openComments: () => commentsPanel.open(),
    openValidationCheck: () => validationCheckPanel.open(),
    openObjects: () => objectsPanel.open(),
    openPrint: () => openPrint(state, (text) => toasts.notify(text, 'warn')),
  };
  const tabBar = new TabBar(state, commands);
  // The worksheet strip of the active RSF workbook, rendered below the grid —
  // a separate surface from the document tab strip above it.
  const sheetBar = new SheetBar(state, commands);
  const findBar = new FindBar(state, commands, grid);
  const welcome = new WelcomeScreen(commands);
  const formulaBar = createFormulaBar(state, commands, grid);
  const statusBar = new StatusBar(
    state,
    () => {
      const tab = state.activeTab;
      if (tab && isCsv(tab.doc) && tab.doc.diagnostics.length > 0) {
        void dialogs.confirmValidation(tab.name, validateDocument(tab.doc));
      }
    },
    () => void commands.run('file.toggleProtect'),
    commands,
  );
  // A Markdown/JSON/YAML/text worksheet shows its editor's line/column in
  // the status bar instead of a grid size and cell reference.
  const sourceSheetViews = [markdownSheetView, jsonSheetView, yamlSheetView, textSheetView];
  statusBar.editorCaret = () => sourceSheetViews.find((view) => view.active)?.editor.caret() ?? null;
  for (const view of sourceSheetViews) {
    view.editor.onCaretChange = (caret) => {
      if (view.active) {
        statusBar.updateEditorCaret(caret);
      }
    };
  }
  const refreshSourceSheetViews = (): void => {
    for (const view of sourceSheetViews) {
      view.refresh();
    }
    const sourceActive = sourceSheetViews.some((view) => view.active);
    grid.element.hidden = sourceActive;
    // The formula bar's name box and input field only mean anything for a
    // grid (row/column cell addressing); a Markdown/JSON/YAML/text worksheet
    // is a single whole-document cell, so showing it there put the entire
    // document's raw text into the formula bar under the label "A1" and let
    // editing there silently overwrite the whole document.
    formulaBar.element.hidden = sourceActive;
  };
  return {
    grid,
    markdownSheetView,
    jsonSheetView,
    yamlSheetView,
    textSheetView,
    clipboard,
    commentsPanel,
    validationCheckPanel,
    objectsPanel,
    menuBar,
    toolbar,
    tabBar,
    sheetBar,
    findBar,
    welcome,
    formulaBar,
    statusBar,
    refreshSourceSheetViews,
  };
}

/** Let menu Copy/Paste go through the clipboard controller, and commands drive the grid. */
function wireCommandActions(
  state: AppState,
  commands: Commands,
  grid: Grid,
  clipboard: ClipboardController,
  toasts: Toasts,
): void {
  // On a Markdown, JSON, YAML or text sheet, Cut/Copy/Paste act on its text
  // editor, never on the cell holding the whole text (text-field-clipboard.ts).
  const onTextSheet = (): boolean => {
    const doc = state.activeTab?.doc;
    return isWorkbook(doc) && doc.activeSheet.kind !== 'grid';
  };
  const inTextSheet = async (action: 'cut' | 'copy' | 'paste'): Promise<void> => {
    try {
      if (!(await textFieldClipboard(document, action))) {
        toasts.notify(t('notify.textSheetClipboardNoFocus'), 'info');
      }
    } catch {
      toasts.notify(t(action === 'paste' ? 'notify.pasteBlocked' : 'notify.clipboardBlocked'), 'warn');
    }
  };
  commands.clipboardActions = {
    cut: () => (onTextSheet() ? inTextSheet('cut') : clipboard.cutViaApi()),
    copy: () => (onTextSheet() ? inTextSheet('copy') : clipboard.copyViaApi()),
    copyScreenshot: () => clipboard.copyScreenshotAsPng(),
    copyAsTable: (format) => clipboard.copyTextTable(format),
    paste: () => (onTextSheet() ? inTextSheet('paste') : clipboard.pasteViaApi()),
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
  commands.objectGeometry = {
    objectPosition: (tab, o) => grid.objectPosition(tab, o),
    objectMovedTo: (tab, o, x, y) => grid.objectMovedTo(tab, o, x, y),
  };
  commands.objectImages = {
    render: (tab, objects, format) => {
      const book = tab.doc;
      if (!isWorkbook(book)) return Promise.resolve(null);
      const items = objects.map((o) => ({ o, ...grid.objectPosition(tab, o) }));
      const canvas = grid.element.querySelector('.vgrid-canvas') ?? grid.element;
      const family = getComputedStyle(canvas).fontFamily || 'sans-serif';
      return objectImageBytes(document, book, items, format, { family, measure: textMeasure(document) });
    },
  };
  // Entering or leaving full screen (the View menu, or Escape) refreshes the
  // View menu's check mark.
  document.addEventListener('fullscreenchange', () => state.emit('view'));
}

/** The live state the menus and the toolbar show (check marks, the current font). */
function menuChecks(state: AppState, commands: Commands): MenuChecks {
  return {
    wrap: () => state.wrapCells,
    stickyFirstRow: () => state.stickyFirstRowShown,
    stickyFirstColumn: () => state.stickyFirstColumnShown,
    freezeAtSelection: () => state.activeTab?.freeze != null,
    sheetFont: () => resolveSheetFont(state.activeTab?.doc ?? null).value,
    theme: () => getTheme(),
    density: () => getDensity(),
    zoom: () => state.activeTab?.zoom ?? getSheetZoom(),
    editHints: () => getEditHints(),
    toolbar: () => getToolbarShown(),
    sheetTabsVertical: () => getSheetTabsVertical(),
    bandedRows: () => resolveGridLook(state.activeTab?.doc ?? null).bands,
    gridlines: () => resolveGridLook(state.activeTab?.doc ?? null).gridlines,
    highlightRow: () => resolveGridLook(state.activeTab?.doc ?? null).rowHighlight,
    highlightCol: () => resolveGridLook(state.activeTab?.doc ?? null).colHighlight,
    autoFitOnOpen: () => getAutoFitOnOpen(),
    fullscreen: () => commands.isFullscreen(),
    formatActive: (key) => {
      const tab = state.activeTab;
      return tab !== null && commands.isFormatActive(tab, key);
    },
    alignActive: (align) => {
      const tab = state.activeTab;
      return tab !== null && commands.isAlignActive(tab, align);
    },
    driveAvailable: () => commands.driveAvailable(),
    protectedDoc: () => state.activeTab?.readOnly ?? false,
    headerFilter: () => commands.hasFilter(state.activeTab),
    sheetLocked: () => {
      const doc = state.activeTab?.doc;
      return doc !== undefined && isWorkbook(doc) && doc.activeSheet.locked;
    },
  };
}

/**
 * The formula bar pushes live formula-reference highlights, and the
 * in-progress raw text of the cell being typed, into the grid; editing
 * through it also centers the selected cell above the on-screen keyboard
 * (#584).
 */
function createFormulaBar(state: AppState, commands: Commands, grid: Grid): FormulaBar {
  const moveSelectionDown = (): void => {
    const tab = state.activeTab;
    if (!tab || !tab.selection) return;
    const row = Math.min(tab.doc.rowCount - 1, tab.selection.row + 1);
    const col = Math.min(tab.selection.col, Math.max(0, (tab.doc.fieldCount(row) || 1) - 1));
    grid.reveal(row, col);
  };
  const formulaBar = new FormulaBar(
    state,
    commands,
    moveSelectionDown,
    (refs) => grid.setFormulaRefs(refs),
    (preview) => grid.setFormulaLivePreview(preview),
  );
  grid.addKeyboardEditField(formulaBar.element);
  return formulaBar;
}
