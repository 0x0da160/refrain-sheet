// SPDX-License-Identifier: MIT
import { version } from '../../package.json';

/**
 * The single authoritative source of the application identity and version.
 *
 * The version string is read from `package.json` at build time (bundlers
 * tree-shake the JSON named import down to the string), so the release
 * version is defined in exactly one place. Every consumer — the About
 * dialog, the status bar, and the metadata written into saved `.rcsv`
 * documents — imports it from here rather than hard-coding a number.
 */
export const APP_NAME = 'Refrain Sheet';

/** The current application version, e.g. `0.1.1` (no leading `v`). */
export const APP_VERSION: string = version;

/** The version formatted for display, e.g. `v0.1.1`. */
export const APP_VERSION_DISPLAY = `v${APP_VERSION}`;
