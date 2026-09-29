// SPDX-License-Identifier: MIT
// Type-to-edit after unlocking, run by scripts/ui-check/index.mjs in headless
// Chromium against the built app.
//
// An opened file starts protected: the first edit asks to unlock it. Closing
// that dialog used to hand focus back to the grid's hidden text field without
// a caret in it, so every later cell typed into without F2 was saved empty.
// jsdom has no caret, so only a real browser can show this. The check drops a
// CSV, unlocks it through a typed edit, then types into another cell with no
// F2 and confirms both values are in the grid.

/* The page.evaluate() callback below runs in the browser, not in Node. */
/* global DataTransfer, DragEvent, File, window */

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>} problems found (empty when the check passes)
 */
export async function checkTypeAfterUnlock(page) {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['a,b\n1,2\n3,4\n'], 'unlock.csv', { type: 'text/csv' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  const cell = (row, col) => `.vgrid-rows .vcell[data-row="${row}"][data-col="${col}"]`;
  try {
    await page.waitForSelector(cell(2, 1), { timeout: 10_000 });
  } catch {
    return ['type-after-unlock: the dropped CSV never rendered in the grid'];
  }
  await page.click(cell(1, 1));
  await page.keyboard.type('first');
  await page.keyboard.press('Enter');
  const unlock = page.getByRole('button', { name: /^(Unlock|ロックを解除)$/ });
  try {
    await unlock.waitFor({ timeout: 5_000 });
  } catch {
    return ['type-after-unlock: the opened CSV never asked to be unlocked'];
  }
  await unlock.click();
  await page.click(cell(2, 1));
  await page.keyboard.type('second');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const errors = [];
  for (const [row, expected] of [
    [1, 'first'],
    [2, 'second'],
  ]) {
    const shown = (await page.textContent(cell(row, 1)))?.trim();
    if (shown !== expected) {
      errors.push(`type-after-unlock: row ${row + 1} shows "${shown}" after typing "${expected}"`);
    }
  }
  return errors;
}
