// SPDX-License-Identifier: MIT
/**
 * Statistical functions.
 */
import { numberValue } from '../value';
import { collectNumbers, DIV0_ERR, NA_ERR, NUM_ERR, numberOf, standardDeviation } from './helpers';
import { functionGroup, type FunctionDef } from './contract';

const { defs, def } = functionGroup();

// ----- Priority C: statistics -----

def({
  name: 'MEDIAN',
  minArgs: 1,
  maxArgs: Infinity,
  signature: 'MEDIAN(number1, …)',
  example: '=MEDIAN(A1:A10)',
  category: 'statistics',
  call: (args) => {
    const numbers: number[] = [];
    for (const arg of args) {
      const err = collectNumbers(arg, numbers);
      if (err) {
        return err;
      }
    }
    if (numbers.length === 0) {
      return NUM_ERR;
    }
    const sorted = numbers.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return numberValue(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  },
});

def({
  name: 'MODE.SNGL',
  minArgs: 1,
  maxArgs: Infinity,
  signature: 'MODE.SNGL(number1, …)',
  example: '=MODE.SNGL(A1:A10)',
  category: 'statistics',
  call: (args) => {
    const numbers: number[] = [];
    for (const arg of args) {
      const err = collectNumbers(arg, numbers);
      if (err) {
        return err;
      }
    }
    const counts = new Map<number, number>();
    let best: number | null = null;
    let bestCount = 1;
    for (const n of numbers) {
      const c = (counts.get(n) ?? 0) + 1;
      counts.set(n, c);
      // Strictly greater keeps the *first* value to reach the highest count,
      // which makes ties deterministic and order-dependent in the documented
      // way (earliest wins).
      if (c > bestCount) {
        bestCount = c;
        best = n;
      }
    }
    return best === null ? NA_ERR : numberValue(best);
  },
});

for (const name of ['STDEV.S', 'STDEV.P'] as const) {
  const population = name === 'STDEV.P';
  def({
    name,
    minArgs: 1,
    maxArgs: Infinity,
    signature: `${name}(number1, …)`,
    example: `=${name}(A1:A10)`,
    category: 'statistics',
    call: (args) => {
      const numbers: number[] = [];
      for (const arg of args) {
        const err = collectNumbers(arg, numbers);
        if (err) {
          return err;
        }
      }
      const result = standardDeviation(numbers, population);
      // STDEV.S needs at least two values and STDEV.P at least one; anything
      // less is #DIV/0!, the conventional error for an empty divisor.
      return result === null ? DIV0_ERR : numberValue(result);
    },
  });
}

def({
  name: 'RANK.EQ',
  minArgs: 2,
  maxArgs: 3,
  signature: 'RANK.EQ(number, ref, [order])',
  example: '=RANK.EQ(A1, A1:A10)',
  category: 'statistics',
  call: (args) => {
    const target = numberOf(args[0]);
    if (!target.ok) {
      return target.error;
    }
    const numbers: number[] = [];
    const err = collectNumbers(args[1], numbers);
    if (err) {
      return err;
    }
    let ascending = false;
    if (args.length > 2 && !args[2].isOmitted()) {
      const o = numberOf(args[2]);
      if (!o.ok) {
        return o.error;
      }
      ascending = o.n !== 0;
    }
    if (!numbers.includes(target.n)) {
      return NA_ERR;
    }
    // Ties share the best (lowest) rank, and the ranks that would have
    // followed are skipped — the "EQ" in the name.
    let better = 0;
    for (const n of numbers) {
      if (ascending ? n < target.n : n > target.n) {
        better += 1;
      }
    }
    return numberValue(better + 1);
  },
});

export const STATISTICS_FUNCTIONS: readonly FunctionDef[] = defs;
