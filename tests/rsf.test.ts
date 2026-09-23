// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  decodeRsf,
  DEFAULT_HISTORY_SNAPSHOT_LIMIT,
  encodeRsf,
  MAX_RSF_HISTORY_SNAPSHOTS,
  RSF_MAGIC,
} from '../src/core/rsf-codec';
import { NEW_DOC_COLS, NEW_DOC_ROWS, RsfDocument } from '../src/core/rsf-document';
import { APP_NAME, APP_VERSION } from '../src/core/app-identity';
import { doc } from './helpers';

function rcsvFromCells(cells: Array<[number, number, string]>, rows = 4, cols = 3): RsfDocument {
  // Build a clean (non-dirty) document via the binary container round-trip.
  const bytes = encodeRsf({ name: 'Sheet1', delimiter: ',', rowCount: rows, columnCount: cols, cells });
  const result = RsfDocument.fromBytes(bytes, 'test.rcsv');
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.doc;
}

describe('conversion from CSV', () => {
  it('copies current values (including unsaved edits) into a rectangular sheet', () => {
    const csv = doc('a,b,c\n1,2\n');
    csv.setValue(0, 1, 'edited');
    const rcsv = RsfDocument.fromLossless(csv, 'x.rcsv');
    expect(rcsv.rowCount).toBe(2);
    expect(rcsv.columnCount).toBe(3);
    expect(rcsv.getValue(0, 1)).toBe('edited');
    expect(rcsv.getValue(1, 0)).toBe('1');
    expect(rcsv.getValue(1, 2)).toBe(''); // jagged row padded
    expect(rcsv.delimiter).toBe(',');
  });
});

describe('formulas in the document', () => {
  it('computes display values while preserving the formula expression', () => {
    const sheet = rcsvFromCells([
      [0, 0, '10'],
      [1, 0, '20'],
      [2, 0, '=SUM(A1:A2)'],
    ]);
    expect(sheet.getValue(2, 0)).toBe('=SUM(A1:A2)');
    expect(sheet.getDisplayValue(2, 0)).toBe('30');
    expect(sheet.isFormulaCell(2, 0)).toBe(true);
    expect(sheet.isFormulaCell(0, 0)).toBe(false);
    expect(sheet.countFormulaCells()).toBe(1);
  });

  it('recalculates dependents when referenced values change', () => {
    const sheet = rcsvFromCells([
      [0, 0, '1'],
      [1, 0, '=A1*2'],
      [2, 0, '=A2+1'],
    ]);
    expect(sheet.getDisplayValue(2, 0)).toBe('3');
    sheet.setCell(0, 0, '10');
    expect(sheet.getDisplayValue(1, 0)).toBe('20');
    expect(sheet.getDisplayValue(2, 0)).toBe('21');
  });

  it('recalculates when a referenced formula changes', () => {
    const sheet = rcsvFromCells([
      [0, 0, '2'],
      [1, 0, '=A1*3'],
      [2, 0, '=A2*10'],
    ]);
    expect(sheet.getDisplayValue(2, 0)).toBe('60');
    sheet.setCell(1, 0, '=A1*5');
    expect(sheet.getDisplayValue(2, 0)).toBe('100');
  });

  it('detects circular references without crashing', () => {
    const sheet = rcsvFromCells([
      [0, 0, '=B1'],
      [0, 1, '=A1'],
    ]);
    expect(sheet.getDisplayValue(0, 0)).toBe('#CYCLE!');
    expect(sheet.getDisplayValue(0, 1)).toBe('#CYCLE!');
    // Self-reference too.
    sheet.setCell(2, 0, '=A3');
    expect(sheet.getDisplayValue(2, 0)).toBe('#CYCLE!');
    // Breaking the cycle recovers.
    sheet.setCell(0, 1, '7');
    expect(sheet.getDisplayValue(0, 0)).toBe('7');
  });

  it('two formulas over the same range both see a later edit', () => {
    // Reading a large range is cached across formula cells (a common
    // VLOOKUP-table-copied-down pattern); an edit must invalidate it for
    // every reader, not just the one that happens to be recomputed first.
    const sheet = rcsvFromCells([
      [0, 0, '1'],
      [1, 0, '2'],
      [2, 0, '3'],
      [0, 1, '=SUM(A1:A3)'],
      [0, 2, '=SUM(A1:A3)'],
    ]);
    expect(sheet.getDisplayValue(0, 1)).toBe('6');
    expect(sheet.getDisplayValue(0, 2)).toBe('6');
    sheet.setCell(1, 0, '20');
    expect(sheet.getDisplayValue(0, 1)).toBe('24');
    expect(sheet.getDisplayValue(0, 2)).toBe('24');
  });

  it('a self-referential range caught by IFERROR does not poison a later, independent read of the same range', () => {
    // A1 reads a range containing itself while still being evaluated, so its
    // read of its own cell is a transient #CYCLE! placeholder that IFERROR
    // replaces with 42 before A1's real value is memoized. That transient
    // grid must never be cached under the range's key, or B1's separate,
    // non-cyclic SUM over the same range would see the stale placeholder
    // instead of A1's real, memoized value.
    const sheet = rcsvFromCells([
      [0, 0, '=IFERROR(SUM(A1:A3),42)'],
      [1, 0, '5'],
      [2, 0, '3'],
      [0, 1, '=SUM(A1:A3)'],
    ]);
    expect(sheet.getDisplayValue(0, 0)).toBe('42');
    expect(sheet.getDisplayValue(0, 1)).toBe('50');
  });

  it('shows explicit errors for invalid formulas and unsupported functions', () => {
    const sheet = rcsvFromCells([
      [0, 0, '=1+'],
      [0, 1, '=NOPE(1)'],
      [0, 2, '=1/0'],
      [1, 0, '=#REF!'],
    ]);
    expect(sheet.getDisplayValue(0, 0)).toBe('#ERROR!');
    expect(sheet.getDisplayValue(0, 1)).toBe('#NAME?');
    expect(sheet.getDisplayValue(0, 2)).toBe('#DIV/0!');
    expect(sheet.getDisplayValue(1, 0)).toBe('#REF!');
  });
});

