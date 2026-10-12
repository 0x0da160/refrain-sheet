// SPDX-License-Identifier: MIT
// Render the display-ad banners for the landing page (docs/ad-banners/).
//
// Each banner is laid out in HTML/CSS and rendered to PNG in headless
// Chromium at 1x and 2x, so the type is set by the browser's own shaper
// (Noto Sans JP, proportional `palt`, vertical `vpal`) rather than outlined
// by hand. Display lines are scaled to fill an exact width (`data-fit`).
// The logotype is the design system's reverse lockup, used as-is.
//
// Noto Sans JP is not vendored. Pass a folder with the static Google Fonts
// files NotoSansJP-Bold.ttf and NotoSansJP-Black.ttf (SIL OFL 1.1):
//
//   npm run build:ad-banners -- --fonts <dir>
//
// It overwrites docs/ad-banners/*.png; no other file needs editing.

/* global document, getComputedStyle, innerHeight, innerWidth */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'docs', 'ad-banners');
const logo = join(root, 'design-system/v2/foundations/logo/refrain-sheet-logotype-horizontal-reverse.svg');

const fontsArg = process.argv.indexOf('--fonts');
const fontsDir = fontsArg > 0 ? process.argv[fontsArg + 1] : undefined;
const fontFiles = { 700: 'NotoSansJP-Bold.ttf', 900: 'NotoSansJP-Black.ttf' };
if (!fontsDir || Object.values(fontFiles).some((f) => !existsSync(join(fontsDir, f)))) {
  console.error(`ad-banners: FAIL: pass --fonts <dir> containing ${Object.values(fontFiles).join(' and ')}`);
  process.exit(1);
}

// Deep brand green with an electric lime accent; the logo is the reverse lockup.
const C = { bg: '#003D22', fg: '#FFFFFF', hi: '#C8F542', sub: '#BFE3C6', ctaFg: '#0B2416' };

// Inlined as data: URLs so the page needs no file access.
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const logoUrl = dataUrl(logo, 'image/svg+xml');
const fontFaces = Object.entries(fontFiles)
  .map(
    ([w, f]) =>
      `@font-face{font-family:NSJP;src:url("${dataUrl(join(fontsDir, f), 'font/ttf')}");font-weight:${w}}`,
  )
  .join('');

const css = `${fontFaces}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:NSJP;font-feature-settings:"palt" 1;font-kerning:normal;color:${C.fg};-webkit-font-smoothing:antialiased}
.ad{position:relative;overflow:hidden;background:${C.bg}}
.logo{display:block}
.d{font-weight:900;line-height:1.12;letter-spacing:-.02em;white-space:nowrap;display:inline-block}
.d em,.list i{font-style:normal;color:${C.hi}}
.k{font-weight:700;white-space:nowrap;letter-spacing:.02em;color:${C.sub}}
.cta{display:inline-flex;align-items:center;justify-content:center;gap:.3em;background:${C.hi};color:${C.ctaFg};
  border-radius:999px;font-weight:900;white-space:nowrap;letter-spacing:.01em}
.list{font-weight:900;white-space:nowrap;line-height:1.25;display:inline-block}
.list i{margin-right:.3em}
.col{display:flex;flex-direction:column;justify-content:space-between}
.top{display:flex;justify-content:space-between;align-items:center}
.vert{writing-mode:vertical-rl;font-feature-settings:"vpal" 1;font-weight:900;font-size:62px;line-height:1.08;
  letter-spacing:-.01em;white-space:nowrap;align-self:center}
.vert .latin{text-orientation:upright;letter-spacing:-.12em}
.vert em{font-style:normal;color:${C.hi}}
.rule{height:3px;width:36px;background:${C.hi}}
`;

const KICKER = '無料のCSVエディタ';
const HEAD = 'CSVを、<br><em>壊さない。</em>';
const HEAD_ONE_LINE = 'CSVを、<em>壊さない。</em>';
const LIST = '<i>✓</i>先頭の0<br><i>✓</i>Shift_JIS<br><i>✓</i>改行コード';
const LIST_ONE_LINE = '<i>✓</i>先頭の0　<i>✓</i>Shift_JIS　<i>✓</i>改行コード';

