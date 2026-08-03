// SPDX-License-Identifier: MIT
// Build the Refrain Sheet landing page.
//
// Generates a fully pre-rendered page per language (crawlable without JS):
//   landing/index.html      Japanese
//   landing/en/index.html   English
//
// Also writes landing/robots.txt, and — when a public site URL is passed —
// canonical tags, hreflang alternates, absolute OG URLs and sitemap.xml.
//
//   node scripts/build-landing.mjs                      # relative URLs (preview)
//   node scripts/build-landing.mjs https://example.com/  # production
//
// This replaces the previous Python + BeautifulSoup implementation
// (landing/build.py) so the landing site no longer needs a Python
// toolchain: DOM manipulation uses jsdom, already a devDependency for the
// app's own jsdom-environment tests.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { I18N } from '../landing/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const landingDir = join(root, 'landing');

const rawSite = process.argv[2];
const SITE = rawSite ? rawSite.replace(/\/+$/, '') + '/' : undefined;

const APP = 'https://0x0da160.github.io/refrain-sheet/';
const REPO = 'https://github.com/0x0da160/refrain-sheet';
const OG_IMG = 'assets/refrain-sheet-og-image.png';
const PAGES = { ja: 'index.html', en: 'en/index.html' };

const FEATURES = {
  ja: [
    '無編集で保存すると元ファイルとバイト単位で完全一致',
    '編集時に再シリアライズされるのは該当フィールドのバイト範囲だけ',
    'UTF-8 / Shift_JIS / CP932 / EUC-JP の自動判定と、文字コードを指定した開き直し',
    '保存時に文字コード・BOM・改行コードを個別に指定',
    '壊れたCSVを修復せず、行・列つきの診断を提示して開く',
    'RSFスプレッドシート（55関数・複数シート・XLSXエクスポート）',
    '完全オフライン動作。実行時のネットワーク通信ゼロ',
  ],
  en: [
    'Byte-identical output when a file is saved without edits',
    "Only the edited field's byte range is re-serialized",
    'Automatic detection of UTF-8, Shift_JIS, CP932 and EUC-JP, plus reopen with a chosen encoding',
    'Choose character encoding, BOM and line endings independently when saving',
    'Opens malformed CSV without repairing it, with row/column diagnostics',
    'RSF spreadsheet mode with 55 functions, multiple sheets and XLSX export',
    'Runs fully offline with zero network requests at runtime',
  ],
};
const OG_ALT = {
  ja: 'Refrain Sheet で Shift_JIS のCSVを開いた画面',
  en: 'Refrain Sheet showing a Shift_JIS CSV file',
};
const LOCALE = { ja: 'ja_JP', en: 'en_US' };

const rel = (path, depth) => '../'.repeat(depth) + path;
const absOrRel = (path, depth) => (SITE ? SITE + path : rel(path, depth));

/** Append a tag to `head`, with attributes set in sorted-key order (matches the
 * previous BeautifulSoup-generated markup, which serialized attributes sorted). */
function appendTag(doc, head, tagName, attrs) {
  const el = doc.createElement(tagName);
  for (const key of Object.keys(attrs).sort()) {
    el.setAttribute(key, attrs[key]);
  }
  head.appendChild(el);
}