describe('versioned binary serialization', () => {
  it('writes the RSF magic bytes and container version', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    const bytes = sheet.toBytes();
    expect(Array.from(bytes.subarray(0, 4))).toEqual(Array.from(RSF_MAGIC));
    expect(bytes[4]).toBe(3); // container version (RSF)
  });

  it('round-trips values, formulas, structure, and settings', () => {
    const original = rcsvFromCells(
      [
        [0, 0, 'v'],
        [1, 2, '=SUM(A1:A2)'],
        [3, 1, 'multi\nline'],
      ],
      5,
      4,
    );
    original.delimiter = ';';
    const bytes = original.toBytes();
    const reloaded = RsfDocument.fromBytes(bytes, 'again.rcsv');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.doc.rowCount).toBe(5);
    expect(reloaded.doc.columnCount).toBe(4);
    expect(reloaded.doc.getValue(0, 0)).toBe('v');
    expect(reloaded.doc.getValue(1, 2)).toBe('=SUM(A1:A2)');
    expect(reloaded.doc.getValue(3, 1)).toBe('multi\nline');
    expect(reloaded.doc.delimiter).toBe(';');
  });

  it('records the creating/updating application name and version in metadata', () => {
    const bytes = rcsvFromCells([[0, 0, 'v']]).toBytes();
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.appName).toBe(APP_NAME);
    expect(decoded.data.appVersion).toBe(APP_VERSION);
  });

  it('rejects non-RSF bytes with bad magic', () => {
    for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array(30)]) {
      const result = RsfDocument.fromBytes(bytes, 'bad.rcsv');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('bad-magic');
    }
  });

  it('rejects an unsupported container version', () => {
    const bytes = rcsvFromCells([[0, 0, 'v']]).toBytes();
    bytes[4] = 99;
    const result = RsfDocument.fromBytes(bytes, 'bad.rcsv');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('bad-version');
  });

  it('detects corruption through the checksum', () => {
    const bytes = rcsvFromCells([[0, 0, 'value']]).toBytes();
    // Flip a byte inside the payload (after the 20-byte header).
    bytes[bytes.length - 1] ^= 0xff;
    const result = RsfDocument.fromBytes(bytes, 'bad.rcsv');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['checksum', 'bad-shape']).toContain(result.error);
  });

  it('stores only inert data (no code is ever executed by loading)', () => {
    // Hostile-looking strings stay plain strings.
    const sheet = rcsvFromCells([
      [0, 0, '<script>window.x=1</script>'],
      [0, 1, '=SUM(A1:A1)'],
    ]);
    expect(sheet.getDisplayValue(0, 0)).toBe('<script>window.x=1</script>');
    const reloaded = RsfDocument.fromBytes(sheet.toBytes(), 'again.rcsv');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.doc.getValue(0, 0)).toBe('<script>window.x=1</script>');
  });
});

