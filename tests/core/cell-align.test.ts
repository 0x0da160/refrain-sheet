// SPDX-License-Identifier: MIT
/**
 * Horizontal alignment as a cell style: patched and compared like any other
 * key, cleared by `null`, and written to / read from an RSF style object,
 * where any value other than left, center or right fails the file.
 */
import { describe, expect, it } from 'vitest';
import { applyCellStylePatch, cellStylesEqual } from '../../src/core/workbook/cell-style';
import { styleFromJson, styleToJson } from '../../src/core/workbook/rsf-cell-style';

const fail = (): never => {
  throw new Error('bad-shape');
};

describe('cell alignment style', () => {
  it('is set and cleared by a patch, and counts in equality', () => {
    const centered = applyCellStylePatch(null, { horizontalAlign: 'center' });
    expect(centered).toEqual({ horizontalAlign: 'center' });
    expect(cellStylesEqual(centered, { horizontalAlign: 'right' })).toBe(false);
    expect(applyCellStylePatch(centered, { horizontalAlign: null })).toBeNull();
  });

  it('round-trips through the RSF style object', () => {
    const json = styleToJson({ bold: true, horizontalAlign: 'right' }, 'x');
    expect(json).toEqual({ bold: true, horizontalAlign: 'right' });
    expect(styleFromJson(json, 100, fail)).toEqual({ bold: true, horizontalAlign: 'right' });
  });

  it('rejects any other value', () => {
    expect(() => styleFromJson({ horizontalAlign: 'justify' }, 100, fail)).toThrow('bad-shape');
    expect(() => styleFromJson({ horizontalAlign: 1 }, 100, fail)).toThrow('bad-shape');
  });
});
