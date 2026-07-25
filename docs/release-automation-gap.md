# Release automation gap

**Status: post-merge release automation is intentionally NOT implemented.**

A task asked for a `release-after-merge` workflow that automatically releases once
a qualifying pull request is merged — but **only** by following an explicit,
complete, non-interactive release procedure documented in `README.md`. After
inspecting the repository, the documented procedure does **not** meet that bar, so
per the task's own safety rule (_"If README does NOT provide a complete automated
release procedure, do not create an executable production release workflow"_) no
executable auto-release workflow was created. This document records exactly what is
missing so a human can decide whether — and how — to close the gap later.

Nothing here changes the existing, working release path. Releases still happen the
documented way: a human runs `npm run release -- <bump>`, which pushes a
`vX.Y.Z` tag, and [`.github/workflows/release.yml`](../.github/workflows/release.yml)
builds and publishes the GitHub Release + GitHub Pages deployment from that tag.

## What the README documents today

From `README.md` (§ "CI and releases", "Versioning policy", "Cutting a release",
"GitHub Pages deployment") and [`scripts/release.mjs`](../scripts/release.mjs):

- **Trigger:** pushing a strict `v<major>.<minor>.<patch>` **tag** — not a PR merge.
- **Cutting a release** is a deliberate, human-run command:
  `npm run release -- patch | minor | major | vX.Y.Z`. It runs from `main`, refuses
  a dirty tree, runs the full checks, bumps `package.json` + `package-lock.json`,
  creates a `Release vX.Y.Z` commit, creates an annotated tag, and pushes both.
- **Confirmation gate:** it prints the plan and **requires the operator to type
  `yes`** (unless `--yes`).
- **CI on the tag** (`release.yml`) re-validates the tag ⇄ `package.json`, re-runs
  every check + the production build, publishes the GitHub Release (ZIP + SHA-256 +
  CycloneDX SBOM + signed build-provenance attestation), then deploys `dist/` to
  the `github-pages` environment. It needs **no repository secrets** (GITHUB_TOKEN +
  OIDC).

## Why automatic release-on-merge is not safe from this README

Each of these is, on its own, a blocker under the task's rules:

1. **No merge-triggered procedure exists.** The README authorizes releasing on a
   **tag push**, never on a PR merge. Auto-releasing on merge would invent a trigger
   the README does not document.
2. **The version bump is a human semantic decision.** `patch` vs `minor` vs `major`
   is not derivable mechanically from a merge. Auto-releasing would have to _guess_ a
   cadence (e.g. "a patch per merged PR"), which the README does not authorize and
   which would produce a release for every merge.
3. **Releasing writes to the protected `main` branch.** Cutting a release creates a
   `Release vX.Y.Z` commit **and** a tag on `main`. An auto-release workflow would
   need to push a version commit to a protected branch — contrary to branch
   protection and to "do not release from a PR head branch / do not push to a
   protected branch."
4. **The documented command is interactive.** `scripts/release.mjs` is designed
   around a human `yes` confirmation. `--yes` exists, but the README frames it for a
   human operator in CI they control, not for an unattended merge hook.
5. **No non-destructive, documented rollback exists.** The README says releases
   never overwrite/delete tags and that a bad change is reverted via a new PR — there
   is no explicit, safe, one-command rollback of a published Release or a Pages
   deployment. The task forbids automatic rollback without one.
6. **Idempotency/duplicate-release guarding is not specified** for a merge-driven
   path (only the tag path is idempotent, because a tag is created once by a human).

## What would need to be documented before this could be built

If the maintainers later want post-merge (or post-merge-of-a-release-PR) automation,
`README.md` (the authoritative source) would first need to state, explicitly and
non-interactively:

- the **exact trigger and guard** (e.g. "merging a PR labeled `release:patch` into
  `main` cuts a patch release", or "merging a `Release vX.Y.Z` PR pushes that tag");
- the **version-bump rule** with no human judgement left (how the next version is
  computed);
- how the release **avoids pushing to a protected branch** (e.g. the version bump
  lands _in_ the merged PR, and automation only creates/pushes the **tag**);
- the **required secrets/credentials by name** (today: none beyond GITHUB_TOKEN);
- a **duplicate-release guard** (skip if the tag/Release already exists);
- an explicit, **non-destructive rollback** command;
- confirmation that every step is **safe for unattended GitHub Actions** use.

Only once all of that is in the README should an executable `release-after-merge.yml`
be written — with `pull_request: [closed]`, a `github.event.pull_request.merged ==
true` guard, a base-branch restriction to the documented production branch, a
fork-exclusion guard, a `concurrency` group, `timeout-minutes`, least-privilege
permissions, and checkout of the exact merge commit SHA — following _only_ the
README-documented commands.

## How this is surfaced

- `docs/agent-operations.md` records that post-merge release automation is
  intentionally disabled and points here.
- No `release-after-merge.yml` exists, so no merge can trigger a release.