describe('version history (snapshots)', () => {
  it('defaults to enabled with no snapshots for a new document', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    expect(sheet.historyEnabled).toBe(true);
    expect(sheet.history).toEqual([]);
  });

  it('appends one snapshot per successful save while enabled', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.toBytes();
    expect(sheet.history.length).toBe(1);
    sheet.setCell(0, 0, 'w');
    sheet.toBytes();
    expect(sheet.history.length).toBe(2);
  });

  it('caps retained snapshots at the default limit, dropping the oldest first', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    for (let i = 0; i < DEFAULT_HISTORY_SNAPSHOT_LIMIT + 3; i++) {
      sheet.setCell(0, 0, `v${i}`);
      sheet.toBytes();
    }
    expect(sheet.history.length).toBe(DEFAULT_HISTORY_SNAPSHOT_LIMIT);
  });

  it('stops recording new snapshots once disabled, but keeps the ones already recorded', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.toBytes();
    expect(sheet.history.length).toBe(1);
    sheet.setHistoryEnabled(false);
    sheet.setCell(0, 0, 'w');
    sheet.toBytes();
    expect(sheet.history.length).toBe(1);
    expect(sheet.historyEnabled).toBe(false);
  });

  it('clearHistory discards every recorded snapshot without touching enabled state', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.toBytes();
    sheet.toBytes();
    expect(sheet.history.length).toBe(2);
    sheet.clearHistory();
    expect(sheet.history).toEqual([]);
    expect(sheet.historyEnabled).toBe(true);
  });

  it('setHistoryEnabled and clearHistory mark the document dirty without changing cell values', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.toBytes();
    sheet.markSaved();
    expect(sheet.isDirty).toBe(false);

    sheet.setHistoryEnabled(false);
    expect(sheet.isDirty).toBe(true);
    expect(sheet.getValue(0, 0)).toBe('v');
    sheet.markSaved();

    sheet.clearHistory();
    expect(sheet.isDirty).toBe(true);
    expect(sheet.getValue(0, 0)).toBe('v');
  });

  it('a no-op enabled/disabled toggle does not mark the document dirty', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    expect(sheet.isDirty).toBe(false);
    sheet.setHistoryEnabled(true); // already enabled
    expect(sheet.isDirty).toBe(false);
  });

  it('round-trips historyEnabled and recorded snapshots through save/load', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.toBytes();
    sheet.setCell(0, 0, 'w');
    const bytes = sheet.toBytes();
    const reloaded = RsfDocument.fromBytes(bytes, 'again.rcsv');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.doc.historyEnabled).toBe(true);
    expect(reloaded.doc.history.length).toBe(2);
  });

  it('a snapshot never nests another snapshot list inside itself', () => {
    // Each snapshot is an opaque encoding of the content alone (see
    // `encodeRsfBody`), so repeated saves grow the snapshot count linearly,
    // not each individual snapshot's own byte length.
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.toBytes();
    const firstSnapshotSize = sheet.history[0].bytes.length;
    for (let i = 0; i < 5; i++) {
      sheet.setCell(0, 0, `v${i}`);
      sheet.toBytes();
    }
    for (const snapshot of sheet.history) {
      // A small, roughly constant size — not compounding with each save.
      expect(snapshot.bytes.length).toBeLessThan(firstSnapshotSize * 4);
    }
  });

  it('defaults the retained-snapshot cap override to undefined (use the default)', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    expect(sheet.historyMaxOverride).toBeUndefined();
    expect(sheet.effectiveHistoryMax).toBe(DEFAULT_HISTORY_SNAPSHOT_LIMIT);
    expect(sheet.willDropOldestOnNextSave).toBe(false);
  });

  it('setHistoryMaxOverride lowers the retained cap and clamps into range', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.setHistoryMaxOverride(2);
    expect(sheet.effectiveHistoryMax).toBe(2);
    for (let i = 0; i < 5; i++) {
      sheet.setCell(0, 0, `v${i}`);
      sheet.toBytes();
    }
    expect(sheet.history.length).toBe(2);

    // Clamped into [1, MAX_RSF_HISTORY_SNAPSHOTS] rather than accepting an
    // out-of-range value verbatim.
    sheet.setHistoryMaxOverride(0);
    expect(sheet.effectiveHistoryMax).toBe(1);
    sheet.setHistoryMaxOverride(MAX_RSF_HISTORY_SNAPSHOTS + 100);
    expect(sheet.effectiveHistoryMax).toBe(MAX_RSF_HISTORY_SNAPSHOTS);
  });

  it('setHistoryMaxOverride(null) is unlimited, still bounded by the hard ceiling', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.setHistoryMaxOverride(null);
    expect(sheet.effectiveHistoryMax).toBeNull();
    for (let i = 0; i < DEFAULT_HISTORY_SNAPSHOT_LIMIT + 3; i++) {
      sheet.setCell(0, 0, `v${i}`);
      sheet.toBytes();
    }
    // Past the default limit, since it is unlimited...
    expect(sheet.history.length).toBe(DEFAULT_HISTORY_SNAPSHOT_LIMIT + 3);
    // ...but a save never drops anything while unlimited, so no warning.
    expect(sheet.willDropOldestOnNextSave).toBe(false);
  });

  it('willDropOldestOnNextSave is true only once a finite cap is reached', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.setHistoryMaxOverride(2);
    expect(sheet.willDropOldestOnNextSave).toBe(false);
    sheet.toBytes();
    expect(sheet.willDropOldestOnNextSave).toBe(false);
    sheet.setCell(0, 0, 'w');
    sheet.toBytes();
    // At the cap: the *next* save would drop the oldest.
    expect(sheet.history.length).toBe(2);
    expect(sheet.willDropOldestOnNextSave).toBe(true);
  });

  it('round-trips a numeric and an unlimited retained-snapshot cap override', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.setHistoryMaxOverride(5);
    const bytes = sheet.toBytes();
    const reloaded = RsfDocument.fromBytes(bytes, 'again.rcsv');
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) expect(reloaded.doc.historyMaxOverride).toBe(5);

    const unlimited = rcsvFromCells([[0, 0, 'v']]);
    unlimited.setHistoryMaxOverride(null);
    const unlimitedBytes = unlimited.toBytes();
    const reloadedUnlimited = RsfDocument.fromBytes(unlimitedBytes, 'again.rcsv');
    expect(reloadedUnlimited.ok).toBe(true);
    if (reloadedUnlimited.ok) expect(reloadedUnlimited.doc.historyMaxOverride).toBeNull();
  });

  it('a file saved without an override reads back as undefined (the default)', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.toBytes();
    const reloaded = RsfDocument.fromBytes(sheet.toBytes(), 'again.rcsv');
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) expect(reloaded.doc.historyMaxOverride).toBeUndefined();
  });

  it('autoFormatSource defaults to false', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    expect(sheet.autoFormatSource).toBe(false);
  });

  it('setAutoFormatSource marks the document dirty without changing cell values', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.toBytes();
    sheet.markSaved();
    expect(sheet.isDirty).toBe(false);
    sheet.setAutoFormatSource(true);
    expect(sheet.isDirty).toBe(true);
    expect(sheet.getValue(0, 0)).toBe('v');
  });

  it('a no-op autoFormatSource toggle does not mark the document dirty', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    expect(sheet.isDirty).toBe(false);
    sheet.setAutoFormatSource(false); // already the default
    expect(sheet.isDirty).toBe(false);
  });

  it('round-trips autoFormatSource through save/load', () => {
    const sheet = rcsvFromCells([[0, 0, 'v']]);
    sheet.setAutoFormatSource(true);
    const bytes = sheet.toBytes();
    const reloaded = RsfDocument.fromBytes(bytes, 'again.rcsv');
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) expect(reloaded.doc.autoFormatSource).toBe(true);

    const off = rcsvFromCells([[0, 0, 'v']]);
    const offBytes = off.toBytes();
    const reloadedOff = RsfDocument.fromBytes(offBytes, 'again.rcsv');
    expect(reloadedOff.ok).toBe(true);
    if (reloadedOff.ok) expect(reloadedOff.doc.autoFormatSource).toBe(false);
  });

  it('restoreFromSnapshot replaces content with a past snapshot and is not itself dirty-tracked as an undo entry', () => {
    const sheet = rcsvFromCells([[0, 0, 'v1']]);
    sheet.toBytes(); // snapshot 0: v1
    sheet.setCell(0, 0, 'v2');
    sheet.toBytes(); // snapshot 1: v2
    sheet.setCell(0, 0, 'v3');
    expect(sheet.getValue(0, 0)).toBe('v3');

    const restored = sheet.restoreFromSnapshot(0);
    expect(restored).toBe(true);
    expect(sheet.getValue(0, 0)).toBe('v1');
    expect(sheet.isDirty).toBe(true);
    // Restoring is a content replacement, not a history-list mutation: the
    // snapshots recorded so far are untouched.
    expect(sheet.history.length).toBe(2);
  });

  it('restoreFromSnapshot returns false for an out-of-range index without changing anything', () => {
    const sheet = rcsvFromCells([[0, 0, 'v1']]);
    sheet.toBytes();
    expect(sheet.restoreFromSnapshot(5)).toBe(false);
    expect(sheet.getValue(0, 0)).toBe('v1');
  });

  it("restoreFromSnapshot keeps this file's own settings — history retention, cap override, and auto-format — as they are now", () => {
    const sheet = rcsvFromCells([[0, 0, 'v1']]);
    sheet.toBytes(); // snapshot 0, taken before any of these settings are changed
    sheet.setHistoryMaxOverride(5);
    sheet.setAutoFormatSource(true);
    sheet.setCell(0, 0, 'v2');

    sheet.restoreFromSnapshot(0);
    expect(sheet.getValue(0, 0)).toBe('v1');
    expect(sheet.historyMaxOverride).toBe(5);
    expect(sheet.autoFormatSource).toBe(true);
  });
});

