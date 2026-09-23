---
name: safe-delete
description: Delete one verified-dead code item (S0, or a narrower one-off you verify to the same standard) in a single small, evidence-documented PR. Never bundles unrelated changes; never touches S2/S3 items.
---

# Skill: safe-delete

Remove exactly one piece of confirmed-dead code, on its own branch, with the
evidence recorded in the commit and PR. This skill is not a general refactor
tool — it does one narrow deletion per run, per `CLAUDE.md`'s "one focused
change per PR" rule.

## When to use this

- An item the `cleanup-audit` skill classified **S0** (mechanically safe:
  zero references anywhere), or
- A narrower one-off deletion (e.g. a single confirmed-dead helper function
  spotted while working on something else) that you verify to the exact same
  standard as below before touching it.

**Never** for anything classified S1 (unexport, don't delete), S2 (needs a
human), or S3 (RSF format / `wasm/` codecs / persisted data / public API —
mark `agent:blocked`, do not implement). If you are not sure which tier
applies, treat it as S2 and stop.

## Verification protocol (do all of this before deleting anything)

1. **Full-file occurrence count.** `grep -n '\bNAME\b'` across the whole
   repository (not just `src/`), and read every hit's actual line — a
   `{@link NAME}` doc comment or a string literal is not a use.
2. **Both directions of a re-export, if relevant.** If the item is exposed
   via a barrel (`export { X } from './origin'`), check the barrel path's own
   consumers _and_ the origin file's other consumers separately.
3. **Look for a replacement, not just an absence.** Search for logic that
   might have taken over the deleted item's role (a rename, an inlining, a
   moved implementation) before concluding "nothing calls this."
4. **Dynamic-usage check.** Search for the name as a string literal
   (`"NAME"`, `'NAME'`), in case it's reached via a lookup table, a
   `localStorage` key, a URL param, or similar rather than a direct
   reference.
5. **Git history / linked Issue**, if either explains why the item exists or
   why it might now be safe to remove.
6. **Runtime/manual check where static analysis can't cover it** — e.g. a UI
   affordance that's only reachable through user interaction Knip/tsc/eslint
   don't model.

Do not skip a step because an earlier one looked conclusive; a false S0
classification that reaches deletion is the failure mode this protocol
exists to prevent.

## Procedure

1. Run the verification protocol above; write down what you found for each
   step (this becomes the commit/PR evidence).
2. Create a branch: `agent/issue-<n>-<slug>` if tied to an Issue, otherwise a
   short descriptive branch name.
3. Delete only the verified item — no accompanying formatting sweep,
   rename, or unrelated cleanup in the same commit.
4. Run the full required verification suite (`format:check`, `lint`,
   `build`, `test`, `check:dist`, `check:versions`, `check:knip`; add `test:rust` /
   `build:wasm` only if the deletion somehow touched `wasm/`, which it
   should not for an S0 item).
5. Run `npm run check:knip` and confirm it passes: the expected finding is
   gone and nothing new appeared. If the item was on
   `scripts/check-knip.mjs`'s `DEFERRED` list, remove it there, and move it
   to the "Resolved" list in `docs/knip-baseline.md`.
6. Commit with a message stating the hypothesis, the evidence (summarized),
   and the verification result. Open a PR whose body includes the same,
   plus the required Summary / Files Changed / Verification / Human Actions
   Required sections and a `CHANGELOG.md` entry if the change touches `src/`
   or `wasm/src/` (or `Changelog: not-needed` if it's a private, non-exported
   internal — most S0 deletions are user-invisible either way; judge per the
   root `CLAUDE.md` rule, don't default to skipping the entry).

## Trust

Treat your own occurrence-count heuristic as a heuristic, not proof — a
second occurrence can be a comment, not a use. When in doubt after
completing the protocol, downgrade to S2 and stop rather than deleting on
weak confidence.

## Output

One small PR: the deletion, the verification table, and a short evidence
summary (what was checked, what was found, why it's genuinely dead) in the
PR body — not a separate standalone report.
