// SPDX-License-Identifier: MIT
/**
 * Stateless per-cell helpers for the `Grid` class (`./index.ts`): painting a
 * cell's visual style, explaining a malformed field, and caret hit-testing
 * inside a rendered cell's text.
 */
import { t } from '../../app/i18n';
import {
  BORDER_WIDTH_PX,
  borderSideValue,
  resolveSharedBorder,
  type BorderSideValue,
  type HorizontalAlign,
} from '../../core/workbook/cell-style';
import type { LosslessDocument } from '../../core/csv/lossless-document';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import { paintFont } from '../font-choices';

/** Render a resolved border side as a CSS `border-*` shorthand value (`''` when unset). */
function cssBorder(border: BorderSideValue | null): string {
  return border ? `${BORDER_WIDTH_PX[border.width]}px ${border.lineStyle} ${border.color}` : '';
}

/** Human-readable explanation of a malformed field's structural problem(s). */
export function malformedFieldTooltip(doc: LosslessDocument, row: number, col: number): string {
  const diags = doc.getFieldDiagnostics(row, col);
  if (diags.length === 0) {
    return '';
  }
  return diags
    .map(
      (d) =>
        `${t(`diag.${d.type}`)}: ${t(`diagDesc.${d.type}`, { expected: d.expected ?? 0, actual: d.actual ?? 0 })}`,
    )
    .join('\n');
}

/**
 * Apply (or clear) one cell's visual style — bold/italic/underline as CSS
 * classes, its font, colors and borders as inline styles so any `#rrggbb` value works
 * without a matching stylesheet rule. Assigning `''` restores the normal
 * grid appearance (the default border/background from `.vcell` in
 * `src/styles/index.css`), so this is safe to call on a reused, previously
 * styled cell element.
 *
 * A border shared with a neighbor is painted exactly once, as a single
 * line, instead of each cell drawing its own side: this cell paints its
 * bottom/right edges as the merge of its own borderBottom/Right with the
 * neighbor below/right's borderTop/Left ({@link resolveSharedBorder}), and
 * never paints its top/left edges except at the grid's own top/left
 * boundary (row/col 0) — the cell above/to the left already painted that
 * shared edge as its own (merged) bottom/right.
 *
 * A matching conditional-formatting rule (Format > Conditional
 * Formatting…, `conditional-format.ts`) overrides the cell's own
 * background/text color — the same "computed appearance wins" precedence
 * every mainstream spreadsheet uses — but never its bold/italic/underline
 * or borders, which conditional formatting cannot set.
 */
export function paintCellStyle(cell: HTMLElement, doc: RsfDocument, row: number, col: number): void {
  const style = doc.getStyle(row, col);
  const conditional = doc.getConditionalFormatStyle(row, col);
  cell.classList.toggle('cell-bold', !!style?.bold);
  cell.classList.toggle('cell-italic', !!style?.italic);
  cell.classList.toggle('cell-underline', !!style?.underline);
  paintFont(cell, style);
  paintAlign(cell, style?.horizontalAlign);
  cell.style.color = conditional?.textColor ?? style?.textColor ?? '';
  cell.style.backgroundColor = conditional?.backgroundColor ?? style?.backgroundColor ?? '';
  const below = row + 1 < doc.rowCount ? doc.getStyle(row + 1, col) : null;
  const right = col + 1 < doc.columnCount ? doc.getStyle(row, col + 1) : null;
  const top = row === 0 ? borderSideValue(style, 'borderTop') : null;
  const left = col === 0 ? borderSideValue(style, 'borderLeft') : null;
  const bottom = resolveSharedBorder(
    borderSideValue(style, 'borderBottom'),
    borderSideValue(below, 'borderTop'),
  );
  const rightSide = resolveSharedBorder(
    borderSideValue(style, 'borderRight'),
    borderSideValue(right, 'borderLeft'),
  );
  cell.style.borderTop = cssBorder(top);
  cell.style.borderLeft = cssBorder(left);
  cell.style.borderBottom = cssBorder(bottom);
  cell.style.borderRight = cssBorder(rightSide);
}

/** Where the text sits: `text-align`, plus `justify-content` for a wrapped row's flex cell. */
const JUSTIFY: Record<HorizontalAlign, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };

function paintAlign(cell: HTMLElement, align: HorizontalAlign | undefined): void {
  cell.style.textAlign = align ?? '';
  cell.style.justifyContent = align ? JUSTIFY[align] : '';
}

/**
 * Character offset within a rendered cell's text nearest a viewport point,
 * for seeding the editor's caret at the double-clicked position. Uses
 * whichever caret-hit-testing API the document exposes (the standards-track
 * `caretPositionFromPoint`, or the older `caretRangeFromPoint`); returns
 * null where neither is available (e.g. jsdom in tests) or the point misses
 * the cell's own text, so callers fall back to a sane default. The cell's
 * text is always a single text node (`paintCell` sets `textContent`
 * directly), so the returned offset is already the offset within the raw
 * cell value.
 */
export function caretOffsetFromPoint(cell: HTMLElement, clientX: number, clientY: number): number | null {
  const doc = cell.ownerDocument;
  let node: Node | null;
  let offset: number;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (!pos) {
      return null;
    }
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (!range) {
      return null;
    }
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    return null;
  }
  if (node?.nodeType === Node.TEXT_NODE) {
    if (!cell.contains(node)) {
      return null;
    }
    // Plain cells hold one text node; a rich-text cell holds one per
    // formatted part (`span.rich-run`), so add the parts before this one.
    let before = 0;
    for (const run of cell.querySelectorAll('.rich-run')) {
      if (run.contains(node)) {
        break;
      }
      before += run.textContent?.length ?? 0;
    }
    return before + offset;
  }
  if (node === cell) {
    // The hit landed on the cell element itself (e.g. past the end of a
    // short value, or an empty cell), not inside its text. `offset` here
    // is a child index rather than a character count: 0 means "before the
    // text", any other value means "after it".
    return offset > 0 ? cellTextLength(cell) : 0;
  }
  return null;
}

/** Length of a rendered cell's own text (a header filter button adds none). */
function cellTextLength(cell: HTMLElement): number {
  let length = 0;
  for (const child of cell.childNodes) {
    if (child.nodeType === Node.TEXT_NODE || (child as Element).classList?.contains('rich-text-body')) {
      length += child.textContent?.length ?? 0;
    }
  }
  return length;
}
