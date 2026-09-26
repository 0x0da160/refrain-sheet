// SPDX-License-Identifier: MIT
/**
 * The brand artwork the app and landing site ship are copies of the vendored
 * Refrain Sheet Design System masters (design-system/v2/foundations/). Vite needs them
 * under src/ and public/, so they cannot simply be referenced in place; this
 * keeps every copy byte-identical to its master so they cannot drift.
 *
 * The design system has a single app icon for both themes (no dark
 * variant), which is why src/assets/icon-dark.svg is the same artwork as
 * icon.svg. If a dark master is added, point `icon-dark.svg` at it here.
 */
import { describe, expect, it } from 'vitest';

const raw = import.meta.glob(
  [
    '../design-system/v2/foundations/icons/*.svg',
    '../design-system/v2/foundations/logo/*.svg',
    '../src/assets/*.svg',
    '../site/favicon.svg',
    '../site/assets/*.svg',
    '../public/favicon.svg',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const DS = '../design-system/v2/foundations';
const copies: Array<[copy: string, master: string]> = [
  ['../public/favicon.svg', `${DS}/icons/favicon.svg`],
  ['../site/favicon.svg', `${DS}/icons/favicon.svg`],
  [
    '../site/assets/refrain-sheet-logotype-horizontal.svg',
    `${DS}/logo/refrain-sheet-logotype-horizontal.svg`,
  ],
  [
    '../site/assets/refrain-sheet-logotype-horizontal-reverse.svg',
    `${DS}/logo/refrain-sheet-logotype-horizontal-reverse.svg`,
  ],
  ['../src/assets/icon.svg', `${DS}/icons/app-icon-1024.svg`],
  ['../src/assets/icon-dark.svg', `${DS}/icons/app-icon-1024.svg`],
  ['../src/assets/logotype.svg', `${DS}/logo/refrain-sheet-logotype-horizontal.svg`],
  ['../src/assets/logotype-dark.svg', `${DS}/logo/refrain-sheet-logotype-horizontal-reverse.svg`],
];

describe('brand assets match the design-system masters', () => {
  it.each(copies)('%s is a byte-identical copy of %s', (copy, master) => {
    expect(raw[master], `missing master ${master}`).toBeTypeOf('string');
    expect(raw[copy], `missing copy ${copy}`).toBeTypeOf('string');
    expect(raw[copy]).toBe(raw[master]);
  });

  it('covers every SVG in src/assets/', () => {
    const shipped = Object.keys(raw).filter((path) => path.startsWith('../src/assets/'));
    expect(shipped.sort()).toEqual(
      copies
        .map(([copy]) => copy)
        .filter((c) => c.startsWith('../src/assets/'))
        .sort(),
    );
  });
});
