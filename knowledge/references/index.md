# References

Curated pointers to internal reference material and external specs/standards
this repository relies on. This is an index, not new prose — each entry is a
link plus one line; the authoritative content stays where it already lives.
For the knowledge bundle's own domains, start at
[`knowledge/index.md`](../index.md), not here.

## Internal references

- [`knowledge/index.md`](../index.md) — the knowledge bundle's top-level
  domain map (Architecture, Operations, Formats, Agent loop, Domains, UI).
- [`docs/knip-baseline.md`](../../docs/knip-baseline.md) — the classified
  dead-code (Knip) audit baseline; reproduced with `npx knip`.
- [`docs/release-automation-gap.md`](../../docs/release-automation-gap.md) —
  why automatic release-on-merge is not implemented, and the manual release
  path that exists instead.
- [`docs/continuous-improvement-plan.md`](../../docs/continuous-improvement-plan.md)
  — a proposal-only roadmap; nothing in it is enabled.
- [`docs/csv-diff-review-proposal.md`](../../docs/csv-diff-review-proposal.md)
  — integration analysis for the "CSV Diff Review" feature request
  (Issue #255); proposal only, no feature code.
- [`CHANGELOG.md`](../../CHANGELOG.md) — user-visible change history,
  Keep a Changelog format.
- [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md) — third-party
  license notices for software bundled in the distributed build.
- Agent-workflow skills (`.claude/skills/*/SKILL.md`):
  - [`cleanup-audit`](../../.claude/skills/cleanup-audit/SKILL.md) — run
    Knip and classify findings into `docs/knip-baseline.md`.
  - [`implement-issue`](../../.claude/skills/implement-issue/SKILL.md) —
    implement one approved Issue on an isolated branch and open a PR.
  - [`prepare-issue-spec`](../../.claude/skills/prepare-issue-spec/SKILL.md)
    — turn an Issue and its comments into a living agent Work Brief.
  - [`review-pr`](../../.claude/skills/review-pr/SKILL.md) — independently
    review an agent-created PR against its Issue's acceptance criteria.
  - [`safe-delete`](../../.claude/skills/safe-delete/SKILL.md) — delete one
    verified-dead code item in a single small, evidence-documented PR.
  - [`triage-issue`](../../.claude/skills/triage-issue/SKILL.md) — classify
    an Issue and apply safe labels.
  - [`verify-change`](../../.claude/skills/verify-change/SKILL.md) — run the
    confirmed verification commands and report results honestly.

## External references

- [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md)
  — the spec this `knowledge/` bundle itself conforms to.
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — the format
  `CHANGELOG.md` follows (same URL cited there).
- [Semantic Versioning](https://semver.org/) — the versioning scheme
  `CHANGELOG.md` cites (same URL cited there).
- [Knip](https://knip.dev) — the unused-code analysis tool behind
  `knip.jsonc` and `docs/knip-baseline.md`.
