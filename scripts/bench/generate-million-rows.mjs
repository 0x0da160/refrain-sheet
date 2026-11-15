// SPDX-License-Identifier: MIT
// Writes the million-row sales-analysis demo workbook as a `.rsf` file.
//
//   npm run bench:million-rows:generate -- [--rows 1000000] [--seed 20261115] [--out <file.rsf>]
//
// The workbook has three worksheets — 売上明細 (the detail rows), 商品マスター
// (the product master) and 集計 (the summary) — built from the deterministic
// data in ./million-rows-data.mjs, so the same arguments always produce the
// same JSON document. Its layout is documented in
// knowledge/operations/million-row-demo.md.
//
// A `<file>.json` manifest is written next to it: the counts, the SHA-256 of
// the JSON document and the totals a correct application must display.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SEED, FULL_ROWS } from './million-rows-data.mjs';
import { buildDemoWorkbook } from './million-rows-workbook.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readArgs(argv) {
  const args = { rows: FULL_ROWS, seed: DEFAULT_SEED, out: null };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--rows') args.rows = Number(value);
    else if (argv[i] === '--seed') args.seed = Number(value);
    else if (argv[i] === '--out') args.out = value;
    else continue;
    i += 1;
  }
  if (!Number.isInteger(args.rows) || args.rows < 1 || args.rows > 1_999_999) {
    throw new Error('--rows must be a whole number from 1 to 1999999');
  }
  if (!Number.isInteger(args.seed)) {
    throw new Error('--seed must be a whole number');
  }
  args.out = resolve(args.out ?? join(root, 'bench', 'data', `sales-analysis-${args.rows}.rsf`));
  return args;
}

const args = readArgs(process.argv.slice(2));
const started = Date.now();
const { file, manifest } = buildDemoWorkbook(args.rows, args.seed);
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, file);
writeFileSync(`${args.out}.json`, JSON.stringify(manifest, null, 2) + '\n');
console.warn(
  `generate-million-rows: wrote ${args.out} (${args.rows} data rows, ` +
    `${(manifest.jsonBytes / 1048576).toFixed(1)} MiB JSON, ${(manifest.fileBytes / 1048576).toFixed(1)} MiB file, ` +
    `${((Date.now() - started) / 1000).toFixed(1)} s)`,
);
console.warn(`generate-million-rows: JSON sha256 ${manifest.jsonSha256}`);
