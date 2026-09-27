// SPDX-License-Identifier: MIT
/**
 * Math and rounding functions.
 */
import { numberValue } from '../value';
import { DIV0_ERR, NUM_ERR, numberOf, optionalNumber, roundTo } from './helpers';
import { functionGroup, type FunctionDef } from './contract';

const { defs, def } = functionGroup();

// ----- Priority A: math and rounding -----

for (const [name, mode] of [
  ['ROUND', 'half'],
  ['ROUNDUP', 'up'],
  ['ROUNDDOWN', 'down'],
] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: 2,
    signature: `${name}(number, num_digits)`,
    example: `=${name}(A1, 2)`,
    category: 'math',
    call: (args) => {
      const n = numberOf(args[0]);
      if (!n.ok) {
        return n.error;
      }
      const digits = optionalNumber(args, 1, 0);
      if (!digits.ok) {
        return digits.error;
      }
      const result = roundTo(n.n, digits.n, mode);
      return result === null ? NUM_ERR : numberValue(result);
    },
  });
}

def({
  name: 'ABS',
  minArgs: 1,
  maxArgs: 1,
  signature: 'ABS(number)',
  example: '=ABS(A1)',
  category: 'math',
  call: (args) => {
    const n = numberOf(args[0]);
    return n.ok ? numberValue(Math.abs(n.n)) : n.error;
  },
});

def({
  name: 'MOD',
  minArgs: 2,
  maxArgs: 2,
  signature: 'MOD(number, divisor)',
  example: '=MOD(A1, 3)',
  category: 'math',
  call: (args) => {
    const a = numberOf(args[0]);
    if (!a.ok) {
      return a.error;
    }
    const b = numberOf(args[1]);
    if (!b.ok) {
      return b.error;
    }
    if (b.n === 0) {
      return DIV0_ERR;
    }
    // Spreadsheet MOD takes the sign of the divisor, unlike JavaScript's `%`
    // which takes the sign of the dividend: MOD(-3, 2) is 1, not -1.
    return numberValue(a.n - b.n * Math.floor(a.n / b.n));
  },
});

export const MATH_FUNCTIONS: readonly FunctionDef[] = defs;
