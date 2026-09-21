// SPDX-License-Identifier: MIT
// Guards the WCAG AA contrast gate's own math and CSS-token extraction —
// both pure, so they are tested directly against known values and small
// inline CSS snippets, without needing the real src/styles.css to exercise
// the logic (a separate manual/CI run of `npm run check:contrast` covers the
// actual current palette).
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  extractBlockTokens,
  oklchToLinearSrgb,
  relativeLuminance,
  resolveOklch,
} from '../scripts/check-contrast.mjs';

describe('oklchToLinearSrgb / relativeLuminance', () => {
  it('resolves Oklch white to linear (1, 1, 1) and luminance 1', () => {
    const [r, g, b] = oklchToLinearSrgb(1, 0, 0);
    expect(r).toBeCloseTo(1, 3);
    expect(g).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(1, 3);
    expect(relativeLuminance(1, 0, 0)).toBeCloseTo(1, 3);
  });

  it('resolves Oklch black to linear (0, 0, 0) and luminance 0', () => {
    const [r, g, b] = oklchToLinearSrgb(0, 0, 0);
    expect(r).toBeCloseTo(0, 3);
    expect(g).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(0, 3);
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 3);
  });

  it('is achromatic (equal channels) at chroma 0 regardless of hue', () => {
    const [r1, g1, b1] = oklchToLinearSrgb(0.5, 0, 0);
    const [r2, g2, b2] = oklchToLinearSrgb(0.5, 0, 200);
    expect(r1).toBeCloseTo(g1, 5);
    expect(g1).toBeCloseTo(b1, 5);
    expect([r1, g1, b1]).toEqual([r2, g2, b2]);
  });
});

describe('contrastRatio', () => {
  it('is exactly 21:1 between pure black and pure white (the WCAG maximum)', () => {
    expect(contrastRatio([0, 0, 0], [1, 0, 0])).toBeCloseTo(21, 1);
  });

  it('is exactly 1:1 for a color against itself', () => {
    expect(contrastRatio([0.5, 0.1, 170], [0.5, 0.1, 170])).toBeCloseTo(1, 5);
  });

  it('is symmetric — argument order does not matter', () => {
    const a: [number, number, number] = [0.9, 0.02, 100];
    const b: [number, number, number] = [0.2, 0.15, 30];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 6);
  });

  it('increases as the lighter color gets lighter, all else equal', () => {
    const dark: [number, number, number] = [0.2, 0.05, 170];
    const lo = contrastRatio([0.6, 0.05, 170], dark);
    const hi = contrastRatio([0.9, 0.05, 170], dark);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('extractBlockTokens', () => {
  const css = `
:root {
  --a: oklch(50% 0.1 200);
  --b: 42;
}

:root[data-theme='dark'] {
  --a: oklch(20% 0.05 200);
}
`;

  it('extracts only the properties inside the named block', () => {
    const light = extractBlockTokens(css, ':root {');
    expect(light.get('a')).toBe('oklch(50% 0.1 200)');
    expect(light.get('b')).toBe('42');
  });

  it('does not leak properties from a different block with the same property name', () => {
    const dark = extractBlockTokens(css, ":root[data-theme='dark'] {");
    expect(dark.get('a')).toBe('oklch(20% 0.05 200)');
    expect(dark.has('b')).toBe(false);
  });

  it('throws when the selector is not found, rather than silently checking nothing', () => {
    expect(() => extractBlockTokens(css, '.does-not-exist {')).toThrow();
  });
});

describe('resolveOklch', () => {
  it('parses a literal oklch() value', () => {
    expect(resolveOklch('oklch(46.5% 0.078 170)', {})).toEqual([0.465, 0.078, 170]);
  });

  it('substitutes a var(--hue-*) reference from the given hue map', () => {
    expect(resolveOklch('oklch(46.5% 0.078 var(--hue-accent))', { 'hue-accent': 170 })).toEqual([
      0.465, 0.078, 170,
    ]);
  });

  it('drops an alpha suffix, since every checked pair is used as an opaque color', () => {
    expect(resolveOklch('oklch(46.5% 0.078 170 / 0.18)', {})).toEqual([0.465, 0.078, 170]);
  });

  it('throws on an unresolvable hue variable', () => {
    expect(() => resolveOklch('oklch(46.5% 0.078 var(--hue-missing))', {})).toThrow();
  });

  it('throws on a value that is not an oklch() function', () => {
    expect(() => resolveOklch('42', {})).toThrow();
  });
});
