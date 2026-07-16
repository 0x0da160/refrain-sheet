// SPDX-License-Identifier: MIT
import type { Diagnostic, DiagnosticType } from './byte-csv-parser';
import type { LosslessDocument } from './lossless-document';

export interface ValidationSummary {
  diagnostics: Diagnostic[];
  /** Diagnostics shown in the dialog (capped so huge files stay responsive). */
  shown: Diagnostic[];
  truncated: number;
  counts: Partial<Record<DiagnosticType, number>>;
}

export const VALIDATION_DISPLAY_LIMIT = 200;

/**
 * Collect the structural problems found while parsing. Validation only
 * reports problems; the document is never repaired or normalized.
 */
export function validateDocument(doc: LosslessDocument): ValidationSummary {
  return summarizeDiagnostics(doc.diagnostics);
}

export function summarizeDiagnostics(diagnostics: Diagnostic[]): ValidationSummary {
  const counts: Partial<Record<DiagnosticType, number>> = {};
  for (const d of diagnostics) {
    counts[d.type] = (counts[d.type] ?? 0) + 1;
  }
  return {
    diagnostics,
    shown: diagnostics.slice(0, VALIDATION_DISPLAY_LIMIT),
    truncated: Math.max(0, diagnostics.length - VALIDATION_DISPLAY_LIMIT),
    counts,
  };
}
