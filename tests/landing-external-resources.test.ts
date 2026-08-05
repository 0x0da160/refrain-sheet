// SPDX-License-Identifier: MIT
// Guards the landing page against reintroducing an external network
// dependency (Google Fonts) or the incorrect "unofficial page" disclaimer,
// and guards the one intentional external dependency it does have — Google
// Analytics — so it can only ever load behind explicit visitor consent.
// `fs` is declared ambiently in tests/node-shims.d.ts (no @types/node needed).
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync('src/landing/template.html', 'utf8');
const styles = readFileSync('src/landing/styles.css', 'utf8');
const i18n = readFileSync('src/landing/i18n.js', 'utf8');
const consent = readFileSync('src/landing/consent.js', 'utf8');

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

describe('landing page analytics is consent-gated', () => {
  it('never references googletagmanager.com in the static template or styles', () => {
    // Only src/landing/consent.js may reference it, and only from behind
    // the consent checks asserted below — the pre-rendered HTML/CSS must
    // never load it unconditionally.
    expect(template).not.toMatch(/googletagmanager\.com/);
    expect(styles).not.toMatch(/googletagmanager\.com/);
  });

  it('only appends the gtag.js script from inside loadGtag()', () => {
    const loadGtagBody = consent.match(/function loadGtag\(\) \{([\s\S]*?)\n {2}\}/)?.[1];
    expect(loadGtagBody).toBeDefined();
    expect(loadGtagBody).toMatch(/googletagmanager\.com/);
    expect(loadGtagBody).toMatch(/document\.head\.appendChild/);

    // No other function in the file calls appendChild — the only way a
    // <script> element reaches the document is through loadGtag().
    const withoutLoadGtag = consent.replace(/function loadGtag\(\) \{[\s\S]*?\n {2}\}/, '');
    expect(withoutLoadGtag).not.toMatch(/appendChild/);
  });

  it('only calls loadGtag() from behind an explicit accept or a stored "granted" choice', () => {
    expect(consent).toMatch(/if \(accepted\) loadGtag\(\);/);
    expect(consent).toMatch(/if \(choice === 'granted'\) \{\s*loadGtag\(\);/);
  });

  it('shows the consent banner hidden by default, so it never flashes as loaded', () => {
    expect(template).toMatch(/<div class="cookie-consent" hidden id="cookie-consent"/);
  });

  it('has matching consent and cookie-settings copy in both locales', () => {
    for (const key of ['consent.text', 'consent.decline', 'consent.accept', 'footer.privacy']) {
      const matches = i18n.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g'));
      expect(matches, `expected 2 occurrences (ja + en) of "${key}"`).toHaveLength(2);
    }
  });
});
