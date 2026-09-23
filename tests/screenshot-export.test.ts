// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { onScreenGeometry } from '../src/app/screenshot-export';

describe('onScreenGeometry', () => {
  it('uses the default column width and row height at 100% zoom', () => {
    const geometry = onScreenGeometry({ colWidths: [], zoom: 100 }, { top: 0, left: 0, bottom: 0, right: 2 });
    expect(geometry.colWidths).toEqual([104, 104, 104]);
    expect(geometry.rowHeight).toBe(24);
  });

  it('scales column widths and row height by the tab zoom', () => {
    const geometry = onScreenGeometry({ colWidths: [], zoom: 150 }, { top: 0, left: 0, bottom: 0, right: 0 });
    expect(geometry.colWidths).toEqual([156]);
    expect(geometry.rowHeight).toBe(36);
  });

  it('prefers a per-column override over the default width, still zoom-scaled', () => {
    const geometry = onScreenGeometry(
      { colWidths: [200, 0, 80], zoom: 100 },
      { top: 0, left: 0, bottom: 0, right: 2 },
    );
    expect(geometry.colWidths).toEqual([200, 104, 80]);
  });
});
