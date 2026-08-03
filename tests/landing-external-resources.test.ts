// SPDX-License-Identifier: MIT
// Guards the landing page against reintroducing an external network
// dependency (Google Fonts) or the incorrect "unofficial page" disclaimer.
// `fs` is declared ambiently in tests/node-shims.d.ts (no @types/node needed).
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync('src/landing/template.html', 'utf8');
const styles = readFileSync('src/landing/styles.css', 'utf8');
const i18n = readFileSync('src/landing/i18n.js', 'utf8');

describe('landing page has no external resource dependency', () => {
  it('does not reference the Google Fonts CDN', () => {
    for (const source of [template, styles, i18n]) {
      expect(source).not.toMatch(/fonts\.googleapis\.com/);
      expect(source).not.toMatch(/fonts\.gstatic\.com/);
    }
  });

  it('has no CSS @import (the only way a stylesheet could fetch a remote resource)', () => {
    expect(styles).not.toMatch(/@import/);
  });
});

describe('landing page footer does not claim to be unofficial', () => {
  it('does not describe the page as unofficial, in either language', () => {
    expect(template).not.toMatch(/非公式/);
    expect(i18n).not.toMatch(/非公式/);
    expect(i18n).not.toMatch(/unofficial/i);
  });
});
