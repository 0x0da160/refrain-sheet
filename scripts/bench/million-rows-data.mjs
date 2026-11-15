// SPDX-License-Identifier: MIT
// Deterministic data for the million-row sales-analysis demo workbook.
//
// Everything here is a pure function of (rows, seed): no clock, no
// Math.random, no locale. `scripts/bench/generate-million-rows.mjs` writes the
// workbook from it, and `scripts/bench/million-rows-browser.mjs` recomputes the
// expected totals from it — in plain arithmetic, never through the app's
// formula engine — so a benchmark run can tell a correct result from a fast
// wrong one.
//
// The layout, value distributions and formula counts are documented in
// knowledge/operations/million-row-demo.md.

/** Data rows of the full-size demo (the header row is counted separately). */
export const FULL_ROWS = 1_000_000;
/** The seed every published measurement uses. */
export const DEFAULT_SEED = 20261115;

export const SHEET_DETAIL = '売上明細';
export const SHEET_MASTER = '商品マスター';
export const SHEET_SUMMARY = '集計';

export const DETAIL_HEADER = ['日付', '伝票番号', '商品コード', '部門', '数量', '単価', '売上', 'カテゴリ'];
export const MASTER_HEADER = ['商品コード', '商品名', 'カテゴリ', '標準単価'];

/** Departments and their share of the rows (weights, not percentages). */
export const DEPARTMENTS = [
  { name: '東京営業部', weight: 24 },
  { name: '大阪営業部', weight: 18 },
  { name: '名古屋営業部', weight: 12 },
  { name: '福岡営業部', weight: 9 },
  { name: '札幌営業部', weight: 7 },
  { name: '仙台営業部', weight: 6 },
  { name: '広島営業部', weight: 5 },
  { name: 'オンライン販売部', weight: 19 },
];

/** Categories with the list-price range (yen) their products are drawn from. */
export const CATEGORIES = [
  { name: '文具', min: 120, max: 2800 },
  { name: '家電', min: 3980, max: 49800 },
  { name: '食品', min: 198, max: 3200 },
  { name: '飲料', min: 98, max: 1980 },
  { name: '日用品', min: 148, max: 4800 },
  { name: '衣料', min: 980, max: 12800 },
  { name: '書籍', min: 550, max: 4400 },
  { name: '玩具', min: 480, max: 9800 },
  { name: '家具', min: 4980, max: 49800 },
  { name: 'スポーツ用品', min: 780, max: 29800 },
];

const SERIES = ['スタンダード', 'プレミアム', 'ライト', 'プロ', 'エコ', 'クラシック', 'ネオ', 'セレクト'];

export const PRODUCT_COUNT = 500;
/** First and last day of the two fiscal years the rows cover (inclusive). */
export const FIRST_DAY = '2024-04-01';
export const LAST_DAY = '2026-03-31';
const DAY_COUNT = 730;

/** Unit price as a share of the list price, with how often each applies. */
const DISCOUNTS = [
  { rate: 1, upTo: 0.7 },
  { rate: 0.95, upTo: 0.85 },
  { rate: 0.9, upTo: 0.95 },
  { rate: 0.8, upTo: 1 },
];

/** Relative sales volume by weekday (Sunday first) and by calendar month (January first). */
const WEEKDAY_FACTOR = [0.35, 1, 1, 1, 1, 1.05, 0.55];
const MONTH_FACTOR = [0.9, 0.85, 1.35, 1, 0.95, 1, 1.05, 0.8, 1.1, 1, 1.05, 1.3];
/** The second fiscal year sells this much more than the first. */
const SECOND_YEAR_GROWTH = 1.12;

/** mulberry32: a small, well-known 32-bit generator; identical on every engine. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, width) => String(n).padStart(width, '0');

/** The ISO dates of every covered day, oldest first. */
export function dayList() {
  const out = [];
  const start = Date.UTC(2024, 3, 1);
  for (let d = 0; d < DAY_COUNT; d++) {
    const date = new Date(start + d * 86_400_000);
    out.push(`${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`);
  }
  return out;
}

/** The first day of each covered month plus the day after the last one (25 entries). */
export function monthStarts() {
  const out = [];
  for (let m = 0; m <= 24; m++) {
    const year = 2024 + Math.floor((3 + m) / 12);
    out.push(`${year}-${pad(((3 + m) % 12) + 1, 2)}-01`);
  }
  return out;
}

/** The product master: code, name, category index and list price of each product. */
export function buildProducts(seed = DEFAULT_SEED) {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const products = [];
  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const category = Math.floor(rand() * CATEGORIES.length);
    const { name, min, max } = CATEGORIES[category];
    const series = SERIES[Math.floor(rand() * SERIES.length)];
    const price = Math.round((min + rand() * (max - min)) / 10) * 10;
    products.push({
      code: `P${pad(i + 1, 4)}`,
      name: `${name}・${series} ${String.fromCharCode(65 + (i % 26))}${pad(100 + ((i * 37) % 900), 3)}`,
      category,
      price,
    });
  }
  return products;
}

