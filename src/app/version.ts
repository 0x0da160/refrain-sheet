// SPDX-License-Identifier: MIT
import { APP_VERSION } from '../core/app-identity';

/**
 * The application version formatted for display, e.g. `v0.1.1`. The raw
 * identity (`APP_NAME`, `APP_VERSION`) lives in `src/core/app-identity.ts`,
 * the single source that the About dialog, the status bar, and the metadata
 * written into saved `.rsf` documents all read from.
 */
export const APP_VERSION_DISPLAY = `v${APP_VERSION}`;
