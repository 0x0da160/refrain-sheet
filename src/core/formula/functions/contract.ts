// SPDX-License-Identifier: MIT
/**
 * The evaluation contract between the evaluator and every worksheet function
 * (see `./index.ts`).
 */
import type { DisplayLanguageId } from '../../workbook/display-language';
import type { FormulaValue, ValueGrid } from '../value';

// ---------------------------------------------------------------------------
// The evaluation contract
// ---------------------------------------------------------------------------

/** A grid, or the error that prevented one from being produced. */
export type GridResult = { ok: true; grid: ValueGrid } | { ok: false; error: FormulaValue };

/** What a function returns: one value, or a grid that spills. */
export type FnResult = FormulaValue | ValueGrid;

/** True when a function result is a grid rather than a single value. */
export function isGrid(result: FnResult): result is ValueGrid {
  return (result as ValueGrid).cells !== undefined;
}

/**
 * One argument of a call, evaluated on demand and memoized by the evaluator.
 */
export interface FnArg {
  /**
   * The argument as a single value. A multi-cell range or array collapses to
   * `#VALUE!`, matching the engine's scalar semantics.
   */
  value(): FormulaValue;
  /** The argument as a rectangular grid; a single value becomes 1×1. */
  grid(): GridResult;
  /**
   * True when the argument is written as a **range** (`A1:B2`, `A:A`, `1:10`,
   * or a worksheet-qualified one). A single cell reference is not a range —
   * that distinction is what makes `SUM(A1)` with text in `A1` a `#VALUE!`
   * while `SUM(A1:A1)` skips the text, which is the pre-existing behaviour.
   */
  isRange(): boolean;
  /** True when the argument slot was left empty (`XLOOKUP(a,b,c,,2)`). */
  isOmitted(): boolean;
}

/** Per-recalculation context handed to volatile functions. */
export interface FnContext {
  /**
   * The wall-clock instant this recalculation pass reads, in milliseconds
   * since the Unix epoch. Fixed for the whole pass so every `NOW()` in a
   * workbook agrees, and injectable so tests are not clock-dependent.
   */
  readonly nowMs: number;
  /**
   * The workbook's stored display language, read by `TEXT()`'s `ddd`/`dddd`
   * weekday-name tokens. See `display-language.ts`.
   */
  readonly displayLanguage: DisplayLanguageId;
}

/** Coarse grouping for the formula-help table (autocomplete ignores this). */
export type FunctionCategory =
  'math' | 'conditional' | 'logical' | 'lookup' | 'text' | 'date' | 'statistics' | 'arrays';

export interface FunctionDef {
  readonly name: string;
  /** Minimum argument count (inclusive). */
  readonly minArgs: number;
  /** Maximum argument count (inclusive); `Infinity` for variadic. */
  readonly maxArgs: number;
  /** Call signature shown in autocomplete and the help table. */
  readonly signature: string;
  /** A ready-to-read example formula shown in help. */
  readonly example: string;
  /** Coarse grouping for the formula-help table (autocomplete ignores this). */
  readonly category: FunctionCategory;
  /** True when the result depends on the clock rather than on cells. */
  readonly volatile?: boolean;
  /** True when the function can return a grid (a dynamic array). */
  readonly dynamic?: boolean;
  readonly call: (args: readonly FnArg[], ctx: FnContext) => FnResult;
}

/**
 * A function group's definitions, in registration order, and the `def` that
 * appends to them. Each group module registers its functions with `def` and
 * exports `defs`; `./index.ts` concatenates the groups into the registry.
 */
export function functionGroup(): { defs: FunctionDef[]; def: (entry: FunctionDef) => void } {
  const defs: FunctionDef[] = [];
  return { defs, def: (entry) => void defs.push(entry) };
}
