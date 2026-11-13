// SPDX-License-Identifier: MIT
/**
 * The page declares both color schemes before its script runs. The app has a
 * dark theme, so the meta must not say light only; `src/app/theme.ts` sets the
 * resolved scheme on the root once the script runs.
 */
import { describe, expect, it } from 'vitest';
import indexHtmlRaw from '../../index.html?raw';

describe('index.html color-scheme', () => {
  it('declares light and dark in the head, before the module script', () => {
    const meta = indexHtmlRaw.match(/<meta name="color-scheme" content="([^"]*)"/);
    expect(meta).not.toBeNull();
    expect(meta![1].split(/\s+/)).toEqual(['light', 'dark']);
    expect(indexHtmlRaw.indexOf('name="color-scheme"')).toBeLessThan(indexHtmlRaw.indexOf('type="module"'));
  });
});
