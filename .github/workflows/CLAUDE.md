# .github/workflows/CLAUDE.md

Local rules for GitHub Actions workflows. The root
[`CLAUDE.md`](../../CLAUDE.md) still governs. **Any change to a workflow's
permissions, triggers, or secrets is high-risk: get human approval first.**

- **Permissions:** read-only default (`permissions: contents: read`) at the
  top; widen per job, only to what that job needs.
- **Triggers:** `pull_request`, never `pull_request_target`. Never run code
  from a pull request's head in a job that holds a secret or write access.
- **Pinning:** official `actions/*` pinned to a major tag; every third-party
  action pinned to a full commit SHA with a version comment. A downloaded
  tool is pinned by version and verified against a recorded SHA-256
  (see `wasm.yml`), never `curl | sh`.
- **Workflows in use:** `ci.yml` and `dependency-review.yml` (pull requests),
  `wasm.yml` (Rust/WASM changes), `manual-release.yml` → `release.yml`
  (releases; the release commit also files the CHANGELOG.md section and the
  README code statistics), and the manual-only `release-docs.yml`. Don't add
  a workflow that runs on every push or merge unless it gates something; a
  rarely useful job belongs in a manual (`workflow_dispatch`) workflow or in
  the release.
- **The Claude credential** (only if an agent workflow is ever restored — the
  Issue-driven ones were removed; see `knowledge/agent-loop/index.md`) is
  referenced only as `secrets.CLAUDE_CODE_OAUTH_TOKEN` or
  `secrets.ANTHROPIC_API_KEY`, chosen by the non-secret variable
  `CLAUDE_AUTH_METHOD`, never transformed, echoed, or logged, and never both
  in one action invocation.
- **Merges and deploys stay human.** No workflow merges; Pages deploys only
  from the tag-triggered `release.yml`.
- `tests/release-workflow.test.ts` and `tests/release-staged-files.test.ts`
  assert release invariants. See
  `knowledge/agent-loop/configuration-and-permissions.md` and
  `knowledge/operations/security-supply-chain.md`.
