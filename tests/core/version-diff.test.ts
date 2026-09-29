// SPDX-License-Identifier: MIT
/** What changed between two saved versions: cells, formatting, and sheets. */
import { describe, expect, it } from 'vitest';
import type { RsfWorkbookData, RsfWorksheetData } from '../../src/core/workbook/rsf-codec';
import { cellKey, diffVersions } from '../../src/core/workbook/version-diff';

const sheet = (id: string, name: string, extra: Partial<RsfWorksheetData> = {}): RsfWorksheetData => ({
  id,
  name,
  rowCount: 10,
  columnCount: 5,
  cells: [],
  ...extra,
});
const book = (...sheets: RsfWorksheetData[]): RsfWorkbookData => ({ delimiter: ',', sheets });

describe('diffVersions', () => {
  it('marks edited, added and cleared cells as value changes, and formatting-only changes apart', () => {
    const before = book(
      sheet('s1', 'Data', {
        cells: [
          [0, 0, 'same'],
          [1, 0, 'old'],
          [2, 0, 'gone'],
          [3, 0, '=A1'],
        ],
        styles: [[0, 0, { bold: true }]],
      }),
    );
    const after = book(
      sheet('s1', 'Data', {
        cells: [
          [0, 0, 'same'],
          [1, 0, 'new'],
          [3, 0, '=A2'],
          [4, 1, 'added'],
        ],
        styles: [
          [0, 0, { bold: true, italic: true }],
          [1, 0, { bold: true }],
          [5, 2, { textColor: '#ff0000' }],
        ],
      }),
    );
    const changes = diffVersions(before, after).sheets.get('s1')!;
    expect(Object.fromEntries(changes.cells)).toEqual({
      [cellKey(0, 0)]: 'format',
      [cellKey(1, 0)]: 'value', // a value change wins over its formatting change
      [cellKey(2, 0)]: 'value',
      [cellKey(3, 0)]: 'value',
      [cellKey(4, 1)]: 'value',
      [cellKey(5, 2)]: 'format',
    });
    expect(changes).toMatchObject({ values: 4, formats: 2, text: false });
  });

  it('matches sheets by id: renamed, added and deleted sheets', () => {
    const before = book(sheet('s1', 'Old name'), sheet('s2', 'Gone'));
    const after = book(sheet('s1', 'New name'), sheet('s3', 'Fresh'));
    const diff = diffVersions(before, after);
    expect(diff.renamed).toEqual([{ from: 'Old name', to: 'New name' }]);
    expect(diff.added).toEqual(['Fresh']);
    expect(diff.removed).toEqual(['Gone']);
    expect(diff.sheets.get('s1')?.cells.size).toBe(0);
    expect(diff.sheets.has('s3')).toBe(false);
  });

  it('reports a changed Markdown or text sheet as a whole', () => {
    const md = (text: string) => sheet('m', 'Notes', { kind: 'markdown', cells: [[0, 0, text]] });
    expect(diffVersions(book(md('a')), book(md('b'))).sheets.get('m')?.text).toBe(true);
    expect(diffVersions(book(md('a')), book(md('a'))).sheets.get('m')?.text).toBe(false);
  });
});
