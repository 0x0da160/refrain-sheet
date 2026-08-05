// SPDX-License-Identifier: MIT
import {
  applyCellStylePatch,
  BORDER_SIDES,
  BORDER_STYLE_KEY,
  BORDER_WIDTH_KEY,
  cellStylesEqual,
  type BorderSide,
  type CellStylePatch,
} from '../../core/cell-style';
import type { CellRange } from '../../core/clipboard';
import type { StyleChange } from '../../core/history';
import { AppState, type Tab } from '../app-state';
import type { UiPort } from '../commands';

/** Every visible (non-hidden-row) cell of `range`, row-major. */
function rangeCells(
  range: CellRange,
  hidden: ReadonlySet<number> | null,
): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (let r = range.top; r <= range.bottom; r++) {
    if (hidden?.has(r)) {
      continue;
    }
    for (let c = range.left; c <= range.right; c++) {
      cells.push({ row: r, col: c });
    }
  }
  return cells;
}

/** A patch that clears every style property, for "Clear formatting". */
const CLEAR_PATCH: CellStylePatch = {
  bold: false,
  italic: false,
  underline: false,
  textColor: null,
  backgroundColor: null,
  borderTop: null,
  borderRight: null,
  borderBottom: null,
  borderLeft: null,
  numberFormat: null,
};

/**
 * Cell-/range-level visual formatting for RSF worksheets: bold, italic,
 * underline, text color, background color, per-side borders, and a numeric
 * display format. Extracted from `Commands` as a cohesive slice (the pattern
 * `RangeOpsCommands` established) — `Commands` still exposes the same public
 * methods, delegating to an instance of this class.
 *
 * Every change applies to the current selection as one atomic, undoable
 * `styles` history operation (see `src/core/history.ts`). Styling is purely
 * presentational: it never touches cell values, formula results, sort, or
 * filter, so it is applied even to cells inside a sorted range or a spill
 * (unlike a value write, which those refuse). Rows hidden by an active
 * filter are skipped, matching every other range operation.
 */
export class FormatCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
  ) {}

  toggleBold(tab: Tab): boolean {
    return this.toggleProperty(tab, 'bold', 'history.toggleBold');
  }

  toggleItalic(tab: Tab): boolean {
    return this.toggleProperty(tab, 'italic', 'history.toggleItalic');
  }

  toggleUnderline(tab: Tab): boolean {
    return this.toggleProperty(tab, 'underline', 'history.toggleUnderline');
  }

  /** Open the Text Color dialog (preselected from the top-left selected cell) and apply the choice. */
  async promptTextColor(tab: Tab): Promise<boolean> {
    const range = this.state.selectedRange(tab);
    const doc = tab.doc;
    if (!range || doc.kind !== 'rsf') {
      return false;
    }
    const current = doc.getStyle(range.top, range.left)?.textColor ?? null;
    const result = await this.ui.chooseTextColor(current);
    if (!result || tab.doc !== doc) {
      return false;
    }
    return this.applyToSelection(
      tab,
      { textColor: result.action === 'apply' ? result.color : null },
      'history.setTextColor',
    );
  }

  /** Open the Background Color dialog and apply the choice. */
  async promptBackgroundColor(tab: Tab): Promise<boolean> {
    const range = this.state.selectedRange(tab);
    const doc = tab.doc;
    if (!range || doc.kind !== 'rsf') {
      return false;
    }
    const current = doc.getStyle(range.top, range.left)?.backgroundColor ?? null;
    const result = await this.ui.chooseBackgroundColor(current);
    if (!result || tab.doc !== doc) {
      return false;
    }
    return this.applyToSelection(
      tab,
      { backgroundColor: result.action === 'apply' ? result.color : null },
      'history.setBackgroundColor',
    );
  }

  /** Open the Borders dialog (preselected from the top-left selected cell) and apply the choice. */
  async promptBorders(tab: Tab): Promise<boolean> {
    const range = this.state.selectedRange(tab);
    const doc = tab.doc;
    if (!range || doc.kind !== 'rsf') {
      return false;
    }
    const style = doc.getStyle(range.top, range.left);
    const current: Partial<Record<BorderSide, string>> = {};
    let currentLineStyle = null;
    let currentWidth = null;
    for (const side of BORDER_SIDES) {
      if (style?.[side] !== undefined) {
        current[side] = style[side];
        currentLineStyle ??= style[BORDER_STYLE_KEY[side]] ?? null;
        currentWidth ??= style[BORDER_WIDTH_KEY[side]] ?? null;
      }
    }
    const result = await this.ui.chooseBorders(current, currentLineStyle, currentWidth);
    if (!result || tab.doc !== doc) {
      return false;
    }
    const patch: CellStylePatch = { ...result.sides };
    for (const side of BORDER_SIDES) {
      if (result.sides[side] !== undefined && result.sides[side] !== null) {
        patch[BORDER_STYLE_KEY[side]] = result.lineStyle;
        patch[BORDER_WIDTH_KEY[side]] = result.width;
      }
    }
    return this.applyToSelection(tab, patch, 'history.setBorders');
  }

  /** Open the Number Format dialog (preselected from the top-left selected cell) and apply the choice. */
  async promptNumberFormat(tab: Tab): Promise<boolean> {
    const range = this.state.selectedRange(tab);
    const doc = tab.doc;
    if (!range || doc.kind !== 'rsf') {
      return false;
    }
    const current = doc.getStyle(range.top, range.left)?.numberFormat ?? null;
    const result = await this.ui.chooseNumberFormat(current);
    if (!result || tab.doc !== doc) {
      return false;
    }
    return this.applyToSelection(
      tab,
      { numberFormat: result.action === 'apply' ? result.format : null },
      'history.setNumberFormat',
    );
  }

  /** Remove every style property from the selection (values are untouched). */
  clearFormatting(tab: Tab): boolean {
    return this.applyToSelection(tab, CLEAR_PATCH, 'history.clearFormatting');
  }

  /**
   * Whether the selection is currently "on" for a boolean property — true
   * only when every visible cell in it already has the property set (the
   * same "uniform selection" rule spreadsheets use for Bold/Italic/
   * Underline). Drives both the next toggle's direction and the menu's
   * checked state.
   */
  isActive(tab: Tab, key: 'bold' | 'italic' | 'underline'): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    const hidden = this.state.hiddenRows(tab);
    return rangeCells(range, hidden).every(({ row, col }) => doc.getStyle(row, col)?.[key]);
  }

  private toggleProperty(tab: Tab, key: 'bold' | 'italic' | 'underline', label: string): boolean {
    return this.applyToSelection(tab, { [key]: !this.isActive(tab, key) }, label);
  }

  private applyToSelection(tab: Tab, patch: CellStylePatch, label: string): boolean {
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    return this.applyPatch(tab, range, patch, label);
  }

  private applyPatch(tab: Tab, range: CellRange, patch: CellStylePatch, label: string): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const hidden = this.state.hiddenRows(tab);
    const sheetId = doc.activeSheetId;
    const changes: StyleChange[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      if (hidden?.has(r)) {
        continue;
      }
      for (let c = range.left; c <= range.right; c++) {
        const before = doc.getStyle(r, c);
        const after = applyCellStylePatch(before, patch);
        if (!cellStylesEqual(before, after)) {
          changes.push({ row: r, col: c, before, after });
        }
      }
    }
    if (changes.length === 0) {
      return false;
    }
    return this.state.pushEntry(tab, { label, sheetId, ops: [{ type: 'styles', changes, sheetId }] });
  }
}
