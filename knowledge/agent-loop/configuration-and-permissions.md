---
type: agent-loop-concept
title: Configuration and permissions
description: Claude authentication method selection, model selection and its allowlist, the minimum-permissions table, one-time human repository setup (including the one-time label-creation commands), branch protection, and a walkthrough for safely testing the loop on one low-risk Issue.
sources:
  - resource: docs/agent-operations.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T15:30:00Z
---

# Configuration and permissions

## Claude authentication

The agent workflows authenticate to Claude with **exactly one** method
per run, chosen explicitly by an administrator — never auto-detected,
never with one credential falling back to the other, and never both
supplied to the same action.

### How the selection works

- A non-secret GitHub Actions repository **variable** `CLAUDE_AUTH_METHOD`
  controls the choice. It is exposed to each job as
  `env.CLAUDE_AUTH_METHOD`.
- Each workflow first runs a validation step that fails early with a
  clear, non-sensitive error if the variable is anything other than
  `oauth` or `api-key`.
- The workflow then runs only the matching step:
  - `oauth` → the step using
    `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`
  - `api-key` → the step using
    `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`
- The other step is skipped by its `if:` condition, so a given run passes
  exactly one direct-Anthropic credential to the action.

### Administrator setup

1. Go to Settings → Secrets and variables → Actions → Variables.
2. Create or update the variable `CLAUDE_AUTH_METHOD`, set to exactly one
   of `oauth` or `api-key`.
3. Configure the matching secret (Settings → Secrets and variables →
   Actions → Secrets):
   - For `oauth`, configure `CLAUDE_CODE_OAUTH_TOKEN`. Generate its value
     locally with `claude setup-token`.
   - For `api-key`, configure `ANTHROPIC_API_KEY`.

Only the secret matching the selected method is required at runtime. Both
secrets may exist during a migration, but each run uses only one.
`oauth` is the preferred setting for this repository if it currently uses
a Claude Code subscription token. Secret values must never be committed,
logged, or shared in Issues or PRs. GitHub does not reveal a secret value
after it is saved; if a value is ever exposed, rotate it.

## Claude model selection

The model each agent workflow uses is configurable without editing YAML
and without exposing any credential — the model id is non-secret.

### Precedence

1. A validated `workflow_dispatch` **input** named `model` (when a
   workflow is run manually). Highest precedence.
2. A non-secret repository (or organization) Actions **variable**
   `CLAUDE_MODEL`.
3. If neither is set, the Claude Code Action's own default model (the
   workflow omits `--model` entirely — it never passes an empty
   `--model`).

The model is **never** chosen from Issue text, labels, PR comments, or
any other untrusted content. Before invoking Claude, each workflow
validates the selected id against a small explicit allowlist and fails
fast on anything else; the allowlisted value is passed via
`claude_args: --model <id>` (not the deprecated `model` input).

### Allowed model values

`anthropics/claude-code-action` runs the Claude Code CLI, whose `--model`
flag accepts both short aliases and full model ids. The allowlist covers
both.

**Aliases** (recommended — they track the current model automatically):

| Value      | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| `opusplan` | Opus for planning, Sonnet for execution — good default for this loop |
| `opus`     | Opus tier                                                            |
| `sonnet`   | Sonnet tier — cheapest sensible default                              |
| `haiku`    | Haiku tier — fastest, for the lightest workflows                     |

**Full model ids** (pin an exact model; must be updated as models
change): `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`,
`claude-opus-4-6`, `claude-sonnet-4-6`.

Leave `CLAUDE_MODEL` unset to use the action's own default. Manual runs
may override the variable through the `model` input. The Issue form
deliberately gives a requester no way to choose a model.

> **Adding a value.** The allowlist is duplicated in the `Resolve and
validate Claude model` step of all five agent workflows, and in each
> workflow's `workflow_dispatch` `model` choice list. Update every copy
> together — a value missing from the `case` arm fails the run with a
> clear error, which is the intended fail-closed behavior, not a bug.

> **Confirm the identifiers before enabling.** These are the approved
> allowlist for this repository, but the exact strings a given
> `anthropics/claude-code-action` build accepts can change. Because the
> workflows are inert until a human configures credentials, confirm both
> ids are valid for the installed action version before turning the loop
> on, and update the allowlist if the action requires different strings.
> The workflow rejects any id outside the allowlist rather than guessing.

### Administrator setup

1. Go to Settings → Secrets and variables → Actions → Variables.
2. Create the variable `CLAUDE_MODEL` and set it to exactly one
   allowlisted id, or leave it unset to use the action default.

## Recommended minimum permissions

Default everything to read-only; grant write only where a workflow must
act.

