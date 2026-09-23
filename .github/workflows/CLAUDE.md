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
- **The Claude credential** is referenced only as
  `secrets.CLAUDE_CODE_OAUTH_TOKEN` or `secrets.ANTHROPIC_API_KEY`, chosen by
  the non-secret variable `CLAUDE_AUTH_METHOD`. It is never transformed,
  echoed, or logged, and never both in one action invocation; that is why
  each agent workflow has one `claude-code-action` step per auth method.
  Their shared prompt and arguments live once, as YAML anchors in the OAuth
  step, and the API-key step reuses them by alias. Edit the anchor, not a
  copy.
- **Merges and deploys stay human.** No workflow merges; Pages deploys only
  from the tag-triggered `release.yml`.
- `tests/release-workflow.test.ts` and `tests/release-staged-files.test.ts`
  assert release invariants. See
  `knowledge/agent-loop/configuration-and-permissions.md` and
  `knowledge/operations/security-supply-chain.md`.
