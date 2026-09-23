// SPDX-License-Identifier: MIT
// OKF v0.2 frontmatter gate for knowledge/.
//
// The knowledge/ bundle (see knowledge/index.md) follows Open Knowledge
// Format v0.2: every concept file needs parseable YAML frontmatter with a
// non-empty `type`, and the bundle's reserved files carry no concept
// frontmatter of their own. Nothing enforced this — a migration PR could
// land a concept file with broken or missing frontmatter and nothing would
// notice until a reader (human or agent) hit it. This script is the check.
//
// Frontmatter rules, one per kind of file:
//   1. knowledge/index.md (the bundle root, exactly one) — must have
//      frontmatter with a non-empty `okf_version`.
//   2. Every other index.md, and every log.md (domain/sub-bundle indexes
//      and the bundle log) — reserved: must NOT start with a frontmatter
//      block at all.
//   3. Every other knowledge/**/*.md file — a concept file: must start with
//      frontmatter that parses as YAML and has a non-empty `type`.
//
// Plus reference checks on every file except the append-only log.md (which
// may name files that have since been removed):
//   4. every relative Markdown link resolves to an existing file,
//   5. every backticked repository path (`src/…`, `scripts/…`, …) outside the
//      frontmatter exists,
//   6. a concept whose `stale_after` date has passed is reported as a GitHub
//      warning annotation (not a failure — a date alone must not turn an
//      unrelated pull request red), so the numbers get re-measured.
//
// Pass --verbose to list every passing file.
//
// Uses the `yaml` package already in package.json's dependencies (the same
// one src/ui/yaml-sheet.ts uses) rather than a hand-rolled parser or a new
// dependency.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const KNOWLEDGE_DIR = join(root, 'knowledge');
const BUNDLE_ROOT_INDEX = join(KNOWLEDGE_DIR, 'index.md');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

let failures = 0;
const fail = (file, msg) => {
  failures += 1;
  console.error(`check-knowledge-frontmatter: FAIL: ${file}: ${msg}`);
};
const VERBOSE = process.argv.includes('--verbose');
const ok = (file, msg) => {
  if (VERBOSE) console.warn(`check-knowledge-frontmatter: ok: ${file}: ${msg}`);
};
const warn = (file, msg) => console.warn(`::warning file=${file}::${msg}`);

const REPO_PATH_RE =
  /`((?:src|scripts|tests|knowledge|docs|wasm|bench|\.github|\.claude)\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.[a-z]+)(?::\d+(?:-\d+)?)?`/g;
const LINK_RE = /\]\(([^)\s]+)\)/g;

function checkReferences(full, label) {
  const body = readFileSync(full, 'utf8').replace(FRONTMATTER_RE, '');
  for (const [, target] of body.matchAll(LINK_RE)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    const path = decodeURI(target.split('#')[0]);
    if (!existsSync(resolve(dirname(full), path))) fail(label, `broken relative link: ${target}`);
  }
  for (const [, path] of body.matchAll(REPO_PATH_RE)) {
    if (!existsSync(join(root, path))) fail(label, `names a repository path that does not exist: ${path}`);
  }
}

function checkStaleAfter(doc, label) {
  if (doc.stale_after === undefined) return;
  const when = new Date(doc.stale_after);
  if (Number.isNaN(when.getTime())) {
    fail(label, `stale_after is not a date: ${doc.stale_after}`);
  } else if (when.getTime() < Date.now()) {
    warn(
      label,
      `stale_after (${when.toISOString().slice(0, 10)}) has passed — re-verify this concept and bump the date`,
    );
  }
}

function listMarkdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listMarkdownFiles(full));
    } else if (name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function checkReserved(full, label) {
  const content = readFileSync(full, 'utf8');
  if (FRONTMATTER_RE.test(content)) {
    fail(label, 'reserved file must not carry a frontmatter block');
    return;
  }
  ok(label, 'reserved, no frontmatter (correct)');
}

function checkConcept(full, label) {
  const content = readFileSync(full, 'utf8');
  const m = content.match(FRONTMATTER_RE);
  if (!m) {
    fail(label, 'missing frontmatter block (concept files must start with ---)');
    return;
  }
  let doc;
  try {
    doc = parseYaml(m[1]);
  } catch (e) {
    fail(label, `frontmatter does not parse as YAML: ${e.message}`);
    return;
  }
  if (doc === null || typeof doc !== 'object') {
    fail(label, 'frontmatter must be a YAML mapping');
    return;
  }
  if (typeof doc.type !== 'string' || doc.type.trim() === '') {
    fail(label, 'frontmatter `type` is missing or empty');
    return;
  }
  checkStaleAfter(doc, label);
  ok(label, `type=${doc.type}`);
}

function checkBundleRoot(full, label) {
  const content = readFileSync(full, 'utf8');
  const m = content.match(FRONTMATTER_RE);
  if (!m) {
    fail(label, 'bundle root index.md must have frontmatter with okf_version');
    return;
  }
  let doc;
  try {
    doc = parseYaml(m[1]);
  } catch (e) {
    fail(label, `frontmatter does not parse as YAML: ${e.message}`);
    return;
  }
  if (!doc || typeof doc.okf_version !== 'string' || doc.okf_version.trim() === '') {
    fail(label, 'bundle root frontmatter `okf_version` is missing or empty');
    return;
  }
  ok(label, `okf_version=${doc.okf_version}`);
}

function main() {
  const files = listMarkdownFiles(KNOWLEDGE_DIR);
  for (const full of files) {
    const label = relative(root, full);
    const base = full.split('/').pop();
    if (full === BUNDLE_ROOT_INDEX) {
      checkBundleRoot(full, label);
    } else if (base === 'index.md' || base === 'log.md') {
      checkReserved(full, label);
    } else {
      checkConcept(full, label);
    }
    if (base !== 'log.md') checkReferences(full, label);
  }

  if (failures > 0) {
    console.error(`check-knowledge-frontmatter: ${failures} file(s) failed.`);
    process.exit(1);
  }
  console.warn(`check-knowledge-frontmatter: all ${files.length} files in knowledge/ are valid.`);
}

main();
