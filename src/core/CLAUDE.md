# src/core/CLAUDE.md

Local rules for the domain core. The root [`CLAUDE.md`](../../CLAUDE.md)
still governs; this adds only what is specific to `src/core/`.

- **DOM-free and inward-only.** Core runs unchanged in Node (tests, benches).
  It never imports `src/app/` or `src/ui/` and never touches `window`,
  `document`, `navigator`, or storage. `eslint.config.js` and
  `tests/tooling/architecture.test.ts` enforce this; a value the UI owns (locale,
  sheet name, app identity) is passed in, or lives in core
  (`app-identity.ts`). See `knowledge/architecture/module-boundaries.md`.
- **Layout.** `csv/` (the byte-preserving CSV document), `formula/` (the
  engine), `workbook/` (the RSF workbook, its worksheets, and the codec),
  `interchange/` (XLSX/JSON/CSV import and export); `editor-document.ts`
  is the only place that tests a document's `kind`.
- **RSF is a persisted-format contract — high risk.** `workbook/rsf-codec.ts` and
  `workbook/rsf-document.ts` (with `workbook/worksheet-data.ts`) read files users saved with every earlier release of
  the current format (JSON document version 1, since #602). Before
  changing either, read `knowledge/formats/rsf/index.md` and
  `compatibility.md`. A new key must be optional; a change an older reader
  would misread needs a new document `version`, never a reinterpretation
  of an old key. `tests/core/rsf-fixtures.test.ts` must stay
  green: never edit or regenerate an existing file under `tests/fixtures/rsf/`.
  Add a new fixture instead. The Knip findings in the codec and document are
  deferred for human review (`docs/knip-baseline.md`); leave them alone.
- **Formula engine.** Keep the module graph in
  `knowledge/architecture/dependency-rules.md` acyclic
  (`formula/value` ← helpers ← `formula/functions/` ← `formula/index` ←
  `formula/spill` ← `workbook/`; `tests/tooling/architecture.test.ts`
  enforces the ranking). Every input is hostile: bounded work, no `eval`.
- **Generated code.** `src/generated/` is output of `npm run build:wasm` /
  `build:sqljs`; never hand-edit it (see `wasm/CLAUDE.md`).
