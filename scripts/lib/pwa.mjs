// SPDX-License-Identifier: MIT
// Build-time pieces of the hosted build's offline support (app.refrain-sheet.com):
// which files the service worker precaches, the versioned worker script itself,
// and the web app manifest. vite.config.ts calls these after the hosted bundle
// is written, so the precache list and its version describe the files exactly
// as they are served. The offline file:// build never calls them, which keeps
// the release ZIP free of any worker or manifest (scripts/check/dist.mjs asserts it).
//
// The worker runs with the app's origin and answers its requests, so it stays
// small and does exactly three things: precache this build, serve only this
// app's own GET requests from that cache, and take over only when the app asks.
// knowledge/operations/security-threat-model.md states the policy.
import { createHash } from 'node:crypto';

/** The worker script, at the hosted root so its scope covers the whole app. */
export const SERVICE_WORKER_FILE = 'sw.js';

/** The web app manifest, written at the hosted root. */
export const MANIFEST_FILE = 'manifest.webmanifest';

/** Cache names this app owns. Only caches under this prefix are ever deleted. */
export const CACHE_PREFIX = 'refrain-sheet-app-';

/** The brand's iPhone home-screen icon. iOS reads it from a link, not the manifest. */
export const APPLE_TOUCH_ICON_NAME = 'apple-touch-icon-180.png';

/** Paths the worker never precaches: the worker itself, and the AI runtime, which is large and loads only when the person starts the assistant (src/app/ai/model.ts). */
const NEVER_PRECACHED = [/^sw\.js$/, /^ai-runtime\//];

/**
 * The files to precache, from the files the hosted output holds.
 *
 * @param {string[]} paths files relative to the hosted output root, with forward slashes
 * @returns {string[]} the kept paths, sorted and unique
 */
export function selectPrecacheList(paths) {
  const kept = new Set();
  for (const path of paths) {
    if (!NEVER_PRECACHED.some((pattern) => pattern.test(path))) {
      kept.add(path);
    }
  }
  return [...kept].sort();
}

/**
 * A version for the precached content. It changes whenever any precached file
 * changes, which is what makes the browser install a new worker on deploy.
 *
 * @param {Array<{ path: string, bytes: Uint8Array | string }>} files
 * @returns {string} sixteen hexadecimal digits
 */
export function contentVersion(files) {
  const hash = createHash('sha256');
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { path, bytes } of ordered) {
    hash.update(path);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * The worker's body. Plain browser JavaScript, with no template literals of its
 * own, so the build can embed it verbatim.
 */
const SERVICE_WORKER_BODY = `
// Registered by the app as navigator.serviceWorker.register('/sw.js').
// A new build changes this file (through CACHE below), so the browser installs
// the new worker beside the running one. The running version keeps serving
// until the person chooses to update in the app.

self.addEventListener('install', (event) => {
  // Fetch every file fresh, not from the HTTP cache, so the new cache holds
  // exactly what this build contains. If any file cannot be fetched, the install
  // fails and the running version carries on.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(PRECACHE.map((path) => cache.add(new Request(path, { cache: 'reload' })))),
    ),
  );
});

self.addEventListener('message', (event) => {
  // Sent by the app when the person chooses to update. Nothing else takes over early.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  // Remove the caches of earlier builds. Only caches under this app's prefix are
  // touched, so the assistant's model cache is left alone.
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only this app's own GET requests are answered here. Google Drive, the Picker,
  // Hugging Face, and anything else cross-origin go straight to the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(answer(request));
});

function answer(request) {
  return caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((cached) => {
    if (cached) {
      return cached;
    }
    if (request.mode === 'navigate') {
      // The app is a single page, so any address opens it, offline included.
      return caches.match('./index.html', { cacheName: CACHE }).then((shell) => shell || fetch(request));
    }
    return fetch(request);
  });
}
`;

/**
 * The complete worker script for one build.
 *
 * @param {{ version: string, precache: string[] }} options
 *   `version` from contentVersion(); `precache` from selectPrecacheList(), as
 *   paths relative to the hosted root.
 * @returns {string} the worker script
 */
export function buildServiceWorkerSource({ version, precache }) {
  const urls = precache.map((path) => `./${path}`);
  return [
    '// Generated by scripts/lib/pwa.mjs for the hosted build. Do not edit.',
    `const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};`,
    `const CACHE = ${JSON.stringify(CACHE_PREFIX + version)};`,
    `const PRECACHE = ${JSON.stringify(urls)};`,
    SERVICE_WORKER_BODY,
  ].join('\n');
}

const ICON_PREFIX = '/icons/';
const FAVICON_NAME = 'favicon.svg';

/**
 * Where an icon named in the brand manifest is served from the hosted root.
 * favicon.svg is written at the root by vite.config.ts; the other icons live under icons/.
 *
 * @param {string} src the brand manifest's path, such as /icons/icon-192.png
 * @returns {string} a path relative to the hosted root, such as ./icons/icon-192.png
 */
export function iconLocation(src) {
  if (!src.startsWith(ICON_PREFIX)) {
    throw new Error(`brand icon ${src} is not under ${ICON_PREFIX}`);
  }
  const name = src.slice(ICON_PREFIX.length);
  return name === FAVICON_NAME ? `./${FAVICON_NAME}` : `./icons/${name}`;
}

/**
 * The web app manifest for the hosted build: the brand's own manifest, with
 * paths made relative so it works under any base path.
 *
 * @param {BrandManifest} master the parsed brand manifest
 * @returns {BrandManifest}
 */
export function buildWebManifest(master) {
  return {
    ...master,
    start_url: './',
    scope: './',
    icons: master.icons.map((icon) => ({ ...icon, src: iconLocation(icon.src) })),
  };
}

/**
 * The brand icon files the manifest needs under icons/, sorted.
 *
 * @param {BrandManifest} master
 * @returns {string[]} file names, such as icon-192.png
 */
export function iconFileNames(master) {
  const names = new Set();
  for (const icon of master.icons) {
    const location = iconLocation(icon.src);
    if (location.startsWith('./icons/')) {
      names.add(location.slice('./icons/'.length));
    }
  }
  return [...names].sort();
}
