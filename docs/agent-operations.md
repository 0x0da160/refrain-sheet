# Agent operations

This document describes the GitHub Issue-driven engineering loop for Refrain Sheet:
how an Issue becomes a reviewed pull request, which steps are automated, and which
steps stay under human control. It is the operational companion to `CLAUDE.md`
(agent contract) and `docs/security.md` (security policy, which governs).

> **Nothing in this loop merges code or deploys to production.** Merges, releases,
> and the `agent:ready` approval are always human actions.

## Overview

### Lifecycle

```text
Human opens Issue (structured form)
        │
        ▼
[issue-triage.yml] ── classify, find missing spec, set risk labels ──► agent:triage / agent:needs-spec
        │
        ▼
Human reviews, completes spec, and (only if approved) applies ──► agent:ready   ← HUMAN ONLY
        │
        ▼
[implement-issue.yml] ── agent:working ─► branch agent/issue-<n>-<slug>
        │                 smallest change + tests + verification
        ▼
Pull request opened (Closes #<n>) ──► agent:review
        │
        ├─► [review-pr.yml]   independent review of the diff vs. acceptance criteria
        └─► [close-loop.yml]  status comment: checks + review + remaining human action
        │
        ▼
Human reviews & approves & MERGES  ← HUMAN ONLY (branch protection enforced)
        │
        ▼
agent:done (after merge + post-merge verification)
```

### Label state machine

| Label              | Meaning                                                     | Who may apply       |
| ------------------ | ----------------------------------------------------------- | ------------------- |
| `agent:triage`     | Needs automated classification / clarification              | Automation or human |
| `agent:needs-spec` | Acceptance criteria, constraints, or risk info insufficient | Automation or human |
| `agent:ready`      | **Human-approved** for autonomous implementation            | **Human only**      |
| `agent:working`    | An implementation workflow is running on the Issue          | Automation          |
| `agent:review`     | A PR exists; needs independent review / CI completion       | Automation          |
| `agent:blocked`    | Cannot safely continue without human input                  | Automation or human |
| `agent:done`       | Completed after human-approved merge + verification         | Automation or human |

Risk labels (narrowly scoped): `risk:low`, `risk:medium`, `risk:high`,
`risk:security`, `risk:data`, `risk:infra`, `risk:breaking-change`. Definitions live
in [`.github/labels.yml`](../.github/labels.yml).

### Automated vs. human-controlled

| Step                               | Automated                          | Human          |
| ---------------------------------- | ---------------------------------- | -------------- |
| Triage & labeling                  | ✅ (`issue-triage.yml`)            | may adjust     |
| Approving an Issue (`agent:ready`) | ❌ never                           | ✅ required    |
| Implementation + PR                | ✅ (`implement-issue.yml`)         | —              |
| Independent review                 | ✅ (`review-pr.yml`)               | may add review |
| Status aggregation                 | ✅ (`close-loop.yml`)              | —              |
| **Merge**                          | ❌ never                           | ✅ required    |
| **Release / deploy**               | ❌ never (unchanged `release.yml`) | ✅ tag push    |

## Workflows

| Workflow              | Trigger                                              | Permissions                                                          | Concurrency                    | Stop condition                                                          |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `issue-triage.yml`    | `issues: opened/edited`, dispatch                    | `contents:read`, `issues:write`                                      | per-issue, cancel-in-progress  | Skips issues past triage / bot edits                                    |
| `implement-issue.yml` | `issues: labeled` (`agent:ready`), dispatch          | `contents:write`, `issues:write`, `pull-requests:write`              | per-issue, **no** cancel       | Refuses without `agent:ready` / with `agent:blocked`; blocks on failure |
| `review-pr.yml`       | `pull_request` (same-repo `agent/issue-*`), dispatch | `contents:read`, `issues:write`, `pull-requests:write`               | per-PR, cancel-in-progress     | Skips fork / non-agent branches                                         |
| `close-loop.yml`      | `check_suite: completed`, dispatch                   | read checks/statuses/contents, `issues:write`, `pull-requests:write` | per-commit, cancel-in-progress | Skips when no matching agent PR                                         |

Every workflow: declares an explicit `timeout-minutes`, uses `pull_request` (never
`pull_request_target`), selects its Claude credential from exactly one method (see
[Claude authentication](#claude-authentication)), and is **inert until a human
completes the setup below**.

## Human setup required (GitHub UI / CLI)

These cannot be automated safely and must be done by a repository admin.

1. **Install the Claude GitHub App** — authorize `anthropics/claude` for **only this
   repository** (not the whole org). See the action's README.
2. **Choose the Claude authentication method** — see
   [Claude authentication](#claude-authentication). In short: set the non-secret
   Actions **variable** `CLAUDE_AUTH_METHOD` to `oauth` or `api-key`, then configure
   the matching **secret** (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`). Never
   commit or echo a secret value.
3. **SHA-pin the third-party action** — the four agent workflows reference
   `anthropics/claude-code-action@v1`. Repo policy (`docs/security.md`) requires
   third-party actions pinned to a **full commit SHA**. Replace each `@v1` with a
   verified SHA (add a comment naming the version) before enabling.
4. **Create the labels** — one-time, with the GitHub CLI (colors/descriptions from
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
7. **Actions default permissions** — Settings → Actions → General → Workflow
   permissions → set the repository default to **Read repository contents** and
   require the per-workflow `permissions:` blocks (already declared) to opt into more.
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

## Recommended minimum permissions

Default everything to **read-only**; grant write only where a workflow must act.

| Capability needed                             | Workflow(s)                           | Scope granted                    |
| --------------------------------------------- | ------------------------------------- | -------------------------------- |
| Read the repo / diff                          | all                                   | `contents: read`                 |
| Add labels / comment on an Issue              | triage, implement, review, close-loop | `issues: write`                  |
| Create a branch & push commits (agent branch) | implement                             | `contents: write`                |
| Open / update a PR, post review comments      | implement, review, close-loop         | `pull-requests: write`           |
| Read check / status results                   | close-loop                            | `checks: read`, `statuses: read` |

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
- **Turn caps:** each agent invocation passes `--max-turns` to bound model work.
- **Max retries per Issue:** treat repeated `agent:blocked` on the same Issue (e.g.
  ≥ 2 failed implementation attempts) as an escalation — a human investigates before
  re-approving.
- **Pause switch:** removing `agent:ready` (or disabling `implement-issue.yml`) halts
  new implementation work immediately.
- **Usage review:** periodically review the Actions usage report and Anthropic API
  usage; set a repository Actions spending limit.

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
