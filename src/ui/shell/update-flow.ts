// SPDX-License-Identifier: MIT
/**
 * Connects the hosted build's update notice to the app. The notice appears when
 * a newer version is ready. Applying it reloads the page, which would lose
 * unsaved edits, so the action waits while any document has unsaved changes and
 * says so instead.
 */
import { t } from '../../app/i18n';
import { startOfflineSupport, type OfflineSupport } from '../../app/offline-support';
import type { AppState } from '../../app/state';
import { UpdateBanner } from '../update-banner';
import { hasUnsavedChanges } from './input';
import type { Surfaces } from './surfaces';

/** Starts offline support and returns the banner for the shell to mount. */
export function installUpdateFlow(state: AppState, surfaces: Surfaces): UpdateBanner {
  let support: OfflineSupport | null = null;
  const banner = new UpdateBanner(() => {
    if (!support) {
      return;
    }
    if (hasUnsavedChanges(state, surfaces)) {
      banner.show(t('update.unsaved'));
      return;
    }
    support.applyUpdate();
  });
  if ('serviceWorker' in navigator) {
    void startOfflineSupport({
      container: navigator.serviceWorker,
      document,
      reload: () => window.location.reload(),
      onUpdateReady: () => banner.show(t('update.ready')),
    }).then((started) => {
      support = started;
    });
  }
  return banner;
}
