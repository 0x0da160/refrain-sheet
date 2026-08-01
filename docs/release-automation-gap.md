# Release automation gap

**Status: post-merge release automation is intentionally NOT implemented.**

> **Update (2026-07-26).** A **manual** release path now exists —
> [`manual-release.yml`](../.github/workflows/manual-release.yml), documented in
> [`agent-operations.md`](agent-operations.md#manual-release-recovery). A maintainer
> picks the merged PR and the bump type in the Actions UI, and the workflow calls
> `release.yml` directly. That resolves Blocker 1 (no tag-push trigger is involved),
> Blocker 2 (the human chooses the bump), and Blocker 4 (`actions/checkout` with
> `ref: main` is not a detached HEAD, so the documented script runs unmodified).
> **Blocker 3 was factually wrong** and is corrected below. Blockers 5 and 6 stand.
>
> This changes nothing about **automatic** release-on-merge, which remains
> unimplemented: it would still need a mechanical bump-type rule (Blocker 2 is
> resolved only for the manual path, where a human supplies the judgement).

Automatic "merge a PR → cut a release" has been evaluated twice against this
repository. Both times the conclusion was the same: the documented release
procedure does not support unattended execution, and building one would require
inventing commands, a version-bump rule, and a trigger that no repository
document authorizes. This file records exactly what blocks it, verified against
the repository and the GitHub Actions documentation, so a human can decide
whether and how to close the gap.

Nothing here changes the existing, working release path. Releases still happen
the documented way: a human runs `npm run release -- <bump>`, which pushes a
`vX.Y.Z` tag, and [`.github/workflows/release.yml`](../.github/workflows/release.yml)
publishes the GitHub Release **and** deploys GitHub Pages from that tag.

## Verified inventory

| Question                         | Verified answer                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production branch                | `main` (repository default branch; `ALLOWED_BRANCH` in `scripts/release.mjs`)                                                                                  |
| Authoritative version            | `version` in `package.json` (single source; `src/app/version.ts` imports it)                                                                                   |
| Bump command                     | `npm run release -- patch \| minor \| major \| vX.Y.Z`, flags `--yes`, `--dry-run`, `--remote <name>`                                                          |
| Files the bump changes           | exactly `package.json` and `package-lock.json`                                                                                                                 |
| Does the bump script commit/tag? | **Yes, and it pushes both** — commit `Release vX.Y.Z`, annotated tag `vX.Y.Z`, `git push` of branch then tag                                                   |
| Release trigger                  | `push` of a tag matching `v[0-9]+.[0-9]+.[0-9]+`                                                                                                               |
| Git tag                          | Yes — created and pushed by `scripts/release.mjs`                                                                                                              |
| GitHub Release                   | Yes — `release.yml`, idempotent (`gh release view` → `create`, else `upload --clobber` + `edit`)                                                               |
| Package-registry publish         | **No** — `package.json` is `"private": true`; no `npm publish` anywhere                                                                                        |
| Deployment                       | Yes — GitHub Pages, `deploy-pages` job inside `release.yml`                                                                                                    |
| Changelog                        | Yes, but **manual** — `CHANGELOG.md` is hand-maintained per PR (its own "Maintaining this file" section); nothing in the release path generates or retitles it |
| Release notes                    | Yes — a fixed template written inside `release.yml` (not derived from commits)                                                                                 |
| Pages build / output             | `npm run build` (`tsc --noEmit && vite build && vite build --config vite.llm.config.ts`) → `dist/`                                                             |
| Pages model                      | Official artifact model: `configure-pages` + `upload-pages-artifact` (`path: dist`) + `deploy-pages`                                                           |
| Pages environment                | `github-pages`, with `concurrency: pages`, `cancel-in-progress: false`                                                                                         |
| Required secrets                 | **None.** `GITHUB_TOKEN` + OIDC only                                                                                                                           |
| Rollback                         | **None documented** for a published Release, tag, or Pages deployment                                                                                          |

Validation the release path runs, in order:

- `scripts/release.mjs`: `check:versions`, `format:check`, `lint`, `test`,
  **`test:rust`**, `audit:ci`, `build`, `check:dist` — all **before** any mutation.
- `release.yml`: `check:versions -- --tag <tag>`, `format:check`, `lint`, `test`,
  `build`, `check:dist`, `audit:ci` (note: **no `test:rust`**).

There is **no separate Pages workflow.** Pages deployment is already coupled to
the release by a job dependency inside `release.yml`, which is the property an
orchestrator would otherwise have had to recreate.

## Why automatic release-on-merge is not safe here

### Blocker 1 (decisive) — a `GITHUB_TOKEN` tag push cannot trigger `release.yml`

`release.yml` fires on a **tag push**. GitHub documents that

> "Events triggered by the `GITHUB_TOKEN` will not create a new workflow run"

with the only exceptions being `workflow_dispatch`, `repository_dispatch`, and
`pull_request` with the `opened` / `synchronize` / `reopened` activity types. A
tag push is not among them.

So an orchestrator that bumps, commits, tags, and pushes with the built-in token
would produce a `Release vX.Y.Z` commit and a `vX.Y.Z` tag on `main` and **no
GitHub Release, no SBOM, no provenance attestation, and no Pages deployment** —
silently, with no failed run to alert anyone, and (see Blocker 5) no documented
way to roll any of it back.

The two ways around this are both closed:

- **A personal access token or GitHub App token** would re-enable the trigger, but
  introducing a new credential purely to chain workflows is explicitly out of
  scope, and it would replace a zero-secret release path with a long-lived one.
- **Converting `release.yml` to a `workflow_call` reusable workflow** would let an
  orchestrator invoke it directly. This is technically viable but is a rewrite of
  the one workflow that currently works: every `github.ref_name` reference, the
  checkout ref, the attestation subject, the release-notes inputs, and the Pages
  environment would have to be re-plumbed to inputs. No repository document
  describes that design, so choosing it would be invention, not implementation.

### Blocker 2 — the version-bump type is not mechanically derivable

`patch` vs `minor` vs `major` is a human semantic judgement in this repository:

- No `release:patch` / `release:minor` / `release:major` labels exist.
  [`.github/labels.yml`](../.github/labels.yml) defines only `agent:*`, `risk:*`,
  and `type:*`, and no release label is in use on any pull request.
- No conventional-commits, release-please, changesets, or semantic-release
  mechanism exists to preserve.
- README § "Versioning policy" says _"After a user-requested change lands, bump the
  patch version once"_. That is **not** a rule an automation can execute: it does
  not say every merged pull request releases (docs-only and CI-only merges plainly
  should not), and it says nothing about when `minor` or `major` applies.

Defaulting silently to `patch` would mean a release for every merge, including
documentation and workflow changes.

### ~~Blocker 3 — the documented bump command cannot run on a GitHub runner~~ (withdrawn, 2026-07-26)

This blocker was **wrong**. It reasoned that because `ci.yml` and `release.yml` only
set up Node, `npm run test:rust` (`cargo test`) inside `scripts/release.mjs` could not
run — but the `ubuntu-24.04` hosted runner image **ships Rust preinstalled**
(Cargo/Rust/Rustdoc 1.97.0, Rustup 1.29.0, Rustfmt 1.9.0, per the
`actions/runner-images` manifest). No toolchain step, no third-party action, and no
change to release-time build infrastructure is required.

`manual-release.yml` verifies `cargo` is present before it does anything, so if a
future runner image drops Rust the run stops at validation instead of failing
mid-release.

### Blocker 4 — the bump command is not decomposable

The intended automation shape is a `validate-and-bump` job (commit and push the
version) followed by a separate `tag-and-release` job (tag from the exact bump
commit). `scripts/release.mjs` performs validate → bump → commit → tag → push
branch → push tag as one non-separable run. Using it whole forfeits the job split
and the per-job least-privilege boundary; splitting it means not using the
documented command at all.

Two further mechanical mismatches: `actions/checkout` produces a **detached
HEAD**, which the script refuses (`HEAD is detached. Check out the release branch
first.`), and the script requires the working tree to be clean and `main` to be
level with its upstream.

### Blocker 5 — no documented rollback for a published release

`scripts/release.mjs` prints recovery instructions only for a **local, unpushed**
failure (`git tag -d`, `git reset --hard HEAD~1`). Once a tag is pushed there is
no documented, non-destructive procedure to withdraw a GitHub Release, delete a
tag, or revert a Pages deployment — and the release path is deliberately built to
"never force-push, overwrite or delete tags". Automation must not be given a
publishing step whose failure mode has no documented recovery.

### Blocker 6 — branch-protection documentation does not match reality

`docs/agent-operations.md` states that direct pushes to `main` are blocked by
branch protection as defense in depth. In fact `main` currently has **no branch
protection configured at all** (the protection API returns 404). An automation
that pushes a version commit to `main` would therefore succeed today only because
a control the documentation claims exists is absent. That is not authorization,
and repository settings must not be changed automatically to resolve it either
way. A human should decide whether `main` should be protected, and if so whether
GitHub Actions is permitted to push to it — the answer changes the entire design
(direct push vs. a release-PR flow).

## What would have to be decided and documented first

Smallest set of human decisions that would unblock this, in priority order:

1. **How the release stage is invoked without a `GITHUB_TOKEN` tag push.** Either
   approve converting `release.yml` into a `workflow_call` reusable workflow (and
   accept that the working release path is being refactored), or state that
   post-merge automation stops at pushing the tag and a human re-runs the release
   workflow manually. This decision is a prerequisite for everything else.
2. **The bump-type rule**, stated in `README.md` with no judgement left: which
   merged pull requests release at all, and how `patch`/`minor`/`major` is chosen
   (for example, exactly one `release:*` label, required, with no default).
3. **Whether `main` is protected and whether Actions may push to it**, and if not,
   the approved release-PR flow to use instead.
4. **The release-time Rust toolchain question** — either document installing Rust
   on the release runner, or document that the automated path runs a defined
   subset of checks and why that is acceptable.
5. **A non-destructive rollback procedure** for a published Release, tag, and
   Pages deployment.
6. **A duplicate-release guard** at the merge-commit level (the tag and Release
   guards already exist and are idempotent; what is missing is "has this merge
   commit already been released").

Only once 1–6 are recorded in `README.md` should an executable
`release-after-merge.yml` be written — and then only with the commands those
documents specify.

## How this is surfaced

- [`docs/agent-operations.md`](agent-operations.md) records that post-merge release
  automation is intentionally disabled and links here.
- No `release-after-merge.yml` exists, so no merge can trigger a release.
- The tag-driven path is untouched. `manual-release.yml` adds a second **human-
  initiated** entry point to the same `release.yml` implementation; neither is
  automatic, and nothing in either path is triggered by a merge.
