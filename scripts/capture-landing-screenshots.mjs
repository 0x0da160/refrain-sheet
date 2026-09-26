// SPDX-License-Identifier: MIT
// Capture the landing page's marketing screenshots straight from the real app.
//
// Drives the built distribution (dist/index.html) in headless Chromium —
// same loading path as scripts/ui-check.mjs — to the one real UI state the
// landing page shows (site/partials/csv.html, and the SoftwareApplication
// screenshot in scripts/build-landing.mjs): a Shift_JIS sales ledger with
// one edited cell. It writes the shot into site/assets/ as a
// master-resolution .webp plus the smaller responsive srcset variants the
// partial already references. Re-run this whenever the UI changes enough
// that the screenshot looks stale; it always overwrites the same file
// names, so no other file needs editing. The hero demo is drawn, not
// captured (brand guidelines D-42) — compare it against a fresh capture of
// the same flow when either changes.
//
//   npm run build                        # dist/ must already exist
//   npm run capture:landing-screenshots
//
// Requires `sharp` (devDependency) to encode/resize into .webp — Playwright's
// own page.screenshot() only writes PNG/JPEG.

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import Encoding from 'encoding-japanese';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = join(root, 'dist', 'index.html');
const assetsDir = join(root, 'site', 'assets');

if (!existsSync(indexHtml)) {
  console.error(
    `capture-landing-screenshots: FAIL: ${indexHtml} does not exist — run \`npm run build\` first`,
  );
  process.exit(1);
}

/** Encode a JS string as Shift_JIS bytes, for a realistic Shift_JIS sample CSV. */
function toShiftJis(text) {
  const unicode = Encoding.stringToCode(text);
  return new Uint8Array(Encoding.convert(unicode, { to: 'SJIS', from: 'UNICODE' }));
}

// A realistic-looking sales ledger, long enough to fill the grid area at the
// capture viewport height without an awkward band of empty rows below it.
const SALES_LEDGER_ROWS = [
  ['B-2001', '抹茶 ラテベース', 20, 3200, ''],
  ['B-2002', '抹茶 セレモニアル', 12, 4800, ''],
  ['B-2003', 'ほうじ茶 パウダー', 30, 2100, ''],
  ['B-2004', '玄米茶 ティーバッグ', 45, 1800, ''],
  ['B-2005', '煎茶 一番摘み', 18, 5200, ''],
  ['B-2006', '和三盆 詰め合わせ', 8, 3600, ''],
  ['B-2007', '抹茶 お菓子セット', 15, 2900, ''],
  ['B-2008', 'ほうじ茶 ラテベース', 22, 3400, ''],
  ['B-2009', '玄米茶 大容量', 10, 4100, ''],
  ['B-2010', '煎茶 ティーバッグ', 36, 1600, ''],
  ['B-2011', '抹茶 石臼挽き', 6, 6800, ''],
  ['B-2012', 'ほうじ茶 焙煎茶葉', 14, 2400, ''],
  ['B-2013', '玄米茶 ギフト箱', 9, 3900, ''],
  ['B-2014', '煎茶 深蒸し', 28, 2200, ''],
  ['B-2015', '抹茶 スイーツ用', 17, 3100, ''],
];
const SALES_LEDGER_CSV =
  '商品コード,商品名,数量,単価,備考\r\n' +
  SALES_LEDGER_ROWS.map((row) => row.join(',')).join('\r\n') +
  '\r\n';

/** Each shot's file base name and the responsive widths its srcset (site/partials/csv.html) expects. */
const SHOTS = {
  'shift-jis-csv-editor': [400, 800],
};

async function writeWebp(basename, buffer) {
  const master = sharp(buffer);
  const meta = await master.metadata();
  await master
    .clone()
    .webp({ quality: 82 })
    .toFile(join(assetsDir, `refrain-sheet-${basename}.webp`));
  for (const width of SHOTS[basename]) {
    await sharp(buffer)
      .resize({ width })
      .webp({ quality: 82 })
      .toFile(join(assetsDir, `refrain-sheet-${basename}-${width}w.webp`));
  }
  console.warn(
    `capture-landing-screenshots: wrote refrain-sheet-${basename}.webp (${meta.width}x${meta.height})`,
  );
  return meta;
}

async function newPage(browser, { locale, theme }) {
  // deviceScaleFactor 2 captures at retina pixel density, matching the
  // resolution of the screenshots this replaces (their masters were already
  // roughly 2x their CSS-pixel content) and giving the resized srcset
  // variants real detail to downscale from instead of upscaling. The width
  // is kept just wide enough for the 5-column sales ledger fixture so the
  // grid fills the frame instead of leaving a wide empty margin to its right.
  const context = await browser.newContext({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  // Force the <input type="file"> fallback (see src/app/file-access.ts): the
  // File System Access API's showOpenFilePicker() has no headless UI to
  // automate, but Playwright can drive a real file input via 'filechooser'.
  // This callback is serialized and runs inside the browser page, not in
  // Node, so `window`/`localStorage` are genuinely defined there.
  /* eslint-disable no-undef */
  await page.addInitScript(
    ({ locale, theme }) => {
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
      localStorage.setItem('refrain-csv-html.locale', locale);
      localStorage.setItem('refrain-csv-html.theme', theme);
    },
    { locale, theme },
  );
  /* eslint-enable no-undef */
  await page.goto(pathToFileURL(indexHtml).href);
  await page.waitForSelector('.menu-bar');
  return page;
}

/** Opens a well-formed CSV through the welcome screen's Open button and waits for its grid. */
async function openCleanFile(page, name, bytes) {
  const buffer = Buffer.from(bytes);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('button.welcome-action.primary').click(),
  ]);
  // Playwright's setFiles() only accepts real paths or {name, mimeType,
  // buffer}, which is exactly what an in-memory generated fixture needs.
  await chooser.setFiles({ name, mimeType: 'text/csv', buffer });
  await page.waitForSelector('[data-row][data-col]');
}

async function editRemarkCell(page) {
  // Opening an existing file now defaults to read-only protection (see
  // status-bar.ts); unlock it via the status bar's Edit toggle first, or the
  // demo edit below is silently rejected.
  await page.locator('.status-protect-toggle').click();

  // Column 4 ("備考"/remarks) of the B-2002 row (row index 2 — row 0 is the
  // header) — empty in the fixture, so editing it demonstrates the landing
  // page's "only the cells you edit change" claim: only this cell turns
  // colored.
  const cell = page.locator('[data-row="2"][data-col="4"]');
  await cell.dblclick();
  await page.keyboard.type('残り12点・要発注');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.vcell.edited');
}

async function main() {
  mkdirSync(assetsDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await newPage(browser, { locale: 'ja', theme: 'light' });
    await openCleanFile(page, 'sales.csv', toShiftJis(SALES_LEDGER_CSV));
    await editRemarkCell(page);
    await writeWebp('shift-jis-csv-editor', await page.screenshot());
    await page.context().close();
  } finally {
    await browser.close();
  }
  console.warn(
    'capture-landing-screenshots: done — review the new files under site/assets/ before committing',
  );
}

await main();