| Capability needed                             | Workflow(s)                                         | Scope granted                    |
| --------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| Read the repo / diff                          | all                                                 | `contents: read`                 |
| Add labels / comment on an Issue              | triage, prepare-spec, implement, review, close-loop | `issues: write`                  |
| Create a branch & push commits (agent branch) | implement                                           | `contents: write`                |
| Open / update a PR, post review comments      | implement, review, close-loop                       | `pull-requests: write`           |
| Read check / status results                   | close-loop                                          | `checks: read`, `statuses: read` |

Never request `administration`, `actions: write` (self-modifying
workflows), org-level scopes, or any secret beyond the single selected
Claude credential (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).

## Human setup required

These cannot be automated safely and must be done by a repository admin.

1. **Install the Claude GitHub App** — authorize `anthropics/claude` for
   only this repository (not the whole org).
2. **Choose the Claude authentication method** — see
   [Claude authentication](#claude-authentication) above.
3. **Check the third-party action pin** — the five agent workflows
   (`issue-triage`, `prepare-issue-spec`, `implement-issue`, `review-pr`,
   `close-loop`) reference `anthropics/claude-code-action` pinned to a
   full commit SHA, per
   [security supply-chain controls](../operations/security-supply-chain.md).
   The trailing comment on each `uses:` line names the release that SHA
   is. Nothing is required here to enable the loop; when the pin is
   deliberately moved to a newer release, every call site must move to
   the same SHA, and the [allowed model values](#allowed-model-values)
   re-confirmed for that action build.
4. **Create the labels** — one-time, with the GitHub CLI
   (colors/descriptions from `.github/labels.yml`). Create all of them,
   including the `type:*` and `risk:*` labels: GitHub **silently drops**
   a label an Issue Form declares if that label does not exist in the
   repository — the issue is created without it and nothing warns you.
   Triage is also told to apply `risk:*` labels, and can only recommend
   them in a comment while they are missing. (No workflow gates on a
   `type:*` label, precisely so a missing one cannot deadlock the loop,
   but the labels are still how humans filter the backlog.) Verify with
   `gh label list` after running the block below.

   The one-time commands (colors/descriptions from
   [`.github/labels.yml`](../../.github/labels.yml)):

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

5. **Branch protection / ruleset** on `main` — see
   [Branch protection](#branch-protection) below.
6. **CODEOWNERS** — optional, recommended for high-risk directories
   (`wasm/`, `.github/`, `knowledge/operations/`, `src/core/rsf-*`).
7. **Actions default permissions & PR creation** — Settings → Actions →
   General → Workflow permissions: set the repository default to **Read
   repository contents** (the per-workflow `permissions:` blocks opt into
   more), and enable "Allow GitHub Actions to create and approve pull
   requests." Without that box, `implement-issue` can push the agent
   branch but `gh pr create` fails with "GitHub Actions is not permitted
   to create or approve pull requests." If the organization enforces
   this at the org level, enable it there too. (The workflows never
   _approve_ PRs; human approval is still required by branch protection.)
8. **Environments** — keep the `github-pages` environment's deployment
   gated to the tag `release.yml` flow; do not add auto-deploy
   environments.
9. **Spending limits** — set an Actions usage/spend cap and monitor
   Anthropic API usage (see
   [Budget, rollback, and release](budget-rollback-and-release.md)).

## Branch protection

Configure a branch protection rule / ruleset on `main`:

- No direct pushes to `main` (or any protected branch).
- Require a pull request before merging.
- Require status checks to pass — at minimum the `CI` workflow.
- Require at least one human approval. (The agent review is advisory,
  not an approval.)
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merge.
- Disable force pushes and restrict deletion of protected branches.
- Require CODEOWNERS review for high-risk directories where configured.

These controls are the real guarantee that automation cannot merge; the
workflows also self-restrict, but branch protection is the enforcement
boundary.

> As of this migration, `main` currently has **no branch protection
> configured** in this repository, contrary to the setup this section
> describes. Whether `main` should be protected is a human decision — see
> [Roadmap — not enabled](roadmap-not-enabled.md).

## Safely testing the loop with one low-risk Issue

1. Complete the Human setup above (App, secret, SHA-pin, labels, branch
   protection).
2. Open a `type:chore` Issue with a tiny, low-risk, well-specified change
   (for example: "Fix a typo in `README.md` section X", with acceptance
   criterion "the word 'teh' becomes 'the'; no other changes; all checks
   pass").
3. Confirm `issue-triage.yml` runs and labels it (expect `risk:low`; not
   `agent:ready`).
4. As a human, verify the spec, then apply `agent:ready`.
5. Watch `implement-issue.yml`: it adds `agent:working`, opens
   `agent/issue-<n>-...`, and a PR, then sets `agent:review`.
6. Review `review-pr.yml` findings and the `close-loop.yml` status comment.
7. As a human, review and merge the PR yourself. Optionally apply
   `agent:done`.
