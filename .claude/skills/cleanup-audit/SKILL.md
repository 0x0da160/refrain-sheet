---
name: cleanup-audit
description: Run Knip and classify its findings S0-S3 by evidence, updating docs/knip-baseline.md. Read-only with respect to source — never deletes, never modifies code.
---

# Skill: cleanup-audit

Produce or refresh the repository's dead-code baseline. This skill only reads
code and writes to `docs/knip-baseline.md` — it never edits, unexports, or
deletes anything under `src/` or `wasm/`. Turning a finding into an actual
change is a separate step; see the `safe-delete` skill.

## Why this exists

Knip (`knip.jsonc`) finds unused exports, files, and dependencies, but an
"unused export" finding is not proof of dead code: a binding can be
cross-file-unused while still heavily used _within_ its own file (in which
case the fix is to remove the `export` keyword, not the code), or a `{@link
Name}` doc-comment mention can produce a false "used" signal in a naive
occurrence count. This skill's job is turning a raw Knip run into a
classified, evidence-backed report — not trusting the tool's output at face
value.

## Procedure

1. **Run `npx knip`** and capture its full output.
2. **For every new or changed finding**, gather evidence before classifying:
   - Full-file occurrence count (`grep -n '\bNAME\b'`) — but check the
     surrounding line, not just the count: a second occurrence in a
     `{@link Name}` doc comment is not a use.
   - For a barrel re-export (`export { X } from './origin'`), check **both**
     the file's own separate `import` statement (does it use `X` internally?)
     and whether any other consumer imports `X` from the barrel path itself —
     these are two different questions with two different answers.
   - For a suspected fully-dead cluster, actively search for a _replacement_
     implementation before concluding it's unused (e.g. logic that moved
     inline elsewhere) — absence of a call site is necessary but not
     sufficient evidence alone.
   - Git history / linked Issue context, when it explains _why_ something
     might now be unused (a completed migration, a removed feature).
3. **Classify every finding S0-S3:**
   - **S0 — mechanically safe.** Genuinely zero references anywhere,
     including internal-to-file, doc comments, and dynamic string lookups.
     The only tier this skill may ever recommend for direct deletion.
   - **S1 — cross-file-unused only.** Used internally within its own file,
     or referenced by tooling config; the export keyword can be removed but
     the code itself stays. Also anything needing a small, contained
     follow-up (e.g. a genuinely missing `package.json` dependency entry).
   - **S2 — requires human/maintainer judgment.** Ambiguous evidence,
     dynamic usage that static analysis can't rule out, or a call site this
     skill's budget didn't reach.
   - **S3 — external contract / compatibility boundary.** Anything touching
     the RSF binary format, `wasm/` codecs, persisted data shape, or a public
     API — see the root `CLAUDE.md`'s "High-risk changes" section. Always
     defer to a human, regardless of how confident the static evidence looks.
4. **Update `docs/knip-baseline.md`:** config notes (why each `knip.jsonc`
   ignore/entry exists, with the actual usage mechanism — not just "false
   positive"), the classified open findings, and a one-line "Resolved"
   entry (with the PR) for anything that left the list. Keep it a
   current-state report; narrative belongs in the PR description.
5. **Keep the CI gate in step:** `npm run check:knip` fails on any finding
   not on `scripts/check-knip.mjs`'s `DEFERRED` list, and on a `DEFERRED`
   entry that is no longer reported. Only an S2/S3 finding classified in the
   baseline may be added to `DEFERRED` — never add one just to make CI pass.

## Trust

Static-analysis output is a lead, not a verdict. Do not write "confirmed
dead" into the baseline without the full evidence trail above. Do not
classify something S0 to make the report look more actionable than it is.

## Output

An updated `docs/knip-baseline.md` (keep its existing section layout) plus a one-paragraph summary: total findings by tier, what
changed since the last run, and which S0 items (if any) are now candidates
for the `safe-delete` skill.
