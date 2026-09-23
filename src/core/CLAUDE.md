# src/core/CLAUDE.md

Local rules for the domain core. The root [`CLAUDE.md`](../../CLAUDE.md)
still governs; this adds only what is specific to `src/core/`.

- **DOM-free and inward-only.** Core runs unchanged in Node (tests, benches).
  It never imports `src/app/` or `src/ui/` and never touches `window`,
  `document`, `navigator`, or storage. `eslint.config.js` and
  `tests/architecture.test.ts` enforce this; a value the UI owns (locale,
  sheet name, app identity) is passed in, or lives in core
  (`app-identity.ts`). See `knowledge/architecture/module-boundaries.md`.
- **RSF is a persisted-format contract — high risk.** `rsf-codec.ts` and
  `rsf-document.ts` read files users saved with every earlier release of
  the current format (JSON document version 1, since #602). Before
  changing either, read `knowledge/formats/rsf/index.md` and
  `compatibility.md`. A new key must be optional; a change an older reader
  would misread needs a new document `version`, never a reinterpretation
  of an old key. `tests/rsf-fixtures.test.ts` must stay
  green: never edit or regenerate an existing file under `tests/fixtures/rsf/`.
  Add a new fixture instead. The Knip findings in these two files are
  deferred for human review (`docs/knip-baseline.md`); leave them alone.
- **Formula engine.** Keep the module graph in
  `knowledge/architecture/dependency-rules.md` acyclic
  (`formula-value` ← helpers ← `formula-functions` ← `formula` ← `spill` ←
  `rsf-document`). Every input is hostile: bounded work, no `eval`.
- **Generated code.** `src/wasm-gen/` is output of `npm run build:wasm` /
  `build:sqljs`; never hand-edit it (see `wasm/CLAUDE.md`).
