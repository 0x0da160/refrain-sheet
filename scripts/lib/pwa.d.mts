// SPDX-License-Identifier: MIT
export interface BrandIcon {
  src: string;
  [key: string]: unknown;
}

export interface BrandManifest {
  icons: BrandIcon[];
  [key: string]: unknown;
}

export declare const SERVICE_WORKER_FILE: string;
export declare const MANIFEST_FILE: string;
export declare const CACHE_PREFIX: string;
export declare const APPLE_TOUCH_ICON_NAME: string;

export declare function selectPrecacheList(paths: string[]): string[];
export declare function contentVersion(files: Array<{ path: string; bytes: Uint8Array | string }>): string;
export declare function buildServiceWorkerSource(options: { version: string; precache: string[] }): string;
export declare function iconLocation(src: string): string;
export declare function buildWebManifest(master: BrandManifest): BrandManifest;
export declare function iconFileNames(master: BrandManifest): string[];
