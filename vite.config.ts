// SPDX-License-Identifier: MIT
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { build as viteBuild } from 'vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { assertBuildMode, buildCsp } from './scripts/lib/csp.mjs';
import {
  APPLE_TOUCH_ICON_NAME,
  buildServiceWorkerSource,
  buildWebManifest,
  contentVersion,
  iconFileNames,
  MANIFEST_FILE,
  SERVICE_WORKER_FILE,
  selectPrecacheList,
} from './scripts/lib/pwa.mjs';

/**
 * The build must work when dist/index.html is opened directly via file://.
 * ES module scripts are blocked by CORS on file:// in Chromium, so the bundle
 * is emitted as a single classic IIFE script and the injected tags are
 * rewritten to plain <script defer> / <link> without crossorigin attributes.
 *
 * Two build modes share everything below except their output directory and the
 * Content-Security-Policy injected into index.html (see scripts/lib/csp.mjs):
 *
 *   vite build                → offline, dist/        (file:// + release ZIP)
 *   vite build --mode hosted  → hosted,  dist-hosted/ (app.refrain-sheet.com)
 *   vite build --mode minimal → offline, dist-minimal/ (the CSV-only minimal
 *                               edition: src/app/edition.ts)
 *
 * The two policies are byte-identical today. The split exists so that a future
 * hosted-only CSP relaxation for the opt-in cloud sync described in
 * knowledge/operations/security-threat-model.md can never reach the offline artifact or the release ZIP.
 */
/** The favicon master; the build emits it as dist/favicon.svg (no copy is kept in the repo). */
const FAVICON_MASTER = 'design-system/v2/foundations/icons/favicon.svg';

/**
 * The AI assistant's inference runtime (`@wllama/wllama`, hosted build only;
 * src/app/ai/model.ts). Its WebAssembly files are too large to embed, so the
 * hosted build serves them from `ai-runtime/` next to the app, named by
 * version so a new release never pairs new code with an old cached file.
 * They are fetched only when the user starts the AI model. The offline build
 * never emits them (scripts/check/dist.mjs fails if it does).
 */
const WLLAMA_VERSION: string = JSON.parse(
  readFileSync('node_modules/@wllama/wllama/package.json', 'utf8'),
).version;
const AI_RUNTIME_FILES: ReadonlyArray<{ fileName: string; source: string; type: string }> = [
  {
    fileName: `ai-runtime/wllama-${WLLAMA_VERSION}.wasm`,
    source: 'node_modules/@wllama/wllama/esm/wasm/wllama.wasm',
    type: 'application/wasm',
  },
  {
    fileName: `ai-runtime/wllama-compat-${WLLAMA_VERSION}.wasm`,
    source: 'node_modules/@wllama/wllama-compat/wasm/wllama.wasm',
    type: 'application/wasm',
  },
  {
    fileName: `ai-runtime/wllama-compat-${WLLAMA_VERSION}.js`,
    source: 'node_modules/@wllama/wllama-compat/wasm/wllama.js',
    type: 'text/javascript',
  },
];

/**
 * The WebLLM runtime (`@mlc-ai/web-llm`, which runs the default model on
 * WebGPU) is several MB, so it is not part of the app's script either: it is
 * built on its own from src/app/ai/webllm-runtime.ts into one classic script,
 * `ai-runtime/webllm-<version>.js`, which src/app/ai/webllm-engine.ts adds to
 * the page only when the user downloads or starts the model.
 */
const WEBLLM_VERSION: string = JSON.parse(
  readFileSync('node_modules/@mlc-ai/web-llm/package.json', 'utf8'),
).version;
const WEBLLM_RUNTIME_FILE = `ai-runtime/webllm-${WEBLLM_VERSION}.js`;

let webLlmRuntime: Promise<string> | null = null;

