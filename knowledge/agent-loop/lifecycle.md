---
type: agent-loop-concept
title: Agent loop lifecycle
description: How a human Issue becomes a reviewed, merged, released pull request — the simplified submission model, the full Issue-to-release pipeline, the label state machine, and which steps are automated vs. human.
sources:
  - resource: docs/agent-operations.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T13:25:00Z
---

# Agent loop lifecycle

## Simplified Issue submission

A human does **not** write a full specification. To request a feature:

1. Enter a short title (e.g. `検索結果に並び替え機能を追加したい`).
2. Write what is wanted in a single `やりたいこと` field — a short sentence
   is fine.
3. Claude reads it and posts an **agent Work Brief** comment: what it
   understood, the repository evidence, the implementation it will make,
   and every assumption.
4. A human reviews that brief and, only if it is correct and safe, applies
   `agent:ready`.

Background, scope, out-of-scope, acceptance criteria, technical design,
test plan, risk classification, rollback, model, and release details are
**not** asked of the human — they are inferred from repository conventions
and recorded as assumptions (see
[Autonomous execution policy](autonomous-execution-policy.md)).

If Claude needs something, it asks one focused question in a comment.
Answering it in a comment is authoritative task input — no Issue rewrite,
brief regeneration, or workflow re-run is needed to make the answer count.

## The pipeline

```text
Human opens Issue (simple form: title + やりたいこと)
        │
        ├─► issue-triage.yml        classify, set risk labels, judge implementability
        └─► prepare-issue-spec.yml  write the agent-spec:v1 Work Brief
        │                           (may set agent:needs-spec / agent:blocked)
        │                           ▲ also re-runs when a human comments on a
        │                           │ agent:needs-spec Issue — no manual re-run
        ▼
Human reviews the Work Brief and (only if approved) applies ──► agent:ready   ← HUMAN ONLY
        │
        ▼
implement-issue.yml ── requires agent:ready + no agent:blocked (a Work Brief is NOT required)
        │               agent:working ─► stable branch agent/issue-<n>-<slug>
        │               reads the Issue + ALL human comments + newest brief,
        │               implements with repository conventions + tests + verification
        │
        ├─► turn budget reached? ─► agent:continuation-needed + draft PR, agent:ready
        │     KEPT, every commit preserved. One "Re-run" tap continues the SAME
        │     branch and PR. Twice in a row ─► agent:blocked (split the Issue).
        ▼
Pull request opened (Closes #<n>) ──► agent:review  (only after a verified, non-empty PR)
        │
        ├─► review-pr.yml   independent review of the diff vs. acceptance criteria
        └─► close-loop.yml  status comment: checks + review + remaining human action
        │
        ▼
Human reviews & approves & MERGES  ← HUMAN ONLY (branch protection enforced)
        │
        ▼
agent:done (after merge + post-merge verification)
        │
        ▼
Release: still MANUAL. Either `npm run release` from a checkout, or the
"Manual release recovery" workflow from a phone. Both run the same
release.yml. Post-merge auto-release stays disabled — see
[Budget, rollback, and release](budget-rollback-and-release.md).
```

## Label state machine

| Label                       | Meaning                                                 | Who may apply       |
| --------------------------- | ------------------------------------------------------- | ------------------- |
| `agent:triage`              | Needs automated classification / clarification          | Automation or human |
| `agent:needs-spec`          | One material product decision is genuinely needed       | Automation or human |
| `agent:ready`               | **Human-approved** for autonomous implementation        | **Human only**      |
| `agent:working`             | An implementation workflow is running on the Issue      | Automation          |
| `agent:continuation-needed` | Turn budget reached; work preserved, re-run to continue | Automation          |
| `agent:review`              | A PR exists; needs independent review / CI completion   | Automation          |
| `agent:blocked`             | Cannot safely continue without human input              | Automation or human |
| `agent:done`                | Completed after human-approved merge + verification     | Automation or human |

Risk labels (narrowly scoped): `risk:low`, `risk:medium`, `risk:high`,
`risk:security`, `risk:data`, `risk:infra`, `risk:breaking-change`.
Definitions live in `.github/labels.yml`.

## Automated vs. human-controlled

