// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
// Guards the structure of the landing site (site/): the partials the build
// includes, the copy dictionary both languages share, and the hero demo's
// promise to the brand guidelines (design system D-42) — the drawn app
// screen takes its labels from the app's own locale files and its colours
// from the design tokens, so it cannot drift from the real app unnoticed.
// `fs` is declared ambiently in tests/node-shims.d.ts (no @types/node needed).
import { readFileSync, readdirSync } from 'fs';
import { describe, expect, it } from 'vitest';

const PAGES = ['site/template.html', 'site/privacy.html', 'site/terms.html'];
const partialFiles = readdirSync('site/partials').filter((f: string) => f.endsWith('.html'));
const read = (f: string): string => readFileSync(f, 'utf8');
const includesOf = (html: string): string[] =>
  [...html.matchAll(/<!--\s*@include\s+partials\/([\w-]+\.html)\s*-->/g)].map((m) => m[1]);
const allSources = [...PAGES, ...partialFiles.map((f: string) => `site/partials/${f}`)].map(read).join('\n');

const appLocales: Record<string, Record<string, string>> = {
  ja: JSON.parse(read('src/locales/ja.json')),
  en: JSON.parse(read('src/locales/en.json')),
};
// site/i18n.js is a plain build-time module; read its keys from the source
// (one `'key': value` entry per line after Prettier) rather than importing it.
const i18nSource = read('site/i18n.js');
const enStart = i18nSource.indexOf('\n  en: {');
const keysIn = (block: string): string[] => [...block.matchAll(/^ {4}'([^']+)':/gm)].map((m) => m[1]);
const dictKeys: Record<string, string[]> = {
  ja: keysIn(i18nSource.slice(0, enStart)),
  en: keysIn(i18nSource.slice(enStart)),
};

describe('landing partials', () => {
  it('every include points at an existing partial, and every partial is included', () => {
    const included = new Set(PAGES.flatMap((p) => includesOf(read(p))));
    for (const name of included) expect(partialFiles, `missing partial ${name}`).toContain(name);
    for (const name of partialFiles) expect(included.has(name), `unused partial ${name}`).toBe(true);
  });

  it('partials do not include other partials (the build resolves one level only)', () => {
    for (const name of partialFiles) expect(includesOf(read(`site/partials/${name}`)), name).toEqual([]);
  });

  it('every partial carries the SPDX license header', () => {
    for (const name of partialFiles) {
      expect(read(`site/partials/${name}`).startsWith('<!-- SPDX-License-Identifier: MIT -->'), name).toBe(
        true,
      );
    }
  });
});

describe('landing copy', () => {
  it('has the same keys in Japanese and English', () => {
    expect(dictKeys.ja.length).toBeGreaterThan(100);
    expect([...dictKeys.en].sort()).toEqual([...dictKeys.ja].sort());
  });

  it('defines every data-i18n key the pages use', () => {
    const keys = new Set([...allSources.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
    for (const key of keys) {
      expect(dictKeys.ja, `ja: ${key}`).toContain(key);
      expect(dictKeys.en, `en: ${key}`).toContain(key);
    }
  });
});

describe('hero demo stays faithful to the real app (D-42)', () => {
  const hero = new DOMParser().parseFromString(read('site/partials/hero.html'), 'text/html');
  const screen = hero.querySelector('.demo-app');

  it('exists', () => {
    expect(screen).not.toBeNull();
  });

  it('takes every app label from src/locales, in both languages', () => {
    const labelled = [...screen!.querySelectorAll('[data-app-i18n]')];
    expect(labelled.length).toBeGreaterThan(10);
    for (const el of labelled) {
      const key = el.getAttribute('data-app-i18n')!;
      for (const lang of ['ja', 'en']) {
        expect(appLocales[lang], `${lang}: ${key}`).toHaveProperty([key]);
        const placeholders = [...appLocales[lang][key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        const args = JSON.parse(el.getAttribute('data-app-i18n-args') ?? '{}') as Record<string, string>;
        for (const name of placeholders) {
          expect(args, `${key} needs {${name}}`).toHaveProperty([name]);
          expect(dictKeys[lang], `${lang}: ${args[name]}`).toContain(args[name]);
        }
      }
    }
  });

  it('writes no UI text of its own: the rest is sample data or cell values', () => {
    // Text the demo may carry literally: cell references and addresses,
    // numbers, the typed formula, and the few symbols the app draws.
    const allowed = /^(?:[A-D]|[A-D]?\d+|=C2\/B2|[×●:]|CRLF)$/;
    const walker = hero.createTreeWalker(screen!, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent!.trim();
      if (!text) continue;
      const owner = node.parentElement!;
      if (owner.closest('[data-i18n], [data-app-i18n]')) continue; // replaced at build time
      for (const token of text.split(/\s+/))
        expect(token, `literal text "${text}" in the demo`).toMatch(allowed);
    }
  });

  it('draws with design tokens only — no colour literals in the landing stylesheet', () => {
    const css = read('site/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|lab)\(/);
  });
});
