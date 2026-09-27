// SPDX-License-Identifier: MIT
// Repository layout and naming gate.
//
// The directory structure is documented in README.md ("Project layout") and
// knowledge/architecture/module-boundaries.md. Nothing kept it from eroding —
// a new file could land under a one-off name or in the wrong place and the
// structure would drift one pull request at a time. This script is the check.
// It reads `git ls-files`, so only tracked files count.
//
//   1. File names under src/, tests/, scripts/, site/, bench/, docs/ and
//      knowledge/ are kebab-case (`a-b.c`), except CLAUDE.md / README.md.
//      Generated output (src/generated/) and the frozen fixture corpus
//      (tests/fixtures/) are exempt.
//   2. A module is either a file or a directory, never both: no `x.ts`
//      beside an `x/` directory. A directory module's entry is `x/index.ts`.
//   3. Tests live in tests/<area>/ for a known area, never at the top level;
//      the top level holds only shared helpers.
//   4. Every src/styles/*.css is imported by src/styles/index.css, and every
//      import there names an existing file.
//   5. Scripts live in a role directory under scripts/, never at its top level.
//   6. No TypeScript source file under src/ is longer than MAX_SOURCE_LINES,
//      except the files in LINE_BUDGET, each capped at its recorded size. The
//      budget is a ratchet (docs/proposals/structural-refactoring-plan.md):
//      a listed file may shrink but never grow, and an entry is removed once
//      its file fits the limit, so the list only ever gets shorter.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && existsSync(join(root, f)));

const TEST_AREAS = new Set(['core', 'app', 'ui', 'tooling', 'site', 'fixtures']);
const SCRIPT_ROLES = new Set(['build', 'check', 'release', 'lib', 'ui-check']);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)+$/;
const NAMED_DIRS = ['src/', 'tests/', 'scripts/', 'site/', 'bench/', 'docs/', 'knowledge/'];
const EXEMPT = ['src/generated/', 'tests/fixtures/'];

const MAX_SOURCE_LINES = 800;
/** Oversized files, each capped at its current line count. Shrink, never grow. */
const LINE_BUDGET = {
  'src/core/workbook/rsf-codec.ts': 1160,
  'src/ui/dialogs/shared.ts': 880,
  'src/core/workbook/worksheet.ts': 823,
};

const errors = [];

for (const file of files) {
  if (!NAMED_DIRS.some((d) => file.startsWith(d)) || EXEMPT.some((d) => file.startsWith(d))) continue;
  const name = basename(file);
  if (name === 'CLAUDE.md' || name === 'README.md') continue;
  if (!KEBAB.test(name)) errors.push(`${file}: file name is not kebab-case`);
}

const dirs = new Set(files.map((f) => dirname(f)));
for (const file of files) {
  if (!file.startsWith('src/') || !/\.(ts|css)$/.test(file)) continue;
  const bare = file.replace(/\.(ts|css)$/, '');
  if (dirs.has(bare)) errors.push(`${file}: sits beside a ${bare}/ directory; move it to ${bare}/index.ts`);
}

for (const file of files) {
  if (!file.startsWith('tests/')) continue;
  const parts = file.split('/');
  if (parts.length === 2) {
    if (file.endsWith('.test.ts'))
      errors.push(`${file}: tests belong in tests/<area>/ (${[...TEST_AREAS].join(', ')})`);
  } else if (!TEST_AREAS.has(parts[1])) {
    errors.push(`${file}: unknown test area tests/${parts[1]}/`);
  }
}

for (const file of files) {
  if (!file.startsWith('scripts/')) continue;
  const parts = file.split('/');
  if (parts.length === 2 || !SCRIPT_ROLES.has(parts[1])) {
    errors.push(`${file}: scripts belong in scripts/<role>/ (${[...SCRIPT_ROLES].join(', ')})`);
  }
}

const loader = readFileSync(join(root, 'src/styles/index.css'), 'utf8');
const imported = new Set([...loader.matchAll(/^@import '\.\/(.+?)';$/gm)].map((m) => `src/styles/${m[1]}`));
for (const file of files) {
  if (/^src\/styles\/[^/]+\.css$/.test(file) && file !== 'src/styles/index.css' && !imported.has(file)) {
    errors.push(`${file}: not imported by src/styles/index.css`);
  }
}
for (const file of imported) {
  if (!existsSync(join(root, file))) errors.push(`src/styles/index.css: imports missing ${file}`);
}

const tracked = new Set(files);
for (const file of files) {
  if (!file.startsWith('src/') || !file.endsWith('.ts') || file.startsWith('src/generated/')) continue;
  const lines = readFileSync(join(root, file), 'utf8').split('\n').length - 1;
  const budget = LINE_BUDGET[file];
  if (budget === undefined) {
    if (lines > MAX_SOURCE_LINES) {
      errors.push(`${file}: ${lines} lines; split it below ${MAX_SOURCE_LINES} (see src/*/CLAUDE.md)`);
    }
  } else if (lines > budget) {
    errors.push(`${file}: grew to ${lines} lines past its ${budget}-line budget; split it instead`);
  } else if (lines <= MAX_SOURCE_LINES) {
    errors.push(`${file}: now ${lines} lines; remove its LINE_BUDGET entry`);
  } else if (lines < budget) {
    errors.push(`${file}: shrank to ${lines} lines; lower its LINE_BUDGET entry to ${lines}`);
  }
}
for (const file of Object.keys(LINE_BUDGET)) {
  if (!tracked.has(file)) errors.push(`LINE_BUDGET: ${file} no longer exists; remove its entry`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`check-layout: FAIL: ${e}`);
  process.exit(1);
}
console.warn(`check-layout: ok: ${files.length} tracked files follow the layout and naming rules`);
