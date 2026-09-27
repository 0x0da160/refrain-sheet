// SPDX-License-Identifier: MIT
/**
 * Date and time functions.
 */
import {
  dateDif,
  isDateDifUnit,
  nowSerial,
  partsToSerial,
  remapShortYear,
  serialToParts,
  todaySerial,
} from '../date';
import { numberValue } from '../value';
import { NUM_ERR, numberOf, textOf, VALUE_ERR } from './helpers';
import { functionGroup, type FunctionDef } from './contract';

const { defs, def } = functionGroup();

// ----- Priority C: date and time -----

def({
  name: 'TODAY',
  minArgs: 0,
  maxArgs: 0,
  signature: 'TODAY()',
  example: '=TODAY()',
  category: 'date',
  volatile: true,
  call: (_args, ctx) => numberValue(todaySerial(ctx.nowMs)),
});

def({
  name: 'NOW',
  minArgs: 0,
  maxArgs: 0,
  signature: 'NOW()',
  example: '=NOW()',
  category: 'date',
  volatile: true,
  call: (_args, ctx) => numberValue(nowSerial(ctx.nowMs)),
});

def({
  name: 'DATE',
  minArgs: 3,
  maxArgs: 3,
  signature: 'DATE(year, month, day)',
  example: '=DATE(2026, 7, 25)',
  category: 'date',
  call: (args) => {
    const y = numberOf(args[0]);
    if (!y.ok) {
      return y.error;
    }
    const m = numberOf(args[1]);
    if (!m.ok) {
      return m.error;
    }
    const d = numberOf(args[2]);
    if (!d.ok) {
      return d.error;
    }
    // DATE's own two-digit-year rule runs first; the serial scale itself does
    // no year remapping.
    const year = remapShortYear(y.n);
    if (year === null) {
      return NUM_ERR;
    }
    const serial = partsToSerial(year, m.n, d.n);
    return serial === null ? NUM_ERR : numberValue(serial);
  },
});

for (const name of ['YEAR', 'MONTH', 'DAY'] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: 1,
    signature: `${name}(serial_number)`,
    example: `=${name}(A1)`,
    category: 'date',
    call: (args) => {
      const n = numberOf(args[0]);
      if (!n.ok) {
        return n.error;
      }
      const parts = serialToParts(n.n);
      if (!parts) {
        return NUM_ERR;
      }
      return numberValue(name === 'YEAR' ? parts.year : name === 'MONTH' ? parts.month : parts.day);
    },
  });
}

def({
  name: 'DATEDIF',
  minArgs: 3,
  maxArgs: 3,
  signature: 'DATEDIF(start_date, end_date, unit)',
  example: '=DATEDIF(A1, B1, "Y")',
  category: 'date',
  call: (args) => {
    const start = numberOf(args[0]);
    if (!start.ok) {
      return start.error;
    }
    const end = numberOf(args[1]);
    if (!end.ok) {
      return end.error;
    }
    const unitText = textOf(args[2]);
    if (!unitText.ok) {
      return unitText.error;
    }
    const unit = unitText.s.trim().toUpperCase();
    if (!isDateDifUnit(unit)) {
      return VALUE_ERR;
    }
    const result = dateDif(start.n, end.n, unit);
    return result === null ? NUM_ERR : numberValue(result);
  },
});

export const DATE_FUNCTIONS: readonly FunctionDef[] = defs;