describe('dirty state', () => {
  it('tracks mutations against the saved revision', () => {
    const sheet = rcsvFromCells([[0, 0, 'a']]);
    expect(sheet.isDirty).toBe(false);
    sheet.setCell(0, 0, 'b');
    expect(sheet.isDirty).toBe(true);
    sheet.markSaved();
    expect(sheet.isDirty).toBe(false);
    sheet.insertRows(0, [[]]);
    expect(sheet.isDirty).toBe(true);
  });

  it('ignores no-op cell writes', () => {
    const sheet = rcsvFromCells([[0, 0, 'a']]);
    sheet.setCell(0, 0, 'a');
    expect(sheet.isDirty).toBe(false);
  });
});

describe('blank documents (File > New)', () => {
  it('creates a usable grid at the documented default size, marked unsaved', () => {
    const sheet = RsfDocument.blank('untitled.rcsv');
    expect(sheet.rowCount).toBe(NEW_DOC_ROWS);
    expect(sheet.columnCount).toBe(NEW_DOC_COLS);
    expect(sheet.getValue(0, 0)).toBe('');
    // A never-saved document is dirty so closing prompts to save.
    expect(sheet.isDirty).toBe(true);
    sheet.markSaved();
    expect(sheet.isDirty).toBe(false);
  });
});

