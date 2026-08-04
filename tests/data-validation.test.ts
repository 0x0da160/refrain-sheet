// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Data validation: the pure rule core (structural validation, membership,
 * "last rule wins" lookup) and the command-level flow — dialog apply/clear,
 * CSV-mode restriction, invalid-write refusal, structural-edit interaction,
 * and non-undoable/non-dirty session-only behavior. Mirrors `sort.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type DataValidationDialogResult, type UiPort } from '../src/app/commands';
import {
  checkValidationValue,
  findValidation,
  validateValidation,
  validationRangesEqual,
  MAX_VALIDATION_LIST_VALUES,
  MAX_VALIDATION_RULES,
  type CellValidation,
} from '../src/core/data-validation';
import { RsfDocument } from '../src/core/rsf-document';
import { doc as csvDoc } from './helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => 'down' as const),
    confirmFlashFill: vi.fn(async () => true),
    chooseFilter: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showSqlQuery: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
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

  it('rejects a number rule with both bounds null, or min > max', () => {
    const base = { top: 0, left: 0, bottom: 1, right: 1 };
    expect(validateValidation({ ...base, rule: { kind: 'number', min: null, max: null } }, 4, 4)).toBeNull();
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

  it('CSV documents refuse to open the dialog with a localized explanation', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('t.csv', csvDoc('a,b\n1,2\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const result = await commands.validationDialog(tab);
    expect(result).toBe(false);
    expect(ui.showMessage).toHaveBeenCalled();
    expect(ui.chooseDataValidation).not.toHaveBeenCalled();
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

  it('structural row/column edits drop every active validation rule', () => {
    const { state, tab, doc } = sheet([[''], ['']]);
    const rule: CellValidation = {
      top: 0,
      left: 0,
      bottom: 1,
      right: 0,
      rule: { kind: 'list', values: ['x'] },
    };
    expect(state.setValidation(tab, rule)).toBe(true);
    expect(state.insertRows(tab, 0, 1)).toBe(true);
    expect(doc.validations).toHaveLength(0);
  });

  it('is session-only view state: not undoable and does not mark the document dirty', () => {
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
    expect(doc.isDirty).toBe(false);
    expect(tab.history.canUndo).toBe(false);
    state.undo(tab); // no-op: nothing to undo
    expect(doc.validations).toHaveLength(1); // survives, since it was never history-tracked
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
