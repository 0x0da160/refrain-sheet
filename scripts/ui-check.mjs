// SPDX-License-Identifier: MIT
// Headless-browser UI smoke check.
//
// Loads the built distribution (dist/index.html) in headless Chromium the
// same way a user does — directly via file://, no server — and fails if the
// app does not render or logs a console/page error. This is a manual/
// on-demand tool for developers and agents to visually confirm a UI change
// actually works in a real browser engine; it is not part of `npm run
// build`/`test` and is not wired into CI.
//
//   npm run build   # dist/ must already exist
//   npm run ui:check

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = join(root, 'dist', 'index.html');

if (!existsSync(indexHtml)) {
  console.error(`ui-check: FAIL: ${indexHtml} does not exist — run \`npm run build\` first`);
  process.exit(1);
}

const errors = [];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console error: ${message.text()}`);
    }
  });

  await page.goto(pathToFileURL(indexHtml).href);

  try {
    await page.waitForSelector('.menu-bar', { timeout: 10_000 });
  } catch {
    errors.push('the menu bar (.menu-bar) never appeared — the app did not render');
  }
} finally {
  await browser.close();
}

if (errors.length > 0) {
  console.error(`ui-check: FAIL: ${errors.length} issue(s) loading ${indexHtml} in headless Chromium:`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}
console.warn(
  `ui-check: ok: ${indexHtml} loaded and rendered in headless Chromium with no console/page errors`,
);
