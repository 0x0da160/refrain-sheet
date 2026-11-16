// SPDX-License-Identifier: MIT
// Real-operation benchmark of the million-row demo workbook, in a browser.
//
//   npm run build
//   npm run bench:million-rows:generate -- --rows 1000000
//   npm run bench:million-rows -- --rows 1000000 [--dist dist] [--label after] [--out result.json]
//
// It opens the built application from disk (file://, the way a user does) in
// Chromium, drives it with real key presses and clicks, and times each step
// from the triggering input event to the first frame that shows the correct
// content:
//
//   1. open the workbook and become interactive
//   2. move to the top, the middle and the end of the detail sheet
//   3. search the whole sheet, filter the whole sheet
//   4. change the summary conditions
//   5. edit a detail row and see the summary follow
//   6. undo and redo that edit
//   7. save, reopen the saved file, and check its content and results
//
// "Correct" is decided by ./million-rows-data.mjs, which recomputes every
// expected value with plain arithmetic — never by the application under test.
// A step that times out, crashes the page, or shows a wrong value is recorded
// as failed with what happened; nothing is skipped silently and no fixed wait
// counts as a result.
//
// What is and is not measured (also in knowledge/operations/million-row-demo.md):
//   - Time: wall clock in the page (`performance.now()`), from the input event
//     to the animation frame in which the expected content is in the document.
//     The resolution is one frame (about 17 ms).
//   - Main-thread blocking: the browser's own "long task" entries (tasks over
//     50 ms) that overlap the step.
//   - Memory: the JavaScript heap in use after the step, and the renderer
//     process's resident memory with its peak during the step (Linux /proc;
//     reported as unavailable elsewhere).
//   - The File System Access pickers are removed before the page loads, so the
//     application takes its own fallback paths: a file input for Open and a
//     download for Save. That is the only way an automated run can pass a
//     file in and out; the encode and decode work is the same either way.

/* The page.evaluate() callbacks below run in the browser, not in Node. */
/* global document, performance, PerformanceObserver, requestAnimationFrame, window */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  aggregate,
  buildRows,
  CATEGORIES,
  DEFAULT_SEED,
  DEPARTMENTS,
  FIRST_DAY,
  FULL_ROWS,
  LAST_DAY,
  monthStarts,
  SHEET_DETAIL,
  SHEET_SUMMARY,
  SUMMARY,
} from './million-rows-data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readArgs(argv) {
  const args = { rows: FULL_ROWS, seed: DEFAULT_SEED, dist: 'dist', label: 'run', out: null, file: null };
  args.timeoutMin = 15;
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args)) throw new Error(`unknown option ${argv[i]}`);
    args[key] = ['rows', 'seed', 'timeoutMin'].includes(key) ? Number(argv[i + 1]) : argv[i + 1];
  }
  args.dist = resolve(root, args.dist);
  args.file = resolve(args.file ?? join(root, 'bench', 'data', `sales-analysis-${args.rows}.rsf`));
  args.out = resolve(args.out ?? join(root, 'bench', 'data', `result-${args.label}-${args.rows}.json`));
  return args;
}

const args = readArgs(process.argv.slice(2));
const STEP_TIMEOUT = args.timeoutMin * 60_000;
for (const path of [join(args.dist, 'index.html'), args.file]) {
  if (!existsSync(path)) {
    console.error(
      `million-rows-browser: ${path} does not exist (build the app and generate the workbook first)`,
    );
    process.exit(1);
  }
}

const data = buildRows(args.rows, args.seed);
const pad = (n, width) => String(n).padStart(width, '0');
const ref = (a1) => [Number(a1.slice(1)) - 1, a1.charCodeAt(0) - 65];

/** What the detail sheet must display for data row `i`, as [row, col, text] triples. */
function detailCells(i, overrides = new Map()) {
  const qty = overrides.get(i) ?? data.qty[i];
  const product = data.products[data.product[i]];
  const texts = [
    data.days[data.day[i]],
    `SL-${pad(i + 1, 7)}`,
    product.code,
    DEPARTMENTS[data.dept[i]].name,
    String(qty),
    String(data.price[i]),
    String(qty * data.price[i]),
    CATEGORIES[product.category].name,
  ];
  return texts.map((text, col) => [i + 1, col, text]);
}

