// SPDX-License-Identifier: MIT
/**
 * Offline support for the hosted build: registers the service worker that
 * scripts/lib/pwa.mjs generates (sw.js) and reports when a newer version is
 * waiting. It never decides when to apply an update: the shell calls applyUpdate
 * only once nothing is unsaved, because applying it reloads the page. The
 * offline file:// build never reaches this module (the shell checks
 * __HOSTED_PWA__).
 */

/** The worker script at the hosted site root, so its scope covers the whole app. */
export const SERVICE_WORKER_URL = '/sw.js';

export interface OfflineSupport {
  /** Lets the waiting version take over, then reloads the page into it. */
  applyUpdate(): void;
}

export interface OfflineSupportOptions {
  readonly container: ServiceWorkerContainer;
  readonly document: Document;
  /** Reloads the page. Injected so the flow can be tested without a browser. */
  readonly reload: () => void;
  /** Called each time a newer version is ready to take over. */
  readonly onUpdateReady: () => void;
}

/**
 * Registers the worker and watches for updates. Resolves to null when the
 * browser refuses the registration; the app then still works, only offline use
 * is unavailable.
 */
export async function startOfflineSupport(options: OfflineSupportOptions): Promise<OfflineSupport | null> {
  const { container, reload, onUpdateReady } = options;
  let registration: ServiceWorkerRegistration;
  try {
    registration = await container.register(SERVICE_WORKER_URL);
  } catch {
    return null;
  }

  // A version installed on an earlier visit may already be waiting.
  if (registration.waiting && container.controller) {
    onUpdateReady();
  }
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) {
      return;
    }
    installing.addEventListener('statechange', () => {
      // A first install replaces nothing, so it is not an update.
      if (installing.state === 'installed' && container.controller) {
        onUpdateReady();
      }
    });
  });
  // Look for a newer version whenever the app is shown again.
  options.document.addEventListener('visibilitychange', () => {
    if (options.document.visibilityState === 'visible') {
      void registration.update().catch(() => undefined);
    }
  });

  return {
    applyUpdate() {
      const waiting = registration.waiting;
      if (!waiting) {
        // Nothing waits, so another tab already took the update. This page
        // still runs the older code, so reload it.
        reload();
        return;
      }
      container.addEventListener('controllerchange', () => reload(), { once: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
    },
  };
}
