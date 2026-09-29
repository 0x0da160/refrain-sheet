// SPDX-License-Identifier: MIT
/** Assemble the application window's DOM from the surfaces. */
import { el } from '../dom';
import type { LoadingOverlay } from '../loading-overlay';
import type { Toasts } from '../dialogs';
import type { Surfaces } from './surfaces';
import { installShellLayout } from './tab-row-fit';

export interface DropOverlay {
  overlay: HTMLElement;
  message: HTMLElement;
}

export function mountLayout(
  app: HTMLElement,
  s: Surfaces,
  loadingOverlay: LoadingOverlay,
  toasts: Toasts,
): DropOverlay {
  const mainRow = el('div', { className: 'main-row' }, [
    s.grid.element,
    s.markdownSheetView.element,
    s.jsonSheetView.element,
    s.yamlSheetView.element,
    s.textSheetView.element,
  ]);
  // Everything between the two tab strips (formula bar, welcome
  // screen, the sheet itself) lives in `#app-content`: a top/bottom-docked
  // side panel reserves space by padding this element rather than
  // `#app-body`, so it insets below the book tab strip and above the
  // worksheet tab strip instead of covering either of them (see
  // `applySidePanelPosition`, `src/ui/dialogs/side-panel.ts`, #399/#541).
  const appContent = el('div', { className: 'app-content', attrs: { id: 'app-content' } }, [
    s.toolbar.element,
    s.formulaBar.element,
    s.welcome.element,
    mainRow,
  ]);
  const appBody = el('div', { className: 'app-body', attrs: { id: 'app-body' } }, [
    s.tabBar.element,
    appContent,
    s.sheetBar.element,
    s.findBar.element,
    s.commentsPanel.element,
    s.validationCheckPanel.element,
    s.objectsPanel.element,
    s.markdownSheetView.panelElement,
    s.jsonSheetView.panelElement,
    s.yamlSheetView.panelElement,
  ]);
  // `menuBar.toggleElement` is a separate top-level element from
  // `menuBar.element` (mobile only) so the narrow-viewport grid can place it
  // in its own trailing column, past the status bar — see the mobile layout
  // comment in styles.css and `MenuBar.toggleElement` (#478). Desktop-width
  // CSS keeps it `display: none` regardless of DOM position.
  app.append(s.menuBar.element, appBody, s.statusBar.element, s.menuBar.toggleElement);
  // Document tabs share the menu bar's row whenever they fit (#596).
  installShellLayout();

  const message = el('div', { className: 'drop-message' });
  const overlay = el('div', { className: 'drop-overlay', attrs: { 'aria-hidden': 'true' } }, [message]);
  document.body.append(overlay, loadingOverlay.element, toasts.element);
  return { overlay, message };
}
