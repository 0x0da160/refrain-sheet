// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { build as viteBuild } from 'vite';
import { defineConfig } from 'vitest/config';
import { assertBuildMode, buildCsp } from './scripts/lib/csp.mjs';

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

export default defineConfig(({ command, mode }) => {
  // Vite's own defaults — 'development' for `vite dev`, 'production' for
  // `vite build` — both mean the offline policy. Only an explicit
  // `--mode hosted` selects the hosted one.
  const buildMode = assertBuildMode(mode === 'hosted' ? 'hosted' : 'offline');
  const csp = buildCsp(buildMode);

  // Google Drive credentials reach the bundle only in the hosted build. The
  // offline build is hardcoded to empty strings whatever the environment
  // holds, so the release ZIP can never carry a credential or a code path that
  // would reach the network; scripts/check/dist.mjs asserts that mechanically.
  // These are public identifiers delivered as repository *variables*, never
  // secrets — see knowledge/operations/security-supply-chain.md.
  const hostedEnv = (name: string) => JSON.stringify(buildMode === 'hosted' ? (process.env[name] ?? '') : '');

  return {
    base: './',
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
