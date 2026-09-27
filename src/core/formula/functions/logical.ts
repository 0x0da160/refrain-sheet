// SPDX-License-Identifier: MIT
/**
 * Logical and error-handling functions.
 */
import { booleanValue, coerceToBoolean, type FormulaValue, makeGrid } from '../value';
import { collectValues, VALUE_ERR } from './helpers';
import { functionGroup, type FunctionDef } from './contract';

const { defs, def } = functionGroup();

// ----- Priority A: logical and error handling -----

for (const name of ['AND', 'OR'] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: Infinity,
    signature: `${name}(logical1, …)`,
    example: name === 'AND' ? '=AND(A1>0, B1<10)' : '=OR(A1>0, B1<10)',
    category: 'logical',
    call: (args) => {
      const values: FormulaValue[] = [];
      const err = collectValues(args, values);
      if (err) {
        return err;
      }
      let seen = 0;
      let result = name === 'AND';
      for (const v of values) {
        if (v.type === 'error') {
          return v;
        }
        // Text and blanks inside a range are ignored, as in conventional
        // spreadsheets; a bare text scalar is still a #VALUE!.
        if (v.type === 'empty') {
          continue;
        }
        const b = coerceToBoolean(v);
        if (b === null) {
          if (values.length === 1) {
            return VALUE_ERR;
          }
          continue;
        }
        seen += 1;
        result = name === 'AND' ? result && b : result || b;
      }
      return seen === 0 ? VALUE_ERR : booleanValue(result);
    },
  });
}

def({
  name: 'NOT',
  minArgs: 1,
  maxArgs: 1,
  signature: 'NOT(logical)',
  example: '=NOT(A1>10)',
  category: 'logical',
  call: (args) => {
    const v = args[0].value();
    if (v.type === 'error') {
      return v;
    }
    const b = coerceToBoolean(v);
    return b === null ? VALUE_ERR : booleanValue(!b);
  },
});

def({
  name: 'IFERROR',
  minArgs: 2,
  maxArgs: 2,
  signature: 'IFERROR(value, value_if_error)',
  example: '=IFERROR(A1/B1, 0)',
  category: 'logical',
  dynamic: true,
  call: (args) => {
    // The fallback is evaluated only when needed, and the first argument is
    // read as a grid so that an erroring dynamic array is caught too.
    const g = args[0].grid();
    if (!g.ok) {
      return args[1].value();
    }
    if (g.grid.rows === 1 && g.grid.cols === 1) {
      const v = g.grid.cells[0][0];
      return v.type === 'error' ? args[1].value() : v;
    }
    // For an array, any error anywhere is replaced cell by cell, so a single
    // bad row does not discard the whole result.
    const fallback = args[1].value();
    const cells = g.grid.cells.map((row) => row.map((v) => (v.type === 'error' ? fallback : v)));
    return makeGrid(cells);
  },
});

export const LOGICAL_FUNCTIONS: readonly FunctionDef[] = defs;
