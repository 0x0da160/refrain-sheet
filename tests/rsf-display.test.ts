// SPDX-License-Identifier: MIT
/**
 * RSF display-settings persistence (a worksheet's `view`): serialization
 * round trips, validation/clamping of malformed values, and the
 * document-level reopen flow (zoom and column widths restored, precedence
 * over app defaults).
 */
import { describe, expect, it } from 'vitest';
import { RSF_COL_WIDTH_MAX, RSF_COL_WIDTH_MIN, RSF_ZOOM_MAX, RSF_ZOOM_MIN } from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';
import { decodeRsf, encodeRsf, rsfFromTree, rsfTree, type RsfData } from './rsf-single-sheet';

const base: RsfData = {
  name: 'Sheet1',
  delimiter: ',',
  rowCount: 5,
  columnCount: 4,
  cells: [[0, 0, 'x']],
};

/** Re-encode `data` after editing its stored `view` (as a hand-edited file would). */
function withView(data: RsfData, edit: (view: Record<string, unknown>) => void): Uint8Array {
  const tree = rsfTree(encodeRsf(data));
  edit(tree.sheets[0].view);
  return rsfFromTree(tree);
}

describe('codec: display settings (view)', () => {
  it('round-trips zoom and column widths, stored with column letters', () => {
    const data: RsfData = {
      ...base,
      display: {
        zoom: 150,
        colWidths: [
          [0, 200],
          [2, 88],
        ],
      },
    };
    expect(rsfTree(encodeRsf(data)).sheets[0].view).toEqual({ zoom: 150, colWidths: { A: 200, C: 88 } });
    const decoded = decodeRsf(encodeRsf(data));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.display).toEqual(data.display);
  });

  it('leaves the view out when there are no display settings', () => {
    expect(rsfTree(encodeRsf(base)).sheets[0].view).toBeUndefined();
    const decoded = decodeRsf(encodeRsf(base));
    expect(decoded.ok && decoded.data.display).toBeUndefined();
  });

  it('clamps an out-of-range stored zoom instead of failing', () => {
    const data: RsfData = { ...base, display: { zoom: 150 } };
    const decodedBig = decodeRsf(withView(data, (view) => (view.zoom = 999)));
    expect(decodedBig.ok && decodedBig.data.display?.zoom).toBe(RSF_ZOOM_MAX);
    const decodedSmall = decodeRsf(withView(data, (view) => (view.zoom = 10)));
    expect(decodedSmall.ok && decodedSmall.data.display?.zoom).toBe(RSF_ZOOM_MIN);
  });

  it('clamps stored widths and drops entries for columns outside the sheet', () => {
    const data: RsfData = { ...base, display: { zoom: 100, colWidths: [[1, 100]] } };
    const unknown = decodeRsf(withView(data, (view) => (view.colWidths = { ZZ: 100 })));
    expect(unknown.ok && unknown.data.display?.colWidths).toBeUndefined();
    const huge = decodeRsf(withView(data, (view) => (view.colWidths = { B: 65_000 })));
    expect(huge.ok && huge.data.display?.colWidths).toEqual([[1, RSF_COL_WIDTH_MAX]]);
    const tiny = decodeRsf(withView(data, (view) => (view.colWidths = { B: 1 })));
    expect(tiny.ok && tiny.data.display?.colWidths).toEqual([[1, RSF_COL_WIDTH_MIN]]);
  });

  it('rejects a malformed view as bad-shape', () => {
    const data: RsfData = { ...base, display: { zoom: 100 } };
    expect(decodeRsf(withView(data, (view) => (view.zoom = 'big')))).toEqual({
      ok: false,
      error: 'bad-shape',
    });
    expect(decodeRsf(withView(data, (view) => (view.colWidths = { b1: 100 })))).toEqual({
      ok: false,
      error: 'bad-shape',
    });
  });

  it('encode clamps out-of-range inputs defensively', () => {
    const decoded = decodeRsf(encodeRsf({ ...base, display: { zoom: 9999, colWidths: [[0, 5]] } }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.display?.zoom).toBe(RSF_ZOOM_MAX);
    expect(decoded.data.display?.colWidths).toEqual([[0, RSF_COL_WIDTH_MIN]]);
  });
});

describe('document-level persistence and reopen', () => {
  it('round-trips display settings through RsfDocument save/load', () => {
    const doc = RsfDocument.empty('t.rsf', 4, 4);
    doc.setCell(0, 0, 'a');
    doc.setDisplaySettings(125, [0, 210, 0, 96]);
    const loaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.displayZoom).toBe(125);
    expect(loaded.doc.displayColWidths[1]).toBe(210);
    expect(loaded.doc.displayColWidths[3]).toBe(96);
    expect(loaded.doc.displayColWidths[0]).toBeUndefined();
    // Display settings are presentational: the reloaded document is not dirty
    // and its cell data round-tripped unchanged.
    expect(loaded.doc.getValue(0, 0)).toBe('a');
    expect(loaded.doc.isDirty).toBe(false);
  });

  it('display settings never mark the document dirty', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    doc.markSaved();
    doc.setDisplaySettings(150, [180]);
    expect(doc.isDirty).toBe(false);
  });

  it('a document without stored settings reports none (app defaults apply)', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    const loaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.displayZoom).toBeUndefined();
    expect(loaded.doc.displayColWidths).toEqual([]);
  });
});

describe('codec: wrap long rows', () => {
  it('round-trips the wrap flag, and leaves it out when unset', () => {
    const decoded = decodeRsf(encodeRsf({ ...base, display: { wrap: true } }));
    expect(decoded.ok && decoded.data.display?.wrap).toBe(true);
    expect(rsfTree(encodeRsf({ ...base, display: { zoom: 125 } })).sheets[0].view.wrap).toBeUndefined();
  });

  it('persists and restores wrap through the document reopen flow', () => {
    const doc = RsfDocument.empty('t.rsf', 3, 2);
    doc.setDisplaySettings(undefined, [], true);
    const loaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.displayWrap).toBe(true);
  });
});