| Step                               | Automated                     | Human                     |
| ---------------------------------- | ----------------------------- | ------------------------- |
| Triage & labeling                  | ✅ (`issue-triage.yml`)       | may adjust                |
| Writing the Work Brief             | ✅ (`prepare-issue-spec.yml`) | reviews it                |
| Approving an Issue (`agent:ready`) | ❌ never                      | ✅ required               |
| Implementation + PR                | ✅ (`implement-issue.yml`)    | —                         |
| Independent review                 | ✅ (`review-pr.yml`)          | may add review            |
| Status aggregation                 | ✅ (`close-loop.yml`)         | —                         |
| **Merge**                          | ❌ never                      | ✅ required               |
| **Release / deploy**               | ❌ never on merge             | ✅ tag push or manual run |

## Workflows

> The Issue-driven workflows below (all but `manual-release.yml`) were
> removed on 2026-09-23; see [the agent loop index](index.md). The table is
> kept as the design record.

| Workflow                 | Trigger                                                                         | Permissions                                                                                     | Concurrency                                | Stop condition                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-triage.yml`       | `issues: opened/edited`, dispatch                                               | `contents:read`, `issues:write`                                                                 | per-issue, cancel-in-progress              | Skips issues past triage / bot edits                                                                                                                                       |
| `prepare-issue-spec.yml` | `issues: opened/labeled`, human `issue_comment` on `agent:needs-spec`, dispatch | `contents:read`, `issues:write`                                                                 | per-issue, cancel-in-progress              | Skips bots / issues past spec; comments the `agent-spec:v1` Work Brief only                                                                                                |
| `implement-issue.yml`    | `issues: labeled` (`agent:ready`), dispatch                                     | `contents:write`, `issues:write`, `pull-requests:write`                                         | per-issue, **no** cancel                   | No diff → `blocked` (safety stop) or `needs-spec`; turn budget → `continuation-needed` (work kept); other failure → `blocked`; `review` only after a verified non-draft PR |
| `review-pr.yml`          | `pull_request` (same-repo `agent/issue-*`), dispatch                            | `contents:read`, `issues:write`, `pull-requests:write`                                          | per-PR, cancel-in-progress                 | Skips fork / non-agent branches                                                                                                                                            |
| `manual-release.yml`     | `workflow_dispatch` only                                                        | `contents:read` default; `contents:write` on the bump job; release write set on the calling job | global `production-release`, **no** cancel | Stops before any mutation on a failed eligibility check; `dry_run` never mutates                                                                                           |
| `close-loop.yml`         | `workflow_run` (CI completed), dispatch                                         | read checks/statuses/contents, `issues:write`, `pull-requests:write`                            | per-commit, cancel-in-progress             | Only same-repo `pull_request` CI runs on `agent/issue-*`; skips when no matching agent PR                                                                                  |

Every workflow declares an explicit `timeout-minutes`, uses `pull_request`
(never `pull_request_target`), selects its Claude credential from exactly
one method (see
[Configuration and permissions](configuration-and-permissions.md#claude-authentication)),
and is inert until a human completes
[the setup](configuration-and-permissions.md#human-setup-required).

## `agent:review` means a verified PR exists

`implement-issue.yml` treats **the workflow** — not the model — as the
authority for git and the PR. Claude only edits the working tree; the
workflow then, in order: verifies a real non-empty diff
(`git status --porcelain` + diff against the base branch), runs the
required verification suite, commits, pushes, opens/updates the PR, and
retrieves and validates the PR (number, URL, head branch, head SHA, base
branch, changed-files count, additions, deletions, non-empty diff). Only
after all of those pass does it remove `agent:working` and apply
`agent:review`.

If the run produced no change it goes to `agent:blocked` (a safety or
approval stop) or `agent:needs-spec` (a focused product question, or
nothing to do); if it ran out of turns it goes to
`agent:continuation-needed` with its work preserved (see
[Smartphone-first operation](smartphone-operation.md)); on any other
failure it goes to `agent:blocked`. `agent:review` therefore always
corresponds to a reviewable, non-draft PR — it is never a proxy for "the
model finished". `review-pr.yml` and `close-loop.yml` only act on a PR
they retrieve from GitHub; neither creates `agent:review` and neither
infers a PR from a label.
