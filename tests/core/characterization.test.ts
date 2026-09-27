// SPDX-License-Identifier: MIT
/**
 * Characterization snapshots for the structural refactoring
 * (docs/proposals/structural-refactoring-plan.md, R0):
 *
 * - every function-help example evaluated through a real workbook over a
 *   fixed data block, so moving the formula engine or the workbook's
 *   recalculation code cannot silently change a result; and
 * - the exported names of every core module, so splitting a module into a
 *   directory keeps its import surface exactly.
 *
 * A snapshot change here is a behaviour or API change and must be deliberate.
 */
import { describe, expect, it } from 'vitest';
import { RsfDocument } from '../../src/core/rsf-document';
import { FUNCTION_INFOS } from '../../src/core/formula';

/** A 30×10 workbook whose A1:D20 holds a deterministic mix of values. */
function corpusDoc(): RsfDocument {
  const doc = RsfDocument.empty('corpus.rsf', 30, 10);
  const words = ['apple', 'Banana', 'cherry', '', 'date', 'Éclair', '10', 'TRUE', 'x y', '2024-01-31'];
  for (let r = 0; r < 20; r++) {
    doc.setCell(r, 0, String((r * 7) % 13));
    doc.setCell(r, 1, String(r - 5.5));
    doc.setCell(r, 2, words[r % words.length]);
    doc.setCell(r, 3, r % 3 === 0 ? '' : String(r * 100));
  }
  return doc;
}

describe('recalculation corpus', () => {
  it('evaluates every non-volatile function example identically', () => {
    const results: Record<string, string> = {};
    for (const info of FUNCTION_INFOS) {
      if (info.volatile) continue;
      const doc = corpusDoc();
      doc.setCell(24, 8, info.example);
      results[`${info.name} ${info.example}`] = doc.getDisplayValue(24, 8);
    }
    expect(results).toMatchSnapshot();
  });
});

/**
 * Every core module that existed when the refactoring started, keyed by its
 * original name. When a module moves, only its import path here changes; the
 * key — and therefore the snapshot — stays.
 */
const CORE_MODULES: Record<string, () => Promise<unknown>> = {
  'app-identity': () => import('../../src/core/app-identity'),
  'byte-csv-parser': () => import('../../src/core/byte-csv-parser'),
  'cell-comment': () => import('../../src/core/cell-comment'),
  'cell-number-format': () => import('../../src/core/cell-number-format'),
  'cell-style': () => import('../../src/core/cell-style'),
  clipboard: () => import('../../src/core/clipboard'),
  'col-offset-index': () => import('../../src/core/col-offset-index'),
  'conditional-format': () => import('../../src/core/conditional-format'),
  'csv-engine': () => import('../../src/core/csv-engine'),
  'csv-export': () => import('../../src/core/csv-export'),
  'data-validation': () => import('../../src/core/data-validation'),
  'date-stamp': () => import('../../src/core/date-stamp'),
  'diff-engine': () => import('../../src/core/diff-engine'),
  'display-language': () => import('../../src/core/display-language'),
  encoding: () => import('../../src/core/encoding'),
  'fill-series': () => import('../../src/core/fill-series'),
  filter: () => import('../../src/core/filter'),
  'flash-fill': () => import('../../src/core/flash-fill'),
  formula: () => import('../../src/core/formula'),
  'formula-criteria': () => import('../../src/core/formula-criteria'),
  'formula-date': () => import('../../src/core/formula-date'),
  'formula-functions': () => import('../../src/core/formula-functions'),
  'formula-ref-toggle': () => import('../../src/core/formula-ref-toggle'),
  'formula-text': () => import('../../src/core/formula-text'),
  'formula-text-format': () => import('../../src/core/formula-text-format'),
  'formula-value': () => import('../../src/core/formula-value'),
  history: () => import('../../src/core/history'),
  'json-export': () => import('../../src/core/json-export'),
  'json-import': () => import('../../src/core/json-import'),
  'lossless-document': () => import('../../src/core/lossless-document'),
  markdown: () => import('../../src/core/markdown'),
  'range-move': () => import('../../src/core/range-move'),
  'rich-text': () => import('../../src/core/rich-text'),
  'row-height-index': () => import('../../src/core/row-height-index'),
  'rsf-codec': () => import('../../src/core/rsf-codec'),
  'rsf-document': () => import('../../src/core/rsf-document'),
  scheduler: () => import('../../src/core/scheduler'),
  'screenshot-layout': () => import('../../src/core/screenshot-layout'),
  search: () => import('../../src/core/search'),
  'selection-label': () => import('../../src/core/selection-label'),
  serializer: () => import('../../src/core/serializer'),
  'settings-cascade': () => import('../../src/core/settings-cascade'),
  sort: () => import('../../src/core/sort'),
  'source-validation': () => import('../../src/core/source-validation'),
  spill: () => import('../../src/core/spill'),
  'sql-engine': () => import('../../src/core/sql-engine'),
  stats: () => import('../../src/core/stats'),
  'syntax-highlight': () => import('../../src/core/syntax-highlight'),
  'text-editing': () => import('../../src/core/text-editing'),
  'text-wrap': () => import('../../src/core/text-wrap'),
  timezone: () => import('../../src/core/timezone'),
  validation: () => import('../../src/core/validation'),
  worksheet: () => import('../../src/core/worksheet'),
  'xlsx-export': () => import('../../src/core/xlsx-export'),
  'xlsx-import': () => import('../../src/core/xlsx-import'),
  'zstd-frame': () => import('../../src/core/zstd-frame'),
};

describe('core export surface', () => {
  it('keeps every core module exporting the same names', async () => {
    const surface: Record<string, string[]> = {};
    for (const [name, load] of Object.entries(CORE_MODULES)) {
      surface[name] = Object.keys((await load()) as Record<string, unknown>).sort();
    }
    expect(surface).toMatchSnapshot();
  });
});
