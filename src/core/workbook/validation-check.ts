// SPDX-License-Identifier: MIT
/**
 * Data > Check Data…: every cell that breaks its data-validation rule, on
 * one worksheet or across the workbook. Typing is already checked as it is
 * entered; this finds what got in some other way (a file saved before the
 * rule, a rule applied over existing values, a blank in a required column).
 * It only reports: nothing is changed or converted.
 *
 * Work is bounded: a rule is checked only down to the last row that holds
 * anything (blank rows below the data are not "missing"), and the scan
 * stops once `limit` problems are found.
 */
import { findValidation, validationProblem, type ValidationProblem } from './data-validation';
import type { Worksheet } from './worksheet';

/** One cell that breaks its rule. */
export interface ValidationIssue {
  sheetId: string;
  sheetName: string;
  row: number;
  col: number;
  value: string;
  problem: ValidationProblem;
}

/** The most problems one check lists. */
export const MAX_VALIDATION_ISSUES = 1000;

/** What a check found; `truncated` when it stopped at the limit. */
export interface ValidationCheck {
  issues: ValidationIssue[];
  truncated: boolean;
}

/** Check each worksheet in turn, in order, sharing one limit. */
export function checkValidations(
  sheets: readonly Worksheet[],
  limit: number = MAX_VALIDATION_ISSUES,
): ValidationCheck {
  const issues: ValidationIssue[] = [];
  for (const sheet of sheets) {
    if (checkSheet(sheet, issues, limit)) {
      return { issues, truncated: true };
    }
  }
  return { issues, truncated: false };
}

/** Adds `sheet`'s problems to `issues`; true when the limit stopped it. */
function checkSheet(sheet: Worksheet, issues: ValidationIssue[], limit: number): boolean {
  const rules = sheet.validations;
  if (rules.length === 0 || sheet.kind !== 'grid') {
    return false;
  }
  // The rules' combined box, cut off below the last row that holds anything
  // (a blank column of a required rule still counts), walked in reading
  // order; each cell answers to the rule that governs it.
  const used = sheet.usedExtent();
  const top = Math.min(...rules.map((v) => v.top));
  const left = Math.min(...rules.map((v) => v.left));
  const bottom = Math.min(
    used.rows - 1,
    Math.max(...rules.map((v) => (v.toEnd === true ? Infinity : v.bottom))),
  );
  const right = Math.max(...rules.map((v) => v.right));
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const rule = findValidation(rules, row, col);
      const value = rule ? sheet.getValue(row, col) : '';
      const problem = rule ? validationProblem(rule, value) : null;
      if (problem) {
        if (issues.length >= limit) {
          return true;
        }
        issues.push({ sheetId: sheet.id, sheetName: sheet.name, row, col, value, problem });
      }
    }
  }
  return false;
}