/** Cumulative share of the rows that fall on or before each day (last entry 1). */
function dayQuantiles() {
  const start = Date.UTC(2024, 3, 1);
  const weights = [];
  let total = 0;
  for (let d = 0; d < DAY_COUNT; d++) {
    const date = new Date(start + d * 86_400_000);
    const w =
      WEEKDAY_FACTOR[date.getUTCDay()] *
      MONTH_FACTOR[date.getUTCMonth()] *
      (d >= 365 ? SECOND_YEAR_GROWTH : 1);
    weights.push(w);
    total += w;
  }
  const cumulative = [];
  let running = 0;
  for (const w of weights) {
    running += w;
    cumulative.push(running / total);
  }
  cumulative[DAY_COUNT - 1] = 1;
  return cumulative;
}

/** Cumulative pick thresholds for a weighted choice. */
function cumulativeWeights(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let running = 0;
  const out = weights.map((w) => (running += w) / total);
  out[out.length - 1] = 1;
  return out;
}

function pick(cumulative, u) {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (u < cumulative[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The detail rows as parallel typed arrays (row i of the data, 0-based; the
 * worksheet row is i + 2 because of the header).
 *
 * Dates ascend: row i falls on the day its position i/rows lands in, so a
 * ledger of any size has the same seasonal shape. Product popularity is
 * long-tailed (a few products sell far more than the rest), quantities are
 * mostly small, and three in ten rows carry a discounted unit price.
 */
export function buildRows(rows = FULL_ROWS, seed = DEFAULT_SEED) {
  const products = buildProducts(seed);
  const rand = mulberry32(seed);
  // Popularity rank -> product, shuffled so popular products spread over categories.
  const order = products.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const productPick = cumulativeWeights(order.map((_, rank) => 1 / Math.pow(rank + 8, 0.85)));
  const deptPick = cumulativeWeights(DEPARTMENTS.map((d) => d.weight));
  const quantiles = dayQuantiles();

  const day = new Uint16Array(rows);
  const product = new Uint16Array(rows);
  const dept = new Uint8Array(rows);
  const qty = new Uint8Array(rows);
  const price = new Uint32Array(rows);
  let d = 0;
  for (let i = 0; i < rows; i++) {
    const position = (i + 0.5) / rows;
    while (position > quantiles[d]) d += 1;
    day[i] = d;
    const p = order[pick(productPick, rand())];
    product[i] = p;
    dept[i] = pick(deptPick, rand());
    qty[i] = Math.min(24, 1 + Math.floor(-Math.log(1 - rand()) * 3.2));
    const u = rand();
    const discount = DISCOUNTS.find((tier) => u < tier.upTo) ?? DISCOUNTS[0];
    price[i] = Math.round(products[p].price * discount.rate);
  }
  return { rows, products, days: dayList(), day, product, dept, qty, price };
}

/** The eight cell inputs of data row `i` (0-based), exactly as the workbook stores them. */
export function detailRow(data, i) {
  const sheetRow = i + 2;
  return [
    data.days[data.day[i]],
    `SL-${pad(i + 1, 7)}`,
    data.products[data.product[i]].code,
    DEPARTMENTS[data.dept[i]].name,
    String(data.qty[i]),
    String(data.price[i]),
    `=E${sheetRow}*F${sheetRow}`,
    `=VLOOKUP(C${sheetRow},'${SHEET_MASTER}'!$A$2:$D$${PRODUCT_COUNT + 1},3,FALSE)`,
  ];
}

/**
 * Sales and row count of the rows matching the given conditions, computed
 * directly from the generated numbers. `from`/`to` are inclusive ISO dates,
 * `before` an exclusive one; `dept`/`category` are names, `product` a code;
 * anything left out matches every row. `overrides` replaces the quantity of
 * individual data rows (0-based index -> quantity), for checking an edit.
 */
export function aggregate(data, conditions = {}, overrides = new Map()) {
  const { from, to, before, dept, category, product } = conditions;
  // An unknown name matches no row (index -1), a condition left out every row (null).
  const deptIndex = dept === undefined ? null : DEPARTMENTS.findIndex((d) => d.name === dept);
  const categoryIndex = category === undefined ? null : CATEGORIES.findIndex((c) => c.name === category);
  const productIndex = product === undefined ? null : data.products.findIndex((p) => p.code === product);
  let sales = 0;
  let count = 0;
  let quantity = 0;
  for (let i = 0; i < data.rows; i++) {
    const date = data.days[data.day[i]];
    if (from !== undefined && date < from) continue;
    if (to !== undefined && date > to) continue;
    if (before !== undefined && date >= before) continue;
    if (deptIndex !== null && data.dept[i] !== deptIndex) continue;
    if (categoryIndex !== null && data.products[data.product[i]].category !== categoryIndex) continue;
    if (productIndex !== null && data.product[i] !== productIndex) continue;
    const q = overrides.get(i) ?? data.qty[i];
    sales += q * data.price[i];
    quantity += q;
    count += 1;
  }
  return { sales, count, quantity };
}

/**
 * Where the summary sheet keeps its conditions and results (A1 references on
 * the summary sheet). The benchmark edits the condition cells and reads the
 * result cells; nothing else knows these addresses.
 */
export const SUMMARY = {
  from: 'B3',
  to: 'B4',
  dept: 'B5',
  category: 'B6',
  sales: 'B8',
  count: 'B9',
  average: 'B10',
  quantity: 'B11',
  /** First row (1-based) of the per-department, per-category and per-month tables. */
  deptFirstRow: 14,
  categoryFirstRow: 24,
  monthFirstRow: 36,
  productCode: 'F3',
  productName: 'F4',
  productCategory: 'F5',
  productPrice: 'F6',
  productSales: 'F8',
  productCount: 'F9',
};

/**
 * The summary sheet's cells as dense rows. Every result is a formula over the
 * whole detail range: SUMIFS / COUNTIFS with the period, department and
 * category conditions, plus three small tables (by department, by category,
 * by month) and a product lookup into the master.
 */
export function summaryRows(rows = FULL_ROWS) {
  const last = rows + 1;
  // The names are not plain identifiers, so every reference single-quotes them.
  const col = (letter) => `'${SHEET_DETAIL}'!${letter}2:${letter}${last}`;
  const period = `${col('A')},">="&$B$3,${col('A')},"<="&$B$4`;
  const master = `'${SHEET_MASTER}'!$A$2:$D$${PRODUCT_COUNT + 1}`;
  const grid = [];
  const set = (ref, value) => {
    const match = /^([A-Z])(\d+)$/.exec(ref);
    const r = Number(match[2]) - 1;
    const c = match[1].charCodeAt(0) - 65;
    while (grid.length <= r) grid.push([]);
    while (grid[r].length < c) grid[r].push('');
    grid[r][c] = value;
  };
  set('A1', '売上分析（B3〜B6 の条件を変えると再集計されます）');
  set('A3', '開始日');
  set('B3', FIRST_DAY);
  set('A4', '終了日');
  set('B4', LAST_DAY);
  set('A5', '部門');
  set('B5', '*');
  set('C5', '* = すべて');
  set('A6', 'カテゴリ');
  set('B6', '*');
  set('C6', '* = すべて');
  set('A8', '売上合計');
  set('B8', `=SUMIFS(${col('G')},${period},${col('D')},$B$5,${col('H')},$B$6)`);
  set('A9', '件数');
  set('B9', `=COUNTIFS(${period},${col('D')},$B$5,${col('H')},$B$6)`);
  set('A10', '平均売上');
  set('B10', '=IF(B9=0,0,B8/B9)');
  set('A11', '数量合計');
  set('B11', `=SUMIFS(${col('E')},${period},${col('D')},$B$5,${col('H')},$B$6)`);

  set('A13', '部門別');
  set('B13', '売上');
  set('C13', '件数');
  DEPARTMENTS.forEach((dept, i) => {
    const r = SUMMARY.deptFirstRow + i;
    set(`A${r}`, dept.name);
    set(`B${r}`, `=SUMIFS(${col('G')},${period},${col('D')},$A${r},${col('H')},$B$6)`);
    set(`C${r}`, `=COUNTIFS(${period},${col('D')},$A${r},${col('H')},$B$6)`);
  });

  set('A23', 'カテゴリ別');
  set('B23', '売上');
  set('C23', '件数');
  CATEGORIES.forEach((category, i) => {
    const r = SUMMARY.categoryFirstRow + i;
    set(`A${r}`, category.name);
    set(`B${r}`, `=SUMIFS(${col('G')},${period},${col('D')},$B$5,${col('H')},$A${r})`);
    set(`C${r}`, `=COUNTIFS(${period},${col('D')},$B$5,${col('H')},$A${r})`);
  });

  set('A35', '月別（月初日）');
  set('B35', '売上');
  set('C35', '件数');
  const months = monthStarts();
  months.forEach((month, i) => {
    const r = SUMMARY.monthFirstRow + i;
    set(`A${r}`, month);
    if (i === months.length - 1) {
      set(`B${r}`, '（終端）');
      return;
    }
    const within = `${col('A')},">="&$A${r},${col('A')},"<"&$A${r + 1}`;
    set(`B${r}`, `=SUMIFS(${col('G')},${within},${col('D')},$B$5,${col('H')},$B$6)`);
    set(`C${r}`, `=COUNTIFS(${within},${col('D')},$B$5,${col('H')},$B$6)`);
  });

  set('E3', '商品コード');
  set('F3', 'P0001');
  set('E4', '商品名');
  set('F4', `=VLOOKUP(F3,${master},2,FALSE)`);
  set('E5', 'カテゴリ');
  set('F5', `=VLOOKUP(F3,${master},3,FALSE)`);
  set('E6', '標準単価');
  set('F6', `=VLOOKUP(F3,${master},4,FALSE)`);
  set('E8', '商品売上');
  set('F8', `=SUMIFS(${col('G')},${col('C')},$F$3,${period})`);
  set('E9', '商品件数');
  set('F9', `=COUNTIFS(${col('C')},$F$3,${period})`);
  return grid;
}

/** How many of a dense grid's cells are formulas. */
export function countFormulas(grid) {
  let n = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.startsWith('=')) n += 1;
    }
  }
  return n;
}
