# Refrain Sheet

A local-first, format-preserving CSV and spreadsheet editor.

**[Web App](https://app.refrain-sheet.com/)** · **[Releases](https://github.com/0x0da160/refrain-sheet/releases/)**

Refrain Sheet is a local-first, offline CSV and spreadsheet editor that runs
directly from a local HTML file. It preserves CSV files as faithfully as
possible while supporting lightweight spreadsheet editing through RSF.
Open `index.html` directly in a browser; no installation, server, account,
or network connection is required.

“Refrain” means refraining from touching your original CSV unnecessarily.
Edit field values while preserving everything else as faithfully as possible:
delimiters, quoting, surrounding whitespace, line endings, encodings, byte
order marks, undecodable bytes, and malformed regions. Spreadsheet-only
features (formulas, structural edits, per-document metadata) are provided
through **RSF (Refrain Sheet Format)**. The exact byte-preservation
guarantee and its documented exceptions are in
[`knowledge/domains/csv-preservation-guarantee.md`](knowledge/domains/csv-preservation-guarantee.md).

ローカルで動く、書式保持CSV・スプレッドシートエディタです。
CSVのフィールド値だけを編集し、区切り文字、引用符、空白、改行コード、文字コード、
BOM、不正なCSV領域などを可能な限り保持します。

[`CHANGELOG.md`](CHANGELOG.md) tracks notable user-visible changes by version.
The version is defined in `package.json` and surfaced through the app
(**Help > About / Keyboard Shortcuts** shows it), the metadata written into
saved `.rsf` files, and the release artifact name.

## Detailed knowledge

This README is an entry point, not a reference manual. Durable, detailed
knowledge — architecture, security, performance, the RSF binary format,
core spreadsheet/CSV domain behavior, and UI/interaction behavior — lives
in the [`knowledge/`](knowledge/index.md)
[OKF v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md)
bundle:

- [Architecture](knowledge/architecture/index.md) — layers, dependency
  direction, the formula engine's structure, and cross-cutting invariants.
- [Operations](knowledge/operations/index.md) — the security threat model,
  supply-chain controls, and performance principles/measurements.
- [Formats](knowledge/formats/index.md) — the full `.rsf` binary container
  specification.
- [Domains](knowledge/domains/index.md) — core spreadsheet/CSV-editor
  behavior: the preservation guarantee, workbook/worksheet lifecycle,
  formulas and references, functions and errors, dynamic arrays, undo/
  redo, import/export/conversion, and version history.
- [UI](knowledge/ui/index.md) — interaction and presentation behavior:
  editing and IME safety, selection/navigation, copy/paste/fill, find and
  replace, column resize/auto-fit, view formatting and dockable panels,
  tabs, mobile/touch, accessibility, and theming.

## Features

- **Byte-identical CSV preservation.** An unedited save writes the loaded
  bytes verbatim; edits reserialize only the changed field ranges.
  Supports UTF-8, Shift_JIS/CP932, and EUC-JP.
- **Spreadsheet mode via RSF.** Formulas (55 functions, cross-sheet
  references, dynamic arrays), multiple worksheets (including Markdown/
  JSON/YAML/plain-text worksheets), filtering, sorting, data validation,
  conditional formatting, cell formatting, a local read-only SQL query
  view, and in-file version history with restore/preview.
- **Import and export.** CSV, JSON, and XLSX import; CSV, JSON, and XLSX
  export — each an explicit, lossy (values-only) conversion.
- **Keyboard, mobile/touch, and accessibility support.** IME-safe editing
  from the first keystroke, full keyboard operability, ARIA labeling
  throughout, and a touch-adapted mobile layout.
- **Light / Dark / Hybrid themes.** System default, Light, Dark, or
  Hybrid (the UI follows the system color-scheme preference while the
  spreadsheet grid stays light) — **Hybrid is the default for new
  installs**.
- **Offline and secure by design.** No runtime network access, no
  `eval`/dynamic code, a sandboxed formula engine, and an embedded
  WebAssembly core that is never fetched.

### CSV injection warning

Values beginning with `=`, `+`, `-`, or `@` may be interpreted as
**formulas** by spreadsheet software (Excel, LibreOffice, Google Sheets)
when the saved CSV is opened there. In keeping with the Refrain
principle, this application never silently modifies, escapes, or
prefixes your values as a mitigation — be careful when opening CSV files
from untrusted sources in spreadsheet software.

## Running via `file://`

The build output is completely static and self-contained:

1. Get `dist/` (build it yourself or download a release ZIP).
2. Open `dist/index.html` (or `index.html` inside the extracted ZIP)
   directly in a browser — double-click it or press Ctrl+O in the browser.

There is no dev server requirement, no backend, no browser extension, no
CDN, and no network access of any kind. The bundle is a classic (non-module)
script specifically so it works under `file://` in Chromium, and a
restrictive Content Security Policy (`connect-src 'none'`, no `http:`/`https:`
source anywhere) blocks all outgoing connections.

### Browser support

| Capability                              | Chrome / Edge (Chromium)   | Firefox           | Safari            |
| --------------------------------------- | -------------------------- | ----------------- | ----------------- |
| Run from `file://`                      | ✔                          | ✔                 | ✔                 |
| Overwrite save (File System Access API) | ✔ (with permission prompt) | ✘ → download save | ✘ → download save |
| Writable handle from drag & drop        | ✔                          | ✘                 | ✘                 |

## Development

Requirements: Node.js ≥ 20 and npm, or Docker.

```sh
npm ci --ignore-scripts  # install exact locked deps, no lifecycle scripts
npm run dev             # Vite dev server (development only; the product itself needs no server)
npm run build           # type-check + production build into dist/
npm run test            # vitest (unit, property-based/fuzz, jsdom UI tests)
npm run test:rust       # cargo test (Rust/WASM core)
npm run bench           # performance benchmarks — see knowledge/operations/performance-measurements.md
npm run lint            # eslint
npm run format          # prettier --write
npm run format:check    # prettier --check
npm run check:versions  # package.json ⇄ package-lock.json consistency
npm run check:dist      # assert dist/ is self-contained (embedded WASM, no network)
npm run check:knowledge # OKF frontmatter validation for knowledge/
npm run ui:check        # load dist/ in headless Chromium, fail on render/console errors
npm run audit:ci        # production-dependency vulnerability gate
npm run release -- patch   # one-command release (see "Cutting a release")
```

The committed `.npmrc` sets `ignore-scripts=true`, so `npm ci` alone already
skips dependency lifecycle scripts; the explicit flag above documents the
intent for environments without the repo `.npmrc`.

`npm run ui:check` needs Chromium's browser binary, which `--ignore-scripts`
deliberately does not fetch automatically; the Docker image (below) already
has it, but a local (non-Docker) run needs a one-time
`npx playwright install --with-deps chromium` first.

### Docker

A reproducible environment is provided via `Dockerfile` + `compose.yaml`
(dependencies live in a named volume, never in the host tree):

```sh
docker compose run --rm app npm ci --ignore-scripts
docker compose run --rm app npm run format:check
docker compose run --rm app npm run lint
docker compose run --rm app npm run test
docker compose run --rm app npm run build   # writes dist/ to the host
docker compose run --rm app npm run ui:check  # headless Chromium is preinstalled in the image
docker compose up dev                       # dev server on http://localhost:5173
```

### Architecture and project layout

The code is organized in strict layers — core/domain (`src/core/`, fully
DOM-independent), application (`src/app/`), UI (`src/ui/`), and
infrastructure (the WASM bridge, generated bindings, and build scripts) —
with dependencies flowing inward only, and every user command dispatching
through a single typed command layer. The full engineering map (layer
diagram, command/data flow, the WASM boundary, and the invariants every
change must preserve) is documented in
[knowledge/architecture/index.md](knowledge/architecture/index.md).

```text
src/
  core/       lossless CSV document model, RSF workbook/worksheet model +
              binary codec, the formula engine — DOM-independent, unit-tested
  app/        tabs & app state, the typed command layer (commands.ts) and its
              UI contract (ui-port.ts), file access, settings, i18n, shortcuts
  ui/         menu bar, grid (+ grid/ pure helpers), formula bar, dialogs,
              status bar
  styles/     hand-written CSS by section, loaded in order by styles.css
  assets/     bundled icon/logotype SVGs
  locales/    en.json, ja.json (identical key sets)
  wasm-gen/   generated: embedded WASM (Base64) + wasm-bindgen glue
wasm/         Rust crate compiled to WebAssembly (CSV core, compression,
              stats/search primitives); toolchain pinned by rust-toolchain.toml
tests/        unit, property-based/fuzz, and jsdom UI tests; fixtures/rsf/ is
              the frozen .rsf compatibility corpus
bench/        reproducible performance benchmarks (npm run bench)
scripts/      build, embed, release, and verification scripts (npm run …)
site/         the separate static marketing site, plain JS (npm run build:landing)
knowledge/    the OKF knowledge bundle (architecture, operations, formats,
              agent-loop, domains, ui, references, decisions)
docs/         the Knip baseline and proposal/analysis records
design-system/  vendored Refrain Sheet Design System deliverable (tokens,
              logos, icons); the app copies what it ships into src/
public/       files served as-is at the site root (favicon)
```

Menu actions, keyboard shortcuts, context menus, and drag & drop all pass
through the single command layer in `src/app/commands.ts`.

### Code statistics

Measured with [`cloc`](https://github.com/AlDanial/cloc) over the whole
repository, excluding `node_modules`, `dist`, `build`, `coverage`, and
`vendor`. The table between the two markers below is regenerated by
[`.github/workflows/code-stats.yml`](.github/workflows/code-stats.yml) on
every push to `main`; when the numbers change, that workflow opens or updates a pull
request rather than committing to `main` directly, so the README stays inside
the normal review flow. Nothing outside the markers is ever machine-written.

<!-- code-stats:start -->

<!-- Generated by .github/workflows/code-stats.yml — do not edit by hand. -->

| Language   |   Files |     Blank |    Comment |       Code |
| ---------- | ------: | --------: | ---------: | ---------: |
| TypeScript |     258 |     5,610 |     12,754 |     60,085 |
| Markdown   |      71 |     1,438 |          4 |      8,363 |
| JSON       |       8 |         0 |          0 |      8,197 |
| CSS        |      39 |       676 |        802 |      5,157 |
| HTML       |       6 |        84 |         25 |      2,821 |
| YAML       |      16 |       281 |        809 |      2,762 |
| JavaScript |      20 |       338 |        739 |      2,588 |
| Rust       |       4 |       112 |        180 |        883 |
| SVG        |      11 |         0 |         52 |         98 |
| Dockerfile |       1 |         8 |         21 |         21 |
| TOML       |       1 |         4 |         19 |         20 |
| **Total**  | **435** | **8,551** | **15,405** | **90,995** |

<!-- code-stats:end -->

### Tests

`npm run test` runs the full unit, property-based/fuzz, and jsdom UI test
suite under `tests/`: byte-identical CSV preservation, the formula engine,
the RSF binary codec (round-trip, WASM/JS parity), UI behavior (keyboard
routing, IME safety, selection, drag interactions), and deterministic
responsiveness-regression tests. See the individual files under `tests/`
for what each suite covers.

## CI and releases

- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to
  `main`: install, version-consistency, format, lint, tests, build,
  `check:dist`, a dependency-vulnerability gate, and a clean-tree
  assertion. On pull requests it also runs the changelog gate
  (`check:changelog`), which fails a PR that changes `src/` or
  `wasm/src/` without an entry in [CHANGELOG.md](CHANGELOG.md) (or
  `Changelog: not-needed` in the PR description for a purely internal
  change). CI is entirely read-only and needs no secrets, so fork PRs run
  safely.
- **Dependency review** and **code statistics** run as separate,
  read-only workflows on pull requests and pushes to `main` respectively.
- **Releases and deployment** (`.github/workflows/release.yml`) run only
  when a strict semantic-version tag `v<major>.<minor>.<patch>` is
  pushed, publishing both a GitHub Release (ZIP + SHA-256 + CycloneDX SBOM
  - signed build-provenance attestation) and the GitHub Pages site.
    Pushes to `main`, pull requests, and malformed or non-version tags never
    release or deploy.

The full CI permission model, Actions-pinning policy, and release
security controls are documented in
[knowledge/operations/security-supply-chain.md](knowledge/operations/security-supply-chain.md).

### Versioning policy

The application version follows **Semantic Versioning** and is defined in
exactly one place, `package.json`; `src/core/app-identity.ts` imports it, so no
app-visible string hard-codes a number. `npm run check:versions` fails if
`package.json` and `package-lock.json` drift apart, and CI runs it on every
push. The internal Rust/WASM core crate (`wasm/Cargo.toml`) has its own
independent version and is intentionally not tied to the app version.

[`CHANGELOG.md`](CHANGELOG.md) records what changed in each version. A pull
request that changes user-visible behavior adds an entry under its
`Unreleased` section; cutting a release retitles that section to the new
version and date.

### Cutting a release (`npm run release`)

A single checked-in Node script, [`scripts/release.mjs`](scripts/release.mjs),
performs the whole release safely and requires no globally installed tools
beyond Node + git:

```sh
npm run release -- patch        # 0.2.4 -> 0.2.5
npm run release -- minor        # 0.2.4 -> 0.3.0
npm run release -- major        # 0.2.4 -> 1.0.0
npm run release -- v1.4.0       # an explicit target version
npm run release -- patch --yes  # skip the confirmation prompt (CI/non-interactive)
npm run release -- patch --dry-run   # run every check, change nothing
```

It validates the repository state and branch (`main` only), runs the
**full** required checks (including Rust tests and a security audit),
computes the new version, synchronizes `package.json` +
`package-lock.json`, then creates and pushes the release commit and an
annotated tag — which is what triggers the GitHub Actions release
workflow. It prints the exact plan and requires typing `yes` before any
mutation (unless `--yes` is passed), refuses to run from a detached HEAD,
a dirty tree, or a branch behind its upstream, and never force-pushes or
overwrites tags.

### GitHub Pages deployment

Once CI and the production build succeed, the release workflow's
`deploy-pages` job publishes the same `dist/` to GitHub Pages at
`https://<owner>.github.io/<repository>/`, using the official
`actions/configure-pages`/`upload-pages-artifact`/`deploy-pages` actions
and no repository secrets. **One-time repository setting:** in
**Settings → Pages → Build and deployment → Source**, choose **GitHub
Actions** — without it the deployment step has no Pages site to publish
to.

## Security policy

All input — CSV content, filenames, search terms, regular expressions,
`localStorage` data — is treated as untrusted; cell content is never
interpreted as HTML or executable code (no `innerHTML`/`eval`/
`new Function`); `.rsf` files hold inert data only, validated and bounded
on load; the Rust/WebAssembly core is embedded and never fetched from a
network; and the application makes no network connections at runtime
(this covers the CSV editor itself — the separate marketing landing page
may load consent-gated analytics). The full threat model, dependency
policy, lockfile policy, CI permission model, and release security
controls are documented in
[knowledge/operations/index.md](knowledge/operations/index.md).

## Limitations

- Plain CSV editing preserves bytes and offers no formulas or structural
  changes; those require an explicit conversion to a `.rsf` **spreadsheet
  document** (see [Features](#features)).
- The whole file is kept in memory, with a configurable safety limit
  (**512 MiB** by default, adjustable from 16 MiB to 2 GiB in Settings);
  larger files are refused with an explanation.
- UTF-16 and ISO-2022-JP are not supported.
- Full byte preservation applies to normal saves; explicit encoding/
  line-ending/BOM conversions and edited fields are transformed as
  documented in
  [knowledge/domains/csv-preservation-guarantee.md](knowledge/domains/csv-preservation-guarantee.md).

## License

MIT License, Copyright (c) 2026 0x0da160 — see [LICENSE](LICENSE).
Bundled third-party software is documented in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
