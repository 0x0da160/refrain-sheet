// SPDX-License-Identifier: MIT
export declare function hasVersionSection(text: string, version: string): boolean;
export declare function releaseChangelog(text: string, version: string, date: string): string | null;
export declare function archiveHeader(series: string): string;
export declare function archiveChangelog(
  text: string,
  currentVersion: string,
  existing?: Record<string, string>,
): { changelog: string; archives: Record<string, string> };
export declare function linkArchives(text: string, seriesList: string[]): string;