/** Build the WebLLM runtime script (once per process) and return its code. */
function buildWebLlmRuntime(): Promise<string> {
  webLlmRuntime ??= (async () => {
    const result = await viteBuild({
      configFile: false,
      logLevel: 'warn',
      publicDir: false,
      build: {
        write: false,
        target: 'es2020',
        lib: {
          entry: 'src/app/ai/webllm-runtime.ts',
          formats: ['iife'],
          name: '__refrainSheetWebLlm',
          fileName: () => 'webllm.js',
        },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    for (const output of outputs) {
      if ('output' in output) {
        const chunk = output.output.find((item) => item.type === 'chunk');
        if (chunk && chunk.type === 'chunk') {
          return chunk.code;
        }
      }
    }
    throw new Error('the WebLLM runtime build produced no script');
  })();
  return webLlmRuntime;
}

/** The brand's icon masters. The hosted build copies only the ones its manifest names. */
const BRAND_ICON_DIR = 'design-system/v2/foundations/icons';
const BRAND_MANIFEST = `${BRAND_ICON_DIR}/site.webmanifest`;

/** Every file under `dir`, as forward-slashed paths relative to it, sorted. */
function listFiles(dir: string, sub = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, sub)).sort()) {
    const relative = sub ? `${sub}/${entry}` : entry;
    if (statSync(join(dir, relative)).isDirectory()) {
      out.push(...listFiles(dir, relative));
    } else {
      out.push(relative);
    }
  }
  return out;
}

/**
 * The hosted build's offline support (scripts/lib/pwa.mjs): the web app
 * manifest, its icons, and the versioned service worker. The worker is written
 * once the bundle is on disk, so its precache list and version describe the
 * files exactly as they are served. Enabled only for `vite build --mode hosted`;
 * the offline build keeps its single-file output and gets none of this.
 */