/** What the summary sheet must display: the result of every one of its formulas. */
function summaryCells(conditions, overrides = new Map()) {
  const cells = [];
  const put = (a1, value) => cells.push([...ref(a1), String(value)]);
  const total = aggregate(data, conditions, overrides);
  put(SUMMARY.sales, total.sales);
  put(SUMMARY.count, total.count);
  put(SUMMARY.average, total.count === 0 ? 0 : total.sales / total.count);
  put(SUMMARY.quantity, total.quantity);
  // The product lookup (the first product, as generated) follows the period only.
  const product = data.products[0];
  const sold = aggregate(
    data,
    { from: conditions.from, to: conditions.to, product: product.code },
    overrides,
  );
  put(SUMMARY.productName, product.name);
  put(SUMMARY.productCategory, CATEGORIES[product.category].name);
  put(SUMMARY.productPrice, product.price);
  put(SUMMARY.productSales, sold.sales);
  put(SUMMARY.productCount, sold.count);
  DEPARTMENTS.forEach((dept, i) => {
    const got = aggregate(data, { ...conditions, dept: dept.name }, overrides);
    put(`B${SUMMARY.deptFirstRow + i}`, got.sales);
    put(`C${SUMMARY.deptFirstRow + i}`, got.count);
  });
  CATEGORIES.forEach((category, i) => {
    const got = aggregate(data, { ...conditions, category: category.name }, overrides);
    put(`B${SUMMARY.categoryFirstRow + i}`, got.sales);
    put(`C${SUMMARY.categoryFirstRow + i}`, got.count);
  });
  // The month table ignores the period conditions: each row is its own month.
  const months = monthStarts();
  const { dept, category } = conditions;
  for (let i = 0; i + 1 < months.length; i++) {
    const got = aggregate(data, { dept, category, from: months[i], before: months[i + 1] }, overrides);
    put(`B${SUMMARY.monthFirstRow + i}`, got.sales);
    put(`C${SUMMARY.monthFirstRow + i}`, got.count);
  }
  return cells;
}

// ----- The page side: long tasks, and waiting for expected content -----

/** Installed before the application's own scripts run. */
function pageInit() {
  // No native pickers: Open uses a file input, Save a download (see the header).
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  window.__mr = { longTasks: [], watch: null, observer: null };
  try {
    window.__mr.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__mr.longTasks.push([entry.startTime, entry.duration]);
      }
    });
    window.__mr.observer.observe({ type: 'longtask', buffered: true });
  } catch {
    window.__mr.longTasks = null; // long tasks are not reported by this browser
  }
}

/**
 * Arm a watch: the clock starts at the next input event and stops at the first
 * animation frame in which every expected condition holds.
 */
