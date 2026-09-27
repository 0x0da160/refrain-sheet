// SPDX-License-Identifier: MIT
/**
 * Brand artwork has a single source: the vendored Refrain Sheet Design System
 * masters (design-system/v2/foundations/). The app imports them directly
 * (src/ui/app-icon.ts), vite.config.ts emits the favicon from its master, and
 * scripts/build/landing.mjs copies the landing site's favicon and logotypes
 * from theirs at build time. No copy is committed, so none can drift; this
 * test keeps it that way by failing if a byte-identical copy of any master
 * reappears elsewhere in the repository's shipped sources.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const masters = import.meta.glob(
  ['../../design-system/v2/foundations/icons/*.svg', '../../design-system/v2/foundations/logo/*.svg'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const shipped = import.meta.glob(['../../src/**/*.svg', '../../site/**/*.svg', '../../public/**/*.svg'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('brand assets have a single source', () => {
  it('finds the design-system masters', () => {
    expect(Object.keys(masters).length).toBeGreaterThan(0);
  });

  it('no shipped source directory holds a copy of a master', () => {
    const masterBodies = new Set(Object.values(masters));
    const copies = Object.entries(shipped)
      .filter(([, body]) => masterBodies.has(body))
      .map(([path]) => path);
    expect(copies).toEqual([]);
  });

  it('every master the builds reference exists', () => {
    const referenced = [
      ...readFileSync('src/ui/app-icon.ts', 'utf8').matchAll(/'\.\.\/\.\.\/(design-system\/[^']+\.svg)'/g),
      ...readFileSync('vite.config.ts', 'utf8').matchAll(/'(design-system\/[^']+\.svg)'/g),
      ...readFileSync('scripts/build/landing.mjs', 'utf8').matchAll(/'(design-system\/[^']+\.svg)'/g),
    ].map((m) => `../../${m[1]}`);
    expect(referenced.length).toBe(7);
    for (const path of referenced) expect(Object.keys(masters)).toContain(path);
  });
});
