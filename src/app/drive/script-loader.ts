// SPDX-License-Identifier: MIT
// Loads Google's own scripts (GIS and the gapi/Picker loader).
//
// These are the only remote scripts this application ever loads, they run in
// the hosted build only, and they are loaded lazily — nothing is fetched until
// the user actually invokes a Drive command. A default session that never
// touches Drive still makes zero network requests, which is what keeps the
// opt-in promise in knowledge/operations/security-threat-model.md honest.
//
// The URLs are not caller-supplied: every call site passes one of the two
// constants in ./config, and the hosted CSP's script-src independently
// restricts what can load at all.

const loaded = new Map<string, Promise<void>>();

/** Raised when a Google script cannot be loaded (offline, blocked, CSP). */
export class DriveScriptError extends Error {
  constructor(url: string) {
    super(`failed to load ${url}`);
    this.name = 'DriveScriptError';
  }
}

/**
 * Load a script once and resolve when it has run. Repeat calls for the same
 * URL share the original promise, so two concurrent Drive commands never
 * inject the same script twice.
 */
export function loadExternalScript(url: string, doc: Document = document): Promise<void> {
  const existing = loaded.get(url);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = url;
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => {
      // Drop the rejected promise so a later retry can attempt the load again
      // rather than replaying the failure forever.
      loaded.delete(url);
      script.remove();
      reject(new DriveScriptError(url));
    });
    doc.head.appendChild(script);
  });

  loaded.set(url, promise);
  return promise;
}

/** Test seam: forget every recorded load. */
export function resetLoadedScriptsForTests(): void {
  loaded.clear();
}
