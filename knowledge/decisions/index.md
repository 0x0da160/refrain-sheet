# Decisions

Durable decision records: not "what the current structure is" (that's
`architecture/`, `operations/`, `formats/`, `domains/`, `ui/`) but "why this
option and not the others," kept small and added only when a real,
non-obvious decision would otherwise get re-litigated or re-discovered from
scratch. Most architectural rationale already lives inline in the domain
concept files above (e.g. `architecture/dependency-rules.md`'s "why no
WASM formula evaluator" section, `operations/performance-principles.md`'s
surveyed-and-rejected WASM-offload candidates, `formats/rsf/compatibility.md`'s
versioning policy) — this domain exists for the smaller number of decisions
that aren't already anchored to one of those files.

- [Why no UI framework](no-ui-framework.md) — why the UI layer is
  hand-written TypeScript/DOM rather than React, Vue, or similar, and what
  that decision is actually grounded in.
- [Familiar operation, original expression — IP risk policy](ip-risk-policy.md)
  — how the app pursues an Excel-familiar feel without reproducing Excel's
  visual expression, assets, or branding, the design boundary that follows,
  and when a UI change must be escalated for IP review (Japan-focused;
  canonical text in Japanese).
