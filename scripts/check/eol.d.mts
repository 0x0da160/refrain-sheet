// SPDX-License-Identifier: MIT
export interface EolRegister {
  reviewed?: string;
  reviewIntervalDays?: number;
  warnWithinDays?: number;
  components?: Record<
    string,
    { eol?: string | null; support?: string; plan?: { action?: string; due?: string } | null }
  >;
}
export declare function trackedKeys(sbom: unknown): Map<string, Set<string>>;
export declare function evaluateEol(
  register: EolRegister,
  tracked: Map<string, Set<string>>,
  today: string,
): { failures: string[]; overdue: string[]; warnings: string[] };
