// SPDX-License-Identifier: MIT
// Headless-browser check of the CSV-only minimal edition (src/app/edition.ts).
//
// Loads dist/index.html (the regular edition) and dist-minimal/index.html
// (the minimal edition) over file://, drops the same CSV on each, makes the
// same two edits, saves with Ctrl+S (a download on file://), and fails
// unless both saves wrote exactly the same bytes. On the minimal edition it
// also checks that the Format, Insert and Data menus are gone and that a
// dropped .rsf file is turned away without opening a tab.
//
//   npm run build && npm run build:minimal   # both outputs must exist
//   npm run ui:check:minimal

/* The page.evaluate() callbacks below run in the browser, not in Node. */
/* global DataTransfer, DragEvent, File, window */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EDITIONS = [
  { name: 'regular', html: join(root, 'dist', 'index.html') },
  { name: 'minimal', html: join(root, 'dist-minimal', 'index.html') },
];

/** A CSV with a BOM, CRLF line ends, quoted fields and an empty field. */
const CSV = '﻿id,name,note\r\n2,"Bob","say ""hi"""\r\n1,Ann,\r\n3,Cy,plain\r\n';

for (const edition of EDITIONS) {
  if (!existsSync(edition.html)) {
    console.error(
      `ui-check-minimal: FAIL: ${edition.html} does not exist — run \`npm run build\` and \`npm run build:minimal\` first`,
    );
    process.exit(1);
  }
}

const errors = [];

/** Drop a file on the window, the way a user opens one. */
async function drop(page, name, text) {
  await page.evaluate(
    ([name, text]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], name, { type: 'text/csv' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [name, text],
  );
}

/**
 * Add `suffix` to a cell's value (F2, End, type, Enter). An opened file
 * starts protected, so the first edit asks to unlock it; unlocking then
 * applies that edit.
 */
async function appendTo(page, row, col, suffix) {
  await page.click(`.vgrid-rows .vcell[data-row="${row}"][data-col="${col}"]`);
  await page.keyboard.press('F2');
  await page.keyboard.press('End');
  await page.keyboard.type(suffix);
  await page.keyboard.press('Enter');
  const button = page.getByRole('button', { name: /^(Unlock|ロックを解除)$/ });
  try {
    await button.waitFor({ timeout: 1_000 });
    await button.click();
  } catch {
    // Not protected: the edit went through.
  }
  await page.waitForTimeout(200);
}

/** Open, edit and save the CSV in one edition; the saved bytes, or null. */
async function editAndSave(browser, edition) {
  const fail = (message) => errors.push(`${edition.name}: ${message}`);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  page.on('pageerror', (error) => fail(`page error: ${error.message}`));
  await page.goto(pathToFileURL(edition.html).href);
  await page.waitForSelector('.menu-bar', { timeout: 10_000 });

  if (edition.name === 'minimal') {
    const menus = await page.$$eval('.menu-bar [role="menuitem"]', (items) =>
      items.map((item) => item.textContent?.trim() ?? ''),
    );
    for (const gone of ['Insert', 'Format', 'Data', '挿入', '書式', 'データ']) {
      if (menus.includes(gone)) {
        fail(`the ${gone} menu is still shown`);
      }
    }
    await drop(page, 'book.rsf', 'not a workbook');
    await page.waitForTimeout(500);
    if ((await page.$$('.tab-bar .tab')).length > 0) {
      fail('a dropped .rsf file opened a tab');
    }
  }

  await drop(page, 'people.csv', CSV);
  try {
    await page.waitForSelector('.vgrid-rows .vcell[data-row="1"][data-col="1"]', { timeout: 10_000 });
  } catch {
    fail('the dropped CSV never rendered in the grid');
    await page.close();
    return null;
  }
  await appendTo(page, 1, 1, 'by');
  await appendTo(page, 3, 2, ' text');
  const download = page.waitForEvent('download', { timeout: 10_000 });
  await page.keyboard.press('Control+S');
  let saved = null;
  try {
    saved = new Uint8Array(readFileSync(await (await download).path()));
  } catch {
    fail('Ctrl+S never saved the file');
  }
  await page.close();
  return saved;
}

const browser = await chromium.launch();
const saved = [];
try {
  for (const edition of EDITIONS) {
    saved.push(await editAndSave(browser, edition));
  }
} finally {
  await browser.close();
}

const [regular, minimal] = saved;
if (regular && minimal) {
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(regular);
  if (!text.includes('Bobby') || !text.includes('plain text')) {
    errors.push(`the regular edition saved without the edits: ${JSON.stringify(text)}`);
  }
  if (regular.length !== minimal.length || regular.some((byte, i) => byte !== minimal[i])) {
    errors.push(
      `the two editions saved different bytes:\n    regular ${JSON.stringify(text)}\n    minimal ${JSON.stringify(new TextDecoder('utf-8', { ignoreBOM: true }).decode(minimal))}`,
    );
  }
}

if (errors.length > 0) {
  console.error(`ui-check-minimal: FAIL: ${errors.length} issue(s):`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}
console.warn('ui-check-minimal: ok: both editions saved the same bytes, and the minimal edition is CSV-only');
