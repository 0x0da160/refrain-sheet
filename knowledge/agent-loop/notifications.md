---
type: agent-loop-concept
title: Mobile notifications
description: The GitHub @mention mechanism that drives GitHub Mobile push notifications, which events mention and which stay quiet, de-duplication via a hidden marker, and the release/Pages notification gap.
sources:
  - resource: docs/agent-operations.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T13:25:00Z
---

# Mobile notifications

The loop's notification mechanism is a plain GitHub **@mention**. When a
workflow leaves the loop in a state that needs a human decision, it posts
one bilingual Issue or pull-request comment whose first line mentions the
repository owner. GitHub Mobile turns a direct mention into a push
notification, so nothing outside GitHub is involved: no webhook, no
Slack, no email API, no third-party push service, no personal access
token, and no new secret. The mentioned login is
`github.repository_owner` unless the Actions variable `NOTIFY_OWNER`
overrides it.

## What creates a mention

| Event                                                     | Where the comment lands | Workflow              |
| --------------------------------------------------------- | ----------------------- | --------------------- |
| `agent:needs-spec` — one product decision is needed       | the Issue               | `implement-issue.yml` |
| `agent:blocked` — a safety, approval, or failure stop     | the Issue               | `implement-issue.yml` |
| `agent:continuation-needed` — the turn budget was reached | the Issue               | `implement-issue.yml` |
| A verified pull request is ready for review               | the Issue               | `implement-issue.yml` |
| CI failed or timed out on an agent pull request           | the pull request        | `close-loop.yml`      |
| The independent review workflow itself failed             | the pull request        | `review-pr.yml`       |

A turn-limit stop is **execution** continuation, never `agent:needs-spec`
— its notice says so explicitly.

## What stays quiet

Triage starting or finishing · Work Brief creation or refresh ·
`agent:working` · ordinary progress · tests passing during implementation
· routine label changes · a successful release · a successful Pages
deployment · non-blocking review suggestions · a repeated status event
for a state already reported.

These still appear in the Issue, the pull request, and the Actions tab —
they just do not ring the phone.

## Release and Pages failure — a human decision, not implemented

`release.yml` and `manual-release.yml` deliberately hold **neither**
`issues: write` nor `pull-requests: write` — they run `contents: read` by
default and widen only per job, only for what publishing requires. A
mention comment therefore cannot be posted from either one without
granting a comment-writing permission to a workflow that publishes
releases, and a tag-push release has no Issue or pull request to comment
on in the first place. That trade is the repository owner's to make, not
automation's, so it is documented here instead of taken silently. Until
it is decided, GitHub Mobile's own Actions notification for failed
workflows (enabling step 4 below) is what covers release and Pages
failures.

## Enabling the notifications

1. **Watch or participate in the repository.** Watch → _All Activity_ or
   _Participating and @mentions_.
2. **Enable Direct mentions** in GitHub Mobile → Settings →
   Notifications. This is the one that matters most.
3. **Enable Pull request review request notifications**, so a review
   request also reaches you.
4. **Enable Actions notifications**, preferably **failed workflows
   only** — that is what surfaces a release or Pages failure today.
5. **Allow GitHub Mobile notifications in the phone's operating system.**
   iOS and Android both mute an app silently if this is off.

## De-duplication

Every notice carries a hidden marker,
`<!-- agent-notice:v1 type=<event-type> run=<workflow-run-id> -->`. Before
posting, the workflow lists the existing **bot-authored** comments and
looks for that exact marker; if it is already there, nothing is posted.
Because "Re-run failed jobs" reuses the same run id, re-running a workflow
from a phone never produces a second mention for the same state. A
genuinely new state — a new commit, a new run, or a different event
type — gets its own marker and does notify. Human comments are never
matched and no comment is ever edited.

## Notifications are not a guarantee

GitHub does not promise that a notification is immediate, and a push can
be delayed, coalesced, or dropped by the OS. The GitHub Notifications
inbox and the Actions screen remain the source of truth — if something
feels stalled, check there rather than assuming nothing happened.