const arrow =
  '<svg width="0.9em" height="0.9em" viewBox="0 0 16 16" fill="none" style="flex:none"><path d="M5.5 3 10.5 8 5.5 13" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const lockup = (h) =>
  `<img class="logo" src="${logoUrl}" height="${h}" width="${((h * 573.37) / 120).toFixed(2)}" alt="Refrain Sheet">`;
const cta = (fs, h, px, w) =>
  `<span class="cta" style="font-size:${fs}px;height:${h}px;padding:0 ${px}px${w ? `;width:${w}` : ''}">無料で使ってみる${arrow}</span>`;
/** A display line scaled in the page so its box is exactly `w` px wide. */
const fit = (cls, html, w, style = '') =>
  `<span class="${cls}" data-fit="${w}" style="font-size:100px;${style}">${html}</span>`;
const top = (h, fs) =>
  `<div class="top">${lockup(h)}<span class="k" style="font-size:${fs}px">${KICKER}</span></div>`;

/** Logo heights stay at or above the brand guidelines' 24px lockup minimum. */
const BANNERS = {
  '300x250': () => `<div class="ad col" style="padding:20px">
    ${top(24, 12)}<div>${fit('d', HEAD, 232)}</div>${cta(16, 42, 0, '100%')}</div>`,
  '336x280': () => `<div class="ad col" style="padding:22px">
    ${top(26, 13)}<div>${fit('d', HEAD, 262)}</div>${cta(17, 46, 0, '100%')}</div>`,
  '728x90':
    () => `<div class="ad" style="padding:0 24px;display:flex;align-items:center;justify-content:space-between">
    <div>${lockup(28)}<div class="k" style="font-size:12px;margin-top:6px">${KICKER}</div></div>
    ${fit('d', HEAD_ONE_LINE, 300)}${cta(16, 46, 22)}</div>`,
  '160x600': () => `<div class="ad col" style="padding:22px 14px">
    <div>${lockup(24)}<div class="k" style="font-size:12px;margin-top:10px">${KICKER}</div></div>
    <div class="vert"><span class="latin">CSV</span>を、<br><em>壊さない。</em></div>
    <div><div class="rule" style="margin-bottom:14px"></div>${fit('list', LIST, 124)}</div>
    ${cta(14, 46, 0, '100%')}</div>`,
  '300x600': () => `<div class="ad col" style="padding:28px 24px">
    ${lockup(30)}
    <div><div class="k" style="font-size:16px;color:${C.hi};margin-bottom:12px">${KICKER}</div>${fit('d', HEAD, 252)}</div>
    <div><div class="rule" style="height:4px;width:48px;margin-bottom:22px"></div>${fit('list', LIST, 200)}</div>
    ${cta(19, 58, 0, '100%')}</div>`,
  '970x250': () => `<div class="ad" style="padding:30px 40px;display:flex;justify-content:space-between">
    <div class="col" style="width:600px;align-items:flex-start">${lockup(32)}${fit('d', HEAD_ONE_LINE, 590)}${fit('list', LIST_ONE_LINE, 430)}</div>
    <div class="col" style="align-items:flex-end"><span class="k" style="font-size:15px;line-height:32px">${KICKER}</span>${cta(21, 64, 36)}</div></div>`,
};

function fitDisplayLines() {
  for (const el of document.querySelectorAll('[data-fit]')) {
    const target = Number(el.dataset.fit);
    for (let i = 0; i < 4; i++) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      el.style.fontSize = `${(size * target) / el.getBoundingClientRect().width}px`;
    }
    el.style.fontSize = `${Math.floor(parseFloat(el.style.fontSize) * 2) / 2}px`;
  }
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [size, render] of Object.entries(BANNERS)) {
    const [width, height] = size.split('x').map(Number);
    const html = `<!doctype html><meta charset="utf-8"><style>${css}.ad{width:${width}px;height:${height}px}</style><body>${render()}</body>`;
    for (const scale of [1, 2]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(fitDisplayLines);
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll('.ad *')].some((e) => {
          const r = e.getBoundingClientRect();
          return r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5;
        }),
      );
      if (overflow) throw new Error(`${size}: content overflows the banner`);
      const file = join(outDir, `refrain-sheet-${size}${scale === 2 ? '-2x' : ''}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
      await page.close();
      console.warn(`ad-banners: wrote ${file}`);
    }
  }
} finally {
  await browser.close();
}
