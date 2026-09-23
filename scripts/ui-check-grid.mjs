// SPDX-License-Identifier: MIT
// Grid geometry and visual check, run by scripts/ui-check.mjs in headless
// Chromium against the built app.
//
// jsdom performs no layout, so the unit tests can only assert the inline
// sizes and the stylesheet source. This check drops a CSV onto the real app
// and measures the laid-out grid at every spreadsheet zoom level:
//
//   - a cell's outer box is exactly the zoom-scaled 104 x 24 px, grid line
//     included, so the column/row pitch never drifts, even far down and right;
//   - each cell draws only its own right/bottom 1px line (never doubled);
//   - padding is 6px left/right and 3px top/bottom, and text (left-aligned,
//     right-aligned, ellipsis-truncated) stays inside the content box;
//   - the text position does not move between the normal, selected, edited,
//     error and editing states, or between an IME composition and its commit;
//   - logical coordinates, hit testing (elementFromPoint), clicks, and
//     scrolling all agree.
//
// Optional: set UI_CHECK_SCREENSHOT_DIR to save one screenshot per zoom level.

/* The page.evaluate() callbacks below run in the browser, not in Node. */
/* global DataTransfer, DragEvent, Event, File, Node, document, getComputedStyle, localStorage, requestAnimationFrame, window */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_COL = 104;
const BASE_ROW = 24;
const BASE_ROW_HEAD = 64;
const PAD_X = 6;
const PAD_Y = 3;
const ZOOM_LEVELS = [50, 75, 90, 100, 110, 125, 150, 200];

/** Short Japanese values, numbers, dates, codes and mixed-width text. */
const SAMPLE = [
  ['商品名', '担当者', 'ステータス', '数量', '単価', '更新日', '備考', 'コード', '混在'],
  [
    '抹茶ラテ',
    '田中',
    '要確認',
    '12',
    '4,800',
    '2026-09-23',
    '在庫僅少',
    'SKU-00012',
    'ｶﾅ半角ＡＢＣ全角abc!?#＠',
  ],
  [
    '深煎り珈琲',
    '佐藤',
    '処理済み',
    '120',
    '980',
    '2026-09-23',
    '通常',
    'JP-1000-0001',
    '〒100-0001 千代田区',
  ],
  [
    'ほうじ茶',
    '鈴木',
    '保留',
    '3',
    '12,345,678',
    '2026-10-01',
    '省略表示の確認用にとても長い備考テキストを入れています',
    'A-1',
    'Mixed 日本語 text',
  ],
];
const ROWS = 3000;
const COLS = 60;

function buildCsv() {
  const lines = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const sample = SAMPLE[r]?.[c];
      row.push(sample ?? `R${r + 1}C${c + 1}`);
    }
    lines.push(row.map((v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Measure a cell in the page: its box, computed borders/padding, and the
 * box of its text (null for an empty cell). All values in CSS px.
 */
async function measureCell(page, row, col) {
  return page.evaluate(
    ({ row, col }) => {
      const cell = document.querySelector(`.vgrid-rows .vcell[data-row="${row}"][data-col="${col}"]`);
      if (!cell) return null;
      const cs = getComputedStyle(cell);
      const r = cell.getBoundingClientRect();
      const text = [...cell.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
      let textBox = null;
      if (text && text.textContent) {
        const range = document.createRange();
        range.selectNodeContents(text);
        const t = range.getBoundingClientRect();
        textBox = { left: t.left, right: t.right, top: t.top, bottom: t.bottom };
      }
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
        borderLeft: parseFloat(cs.borderLeftWidth),
        borderTop: parseFloat(cs.borderTopWidth),
        borderRight: parseFloat(cs.borderRightWidth),
        borderBottom: parseFloat(cs.borderBottomWidth),
        paddingLeft: parseFloat(cs.paddingLeft),
        paddingRight: parseFloat(cs.paddingRight),
        paddingTop: parseFloat(cs.paddingTop),
        paddingBottom: parseFloat(cs.paddingBottom),
        lineHeight: parseFloat(cs.lineHeight),
        overflowing: cell.scrollWidth > cell.clientWidth,
        classes: cell.className,
        textBox,
      };
    },
    { row, col },
  );
}

/** Where a box's text starts (x) and its first line box starts (y). */
async function textOrigin(page, selector) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      x: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
      y: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop),
      lineHeight: parseFloat(cs.lineHeight),
      fontSize: parseFloat(cs.fontSize),
    };
  }, selector);
}

