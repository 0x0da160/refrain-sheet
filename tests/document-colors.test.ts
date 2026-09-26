// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
// The document-colour constants in src/ui/document-colors.ts must match the
// design system they come from (design-system/v2/app/css/app-tokens.css),
// and the swatch <datalist> must offer exactly the resolvable swatches.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CF_DEFAULT_BACKGROUND,
  CF_DEFAULT_SCALE_MAX_COLOR,
  CF_DEFAULT_SCALE_MIN_COLOR,
  CF_DEFAULT_TEXT,
  ensureSwatchList,
  SWATCH_LIST_ID,
  SWATCH_TOKENS,
} from '../src/ui/document-colors';

const appTokens = readFileSync(join(__dirname, '../design-system/v2/app/css/app-tokens.css'), 'utf8');

function token(name: string): string | undefined {
  const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(appTokens);
  return m?.[1].toLowerCase();
}

describe('document colours (design system D-13)', () => {
  it('lists the 65 swatches the design system defines, each exactly once', () => {
    expect(SWATCH_TOKENS).toHaveLength(65);
    expect(new Set(SWATCH_TOKENS).size).toBe(65);
    for (const name of SWATCH_TOKENS) {
      expect(token(name), `${name} in app-tokens.css`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('uses the design system conditional-format defaults', () => {
    expect(CF_DEFAULT_BACKGROUND).toBe(token('--cf-highlight-bg'));
    expect(CF_DEFAULT_TEXT).toBe(token('--cf-highlight-text'));
    expect(CF_DEFAULT_SCALE_MIN_COLOR).toBe(token('--cf-scale-min'));
    expect(CF_DEFAULT_SCALE_MAX_COLOR).toBe(token('--cf-scale-max'));
  });

  it('builds one shared datalist from the resolvable swatch values', () => {
    document.body.innerHTML = '';
    document.documentElement.style.setProperty('--swatch-red-1', '#FFEFED');
    document.documentElement.style.setProperty('--swatch-black', '#000000');
    expect(ensureSwatchList()).toBe(SWATCH_LIST_ID);
    expect(ensureSwatchList()).toBe(SWATCH_LIST_ID);
    const lists = document.querySelectorAll(`datalist#${SWATCH_LIST_ID}`);
    expect(lists).toHaveLength(1);
    expect([...lists[0].querySelectorAll('option')].map((o) => o.value)).toEqual(['#ffefed', '#000000']);
  });
});
