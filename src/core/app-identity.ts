// SPDX-License-Identifier: MIT
import { version } from '../../package.json';

/**
 * The single authoritative source of the application identity and version.
 *
 * The version string is read from `package.json` at build time (bundlers
 * tree-shake the JSON named import down to the string), so the release
 * version is defined in exactly one place. It lives in the core layer because
 * `rsf-document.ts` writes both values into saved `.rsf` metadata, and core
 * must never import from `src/app/`; `src/app/version.ts` builds the display
 * form on top of it for the About dialog and the status bar.
 */
export const APP_NAME = 'Refrain Sheet';

/** The current application version, e.g. `0.1.1` (no leading `v`). */
export const APP_VERSION: string = version;
