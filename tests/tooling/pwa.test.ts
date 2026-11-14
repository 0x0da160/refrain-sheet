// SPDX-License-Identifier: MIT
// Guards the hosted build's offline support at build time (scripts/lib/pwa.mjs).
// The worker is generated, so these tests run it: the script is evaluated in a
// sandbox with fake Cache Storage, fake fetch and a fake service-worker scope, and
// the events a browser would send are dispatched into it. The rules it must keep
// are in knowledge/operations/security-threat-model.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  APPLE_TOUCH_ICON_NAME,
  buildServiceWorkerSource,
  buildWebManifest,
  CACHE_PREFIX,
  contentVersion,
  iconFileNames,
  iconLocation,
  selectPrecacheList,
} from '../../scripts/lib/pwa.mjs';
import type { BrandManifest } from '../../scripts/lib/pwa.mjs';

const ORIGIN = 'https://app.refrain-sheet.com';
const BASE = `${ORIGIN}/`;
const VERSION = '0123456789abcdef';
const CURRENT_CACHE = `${CACHE_PREFIX}${VERSION}`;
const BRAND_ICON_DIR = 'design-system/v2/foundations/icons';

describe('selectPrecacheList', () => {
  it('keeps each path once, sorted', () => {
    expect(selectPrecacheList(['b.js', 'a.css', 'b.js', 'index.html'])).toEqual([
      'a.css',
      'b.js',
      'index.html',
    ]);
  });

  it('leaves out the worker itself and the AI runtime', () => {
    const paths = [
      'index.html',
      'sw.js',
      'ai-runtime/wllama-1.wasm',
      'ai-runtime/webllm-1.js',
      'assets/app.js',
    ];
    expect(selectPrecacheList(paths)).toEqual(['assets/app.js', 'index.html']);
  });

  it('matches only the exact worker name and the ai-runtime folder', () => {
    expect(selectPrecacheList(['sw.js.map', 'docs/sw.js', 'ai-runtime.txt', 'icons/sw.js'])).toEqual([
      'ai-runtime.txt',
      'docs/sw.js',
      'icons/sw.js',
      'sw.js.map',
    ]);
  });
});

describe('contentVersion', () => {
  const files = [
    { path: 'index.html', bytes: '<html></html>' },
    { path: 'assets/app.js', bytes: 'console.log(1);' },
  ];

  it('is sixteen lowercase hexadecimal digits', () => {
    expect(contentVersion(files)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not depend on the order the files arrive in', () => {
    expect(contentVersion([...files].reverse())).toBe(contentVersion(files));
  });

  it('changes when any file changes its bytes', () => {
    const edited = [files[0], { path: 'assets/app.js', bytes: 'console.log(2);' }];
    expect(contentVersion(edited)).not.toBe(contentVersion(files));
  });

  it('changes when a file is renamed, even with the same bytes', () => {
    const renamed = [files[0], { path: 'assets/main.js', bytes: 'console.log(1);' }];
    expect(contentVersion(renamed)).not.toBe(contentVersion(files));
  });

  it('keeps a path and its bytes apart', () => {
    // Without the separators, path "ab" with bytes "c" would hash like "a" with "bc".
    expect(contentVersion([{ path: 'ab', bytes: 'c' }])).not.toBe(
      contentVersion([{ path: 'a', bytes: 'bc' }]),
    );
  });

  it('hashes text as UTF-8, the same as its bytes', () => {
    const text = [{ path: 'a.txt', bytes: 'é' }];
    const bytes = [{ path: 'a.txt', bytes: new TextEncoder().encode('é') }];
    expect(contentVersion(text)).toBe(contentVersion(bytes));
  });
});

describe('buildServiceWorkerSource', () => {
  const source = buildServiceWorkerSource({ version: VERSION, precache: ['index.html', 'assets/app.js'] });

  it('is a script the browser can parse', () => {
    expect(() => new Script(source)).not.toThrow();
  });

  it('names its cache after the content version, under the app prefix', () => {
    expect(source).toContain(`const CACHE = ${JSON.stringify(CURRENT_CACHE)};`);
    expect(source).toContain(`const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};`);
  });

  it('precaches each file relative to the worker, in the order given', () => {
    expect(source).toContain(`const PRECACHE = ${JSON.stringify(['./index.html', './assets/app.js'])};`);
  });
});

// The generated worker, run in a sandbox. Its global scope, Cache Storage, Request
// and fetch are fakes, so each test sees exactly what the worker asked for.
interface Entry {
  url: string;
  fetchedWith?: string;
  network?: boolean;
}
type Stores = Map<string, Map<string, Entry>>;
type Handler = (event: Record<string, unknown>) => void;

/** A request as the worker sees it. Relative addresses resolve against the app. */
class FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly cache: string | undefined;

  constructor(input: string, init: { method?: string; mode?: string; cache?: string } = {}) {
    this.url = new URL(input, BASE).href;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'cors';
    this.cache = init.cache;
  }
}

