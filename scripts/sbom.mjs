// SPDX-License-Identifier: MIT
// Full-inventory CycloneDX SBOM: everything that builds, tests, or ships
// Refrain Sheet, not just the production npm tree.
//
// `npm run sbom` (npm's built-in `npm sbom --omit=dev`) is what the release
// attaches: the runtime npm dependencies that reach the bundle. It cannot see
// the Rust crates linked into the embedded WASM, the toolchains that produce
// the build (Node.js, Rust, wasm-pack, wasm-bindgen-cli, the Debian base image
// of the Docker toolchain), or the GitHub Actions the workflows run — and those
// are exactly what reaches end of life on a schedule. This script reads every
// one of them from the files that pin them and emits one CycloneDX 1.5 JSON:
//
//   npm run sbom:full                  → refrain-sheet.full.sbom.json
//   node scripts/sbom.mjs --out -      → stdout
//
// Every component carries a `refrain:scope` property:
//
//   direct     — a dependency this repository declares itself
//                (package.json, wasm/Cargo.toml)
//   toolchain  — a runtime, compiler, build tool, base image, or CI action
//   transitive — pulled in by a direct dependency (pinned in a lockfile)
//
// `npm run check:eol` builds the same document and requires every `direct`
// and `toolchain` component to have a lifecycle entry in
// docs/eol-register.json (see knowledge/operations/dependency-lifecycle.md).
// Offline and deterministic: it reads only committed files.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The lifecycle "cycle" a version belongs to — the unit an upstream supports
 * or retires. SemVer majors for >=1, `0.minor` below 1 (where every minor
 * may break), and a bare major for runtimes pinned by major (`24`, `v7`).
 */
export function cycleOf(version) {
  const m = /^v?(\d+)(?:\.(\d+))?/.exec(String(version));
  if (!m) return String(version);
  if (m[1] === '0' && m[2] !== undefined) return `0.${m[2]}`;
  return m[1];
}

