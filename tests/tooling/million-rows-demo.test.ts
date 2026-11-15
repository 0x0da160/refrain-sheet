// SPDX-License-Identifier: MIT
// The million-row demo workbook (scripts/bench/) must be a file the
// application opens, and its summary formulas must compute exactly what the
// generator's own arithmetic says — that agreement is what lets the browser
// benchmark tell a correct result from a fast wrong one.
import { beforeAll, describe, expect, it } from 'vitest';
import { initCsvEngine } from '../../src/core/csv/csv-engine';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import {
  aggregate,
  buildRows,
  CATEGORIES,
  DEFAULT_SEED,
  DEPARTMENTS,
  detailRow,
  monthStarts,
  SHEET_DETAIL,
  SHEET_MASTER,
  SHEET_SUMMARY,
  SUMMARY,
} from '../../scripts/bench/million-rows-data.mjs';
import { buildDemoWorkbook } from '../../scripts/bench/million-rows-workbook.mjs';

const ROWS = 3000;

function cell(ref: string): [number, number] {
  return [Number(ref.slice(1)) - 1, ref.charCodeAt(0) - 65];
}

function openDemo(): RsfDocument {
  const { file } = buildDemoWorkbook(ROWS, DEFAULT_SEED);
  const loaded = RsfDocument.fromBytes(file, 'demo.rsf');
  if (!loaded.ok) {
    throw new Error(`the demo workbook did not open: ${loaded.error}`);
  }
  return loaded.doc;
}

describe('million-row demo workbook', () => {
  beforeAll(async () => {
    await initCsvEngine();
  });

  it('is the same document for the same arguments', () => {
    const a = buildDemoWorkbook(500, DEFAULT_SEED).manifest;
    const b = buildDemoWorkbook(500, DEFAULT_SEED).manifest;
    expect(a.jsonSha256).toBe(b.jsonSha256);
    expect(buildDemoWorkbook(500, DEFAULT_SEED + 1).manifest.jsonSha256).not.toBe(a.jsonSha256);
  });

  it('opens with the documented worksheets, sizes and formula counts', () => {
    const doc = openDemo();
    const { manifest } = buildDemoWorkbook(ROWS, DEFAULT_SEED);
    expect(doc.sheets.map((s) => s.name)).toEqual([SHEET_DETAIL, SHEET_MASTER, SHEET_SUMMARY]);
    const detail = doc.sheetByName(SHEET_DETAIL)!;
    expect(detail.rowCount).toBe(ROWS + 1);
    expect(detail.columnCount).toBe(8);
    expect(detail.countFormulaCells()).toBe(manifest.sheets[SHEET_DETAIL].formulas);
    expect(doc.sheetByName(SHEET_SUMMARY)!.countFormulaCells()).toBe(manifest.sheets[SHEET_SUMMARY].formulas);
    // No blank padding: every detail cell holds a value.
    let filled = 0;
    for (let r = 0; r < detail.rowCount; r++) {
      for (let c = 0; c < detail.columnCount; c++) {
        if (detail.getValue(r, c) !== '') filled += 1;
      }
    }
    expect(filled).toBe(manifest.nonEmptyCells);
    const data = buildRows(ROWS, DEFAULT_SEED);
    expect(detailRow(data, ROWS - 1)).toEqual(Array.from({ length: 8 }, (_, c) => detail.getValue(ROWS, c)));
  });

  it('computes the totals the generator expects, for every table of the summary', () => {
    const doc = openDemo();
    const data = buildRows(ROWS, DEFAULT_SEED);
    const summary = doc.sheetByName(SHEET_SUMMARY)!;
    const shown = (ref: string): string => doc.getSheetPlainValue(summary.id, ...cell(ref));
    const all = aggregate(data);
    expect(shown(SUMMARY.sales)).toBe(String(all.sales));
    expect(shown(SUMMARY.count)).toBe(String(all.count));
    expect(shown(SUMMARY.quantity)).toBe(String(all.quantity));
    expect(Number(shown(SUMMARY.average))).toBeCloseTo(all.sales / all.count, 6);
    DEPARTMENTS.forEach((dept, i) => {
      const want = aggregate(data, { dept: dept.name });
      expect(shown(`B${SUMMARY.deptFirstRow + i}`)).toBe(String(want.sales));
      expect(shown(`C${SUMMARY.deptFirstRow + i}`)).toBe(String(want.count));
    });
    CATEGORIES.forEach((category, i) => {
      const want = aggregate(data, { category: category.name });
      expect(shown(`B${SUMMARY.categoryFirstRow + i}`)).toBe(String(want.sales));
      expect(shown(`C${SUMMARY.categoryFirstRow + i}`)).toBe(String(want.count));
    });
    const months = monthStarts();
    for (let i = 0; i + 1 < months.length; i++) {
      const want = aggregate(data, { from: months[i], before: months[i + 1] });
      expect(shown(`B${SUMMARY.monthFirstRow + i}`)).toBe(String(want.sales));
      expect(shown(`C${SUMMARY.monthFirstRow + i}`)).toBe(String(want.count));
    }
    const product = data.products[0];
    expect(shown(SUMMARY.productName)).toBe(product.name);
    expect(shown(SUMMARY.productCategory)).toBe(CATEGORIES[product.category].name);
    expect(shown(SUMMARY.productSales)).toBe(String(aggregate(data, { product: product.code }).sales));
  });

  it('follows a change of conditions and an edited detail row', () => {
    const doc = openDemo();
    const data = buildRows(ROWS, DEFAULT_SEED);
    const summary = doc.sheetByName(SHEET_SUMMARY)!;
    const detail = doc.sheetByName(SHEET_DETAIL)!;
    const shown = (ref: string): string => doc.getSheetPlainValue(summary.id, ...cell(ref));
    const conditions = {
      from: '2025-04-01',
      to: '2025-09-30',
      dept: DEPARTMENTS[1].name,
      category: CATEGORIES[1].name,
    };
    doc.setCellOn(summary.id, ...cell(SUMMARY.from), conditions.from);
    doc.setCellOn(summary.id, ...cell(SUMMARY.to), conditions.to);
    doc.setCellOn(summary.id, ...cell(SUMMARY.dept), conditions.dept);
    doc.setCellOn(summary.id, ...cell(SUMMARY.category), conditions.category);
    const filtered = aggregate(data, conditions);
    expect(filtered.count).toBeGreaterThan(0);
    expect(shown(SUMMARY.sales)).toBe(String(filtered.sales));
    expect(shown(SUMMARY.count)).toBe(String(filtered.count));

    // Raise the quantity of a row inside those conditions: its 売上 and every total follow.
    let target = -1;
    for (let i = 0; i < data.rows && target < 0; i++) {
      if (aggregate({ ...data, rows: i + 1 }, conditions).count > 0) target = i;
    }
    const overrides = new Map([[target, data.qty[target] + 5]]);
    doc.setCellOn(detail.id, target + 1, 4, String(data.qty[target] + 5));
    expect(doc.getSheetPlainValue(detail.id, target + 1, 6)).toBe(
      String((data.qty[target] + 5) * data.price[target]),
    );
    expect(shown(SUMMARY.sales)).toBe(String(aggregate(data, conditions, overrides).sales));
    expect(shown(SUMMARY.quantity)).toBe(String(aggregate(data, conditions, overrides).quantity));
  });
});
