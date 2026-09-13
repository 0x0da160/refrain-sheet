// SPDX-License-Identifier: MIT
export type BuildMode = 'offline' | 'hosted';
export declare const BUILD_MODES: readonly BuildMode[];
export declare const HOSTED_ALLOWLIST: Record<string, string[]>;
export declare const HOSTED_KEYWORD_GRANTS: Record<string, string[]>;
export declare function assertBuildMode(mode: string): BuildMode;
export declare function allowedOrigins(mode: BuildMode): string[];
export declare function allowedKeywords(mode: BuildMode): string[];
export declare function buildCsp(mode: BuildMode | string): string;
