// SPDX-License-Identifier: MIT
// Guards the WCAG AA contrast gate's own math and CSS-token extraction —
// both pure, so they are tested directly against known values and small
// inline CSS snippets, without needing the real design-system CSS to exercise
// the logic (a separate manual/CI run of `npm run check:contrast` covers the
// actual current palette).
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  extractBlockTokens,
  hexToLinearSrgb,
  relativeLuminance,
} from '../scripts/check-contrast.mjs';

describe('hexToLinearSrgb / relativeLuminance', () => {
  it('resolves white to linear (1, 1, 1) and luminance 1', () => {
    expect(hexToLinearSrgb('#FFFFFF')).toEqual([1, 1, 1]);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
  });

  it('resolves black to linear (0, 0, 0) and luminance 0', () => {
    expect(hexToLinearSrgb('#000000')).toEqual([0, 0, 0]);
    expect(relativeLuminance('#000')).toBe(0);
  });

  it('expands three-digit hex the CSS way', () => {
    expect(hexToLinearSrgb('#abc')).toEqual(hexToLinearSrgb('#aabbcc'));
  });

  it('applies the sRGB transfer curve (mid grey #777777 is about 18% luminance)', () => {
    expect(relativeLuminance('#777777')).toBeCloseTo(0.1845, 3);
  });

  it('throws on a value that is not an opaque hex colour', () => {
    expect(() => hexToLinearSrgb('rgb(4 8 14 / 0.45)')).toThrow();
    expect(() => hexToLinearSrgb('#12345678')).toThrow();
  });
});

describe('contrastRatio', () => {
  it('is exactly 21:1 between pure black and pure white (the WCAG maximum)', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
  });

  it('is exactly 1:1 for a color against itself', () => {
    expect(contrastRatio('#147F43', '#147F43')).toBeCloseTo(1, 6);
  });

  it('is symmetric — argument order does not matter', () => {
    expect(contrastRatio('#F4F4EB', '#474E57')).toBeCloseTo(contrastRatio('#474E57', '#F4F4EB'), 9);
  });

  it('matches a known WCAG value (#777777 on white is 4.48:1, just under AA)', () => {
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});

describe('extractBlockTokens', () => {
  const css = `
/* comment with { braces } that must be ignored */
:root,
[data-theme="light"] {
  --a: #FFFFFF;               /* paper.0 */
  --b: 42;
}

[data-theme="dark"] {
  --a: #141A22;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --a: #000000;
  }
}

:root,
[data-theme="light"],
[data-theme="hybrid"] {
  --c: #EEEEEE;
}

[data-theme="hybrid"] {
  --a: #0B1118;
}
`;

  it('extracts only the properties inside the named rule', () => {
    const light = extractBlockTokens(css, ':root, [data-theme="light"]');
    expect(light.get('a')).toBe('#FFFFFF');
    expect(light.get('b')).toBe('42');
    expect(light.has('c')).toBe(false);
  });

  it('does not leak properties from a different rule with the same property name', () => {
    expect(extractBlockTokens(css, '[data-theme="dark"]').get('a')).toBe('#141A22');
  });

  it('matches the whole selector list, not a rule that merely contains the selector', () => {
    expect(extractBlockTokens(css, '[data-theme="hybrid"]').get('a')).toBe('#0B1118');
    expect(extractBlockTokens(css, ':root, [data-theme="light"], [data-theme="hybrid"]').get('c')).toBe(
      '#EEEEEE',
    );
  });

  it('skips rules nested in at-rule blocks', () => {
    expect(() => extractBlockTokens(css, ':root:not([data-theme])')).toThrow();
  });

  it('throws when the selector is not found, rather than silently checking nothing', () => {
    expect(() => extractBlockTokens(css, '.does-not-exist')).toThrow();
  });
});
