---
type: agent-loop-concept
title: Budget, rollback, and release
description: Turn caps and circuit breakers, how to pause or roll back the loop, manual release recovery from a phone, and why the release process is a deliberate human act with no post-merge automation.
sources:
  - resource: ../../docs/agent-operations.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T13:25:00Z
---

# Budget, rollback, and release

## Budget and circuit breakers

- **Max runtime:** each workflow sets `timeout-minutes` (triage 15,
  implement 45, review 25, close-loop 15).
- **Max concurrency:** `concurrency` groups key implementation to one run
  per Issue.
- **Turn caps:** each agent invocation passes `--max-turns` to bound
  model work (prepare-spec 25, review 25, close-loop 15). Two caps are
  tunable without editing YAML, via optional Actions variables:
  implementation defaults to `500` (`AGENT_MAX_TURNS`) and triage to `40`
  (`TRIAGE_MAX_TURNS`). Set them higher for larger features, lower to cap
  cost. An implementation run that exhausts its cap does **not** lose its
  work and does **not** land on `agent:blocked` — see
  [Smartphone-first operation](smartphone-operation.md#agentcontinuation-needed).
- **Why triage's cap is 40, not 20:** at 20 it failed with
  `error_max_turns` and `permission_denials_count: 0` — no tool was
  denied, the work simply did not fit. Triage on this repository is not
  cheap: the skill reads `CLAUDE.md` plus architecture/security context,
  and a feature Issue naming a subsystem invites reading that subsystem
  to judge duplication and scope. The failure mode is asymmetric — the
  run sets labels early and comments last, so exhausting the cap leaves
  the Issue labelled `agent:triage` with no comment, which reads as "the
  agent ignored me". The cap was raised and
  `.claude/skills/triage-issue/SKILL.md` now carries an explicit reading
  budget that tells triage to prefer a shallow, honest comment over an
  unfinished deep one. A failed triage can be re-run from the Actions tab
  (**Run workflow** → Issue number).
- **Tool allowlists:** every agent invocation also passes
  `--allowedTools` / `--disallowedTools`. This is **not optional**: with
  no `--allowedTools`, the action denies every tool call, and the run
  burns its entire turn budget on permission denials before failing with
  `error_max_turns` (a high `permission_denials_count` in the run's JSON
  output means a missing tool grant, not a too-small turn cap). Each
  workflow allows only `Read,Glob,Grep,Bash` and denies the mutating
  command families it must never use (pushes; PR merge/approve/close;
  releases; repo/secret/variable/workflow configuration; and raw
  `gh api` wherever the job holds `pull-requests: write`, so an approval
  cannot be submitted through the API). The job's `permissions:` block
  remains the enforcing boundary; the allowlists are defense in depth.
- **Why `close-loop.yml` follows `workflow_run`, not `check_suite`:** it
  originally triggered on `check_suite: [completed]` and consequently
  never ran once — GitHub documents that this event does not trigger
  workflows if the check suite was created by GitHub Actions or if the
  check suite's head SHA is associated with GitHub Actions, and both hold
  here (CI's suite is created by Actions, on a commit
  `implement-issue.yml` authored under the Actions identity). It now
  triggers on `workflow_run` for the CI workflow. `workflow_run` is a
  privileged trigger — it runs from the default branch with secrets even
  for fork PRs — so the job is gated at event level to same-repo
  `pull_request` CI runs on `agent/issue-*` branches and must never gain
  a checkout step: it only calls `gh` and comments, so no PR code is ever
  executed.
- **Why `review-pr.yml` allows one bot:** the action refuses
  bot-initiated runs by default. `implement-issue.yml` opens the agent PR
  under `GITHUB_TOKEN`, so the PR author — and the actor on the resulting
  `pull_request` event — is `github-actions[bot]`, and the review run
  failed with "Workflow initiated by non-human actor" before ever
  reaching Claude. `review-pr.yml` therefore sets
  `allowed_bots: github-actions` — exactly that one bot, never `'*'`, and
  no dependency bots (Dependabot/Renovate PRs are skipped anyway by the
  `agent/issue-*` branch gate). This does not weaken any approval gate:
  `agent:ready` stays human-only, this job cannot approve or merge (see
  the tool allowlists above), it uses `pull_request` (never
  `pull_request_target`), and it is gated to same-repo agent branches.
  `implement-issue.yml` deliberately does **not** set `allowed_bots`, so
  a bot-applied `agent:ready` still cannot start an implementation — that
  is defense in depth on top of the human-only label rule.
- **Max retries per Issue:** treat repeated `agent:blocked` on the same
  Issue (e.g. ≥ 2 failed implementation attempts) as an escalation — a
  human investigates before re-approving. Turn-limit continuation
  enforces its own bound: two consecutive turn-limited runs escalate to
  `agent:blocked` automatically, with a recommendation to split the
  Issue.
- **Pause switch:** removing `agent:ready` (or disabling
  `implement-issue.yml`) halts new implementation work immediately.
- **Usage review:** periodically review the Actions usage report and
  Anthropic API usage; set a repository Actions spending limit.

## Rollback

Every automated action is reversible and traceable to an Issue or PR:

- **Pause the whole loop:** remove `agent:ready` from open Issues;
  without it, `implement-issue.yml` refuses to run.
- **Disable one workflow:** Actions tab → select the workflow →
  **Disable workflow** (or delete/rename its file in a PR).
- **Remove write access:** revert the workflow's `permissions:` to
  `contents: read`, or set the repo Actions default to read-only.
- **Revoke the credential:** rotate/delete the active Claude secret
  (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) in repo secrets and
  rotate it at its source (`claude setup-token` for OAuth, the Anthropic
  console for the API key). Alternatively, set `CLAUDE_AUTH_METHOD` to an
  unset/invalid value to make every agent run fail fast at validation. No
  workflow can call the model without the matching secret.
- **Undo an agent PR:** close the PR (branch `agent/issue-*` is
  isolated), or if already merged, `git revert` the merge commit via a
  new PR.
- **Remove the App:** Settings → GitHub Apps → Claude → Configure →
  uninstall for this repository.
- **Investigate safely:** workflow logs never print secret values; read
  the run logs from the Actions tab. If a log ever appears to contain a
  secret, rotate it.

## Manual release recovery

`Manual release recovery` (`.github/workflows/manual-release.yml`) runs
the documented release procedure for an already-merged pull request, from
the Actions UI, so a maintainer can release without a local checkout. It
does not duplicate the release: it calls `release.yml`, the same
implementation a tag push uses.

### When to use it

When a merged change should be released and running `npm run release`
from a desktop is not possible or not wanted. It is also the recovery
path if a release label or a release step was missed. **The normal path
is still to decide the bump before merging**, and to release with
`npm run release -- <bump>` from a checkout; manual recovery is an
exception, not the default process.

### Steps

1. Open **Actions** in GitHub Mobile or a mobile browser.
2. Open **Manual release recovery**.
3. Tap **Run workflow**.
4. Leave `use_latest_merged_pr` ticked to release the newest merged pull
   request (the usual case, no typing needed). To release an older one,
   untick it and enter that PR number — **Pull requests → Closed** lists
   them newest-merged-first, and every run also annotates the candidates
   on its own run page. Ticking the box _and_ entering a number stops the
   run rather than guessing.
5. Select `patch`, `minor`, or `major`.
6. **Tick `dry_run` and run it that way first.**
7. Read the bilingual dry-run summary on the run page.
8. Only if it is correct, run again with `dry_run` unticked.
9. Confirm the resulting tag, GitHub Release, and Pages deployment — both
   are linked from the summary.

> `dry_run` defaults to unticked, so step 6 is a deliberate action. A run
> with it unticked releases for real.

### The release source is always one merged PR

There is deliberately no "just release the current tip of `main`" mode.
One specific merged pull request is the release's authorization and its
audit trail: it proves the released change was reviewed, that it landed
on `main`, and that it is not itself a `Release vX.Y.Z` commit or a
`release/*` branch. Releasing whatever `main` happens to hold would give
none of those guarantees. What `use_latest_merged_pr` changes is only who
names the pull request — a human, or the workflow resolving the newest
one merged into `main`. Either way the same eligibility checks then run
against that pull request, so an automatic resolution that lands on a
release commit, or on a commit an existing release already contains,
still stops without releasing anything.

### What it refuses

An arbitrary branch, commit SHA, version string, command, or CLI
argument — the only inputs are a numeric (or empty) PR number, a fixed
`patch`/`minor`/`major` choice, and two booleans. A PR that is not
merged, or not merged into `main`. Both a PR number and "release the
newest merged PR" at once. A merge commit unreachable from `main`. A
merge commit an existing release already contains. A tag that points
somewhere unexpected — it stops without touching tags, commits, Releases,
or Pages. Two releases at once: automatic and manual share the
`production-release` concurrency group, and a release in progress is
never cancelled. The bump type is never read from Issue text, PR text,
comments, commits, or labels.

### If a previous attempt was interrupted

If the version-bump commit and tag exist but the GitHub Release does not,
running the workflow again completes the publish from that verified tag —
no second commit, no second tag. If the Release already exists, the run
reports `already released` and changes nothing. Nothing is ever
force-pushed, reset, or deleted.

## Release automation (post-merge) — intentionally disabled

**There is no automatic release-on-merge.** Merging a PR never cuts a
release. Every release is a deliberate human act — either the
tag-driven flow below, or [Manual release recovery](#manual-release-recovery),
which runs that same flow from the Actions UI.

- A human runs `npm run release -- patch | minor | major` (see the
  README "Cutting a release" section). It runs from `main`, runs the
  full checks, bumps the version, and pushes a `vX.Y.Z` tag.
- Pushing that tag triggers `release.yml`, which re-verifies and
  publishes the GitHub Release (ZIP + SHA-256 + SBOM + signed provenance)
  and deploys `dist/` to the `github-pages` environment. No repository
  secrets are required (`GITHUB_TOKEN` + OIDC).

A post-merge `release-after-merge.yml` has been evaluated twice and
deliberately not created. The decisive reason is mechanical, not
stylistic: `release.yml` is triggered by a tag push, and GitHub does not
create a workflow run for events raised by `GITHUB_TOKEN` (the only
exceptions are `workflow_dispatch`, `repository_dispatch`, and
`pull_request` opened/synchronize/reopened). An automation that bumped,
tagged, and pushed with the built-in token would therefore leave a
`Release vX.Y.Z` commit and tag on `main` with **no** GitHub Release,
SBOM, provenance, or Pages deployment — silently, and with no documented
rollback. Introducing a PAT or GitHub App token purely to chain workflows
is out of scope, and converting `release.yml` into a reusable
`workflow_call` workflow would be a rewrite of the working release path
that no repository document authorizes.

Four further blockers stand independently: the bump type is not
mechanically derivable (no `release:*` labels exist or are in use, and no
conventional-commits/changesets mechanism is present); `npm run release`
runs `test:rust`, which needs a Rust toolchain that no workflow installs;
the script bumps, commits, tags, and pushes as one non-separable run and
refuses the detached HEAD that `actions/checkout` produces; and no
non-destructive rollback is documented for a published Release, tag, or
Pages deploy.

The full analysis, the verified release-asset inventory, and the exact
decisions that would have to be recorded in `README.md` first are in
`docs/release-automation-gap.md`.

**To disable releases entirely / immediately:** disable or delete
`.github/workflows/release.yml` (Actions tab → the workflow → **Disable
workflow**), and/or do not push version tags. Because releases are
tag-triggered, simply not pushing a `vX.Y.Z` tag means nothing is ever
released.

**Required release secrets, by name:** none beyond the run's
`GITHUB_TOKEN` (plus OIDC for provenance/Pages). No Anthropic credential
is involved in releasing.