function pageArm(spec) {
  const cellText = (row, col) =>
    document.querySelector(`:is(.vgrid-rows, .vgrid-sticky) .vcell[data-row="${row}"][data-col="${col}"]`)
      ?.textContent ?? null;
  const textsOf = (selector) =>
    [...document.querySelectorAll(selector)].map((node) => node.textContent ?? '');
  const unmet = () => {
    for (const [row, col, text] of spec.cells ?? []) {
      const got = cellText(row, col);
      if (got !== text) {
        return `cell r${row + 1}c${col + 1} shows ${JSON.stringify(got)}, expected ${JSON.stringify(text)}`;
      }
    }
    for (const want of spec.texts ?? []) {
      const got = textsOf(want.selector);
      if (want.absent) {
        if (got.length > 0) return `${want.selector} is still present`;
      } else if (want.equals !== undefined) {
        if (!got.includes(want.equals)) {
          return `${want.selector} shows ${JSON.stringify(got)}, expected ${JSON.stringify(want.equals)}`;
        }
      } else if (want.includes !== undefined) {
        if (!got.some((text) => want.includes.some((part) => text.includes(part)))) {
          return `${want.selector} shows ${JSON.stringify(got)}, expected text with ${want.includes.join(' / ')}`;
        }
      } else if (!got.some((text) => text !== '')) {
        return `${want.selector} is empty`;
      }
    }
    return null;
  };
  const watch = { t0: null, t1: null, last: 'not checked yet', done: null, seen: null };
  const start = () => {
    if (watch.t0 === null) watch.t0 = performance.now();
  };
  const events = spec.startOn ?? ['keydown', 'pointerdown', 'mousedown', 'input', 'change'];
  for (const type of events) window.addEventListener(type, start, { capture: true, once: true });
  watch.done = new Promise((resolveDone) => {
    const tick = () => {
      if (watch.t0 !== null) {
        if (spec.observe && watch.seen === null) {
          // What this element first showed, and when — reported even when it
          // is not what the step expects, so a wrong result still has a time.
          const shown = textsOf(spec.observe).find((text) => text !== '');
          if (shown !== undefined) {
            watch.seen = { ms: performance.now() - watch.t0, text: shown };
          }
        }
        watch.last = unmet();
        // `observeIsFinal`: that element appears only once the operation has
        // finished, so a result still wrong five seconds later will not change.
        const final =
          spec.observeIsFinal && watch.seen && performance.now() - watch.t0 - watch.seen.ms > 5000;
        if (watch.last === null || final) {
          watch.t1 = performance.now();
          for (const type of events) window.removeEventListener(type, start, { capture: true });
          resolveDone();
          return;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  window.__mr.watch = watch;
}

/** Wait for the armed watch, or give up after `timeout` ms and say what was still wrong. */
async function pageWait(timeout) {
  const watch = window.__mr.watch;
  let timer;
  const expired = new Promise((resolveExpired) => {
    timer = window.setTimeout(() => resolveExpired('timeout'), timeout);
  });
  const outcome = await Promise.race([watch.done.then(() => 'ok'), expired]);
  window.clearTimeout(timer);
  const t1 = watch.t1 ?? performance.now();
  // The task that produced the awaited frame may not have been reported yet:
  // give the browser a moment (after the clock stopped) and collect what the
  // observer still holds.
  await new Promise((resolveSoon) => window.setTimeout(resolveSoon, 100));
  for (const entry of window.__mr.observer?.takeRecords() ?? []) {
    window.__mr.longTasks.push([entry.startTime, entry.duration]);
  }
  const tasks = (window.__mr.longTasks ?? []).filter(([s, d]) => s + d > (watch.t0 ?? t1) && s < t1);
  const ok = outcome === 'ok' && watch.last === null;
  return {
    ok,
    // A step that finished with the wrong result is timed to when that result appeared.
    ms: watch.t0 === null ? null : ok || !watch.seen ? t1 - watch.t0 : watch.seen.ms,
    problem: ok ? null : (watch.last ?? 'the triggering input never arrived'),
    longTasks: window.__mr.longTasks === null ? null : tasks,
    heap: performance.memory ? performance.memory.usedJSHeapSize : null,
    seen: watch.seen,
  };
}

// ----- The Node side -----

const results = { steps: [] };
let browser;
let browserCdp;

/** Resident and peak memory (MiB) of the renderer showing the app, from /proc; null where unavailable. */
async function rendererMemory(reset = false) {
  try {
    const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
    let best = null;
    for (const proc of processInfo) {
      if (proc.type !== 'renderer') continue;
      const status = readFileSync(`/proc/${proc.id}/status`, 'utf8');
      const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
      const peak = Number(/VmHWM:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
      if (!best || rss > best.rss) best = { id: proc.id, rss, peak };
    }
    if (best && reset) {
      // Start the next step's peak from here.
      try {
        writeFileSync(`/proc/${best.id}/clear_refs`, '5');
      } catch {
        // Not permitted: the peak then stays cumulative, which the report says.
        results.peakIsCumulative = true;
      }
    }
    return best;
  } catch {
    return null;
  }
}

const mib = (bytes) => (bytes === null || bytes === undefined ? null : Math.round(bytes / 1048576));

/**
 * One timed step: arm the watch, run `trigger` (real input), wait for the
 * expected content. `scope` says whether the application had to process every
 * row ("all") or only what is on screen ("view").
 */
async function step(page, name, scope, spec, trigger) {
  const entry = { name, scope, ok: false };
  results.steps.push(entry);
  try {
    await rendererMemory(true);
    await page.evaluate(pageArm, spec);
    await trigger();
    const got = await page.evaluate(pageWait, STEP_TIMEOUT);
    const memory = await rendererMemory();
    entry.ok = got.ok;
    entry.ms = got.ms === null ? null : Math.round(got.ms);
    if (got.problem) entry.problem = got.problem;
    if (got.seen) entry.firstShown = { ms: Math.round(got.seen.ms), text: got.seen.text };
    if (got.longTasks) {
      entry.longTasks = got.longTasks.length;
      entry.longestTaskMs = Math.round(Math.max(0, ...got.longTasks.map(([, d]) => d)));
      entry.blockedMs = Math.round(got.longTasks.reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0));
    }
    entry.heapMiB = mib(got.heap);
    entry.rssMiB = memory ? Math.round(memory.rss) : null;
    entry.peakRssMiB = memory ? Math.round(memory.peak) : null;
  } catch (err) {
    entry.problem = `failed: ${String(err?.message ?? err).split('\n')[0]}`;
  }
  const time = entry.ms === null || entry.ms === undefined ? 'n/a' : `${entry.ms} ms`;
  console.warn(
    `  ${entry.ok ? 'ok  ' : 'FAIL'} ${name}: ${time}` +
      (entry.longestTaskMs !== undefined ? `, longest task ${entry.longestTaskMs} ms` : '') +
      (entry.heapMiB !== null && entry.heapMiB !== undefined ? `, heap ${entry.heapMiB} MiB` : '') +
      (entry.peakRssMiB ? `, peak RSS ${entry.peakRssMiB} MiB` : '') +
      (entry.problem ? ` — ${entry.problem}` : '') +
      (entry.firstShown && !entry.ok
        ? ` (first showed ${JSON.stringify(entry.firstShown.text)} after ${entry.firstShown.ms} ms)`
        : ''),
  );
  return entry.ok;
}

async function newAppPage() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1700 }, locale: 'ja-JP' });
  await context.addInitScript(pageInit);
  const page = await context.newPage();
  // A click on a page that is busy for half a minute is still a click: every
  // action waits as long as a step may take, not Playwright's 30 seconds.
  page.setDefaultTimeout(STEP_TIMEOUT);
  page.on('pageerror', (error) => (results.pageErrors ??= []).push(error.message));
  page.on('crash', () => (results.crashed = true));
  const started = performance.now();
  await page.goto(pathToFileURL(join(args.dist, 'index.html')).href);
  await page.waitForSelector('.menu-bar', { timeout: 60_000 });
  const startupMs = Math.round(performance.now() - started);
  return { page, startupMs };
}

/** Ask the application to open `file` (File > Open, answered through its file input). */
async function chooseFile(page, file) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const chooser = page.waitForEvent('filechooser', { timeout: 1500 }).catch(() => null);
    await page.keyboard.press('Control+o');
    const got = await chooser;
    if (got) {
      await got.setFiles(file);
      return;
    }
  }
  throw new Error('File > Open never asked for a file');
}