/** Cache Storage with the parts the worker uses. Lookups can ignore the query string. */
function fakeCacheStorage(stores: Stores, unreachable: ReadonlySet<string>) {
  const keyOf = (input: string | FakeRequest, ignoreSearch = false): string => {
    const url = new URL(typeof input === 'string' ? input : input.url, BASE);
    if (ignoreSearch) {
      url.search = '';
    }
    return url.href;
  };
  return {
    async open(name: string) {
      const store = stores.get(name) ?? new Map<string, Entry>();
      stores.set(name, store);
      return {
        async add(request: FakeRequest) {
          const url = keyOf(request);
          if (unreachable.has(url)) {
            throw new Error(`unreachable: ${url}`);
          }
          store.set(url, { url, fetchedWith: request.cache });
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
    async match(input: string | FakeRequest, options: { cacheName?: string; ignoreSearch?: boolean } = {}) {
      const wanted = keyOf(input, options.ignoreSearch === true);
      for (const [name, store] of stores) {
        if (options.cacheName === undefined || options.cacheName === name) {
          const entry = store.get(wanted);
          if (entry) {
            return entry;
          }
        }
      }
      return undefined;
    },
  };
}

/**
 * Evaluates the generated worker in a sandbox. `dispatch` sends it one event and
 * reports the work it handed to waitUntil (`settled`) and the work it handed to
 * respondWith (`responded`, undefined when the worker let the request go).
 */
function runWorker(
  options: { version?: string; precache?: string[]; stores?: Stores; unreachable?: string[] } = {},
) {
  const stores: Stores = options.stores ?? new Map();
  const unreachable = new Set((options.unreachable ?? []).map((path) => new URL(path, BASE).href));
  const handlers = new Map<string, Handler[]>();
  const scope = {
    location: { origin: ORIGIN },
    addEventListener(type: string, handler: Handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const sandbox = {
    self: scope,
    caches: fakeCacheStorage(stores, unreachable),
    Request: FakeRequest,
    URL,
    fetch: async (request: FakeRequest): Promise<Entry> => ({ url: request.url, network: true }),
  };
  const source = buildServiceWorkerSource({
    version: options.version ?? VERSION,
    precache: options.precache ?? ['index.html', 'assets/app.js'],
  });
  new Script(source).runInContext(createContext(sandbox));

  function dispatch(type: string, event: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<unknown> | undefined;
    const full = {
      ...event,
      waitUntil: (work: Promise<unknown>) => {
        waits.push(work);
      },
      respondWith: (work: Promise<unknown>) => {
        responded = work;
      },
    };
    for (const handler of handlers.get(type) ?? []) {
      handler(full);
    }
    return { settled: Promise.all(waits), responded };
  }

  return { stores, scope, dispatch };
}

describe('service worker, install and update', () => {
  it('precaches every listed file, fetched fresh, under a cache named for this version', async () => {
    const { stores, dispatch } = runWorker();
    await dispatch('install', {}).settled;
    const cache = stores.get(CURRENT_CACHE);
    expect(cache?.get(`${BASE}index.html`)).toEqual({ url: `${BASE}index.html`, fetchedWith: 'reload' });
    expect(cache?.get(`${BASE}assets/app.js`)).toEqual({
      url: `${BASE}assets/app.js`,
      fetchedWith: 'reload',
    });
  });

  it('does not take over on install, so the running version keeps serving until the app asks', async () => {
    const { scope, dispatch } = runWorker();
    await dispatch('install', {}).settled;
    expect(scope.skipWaiting).not.toHaveBeenCalled();
  });

  it('fails the install, so the running version carries on, when a file cannot be fetched', async () => {
    const { dispatch } = runWorker({
      precache: ['index.html', 'assets/gone.js'],
      unreachable: ['assets/gone.js'],
    });
    await expect(dispatch('install', {}).settled).rejects.toThrow('unreachable');
  });

  it('takes over only when the app sends SKIP_WAITING', () => {
    const { scope, dispatch } = runWorker();
    dispatch('message', { data: undefined });
    dispatch('message', { data: { type: 'SOMETHING_ELSE' } });
    expect(scope.skipWaiting).not.toHaveBeenCalled();
    dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('removes older caches of this app, keeps other caches, and claims open pages on activate', async () => {
    // 'webllm/model' stands in for the assistant's model cache, which must survive an update.
    const stores: Stores = new Map([
      [`${CACHE_PREFIX}0000000000000000`, new Map()],
      [CURRENT_CACHE, new Map()],
      ['webllm/model', new Map()],
    ]);
    const { scope, dispatch } = runWorker({ stores });
    await dispatch('activate', {}).settled;
    expect([...stores.keys()].sort()).toEqual([CURRENT_CACHE, 'webllm/model'].sort());
    expect(scope.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe('service worker, fetch', () => {
  /** A worker whose precache has run, as after a first visit with a connection. */
  async function installed(precache = ['index.html', 'assets/app.js']) {
    const worker = runWorker({ precache });
    await worker.dispatch('install', {}).settled;
    return worker;
  }

  it('answers this app’s GET requests from the precache, with or without a query string', async () => {
    const { dispatch } = await installed();
    const exact = dispatch('fetch', { request: new FakeRequest('./assets/app.js') });
    const withQuery = dispatch('fetch', { request: new FakeRequest('./assets/app.js?v=2') });
    const expected = { url: `${BASE}assets/app.js`, fetchedWith: 'reload' };
    await expect(exact.responded).resolves.toEqual(expected);
    await expect(withQuery.responded).resolves.toEqual(expected);
  });

  it('serves a page address the app does not have from the precached app shell', async () => {
    const { dispatch } = await installed();
    const { responded } = dispatch('fetch', {
      request: new FakeRequest('./settings/deep', { mode: 'navigate' }),
    });
    await expect(responded).resolves.toEqual({ url: `${BASE}index.html`, fetchedWith: 'reload' });
  });

  it('goes to the network for a page when no app shell is cached', async () => {
    const { dispatch } = await installed(['assets/app.js']);
    const { responded } = dispatch('fetch', {
      request: new FakeRequest('./settings/deep', { mode: 'navigate' }),
    });
    await expect(responded).resolves.toEqual({ url: `${BASE}settings/deep`, network: true });
  });

  it('goes to the network for a file that is not cached', async () => {
    const { dispatch } = await installed();
    const { responded } = dispatch('fetch', { request: new FakeRequest('./data/missing.json') });
    await expect(responded).resolves.toEqual({ url: `${BASE}data/missing.json`, network: true });
  });

  it('leaves other origins alone, such as Google Drive and the model host', async () => {
    const { dispatch } = await installed();
    const drive = dispatch('fetch', {
      request: new FakeRequest('https://www.googleapis.com/drive/v3/files'),
    });
    const model = dispatch('fetch', { request: new FakeRequest('https://huggingface.co/model.gguf') });
    expect(drive.responded).toBeUndefined();
    expect(model.responded).toBeUndefined();
  });

  it('leaves requests other than GET alone', async () => {
    const { dispatch } = await installed();
    const { responded } = dispatch('fetch', { request: new FakeRequest('./save', { method: 'POST' }) });
    expect(responded).toBeUndefined();
  });
});

describe('web app manifest and icons', () => {
  const master = JSON.parse(readFileSync(join(BRAND_ICON_DIR, 'site.webmanifest'), 'utf8')) as BrandManifest;

  it('serves every icon from the hosted root, relative to the app', () => {
    const manifest = buildWebManifest(master);
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      './favicon.svg',
      './icons/icon-192.png',
      './icons/icon-512.png',
      './icons/maskable-512.png',
    ]);
  });

  it('keeps the brand fields and leaves the brand file itself unchanged', () => {
    const before = JSON.stringify(master);
    const manifest = buildWebManifest(master);
    expect(manifest.name).toBe('Refrain Sheet');
    expect(manifest.display).toBe('standalone');
    expect(JSON.stringify(master)).toBe(before);
  });

  it('names exactly the icon files to copy under icons/, and each one exists', () => {
    const names = iconFileNames(master);
    expect(names).toEqual(['icon-192.png', 'icon-512.png', 'maskable-512.png']);
    for (const name of [...names, APPLE_TOUCH_ICON_NAME]) {
      expect(existsSync(join(BRAND_ICON_DIR, name)), name).toBe(true);
    }
  });

  it('lists a shared icon file once', () => {
    const shared: BrandManifest = {
      icons: [
        { src: '/icons/b.png' },
        { src: '/icons/favicon.svg' },
        { src: '/icons/a.png' },
        { src: '/icons/b.png' },
      ],
    };
    expect(iconFileNames(shared)).toEqual(['a.png', 'b.png']);
  });

  it('places favicon.svg at the root and the other icons under icons/', () => {
    expect(iconLocation('/icons/favicon.svg')).toBe('./favicon.svg');
    expect(iconLocation('/icons/icon-192.png')).toBe('./icons/icon-192.png');
  });

  it('refuses an icon that is not under /icons/', () => {
    expect(() => iconLocation('/static/icon.png')).toThrow(/not under \/icons\//);
    expect(() => iconLocation('icons/icon-192.png')).toThrow(/not under \/icons\//);
  });
});
