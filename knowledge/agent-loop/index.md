# Agent loop — the GitHub Issue-driven engineering loop

Describes how an Issue becomes a reviewed pull request for Refrain Sheet:
which steps are automated by GitHub Actions workflows invoking Claude, and
which steps stay under human control. It is the operational companion to
`CLAUDE.md` (agent contract) and the
[Operations](../operations/index.md) domain (security policy, which
governs).

The concepts are split by kind — durable policy, an operational runbook,
reference configuration, and a roadmap — so that
[roadmap-not-enabled.md](roadmap-not-enabled.md) (auto-merge, scheduled
autonomous runs) is never mistaken for current behavior.

> **Status (2026-09-23): the GitHub Actions workflows that drove this loop
> were removed.** `issue-triage.yml`, `prepare-issue-spec.yml`,
> `implement-issue.yml`, `review-pr.yml`, and `close-loop.yml` had done no
> real work since 2026-09-18 — development moved to interactive Claude Code
> sessions — and `review-pr.yml` / `close-loop.yml` were firing on every pull
> request only to skip or fail. The pages below remain as the design record
> and as the process the `.claude/skills/` skills still follow when run by
> hand; the workflow tables describe the removed automation. Restoring it
> means reverting that removal from git history, then redoing
> [the setup](configuration-and-permissions.md#human-setup-required). The
> release workflows (`manual-release.yml`, `release.yml`) are unaffected.
>
> **Nothing in this loop merges code or deploys to production.** Merges,
> releases, and the `agent:ready` approval are always human actions.

- [Lifecycle](lifecycle.md) — Issue → Work Brief → `agent:ready` →
  implementation → PR → review → merge → release; the label state machine;
  which steps are automated vs. human; the workflow trigger/permission
  table.
- [Autonomous execution policy](autonomous-execution-policy.md) — what a
  human Issue does and doesn't have to specify, the Work Brief as a living
  record rather than a gate, and exactly when Claude stops for
  `agent:needs-spec` or `agent:blocked`.
- [Bilingual agent communication](bilingual-communication.md) — every
  human-facing message is English first, Japanese second, and what stays
  untranslated.
- [Smartphone-first operation](smartphone-operation.md) — the eight-step
  mobile flow, re-running from GitHub Mobile, `agent:continuation-needed`,
  how a retry resumes, and the rare cases a desktop is required.
- [Notifications](notifications.md) — the GitHub @mention mechanism that
  drives mobile push notifications, what stays quiet, and de-duplication.
- [Configuration and permissions](configuration-and-permissions.md) —
  Claude authentication method selection, model selection, the
  minimum-permissions table, one-time human repository setup, and branch
  protection.
- [Budget, rollback, and release](budget-rollback-and-release.md) — turn
  caps and circuit breakers, how to pause or roll back the loop, and the
  manual/tag-triggered release process.
- [Roadmap — not enabled](roadmap-not-enabled.md) — auto-merge criteria and
  scheduled autonomous research: documented and designed, but deliberately
  off. **Not current behavior.**
