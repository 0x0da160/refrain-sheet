// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Data validation: the pure rule core (structural validation, membership,
 * "last rule wins" lookup) and the command-level flow — dialog apply/clear,
 * CSV-mode restriction, invalid-write refusal, following structural edits,
 * and undo.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import {
  Commands,
  type DataValidationDialogInput,
  type DataValidationDialogResult,
  type UiPort,
} from '../../src/app/commands';
import {
  checkValidationValue,
  findValidation,
  moveValidations,
  shiftValidationsForDelete,
  shiftValidationsForInsert,
  validateValidation,
  validationRangesEqual,
  MAX_VALIDATION_LIST_VALUES,
  MAX_VALIDATION_RULES,
  type CellValidation,
} from '../../src/core/workbook/data-validation';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { doc as csvDoc } from '../helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    confirmChangedOnDisk: vi.fn(async () => 'overwrite' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    confirmExportJson: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => 'down' as const),
    confirmFlashFill: vi.fn(async () => true),
    chooseFilter: vi.fn(async () => null),
    chooseColumnMenu: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    chooseConditionalFormat: vi.fn(async () => null),
    chooseCellComment: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    chooseSheetTabColor: vi.fn(async () => null),
    promptFolderName: vi.fn(async () => null),
    chooseFolder: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    promptGoToCell: vi.fn(async () => null),
    promptRowHeight: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showSqlQuery: vi.fn(async () => undefined),
    showDiff: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseVersionHistory: vi.fn(async () => null),
    confirmHistoryCapExceeded: vi.fn(async () => true),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    chooseFont: vi.fn(async () => null),
    chooseRecentFile: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

function sheet(values: string[][], ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const doc = RsfDocument.empty('t.rsf', values.length, values[0].length);
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      doc.setCell(r, c, values[r][c]);
    }
  }
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  return { state, commands, tab, doc, ui };
}

describe('rules follow row and column changes', () => {
  const rule = (top: number, bottom: number): CellValidation => ({
    top,
    left: 0,
    bottom,
    right: 0,
    rule: { kind: 'list', values: ['x'] },
  });
  const spans = (rules: CellValidation[]): Array<[number, number]> => rules.map((v) => [v.top, v.bottom]);

  it('an insert above moves a range, inside grows it, and below leaves it', () => {
    expect(spans(shiftValidationsForInsert([rule(2, 4)], 'row', 2, 3))).toEqual([[5, 7]]);
    expect(spans(shiftValidationsForInsert([rule(2, 4)], 'row', 3, 3))).toEqual([[2, 7]]);
    expect(spans(shiftValidationsForInsert([rule(2, 4)], 'row', 5, 3))).toEqual([[2, 4]]);
    expect(shiftValidationsForInsert([rule(2, 4)], 'col', 0, 1)[0]).toMatchObject({ left: 1, right: 1 });
  });

  it('a delete shrinks a range and drops one with no cells left', () => {
    expect(spans(shiftValidationsForDelete([rule(2, 4)], 'row', 0, 2))).toEqual([[0, 2]]);
    expect(spans(shiftValidationsForDelete([rule(2, 4)], 'row', 3, 1))).toEqual([[2, 3]]);
    expect(spans(shiftValidationsForDelete([rule(2, 4)], 'row', 1, 2))).toEqual([[1, 2]]);
    expect(spans(shiftValidationsForDelete([rule(2, 4)], 'row', 4, 5))).toEqual([[2, 3]]);
    expect(shiftValidationsForDelete([rule(2, 4)], 'row', 1, 5)).toEqual([]);
    expect(shiftValidationsForDelete([rule(2, 4)], 'col', 0, 1)).toEqual([]);
  });

  it('a move carries a rule inside the moved span and shifts the rest', () => {
    // Rows 0-1 move to just before row 5: they land at 3-4.
    expect(spans(moveValidations([rule(0, 1), rule(2, 2), rule(6, 7)], 'row', 0, 2, 5))).toEqual([
      [3, 4],
      [0, 0],
      [6, 7],
    ]);
    // Row 4 moves up to row 1; a rule over rows 0-5 keeps covering the same rows.
    expect(spans(moveValidations([rule(0, 5)], 'row', 4, 1, 1))).toEqual([[0, 5]]);
  });
});

