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
        │                 agent:working ─► branch agent/issue-<n>-<slug>
        │                 reads the Issue + ALL human comments + newest brief,
        │                 implements with repository conventions + tests + verification
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
Release: still MANUAL and tag-driven (`npm run release`). Post-merge auto-release is
intentionally disabled — see docs/release-automation-gap.md.
```

### Label state machine

| Label              | Meaning                                               | Who may apply       |
| ------------------ | ----------------------------------------------------- | ------------------- |
| `agent:triage`     | Needs automated classification / clarification        | Automation or human |
| `agent:needs-spec` | One material product decision is genuinely needed     | Automation or human |
| `agent:ready`      | **Human-approved** for autonomous implementation      | **Human only**      |
| `agent:working`    | An implementation workflow is running on the Issue    | Automation          |
| `agent:review`     | A PR exists; needs independent review / CI completion | Automation          |
| `agent:blocked`    | Cannot safely continue without human input            | Automation or human |
| `agent:done`       | Completed after human-approved merge + verification   | Automation or human |

Risk labels (narrowly scoped): `risk:low`, `risk:medium`, `risk:high`,
`risk:security`, `risk:data`, `risk:infra`, `risk:breaking-change`. Definitions live
in [`.github/labels.yml`](../.github/labels.yml).

### Automated vs. human-controlled

| Step                               | Automated                          | Human          |
| ---------------------------------- | ---------------------------------- | -------------- |
| Triage & labeling                  | ✅ (`issue-triage.yml`)            | may adjust     |
| Writing the Work Brief             | ✅ (`prepare-issue-spec.yml`)      | reviews it     |
| Approving an Issue (`agent:ready`) | ❌ never                           | ✅ required    |
| Implementation + PR                | ✅ (`implement-issue.yml`)         | —              |
| Independent review                 | ✅ (`review-pr.yml`)               | may add review |
| Status aggregation                 | ✅ (`close-loop.yml`)              | —              |
| **Merge**                          | ❌ never                           | ✅ required    |
| **Release / deploy**               | ❌ never (unchanged `release.yml`) | ✅ tag push    |

## Workflows

| Workflow                 | Trigger                                                                         | Permissions                                                          | Concurrency                    | Stop condition                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `issue-triage.yml`       | `issues: opened/edited`, dispatch                                               | `contents:read`, `issues:write`                                      | per-issue, cancel-in-progress  | Skips issues past triage / bot edits                                                                      |
| `prepare-issue-spec.yml` | `issues: opened/labeled`, human `issue_comment` on `agent:needs-spec`, dispatch | `contents:read`, `issues:write`                                      | per-issue, cancel-in-progress  | Skips bots / issues past spec; comments the `agent-spec:v1` Work Brief only                               |
| `implement-issue.yml`    | `issues: labeled` (`agent:ready`), dispatch                                     | `contents:write`, `issues:write`, `pull-requests:write`              | per-issue, **no** cancel       | No diff → `blocked` (safety stop) or `needs-spec`; failure → `blocked`; `review` only after a verified PR |
| `review-pr.yml`          | `pull_request` (same-repo `agent/issue-*`), dispatch                            | `contents:read`, `issues:write`, `pull-requests:write`               | per-PR, cancel-in-progress     | Skips fork / non-agent branches                                                                           |
| `close-loop.yml`         | `workflow_run` (CI completed), dispatch                                         | read checks/statuses/contents, `issues:write`, `pull-requests:write` | per-commit, cancel-in-progress | Only same-repo `pull_request` CI runs on `agent/issue-*`; skips when no matching agent PR                 |

### `agent:review` means a verified PR exists

`implement-issue.yml` treats **the workflow** — not the model — as the authority for
git and the PR. Claude only edits the working tree; the workflow then, in order:
verifies a real non-empty diff (`git status --porcelain` + diff against the base
branch), runs the required verification suite, commits, pushes, opens/updates the PR,
and **retrieves and validates** the PR (number, URL, head branch, head SHA, base
branch, changed-files count, additions, deletions, non-empty diff). Only after **all**
of those pass does it remove `agent:working` and apply `agent:review`. If the run
produced no change it goes to `agent:blocked` (a safety or approval stop) or
`agent:needs-spec` (a focused product question, or nothing to do); on any failure it
goes to `agent:blocked`. `agent:review` therefore always corresponds to a reviewable PR — it
is never a proxy for "the model finished". `review-pr.yml` and `close-loop.yml` only
act on a PR they retrieve from GitHub; neither creates `agent:review` and neither
infers a PR from a label.

Every workflow: declares an explicit `timeout-minutes`, uses `pull_request` (never
`pull_request_target`), selects its Claude credential from exactly one method (see
[Claude authentication](#claude-authentication)), and is **inert until a human
completes the setup below**.

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
3. **SHA-pin the third-party action** — the five agent workflows (`issue-triage`,
   `prepare-issue-spec`, `implement-issue`, `review-pr`, `close-loop`) reference
   `anthropics/claude-code-action@v1`. Repo policy (`docs/security.md`) requires
   third-party actions pinned to a **full commit SHA**. Replace each `@v1` with a
   verified SHA (add a comment naming the version) before enabling. While pinning,
   also confirm the [allowed model values](#allowed-model-values) are valid for that
   action build.
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
  fails and lands on `agent:blocked` — raise `AGENT_MAX_TURNS` and re-apply
  `agent:ready` to retry.
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
  re-approving.
- **Pause switch:** removing `agent:ready` (or disabling `implement-issue.yml`) halts
  new implementation work immediately.
- **Usage review:** periodically review the Actions usage report and Anthropic API
  usage; set a repository Actions spending limit.

## Release automation (post-merge) — intentionally disabled

**There is no automatic release-on-merge.** Merging a PR never cuts a release.
Releasing remains the documented, human-run, **tag-driven** flow:

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
