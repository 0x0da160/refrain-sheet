// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

/**
 * The build must work when dist/index.html is opened directly via file://.
 * ES module scripts are blocked by CORS on file:// in Chromium, so the bundle
 * is emitted as a single classic IIFE script and the injected tags are
 * rewritten to plain <script defer> / <link> without crossorigin attributes.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [
    {
      name: 'file-protocol-compat',
      enforce: 'post',
      transformIndexHtml(html) {
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
  },
});
