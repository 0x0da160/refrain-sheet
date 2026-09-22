---
type: agent-loop-concept
title: Smartphone-first operation
description: The eight-step mobile flow, watching and re-running from GitHub Mobile, agent:continuation-needed, how a retry resumes, escalation after repeated turn-limit exhaustion, and the rare cases a desktop is genuinely required.
sources:
  - resource: docs/agent-operations.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T13:25:00Z
---

# Smartphone-first operation

This loop is designed to be supervised from a phone. The whole normal
lifecycle — requesting work, approving it, watching it run, continuing it
after an interruption, reviewing it, merging it — is doable in GitHub
Mobile or a mobile browser, with no local terminal, no local git, and no
branch surgery.

## The normal flow

| #   | You do                                                            | Where                               |
| --- | ----------------------------------------------------------------- | ----------------------------------- |
| 1   | Open an Issue (Japanese or English, one sentence is enough)       | Issues → New                        |
| 2   | Read the Agent Work Brief comment                                 | the Issue                           |
| 3   | Apply `agent:ready` — the one approval that starts implementation | the Issue's Labels                  |
| 4   | Watch the run                                                     | Actions → _Implement issue_         |
| 5   | Read the bilingual result comment and the PR                      | the Issue / the PR                  |
| 6   | Review and merge                                                  | the PR                              |
| 7   | Release the merged PR                                             | Actions → _Manual release recovery_ |
| 8   | Confirm the Release and the Pages deployment                      | Releases / the run summary          |

All eight steps are mobile. Merging never releases anything by itself —
step 7 is always a deliberate act, whether run as `npm run release` from a
desktop or [Manual release recovery](budget-rollback-and-release.md#manual-release-recovery)
from a phone.

## Watching and re-running from GitHub Mobile

Actions → pick the workflow → pick the run. A failed or incomplete run
offers **Re-run failed jobs** (and **Re-run all jobs**) — that is the
continuation button. There is also **Run workflow** → _Implement issue_,
which asks only for an Issue number; use it when there is no failed run
to re-run. If the mobile app does not show the dispatch form on a given
version, open the same page in the mobile browser.

Both entry points run identical validation, branch naming, safety checks,
and continuation logic. Neither accepts a branch, a command, or a CLI
argument.

## `agent:continuation-needed`

**The run hit its turn budget, not a wall.** Reaching `--max-turns` is an
execution budget boundary — it is **not** a specification problem, and it
never applies `agent:needs-spec`. When it happens:

- Every edit made so far is committed to the stable branch
  `agent/issue-<n>-<slug>`.
- A draft pull request is opened or updated, clearly marked incomplete —
  its verification has not been run; do not merge it as-is.
- `agent:working` comes off, `agent:ready` **stays on** — the approval is
  still in force — and `agent:continuation-needed` goes on.
- A short bilingual comment states the branch, the PR, what was
  completed, and the one action available: re-run the workflow.

Nothing is discarded and nothing needs repairing by hand.

## How a retry resumes

One Issue has one branch and one pull request for its whole life. On every
run, before the agent starts, the workflow resolves that branch, checks
it out with all prior commits intact, and finds the existing open PR. The
agent is told to read `git log`/`git diff` and the previous check-point
comment first, and to implement only the remaining work.

The workflow never force-pushes, never resets, never squashes, and never
deletes an agent branch. It commits on top and updates the same PR — so a
retry cannot produce a duplicate PR, a duplicate branch, or lost commits.
If the Issue title changed between runs, the branch of the existing open
PR still wins.

## After repeated turn-limit exhaustion

Two **consecutive** turn-limited runs stop the cycle. The branch and PR
are kept, and the Issue moves to `agent:blocked` with a bilingual comment
recommending either:

- opening a smaller follow-up Issue covering the single smallest useful
  next step; or
- raising the Actions variable `AGENT_MAX_TURNS`, then removing
  `agent:blocked` and re-applying `agent:ready`.

Both are taps. (The count is the trailing run of check-point comments, so
any comment written in between resets it.)

## There is no automatic continuation — on purpose

A run **could** re-dispatch itself — `workflow_dispatch` is one of the
documented exceptions to the rule that events raised by `GITHUB_TOKEN`
create no new workflow run, so no personal access token would be needed.
It is excluded for a different reason: `gh workflow run` requires
`actions: write` on the job, which would let the implementation job start
**any** workflow in this repository. That is a much broader grant than
"implement a change", and the loop's own design rules it out. The re-run
tap costs one interaction and keeps the permission boundary where it is.

## When a desktop is genuinely required

Rare, and always stated explicitly in the comment when it happens:

- **A pull request with conflicts GitHub's web editor cannot resolve.**
- **A push rejected because the agent branch diverged** (someone else
  moved it). The run fails to `agent:blocked` rather than overwriting
  anything. From a phone, the PR can be closed and the branch deleted to
  start clean; preserving both instead needs a desktop rebase.

Everything else — labels, re-runs, reviews, merges, closing a PR,
deleting a branch — is available on mobile.