describe('checkValidationValue', () => {
  it('a blank (or whitespace-only) value always passes, for either rule kind', () => {
    expect(checkValidationValue({ kind: 'list', values: ['a', 'b'] }, '')).toBe(true);
    expect(checkValidationValue({ kind: 'list', values: ['a', 'b'] }, '  ')).toBe(true);
    expect(checkValidationValue({ kind: 'number', min: 1, max: 10 }, '')).toBe(true);
  });

  it('list rule: exact membership only', () => {
    const rule = { kind: 'list' as const, values: ['Red', 'Green', 'Blue'] };
    expect(checkValidationValue(rule, 'Red')).toBe(true);
    expect(checkValidationValue(rule, 'red')).toBe(false); // case-sensitive
    expect(checkValidationValue(rule, 'Purple')).toBe(false);
  });

  it('number rule: within an inclusive [min, max], either bound optional', () => {
    expect(checkValidationValue({ kind: 'number', min: 1, max: 10 }, '5')).toBe(true);
    expect(checkValidationValue({ kind: 'number', min: 1, max: 10 }, '1')).toBe(true);
    expect(checkValidationValue({ kind: 'number', min: 1, max: 10 }, '10')).toBe(true);
    expect(checkValidationValue({ kind: 'number', min: 1, max: 10 }, '0')).toBe(false);
    expect(checkValidationValue({ kind: 'number', min: 1, max: 10 }, '11')).toBe(false);
    expect(checkValidationValue({ kind: 'number', min: null, max: 10 }, '-99')).toBe(true);
    expect(checkValidationValue({ kind: 'number', min: 1, max: null }, '99999')).toBe(true);
  });

  it('number rule: a non-numeric value never passes', () => {
    expect(checkValidationValue({ kind: 'number', min: 1, max: 10 }, 'abc')).toBe(false);
  });
});

describe('findValidation', () => {
  const a: CellValidation = { top: 0, left: 0, bottom: 1, right: 1, rule: { kind: 'list', values: ['a'] } };
  const b: CellValidation = { top: 1, left: 1, bottom: 2, right: 2, rule: { kind: 'list', values: ['b'] } };

  it('returns the rule covering the cell, or null when none does', () => {
    expect(findValidation([a], 0, 0)).toBe(a);
    expect(findValidation([a], 5, 5)).toBeNull();
  });

  it('when ranges overlap, the most recently applied rule (last in the array) wins', () => {
    expect(findValidation([a, b], 1, 1)).toBe(b); // overlap cell: b was applied later
    expect(findValidation([b, a], 1, 1)).toBe(a);
    expect(findValidation([a, b], 0, 0)).toBe(a); // only a covers this cell
  });
});

describe('validationRangesEqual', () => {
  it('compares only the rectangle, not the rule', () => {
    const r1 = { top: 0, left: 0, bottom: 2, right: 2 };
    const r2 = { top: 0, left: 0, bottom: 2, right: 2 };
    const r3 = { top: 0, left: 0, bottom: 3, right: 2 };
    expect(validationRangesEqual(r1, r2)).toBe(true);
    expect(validationRangesEqual(r1, r3)).toBe(false);
  });
});

describe('validateValidation', () => {
  it('accepts an in-bounds list rule and an in-bounds number rule', () => {
    const list: CellValidation = {
      top: 0,
      left: 0,
      bottom: 1,
      right: 1,
      rule: { kind: 'list', values: ['x'] },
    };
    expect(validateValidation(list, 4, 4)).not.toBeNull();
    const num: CellValidation = {
      top: 0,
      left: 0,
      bottom: 1,
      right: 1,
      rule: { kind: 'number', min: 0, max: 9 },
    };
    expect(validateValidation(num, 4, 4)).not.toBeNull();
  });

  it('rejects out-of-range coordinates and top > bottom / left > right', () => {
    const base = { top: 0, left: 0, bottom: 1, right: 1, rule: { kind: 'list' as const, values: ['x'] } };
    expect(validateValidation({ ...base, bottom: 99 }, 4, 4)).toBeNull();
    expect(validateValidation({ ...base, right: 99 }, 4, 4)).toBeNull();
    expect(validateValidation({ ...base, top: 3, bottom: 1 }, 4, 4)).toBeNull();
  });

  it('rejects an empty, oversized, or blank-containing value list', () => {
    const base = { top: 0, left: 0, bottom: 1, right: 1 };
    expect(validateValidation({ ...base, rule: { kind: 'list', values: [] } }, 4, 4)).toBeNull();
    expect(
      validateValidation(
        {
          ...base,
          rule: {
            kind: 'list',
            values: Array.from({ length: MAX_VALIDATION_LIST_VALUES + 1 }, (_, i) => String(i)),
          },
        },
        4,
        4,
      ),
    ).toBeNull();
    expect(validateValidation({ ...base, rule: { kind: 'list', values: ['a', ''] } }, 4, 4)).toBeNull();
  });

  it('accepts a number rule with no bound (any number) but rejects min > max', () => {
    const base = { top: 0, left: 0, bottom: 1, right: 1 };
    expect(
      validateValidation({ ...base, rule: { kind: 'number', min: null, max: null } }, 4, 4),
    ).not.toBeNull();
    expect(validateValidation({ ...base, rule: { kind: 'number', min: 10, max: 1 } }, 4, 4)).toBeNull();
  });
});