/** Open Go to Cell with `a1` typed in; the caller's Enter makes the move. */
async function goTo(page, a1) {
  await page.keyboard.press('Control+g');
  await page.fill('.move-target-input', a1);
}

async function clickSheet(page, name) {
  await page.locator('.sheet-strip [role=tab]', { hasText: name }).first().click();
}

/** Type a value into the selected cell, up to (not including) the committing Enter. */
async function typeValue(page, a1, value) {
  await goTo(page, a1);
  await page.keyboard.press('Enter');
  await page.waitForFunction((want) => document.querySelector('.cell-ref')?.textContent === want, a1);
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+a');
  await page.keyboard.type(value);
}

/**
 * A file opened from disk starts protected. Unlock it once, with the switch in
 * the status bar, so filters and edits are timed without the prompt.
 */
async function unlock(page) {
  await page.click('.status-protect-on');
  await page.waitForSelector('.status-protect-edit', { timeout: STEP_TIMEOUT });
  await page.click('.vgrid-rows .vcell[data-row="1"][data-col="0"]');
}

function distSize(dir) {
  let bytes = 0;
  const walk = (path) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else bytes += statSync(full).size;
    }
  };
  walk(dir);
  return bytes;
}

async function run() {
  const last = args.rows - 1;
  const middle = Math.floor(args.rows / 2);
  const findCount = (matches, cells) => `${matches} 件が ${cells} セルに一致`;

  let { page, startupMs } = await newAppPage();
  results.startupMs = startupMs;
  console.warn(`million-rows-browser: ${args.label}, ${args.rows} rows, startup ${startupMs} ms`);

  // 1. Open, and accept input.
  // The clock starts when the file reaches the application (its input's change event).
  let ok = await step(
    page,
    'open: first rows on screen',
    'all',
    { cells: detailCells(0), startOn: ['change'] },
    () => chooseFile(page, args.file),
  );
  if (!ok) return;
  await step(
    page,
    'open: accepts a key press',
    'view',
    { texts: [{ selector: '.cell-ref', equals: 'A2' }] },
    () => page.keyboard.press('ArrowDown'),
  );
  await unlock(page);

  // 2. Move around the detail sheet.
  await step(page, 'move: to the last row', 'view', { cells: detailCells(last) }, () =>
    page.keyboard.press('Control+End'),
  );
  await goTo(page, `A${middle + 2}`);
  await step(page, 'move: to the middle row', 'view', { cells: detailCells(middle) }, () =>
    page.keyboard.press('Enter'),
  );
  // Ctrl+Home selects A1, which the pinned header row already shows, so the
  // grid scrolls back only with the step down to the first data row.
  await step(page, 'move: back to the first row', 'view', { cells: detailCells(0) }, async () => {
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
  });

  // 3. Search every cell of the detail sheet (the cell inputs).
  const settled = { texts: [{ selector: '.find-count, .find-error' }] };
  await page.keyboard.press('Control+f');
  await page.waitForSelector('.find-input');
  const lastSlip = `SL-${pad(args.rows, 7)}`;
  await step(page, 'search: one slip number (1 match)', 'all', settled, () =>
    page.fill('.find-input', lastSlip),
  );
  const found = await page.evaluate(() => ({
    count: document.querySelector('.find-count')?.textContent ?? '',
    error: document.querySelector('.find-error')?.textContent ?? '',
  }));
  const searchStep = results.steps[results.steps.length - 1];
  if (found.error !== '' || found.count !== findCount(1, 1)) {
    searchStep.ok = false;
    searchStep.problem = found.error !== '' ? `stopped early: ${found.error}` : `reported ${found.count}`;
    console.warn(`  FAIL search result: ${searchStep.problem}`);
  }
  const dept = DEPARTMENTS[3].name;
  const deptRows = aggregate(data, { dept }).count;
  await page.fill('.find-input', '');
  await page.waitForFunction(() => (document.querySelector('.find-count')?.textContent ?? '') === '');
  await step(page, `search: a department name (${deptRows} matches)`, 'all', settled, () =>
    page.fill('.find-input', dept),
  );
  const foundDept = await page.evaluate(() => ({
    count: document.querySelector('.find-count')?.textContent ?? '',
    error: document.querySelector('.find-error')?.textContent ?? '',
  }));
  const deptStep = results.steps[results.steps.length - 1];
  if (foundDept.error !== '' || foundDept.count !== findCount(deptRows, deptRows)) {
    deptStep.ok = false;
    deptStep.problem =
      foundDept.error !== '' ? `stopped early: ${foundDept.error}` : `reported ${foundDept.count}`;
    console.warn(`  FAIL search result: ${deptStep.problem}`);
  }
  await page.keyboard.press('Escape');

  // 4. Filter every row of the detail sheet by department.
  await goTo(page, 'D2');
  await page.keyboard.press('Enter');
  const filterButton = page.locator('.app-toolbar-button[data-command="sheet.filter"]');
  const applyButton = page.getByRole('button', { name: /^(Apply Filter|フィルターを適用)$/ });
  await step(
    page,
    'filter: open the panel (lists the column values)',
    'all',
    { texts: [{ selector: '.side-panel .form-lead', includes: ['A1:H'] }] },
    () => filterButton.click(),
  );
  await applyButton.waitFor({ timeout: STEP_TIMEOUT });
  const panel = page.locator('.side-panel', { has: applyButton });
  await panel.locator('select').first().selectOption('equals');
  await panel.locator('input[type=text]').first().fill(dept);
  const firstMatches = [];
  for (let i = 0; i < args.rows && firstMatches.length < 3; i++) {
    if (data.dept[i] === 3) firstMatches.push(i);
  }
  await step(
    page,
    `filter: apply department = ${dept}`,
    'all',
    {
      texts: [{ selector: '.status-filter', equals: `フィルター中: ${args.rows} 行中 ${deptRows} 行` }],
      cells: firstMatches.flatMap((i) => detailCells(i)),
      observe: '.status-filter',
      observeIsFinal: true,
    },
    () => applyButton.click(),
  );
  await filterButton.click();
  const clearButton = page.getByRole('button', { name: /^(Clear All Filters|すべてのフィルターを解除)$/ });
  await clearButton.waitFor({ timeout: STEP_TIMEOUT });
  await step(
    page,
    'filter: clear',
    'all',
    { texts: [{ selector: '.status-filter', absent: true }], cells: detailCells(0) },
    () => clearButton.click(),
  );
  await page.keyboard.press('Escape');

  // 5. The summary: first display, then changed conditions.
  let conditions = { from: FIRST_DAY, to: LAST_DAY };
  ok = await step(
    page,
    'summary: first display of all results',
    'all',
    { cells: summaryCells(conditions) },
    () => clickSheet(page, SHEET_SUMMARY),
  );
  if (!ok) return;
  const change = async (label, a1, value, next) => {
    conditions = next;
    await typeValue(page, a1, value);
    return step(page, `summary: ${label}`, 'all', { cells: summaryCells(conditions) }, () =>
      page.keyboard.press('Enter'),
    );
  };
  const dept2 = DEPARTMENTS[1].name;
  const category = CATEGORIES[1].name;
  await change(`department = ${dept2}`, SUMMARY.dept, dept2, { ...conditions, dept: dept2 });
  await change('start date = 2025-04-01', SUMMARY.from, '2025-04-01', { ...conditions, from: '2025-04-01' });
  await change('end date = 2025-09-30', SUMMARY.to, '2025-09-30', { ...conditions, to: '2025-09-30' });
  ok = await change(`category = ${category}`, SUMMARY.category, category, { ...conditions, category });
  if (!ok) return;

  // 6. Edit a detail row inside those conditions; its own result and the summary follow.
  let target = -1;
  let seen = 0;
  const wanted = Math.floor(aggregate(data, conditions).count / 2);
  for (let i = 0; i < args.rows && target < 0; i++) {
    const hit =
      data.days[data.day[i]] >= conditions.from &&
      data.days[data.day[i]] <= conditions.to &&
      DEPARTMENTS[data.dept[i]].name === dept2 &&
      CATEGORIES[data.products[data.product[i]].category].name === category;
    if (hit && seen++ === wanted) target = i;
  }
  const overrides = new Map([[target, data.qty[target] + 5]]);
  await clickSheet(page, SHEET_DETAIL);
  await typeValue(page, `E${target + 2}`, String(data.qty[target] + 5));
  await step(
    page,
    'edit: quantity of one row, its own sales updates',
    'view',
    { cells: detailCells(target, overrides) },
    () => page.keyboard.press('Enter'),
  );
  await step(
    page,
    'edit: summary shows the new totals',
    'all',
    { cells: summaryCells(conditions, overrides) },
    () => clickSheet(page, SHEET_SUMMARY),
  );

  // 7. Undo and redo that edit.
  const showTarget = async () => {
    await clickSheet(page, SHEET_DETAIL);
    await goTo(page, `A${target + 2}`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (row) => document.querySelector(`.vgrid-rows .vcell[data-row="${row}"][data-col="0"]`) !== null,
      target + 1,
      { timeout: STEP_TIMEOUT },
    );
  };
  await showTarget();
  await step(page, 'undo: the row is back', 'view', { cells: detailCells(target) }, () =>
    page.keyboard.press('Control+z'),
  );
  await step(page, 'undo: summary shows the earlier totals', 'all', { cells: summaryCells(conditions) }, () =>
    clickSheet(page, SHEET_SUMMARY),
  );
  await showTarget();
  await step(page, 'redo: the row is edited again', 'view', { cells: detailCells(target, overrides) }, () =>
    page.keyboard.press('Control+y'),
  );
  await step(
    page,
    'redo: summary shows the new totals',
    'all',
    { cells: summaryCells(conditions, overrides) },
    () => clickSheet(page, SHEET_SUMMARY),
  );

  // 8. Save (a download), then reopen the saved file in a fresh page.
  const saved = join(dirname(args.out), `saved-${args.label}-${args.rows}.rsf`);
  const download = page.waitForEvent('download', { timeout: STEP_TIMEOUT }).catch(() => null);
  ok = await step(
    page,
    'save: file handed to the browser',
    'all',
    { texts: [{ selector: '.toast', includes: ['ダウンロード', 'ownload'] }] },
    () => page.keyboard.press('Control+s'),
  );
  const got = await download;
  if (!ok || !got) {
    results.steps[results.steps.length - 1].ok = false;
    results.steps[results.steps.length - 1].problem ??= 'no file was produced';
    return;
  }
  await got.saveAs(saved);
  results.savedBytes = statSync(saved).size;
  await page.context().close();

  ({ page } = await newAppPage());
  ok = await step(
    page,
    'reopen: saved file, summary results on screen',
    'all',
    { cells: summaryCells(conditions, overrides), startOn: ['change'] },
    () => chooseFile(page, saved),
  );
  if (!ok) return;
  await step(
    page,
    'reopen: the edited row is as saved',
    'view',
    { cells: detailCells(target, overrides) },
    async () => {
      await clickSheet(page, SHEET_DETAIL);
      await goTo(page, `A${target + 2}`);
      await page.keyboard.press('Enter');
    },
  );
}

browser = await chromium.launch({
  executablePath: process.env.MILLION_ROWS_CHROMIUM || undefined,
  args: ['--enable-precise-memory-info'],
});
browserCdp = await browser.newBrowserCDPSession();
results.label = args.label;
results.rows = args.rows;
results.seed = args.seed;
results.browser = browser.version();
results.distBytes = distSize(args.dist);
results.inputBytes = statSync(args.file).size;
try {
  await run();
} catch (err) {
  results.aborted = String(err?.message ?? err).split('\n')[0];
  console.warn(`million-rows-browser: stopped: ${results.aborted}`);
} finally {
  await browser.close().catch(() => {});
}
results.completed = results.steps.every((entry) => entry.ok) && !results.aborted;
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, JSON.stringify(results, null, 2) + '\n');
console.warn(
  `million-rows-browser: ${results.completed ? 'every step passed' : 'NOT every step passed'}; wrote ${args.out}`,
);
process.exit(results.completed ? 0 : 1);
