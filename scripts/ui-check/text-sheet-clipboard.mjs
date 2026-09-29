// SPDX-License-Identifier: MIT
// Toolbar Cut and Paste on a Markdown sheet, run by scripts/ui-check/index.mjs
// in headless Chromium against the built app.
//
// A Markdown sheet keeps its whole text in one cell, and the toolbar's Cut
// used to run the grid's cut on that cell: one click emptied the document.
// Cut, Copy and Paste now act on the sheet's text editor, like Ctrl+X/C/V.
// jsdom has neither a caret nor the browser's editing commands, so only a
// real browser can show this. The check selects one word, cuts it with the
// toolbar, pastes it back at the start, and confirms the rest of the text
// is still there. Its page needs clipboard access (see index.mjs).

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>} problems found (empty when the check passes)
 */
export async function checkTextSheetClipboard(page) {
  // The welcome screen's second action is "New RSF Spreadsheet".
  await page.locator('.welcome-action').nth(1).click();
  await page.waitForSelector('.sheet-add', { timeout: 10_000 });
  await page.click('.sheet-add');
  await page.waitForSelector('.sheet-kind-picker', { timeout: 5_000 });
  await page.click('label[data-kind="markdown"]');
  await page.locator('dialog[open] button.primary').click();
  const editor = page.locator('textarea.markdown-sheet-source');
  try {
    await editor.waitFor({ timeout: 5_000 });
  } catch {
    return ['text-sheet-clipboard: the new Markdown sheet shows no text editor'];
  }
  await editor.click();
  await page.keyboard.type('# Title\n\nkeep this word');
  await editor.evaluate((field) => {
    const at = field.value.indexOf('word');
    field.setSelectionRange(at, at + 4);
  });
  const errors = [];
  const bold = await page.getAttribute('.app-toolbar-button[data-command="format.bold"]', 'aria-disabled');
  if (bold !== 'true') {
    errors.push('text-sheet-clipboard: Bold is not turned off on a Markdown sheet');
  }
  await page.click('.app-toolbar-button[data-command="edit.cut"]');
  await page.waitForTimeout(300);
  const afterCut = await editor.inputValue();
  if (afterCut !== '# Title\n\nkeep this ') {
    errors.push(
      `text-sheet-clipboard: toolbar Cut left ${JSON.stringify(afterCut)}, expected only "word" cut`,
    );
  }
  await editor.evaluate((field) => field.setSelectionRange(0, 0));
  await page.click('.app-toolbar-button[data-command="edit.paste"]');
  await page.waitForTimeout(300);
  const afterPaste = await editor.inputValue();
  if (afterPaste !== 'word# Title\n\nkeep this ') {
    errors.push(`text-sheet-clipboard: toolbar Paste left ${JSON.stringify(afterPaste)}`);
  }
  return errors;
}