describe('data validation command flow', () => {
  it('applies via the dialog route to the selected range and reports it', async () => {
    const applied: DataValidationDialogResult = {
      action: 'apply',
      rule: { kind: 'list', values: ['Red', 'Green', 'Blue'] },
    };
    const ui = stubUi({ chooseDataValidation: vi.fn(async () => applied) });
    const { state, commands, tab, doc } = sheet(
      [
        ['', ''],
        ['', ''],
      ],
      ui,
    );
    state.setSelection(tab, { row: 0, col: 0 }, { row: 1, col: 0 });
    const ok = await commands.validationDialog(tab);
    expect(ok).toBe(true);
    expect(ui.chooseDataValidation).toHaveBeenCalled();
    expect(doc.validations).toHaveLength(1);
    expect(ui.notify).toHaveBeenCalled();
    expect(commands.validationAt(tab, 0, 0)?.rule).toEqual(applied.rule);
    expect(commands.validationAt(tab, 1, 1)).toBeNull(); // outside the applied range
  });

  it('CSV documents offer the explicit RSF conversion, then continue into the dialog', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => true) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('t.csv', csvDoc('a,b\n1,2\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.validationDialog(tab);
    expect(ui.confirmConvert).toHaveBeenCalledWith('validation', 't.csv');
    expect(ui.chooseDataValidation).toHaveBeenCalled();
    expect(tab.doc.kind).toBe('rsf');
  });

  it('declining the CSV -> RSF conversion offer leaves the document unchanged', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('t.csv', csvDoc('a,b\n1,2\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const result = await commands.validationDialog(tab);
    expect(result).toBe(false);
    expect(ui.confirmConvert).toHaveBeenCalledWith('validation', 't.csv');
    expect(ui.chooseDataValidation).not.toHaveBeenCalled();
    expect(tab.doc.kind).toBe('csv');
  });

  it('clearing removes exactly the rule covering the exact range and notifies', async () => {
    const { state, tab, doc } = sheet([
      ['', ''],
      ['', ''],
    ]);
    const rule: CellValidation = {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      rule: { kind: 'number', min: 0, max: 10 },
    };
    expect(state.setValidation(tab, rule)).toBe(true);
    expect(doc.validations).toHaveLength(1);
    const cleared: DataValidationDialogResult = { action: 'clear' };
    const ui = stubUi({ chooseDataValidation: vi.fn(async () => cleared) });
    const commands = new Commands(state, ui, document);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const ok = await commands.validationDialog(tab);
    expect(ok).toBe(true);
    expect(doc.validations).toHaveLength(0);
    expect(ui.notify).toHaveBeenCalled();
  });

  it('refuses an out-of-bounds or otherwise invalid rule with a localized message, applying nothing', async () => {
    const badRule: DataValidationDialogResult = { action: 'apply', rule: { kind: 'list', values: [] } };
    const ui = stubUi({ chooseDataValidation: vi.fn(async () => badRule) });
    const { state, tab, doc } = sheet([['']], ui);
    const commands = new Commands(state, ui, document);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const ok = await commands.validationDialog(tab);
    expect(ok).toBe(false);
    expect(ui.showMessage).toHaveBeenCalled();
    expect(doc.validations).toHaveLength(0);
  });

  it('refuses to add a rule beyond MAX_VALIDATION_RULES for a new range, but still allows replacing an existing one', async () => {
    const { state, tab, doc } = sheet(Array.from({ length: MAX_VALIDATION_RULES + 1 }, () => ['']));
    for (let i = 0; i < MAX_VALIDATION_RULES; i++) {
      expect(
        state.setValidation(tab, {
          top: i,
          left: 0,
          bottom: i,
          right: 0,
          rule: { kind: 'list', values: ['x'] },
        }),
      ).toBe(true);
    }
    expect(doc.validations).toHaveLength(MAX_VALIDATION_RULES);

    const newRule: DataValidationDialogResult = { action: 'apply', rule: { kind: 'list', values: ['y'] } };
    const ui = stubUi({
      chooseDataValidation: vi.fn(async () => newRule),
    });
    const commands = new Commands(state, ui, document);
    // A brand-new range beyond the cap is refused.
    state.setSelection(tab, { row: MAX_VALIDATION_RULES, col: 0 }, null);
    expect(await commands.validationDialog(tab)).toBe(false);
    expect(ui.showMessage).toHaveBeenCalled();
    expect(doc.validations).toHaveLength(MAX_VALIDATION_RULES);

    // Replacing the rule on an already-covered exact range is still allowed.
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.validationDialog(tab)).toBe(true);
    expect(doc.validations).toHaveLength(MAX_VALIDATION_RULES);
  });

  it('refuses a single-cell edit that violates the rule covering it, announcing why', () => {
    const { state, tab, doc } = sheet([['']]);
    const announced: string[] = [];
    state.announce = (message) => announced.push(message);
    const rule: CellValidation = {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      rule: { kind: 'list', values: ['ok'] },
    };
    expect(state.setValidation(tab, rule)).toBe(true);
    expect(state.editCell(tab, 0, 0, 'bad')).toBe(false);
    expect(announced.length).toBeGreaterThan(0);
    expect(doc.getValue(0, 0)).toBe('');
    expect(state.editCell(tab, 0, 0, 'ok')).toBe(true);
    expect(doc.getValue(0, 0)).toBe('ok');
    expect(state.editCell(tab, 0, 0, '')).toBe(true); // clearing is always allowed
  });

  it('refuses a bulk edit that touches any cell violating its rule, all-or-nothing', () => {
    const { state, tab, doc } = sheet([[''], ['']]);
    const rule: CellValidation = {
      top: 0,
      left: 0,
      bottom: 1,
      right: 0,
      rule: { kind: 'number', min: 0, max: 10 },
    };
    expect(state.setValidation(tab, rule)).toBe(true);
    const applied = state.bulkEdit(
      tab,
      [
        { row: 0, col: 0, before: '', after: '5' },
        { row: 1, col: 0, before: '', after: '999' }, // violates the rule
      ],
      'history.paste',
    );
    expect(applied).toBe(false);
    expect(doc.getValue(0, 0)).toBe('');
    expect(doc.getValue(1, 0)).toBe('');
  });

  it('follows row and column inserts and deletes, and undo restores a removed rule', () => {
    const { state, tab, doc } = sheet([[''], [''], [''], ['']]);
    const rule: CellValidation = {
      top: 1,
      left: 0,
      bottom: 2,
      right: 0,
      rule: { kind: 'list', values: ['x'] },
    };
    expect(state.setValidation(tab, rule)).toBe(true);
    expect(state.insertRows(tab, 0, 1)).toBe(true); // above: moves
    expect(doc.validations[0]).toMatchObject({ top: 2, bottom: 3 });
    expect(state.insertRows(tab, 3, 2)).toBe(true); // inside: grows
    expect(doc.validations[0]).toMatchObject({ top: 2, bottom: 5 });
    expect(state.insertCols(tab, 0, 1)).toBe(true);
    expect(doc.validations[0]).toMatchObject({ left: 1, right: 1 });
    expect(state.deleteRows(tab, 2, 4)).toBe(true); // every row of the rule
    expect(doc.validations).toHaveLength(0);
    state.undo(tab);
    expect(doc.validations[0]).toMatchObject({ top: 2, bottom: 5, left: 1, right: 1 });
    state.redo(tab);
    expect(doc.validations).toHaveLength(0);
  });

  it('saves the rules with the file', () => {
    const { state, tab, doc } = sheet([[''], ['']]);
    const rule: CellValidation = {
      top: 0,
      left: 0,
      bottom: 1,
      right: 0,
      rule: { kind: 'list', values: ['x'] },
    };
    expect(state.setValidation(tab, rule)).toBe(true);
    const reopened = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(reopened.ok && reopened.doc.validations).toEqual([rule]);
  });

  it('moves a rule with the rows it is on', () => {
    const { state, tab, doc } = sheet([['a'], ['b'], ['c'], ['d']]);
    const rule: CellValidation = {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      rule: { kind: 'number', min: 1, max: null },
    };
    expect(state.setValidation(tab, rule)).toBe(true);
    expect(state.moveAxis(tab, 'row', 0, 1, 3)).toBe(true);
    expect(doc.validations[0]).toMatchObject({ top: 2, bottom: 2 });
    state.undo(tab);
    expect(doc.validations[0]).toMatchObject({ top: 0, bottom: 0 });
  });

  it('is saved with the file: undoable, and marks the document changed', () => {
    const { state, tab, doc } = sheet([['']]);
    expect(doc.isDirty).toBe(false);
    const rule: CellValidation = {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      rule: { kind: 'list', values: ['x'] },
    };
    expect(state.setValidation(tab, rule)).toBe(true);
    expect(doc.isDirty).toBe(true);
    expect(tab.history.canUndo).toBe(true);
    state.undo(tab);
    expect(doc.validations).toHaveLength(0);
    state.redo(tab);
    expect(doc.validations).toHaveLength(1);
    expect(state.clearValidation(tab, rule)).toBe(true);
    expect(doc.validations).toHaveLength(0);
    state.undo(tab);
    expect(doc.validations).toEqual([rule]);
  });

  it('several rules can be active at once, each covering its own range', () => {
    const { state, tab, doc } = sheet([[''], ['']]);
    expect(
      state.setValidation(tab, {
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        rule: { kind: 'list', values: ['a'] },
      }),
    ).toBe(true);
    expect(
      state.setValidation(tab, {
        top: 1,
        left: 0,
        bottom: 1,
        right: 0,
        rule: { kind: 'number', min: 0, max: 5 },
      }),
    ).toBe(true);
    expect(doc.validations).toHaveLength(2);
    expect(state.editCell(tab, 0, 0, 'a')).toBe(true);
    expect(state.editCell(tab, 1, 0, '3')).toBe(true);
  });
});