function hostedOfflinePlugin(enabled: boolean): Plugin {
  return {
    name: 'hosted-offline-support',
    transformIndexHtml(html) {
      if (!enabled) {
        return html;
      }
      if (!html.includes('</head>')) {
        throw new Error('index.html has no </head> to hold the hosted manifest links');
      }
      // The favicon link is root-absolute too, so a deep address finds it.
      return html
        .replace('href="./favicon.svg"', 'href="/favicon.svg"')
        .replace(
          '</head>',
          `    <link rel="manifest" href="/${MANIFEST_FILE}" />\n    <link rel="apple-touch-icon" href="/icons/${APPLE_TOUCH_ICON_NAME}" />\n  </head>`,
        );
    },
    writeBundle(options) {
      if (!enabled) {
        return;
      }
      const out = resolve(options.dir ?? 'dist-hosted');
      const master = JSON.parse(readFileSync(BRAND_MANIFEST, 'utf8'));
      mkdirSync(join(out, 'icons'), { recursive: true });
      for (const name of [...iconFileNames(master), APPLE_TOUCH_ICON_NAME]) {
        copyFileSync(join(BRAND_ICON_DIR, name), join(out, 'icons', name));
      }
      writeFileSync(join(out, MANIFEST_FILE), `${JSON.stringify(buildWebManifest(master), null, 2)}\n`);
      const precache = selectPrecacheList(listFiles(out));
      const version = contentVersion(
        precache.map((path) => ({ path, bytes: readFileSync(join(out, path)) })),
      );
      writeFileSync(join(out, SERVICE_WORKER_FILE), buildServiceWorkerSource({ version, precache }));
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // Vite's own defaults — 'development' for `vite dev`, 'production' for
  // `vite build` — both mean the offline policy. Only an explicit
  // `--mode hosted` selects the hosted one.
  const buildMode = assertBuildMode(mode === 'hosted' ? 'hosted' : 'offline');
  const csp = buildCsp(buildMode);
  // Only the hosted production build gets the service worker and the manifest.
  const hostedPwa = command === 'build' && buildMode === 'hosted';

  // Google Drive credentials reach the bundle only in the hosted build. The
  // offline build is hardcoded to empty strings whatever the environment
  // holds, so the release ZIP can never carry a credential or a code path that
  // would reach the network; scripts/check/dist.mjs asserts that mechanically.
  // These are public identifiers delivered as repository *variables*, never
  // secrets — see knowledge/operations/security-supply-chain.md.
  const hostedEnv = (name: string) => JSON.stringify(buildMode === 'hosted' ? (process.env[name] ?? '') : '');

  return {
    // The hosted site is served from its root, so its assets load from there at any
    // address, a deep link such as /settings/deep included. The offline file:// build
    // keeps relative paths, which is what lets it open from any folder.
    base: buildMode === 'hosted' ? '/' : './',
    // No public/ directory: the only static file (the favicon) comes from the
    // design-system master through the brand-favicon plugin below.
    publicDir: false,
    define: {
      // Lets the offline production build compile the Drive client out
      // entirely (see src/app/commands/index.ts). Only `vite build` in offline mode;
      // dev and Vitest keep it false so the Drive code stays testable.
      __OFFLINE_BUILD__: JSON.stringify(command === 'build' && buildMode === 'offline'),
      // The CSV-only minimal edition (src/app/edition.ts): offline policy,
      // its own output directory. Dev and Vitest keep the full edition.
      __MINIMAL_BUILD__: JSON.stringify(command === 'build' && mode === 'minimal'),
      // The hosted build's offline support (src/ui/shell/index.ts): the service
      // worker registration and the update notice. False everywhere else.
      __HOSTED_PWA__: JSON.stringify(hostedPwa),
      __WLLAMA_VERSION__: JSON.stringify(WLLAMA_VERSION),
      __WEBLLM_VERSION__: JSON.stringify(WEBLLM_VERSION),
      __DRIVE_CLIENT_ID__: hostedEnv('VITE_GOOGLE_OAUTH_CLIENT_ID'),
      __DRIVE_API_KEY__: hostedEnv('VITE_GOOGLE_DRIVE_API_KEY'),
    },
    build: {
      outDir: buildMode === 'hosted' ? 'dist-hosted' : mode === 'minimal' ? 'dist-minimal' : 'dist',
      target: 'es2020',
      modulePreload: false,
      cssCodeSplit: false,
      rolldownOptions: {
        output: {
          format: 'iife' as const,
          // One classic script: IIFE output cannot be split into chunks.
          codeSplitting: false,
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    plugins: [
      tailwindcss(),
      hostedOfflinePlugin(hostedPwa),
      {
        name: 'brand-favicon',
        configureServer(server) {
          server.middlewares.use('/favicon.svg', (_req, res) => {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.end(readFileSync(FAVICON_MASTER));
          });
        },
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: readFileSync(FAVICON_MASTER) });
        },
      },
      {
        name: 'ai-runtime',
        configureServer(server) {
          for (const file of AI_RUNTIME_FILES) {
            server.middlewares.use(`/${file.fileName}`, (_req, res) => {
              res.setHeader('Content-Type', file.type);
              res.end(readFileSync(file.source));
            });
          }
          server.middlewares.use(`/${WEBLLM_RUNTIME_FILE}`, (_req, res, next) => {
            buildWebLlmRuntime().then((code) => {
              res.setHeader('Content-Type', 'text/javascript');
              res.end(code);
            }, next);
          });
        },
        async generateBundle() {
          if (buildMode !== 'hosted') {
            return;
          }
          for (const file of AI_RUNTIME_FILES) {
            this.emitFile({ type: 'asset', fileName: file.fileName, source: readFileSync(file.source) });
          }
          this.emitFile({ type: 'asset', fileName: WEBLLM_RUNTIME_FILE, source: await buildWebLlmRuntime() });
        },
      },
      {
        name: 'csp-inject',
        enforce: 'post' as const,
        transformIndexHtml(html: string) {
          if (!html.includes('__CSP__')) {
            throw new Error('index.html is missing the __CSP__ placeholder (see scripts/lib/csp.mjs)');
          }
          return html.replace('__CSP__', csp);
        },
      },
      {
        name: 'file-protocol-compat',
        enforce: 'post' as const,
        transformIndexHtml(html: string) {
          return html
            .replace(
              /<script type="module"[^>]*? src="([^"]+)"><\/script>/g,
              '<script defer src="$1"></script>',
            )
            .replace(/<link rel="stylesheet"[^>]*? href="([^"]+)">/g, '<link rel="stylesheet" href="$1">');
        },
      },
    ],
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      benchmark: {
        include: ['bench/**/*.bench.ts'],
      },
      // `npm run test:coverage`. The thresholds are a floor, not a target: a
      // restructuring change must not leave code less tested than before.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/generated/**'],
        reporter: ['text-summary', 'json-summary'],
        thresholds: { statements: 81, branches: 75, functions: 79, lines: 82 },
      },
    },
  };
});