async function currentZoom(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('.grid-container');
    return Math.round(Number(grid.style.getPropertyValue('--sheet-zoom')) * 100);
  });
}

async function setZoom(page, level) {
  // Ctrl+Shift+Period / Comma step the spreadsheet zoom (src/app/shortcuts.ts).
  for (let i = 0; i < ZOOM_LEVELS.length + 1; i++) {
    const zoom = await currentZoom(page);
    if (zoom === level) return;
    await page.keyboard.press(zoom < level ? 'Control+Shift+Period' : 'Control+Shift+Comma');
  }
  throw new Error(`could not reach ${level}% zoom (stuck at ${await currentZoom(page)}%)`);
}

async function scrollGridTo(page, left, top) {
  await page.evaluate(
    ({ left, top }) => {
      const grid = document.querySelector('.grid-container');
      grid.scrollLeft = left;
      grid.scrollTop = top;
      grid.dispatchEvent(new Event('scroll'));
    },
    { left, top },
  );
  // Let the virtualized renderer repaint the new window.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

const near = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

/**
 * Run the check on a page that already shows the app. Returns a list of
 * human-readable failures (empty when everything holds).
 */
export async function checkGridGeometry(page, { screenshotDir } = {}) {
  const errors = [];
  const fail = (message) => errors.push(`grid: ${message}`);

  // Auto-fit on open (on by default) would size every column to its content;
  // this check is about the default width, so turn it off for this page.
  await page.evaluate(() => localStorage.setItem('refrain-csv-html.autoFitOnOpen', '0'));
  await page.reload();
  await page.waitForSelector('.menu-bar', { timeout: 10_000 });

  // Open the sample by dropping it on the window, the way a user does.
  const csv = buildCsv();
  await page.evaluate((csv) => {
    const dt = new DataTransfer();
    dt.items.add(new File([csv], 'grid-visual.csv', { type: 'text/csv' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, csv);
  try {
    await page.waitForSelector('.vgrid-rows .vcell[data-row="1"][data-col="0"]', { timeout: 10_000 });
  } catch {
    fail('the dropped CSV never rendered in the grid');
    return errors;
  }

  // Make a real edit so the "edited" state is on screen: row 2 col 1 (佐藤).
  // An opened book starts protected, so the first attempt asks to unlock it.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.click('.vgrid-rows .vcell[data-row="2"][data-col="1"]');
    await page.keyboard.press('F2');
    await page.keyboard.press('End');
    await page.keyboard.type('さん');
    await page.keyboard.press('Enter');
    const unlock = page.getByRole('button', { name: /^(Unlock|ロックを解除)$/ });
    try {
      await unlock.waitFor({ timeout: 1_000 });
    } catch {
      break; // no prompt: the edit went through
    }
    await unlock.click();
  }
  await page.keyboard.press('Escape');

  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

  for (const level of ZOOM_LEVELS) {
    await setZoom(page, level);
    await scrollGridTo(page, 0, 0);
    const z = level / 100;
    const colW = Math.round(BASE_COL * z);
    const rowH = Math.round(BASE_ROW * z);
    const headW = Math.round(BASE_ROW_HEAD * z);
    const at = `${level}%`;

    // Error and right-aligned states: an error is an RSF formula state, so
    // the class is applied directly; right alignment likewise (the grid has
    // no automatic numeric alignment). Both are pure CSS, which is what this
    // check measures.
    await page.evaluate(() => {
      document.querySelector('.vgrid-rows .vcell[data-row="1"][data-col="7"]')?.classList.add('cell-error');
      for (const col of [3, 4]) {
        for (const row of [1, 2, 3]) {
          const cell = document.querySelector(`.vgrid-rows .vcell[data-row="${row}"][data-col="${col}"]`);
          if (cell) cell.style.textAlign = 'right';
        }
      }
    });

    const canvas = await page.evaluate(() => {
      const r = document.querySelector('.vgrid-canvas').getBoundingClientRect();
      return { left: r.left, top: r.top };
    });

    // --- Box, pitch, grid lines, padding, text inside the content box -----
    for (let row = 0; row < SAMPLE.length; row++) {
      for (let col = 0; col < SAMPLE[0].length; col++) {
        const m = await measureCell(page, row, col);
        const where = `${at} cell (${row},${col})`;
        if (!m) {
          fail(`${where} is not rendered`);
          continue;
        }
        if (!near(m.width, colW) || !near(m.height, rowH)) {
          fail(`${where} is ${m.width}x${m.height}, expected ${colW}x${rowH}`);
        }
        const expectLeft = canvas.left + headW + col * colW;
        const expectTop = canvas.top + rowH + row * rowH;
        if (!near(m.left, expectLeft) || !near(m.top, expectTop)) {
          fail(`${where} sits at (${m.left},${m.top}), expected (${expectLeft},${expectTop})`);
        }
        if (m.borderLeft !== 0 || m.borderTop !== 0 || m.borderRight !== 1 || m.borderBottom !== 1) {
          fail(`${where} borders l${m.borderLeft} t${m.borderTop} r${m.borderRight} b${m.borderBottom}`);
        }
        if (
          !near(m.paddingLeft, PAD_X * z) ||
          !near(m.paddingRight, PAD_X * z) ||
          !near(m.paddingTop, PAD_Y * z) ||
          !near(m.paddingBottom, PAD_Y * z)
        ) {
          fail(`${where} padding ${m.paddingTop}/${m.paddingRight}/${m.paddingBottom}/${m.paddingLeft}`);
        }
        const contentLeft = m.left + m.paddingLeft;
        const contentRight = m.right - m.borderRight - m.paddingRight;
        const contentTop = m.top + m.paddingTop;
        const contentBottom = m.bottom - m.borderBottom - m.paddingBottom;
        if (!near(m.lineHeight, contentBottom - contentTop)) {
          fail(`${where} line-height ${m.lineHeight} != content height ${contentBottom - contentTop}`);
        }
        const t = m.textBox;
        if (!t) continue;
        const rightAligned = (col === 3 || col === 4) && row > 0;
        if (t.left < contentLeft - 0.5) {
          fail(`${where} text starts at ${t.left}, left of the content box (${contentLeft})`);
        }
        if (!m.overflowing && t.right > contentRight + 0.5) {
          fail(`${where} text ends at ${t.right}, right of the content box (${contentRight})`);
        }
        if (rightAligned && !m.overflowing && !near(t.right, contentRight, 0.5)) {
          fail(`${where} right-aligned text ends at ${t.right}, expected ${contentRight}`);
        }
        if (!rightAligned && !near(t.left, contentLeft, 0.5)) {
          fail(`${where} text starts at ${t.left}, expected ${contentLeft}`);
        }
        // Vertically centered in the line box, and clear of the grid line.
        const center = (t.top + t.bottom) / 2;
        if (Math.abs(center - (contentTop + contentBottom) / 2) > 1.5 * z + 0.5) {
          fail(
            `${where} text center ${center} is off the content center ${(contentTop + contentBottom) / 2}`,
          );
        }
        if (t.bottom > m.bottom - m.borderBottom + 0.5) {
          fail(`${where} text bottom ${t.bottom} crosses the grid line (${m.bottom - m.borderBottom})`);
        }
      }
    }

    // --- An edited and an error cell render where a normal one would --------
    const edited = await measureCell(page, 2, 1);
    if (!edited?.classes.includes('edited')) fail(`${at} the edited cell (2,1) lost its "edited" state`);
    const error = await measureCell(page, 1, 7);
    if (!error?.classes.includes('cell-error'))
      fail(`${at} the error cell (1,7) lost its "cell-error" state`);

    // --- Selection: clicking the logical center selects that exact cell -----
    const pick = { row: 2, col: 2 };
    const before = await measureCell(page, pick.row, pick.col);
    await page.mouse.click(
      canvas.left + headW + pick.col * colW + colW / 2,
      canvas.top + rowH + pick.row * rowH + rowH / 2,
    );
    const selected = await measureCell(page, pick.row, pick.col);
    if (!selected?.classes.includes('selected')) {
      fail(`${at} clicking the center of cell (${pick.row},${pick.col}) did not select it`);
    } else if (
      !near(selected.textBox.left, before.textBox.left) ||
      !near(selected.textBox.top, before.textBox.top) ||
      !near(selected.width, before.width)
    ) {
      fail(`${at} selecting cell (${pick.row},${pick.col}) moved its text or box`);
    }

    // --- Editing: the editor's text origin matches the cell's ---------------
    const cellOrigin = await textOrigin(
      page,
      `.vgrid-rows .vcell[data-row="${pick.row}"][data-col="${pick.col}"]`,
    );
    await page.keyboard.press('F2');
    const editorOrigin = await textOrigin(page, '.grid-sink.cell-editor');
    if (!editorOrigin) {
      fail(`${at} F2 did not open the cell editor`);
    } else {
      // At 50% the cell's 1.5px top padding is narrower than the editor's
      // 2px border, so the editor can only start its text 0.5px lower.
      const tolerance = level < 75 ? 0.5 : 0.01;
      if (!near(editorOrigin.x, cellOrigin.x, tolerance) || !near(editorOrigin.y, cellOrigin.y, tolerance)) {
        fail(
          `${at} editor text origin (${editorOrigin.x},${editorOrigin.y}) != cell (${cellOrigin.x},${cellOrigin.y})`,
        );
      }
      if (
        !near(editorOrigin.lineHeight, cellOrigin.lineHeight) ||
        !near(editorOrigin.fontSize, cellOrigin.fontSize)
      ) {
        fail(`${at} editor line box/font differs from the cell's`);
      }
    }
    await page.keyboard.press('Escape');

    // --- IME: a composition starts in place and commits in place ------------
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'まっちゃ', selectionStart: 4, selectionEnd: 4 });
    const composing = await textOrigin(page, '.grid-sink.cell-editor');
    if (!composing) {
      fail(`${at} an IME composition did not open the cell editor`);
    } else if (!near(composing.x, editorOrigin?.x ?? NaN) || !near(composing.y, editorOrigin?.y ?? NaN)) {
      fail(`${at} the IME composition starts at (${composing.x},${composing.y}), not the editor text origin`);
    }
    await cdp.send('Input.insertText', { text: '抹茶' });
    const committed = await textOrigin(page, '.grid-sink.cell-editor');
    if (composing && committed && (!near(committed.x, composing.x) || !near(committed.y, composing.y))) {
      fail(`${at} committing the IME composition moved the text origin`);
    }
    await page.keyboard.press('Escape');
    await cdp.detach();

    if (screenshotDir) {
      const clip = await page.evaluate(() => {
        const r = document.querySelector('.grid-container').getBoundingClientRect();
        return { x: r.left, y: r.top, width: Math.min(r.width, 1000), height: Math.min(r.height, 260) };
      });
      await page.screenshot({ path: join(screenshotDir, `grid-${level}.png`), clip });
    }

    // --- Far down and right: no accumulated drift, hit tests agree ----------
    const far = { row: 2400, col: 50 };
    await scrollGridTo(page, far.col * colW - colW, far.row * rowH - 4 * rowH);
    const farCanvas = await page.evaluate(() => {
      const r = document.querySelector('.vgrid-canvas').getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    const farCell = await measureCell(page, far.row, far.col);
    const expectLeft = farCanvas.left + headW + far.col * colW;
    const expectTop = farCanvas.top + rowH + far.row * rowH;
    if (!farCell) {
      fail(`${at} cell (${far.row},${far.col}) is not rendered after scrolling to it`);
    } else if (!near(farCell.left, expectLeft) || !near(farCell.top, expectTop)) {
      fail(
        `${at} cell (${far.row},${far.col}) sits at (${farCell.left},${farCell.top}), expected (${expectLeft},${expectTop})`,
      );
    } else {
      const hit = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y)?.closest('.vcell');
          return el ? [el.getAttribute('data-row'), el.getAttribute('data-col')] : null;
        },
        { x: expectLeft + colW / 2, y: expectTop + rowH / 2 },
      );
      if (!hit || hit[0] !== String(far.row) || hit[1] !== String(far.col)) {
        fail(`${at} hit test at the logical center of (${far.row},${far.col}) found ${hit}`);
      }
    }
    await scrollGridTo(page, 0, 0);
  }

  await setZoom(page, 100);
  return errors;
}
