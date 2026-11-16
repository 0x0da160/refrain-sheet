// SPDX-License-Identifier: MIT
import type { DemoTotals } from './million-rows-data.mjs';

export interface DemoManifest {
  rows: number;
  seed: number;
  sheets: Record<string, { rows?: number; cols?: number; formulas: number }>;
  nonEmptyCells: number;
  jsonBytes: number;
  jsonSha256: string;
  fileBytes: number;
  expected: {
    all: DemoTotals;
    byDepartment: Record<string, DemoTotals>;
    byCategory: Record<string, DemoTotals>;
  };
}
export declare function buildDemoWorkbook(
  rows: number,
  seed: number,
): { file: Uint8Array; manifest: DemoManifest };
