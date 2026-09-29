// SPDX-License-Identifier: MIT
/** Keep every surface in step with application-state events and the UI language. */
import { getLocale, onLocaleChange, t } from '../../app/i18n';
import { applyGridLook } from '../../app/grid-look';
import { getSheetTabsVertical } from '../../app/settings';
import { applySheetFont } from '../../app/sheet-font';
import type { AppState } from '../../app/state';
import { resolveGridLook, resolveSheetFont } from '../../app/state/view-layers';
import { closeColumnMenu } from '../column-menu';
import { closeAllContextMenus } from '../context-menu';
import type { Surfaces } from './surfaces';

/** Repaint everything; returns the function so the caller can run the first paint. */
export function subscribeSurfaces(
  state: AppState,
  s: Surfaces,
  app: HTMLElement,
  dropMessage: HTMLElement,
): (selectionChanged: boolean) => void {
  const refreshAll = (selectionChanged: boolean): void => {
    app.classList.toggle('wrap-cells', state.wrapCells);
    app.classList.toggle('sheet-tabs-vertical', getSheetTabsVertical());
    // No open document: restore the initial welcome screen and hide every
    // document-specific surface (tab strip, formula bar, find bar, grid).
    const noTabs = state.tabs.length === 0;
    app.classList.toggle('welcome-mode', noTabs);
    s.welcome.refresh(noTabs);
    s.menuBar.render();
    s.toolbar.render();
    s.tabBar.render();
    s.sheetBar.render(true);
    s.refreshSourceSheetViews();
    s.grid.refresh();
    s.formulaBar.refresh(selectionChanged);
    s.statusBar.render();
    s.commentsPanel.render();
    s.validationCheckPanel.render();
  };

  state.subscribe((event) => {
    if (event !== 'selection') {
      // The font and the grid look are layered (worksheet > file > browser),
      // so they follow the active document and worksheet. Pure CSS: setting
      // them again is a no-op.
      applySheetFont(resolveSheetFont(state.activeTab?.doc ?? null).value);
      applyGridLook(resolveGridLook(state.activeTab?.doc ?? null));
      // Any change of document, worksheet, or content invalidates the state a
      // context menu was built against (its enabled items, its anchor cell),
      // so the menu is dismissed rather than left pointing at something else.
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
        s.clipboard.clearCopySource();
        s.grid.cancelEditing();
        refreshAll(true);
        s.findBar.refresh();
        return;
      case 'sheets':
        // A different worksheet of the same workbook: drop any in-progress
        // inline edit (and with it the IME composition, autocomplete popup,
        // and formula-reference highlights) before repainting, so nothing from
        // the previous worksheet survives the switch. Same reasoning for the
        // copy-source outline as the 'tabs'/'active' case above.
        s.clipboard.clearCopySource();
        s.grid.cancelEditing();
        s.menuBar.render();
        s.sheetBar.render();
        refreshDocumentSurfaces(s, true);
        return;
      case 'doc':
        // Any mutation of the active document (an edit, undo/redo, a
        // structural change) can move or invalidate what the copy-source
        // outline was pointing at, so it is cleared here too rather than
        // trying to track how a given mutation might have shifted it.
        s.clipboard.clearCopySource();
        s.tabBar.render();
        s.sheetBar.render();
        refreshDocumentSurfaces(s, false);
        return;
      case 'selection':
        s.grid.refreshSelection();
        s.formulaBar.refresh(true);
        s.statusBar.render();
        s.toolbar.render();
        return;
      case 'view':
        // Wrap and sticky-first-row both change grid metrics. The comments
        // panel's own open/closed state (toggled via the View menu) also
        // flows through this event.
        // So does moving the worksheet tabs beside the grid (a browser
        // setting), which also changes the strip's orientation.
        app.classList.toggle('wrap-cells', state.wrapCells);
        app.classList.toggle('sheet-tabs-vertical', getSheetTabsVertical());
        s.menuBar.render();
        s.toolbar.render();
        s.sheetBar.render(true);
        s.grid.refresh();
        s.commentsPanel.render();
        s.validationCheckPanel.render();
        return;
    }
  });

  onLocaleChange(() => {
    document.documentElement.lang = getLocale();
    refreshAll(false);
    s.findBar.refresh();
    s.commentsPanel.refresh();
    s.validationCheckPanel.refresh();
    dropMessage.textContent = t('drop.hint');
  });
  return refreshAll;
}

/** The surfaces that show the active document's content. */
function refreshDocumentSurfaces(s: Surfaces, selectionChanged: boolean): void {
  s.refreshSourceSheetViews();
  s.toolbar.render();
  s.grid.refresh();
  s.formulaBar.refresh(selectionChanged);
  s.statusBar.render();
  s.findBar.refresh();
  s.commentsPanel.render();
  s.validationCheckPanel.render();
}
