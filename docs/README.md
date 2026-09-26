# docs/

Two kinds of file live here. Deeper, durable knowledge belongs in
[`knowledge/`](../knowledge/index.md), not here.

| Location                                                               | What it holds                                                              | Kept current by                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`eol-register.json`](eol-register.json), [`eol-plan.md`](eol-plan.md) | Lifecycle (EOL) register and the plan derived from it                      | `npm run check:eol`, the `update-dependencies` skill                  |
| [`knip-baseline.md`](knip-baseline.md)                                 | Classified unused-code baseline                                            | `npm run check:knip`, the `cleanup-audit` skill                       |
| [`proposals/`](proposals/)                                             | Proposals, drafts and gap analyses, each with a **Status** line at the top | Hand-maintained; move an adopted decision into `knowledge/decisions/` |
