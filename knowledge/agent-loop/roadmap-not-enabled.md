---
type: agent-loop-concept
title: Roadmap — not enabled
description: Auto-merge criteria and scheduled autonomous research are documented and designed, but deliberately off. This file describes proposals, not current behavior, and needs re-verification against docs/agent-operations.md before being treated as still accurate.
sources:
  - resource: ../../docs/agent-operations.md
status: proposed
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T13:25:00Z
---

# Roadmap — not enabled

> **This file describes proposals, not current behavior.** Everything
> below is documented and designed but deliberately switched off. Do not
> read any of it as something the loop currently does.

## Future auto-merge criteria (documented, NOT enabled)

Auto-merge is intentionally off. A future, separately-approved phase
could consider a PR for auto-merge only if **all** of the following hold:

- Explicitly classified `risk:low`.
- No database, auth, billing, privacy, infrastructure, or
  major-dependency changes.
- All required checks pass.
- No unresolved review findings.
- Required human / CODEOWNERS approval exists.
- The PR does not modify workflow permissions, deployment configuration,
  or protected-branch controls.
- The change is confined to a narrow allowlist of directories / file
  types.
- The repository owner has explicitly enabled auto-merge for the repo.

Until every one of those is designed, reviewed, and turned on by a human,
merges and releases remain manual (see
[Autonomous execution policy](autonomous-execution-policy.md) and
[Budget, rollback, and release](budget-rollback-and-release.md)).

## Future autonomous research & scheduled runs (proposed, NOT enabled)

Everything in the agent loop triggers from a human-filed Issue, a
comment, a PR event, or a manual `workflow_dispatch`. No workflow uses a
`schedule:` (cron) trigger, and none performs external
market/competitor research. A proposal for introducing that in small,
independently-approvable phases — including a static run-count/cooldown
fallback for when no live Claude usage-quota signal is available — is
recorded in `docs/continuous-improvement-plan.md`. Like the auto-merge
criteria above, nothing there is implemented or scheduled by that
document; each phase needs its own Issue and explicit approval.
