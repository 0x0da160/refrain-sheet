---
type: agent-loop-concept
title: Bilingual agent communication
description: Every human-facing message the agent writes is English first, Japanese second — what that covers, what stays untranslated, and why it is presentation, not a gate.
sources:
  - resource: docs/agent-operations.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T13:25:00Z
---

# Bilingual agent communication

Every human-facing message the agent writes is **English first, Japanese
second** — Issue comments, Work Briefs, clarification questions,
`agent:needs-spec` and `agent:blocked` notices, PR titles and bodies,
review findings, status comments, failure guidance, and release notes.

Substantial messages use `## English` then `## 日本語`. Short review
findings use `**English:** …` / `**日本語:** …`. Checklists repeat the
same items in both.

- **Human authors keep writing however they like.** Japanese or English,
  one line or ten — the bilingual rule binds the agent, never the person
  filing the Issue. Their own words are quoted verbatim in their language,
  never silently rewritten.
- **The two languages must say the same thing.** Same decisions, same
  risks, same hedging: if the English says "may", "not verified", or
  "assumed", the Japanese says so too. Neither side may carry a fact,
  caveat, or requirement the other omits.
- **Technical tokens are never translated or duplicated:** code, commands,
  file paths, identifiers, YAML keys, environment-variable and secret
  names, label names, model names, URLs, raw error messages, stack
  traces, and output from third-party actions. Long output is summarized
  once and linked, not printed twice.
- **Machine-readable parts stay in English, byte-for-byte.** The
  `agent-spec:v1` marker, the Work Brief's `##` section headings and
  `Status` values (`implement` / `needs-clarification` / `blocked`), the
  workflow's outcome tokens, `Closes #<n>`, and the `verify.md` check
  rows. Japanese goes in a `### 日本語` block _inside_ each Work Brief
  section, so nothing that reads the brief by heading breaks.
- **This policy does not apply to GitHub's own UI text or raw CI logs.**
  Review states (`APPROVE`, `REQUEST_CHANGES`, `COMMENT`) keep their
  GitHub names; the agent explains them bilingually in the body instead.
- **Bilingual output is never a reason to stop, delay, or narrow
  implementation.** It is a presentation rule, not a gate.
