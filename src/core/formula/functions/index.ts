// SPDX-License-Identifier: MIT
/**
 * The function registry: the single source of truth for every worksheet
 * function.
 *
 * One {@link FunctionDef} per function drives *all* of:
 *
 * - which names the parser accepts (anything else is `#NAME?`),
 * - argument-count validation,
 * - evaluation,
 * - the autocomplete popup,
 * - the offline help dialog's function table,
 * - the localized description key (`formula.fn.<NAME>` in `en.json` / `ja.json`).
 *
 * A function therefore cannot be implemented without being documented, or
 * documented without being implemented — `tests/app/formula-help.test.ts` asserts
 * exactly that, and the i18n parity test asserts both locales describe every
 * entry.
 *
 * ## Evaluation contract
 *
 * A function receives {@link FnArg} accessors, never pre-computed values. The
 * accessors are lazy and memoized, which is what lets `IF` and `IFERROR` skip
 * the branch they do not need — evaluating an unused branch could raise an
 * error the formula is specifically written to avoid.
 *
 * A function returns either a single {@link FormulaValue} or a
 * {@link ValueGrid}. Returning a grid makes the formula a **dynamic array**:
 * the workbook spills it across the worksheet (see `spill.ts`).
 *
 * Nothing here uses `eval`, `new Function`, regular expressions built from user
 * input, the network, or the DOM.
 */

import type { FunctionCategory, FunctionDef } from './contract';
import { AGGREGATE_FUNCTIONS } from './aggregate';
import { LOGICAL_FUNCTIONS } from './logical';
import { MATH_FUNCTIONS } from './math';
import { LOOKUP_FUNCTIONS } from './lookup';
import { TEXT_FUNCTIONS } from './strings';
import { DATE_FUNCTIONS } from './dates';
import { STATISTICS_FUNCTIONS } from './statistics';
import { ARRAY_FUNCTIONS } from './arrays';

export {
  type FnArg,
  type FnContext,
  type FnResult,
  type FunctionCategory,
  type FunctionDef,
  type GridResult,
  isGrid,
} from './contract';

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** Every definition, in the order the groups register them. */
const DEFS: readonly FunctionDef[] = [
  ...AGGREGATE_FUNCTIONS,
  ...LOGICAL_FUNCTIONS,
  ...MATH_FUNCTIONS,
  ...LOOKUP_FUNCTIONS,
  ...TEXT_FUNCTIONS,
  ...DATE_FUNCTIONS,
  ...STATISTICS_FUNCTIONS,
  ...ARRAY_FUNCTIONS,
];

// ---------------------------------------------------------------------------
// Registry access
// ---------------------------------------------------------------------------

const BY_NAME = new Map<string, FunctionDef>();
for (const entry of DEFS) {
  BY_NAME.set(entry.name, entry);
}

/** Every function definition, sorted by name for stable help/autocomplete output. */
const FUNCTION_DEFS: readonly FunctionDef[] = DEFS.slice().sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
);

/** Every supported function name, sorted. */
export const SUPPORTED_FUNCTIONS: readonly string[] = FUNCTION_DEFS.map((f) => f.name);

/** Look up a function by its already-upper-cased name. */
export function lookupFunction(name: string): FunctionDef | null {
  return BY_NAME.get(name) ?? null;
}

/** The display metadata the help dialog and autocomplete read. */
export interface FunctionInfo {
  name: string;
  signature: string;
  example: string;
  category: FunctionCategory;
  volatile?: boolean;
  dynamic?: boolean;
}

/**
 * Display metadata for every function. Kept as a separate, plain-data view so
 * the UI layer never holds a reference to an implementation closure.
 */
export const FUNCTION_INFOS: readonly FunctionInfo[] = FUNCTION_DEFS.map((entry) => ({
  name: entry.name,
  signature: entry.signature,
  example: entry.example,
  category: entry.category,
  ...(entry.volatile === true ? { volatile: true } : {}),
  ...(entry.dynamic === true ? { dynamic: true } : {}),
}));

/** Names of the functions marked volatile, for documentation and tests. */
export const VOLATILE_FUNCTIONS: readonly string[] = FUNCTION_DEFS.filter((f) => f.volatile).map(
  (f) => f.name,
);
