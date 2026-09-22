---
type: agent-loop-concept
title: Autonomous execution policy
description: What a human Issue does and doesn't have to specify, the Work Brief as a living record rather than a gate, and exactly when Claude stops for agent:needs-spec or agent:blocked.
sources:
  - resource: ../../docs/agent-operations.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T13:25:00Z
---

# Autonomous execution policy

A human Issue is an outcome request, not a technical specification. For
low- and medium-risk work, Claude reads the Issue, every human comment,
and the repository, then makes the professional call and implements it —
recording what it inferred rather than asking the human to pre-specify it.

## What a human does and does not have to write

A human does **not** need to supply acceptance criteria, a file name, a
technical design, a test plan, or exact wording. Where the repository
already has a convention, an analogous feature, or a configured tool, that
is the answer, and Claude uses it. What a human **does** need to supply is
the outcome wanted.

`agent:ready` means "you may build this using your judgement". It is
**not** a statement that every detail was pre-specified, and it remains
human-only — automation never applies it.

## The Work Brief is a work record, not a gate

The `agent-spec:v1` comment is a living Work Brief: requested outcome,
relevant human updates, repository evidence, the implementation decision,
assumptions, alternatives considered, validation plan, risk, and status.
It exists to make implementation better and the PR reviewable.

It is **not** required to start implementation, and a stale one cannot
strand an Issue. Concretely:

- `implement-issue.yml` requires only `agent:ready`, no `agent:blocked`,
  and a valid open Issue. A missing brief is fine.
- The agent reads the full Issue and every human-authored comment, not
  just the brief. A later human comment outranks an earlier brief.
- A brief marked `needs-clarification` is spent the moment a human answers
  the question in a comment. The agent refreshes the brief itself; a
  human never has to re-run _Prepare issue spec_ to make their own answer
  count. That workflow also re-runs on its own when a human comments on
  an `agent:needs-spec` Issue.
- Bot comments are never mistaken for human product decisions.

> **This fixed a real deadlock.** Previously the brief was the
> authoritative source and a `needs-spec` status was a hard stop, so an
> Issue whose open question had already been answered in a plain comment
> would be re-labelled `agent:needs-spec` with no repository change,
> forever.

## When Claude still stops

**`agent:needs-spec` — one focused question.** Only when every reasonable
reading would produce materially different user-visible behavior, data
handling, compatibility, or product intent, and neither repository
evidence nor any comment resolves it. At most one or two decision-oriented
questions, each with a recommended default and the consequence of
choosing otherwise — never a demand for generic acceptance criteria or a
rewritten Issue.

**`agent:blocked` — a safety boundary.** Database schema/migrations,
backfills, destructive data operations or retention decisions;
authentication, authorization, permissions, identity, account access;
billing, payments, pricing, monetary calculation; personal or sensitive
data, privacy, compliance, legal; secrets, keys, token handling, signing;
infrastructure, IAM, networking, production configuration, deployment
topology; public-API breaking changes; major dependency upgrades with
material compatibility or security impact; contradictory human
requirements; missing credentials or external access; and this
repository's RSF binary format / `wasm/` core (see
[Formats — RSF](../formats/rsf/index.md)). Routine uncertainty is **not**
high risk and is not treated as such.

Both paths remove `agent:ready`, so answering and re-approving is a single
action that re-fires the run.

## The PR is the review point

Because Claude decides more on its own, the pull request — not the
Issue — is where those decisions are reviewed. Every autonomous
implementation states in its PR body: requested outcome, implementation
decision, assumptions made, repository evidence used, tests and
validation run, trade-offs and remaining risks, and any suggested
follow-up Issue. Nothing about merging changes: a human still reviews and
merges, and `review-pr.yml` still reviews the diff independently.
