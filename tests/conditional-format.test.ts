// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Conditional formatting: the pure rule core (structural validation,
 * cell-value/duplicate/color-scale matching, color interpolation) and the
 * command-level flow — dialog apply/clear, CSV-mode restriction, the rule
 * cap, and non-undoable/non-dirty session-only behavior. Mirrors
 * `data-validation.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type ConditionalFormatDialogResult, type UiPort } from '../src/app/commands';
import {
  colorScaleColor,
  colorScaleRange,
  conditionalFormatRangesEqual,
  duplicateKey,
  findDuplicateKeys,
  interpolateHexColor,
  matchesCellValueRule,
  validateConditionalFormat,
  MAX_CONDITIONAL_FORMAT_RULES,
  type CellConditionalFormat,
  type CellValueRule,
  type ColorScaleRule,
} from '../src/core/conditional-format';
import type { FormulaValue } from '../src/core/formula-value';
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
    chooseConditionalFormat: vi.fn(async () => null),
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
    showDiff: vi.fn(async () => undefined),
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

const num = (value: number): FormulaValue => ({ type: 'number', value });
const str = (value: string): FormulaValue => ({ type: 'string', value });
const empty: FormulaValue = { type: 'empty' };
const bool = (value: boolean): FormulaValue => ({ type: 'boolean', value });

describe('conditionalFormatRangesEqual', () => {
  it('compares only the rectangle, not the rule', () => {
    const r1 = { top: 0, left: 0, bottom: 2, right: 2 };
    const r2 = { top: 0, left: 0, bottom: 2, right: 2 };
    const r3 = { top: 0, left: 0, bottom: 3, right: 2 };
    expect(conditionalFormatRangesEqual(r1, r2)).toBe(true);
    expect(conditionalFormatRangesEqual(r1, r3)).toBe(false);
  });
});

describe('matchesCellValueRule', () => {
  const style = { backgroundColor: '#ff0000' };

  it('greaterThan / lessThan / equal compare a number cell against value1', () => {
    const gt: CellValueRule = { kind: 'cellValue', operator: 'greaterThan', value1: '10', style };
    expect(matchesCellValueRule(gt, num(11))).toBe(true);
    expect(matchesCellValueRule(gt, num(10))).toBe(false);

    const lt: CellValueRule = { kind: 'cellValue', operator: 'lessThan', value1: '10', style };
    expect(matchesCellValueRule(lt, num(9))).toBe(true);
    expect(matchesCellValueRule(lt, num(10))).toBe(false);

    const eq: CellValueRule = { kind: 'cellValue', operator: 'equal', value1: '10', style };
    expect(matchesCellValueRule(eq, num(10))).toBe(true);
    expect(matchesCellValueRule(eq, num(10.5))).toBe(false);
  });

  it('between is inclusive and order-independent', () => {
    const rule: CellValueRule = { kind: 'cellValue', operator: 'between', value1: '10', value2: '1', style };
    expect(matchesCellValueRule(rule, num(1))).toBe(true);
    expect(matchesCellValueRule(rule, num(10))).toBe(true);
    expect(matchesCellValueRule(rule, num(5))).toBe(true);
    expect(matchesCellValueRule(rule, num(11))).toBe(false);
  });

  it('textContains is a case-insensitive substring match, and also matches numbers as text', () => {
    const rule: CellValueRule = { kind: 'cellValue', operator: 'textContains', value1: 'oo', style };
    expect(matchesCellValueRule(rule, str('Foobar'))).toBe(true);
    expect(matchesCellValueRule(rule, str('bar'))).toBe(false);
    const digits: CellValueRule = { kind: 'cellValue', operator: 'textContains', value1: '12', style };
    expect(matchesCellValueRule(digits, num(123))).toBe(true);
  });

  it('blank, boolean, and error cells never match a numeric operator', () => {
    const rule: CellValueRule = { kind: 'cellValue', operator: 'greaterThan', value1: '0', style };
    expect(matchesCellValueRule(rule, empty)).toBe(false);
    expect(matchesCellValueRule(rule, bool(true))).toBe(false);
    expect(matchesCellValueRule(rule, { type: 'error', code: '#VALUE!' })).toBe(false);
  });
});

describe('duplicateKey / findDuplicateKeys', () => {
  it('numbers and text never collide even when they print the same', () => {
    expect(duplicateKey(num(1))).not.toBe(duplicateKey(str('1')));
  });

  it('blank cells never participate in duplicate detection', () => {
    expect(duplicateKey(empty)).toBeNull();
    expect(duplicateKey(str(''))).toBeNull();
  });

  it('finds exactly the keys that occur more than once, ignoring blanks', () => {
    const keys = [
      duplicateKey(num(1)),
      duplicateKey(num(2)),
      duplicateKey(num(1)),
      duplicateKey(str('x')),
      duplicateKey(empty),
    ];
    const dup = findDuplicateKeys(keys);
    expect(dup.has(duplicateKey(num(1))!)).toBe(true);
    expect(dup.has(duplicateKey(num(2))!)).toBe(false);
    expect(dup.has(duplicateKey(str('x'))!)).toBe(false);
    expect(dup.size).toBe(1);
  });
});

describe('color scale', () => {
  it('interpolateHexColor blends linearly and clamps t to [0, 1]', () => {
    expect(interpolateHexColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(interpolateHexColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(interpolateHexColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(interpolateHexColor('#000000', '#ffffff', 2)).toBe('#ffffff');
    expect(interpolateHexColor('#000000', '#ffffff', -1)).toBe('#000000');
  });

  it('colorScaleRange is the [min, max] of the values, or null when empty', () => {
    expect(colorScaleRange([3, 1, 2])).toEqual({ min: 1, max: 3 });
    expect(colorScaleRange([])).toBeNull();
  });

  it('colorScaleColor maps a value proportionally between minColor and maxColor', () => {
    const rule: ColorScaleRule = { kind: 'colorScale', minColor: '#000000', maxColor: '#ffffff' };
    expect(colorScaleColor(rule, 0, { min: 0, max: 10 })).toBe('#000000');
    expect(colorScaleColor(rule, 10, { min: 0, max: 10 })).toBe('#ffffff');
    expect(colorScaleColor(rule, 5, { min: 0, max: 10 })).toBe('#808080');
  });

  it('a degenerate (min === max) range paints every cell minColor', () => {
    const rule: ColorScaleRule = { kind: 'colorScale', minColor: '#112233', maxColor: '#ffffff' };
    expect(colorScaleColor(rule, 7, { min: 7, max: 7 })).toBe('#112233');
  });
});

describe('validateConditionalFormat', () => {
  const base = { top: 0, left: 0, bottom: 1, right: 1 };
  const style = { backgroundColor: '#ff0000' };

  it('accepts an in-bounds cellValue, duplicate, and colorScale rule', () => {
    const cellValue: CellConditionalFormat = {
      ...base,
      rule: { kind: 'cellValue', operator: 'greaterThan', value1: '10', style },
    };
    expect(validateConditionalFormat(cellValue, 4, 4)).not.toBeNull();

    const duplicate: CellConditionalFormat = { ...base, rule: { kind: 'duplicate', style } };
    expect(validateConditionalFormat(duplicate, 4, 4)).not.toBeNull();

    const scale: CellConditionalFormat = {
      ...base,
      rule: { kind: 'colorScale', minColor: '#000000', maxColor: '#ffffff' },
    };
    expect(validateConditionalFormat(scale, 4, 4)).not.toBeNull();
  });

  it('rejects out-of-range coordinates and top > bottom / left > right', () => {
    const rule = { kind: 'duplicate' as const, style };
    expect(validateConditionalFormat({ ...base, rule, bottom: 99 }, 4, 4)).toBeNull();
    expect(validateConditionalFormat({ ...base, rule, right: 99 }, 4, 4)).toBeNull();
    expect(validateConditionalFormat({ ...base, rule, top: 3, bottom: 1 }, 4, 4)).toBeNull();
  });

  it('rejects a cellValue rule with a non-numeric operand, a missing between bound, or blank textContains text', () => {
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'cellValue', operator: 'greaterThan', value1: 'abc', style } },
        4,
        4,
      ),
    ).toBeNull();
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'cellValue', operator: 'between', value1: '1', value2: 'abc', style } },
        4,
        4,
      ),
    ).toBeNull();
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'cellValue', operator: 'textContains', value1: '  ', style } },
        4,
        4,
      ),
    ).toBeNull();
  });

  it('rejects a rule whose style carries neither color, or an invalid hex color', () => {
    expect(validateConditionalFormat({ ...base, rule: { kind: 'duplicate', style: {} } }, 4, 4)).toBeNull();
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'duplicate', style: { backgroundColor: 'red' } } },
        4,
        4,
      ),
    ).toBeNull();
  });

  it('rejects a colorScale rule with an invalid hex color', () => {
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'colorScale', minColor: 'black', maxColor: '#ffffff' } },
        4,
        4,
      ),
    ).toBeNull();
  });
});

describe('conditional format command flow', () => {
  it('applies via the dialog route to the selected range, reports it, and colors matching cells', async () => {
    const applied: ConditionalFormatDialogResult = {
      action: 'apply',
      rule: {
        kind: 'cellValue',
        operator: 'greaterThan',
        value1: '10',
        style: { backgroundColor: '#ff0000' },
      },
    };
    const ui = stubUi({ chooseConditionalFormat: vi.fn(async () => applied) });
    const { state, commands, tab, doc } = sheet(
      [
        ['5', '20'],
        ['', ''],
      ],
      ui,
    );
    state.setSelection(tab, { row: 0, col: 0 }, { row: 0, col: 1 });
    const ok = await commands.conditionalFormatDialog(tab);
    expect(ok).toBe(true);
    expect(ui.chooseConditionalFormat).toHaveBeenCalled();
    expect(doc.conditionalFormats).toHaveLength(1);
    expect(ui.notify).toHaveBeenCalled();
    expect(doc.getConditionalFormatStyle(0, 0)).toBeNull(); // 5 does not satisfy > 10
    expect(doc.getConditionalFormatStyle(0, 1)).toEqual({ backgroundColor: '#ff0000' }); // 20 does
    expect(doc.getConditionalFormatStyle(1, 0)).toBeNull(); // outside the applied range
  });

  it('CSV documents refuse to open the dialog with a localized explanation', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('t.csv', csvDoc('a,b\n1,2\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const result = await commands.conditionalFormatDialog(tab);
    expect(result).toBe(false);
    expect(ui.showMessage).toHaveBeenCalled();
    expect(ui.chooseConditionalFormat).not.toHaveBeenCalled();
  });

  it('clearing removes exactly the rule covering the exact range and notifies', async () => {
    const { state, tab, doc } = sheet([['1', '2']]);
    const format: CellConditionalFormat = {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      rule: { kind: 'duplicate', style: { backgroundColor: '#ff0000' } },
    };
    expect(state.setConditionalFormat(tab, format)).toBe(true);
    expect(doc.conditionalFormats).toHaveLength(1);
    const cleared: ConditionalFormatDialogResult = { action: 'clear' };
    const ui = stubUi({ chooseConditionalFormat: vi.fn(async () => cleared) });
    const commands = new Commands(state, ui, document);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const ok = await commands.conditionalFormatDialog(tab);
    expect(ok).toBe(true);
    expect(doc.conditionalFormats).toHaveLength(0);
    expect(ui.notify).toHaveBeenCalled();
  });

  it('refuses an out-of-bounds or otherwise invalid rule with a localized message, applying nothing', async () => {
    const badRule: ConditionalFormatDialogResult = {
      action: 'apply',
      rule: { kind: 'duplicate', style: {} }, // neither color set: invalid
    };
    const ui = stubUi({ chooseConditionalFormat: vi.fn(async () => badRule) });
    const { state, tab, doc } = sheet([['']], ui);
    const commands = new Commands(state, ui, document);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const ok = await commands.conditionalFormatDialog(tab);
    expect(ok).toBe(false);
    expect(ui.showMessage).toHaveBeenCalled();
    expect(doc.conditionalFormats).toHaveLength(0);
  });

  it('refuses to add a rule beyond MAX_CONDITIONAL_FORMAT_RULES for a new range, but still allows replacing an existing one', async () => {
    const { state, tab, doc } = sheet(Array.from({ length: MAX_CONDITIONAL_FORMAT_RULES + 1 }, () => ['']));
    for (let i = 0; i < MAX_CONDITIONAL_FORMAT_RULES; i++) {
      expect(
        state.setConditionalFormat(tab, {
          top: i,
          left: 0,
          bottom: i,
          right: 0,
          rule: { kind: 'duplicate', style: { backgroundColor: '#ff0000' } },
        }),
      ).toBe(true);
    }
    expect(doc.conditionalFormats).toHaveLength(MAX_CONDITIONAL_FORMAT_RULES);

    const newRule: ConditionalFormatDialogResult = {
      action: 'apply',
      rule: { kind: 'duplicate', style: { backgroundColor: '#00ff00' } },
    };
    const ui = stubUi({ chooseConditionalFormat: vi.fn(async () => newRule) });
    const commands = new Commands(state, ui, document);
    // A brand-new range beyond the cap is refused.
    state.setSelection(tab, { row: MAX_CONDITIONAL_FORMAT_RULES, col: 0 }, null);
    expect(await commands.conditionalFormatDialog(tab)).toBe(false);
    expect(ui.showMessage).toHaveBeenCalled();
    expect(doc.conditionalFormats).toHaveLength(MAX_CONDITIONAL_FORMAT_RULES);

    // Replacing the rule on an already-covered exact range is still allowed.
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.conditionalFormatDialog(tab)).toBe(true);
    expect(doc.conditionalFormats).toHaveLength(MAX_CONDITIONAL_FORMAT_RULES);
  });

  it('structural row/column edits drop every active conditional-formatting rule', () => {
    const { state, tab, doc } = sheet([['1'], ['2']]);
    const format: CellConditionalFormat = {
      top: 0,
      left: 0,
      bottom: 1,
      right: 0,
      rule: { kind: 'duplicate', style: { backgroundColor: '#ff0000' } },
    };
    expect(state.setConditionalFormat(tab, format)).toBe(true);
    expect(state.insertRows(tab, 0, 1)).toBe(true);
    expect(doc.conditionalFormats).toHaveLength(0);
  });

  it('is session-only view state: not undoable, does not mark the document dirty, and never changes cell values', () => {
    const { state, tab, doc } = sheet([['5']]);
    expect(doc.isDirty).toBe(false);
    const format: CellConditionalFormat = {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      rule: {
        kind: 'cellValue',
        operator: 'greaterThan',
        value1: '1',
        style: { backgroundColor: '#ff0000' },
      },
    };
    expect(state.setConditionalFormat(tab, format)).toBe(true);
    expect(doc.isDirty).toBe(false);
    expect(tab.history.canUndo).toBe(false);
    state.undo(tab); // no-op: nothing to undo
    expect(doc.conditionalFormats).toHaveLength(1); // survives, since it was never history-tracked
    expect(doc.getValue(0, 0)).toBe('5'); // the cell's value is untouched
  });

  it('several rules can be active at once, each covering its own range, and only the last-applied overlap wins', () => {
    const { state, tab, doc } = sheet([['5'], ['5']]);
    expect(
      state.setConditionalFormat(tab, {
        top: 0,
        left: 0,
        bottom: 1,
        right: 0,
        rule: {
          kind: 'cellValue',
          operator: 'greaterThan',
          value1: '1',
          style: { backgroundColor: '#ff0000' },
        },
      }),
    ).toBe(true);
    expect(
      state.setConditionalFormat(tab, {
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        rule: {
          kind: 'cellValue',
          operator: 'greaterThan',
          value1: '1',
          style: { backgroundColor: '#00ff00' },
        },
      }),
    ).toBe(true);
    expect(doc.conditionalFormats).toHaveLength(2);
    // Row 0 is covered by both; the more recently applied rule wins.
    expect(doc.getConditionalFormatStyle(0, 0)).toEqual({ backgroundColor: '#00ff00' });
    // Row 1 is covered only by the first rule.
    expect(doc.getConditionalFormatStyle(1, 0)).toEqual({ backgroundColor: '#ff0000' });
  });
});
