// SPDX-License-Identifier: MIT
// Add-sheet dialog check, run by scripts/ui-check.mjs in headless Chromium
// against the built app.
//
// The unit tests drive `Commands` and the dialog separately, so they cannot
// see the wiring in `src/main.ts` between them. This check creates a new RSF
// file, clicks the sheet strip's "+" button, and confirms the dialog offers
// the sheet-type picker with the RSF (grid) type selected, and that picking
// another type changes the suggested sheet name.

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>} problems found (empty when the check passes)
 */
export async function checkSheetAddDialog(page) {
  const errors = [];
  // The welcome screen's second action is "New RSF Spreadsheet".
  await page.locator('.welcome-action').nth(1).click();
  await page.waitForSelector('.sheet-add', { timeout: 10_000 });
  await page.click('.sheet-add');
  try {
    await page.waitForSelector('.sheet-kind-picker', { timeout: 5_000 });
  } catch {
    return ['the add-sheet dialog shows no sheet-type picker (.sheet-kind-picker)'];
  }
  const kinds = await page.$$eval('.sheet-kind-picker input[type="radio"]', (radios) =>
    radios.map((radio) => ({ kind: radio.value, checked: radio.checked })),
  );
  const expected = ['grid', 'markdown', 'json', 'yaml', 'text'];
  if (kinds.map((k) => k.kind).join() !== expected.join()) {
    errors.push(`sheet-type picker offers ${kinds.map((k) => k.kind).join()}, expected ${expected.join()}`);
  }
  if (!kinds.find((k) => k.kind === 'grid')?.checked) {
    errors.push('the RSF (grid) sheet type is not selected by default');
  }
  const input = page.locator('.sheet-name-input');
  const gridName = await input.inputValue();
  await page.click('label[data-kind="markdown"]');
  const markdownName = await input.inputValue();
  if (markdownName === gridName) {
    errors.push(`choosing Markdown kept the suggested name "${gridName}" instead of a Markdown default`);
  }
  await page.keyboard.press('Escape');
  return errors;
}
