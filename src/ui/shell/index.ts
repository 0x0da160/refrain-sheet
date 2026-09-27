// SPDX-License-Identifier: MIT
/**
 * The application's composition root: apply preferences, build the state,
 * the command layer and the UI port, create and mount every surface, and
 * connect them to state events and window-level input. `main.ts` only calls
 * {@link startApp}.
 */
import { Commands } from '../../app/commands';
import { warnProtectedAndOfferUnlock } from '../../app/commands/shared';
import { t } from '../../app/i18n';
import { AppState } from '../../app/state';
import type { UiPort } from '../../app/commands';
import { Dialogs, Toasts } from '../dialogs';
import type { FindBar } from '../find-bar';
import { LoadingOverlay } from '../loading-overlay';
import { installClipboardEvents, installFileDrop, installLeaveConfirmation, installShortcuts } from './input';
import { mountLayout } from './layout';
import { applyInitialPreferences, startEngines } from './preferences';
import { subscribeSurfaces } from './refresh';
import { createSurfaces } from './surfaces';
import { createUiPort } from './ui-port';

export function startApp(): void {
  applyInitialPreferences();
  startEngines();

  const state = new AppState();
  const dialogs = new Dialogs();
  const toasts = new Toasts();
  // Changes the application makes on the user's behalf (e.g. enabling wrapping
  // because a cell now holds a line break) are announced politely, never with a
  // blocking dialog. The toast surface is a polite live region.
  state.announce = (message) => toasts.notify(message, 'info');
  const loadingOverlay = new LoadingOverlay();
  let findBar: FindBar | null = null;
  const ui = createUiPort({ dialogs, toasts, loadingOverlay, findBar: () => findBar! });
  installProtectedWarning(state, ui);

  const commands = new Commands(state, ui, document);
  const surfaces = createSurfaces(state, commands, dialogs, toasts);
  findBar = surfaces.findBar;

  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  const drop = mountLayout(app, surfaces, loadingOverlay, toasts);
  const refreshAll = subscribeSurfaces(state, surfaces, app, drop.message);
  installClipboardEvents(surfaces);
  installShortcuts(commands, surfaces);
  installFileDrop(commands, drop);
  installLeaveConfirmation(state, surfaces);

  refreshAll(true);
  drop.message.textContent = t('drop.hint');
}

/**
 * A refused edit against a protected book or a locked worksheet
 * (`WriteGuards.refuseReadOnlyWrite`/`refuseLockedSheetWrite`) interrupts the
 * attempt with a blocking warning dialog offering to unlock, rather than a
 * passive toast — this covers every entry point uniformly, including the
 * Markdown/JSON worksheet textareas, since it is wired at the AppState layer
 * those already go through. `warningOpen` collapses a burst of blocked
 * attempts (e.g. held-key typing into a locked cell) into a single dialog
 * instead of stacking one per keystroke. Unlocking replays the edit that
 * raised the dialog, so the user does not have to repeat it.
 */
function installProtectedWarning(state: AppState, ui: UiPort): void {
  let warningOpen = false;
  state.warnBlocked = (tab, scope, retry, sheetId) => {
    if (warningOpen) {
      return;
    }
    warningOpen = true;
    void warnProtectedAndOfferUnlock(ui, state, tab, scope, sheetId)
      .finally(() => {
        warningOpen = false;
      })
      .then((unlocked) => {
        if (unlocked && state.tabs.includes(tab)) {
          retry();
        }
      });
  };
}