function build(lang) {
  const d = I18N[lang];
  const depth = (PAGES[lang].match(/\//g) ?? []).length;
  const template = readFileSync(join(landingDir, 'template.html'), 'utf8');
  const dom = new JSDOM(template);
  const doc = dom.window.document;
  doc.documentElement.setAttribute('lang', lang);

  // ---------- copy ----------
  for (const el of doc.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (!(key in d)) throw new Error(`missing key: ${key}`);
    const attr = el.getAttribute('data-i18n-attr');
    if (attr) {
      el.setAttribute(attr, d[key]);
    } else if (!el.querySelector('*')) {
      el.textContent = d[key];
    }
  }

  // ---------- language switcher ----------
  const hrefs = { ja: { ja: './', en: 'en/' }, en: { ja: '../', en: './' } }[lang];
  for (const a of doc.querySelectorAll('.lang a')) {
    const code = a.getAttribute('data-lang');
    a.setAttribute('href', hrefs[code]);
    if (code === lang) {
      a.setAttribute('aria-current', 'page');
    } else {
      a.removeAttribute('aria-current');
    }
  }

  // ---------- relative asset paths ----------
  if (depth) {
    for (const el of doc.querySelectorAll('link, script, img')) {
      const attr = el.tagName === 'LINK' ? 'href' : 'src';
      const v = el.getAttribute(attr);
      if (v && !/^(https?:|#|\/|\.\.)/.test(v)) {
        el.setAttribute(attr, rel(v, depth));
      }
    }
  }

  // ---------- head ----------
  const head = doc.head;
  for (const el of head.querySelectorAll('[data-seo="1"]')) el.remove();

  doc.querySelector('title').textContent = d['meta.title'];
  head.querySelector('meta[name="description"]').setAttribute('content', d['meta.desc']);

  appendTag(doc, head, 'meta', {
    name: 'robots',
    content: 'index,follow,max-image-preview:large,max-snippet:-1',
    'data-seo': '1',
  });
  appendTag(doc, head, 'meta', { name: 'theme-color', content: '#1f7a4a', 'data-seo': '1' });
  appendTag(doc, head, 'meta', { name: 'author', content: '0x0da160', 'data-seo': '1' });

  if (SITE) {
    const pageUrl = SITE + (lang === 'ja' ? '' : 'en/');
    appendTag(doc, head, 'link', { rel: 'canonical', href: pageUrl, 'data-seo': '1' });
    appendTag(doc, head, 'link', { rel: 'alternate', hreflang: 'ja', href: SITE, 'data-seo': '1' });
    appendTag(doc, head, 'link', { rel: 'alternate', hreflang: 'en', href: SITE + 'en/', 'data-seo': '1' });
    appendTag(doc, head, 'link', { rel: 'alternate', hreflang: 'x-default', href: SITE, 'data-seo': '1' });
    appendTag(doc, head, 'meta', { property: 'og:url', content: pageUrl, 'data-seo': '1' });
  }

  appendTag(doc, head, 'meta', { property: 'og:type', content: 'website', 'data-seo': '1' });
  appendTag(doc, head, 'meta', { property: 'og:site_name', content: 'Refrain Sheet', 'data-seo': '1' });
  appendTag(doc, head, 'meta', { property: 'og:title', content: d['meta.title'], 'data-seo': '1' });
  appendTag(doc, head, 'meta', { property: 'og:description', content: d['meta.desc'], 'data-seo': '1' });
  appendTag(doc, head, 'meta', { property: 'og:image', content: absOrRel(OG_IMG, depth), 'data-seo': '1' });
  appendTag(doc, head, 'meta', { property: 'og:image:width', content: '1200', 'data-seo': '1' });
  appendTag(doc, head, 'meta', { property: 'og:image:height', content: '630', 'data-seo': '1' });
  appendTag(doc, head, 'meta', { property: 'og:image:alt', content: OG_ALT[lang], 'data-seo': '1' });
  appendTag(doc, head, 'meta', { property: 'og:locale', content: LOCALE[lang], 'data-seo': '1' });
  appendTag(doc, head, 'meta', {
    property: 'og:locale:alternate',
    content: LOCALE[lang === 'ja' ? 'en' : 'ja'],
    'data-seo': '1',
  });
  appendTag(doc, head, 'meta', { name: 'twitter:card', content: 'summary_large_image', 'data-seo': '1' });
  appendTag(doc, head, 'meta', { name: 'twitter:title', content: d['meta.title'], 'data-seo': '1' });
  appendTag(doc, head, 'meta', { name: 'twitter:description', content: d['meta.desc'], 'data-seo': '1' });
  appendTag(doc, head, 'meta', {
    name: 'twitter:image',
    content: absOrRel(OG_IMG, depth),
    'data-seo': '1',
  });
  appendTag(doc, head, 'meta', { name: 'twitter:image:alt', content: OG_ALT[lang], 'data-seo': '1' });

  // ---------- structured data ----------
  const app = {
    '@context': 'https://schema.org',
    '@type': ['SoftwareApplication', 'WebApplication'],
    name: 'Refrain Sheet',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'CSV editor',
    operatingSystem: 'Web browser (Chromium, Firefox, Safari)',
    browserRequirements:
      'Requires JavaScript. File System Access API needed for in-place overwrite (Chromium).',
    description: d['meta.desc'],
    url: APP,
    installUrl: APP,
    downloadUrl: REPO + '/releases/',
    sameAs: [REPO],
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    inLanguage: ['ja', 'en'],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
    author: { '@type': 'Person', name: '0x0da160', url: 'https://github.com/0x0da160' },
    featureList: FEATURES[lang],
    screenshot: {
      '@type': 'ImageObject',
      contentUrl: absOrRel('assets/refrain-sheet-shift-jis-csv-editor.webp', depth),
      caption: d['hero.alt'],
    },
    image: absOrRel(OG_IMG, depth),
  };
  const graph = [app];
  if (SITE) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Refrain Sheet',
      url: SITE,
      inLanguage: lang,
    });
  }
  for (const obj of graph) {
    const s = doc.createElement('script');
    s.setAttribute('data-seo', '1');
    s.setAttribute('type', 'application/ld+json');
    s.textContent = JSON.stringify(obj, null, 2);
    head.appendChild(s);
  }

  // jsdom's document-level serialization drops the whitespace between the
  // leading license comment, the doctype and <html> (it treats them as
  // adjacent Document children), and uppercases the doctype; restore the
  // template's line breaks and lowercase doctype there.
  const html = dom
    .serialize()
    .replace(
      '<!-- SPDX-License-Identifier: MIT --><!DOCTYPE html>',
      '<!-- SPDX-License-Identifier: MIT -->\n<!doctype html>\n\n',
    );

  const out = join(landingDir, PAGES[lang]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, 'utf8');
  return out;
}

function main() {
  for (const lang of Object.keys(PAGES)) {
    console.warn('built', build(lang));
  }

  let robots = 'User-agent: *\nAllow: /\n';
  if (SITE) robots += `\nSitemap: ${SITE}sitemap.xml\n`;
  writeFileSync(join(landingDir, 'robots.txt'), robots, 'utf8');

  const sitemapPath = join(landingDir, 'sitemap.xml');
  if (SITE) {
    const urls = Object.keys(PAGES).map((lang) => {
      const loc = SITE + (lang === 'ja' ? '' : 'en/');
      const altLangs = ['ja', 'en'];
      let alts = altLangs
        .map(
          (l) =>
            `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${l === 'ja' ? '' : 'en/'}"/>`,
        )
        .join('');
      alts += `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}"/>`;
      return `  <url>\n    <loc>${loc}</loc>${alts}\n  </url>`;
    });
    writeFileSync(
      sitemapPath,
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
        urls.join('\n') +
        '\n</urlset>\n',
      'utf8',
    );
    console.warn('built sitemap.xml');
  } else if (existsSync(sitemapPath)) {
    rmSync(sitemapPath);
  }
}

main();
