// SPDX-License-Identifier: MIT
// Single source of truth for the application's Content-Security-Policy.
//
// Two build modes share one policy definition so they cannot silently drift:
//
//   offline  dist/ — opened directly via file:// and shipped in the release
//            ZIP. Makes zero network connections of any kind. This is the
//            artifact `docs/security.md`'s no-network guarantee covers, and it
//            is deliberately unaffected by anything below.
//   hosted   dist-hosted/ — served at app.refrain-sheet.com. This is the only
//            artifact the approved opt-in cloud-sync exception in
//            `docs/security.md` applies to.
//
// HOSTED_ALLOWLIST is EMPTY today, so both modes currently produce a
// byte-identical policy. That is the point: the split mechanism lands with no
// change in behaviour and no increase in attack surface. Widening the
// allowlist is a separate, deliberate, reviewable edit to this one file —
// `scripts/check-dist.mjs` fails on any origin that is not listed here.

/** @typedef {'offline' | 'hosted'} BuildMode */

/** @type {readonly BuildMode[]} */
export const BUILD_MODES = ['offline', 'hosted'];

// Origins the hosted build may load code from or connect to. Empty by design.
// Adding an entry here relaxes the hosted CSP and nothing else — the offline
// artifact never consults this list.
/** @type {Record<string, string[]>} */
export const HOSTED_ALLOWLIST = {
  'script-src': [],
  'connect-src': [],
};

// The policy itself, in emission order. Keep this ordering stable: the offline
// artifact's CSP is asserted byte-for-byte, so reordering is a visible change.
/** @type {ReadonlyArray<readonly [string, readonly string[]]>} */
const DIRECTIVES = [
  ['default-src', ["'none'"]],
  ['script-src', ["'self'", 'file:', "'wasm-unsafe-eval'"]],
  ['style-src', ["'self'", 'file:']],
  ['img-src', ["'self'", 'file:', 'data:']],
  ['font-src', ["'self'", 'file:']],
  ['connect-src', ["'none'"]],
  ['object-src', ["'none'"]],
  ['base-uri', ["'none'"]],
  ['form-action', ["'none'"]],
];

/**
 * @param {string} mode
 * @returns {BuildMode}
 */
export function assertBuildMode(mode) {
  if (!BUILD_MODES.includes(/** @type {BuildMode} */ (mode))) {
    throw new Error(`unknown build mode "${mode}" (expected ${BUILD_MODES.join(' or ')})`);
  }
  return /** @type {BuildMode} */ (mode);
}

/**
 * Extra sources the given mode grants a directive.
 *
 * @param {BuildMode} mode
 * @param {string} directive
 * @returns {string[]}
 */
function extraSources(mode, directive) {
  return mode === 'hosted' ? (HOSTED_ALLOWLIST[directive] ?? []) : [];
}

/**
 * Every origin the given mode is allowed to name anywhere in its policy.
 *
 * @param {BuildMode} mode
 * @returns {string[]}
 */
export function allowedOrigins(mode) {
  assertBuildMode(mode);
  if (mode !== 'hosted') return [];
  return [...new Set(Object.values(HOSTED_ALLOWLIST).flat())];
}

/**
 * Build the complete CSP string for a build mode.
 *
 * @param {BuildMode | string} mode
 * @returns {string}
 */
export function buildCsp(mode) {
  const buildMode = assertBuildMode(mode);
  return DIRECTIVES.map(([directive, sources]) => {
    const extra = extraSources(buildMode, directive);
    if (extra.length === 0) return `${directive} ${sources.join(' ')}`;
    // "'none'" is only meaningful on its own: granting an origin means the
    // keyword has to go, or the whole directive is invalid.
    const base = sources.filter((source) => source !== "'none'");
    return `${directive} ${[...base, ...extra].join(' ')}`;
  }).join('; ');
}
