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
// The offline policy is fixed and is asserted byte-for-byte by tests/csp.test.ts:
// nothing in HOSTED_ALLOWLIST can move it. Every extra permission the hosted
// build has lives in that one constant, so widening it is always a deliberate,
// reviewable edit to a single place — `scripts/check-dist.mjs` fails the build
// on any origin the built policy names that is not listed here.

/** @typedef {'offline' | 'hosted'} BuildMode */

/** @type {readonly BuildMode[]} */
export const BUILD_MODES = ['offline', 'hosted'];

// Origins the hosted build may load code from, frame, or connect to. Every
// entry here relaxes the hosted CSP and nothing else — the offline artifact
// never consults this list, so widening it cannot affect the release ZIP.
//
// These are the origins Google Drive sync needs (issue #416):
//   apis.google.com        the gapi loader that hosts the Google Picker
//   accounts.google.com    Google Identity Services: the token client and its
//                          consent popup (script, frame, and token endpoint)
//   www/content.googleapis.com  the Drive REST API and Picker's own backend
//   docs.google.com        the iframe the Picker itself renders in
//   *.googleusercontent.com, ssl/www.gstatic.com  Picker thumbnails and icons
//
// Deliberately NOT granted: 'unsafe-inline' for style-src. Google's api.js
// injects inline styles, so the Picker's chrome may render imperfectly without
// it; that is the accepted trade-off until a real browser test proves the
// relaxation is actually required.
//
// A directive named here that is absent from DIRECTIVES below (frame-src) is
// emitted for the hosted build only, so the offline policy keeps inheriting
// default-src 'none' for it.
/** @type {Record<string, string[]>} */
export const HOSTED_ALLOWLIST = {
  'script-src': ['https://apis.google.com', 'https://accounts.google.com'],
  'connect-src': [
    'https://www.googleapis.com',
    'https://content.googleapis.com',
    'https://accounts.google.com',
  ],
  'frame-src': ['https://docs.google.com', 'https://content.googleapis.com', 'https://accounts.google.com'],
  'img-src': ['https://*.googleusercontent.com', 'https://ssl.gstatic.com', 'https://www.gstatic.com'],
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
  const emitted = DIRECTIVES.map(([directive, sources]) => {
    const extra = extraSources(buildMode, directive);
    if (extra.length === 0) return `${directive} ${sources.join(' ')}`;
    // "'none'" is only meaningful on its own: granting an origin means the
    // keyword has to go, or the whole directive is invalid.
    const base = sources.filter((source) => source !== "'none'");
    return `${directive} ${[...base, ...extra].join(' ')}`;
  });

  // A directive the allowlist names but DIRECTIVES does not (frame-src) exists
  // only in the hosted policy. The offline policy keeps inheriting
  // default-src 'none' for it, which is exactly the stricter behaviour.
  if (buildMode === 'hosted') {
    const base = new Set(DIRECTIVES.map(([directive]) => directive));
    for (const [directive, sources] of Object.entries(HOSTED_ALLOWLIST)) {
      if (base.has(directive) || sources.length === 0) continue;
      emitted.push(`${directive} ${sources.join(' ')}`);
    }
  }

  return emitted.join('; ');
}
