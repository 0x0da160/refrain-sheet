---
name: verify-change
description: Run the repository's verification commands, the same set CI runs, and report exact pass/fail/skipped results honestly in a form that pastes into a pull request's Verification section.
---

# Skill: verify-change

Run the project's real verification suite and report results with total honesty.
This skill never modifies code to make checks pass.

## Confirmed commands (from package.json / CLAUDE.md / .github/workflows/ci.yml)

Run in this order. The list mirrors `ci.yml` (its Static checks, Test, and Build and browser
check jobs), so a change that passes here should pass CI. `CLAUDE.md` requires at least
format, lint, build, test, `check:dist`, `check:versions`, `check:knip` and `check:layout`;
the other rows are what CI runs on top of that. Report nothing as passed unless it actually ran.

| Step                  | Command                                               | When                                       |
| --------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Format                | `npm run format:check`                                | always                                     |
| Lint                  | `npm run lint`                                        | always                                     |
| Type-check + build    | `npm run build`                                       | always                                     |
| Unit tests            | `npm run test`                                        | always                                     |
| Self-contained dist   | `npm run check:dist`                                  | always                                     |
| Version consistency   | `npm run check:versions`                              | always                                     |
| Unused code (Knip)    | `npm run check:knip`                                  | always                                     |
| Layout and naming     | `npm run check:layout`                                | always                                     |
| Generated payloads    | `npm run check:generated`                             | always                                     |
| Knowledge bundle      | `npm run check:knowledge`                             | always                                     |
| Colour contrast       | `npm run check:contrast`                              | always                                     |
| EOL register          | `npm run check:eol`                                   | always (date-driven findings too)          |
| Production audit      | `npm run audit:ci`                                    | always (network-dependent)                 |
| Changelog entry       | `npm run check:changelog`                             | pull requests only (see below)             |
| Browser check         | `npm run ui:check`                                    | always, after the build (needs a Chromium) |
| Minimal edition       | `npm run build:minimal`, `npm run check:dist:minimal` | always                                     |
| Minimal browser check | `npm run ui:check:minimal`                            | always (needs `dist/` and `dist-minimal/`) |
| Hosted edition        | `npm run build:hosted`, `npm run check:dist:hosted`   | always                                     |
| Clean tree            | `git status --porcelain`                              | always, last; it must print nothing        |
| Rust tests            | `npm run test:rust`                                   | only if `wasm/` changed                    |
| Rebuild WASM          | `npm run build:wasm`                                  | only if `wasm/` Rust source changed        |

Local/Docker form: `docker compose run --rm app <command>`.
CI/runner form: `npm ci --ignore-scripts` first, then the same npm scripts. CI installs from the
lockfile on every run; do the same after switching branches or pulling a changed `package-lock.json`,
or the build and tests fail on missing modules.

On a GitHub Actions runner, **always use the CI/runner form (native npm)** — Node and
dependencies are already installed. Do **not** invoke Docker there: its container runs
as root and leaves root-owned build artifacts (e.g. `dist/`) that make a later native
`vite build` fail with `EACCES`.

## Steps that need care

- **`check:changelog`** reads the pull request event, so outside CI it prints
  `skipped: not a pull_request event` and exits 0. Report it as **Skipped (not applicable)**,
  never as Passed, and apply its rule by hand: if the change touches `src/` or `wasm/src/`
  (`git diff --name-only origin/main...HEAD`), `CHANGELOG.md` needs an entry under
  `[Unreleased]`, or the pull request title or description needs `Changelog: not-needed`.
- **`check:eol`** is date-driven. An overdue EOL, plan, or quarterly review is reported even
  though the change did not cause it; pull-request CI shows it as a warning
  (`--overdue-as-warning`) and the weekly maintenance run fails on it.
- **Browser checks** (`ui:check`, `ui:check:minimal`) open the built files in headless
  Chromium. CI installs it with `npx --no-install playwright install --with-deps chromium`;
  the Docker image already has it. With no usable browser, mark both
  **Skipped (unavailable)**. If you ran them with a substitute browser or an overridden
  `PLAYWRIGHT_BROWSERS_PATH`, say so next to the result.
- **Clean tree:** CI fails when install, test, or build leaves a tracked file modified (a
  drifting lockfile, a generated artifact, a formatter side effect). Run
  `git status --porcelain` after the other steps and report any line it prints as a failure.

## Rules

1. Record the **exact command** and its outcome for every step.
2. Classify each as one of: **Passed**, **Failed**, **Skipped (unavailable)**,
   **Skipped (not applicable)**. Explain every skip.
3. Never claim a command passed if it was not executed.
4. Never silently ignore a failure — report the failing command and the relevant
   error output (without pasting secrets).
5. If verification cannot be completed (missing toolchain, no network for audit,
   sandbox limits), say so explicitly and mark the change **blocked / incomplete**.
6. Do not weaken, skip, delete, or fake any test or assertion to get a green result.

## Output (table)

Open with where and on what it ran: native or Docker, the Node and npm versions, and the
commit verified. Then give one row per command (a build and its `check:dist*` partner may
share a row):

| Command                   | Result                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| `npm run test`            | Passed: N files, N tests passed, N skipped                               |
| `npm run check:changelog` | Skipped (not applicable): reads the pull request event; no `src/` change |

Each result is **Passed**, **Failed**, **Skipped (unavailable)** or **Skipped (not applicable)**
plus one line (test counts, the first failing assertion, or why it was skipped), so the table
can be pasted into a pull request's Verification section. End with an overall verdict:
**all required checks passed**, or **verification failed/incomplete** with the blocking reason.