describe('column schema through the dialog', () => {
  it('applies a required whole-number rule to entire columns below the header, covering rows added later', async () => {
    const result: DataValidationDialogResult = {
      action: 'apply',
      rule: { kind: 'number', min: 0, max: null, integer: true },
      required: true,
      columns: { headerRow: true },
    };
    const ui = stubUi({ chooseDataValidation: vi.fn(async () => result) });
    const { state, commands, tab, doc } = sheet([['Qty'], ['1'], ['2']], ui);
    state.setSelection(tab, { row: 1, col: 0 }, { row: 1, col: 0 });
    expect(await commands.validationDialog(tab)).toBe(true);
    const input = vi.mocked(ui.chooseDataValidation).mock.calls[0][0];
    expect(input.columns).toEqual({ label: 'A:A', checked: false, headerRow: true });
    expect(doc.validations).toEqual([
      { top: 1, left: 0, bottom: 2, right: 0, rule: result.rule, required: true, toEnd: true },
    ]);
    expect(state.insertRows(tab, 3, 1)).toBe(true); // a row added at the end
    expect(state.editCell(tab, 3, 0, '1.5')).toBe(false);
    expect(state.editCell(tab, 3, 0, '4')).toBe(true);
    expect(state.editCell(tab, 0, 0, 'Quantity')).toBe(true); // the header row stays free
    expect(state.editCell(tab, 1, 0, '')).toBe(false); // required
  });

  it('reopens a column rule from any cell in its columns, and applying again replaces it', async () => {
    const first: DataValidationDialogResult = {
      action: 'apply',
      rule: { kind: 'list', values: ['a'] },
      columns: { headerRow: false },
    };
    const second: DataValidationDialogResult = {
      action: 'apply',
      rule: { kind: 'textLength', min: null, max: 2 },
      columns: { headerRow: true },
    };
    const choose = vi
      .fn(async (_input: DataValidationDialogInput) => first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const ui = stubUi({ chooseDataValidation: choose });
    const { state, commands, tab, doc } = sheet([['a'], ['a'], ['a']], ui);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 0, col: 0 });
    await commands.validationDialog(tab);
    state.setSelection(tab, { row: 2, col: 0 }, { row: 2, col: 0 });
    await commands.validationDialog(tab);
    const reopened = choose.mock.calls[1][0];
    expect(reopened.existing).toEqual(first.rule);
    expect(reopened.columns).toEqual({ label: 'A:A', checked: true, headerRow: false });
    expect(doc.validations).toHaveLength(1);
    expect(doc.validations[0]).toMatchObject({ top: 1, rule: second.rule, toEnd: true });
  });

  it('names the reason when a value is refused', () => {
    const { state, tab } = sheet([['']]);
    const announced: string[] = [];
    state.announce = (message) => announced.push(message);
    state.setValidation(tab, {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      rule: { kind: 'date', min: '2026-01-01', max: null },
    });
    expect(state.editCell(tab, 0, 0, '2025-12-31')).toBe(false);
    expect(announced[announced.length - 1]).toContain('the date is before the earliest allowed');
  });
});
