// SPDX-License-Identifier: MIT
/**
 * Helpers for tests that compare what a workbook evaluates to: a seeded random
 * generator, an exact textual form of a value, every value of a workbook, and
 * a from-scratch copy of a workbook to compare a long-lived one against.
 */
import type { FormulaValue } from '../src/core/formula';
import { RsfDocument } from '../src/core/workbook/rsf-document';

/** A small deterministic generator (mulberry32), so a failing case reproduces. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/** A value as text, exactly: two numbers read the same only with the same bits (`-0` is not `0`). */
export function showValue(value: FormulaValue): string {
  switch (value.type) {
    case 'number':
      return `number ${Object.is(value.value, -0) ? '-0' : String(value.value)}`;
    case 'string':
      return `string ${JSON.stringify(value.value)}`;
    case 'boolean':
      return `boolean ${String(value.value)}`;
    case 'error':
      return `error ${value.code}`;
    default:
      return 'empty';
  }
}

/**
 * What every cell of every worksheet evaluates to, asked in worksheet order
 * and row-major order — the order matters to a workbook with a circular
 * reference, where the cell asked first is the one that reports it.
 */
export function workbookValues(doc: RsfDocument): string[] {
  const out: string[] = [];
  for (const sheet of doc.sheets) {
    for (let row = 0; row < sheet.rowCount; row++) {
      for (let col = 0; col < sheet.columnCount; col++) {
        out.push(showValue(doc.evaluateInSheet(sheet, row, col)));
      }
    }
  }
  return out;
}

/**
 * A new workbook with the same worksheets and the same cell inputs, on which
 * nothing has been evaluated yet: what the workbook would be if it had just
 * been opened.
 */
export function freshCopy(doc: RsfDocument): RsfDocument {
  const first = doc.sheets[0];
  const copy = RsfDocument.empty('copy.rsf', first.rowCount, first.columnCount, first.name);
  doc.sheets.forEach((sheet, index) => {
    let target = copy.sheets[0];
    if (index > 0) {
      target = copy.createWorksheet(sheet.name, sheet.rowCount, sheet.columnCount);
      copy.insertSheetAt(index, target);
    }
    for (let row = 0; row < sheet.rowCount; row++) {
      for (let col = 0; col < sheet.columnCount; col++) {
        const input = sheet.getValue(row, col);
        if (input !== '') {
          copy.setCellOn(target.id, row, col, input);
        }
      }
    }
  });
  return copy;
}

/** The cells where two value lists differ, as `index: got / want`, at most `limit` of them. */
export function differences(got: readonly string[], want: readonly string[], limit = 8): string[] {
  const out: string[] = [];
  if (got.length !== want.length) {
    out.push(`${got.length} values, expected ${want.length}`);
  }
  for (let i = 0; i < Math.min(got.length, want.length) && out.length < limit; i++) {
    if (got[i] !== want[i]) {
      out.push(`cell #${i}: ${got[i]}, expected ${want[i]}`);
    }
  }
  return out;
}
