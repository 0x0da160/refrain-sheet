---
name: verify-change
description: Run the repository's confirmed verification commands and report exact pass/fail/skipped results honestly.
---

# Skill: verify-change

Run the project's real verification suite and report results with total honesty.
This skill never modifies code to make checks pass.

## Confirmed commands (from package.json / CLAUDE.md)

Run in this order; stop reporting nothing as passed unless it actually ran.

| Step                | Command                  | When                                |
| ------------------- | ------------------------ | ----------------------------------- |
| Format              | `npm run format:check`   | always                              |
| Lint                | `npm run lint`           | always                              |
| Type-check + build  | `npm run build`          | always                              |
| Unit tests          | `npm run test`           | always                              |
| Self-contained dist | `npm run check:dist`     | always                              |
| Version consistency | `npm run check:versions` | always                              |
| Production audit    | `npm run audit:ci`       | always (network-dependent)          |
| Rust tests          | `npm run test:rust`      | only if `wasm/` changed             |
| Rebuild WASM        | `npm run build:wasm`     | only if `wasm/` Rust source changed |

Local/Docker form: `docker compose run --rm app <command>`.
CI/runner form: `npm ci --ignore-scripts` first, then the same npm scripts.

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

For each command: `command` · `Passed | Failed | Skipped(reason)` · one-line result
(e.g. test counts, first failing assertion, or why skipped). End with an overall
verdict: **all required checks passed**, or **verification failed/incomplete** with
the blocking reason.