describe('CSV export (calculated values)', () => {
  it('exports formulas as their calculated values with minimal quoting', () => {
    const sheet = rcsvFromCells(
      [
        [0, 0, '1'],
        [0, 1, '2'],
        [1, 0, '=A1+B1'],
        [1, 1, 'has,comma'],
        [2, 0, 'quote"inside'],
        [2, 1, 'multi\nline'],
      ],
      3,
      2,
    );
    const csv = sheet.exportCsv();
    expect(csv).toBe('1,2\n3,"has,comma"\n"quote""inside","multi\nline"\n');
  });

  it('honours the delimiter setting', () => {
    const sheet = rcsvFromCells(
      [
        [0, 0, 'a;x'],
        [0, 1, 'b'],
      ],
      1,
      2,
    );
    expect(sheet.exportCsv(';')).toBe('"a;x";b\n');
  });
});

describe('structural mutators', () => {
  it('splices rows and columns and can grow for pastes', () => {
    const sheet = rcsvFromCells(
      [
        [0, 0, 'a'],
        [1, 0, 'b'],
      ],
      2,
      2,
    );
    sheet.insertRows(1, [['mid', 'x']]);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getValue(1, 0)).toBe('mid');
    const removed = sheet.deleteRows(1, 1);
    expect(removed).toEqual([['mid', 'x']]);
    expect(sheet.rowCount).toBe(2);

    sheet.insertCols(1, [['c1', 'c2']]);
    expect(sheet.columnCount).toBe(3);
    expect(sheet.getValue(0, 1)).toBe('c1');
    const removedCols = sheet.deleteCols(1, 1);
    expect(removedCols).toEqual([['c1', 'c2']]);
    expect(sheet.columnCount).toBe(2);

    sheet.ensureSize(5, 4);
    expect(sheet.rowCount).toBe(5);
    expect(sheet.columnCount).toBe(4);
    expect(sheet.getValue(4, 3)).toBe('');
  });
});
