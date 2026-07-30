# Agent operations

This document describes the GitHub Issue-driven engineering loop for Refrain Sheet:
how an Issue becomes a reviewed pull request, which steps are automated, and which
steps stay under human control. It is the operational companion to `CLAUDE.md`
(agent contract) and `docs/security.md` (security policy, which governs).

> **Nothing in this loop merges code or deploys to production.** Merges, releases,
> and the `agent:ready` approval are always human actions.

## Overview

### Simplified Issue submission

A human does **not** write a full specification. To request a feature:

1. Enter a short **title** (e.g. `検索結果に並び替え機能を追加したい`).
2. Write what you want in the single **`やりたいこと`** field. A short sentence is fine.
3. Claude reads it and posts an **agent Work Brief** comment (what it understood, the
   repository evidence, the implementation it will make, and every assumption).
4. A human **reviews that brief** and, only if it is correct and safe, applies
   **`agent:ready`**.

Background, scope, out-of-scope, acceptance criteria, technical design, test plan,
risk classification, rollback, model, and release details are **not** asked of the
human — they are inferred from repository conventions and recorded as assumptions.

If Claude does need something, it asks **one focused question in a comment**. Answer
it in a comment too: a plain reply is authoritative task input. You never need to
rewrite the Issue, regenerate the brief, or re-run a workflow to make an answer
count — see [Autonomous execution policy](#autonomous-execution-policy).

### Lifecycle

```text
Human opens Issue (simple form: title + `やりたいこと`)
        │
        ├─► [issue-triage.yml]        classify, set risk labels, judge implementability
        └─► [prepare-issue-spec.yml]  write the `agent-spec:v1` Work Brief
        │                             (may set agent:needs-spec / agent:blocked)
        │                             ▲ also re-runs when a human comments on a
        │                             │ agent:needs-spec Issue — no manual re-run
        ▼
Human reviews the Work Brief and (only if approved) applies ──────────────► agent:ready   ← HUMAN ONLY
        │
        ▼
[implement-issue.yml] ── requires agent:ready + no agent:blocked (a Work Brief is NOT required)
        │                 agent:working ─► stable branch agent/issue-<n>-<slug>
        │                 reads the Issue + ALL human comments + newest brief,
        │                 implements with repository conventions + tests + verification
        │
        ├─► turn budget reached? ─► agent:continuation-needed + draft PR, agent:ready
        │     KEPT, every commit preserved. One "Re-run" tap continues the SAME
        │     branch and PR. Twice in a row ─► agent:blocked (split the Issue).
        ▼
Pull request opened (Closes #<n>) ──► agent:review  (only after a verified, non-empty PR)
        │
        ├─► [review-pr.yml]   independent review of the diff vs. acceptance criteria
        └─► [close-loop.yml]  status comment: checks + review + remaining human action
        │
        ▼
Human reviews & approves & MERGES  ← HUMAN ONLY (branch protection enforced)
        │
        ▼
agent:done (after merge + post-merge verification)
        │
        ▼
Release: still MANUAL. Either `npm run release` from a checkout, or the
"Manual release recovery" workflow from a phone. Both run the same release.yml.
Post-merge auto-release stays disabled — see docs/release-automation-gap.md.
```

### Label state machine

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
`risk:security`, `risk:data`, `risk:infra`, `risk:breaking-change`. Definitions live
in [`.github/labels.yml`](../.github/labels.yml).

### Automated vs. human-controlled

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

| Workflow                 | Trigger                                                                         | Permissions                                                                                     | Concurrency                                | Stop condition                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-triage.yml`       | `issues: opened/edited`, dispatch                                               | `contents:read`, `issues:write`                                                                 | per-issue, cancel-in-progress              | Skips issues past triage / bot edits                                                                                                                                       |
| `prepare-issue-spec.yml` | `issues: opened/labeled`, human `issue_comment` on `agent:needs-spec`, dispatch | `contents:read`, `issues:write`                                                                 | per-issue, cancel-in-progress              | Skips bots / issues past spec; comments the `agent-spec:v1` Work Brief only                                                                                                |
| `implement-issue.yml`    | `issues: labeled` (`agent:ready`), dispatch                                     | `contents:write`, `issues:write`, `pull-requests:write`                                         | per-issue, **no** cancel                   | No diff → `blocked` (safety stop) or `needs-spec`; turn budget → `continuation-needed` (work kept); other failure → `blocked`; `review` only after a verified non-draft PR |
| `review-pr.yml`          | `pull_request` (same-repo `agent/issue-*`), dispatch                            | `contents:read`, `issues:write`, `pull-requests:write`                                          | per-PR, cancel-in-progress                 | Skips fork / non-agent branches                                                                                                                                            |
| `manual-release.yml`     | `workflow_dispatch` only                                                        | `contents:read` default; `contents:write` on the bump job; release write set on the calling job | global `production-release`, **no** cancel | Stops before any mutation on a failed eligibility check; `dry_run` never mutates                                                                                           |
| `close-loop.yml`         | `workflow_run` (CI completed), dispatch                                         | read checks/statuses/contents, `issues:write`, `pull-requests:write`                            | per-commit, cancel-in-progress             | Only same-repo `pull_request` CI runs on `agent/issue-*`; skips when no matching agent PR                                                                                  |

### `agent:review` means a verified PR exists

`implement-issue.yml` treats **the workflow** — not the model — as the authority for
git and the PR. Claude only edits the working tree; the workflow then, in order:
verifies a real non-empty diff (`git status --porcelain` + diff against the base
branch), runs the required verification suite, commits, pushes, opens/updates the PR,
and **retrieves and validates** the PR (number, URL, head branch, head SHA, base
branch, changed-files count, additions, deletions, non-empty diff). Only after **all**
of those pass does it remove `agent:working` and apply `agent:review`. If the run
produced no change it goes to `agent:blocked` (a safety or approval stop) or
`agent:needs-spec` (a focused product question, or nothing to do); if it ran out of
turns it goes to `agent:continuation-needed` with its work preserved (see
[Smartphone-first operation](#smartphone-first-operation)); on any other failure it
goes to `agent:blocked`. `agent:review` therefore always corresponds to a reviewable, non-draft PR — it
is never a proxy for "the model finished". `review-pr.yml` and `close-loop.yml` only
act on a PR they retrieve from GitHub; neither creates `agent:review` and neither
infers a PR from a label.

Every workflow: declares an explicit `timeout-minutes`, uses `pull_request` (never
`pull_request_target`), selects its Claude credential from exactly one method (see
[Claude authentication](#claude-authentication)), and is **inert until a human
completes the setup below**.

## Smartphone-first operation

This loop is designed to be **supervised from a phone**. The whole normal lifecycle —
requesting work, approving it, watching it run, continuing it after an interruption,
reviewing it, merging it — is doable in GitHub Mobile or a mobile browser, with no
local terminal, no local git, and no branch surgery.

### The normal flow

| #   | You do                                                                | Where                               |
| --- | --------------------------------------------------------------------- | ----------------------------------- |
| 1   | Open an Issue (Japanese or English, one sentence is enough)           | Issues → New                        |
| 2   | Read the **Agent Work Brief** comment                                 | the Issue                           |
| 3   | Apply **`agent:ready`** — the one approval that starts implementation | the Issue's Labels                  |
| 4   | Watch the run                                                         | Actions → _Implement issue_         |
| 5   | Read the bilingual result comment and the PR                          | the Issue / the PR                  |
| 6   | Review and **merge**                                                  | the PR                              |
| 7   | Release the merged PR                                                 | Actions → _Manual release recovery_ |
| 8   | Confirm the Release and the Pages deployment                          | Releases / the run summary          |

All eight steps are mobile. Merging never releases anything by itself — step 7 is
always a deliberate act, whether you run `npm run release` from a desktop or
[Manual release recovery](#manual-release-recovery) from your phone.

### Watching and re-running from GitHub Mobile

Actions → pick the workflow → pick the run. A failed or incomplete run offers
**Re-run failed jobs** (and **Re-run all jobs**). That is the continuation button.
There is also **Run workflow** → _Implement issue_, which asks only for an Issue
number; use it when there is no failed run to re-run. If the mobile app does not show
the dispatch form on your version, open the same page in the mobile browser.

Both entry points run **identical** validation, branch naming, safety checks, and
continuation logic. Neither accepts a branch, a command, or a CLI argument.

### `agent:continuation-needed`

**The run hit its turn budget, not a wall.** Reaching `--max-turns` is an execution
budget boundary — it is **not** a specification problem, and it never applies
`agent:needs-spec`. When it happens:

- Every edit made so far is **committed** to the stable branch `agent/issue-<n>-<slug>`.
- A **draft** pull request is opened or updated, clearly marked incomplete. Its
  verification has not been run; do not merge it as-is.
- `agent:working` comes off, **`agent:ready` stays on** — your approval is still in
  force — and `agent:continuation-needed` goes on.
- A short bilingual comment states the branch, the PR, what was completed, and the
  one action available: re-run the workflow.

Nothing is discarded and nothing needs repairing by hand.

### How a retry resumes

One Issue has **one** branch and **one** pull request for its whole life. On every
run, before the agent starts, the workflow resolves that branch, checks it out with
all prior commits intact, and finds the existing open PR. The agent is told to read
`git log`/`git diff` and the previous check point comment first, and to implement
**only the remaining work**.

The workflow never force-pushes, never resets, never squashes, and never deletes an
agent branch. It commits on top and updates the same PR — so a retry cannot produce
a duplicate PR, a duplicate branch, or lost commits. If the Issue title changed
between runs, the branch of the existing open PR still wins.

### After repeated turn-limit exhaustion

Two **consecutive** turn-limited runs stop the cycle. The branch and PR are kept, and
the Issue moves to `agent:blocked` with a bilingual comment recommending you either:

- open a smaller follow-up Issue covering the single smallest useful next step; or
- raise the Actions variable `AGENT_MAX_TURNS`, then remove `agent:blocked` and
  re-apply `agent:ready`.

Both are taps. (The count is the trailing run of check point comments, so any comment
you write in between resets it.)

### There is no automatic continuation — on purpose

A run **could** re-dispatch itself — `workflow_dispatch` is one of the documented
exceptions to the rule that events raised by `GITHUB_TOKEN` create no new workflow
run, so no personal access token would be needed. It is excluded for a different
reason: `gh workflow run` requires `actions: write` on the job, which would let the
implementation job start **any** workflow in this repository. That is a much broader
grant than "implement a change", and the loop's own design rules it out. The re-run
tap costs one interaction and keeps the permission boundary where it is.

### When a desktop is genuinely required

Rare, and always stated explicitly in the comment when it happens:

- **A pull request with conflicts GitHub's web editor cannot resolve.**
- **A push rejected because the agent branch diverged** (someone else moved it). The
  run fails to `agent:blocked` rather than overwriting anything. From a phone you can
  close the PR and delete the branch to start clean; preserving both instead needs a
  desktop rebase.

Everything else — labels, re-runs, reviews, merges, closing a PR, deleting a branch —
is available on mobile.

## Mobile notifications / モバイル通知

**English.** The loop's notification mechanism is a plain GitHub **@mention**. When a
workflow leaves the loop in a state that needs a human decision, it posts one
bilingual Issue or pull-request comment whose first line mentions the repository
owner. GitHub Mobile turns a direct mention into a push notification, so nothing
outside GitHub is involved: no webhook, no Slack, no email API, no third-party push
service, no personal access token, and no new secret. The mentioned login is
`github.repository_owner` unless the Actions variable `NOTIFY_OWNER` overrides it.

**日本語.** 通知の仕組みは GitHub の **@メンション** そのものです。人間の判断が必要な状態に
なったとき、ワークフローは日英併記のコメントを Issue または PR に 1 件投稿し、その先頭で
リポジトリオーナーをメンションします。GitHub Mobile はダイレクトメンションをプッシュ通知に
するため、GitHub の外側は一切関与しません (webhook・Slack・メール API・外部プッシュ
サービス・PAT・新しいシークレットのいずれも不要)。メンション先は
`github.repository_owner` で、Actions 変数 `NOTIFY_OWNER` があればそちらが優先されます。

### What creates a mention / メンションが発生するイベント

| Event                                                     | Where the comment lands | Workflow              |
| --------------------------------------------------------- | ----------------------- | --------------------- |
| `agent:needs-spec` — one product decision is needed       | the Issue               | `implement-issue.yml` |
| `agent:blocked` — a safety, approval, or failure stop     | the Issue               | `implement-issue.yml` |
| `agent:continuation-needed` — the turn budget was reached | the Issue               | `implement-issue.yml` |
| A **verified** pull request is ready for review           | the Issue               | `implement-issue.yml` |
| CI failed or timed out on an agent pull request           | the pull request        | `close-loop.yml`      |
| The independent review workflow itself failed             | the pull request        | `review-pr.yml`       |

A turn-limit stop is **execution** continuation, never `agent:needs-spec` — its notice
says so explicitly. / ターン上限による停止は**実行**の継続であり、`agent:needs-spec` では
ありません。通知本文にもその旨を明記します。

### What stays quiet / あえて通知しないイベント

Triage starting or finishing · Work Brief creation or refresh · `agent:working` ·
ordinary progress · tests passing during implementation · routine label changes ·
a successful release · a successful Pages deployment · non-blocking review
suggestions · a repeated status event for a state you were already told about.

These still appear in the Issue, the pull request, and the Actions tab — they just do
not ring your phone. / これらは Issue・PR・Actions には表示されますが、スマホに通知は
届きません。

### Release and Pages failure — a human decision, not implemented / リリースと Pages の失敗

**English.** `release.yml` and `manual-release.yml` deliberately hold **neither**
`issues: write` nor `pull-requests: write` — they run `contents: read` by default and
widen only per job, only for what publishing requires. A mention comment therefore
cannot be posted from either one without granting a comment-writing permission to a
workflow that publishes releases, and a tag-push release has no Issue or pull request
to comment on in the first place. That trade is the owner's to make, not
automation's, so it is documented here instead of taken silently. Until it is
decided, **step 4 below is what covers release and Pages failures**: GitHub Mobile's
Actions notification for failed workflows already pushes for both.

**日本語.** `release.yml` と `manual-release.yml` は `issues: write` も
`pull-requests: write` も持ちません (既定は `contents: read` で、公開に必要な範囲だけを
ジョブ単位で広げています)。そのためメンションコメントを投稿するには、リリースを公開する
ワークフローにコメント書き込み権限を与える必要があり、さらにタグ push によるリリースには
コメント先の Issue も PR も存在しません。この判断はオーナーが行うべきもので、自動化が黙って
変更してよいものではないため、実装せずここに記録します。決定までは、**下記の手順 4** が
リリースと Pages の失敗をカバーします (GitHub Mobile の失敗ワークフロー通知が両方に届きます)。

### Enabling the notifications / 通知を有効にする手順

1. **Watch or participate in the repository.** Watch → _All Activity_ or
   _Participating and @mentions_. / リポジトリを Watch する (または参加する)。
2. **Enable Direct mentions** in GitHub Mobile → Settings → Notifications. This is
   the one that matters most. / GitHub Mobile の Settings → Notifications で
   **Direct mentions** を有効にする (最も重要です)。
3. **Enable Pull request review request notifications**, so a review request also
   reaches you. / **Pull request review request** の通知を有効にする。
4. **Enable Actions notifications**, preferably **failed workflows only** — that is
   what surfaces a release or Pages failure today. / **Actions** の通知を有効にする
   (**失敗したワークフローのみ**を推奨)。現状ではこれがリリースや Pages の失敗を知らせます。
5. **Allow GitHub Mobile notifications in the phone's operating system.** iOS and
   Android both mute an app silently if this is off. / 端末の OS 側で GitHub Mobile の
   通知を許可する (無効だと iOS も Android も無言で抑止します)。

### De-duplication / 重複通知の防止

**English.** Every notice carries a hidden marker,
`<!-- agent-notice:v1 type=<event-type> run=<workflow-run-id> -->`. Before posting,
the workflow lists the existing **bot-authored** comments and looks for that exact
marker; if it is already there, nothing is posted. Because "Re-run failed jobs"
reuses the same run id, re-running a workflow from your phone never produces a second
mention for the same state. A genuinely new state — a new commit, a new run, or a
different event type — gets its own marker and does notify. Human comments are never
matched and no comment is ever edited.

**日本語.** すべての通知には `<!-- agent-notice:v1 type=<種別> run=<ランID> -->` という
隠しマーカーが入ります。投稿前に**ボットが書いた**既存コメントを一覧して同じマーカーを探し、
存在すれば何も投稿しません。「Re-run failed jobs」は同じランIDを再利用するため、スマホから
再実行しても同じ状態で 2 通目が届くことはありません。新しいコミット・新しいラン・別の種別と
いった実際に変化した状態は、別のマーカーになるので通知されます。人間のコメントは照合対象外で、
既存コメントを編集することもありません。

### Notifications are not a guarantee / 通知は保証ではありません

**English.** GitHub does not promise that a notification is immediate, and a push can
be delayed, coalesced, or dropped by the OS. The **GitHub Notifications inbox** and
the **Actions** screen remain the source of truth — if something feels stalled, look
there rather than assuming nothing happened.

**日本語.** GitHub は通知の即時性を保証しておらず、プッシュは OS 側で遅延・集約・破棄される
ことがあります。**GitHub の Notifications 受信箱**と **Actions** 画面が正となる情報源です。
止まっているように見えるときは、通知が来ていないことを根拠にせず、そちらを確認してください。

## Bilingual agent communication

Every human-facing message the agent writes is **English first, Japanese second** —
Issue comments, Work Briefs, clarification questions, `agent:needs-spec` and
`agent:blocked` notices, PR titles and bodies, review findings, status comments,
failure guidance, and release notes.

Substantial messages use `## English` then `## 日本語`. Short review findings use
`**English:** …` / `**日本語:** …`. Checklists repeat the same items in both.

- **Human authors keep writing however they like.** Japanese or English, one line or
  ten — the bilingual rule binds the agent, never the person filing the Issue. Your
  own words are quoted verbatim in your language, never silently rewritten.
- **The two languages must say the same thing.** Same decisions, same risks, same
  hedging: if the English says "may", "not verified", or "assumed", the Japanese says
  so too. Neither side may carry a fact, caveat, or requirement the other omits.
- **Technical tokens are never translated or duplicated:** code, commands, file paths,
  identifiers, YAML keys, environment-variable and secret names, label names, model
  names, URLs, raw error messages, stack traces, and output from third-party actions.
  Long output is summarized once and linked, not printed twice.
- **Machine-readable parts stay in English, byte-for-byte.** The `agent-spec:v1`
  marker, the Work Brief's `##` section headings and `Status` values
  (`implement` / `needs-clarification` / `blocked`), the workflow's outcome tokens,
  `Closes #<n>`, and the `verify.md` check rows. Japanese goes in a `### 日本語` block
  _inside_ each Work Brief section, so nothing that reads the brief by heading breaks.
- **This policy does not apply to GitHub's own UI text or raw CI logs.** Review states
  (`APPROVE`, `REQUEST_CHANGES`, `COMMENT`) keep their GitHub names; the agent explains
  them bilingually in the body instead.
- **Bilingual output is never a reason to stop, delay, or narrow implementation.** It
  is a presentation rule, not a gate.

## Autonomous execution policy

**A human Issue is an outcome request, not a technical specification.** For low- and
medium-risk work, Claude reads the Issue, every human comment, and the repository,
then makes the professional call and implements it — recording what it inferred
rather than asking you to pre-specify it.

### What you do and do not have to write

You do **not** need to supply acceptance criteria, a file name, a technical design, a
test plan, or exact wording. Where the repository already has a convention, an
analogous feature, or a configured tool, that is the answer, and Claude uses it. What
you **do** need to supply is the outcome you want.

`agent:ready` means _"you may build this using your judgement"_. It is **not** a
statement that every detail was pre-specified, and it remains **human-only** —
automation never applies it.

### The Work Brief is a work record, not a gate

The `agent-spec:v1` comment is a **living Work Brief**: requested outcome, relevant
human updates, repository evidence, the implementation decision, assumptions,
alternatives considered, validation plan, risk, and status. It exists to make
implementation better and the PR reviewable.

It is **not** required to start implementation, and a stale one cannot strand an
Issue. Concretely:

- `implement-issue.yml` requires only `agent:ready`, no `agent:blocked`, and a valid
  open Issue. A missing brief is fine.
- The agent reads the **full Issue and every human-authored comment**, not just the
  brief. A later human comment outranks an earlier brief.
- A brief marked `needs-clarification` is **spent** the moment a human answers the
  question in a comment. The agent refreshes the brief itself; you never have to
  re-run _Prepare issue spec_ to make your own answer count. That workflow also
  re-runs on its own when a human comments on an `agent:needs-spec` Issue.
- Bot comments are never mistaken for human product decisions.

> **This fixed a real deadlock.** Previously the brief was the authoritative source
> and a `needs-spec` status was a hard stop, so an Issue whose open question had
> already been answered in a plain comment would be re-labelled `agent:needs-spec`
> with no repository change, forever.

### When Claude still stops

**`agent:needs-spec` — one focused question.** Only when every reasonable reading
would produce materially different user-visible behavior, data handling,
compatibility, or product intent, and neither repository evidence nor any comment
resolves it. You get at most one or two decision-oriented questions, each with a
recommended default and the consequence of choosing otherwise — never a demand for
generic acceptance criteria or a rewritten Issue.

**`agent:blocked` — a safety boundary.** Database schema/migrations, backfills,
destructive data operations or retention decisions; authentication, authorization,
permissions, identity, account access; billing, payments, pricing, monetary
calculation; personal or sensitive data, privacy, compliance, legal; secrets, keys,
token handling, signing; infrastructure, IAM, networking, production configuration,
deployment topology; public-API breaking changes; major dependency upgrades with
material compatibility or security impact; contradictory human requirements; missing
credentials or external access; and this repository's RSF binary format / `wasm/`
core. Routine uncertainty is **not** high risk and is not treated as such.

Both paths remove `agent:ready`, so answering and re-approving is a single action
that re-fires the run.

### The PR is the review point

Because Claude decides more on its own, the pull request — not the Issue — is where
those decisions are reviewed. Every autonomous implementation states in its PR body:
requested outcome, implementation decision, **assumptions made**, repository evidence
used, tests and validation run, trade-offs and remaining risks, and any suggested
follow-up Issue. Nothing about merging changed: a human still reviews and merges, and
`review-pr.yml` still reviews the diff independently.

## Human setup required (GitHub UI / CLI)

These cannot be automated safely and must be done by a repository admin.

1. **Install the Claude GitHub App** — authorize `anthropics/claude` for **only this
   repository** (not the whole org). See the action's README.
2. **Choose the Claude authentication method** — see
   [Claude authentication](#claude-authentication). In short: set the non-secret
   Actions **variable** `CLAUDE_AUTH_METHOD` to `oauth` or `api-key`, then configure
   the matching **secret** (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`). Never
   commit or echo a secret value.
3. **Check the third-party action pin** — the five agent workflows (`issue-triage`,
   `prepare-issue-spec`, `implement-issue`, `review-pr`, `close-loop`) reference
   `anthropics/claude-code-action` pinned to a **full commit SHA**, as repo policy
   (`docs/security.md`) requires; the trailing comment on each `uses:` line names
   the release that SHA is. Nothing is required here to enable the loop. When you
   deliberately move the pin to a newer release, change every call site to the same
   SHA and confirm the [allowed model values](#allowed-model-values) are still valid
   for that action build.
4. **Create the labels** — one-time, with the GitHub CLI (colors/descriptions from
   [`.github/labels.yml`](../.github/labels.yml)). **Create all of them, including
   the `type:*` and `risk:*` labels.** GitHub **silently drops** a label an Issue
   Form declares if that label does not exist in the repository — the issue is
   created without it and nothing warns you. Triage is also told to apply
   `risk:*` labels, and will only be able to recommend them in a comment while
   they are missing. (No workflow gates on a `type:*` label, precisely so a
   missing one cannot deadlock the loop, but the labels are still how humans
   filter the backlog.) Verify with `gh label list` after running the block
   below.

   The one-time commands (colors/descriptions from
   [`.github/labels.yml`](../.github/labels.yml)):

   ```bash
   gh label create "agent:triage"         -c 0e8a16 -d "Needs automated classification or clarification"
   gh label create "agent:needs-spec"     -c fbca04 -d "Acceptance criteria, constraints, or risk info insufficient"
   gh label create "agent:ready"          -c 1d76db -d "Human-approved for autonomous implementation (HUMANS ONLY)"
   gh label create "agent:working"        -c 5319e7 -d "Implementation workflow currently operating"
   gh label create "agent:continuation-needed" -c c5def5 -d "Turn budget reached; work preserved, re-run to continue"
   gh label create "agent:review"         -c d93f0b -d "PR exists; needs independent review or CI"
   gh label create "agent:blocked"        -c b60205 -d "Cannot safely continue without human input"
   gh label create "agent:done"           -c 0e8a16 -d "Completed after human-approved merge + verification"
   gh label create "risk:low"             -c c2e0c6 -d "Low-risk change"
   gh label create "risk:medium"          -c fef2c0 -d "Moderate risk"
   gh label create "risk:high"            -c e99695 -d "High risk; explicit human approval required"
   gh label create "risk:security"        -c b60205 -d "Touches auth/secrets/crypto/security controls"
   gh label create "risk:data"            -c b60205 -d "Touches personal/sensitive data or destructive ops"
   gh label create "risk:infra"           -c b60205 -d "Touches infra/networking/deploy/permissions"
   gh label create "risk:breaking-change" -c d93f0b -d "Public API or format breaking change"
   gh label create "type:bug"             -c d73a4a -d "A defect in existing behavior"
   gh label create "type:feature"         -c a2eeef -d "A new capability or improvement"
   gh label create "type:chore"           -c ededed -d "Maintenance: refactor, docs, tests, tooling"
   ```

5. **Branch protection / ruleset** on `main` (see next section).
6. **CODEOWNERS** — optional, recommended for high-risk directories (`wasm/`,
   `.github/`, `docs/security.md`, `src/core/rsf-*`).
7. **Actions default permissions & PR creation** — Settings → Actions → General →
   Workflow permissions: set the repository default to **Read repository contents**
   (the per-workflow `permissions:` blocks opt into more), **and enable "Allow GitHub
   Actions to create and approve pull requests."** Without that box, `implement-issue`
   can push the agent branch but `gh pr create` fails with _"GitHub Actions is not
   permitted to create or approve pull requests."_ If your organization enforces this
   at the org level, enable it there too. (The workflows never _approve_ PRs; a human
   approval is still required by branch protection.)
8. **Environments** — keep the `github-pages` environment's deployment gated to the
   tag `release.yml` flow; do not add auto-deploy environments.
9. **Spending limits** — set an Actions usage/spend cap and monitor Anthropic API
   usage (see Budget and circuit breakers).

## Claude authentication

The agent workflows authenticate to Claude with **exactly one** method per run,
chosen explicitly by an administrator — never auto-detected, never with one
credential falling back to the other, and never both supplied to the same action.

### How the selection works

- A **non-secret** GitHub Actions repository **variable** `CLAUDE_AUTH_METHOD`
  controls the choice. It is exposed to each job as `env.CLAUDE_AUTH_METHOD`.
- Each workflow first runs a **validation step** that fails early with a clear,
  non-sensitive error if the variable is anything other than `oauth` or `api-key`.
- The workflow then runs **only** the matching step:
  - `oauth` → the step using `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`
  - `api-key` → the step using `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`
- The other step is skipped by its `if:` condition, so a given run passes exactly one
  direct-Anthropic credential to the action.

### Administrator setup

1. Go to **Settings → Secrets and variables → Actions → Variables**.
2. Create or update the variable **`CLAUDE_AUTH_METHOD`**.
3. Set its value to exactly one of:
   - `oauth`
   - `api-key`

Then configure the **secret** that matches the chosen method (Settings → Secrets and
variables → Actions → **Secrets**):

- For `oauth`, configure **`CLAUDE_CODE_OAUTH_TOKEN`**. Generate its value locally
  with:

  ```bash
  claude setup-token
  ```

- For `api-key`, configure **`ANTHROPIC_API_KEY`**.

### Notes

- Only the secret matching the selected method is required at runtime.
- Both secrets may exist during a migration, but each run uses only one.
- **`oauth` is the preferred setting for this repository** if it currently uses a
  Claude Code subscription token (`claude setup-token`).
- Secret values must never be committed, logged, or shared in Issues or PRs. GitHub
  does not reveal a secret value after it is saved; if a value is ever exposed, rotate
  it.

## Claude model selection

The model each agent workflow uses is configurable **without editing YAML** and
**without exposing any credential** — the model id is non-secret.

### Precedence

1. A validated `workflow_dispatch` **input** named `model` (when a workflow is run
   manually). Highest precedence.
2. A non-secret repository (or organization) Actions **variable** `CLAUDE_MODEL`.
3. If neither is set, the Claude Code Action's **default** model (the workflow omits
   the `--model` flag entirely — it never passes an empty `--model`).

The model is **never** chosen from Issue text, labels, PR comments, or any other
untrusted content. Before invoking Claude, each workflow validates the selected id
against a small explicit allowlist and fails fast on anything else; the allowlisted
value is passed via `claude_args: --model <id>` (not the deprecated `model` input).

### Allowed model values

`anthropics/claude-code-action` runs the **Claude Code CLI**, whose `--model` flag
accepts both short aliases and full model ids. The allowlist covers both.

**Aliases** (recommended — they track the current model automatically):

| Value      | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| `opusplan` | Opus for planning, Sonnet for execution — good default for this loop |
| `opus`     | Opus tier                                                            |
| `sonnet`   | Sonnet tier — cheapest sensible default                              |
| `haiku`    | Haiku tier — fastest, for the lightest workflows                     |

**Full model ids** (pin an exact model; must be updated as models change):
`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-opus-4-6`,
`claude-sonnet-4-6`.

Leave `CLAUDE_MODEL` unset to use the action's own default. Manual runs may
override the variable through the `model` input. The Issue form deliberately gives
a requester **no** way to choose a model.

> **Adding a value.** The allowlist is duplicated in the `Resolve and validate
Claude model` step of all five agent workflows, and in each workflow's
> `workflow_dispatch` `model` choice list. Update every copy together — a value
> missing from the `case` arm fails the run with a clear error, which is the
> intended fail-closed behavior, not a bug.

> **Confirm the identifiers before enabling.** These two ids are the approved
> allowlist for this repository, but the exact strings a given
> `anthropics/claude-code-action` build accepts can change. Because the workflows are
> inert until a human configures credentials, confirm both ids are valid for the
> installed action version before turning the loop on, and update the allowlist (in
> every `Resolve and validate Claude model` step) if the action requires different
> strings. The workflow rejects any id outside the allowlist rather than guessing.

### Administrator setup

1. Go to **Settings → Secrets and variables → Actions → Variables**.
2. Create the variable **`CLAUDE_MODEL`** and set it to exactly one allowlisted id
   (or leave it unset to use the action default).

## Recommended minimum permissions

Default everything to **read-only**; grant write only where a workflow must act.

| Capability needed                             | Workflow(s)                                         | Scope granted                    |
| --------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| Read the repo / diff                          | all                                                 | `contents: read`                 |
| Add labels / comment on an Issue              | triage, prepare-spec, implement, review, close-loop | `issues: write`                  |
| Create a branch & push commits (agent branch) | implement                                           | `contents: write`                |
| Open / update a PR, post review comments      | implement, review, close-loop                       | `pull-requests: write`           |
| Read check / status results                   | close-loop                                          | `checks: read`, `statuses: read` |

Never request `administration`, `actions: write` (self-modifying workflows), org-level
scopes, or any secret beyond the single selected Claude credential
(`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).

## Branch protection

Configure a branch protection rule / ruleset on `main`:

- **No direct pushes** to `main` (or any protected branch).
- **Require a pull request before merging.**
- **Require status checks to pass** — at minimum the `CI` workflow.
- **Require at least one human approval.** (The agent review is advisory, not an
  approval.)
- **Dismiss stale approvals** when new commits are pushed.
- **Require conversation resolution** before merge.
- **Disable force pushes** and **restrict deletion** of protected branches.
- **Require CODEOWNERS review** for high-risk directories where configured.

These controls are the real guarantee that automation cannot merge; the workflows
also self-restrict, but branch protection is the enforcement boundary.

## Rollback

Every automated action is reversible and traceable to an Issue or PR:

- **Pause the whole loop:** remove `agent:ready` from open Issues; without it,
  `implement-issue.yml` refuses to run.
- **Disable one workflow:** Actions tab → select the workflow → **Disable workflow**
  (or delete/rename its file in a PR).
- **Remove write access:** revert the workflow's `permissions:` to `contents: read`,
  or set the repo Actions default to read-only.
- **Revoke the credential:** rotate/delete the active Claude secret
  (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) in repo secrets and rotate it at
  its source (`claude setup-token` for OAuth, the Anthropic console for the API key).
  Alternatively, set `CLAUDE_AUTH_METHOD` to an unset/invalid value to make every
  agent run fail fast at validation. No workflow can call the model without the
  matching secret.
- **Undo an agent PR:** close the PR (branch `agent/issue-*` is isolated), or if
  already merged, `git revert` the merge commit via a new PR.
- **Remove the App:** Settings → GitHub Apps → Claude → Configure → uninstall for
  this repository.
- **Investigate safely:** workflow logs never print secret values; read the run logs
  from the Actions tab. If a log ever appears to contain a secret, rotate it.

## Budget and circuit breakers

- **Max runtime:** each workflow sets `timeout-minutes` (triage 15, implement 45,
  review 25, close-loop 15).
- **Max concurrency:** `concurrency` groups key implementation to one run per Issue.
- **Turn caps:** each agent invocation passes `--max-turns` to bound model work
  (prepare-spec 25, review 25, close-loop 15). Two caps are tunable without editing
  YAML, via optional Actions **variables**: implementation defaults to `120`
  (`AGENT_MAX_TURNS`) and triage to `40` (`TRIAGE_MAX_TURNS`). Set them higher for
  larger features, lower to cap cost. An implementation run that exhausts its cap
  does **not** lose its work and does **not** land on `agent:blocked` — see
  [Smartphone-first operation](#smartphone-first-operation).
- **Why triage's cap is 40, not 20:** at 20 it failed with `error_max_turns` and
  `permission_denials_count: 0` — no tool was denied, the work simply did not fit.
  Triage on this repository is not cheap: the skill reads `CLAUDE.md` plus
  architecture/security context, and a feature Issue naming a subsystem (say, a new
  formula function) invites reading that subsystem to judge duplication and scope.
  The failure mode is asymmetric — the run sets labels early and comments last, so
  exhausting the cap leaves the Issue labelled `agent:triage` with **no comment**,
  which reads as "the agent ignored me". The cap was raised and, more importantly,
  `.claude/skills/triage-issue/SKILL.md` now carries an explicit reading budget that
  tells triage to prefer a shallow, honest comment over an unfinished deep one.
  Re-run a failed triage from the Actions tab (**Run workflow** → Issue number).
- **Tool allowlists:** every agent invocation also passes `--allowedTools` /
  `--disallowedTools`. This is **not optional**: with no `--allowedTools`, the
  action denies every tool call, and the run burns its entire turn budget on
  permission denials before failing with `error_max_turns` (look for a high
  `permission_denials_count` in the run's JSON output — that signature means a
  missing tool grant, not a too-small turn cap). Each workflow allows only
  `Read,Glob,Grep,Bash` and denies the mutating command families it must never
  use (pushes; PR merge/approve/close; releases; repo/secret/variable/workflow
  configuration; and raw `gh api` wherever the job holds `pull-requests: write`,
  so an approval cannot be submitted through the API). The job's `permissions:`
  block remains the enforcing boundary; the allowlists are defense in depth.
- **Why `close-loop.yml` follows `workflow_run`, not `check_suite`:** it originally
  triggered on `check_suite: [completed]` and consequently **never ran once** — GitHub
  documents that this event "does not trigger workflows if the check suite was
  created by GitHub Actions or if the check suite's head SHA is associated with
  GitHub Actions", and both hold here (CI's suite is created by Actions, on a commit
  `implement-issue.yml` authored under the Actions identity). It now triggers on
  `workflow_run` for the **CI** workflow. `workflow_run` is a privileged trigger — it
  runs from the default branch with secrets even for fork PRs — so the job is gated
  at event level to same-repo `pull_request` CI runs on `agent/issue-*` branches and
  **must never gain a checkout step**: it only calls `gh` and comments, so no PR code
  is ever executed. It carries the same single-bot allowance as `review-pr.yml` below.
- **Why `review-pr.yml` allows one bot:** the action refuses bot-initiated runs by
  default. `implement-issue.yml` opens the agent PR under `GITHUB_TOKEN`, so the PR
  author — and the actor on the resulting `pull_request` event — is
  `github-actions[bot]`, and the review run failed with _"Workflow initiated by
  non-human actor"_ before ever reaching Claude. `review-pr.yml` therefore sets
  `allowed_bots: github-actions` — **exactly that one bot; never `'*'`**, and no
  dependency bots (Dependabot/Renovate PRs are skipped anyway by the
  `agent/issue-*` branch gate). This does **not** weaken any approval gate:
  `agent:ready` stays human-only, this job cannot approve or merge (see the tool
  allowlists above), it uses `pull_request` (never `pull_request_target`), and it is
  gated to same-repo agent branches. `implement-issue.yml` deliberately does **not**
  set `allowed_bots`, so a bot-applied `agent:ready` still cannot start an
  implementation — that is defense in depth on top of the human-only label rule.
- **Max retries per Issue:** treat repeated `agent:blocked` on the same Issue (e.g.
  ≥ 2 failed implementation attempts) as an escalation — a human investigates before
  re-approving. Turn-limit continuation enforces its own bound: **two consecutive**
  turn-limited runs escalate to `agent:blocked` automatically, with a recommendation
  to split the Issue.
- **Pause switch:** removing `agent:ready` (or disabling `implement-issue.yml`) halts
  new implementation work immediately.
- **Usage review:** periodically review the Actions usage report and Anthropic API
  usage; set a repository Actions spending limit.

## Manual release recovery

**English —** `Manual release recovery`
([`manual-release.yml`](../.github/workflows/manual-release.yml)) runs the documented
release procedure for an **already merged** pull request, from the Actions UI, so a
maintainer can release without a local checkout. It does not duplicate the release:
it calls [`release.yml`](../.github/workflows/release.yml), the same implementation a
tag push uses.

**日本語 —** `Manual release recovery`
([`manual-release.yml`](../.github/workflows/manual-release.yml)) は、**マージ済みの**
プルリクエストに対して、Actions の画面から所定のリリース手順を実行します。ローカルの
チェックアウトなしでリリースできます。リリース処理を二重に持つことはせず、タグ push と
同じ実装である [`release.yml`](../.github/workflows/release.yml) を呼び出します。

### When to use it / 使うタイミング

- **English:** when a merged change should be released and you cannot (or do not want
  to) run `npm run release` from a desktop. It is also the recovery path if a release
  label or a release step was missed. **The normal path is still to decide the bump
  before merging**, and to release with `npm run release -- <bump>` from a checkout;
  manual recovery is an exception, not the default process.
- **日本語:** マージ済みの変更をリリースしたいが、デスクトップから `npm run release` を
  実行できない (またはしたくない) ときに使います。リリースのラベルや手順を取りこぼした
  場合の復旧手段でもあります。**通常はマージ前にバージョンの上げ方を決め**、チェックアウト
  した環境から `npm run release -- <bump>` でリリースしてください。手動復旧はあくまで
  例外です。

### Steps / 手順

1. Open **Actions** in GitHub Mobile or a mobile browser. / GitHub Mobile かモバイル
   ブラウザで **Actions** を開きます。
2. Open **Manual release recovery**. / **Manual release recovery** を開きます。
3. Tap **Run workflow**. / **Run workflow** をタップします。
4. Enter the merged PR number — **Pull requests → Closed** lists them newest merged
   first, and every run annotates the newest merged pull request on its own run page,
   so a wrong guess costs one stopped run and then tells you the number. / マージ済みの
   PR 番号を入力します。**Pull requests → Closed** に新しくマージされた順で並んでいます。
   またこのワークフローは実行ページに最新のマージ済み PR を注記として出力するため、
   番号を間違えても実行が 1 回停止するだけで、正しい番号が分かります。
5. Select `patch`, `minor`, or `major`. / `patch`・`minor`・`major` から選びます。
6. **Tick `dry_run` and run it that way first.** / **まず `dry_run` にチェックを入れて
   実行してください。**
7. Read the bilingual dry-run summary on the run page. / 実行ページの日英併記の結果を
   確認します。
8. Only if it is correct, run again with `dry_run` unticked. / 内容が正しい場合にのみ、
   `dry_run` のチェックを外して再実行します。
9. Confirm the resulting tag, GitHub Release, and Pages deployment — both are linked
   from the summary. / 生成されたタグ・GitHub Release・Pages のデプロイを確認します
   (いずれも結果に URL が出ます)。

> `dry_run` defaults to **unticked**, so step 6 is a deliberate action. A run with it
> unticked releases for real.
> `dry_run` の既定はチェックなしです。手順 6 は意識的に行ってください。チェックを外した
> ままの実行は本番リリースになります。

### Why the PR number is required / PR 番号が必須である理由

- **English:** there is deliberately no "just release the current tip of `main`" mode.
  The specific merged pull request you name is the release's authorization and its
  audit trail: it is what proves the released change was reviewed, that it landed on
  `main`, and that it is not itself a `Release vX.Y.Z` commit or a `release/*` branch.
  Releasing whatever `main` happens to hold would give none of those guarantees and
  would need its own separate defence against re-releasing an already-shipped commit.
  The number is required; finding it is the part that was made easy (step 4).
- **日本語:** 「現在の `main` の先端をそのままリリースする」モードは意図的に用意して
  いません。指定するマージ済みの PR こそがリリースの承認であり監査証跡です。リリース
  対象の変更がレビュー済みであること、`main` に入っていること、そしてそれ自体が
  `Release vX.Y.Z` コミットや `release/*` ブランチではないことを示します。`main` の
  内容を無条件にリリースする方式ではこれらの保証がいずれも得られず、既にリリース済みの
  コミットを再リリースしないための別の防御も必要になります。番号の指定は必須のままとし、
  番号を「見つけやすくする」側を改善しました (手順 4)。

### What it refuses / 拒否すること

- **English:** an arbitrary branch, commit SHA, version string, command, or CLI
  argument — the only inputs are a numeric PR number, a fixed `patch`/`minor`/`major`
  choice, and a boolean. A PR that is not merged, or not merged into `main`. A merge
  commit unreachable from `main`. A merge commit an existing release already contains.
  A tag that points somewhere unexpected — it stops without touching tags, commits,
  Releases, or Pages. Two releases at once: automatic and manual share the
  `production-release` concurrency group, and a release in progress is never cancelled.
  The bump type is never read from Issue text, PR text, comments, commits, or labels.
- **日本語:** 任意のブランチ・コミット SHA・バージョン文字列・コマンド・CLI 引数は
  受け付けません。入力は PR 番号 (数値)、`patch`/`minor`/`major` の固定選択、真偽値の
  3 つだけです。未マージの PR、`main` 以外へのマージ、`main` から到達できないマージ
  コミット、既存リリースに既に含まれるマージコミットも拒否します。タグが想定外の場所を
  指している場合は、タグ・コミット・Release・Pages のいずれにも触れずに停止します。
  同時実行も防ぎます (自動・手動が `production-release` の同一グループを共有し、実行中の
  リリースは決してキャンセルされません)。バージョンの種別を Issue・PR・コメント・
  コミット・ラベルの文面から読み取ることはありません。

### If a previous attempt was interrupted / 前回が中断された場合

- **English:** if the version-bump commit and tag exist but the GitHub Release does
  not, running the workflow again completes the publish from that verified tag — no
  second commit, no second tag. If the Release already exists, the run reports
  `already released` and changes nothing. Nothing is ever force-pushed, reset, or
  deleted.
- **日本語:** バージョン更新のコミットとタグはあるが GitHub Release がない場合、再実行
  すると検証済みのタグから公開だけを完了します (コミットやタグを重複して作りません)。
  Release が既にある場合は「既にリリース済み」と報告し、何も変更しません。force push・
  reset・削除は一切行いません。

## Release automation (post-merge) — intentionally disabled

**There is no automatic release-on-merge.** Merging a PR never cuts a release. Every
release is a deliberate human act — either the tag-driven flow below, or
[Manual release recovery](#manual-release-recovery), which runs that same flow from
the Actions UI. Releasing remains the documented, human-run flow:

- A human runs `npm run release -- patch | minor | major` (see the README
  "Cutting a release" section). It runs from `main`, runs the full checks, bumps
  the version, and pushes a `vX.Y.Z` **tag**.
- Pushing that tag triggers [`release.yml`](../.github/workflows/release.yml), which
  re-verifies and publishes the GitHub Release (ZIP + SHA-256 + SBOM + signed
  provenance) and deploys `dist/` to the `github-pages` environment. No repository
  secrets are required (GITHUB_TOKEN + OIDC).

A post-merge `release-after-merge.yml` has been evaluated twice and **deliberately not
created**. The decisive reason is mechanical, not stylistic: `release.yml` is triggered
by a **tag push**, and GitHub does not create a workflow run for events raised by
`GITHUB_TOKEN` (the only exceptions are `workflow_dispatch`, `repository_dispatch`, and
`pull_request` opened/synchronize/reopened). An automation that bumped, tagged, and
pushed with the built-in token would therefore leave a `Release vX.Y.Z` commit and tag
on `main` with **no** GitHub Release, SBOM, provenance, or Pages deployment — silently,
and with no documented rollback. Introducing a PAT or GitHub App token purely to chain
workflows is out of scope, and converting `release.yml` into a reusable `workflow_call`
workflow would be a rewrite of the working release path that no repository document
authorizes.

Four further blockers stand independently: the bump type is not mechanically derivable
(no `release:*` labels exist or are in use, and no conventional-commits/changesets
mechanism is present); `npm run release` runs `test:rust`, which needs a Rust toolchain
that no workflow installs; the script bumps, commits, tags, and pushes as one
non-separable run and refuses the detached HEAD that `actions/checkout` produces; and no
non-destructive rollback is documented for a published Release, tag, or Pages deploy.

Note also that `main` currently has **no branch protection configured**, contrary to the
assumption recorded elsewhere in this document. Whether `main` should be protected, and
whether Actions may push to it, is a human decision that changes the entire release
design. Repository settings are never changed by automation.

The full analysis, the verified release-asset inventory, and the exact decisions that
would have to be recorded in `README.md` first are in
[`docs/release-automation-gap.md`](release-automation-gap.md).

**To disable releases entirely / immediately:** disable or delete
`.github/workflows/release.yml` (Actions tab → the workflow → **Disable workflow**),
and/or do not push version tags. Because releases are tag-triggered, simply not
pushing a `vX.Y.Z` tag means nothing is ever released.

**Required release secrets, by name:** none beyond the run's `GITHUB_TOKEN` (plus
OIDC for provenance/Pages). No Anthropic credential is involved in releasing.

## Future auto-merge criteria (documented, NOT enabled)

Auto-merge is intentionally **off**. A future, separately-approved phase could
consider a PR for auto-merge **only if all** of the following hold:

- Explicitly classified `risk:low`.
- No database, auth, billing, privacy, infrastructure, or major-dependency changes.
- All required checks pass.
- No unresolved review findings.
- Required human / CODEOWNERS approval exists.
- The PR does not modify workflow permissions, deployment configuration, or
  protected-branch controls.
- The change is confined to a narrow allowlist of directories / file types.
- The repository owner has explicitly enabled auto-merge for the repo.

Until every one of those is designed, reviewed, and turned on by a human, merges and
releases remain manual.

## Safely testing the loop with one low-risk Issue

1. Complete the Human setup above (App, secret, SHA-pin, labels, branch protection).
2. Open a `type:chore` Issue with a tiny, low-risk, well-specified change (for
   example: "Fix a typo in `README.md` section X", with acceptance criterion "the
   word 'teh' becomes 'the'; no other changes; all checks pass").
3. Confirm `issue-triage.yml` runs and labels it (expect `risk:low`; not
   `agent:ready`).
4. As a human, verify the spec, then apply `agent:ready`.
5. Watch `implement-issue.yml`: it adds `agent:working`, opens `agent/issue-<n>-...`,
   and a PR, then sets `agent:review`.
6. Review `review-pr.yml` findings and the `close-loop.yml` status comment.
7. As a human, review and merge the PR yourself. Optionally apply `agent:done`.
8. To abort at any time: remove `agent:ready`, or disable the workflow.
