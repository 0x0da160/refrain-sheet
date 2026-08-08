# Continuous improvement plan — proposal

**Status: proposal only. No workflow, permission, secret, or notification
channel is added by this document. Nothing here is enabled.**

**Follow-up Issues filed (2026-08-08), one per phase below, at the
maintainer's request (`計画に沿ってサブイシュー化して` on #313):**
[#315](https://github.com/0x0da160/refrain-sheet/issues/315) (Phase 2),
[#316](https://github.com/0x0da160/refrain-sheet/issues/316) (Phase 3),
[#317](https://github.com/0x0da160/refrain-sheet/issues/317) (Phase 4),
[#318](https://github.com/0x0da160/refrain-sheet/issues/318) (Phase 5),
[#319](https://github.com/0x0da160/refrain-sheet/issues/319) (Phase 6). Each
still needs its own `agent:ready` and, for Phases 2–4, explicit maintainer
sign-off before implementation — filing the Issue is not approval.

[Issue #313](https://github.com/0x0da160/refrain-sheet/issues/313) asked for an
autonomous product-development operation: periodic market/competitor/user
research with recorded evidence, prioritized and specified improvement
proposals, and — for changes that are high-value, low-risk, and small enough
to verify — autonomous implementation through Draft PR creation (never
merge). It explicitly asked that the first step be an audit of the current
Issues/PRs/releases/Pages/Claude Code/notifications/permissions/branch
protection/docs, followed by a phased introduction rather than switching on
full automation at once, with token/budget-aware scheduling (or explicit
fallback limits when live quota data is not available) and a human approval
gate reachable from a phone.

A first automated read of this Issue classified it `agent:blocked` /
`risk:infra` / `risk:high`: it bundles several items from `CLAUDE.md`'s
high-risk escalation list at once (new scheduled/"cron" workflows that run
without a human filing an Issue first, a budget/token-tracking mechanism, and
a notification channel — likely new secrets) and is far broader than "the
smallest change that satisfies the acceptance criteria" this repository's PR
discipline requires. The maintainer then asked how to proceed
(`進め方を提案して`). This document is that proposal: an audit of what already
exists, the gap against the request, and a phased sequence of independently
reviewable follow-up Issues — the smallest safe first step, not the full
program.

## Audit: what already exists

The single-Issue loop this repository already runs (documented in full in
[`agent-operations.md`](agent-operations.md)) covers most of the
_mechanics_ the Issue asks for, just scoped to one human-filed Issue at a
time rather than a self-starting research loop:

| Requested capability                       | Current state                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue/PR classification and prioritization | `issue-triage.yml` classifies and labels every new Issue (`agent-operations.md` § Workflows). Improvement proposals would need to arrive _as Issues_ to enter this.                                                                                                                                                                                                         |
| Specification with recorded rationale      | `prepare-issue-spec.yml` posts an `agent-spec:v1` Work Brief per Issue (repository evidence, implementation decision, assumptions, risk) — see `agent-operations.md` § Autonomous execution policy.                                                                                                                                                                         |
| Small, verified, autonomous implementation | `implement-issue.yml` implements, tests, and opens a Draft/real PR; it never merges (`agent-operations.md` § Lifecycle). This already matches "high-value, low-risk, small, Draft PR, no merge" for anything scoped as one Issue.                                                                                                                                           |
| Independent review                         | `review-pr.yml` reviews the diff against acceptance criteria before a human merges.                                                                                                                                                                                                                                                                                         |
| Human approval gate reachable from a phone | `agent-operations.md` § Smartphone-first operation and § Mobile notifications: every human-decision point (`agent:needs-spec`, `agent:blocked`, `agent:continuation-needed`, a verified PR) posts one bilingual comment that `@mention`s the repository owner, which GitHub Mobile turns into a push notification — no webhook, no third-party push service, no new secret. |
| Budget / circuit breakers                  | `agent-operations.md` § Budget and circuit breakers: per-workflow `timeout-minutes`, per-Issue `concurrency`, tunable `--max-turns` caps (`AGENT_MAX_TURNS`, `TRIAGE_MAX_TURNS`), and an automatic escalation to `agent:blocked` after two consecutive turn-limited runs. These bound **one implementation run**, not a recurring schedule.                                 |
| Merge / release / deploy stay human-only   | `agent-operations.md` confirms no workflow holds merge rights and post-merge auto-release is intentionally not implemented (see [`release-automation-gap.md`](release-automation-gap.md)); Pages deploys only from the tag-triggered `release.yml`.                                                                                                                         |
| Branch protection                          | `agent-operations.md` recommends a ruleset on `main` (no direct pushes, required PR + status checks + human approval), but its own § Release automation notes `main` **currently has no branch protection configured** — this is a live gap, unrelated to this Issue, that a repository admin should close directly in GitHub Settings; no workflow file can create it.     |
| Labels                                     | Two lifecycle/risk label sets already exist and are documented: [`.github/labels.yml`](../.github/labels.yml) (`agent:*`, `risk:*`, `type:*`), last updated 2026-07-26.                                                                                                                                                                                                     |

What does **not** exist today, and is genuinely new relative to the current
loop:

1. **Any trigger that starts work without a human filing an Issue first.**
   Every workflow in `.github/workflows/` triggers on `issues:`,
   `issue_comment:`, `pull_request:`, `workflow_run:`, or manual
   `workflow_dispatch:`. None uses a `schedule:` (cron) trigger, and none
   calls out to any external market/competitor data source.
2. **Any token/quota-aware scheduler.** The existing budget controls
   (turn caps, timeouts, concurrency) bound a single already-started run;
   nothing today reads a Claude usage quota or a next-replenishment time, or
   enforces a daily/weekly _run count_ across multiple runs.
3. **A defined evidence format or backlog for research findings.** There is
   no convention yet for what a "market/competitor/user-research" artifact
   looks like in this repository, where it is stored, or how it is turned
   into prioritized, specified Issues.
4. **This repository's open-PR count and branch-protection settings could
   not be re-verified live from this run**: reading `pull_request`s and
   calling the GitHub REST API directly are both outside this workflow's
   tool allowlist while it holds `pull-requests: write` (`agent-operations.md`
   § Budget and circuit breakers — "denies ... raw `gh api` wherever the job
   holds `pull-requests: write`, so an approval cannot be submitted through
   the API"). This is a known, intentional limitation of the implementation
   workflow, not a gap in this plan; a maintainer or the triage workflow
   (which does not hold that permission) can check current PRs and branch
   protection directly in GitHub.

## Why this does not become one PR

Items 1 and 2 above are each, independently, an infrastructure/CI-CD change
under `CLAUDE.md`'s escalation list (new scheduled workflow triggers,
new permissions, and — for any notification channel beyond the existing
`@mention`-in-a-comment mechanism — new secrets). `CLAUDE.md` requires
explicit human approval _before_ implementing any of those, not after the
fact in PR review. Building all of it as one change would also violate this
repository's "smallest change that satisfies the acceptance criteria" rule:
this is a multi-phase program, not one feature.

## Proposed phased introduction

Each phase below is sized to be its own Issue, its own small reversible PR
(docs or one narrowly-scoped workflow), and independently approvable. Later
phases depend on earlier ones being merged and observed working, not just
written.

1. **This document (current PR).** Audit + plan only. No workflow,
   permission, secret, or schedule trigger changes.
2. **Research-only, read-only, manually-triggered workflow.** Filed as
   [#315](https://github.com/0x0da160/refrain-sheet/issues/315). A new
   `workflow_dispatch`-only workflow (no `schedule:` trigger yet, so it never
   runs unattended) that asks Claude to research a specific, narrow question
   (e.g. "competing offline CSV/spreadsheet editors: what have they shipped
   in the last quarter?") and posts the findings as a **new, clearly-labeled
   Issue** (e.g. `type:feature`, plus a proposed new label such as
   `source:research`) for a human to triage exactly like any other Issue.
   Permissions: `contents: read`, `issues: write` only — no new secret, no
   scheduled trigger, no auto-`agent:ready`. This is the smallest slice that
   demonstrates the "research → recorded evidence → proposal" loop end to
   end while keeping a human as the one who presses the button and the one
   who triages the result.
3. **Scheduling.** Filed as
   [#316](https://github.com/0x0da160/refrain-sheet/issues/316). Only after
   Phase 2 has run successfully a few times by
   hand: add a `schedule:` (cron) trigger to the same workflow, at a
   deliberately low frequency (e.g. weekly). This is the first change that
   needs explicit sign-off on running without a human dispatching it, and
   should ship with an easy kill switch (disable the workflow, or remove the
   `schedule:` block) documented the same way `agent-operations.md` §
   Rollback documents pausing the Issue-implementation loop.
4. **Run-count / cooldown limits.** Filed as
   [#317](https://github.com/0x0da160/refrain-sheet/issues/317). Before or
   alongside Phase 3: since no
   tool in this loop today can read a live Claude token quota or
   next-replenishment time (this plan does not assume one exists), gate the
   scheduled workflow with explicit, static circuit breakers analogous to
   the existing `AGENT_MAX_TURNS` pattern — an Actions variable capping runs
   per week, and a rule that N consecutive failed/empty research runs
   disables further scheduled runs until a human re-enables them, mirroring
   the existing "two consecutive turn-limited runs → `agent:blocked`" rule
   in `agent-operations.md`.
5. **Notification for research output.** Filed as
   [#318](https://github.com/0x0da160/refrain-sheet/issues/318). Reuse the
   existing `@mention`
   comment mechanism (`agent-operations.md` § Mobile notifications) on the
   Issue Phase 2 creates, rather than building any new channel — this avoids
   the secrets/webhook/third-party-service risk the original Issue itself
   flagged as something to avoid.
6. **Autonomous implementation of research-sourced proposals.** Filed as
   [#319](https://github.com/0x0da160/refrain-sheet/issues/319). Only after
   Phases 2–5 are live and trusted: allow a research-sourced Issue to be
   treated exactly like any other Issue in the existing loop — a human still
   applies `agent:ready`; nothing here proposes to skip that gate. This
   phase adds no new capability beyond "the Issue's source was automation
   instead of a person," so it is expected to need the least new review.

None of phases 2–6 are implemented, scheduled, or otherwise enabled by this
document. Each needs its own Issue, its own explicit `agent:ready`, and (for
phases 2–4, which touch workflow triggers and permissions) explicit
maintainer sign-off before implementation starts, per `CLAUDE.md`'s
infrastructure escalation rule.

## Non-goals of this document

This document does not add a `schedule:` trigger, a new secret, a new
notification channel, a new label, or any change to branch protection or
Actions permissions. It does not audit market or competitor data itself —
that is Phase 2's job once approved. It records the sequencing decision so
that Issue #313 can proceed as a series of ordinary, independently
reviewable changes instead of one unbounded, high-risk one.