function readText(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

/** `[[package]]` entries of a Cargo.lock: name, version, and whether it came from crates.io. */
function parseCargoLock(text) {
  const out = [];
  for (const block of text.split('[[package]]').slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    const registry = /^source = "registry\+/m.test(block);
    if (name && version) out.push({ name, version, registry });
  }
  return out;
}

/** `name = "=x.y.z"` / `name = { version = "…" }` lines of the [dependencies] table. */
function parseCargoDirectDeps(text) {
  const section = /^\[dependencies\]\s*$([\s\S]*?)(?=^\[)/m.exec(text)?.[1] ?? '';
  const names = [];
  for (const line of section.split('\n')) {
    const m = /^([A-Za-z0-9_-]+)\s*=/.exec(line.trim());
    if (m) names.push(m[1]);
  }
  return names;
}

function workflowFiles(root) {
  const dir = join(root, '.github', 'workflows');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => ({ path: `.github/workflows/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
}

/**
 * Every component, as plain records:
 *   { name, version, cycle, ecosystem: npm|cargo|github|generic, scope, dev?, sources[] }
 * `sources` lists the committed files that pin it, so a reviewer (or
 * check:eol's message) can see where to change it.
 */
export function collectInventory(root = defaultRoot) {
  const components = [];
  const add = (c) => {
    const existing = components.find(
      (x) => x.ecosystem === c.ecosystem && x.name === c.name && x.version === c.version,
    );
    if (existing) {
      for (const s of c.sources) if (!existing.sources.includes(s)) existing.sources.push(s);
      return;
    }
    components.push({ ...c, cycle: c.cycle ?? cycleOf(c.version) });
  };

  // ----- npm: every package in the lockfile -----
  const pkg = JSON.parse(readText(root, 'package.json'));
  const lock = JSON.parse(readText(root, 'package-lock.json'));
  const direct = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === '' || !entry.version) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const isDirect = path === `node_modules/${name}` && direct.has(name);
    add({
      name,
      version: entry.version,
      ecosystem: 'npm',
      scope: isDirect ? 'direct' : 'transitive',
      dev: entry.dev === true,
      license: typeof entry.license === 'string' ? entry.license : undefined,
      sources: [isDirect ? 'package.json' : 'package-lock.json'],
    });
  }

  // ----- Rust crates linked into the embedded WASM (and its build-time macros) -----
  const cargoDirect = new Set(parseCargoDirectDeps(readText(root, 'wasm/Cargo.toml')));
  for (const crate of parseCargoLock(readText(root, 'wasm/Cargo.lock'))) {
    if (!crate.registry) continue; // the workspace crate itself
    add({
      name: crate.name,
      version: crate.version,
      ecosystem: 'cargo',
      scope: cargoDirect.has(crate.name) ? 'direct' : 'transitive',
      sources: [cargoDirect.has(crate.name) ? 'wasm/Cargo.toml' : 'wasm/Cargo.lock'],
    });
  }

  // ----- Toolchains -----
  const dockerfile = readText(root, 'Dockerfile');
  const from = /^FROM node:(\d+)-([a-z]+)-slim/m.exec(dockerfile);
  if (from) {
    add({
      name: 'nodejs',
      version: from[1],
      ecosystem: 'generic',
      scope: 'toolchain',
      sources: ['Dockerfile'],
    });
    add({
      name: 'debian',
      version: from[2],
      cycle: from[2],
      ecosystem: 'generic',
      scope: 'toolchain',
      sources: ['Dockerfile'],
    });
  }
  const arg = (name) => new RegExp(`^ARG ${name}=(\\S+)`, 'm').exec(dockerfile)?.[1];
  const rustChannel = /^channel = "([^"]+)"/m.exec(readText(root, 'rust-toolchain.toml'))?.[1];
  if (rustChannel) {
    const [maj, min] = rustChannel.split('.');
    add({
      name: 'rust',
      version: rustChannel,
      cycle: `${maj}.${min}`,
      ecosystem: 'generic',
      scope: 'toolchain',
      sources: ['rust-toolchain.toml'],
    });
  }
  for (const [name, argName] of [
    ['rustup', 'RUSTUP_VERSION'],
    ['wasm-pack', 'WASM_PACK_VERSION'],
    ['wasm-bindgen-cli', 'WASM_BINDGEN_VERSION'],
  ]) {
    const v = arg(argName);
    if (v)
      add({
        name,
        version: v.replace(/^v/, ''),
        ecosystem: 'generic',
        scope: 'toolchain',
        sources: ['Dockerfile'],
      });
  }

  // ----- GitHub Actions and the Node.js versions workflows run on -----
  for (const wf of workflowFiles(root)) {
    for (const m of wf.text.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@([\w.-]+)/g)) {
      add({ name: m[1], version: m[2], ecosystem: 'github', scope: 'toolchain', sources: [wf.path] });
    }
    for (const m of wf.text.matchAll(/node-version:\s*['"]?(\d+)/g)) {
      add({ name: 'nodejs', version: m[1], ecosystem: 'generic', scope: 'toolchain', sources: [wf.path] });
    }
  }

  components.sort((a, b) =>
    `${a.scope}\0${a.ecosystem}\0${a.name}\0${a.version}`.localeCompare(
      `${b.scope}\0${b.ecosystem}\0${b.name}\0${b.version}`,
    ),
  );
  return { name: pkg.name, version: pkg.version, components };
}

function purlOf(c) {
  if (c.ecosystem === 'npm') {
    const name = c.name.startsWith('@') ? `%40${c.name.slice(1)}` : c.name;
    return `pkg:npm/${name}@${c.version}`;
  }
  if (c.ecosystem === 'cargo') return `pkg:cargo/${c.name}@${c.version}`;
  if (c.ecosystem === 'github') return `pkg:github/${c.name}@${c.version}`;
  return `pkg:generic/${c.name}@${c.version}`;
}

/** The inventory as a CycloneDX 1.5 BOM (no timestamp or serial, so output is reproducible). */
export function buildSbom(inventory) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: { type: 'application', name: inventory.name, version: inventory.version },
      tools: { components: [{ type: 'application', name: 'scripts/sbom.mjs' }] },
    },
    components: inventory.components.map((c) => ({
      type: c.scope === 'toolchain' ? 'application' : 'library',
      name: c.name,
      version: c.version,
      purl: purlOf(c),
      ...(c.license ? { licenses: [{ expression: c.license }] } : {}),
      ...(c.dev ? { scope: 'excluded' } : {}),
      properties: [
        { name: 'refrain:scope', value: c.scope },
        { name: 'refrain:cycle', value: c.cycle },
        ...c.sources.map((s) => ({ name: 'refrain:source', value: s })),
      ],
    })),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex === -1 ? 'refrain-sheet.full.sbom.json' : process.argv[outIndex + 1];
  const json = `${JSON.stringify(buildSbom(collectInventory()), null, 2)}\n`;
  if (out === '-') {
    process.stdout.write(json);
  } else {
    writeFileSync(join(defaultRoot, out), json);
    console.warn(`sbom: wrote ${out}`);
  }
}
