---
type: operations-concept
title: Dependency lifecycle — patching cadence and EOL management
description: How often dependencies and toolchains are updated, how end of life is tracked from the full SBOM, and which gates enforce both (Dependabot, check:eol, the weekly maintenance workflow, the session-start hook).
sources:
  - resource: ../../scripts/sbom.mjs
  - resource: ../../scripts/check-eol.mjs
  - resource: ../../docs/eol-register.json
  - resource: ../../docs/eol-plan.md
  - resource: ../../.github/dependabot.yml
  - resource: ../../.github/workflows/maintenance.yml
status: stable
generated:
  by: claude-code
  at: 2026-09-26T12:00:00Z
---

# Dependency lifecycle — patching cadence and EOL management

Complements [security-supply-chain.md](security-supply-chain.md), which
says _what_ may be installed and _how_ (exact pins, lockfiles,
`--ignore-scripts`). This concept says _how often_ it is updated and _how
end of life is caught before it arrives_.

## Two cadences

| Cadence       | What                                                                                                                                                                                                                                               | Driven by                                                                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Weekly**    | Patch and minor updates of npm packages, Cargo crates, GitHub Actions and the Docker base image; any security advisory as soon as it is known (do not wait for the week).                                                                          | Dependabot (`.github/dependabot.yml`: grouped patch/minor PRs, a 3-day cooldown after each release) and `.github/workflows/maintenance.yml` (full `npm audit`, `npm outdated` summary, full SBOM artifact). |
| **Quarterly** | The EOL review: every entry of `docs/eol-register.json` re-checked against upstream, majors that are due taken (or planned with a date), `docs/eol-plan.md` rewritten, `reviewed` bumped. Also the Rust toolchain, wasm-pack and wasm-bindgen-cli. | `npm run check:eol` fails once `reviewed` is older than `reviewIntervalDays` (92).                                                                                                                          |

Majors are not deferred by default: take a major when its ecosystem
supports it (peers, engines) and the full verification suite passes. When
it cannot be taken yet (e.g. TypeScript 7 before typescript-eslint supports
it), record why and a due date as the entry's `plan`.

## The full SBOM is the inventory

`npm run sbom` (the release artifact) lists only the production npm tree.
`npm run sbom:full` (`scripts/sbom.mjs`) writes a CycloneDX 1.5 document
covering everything that builds, tests, or ships the app: every npm package
in the lockfile, every Rust crate in `wasm/Cargo.lock`, the toolchains
(Node.js lines from the Dockerfile and every workflow, the Debian base
image, Rust, rustup, wasm-pack, wasm-bindgen-cli) and every GitHub Action.
Each component carries `refrain:scope` (`direct`, `toolchain`,
`transitive`), `refrain:cycle`, and the committed files that pin it.

## The EOL register and its gate

`docs/eol-register.json` holds one entry per `direct` or `toolchain`
component, keyed `<ecosystem>:<name>@<cycle>` (cycle = SemVer major, or
`0.minor` below 1): the upstream `eol` date (or `null` for rolling
releases where only the newest line is supported), a one-line `support`
note, and an optional `plan` (`action` + `due`). `npm run check:eol`
(`scripts/check-eol.mjs`) builds the SBOM in memory and fails when:

- a component has no entry, or an entry matches nothing (a major upgrade
  must move its entry to the new cycle);
- a component is past its `eol`, or within `warnWithinDays` (180) of it
  without a plan;
- a plan's `due` date has passed;
- the quarterly review is overdue.

The first rule is structural and blocks pull requests (ci.yml). The other
three depend on the date, not on the change, so pull-request CI reports
them as warnings (`--overdue-as-warning`) and the weekly maintenance run
fails on them. The session-start hook runs the check with `--no-fail`, so
every Claude Code session starts knowing what is overdue.

## Rules that are easy to get wrong

- **Pinned together:** the Rust channel lives in `rust-toolchain.toml`, the
  `Dockerfile`, `.claude/hooks/session-start.sh` (via the toml) and
  `.github/workflows/wasm.yml`; wasm-pack and wasm-bindgen-cli versions and
  SHA-256 sums in the last three. The `wasm-bindgen` crate must equal
  wasm-bindgen-cli. Change them in one commit and rebuild the payload
  (`npm run build:wasm`); wasm.yml proves byte-reproducibility.
- **Generated payloads:** a `sql.js` bump needs `npm run build:sqljs`
  (`check:generated`); a Cargo bump needs `npm run build:wasm`. The frozen
  `.rsf` fixtures pin the codecs' compressed output, so a codec upgrade
  that changes the bytes is caught by `tests/rsf-fixtures.test.ts`.
- **Lockfile-only resolution:** agents do not run `npm install`; edit
  `package.json`, then `npm update --package-lock-only --ignore-scripts`,
  then `npm ci --ignore-scripts`.
- **Release and deploy workflows** (`release.yml`, `manual-release.yml`,
  `release-docs.yml`) are high-risk: their action and Node.js upgrades are
  planned in the register and need human approval.
- **Notices:** `THIRD-PARTY-NOTICES.md` records exact versions of runtime
  dependencies and linked crates (`tests/third-party-notices.test.ts`).
