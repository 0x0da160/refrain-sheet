// SPDX-License-Identifier: MIT
/**
 * Guards that the formula help, autocomplete, and evaluator cannot drift: they
 * all derive from FUNCTION_INFOS / SUPPORTED_FUNCTIONS. The help dialog table
 * and the autocomplete popup are thin generated views over FUNCTION_INFOS, so
 * verifying the shared data (plus localized descriptions and parseable/
 * evaluable examples) proves every implemented function is documented,
 * complet(able), and evaluable.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../src/app/i18n';
import {
  EMPTY_VALUE,
  FUNCTION_INFOS,
  SUPPORTED_FUNCTIONS,
  evaluateAst,
  functionCompletions,
  parseFormula,
} from '../src/core/formula';

describe('formula help / autocomplete / evaluator share one source of truth', () => {
  it('FUNCTION_INFOS covers exactly the supported functions', () => {
    expect(FUNCTION_INFOS.map((f) => f.name)).toEqual([...SUPPORTED_FUNCTIONS]);
  });

  it('every function has a signature, example, and a description in both locales', () => {
    for (const info of FUNCTION_INFOS) {
      expect(info.signature.length, `signature for ${info.name}`).toBeGreaterThan(0);
      expect(info.example.startsWith('='), `example for ${info.name}`).toBe(true);
      const descKey = `formula.fn.${info.name}`;
      expect(CATALOGS.en[descKey], `en ${descKey}`).toBeTruthy();
      expect(CATALOGS.ja[descKey], `ja ${descKey}`).toBeTruthy();
    }
  });

  it('every documented example parses and evaluates without a #NAME? error', () => {
    const ctx = { getCell: () => EMPTY_VALUE, rowCount: 100, columnCount: 100 };
    for (const info of FUNCTION_INFOS) {
      const parsed = parseFormula(info.example);
      expect(parsed.ok, `parse ${info.example}`).toBe(true);
      if (!parsed.ok) continue;
      const value = evaluateAst(parsed.ast, ctx);
      // The function is implemented: it never resolves to "unknown name".
      if (value.type === 'error') {
        expect(value.code, `evaluate ${info.example}`).not.toBe('#NAME?');
      }
    }
  });

  it('autocomplete offers every function by name prefix', () => {
    for (const info of FUNCTION_INFOS) {
      const text = `=${info.name}`;
      const { matches } = functionCompletions(text, text.length);
      expect(
        matches.map((m) => m.name),
        `completion for ${info.name}`,
      ).toContain(info.name);
    }
  });

  it('all formula-help error-code descriptions exist in both locales', () => {
    for (const key of [
      'dialog.formulaHelp.err.error',
      'dialog.formulaHelp.err.name',
      'dialog.formulaHelp.err.value',
      'dialog.formulaHelp.err.div0',
      'dialog.formulaHelp.err.ref',
      'dialog.formulaHelp.err.cycle',
    ]) {
      expect(CATALOGS.en[key], `en ${key}`).toBeTruthy();
      expect(CATALOGS.ja[key], `ja ${key}`).toBeTruthy();
    }
  });
});
