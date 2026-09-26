// SPDX-License-Identifier: MIT
import type { CellStyle } from '../core/cell-style';
import type { TextRun } from '../core/rich-text';
import { el } from './dom';

/**
 * One `<span>` per rich-text run, as text (never HTML). Each span carries
 * its effective bold/italic/underline — the run's own value, else the whole
 * cell's — so a plain part inside a bold or underlined cell shows plain.
 * `colorOverride` (a conditional-formatting color) wins over every run's
 * own text color, the same "computed appearance wins" rule the cell follows.
 */
export function richTextNodes(
  runs: readonly TextRun[],
  cell: CellStyle | null,
  colorOverride?: string,
): HTMLElement[] {
  return runs.map((run) => {
    const span = el('span', { className: 'rich-run', text: run.text });
    span.style.fontWeight = (run.bold ?? !!cell?.bold) ? 'bold' : 'normal';
    span.style.fontStyle = (run.italic ?? !!cell?.italic) ? 'italic' : 'normal';
    span.style.textDecoration = (run.underline ?? !!cell?.underline) ? 'underline' : 'none';
    const color = colorOverride ?? run.textColor;
    if (color) {
      span.style.color = color;
    }
    return span;
  });
}
