# Operations

Security policy, supply-chain controls, and performance engineering for
Refrain Sheet.

- [Security threat model](security-threat-model.md) — the offline-by-design
  guarantee, the Google Drive sync exception's exact scope, the trust
  boundaries and controls table, and how the formula engine treats every
  input as hostile.
- [Security supply-chain controls](security-supply-chain.md) — dependency
  policy, lockfile enforcement, npm hardening, CI permission model, Actions
  pinning, and release security controls.
- [Dependency lifecycle](dependency-lifecycle.md) — weekly patching,
  the quarterly EOL review, the full SBOM as inventory, and the
  `check:eol` gate on `docs/eol-register.json`.
- [Performance principles](performance-principles.md) — the responsiveness
  principles, the "what is optimized where" map, and the deliberate
  non-optimizations (including the WASM-offload candidates survey from
  Issue #408).
- [Performance measurements](performance-measurements.md) — how to
  reproduce the benchmark suite, and the measured numbers for a specific
  revision. Time-sensitive: re-run `npm run bench` before relying on the
  numbers for a new decision.
