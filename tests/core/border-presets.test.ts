// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { borderPresetPatch, type BorderLine } from '../../src/core/workbook/border-presets';

const line: BorderLine = { color: '#112233', lineStyle: 'solid', width: 'thin' };
const range = { top: 0, left: 0, bottom: 2, right: 2 };

/** The sides a preset sets (not clears) on each cell of the 3×3 range, as a compact map. */
function sidesSet(preset: Parameters<typeof borderPresetPatch>[0]): string[][] {
  const out: string[][] = [];
  for (let r = 0; r <= 2; r++) {
    const row: string[] = [];
    for (let c = 0; c <= 2; c++) {
      const patch = borderPresetPatch(preset, line, range, r, c) ?? {};
      row.push(
        (['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const)
          .filter((side) => patch[side] === line.color)
          .map((side) => side[6])
          .join(''),
      );
    }
    out.push(row);
  }
  return out;
}

describe('borderPresetPatch', () => {
  it('draws the outline of the range for outside', () => {
    expect(sidesSet('outside')).toEqual([
      ['TL', 'T', 'TR'],
      ['L', '', 'R'],
      ['BL', 'B', 'RB'],
    ]);
  });

  it('draws each inner line once for inside', () => {
    expect(sidesSet('inside')).toEqual([
      ['RB', 'RB', 'B'],
      ['RB', 'RB', 'B'],
      ['R', 'R', ''],
    ]);
  });

  it('draws one outer edge for top, bottom, left and right', () => {
    expect(sidesSet('top')[0]).toEqual(['T', 'T', 'T']);
    expect(sidesSet('top')[1]).toEqual(['', '', '']);
    expect(sidesSet('right').map((row) => row[2])).toEqual(['R', 'R', 'R']);
  });

  it('sets the line style and width with each side it draws', () => {
    const patch = borderPresetPatch('all', { ...line, lineStyle: 'dashed', width: 'thick' }, range, 1, 1);
    expect(patch).toMatchObject({ borderTopStyle: 'dashed', borderLeftWidth: 'thick' });
  });

  it('clears every side of every cell for none', () => {
    expect(borderPresetPatch('none', line, range, 1, 1)).toEqual({
      borderTop: null,
      borderRight: null,
      borderBottom: null,
      borderLeft: null,
    });
  });

  it('leaves a cell alone when the preset draws nothing on it', () => {
    expect(borderPresetPatch('top', line, range, 1, 1)).toBeNull();
  });
});
