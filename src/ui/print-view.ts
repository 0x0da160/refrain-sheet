// SPDX-License-Identifier: MIT
/**
 * File > Print…: lays the chosen sheets out as plain tables in a print-only
 * layer and hands the page to the browser's own print (whose "Save as PDF"
 * makes the PDF). On screen the layer is never shown; while printing, only
 * it is (`src/styles/print.css`). The layer is removed once printing ends.
 *
 * What prints is what the sheet shows: displayed values (formula results,
 * number formats), cell formatting and conditional formatting, column
 * widths, on the active sheet its sort order and filter, and the shapes,
 * pictures and charts over the cells (hidden ones left out), each drawn at
 * its offset from the cell it is anchored to. Rows are as tall as on screen:
 * one line each, text cut at the cell's edge, unless the sheet wraps text,
 * when they grow to fit it. Banded rows print when the sheet shows them, in
 * its band strength (the selected row and column highlights follow the
 * cursor, so they do not print). Everything is text, never HTML. Page size and orientation go to `@page` through a
 * constructed stylesheet (a `<style>` element would be refused by the
 * offline build's CSP); where the browser cannot adopt one, its own print
 * dialog still lets the user pick them.
 */
import { isWorkbook } from '../core/editor-document';
import type { AppState, Tab } from '../app/state';
import { resolveGridLook, resolveWrap } from '../app/state/view-layers';
import type { BandLevel } from '../core/grid-look';
import { t } from '../app/i18n';
import { getPrintSettings, setPrintSettings } from '../app/settings';
import { columnLabel } from '../core/formula';
import { parseMarkdown } from '../core/markdown';
import {
  MAX_PRINT_CELLS,
  PRINT_MARGIN_MM,
  pageBreakRows,
  pageSizeCss,
  printArea,
  printScale,
  type PrintArea,
  type PrintSettings,
} from '../core/print-layout';
import {
  BORDER_WIDTH_PX,
  borderSideValue,
  type BorderSideValue,
  type CellStyle,
} from '../core/workbook/cell-style';
import type { ConditionalFormatStyle } from '../core/workbook/conditional-format';
import type { SheetObject } from '../core/workbook/sheet-objects';
import { runsForText } from '../core/workbook/rich-text';
import { el } from './dom';
import { COL_WIDTH, ROW_HEAD_WIDTH } from './grid/geometry';
import { openPrintPanel } from './dialogs/print-dialog';
import { renderMarkdownBlocks } from './markdown-render';
import { paintFont } from './font-choices';
import { richTextNodes } from './rich-text-render';
import { drawObject } from './sheet-object-view';

/** One grid to print: its rows (document rows, in print order) and columns. */
interface GridPart {
  kind: 'grid';
  title: string;
  rows: number[];
  cols: number[];
  widths: number[];
  value: (row: number, col: number) => string;
  input: (row: number, col: number) => string;
  style: (row: number, col: number) => CellStyle | null;
  conditional: (row: number, col: number) => ConditionalFormatStyle | null;
  /** The shown objects anchored to each cell (`row:col`), bottom to top, with their stacking place. */
  objects: Map<string, Array<{ o: SheetObject; z: number }>>;
  /** Draw an object at its offset from the cell's corner. */
  draw: (o: SheetObject) => HTMLElement;
  /** Objects already drawn: a repeated first row draws its objects on the first page only. */
  drawn: Set<string>;
  /** A grid-paper sheet's square (px): every row and column prints one square wide. */
  paper?: number;
  /** Whether long text wraps onto more lines (as the sheet shows it) or is cut at the cell's edge. */
  wrap: boolean;
  /** The band strength when the sheet shows banded rows. */
  bands: BandLevel | null;
}

/** A Markdown, JSON, YAML or text sheet: its source. */
interface TextPart {
  kind: 'markdown' | 'text';
  title: string;
  text: string;
}

type PrintPart = GridPart | TextPart;

/** Why nothing was printed. */
export type PrintRefusal = 'empty' | 'tooLarge';

/**
 * Print `tab` with `settings`. Returns why nothing printed, or null once
 * the browser's print has been opened.
 */
export function printTab(
  state: AppState,
  tab: Tab,
  settings: PrintSettings,
  win: Window = window,
): PrintRefusal | null {
  const parts = collectParts(state, tab, settings);
  const cells = parts.reduce((n, p) => n + (p.kind === 'grid' ? p.rows.length * p.cols.length : 0), 0);
  if (parts.length === 0) {
    return 'empty';
  }
  if (cells > MAX_PRINT_CELLS) {
    return 'tooLarge';
  }
  const doc = win.document;
  doc.querySelector('.print-root')?.remove();
  const root = el('div', { className: 'print-root', attrs: { 'aria-hidden': 'true' } });
  root.classList.toggle('print-gridlines', settings.gridlines);
  const showTitles = parts.length > 1;
  for (const part of parts) {
    const section = el('section', { className: 'print-sheet' });
    if (showTitles) {
      section.append(el('h2', { className: 'print-sheet-title', text: part.title }));
    }
    if (part.kind === 'grid') {
      section.append(...gridTables(part, settings));
    } else if (part.kind === 'markdown') {
      section.append(
        el('div', { className: 'print-markdown' }, renderMarkdownBlocks(parseMarkdown(part.text))),
      );
    } else {
      section.append(el('pre', { className: 'print-text', text: part.text }));
    }
    root.append(section);
  }
  doc.body.append(root);
  const restorePage = setPageStyle(doc, settings);
  let done = false;
  const cleanup = (): void => {
    if (done) {
      return;
    }
    done = true;
    root.remove();
    restorePage();
    win.removeEventListener('afterprint', cleanup);
  };
  win.addEventListener('afterprint', cleanup);
  try {
    win.print();
  } finally {
    // `print()` returns once the dialog closes in every current browser;
    // `afterprint` covers any that return early.
    if (typeof win.onafterprint === 'undefined') {
      cleanup();
    }
  }
  return null;
}

function collectParts(state: AppState, tab: Tab, settings: PrintSettings): PrintPart[] {
  const doc = tab.doc;
  const selection = settings.scope === 'selection' ? state.selectedRange(tab) : null;
  if (!isWorkbook(doc)) {
    const area = printArea({ rows: doc.rowCount, cols: doc.columnCount }, selection);
    if (!area) {
      return [];
    }
    return [
      {
        kind: 'grid',
        title: tab.name,
        rows: range(area.top, area.bottom),
        cols: range(area.left, area.right),
        widths: tab.colWidths,
        value: (r, c) => doc.getDisplayValue(r, c),
        input: (r, c) => doc.getDisplayValue(r, c),
        style: () => null,
        conditional: () => null,
        objects: new Map(),
        draw: () => el('div'),
        drawn: new Set(),
        wrap: tab.wrapCells,
        bands: bandsOf(resolveGridLook(doc)),
      },
    ];
  }
  const sheets = settings.scope === 'file' ? doc.sheets : [doc.activeSheet];
  const parts: PrintPart[] = [];
  for (const sheet of sheets) {
    if (sheet.kind !== 'grid') {
      const text = sheet.getValue(0, 0);
      if (text.trim() !== '') {
        parts.push({ kind: sheet.kind === 'markdown' ? 'markdown' : 'text', title: sheet.name, text });
      }
      continue;
    }
    const active = sheet === doc.activeSheet;
    const look = resolveGridLook(doc, sheet);
    const shown = sheet.objects.filter((o) => !o.hidden);
    const area = printArea(extentWithObjects(sheet.usedExtent(), shown), active ? selection : null);
    if (!area) {
      continue;
    }
    const rows = active ? shownRows(state, tab, area, selection !== null) : range(area.top, area.bottom);
    if (rows.length === 0) {
      continue;
    }
    parts.push({
      kind: 'grid',
      title: sheet.name,
      rows,
      cols: range(area.left, area.right),
      widths: sheet.paper ? [] : active ? tab.colWidths : sheet.view.colWidths,
      paper: sheet.paper,
      value: (r, c) => doc.getSheetDisplayValue(sheet.id, r, c),
      input: (r, c) => sheet.getValue(r, c),
      style: (r, c) => sheet.getStyle(r, c),
      conditional: (r, c) => doc.getConditionalFormatStyleOn(sheet.id, r, c),
      objects: objectsByCell(shown),
      draw: (o) => drawObject(doc, o, { x: o.dx, y: o.dy, w: o.width, h: o.height }, 1),
      drawn: new Set(),
      wrap: active ? tab.wrapCells : resolveWrap(doc, sheet).value,
      bands: bandsOf(look),
    });
  }
  return parts;
}

function bandsOf(look: { bands: boolean; bandLevel: BandLevel }): BandLevel | null {
  return look.bands ? look.bandLevel : null;
}

/** The used cells grown to reach every shown object's anchor cell, so a sheet of only objects prints too. */
function extentWithObjects(
  used: { rows: number; cols: number },
  objects: readonly SheetObject[],
): { rows: number; cols: number } {
  return objects.reduce(
    (at, o) => ({ rows: Math.max(at.rows, o.row + 1), cols: Math.max(at.cols, o.col + 1) }),
    used,
  );
}

function objectsByCell(objects: readonly SheetObject[]): GridPart['objects'] {
  const map: GridPart['objects'] = new Map();
  objects.forEach((o, i) => {
    const key = `${o.row}:${o.col}`;
    map.set(key, [...(map.get(key) ?? []), { o, z: i + 1 }]);
  });
  return map;
}

/**
 * The active sheet's rows as shown: in its sort order, without rows its
 * filter hides. `area` is in display positions for a selection and in
 * document rows otherwise (where rows below the data are left out).
 */
function shownRows(state: AppState, tab: Tab, area: PrintArea, isSelection: boolean): number[] {
  const rows: number[] = [];
  const [from, to] = isSelection ? [area.top, area.bottom] : [0, tab.doc.rowCount - 1];
  for (let slot = from; slot <= to; slot++) {
    const row = state.docRow(tab, slot);
    if ((isSelection || row <= area.bottom) && !state.isRowHidden(tab, row)) {
      rows.push(row);
    }
  }
  return rows;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** One table per page run, each with its own header rows (repeated on every printed page). */
function gridTables(part: GridPart, settings: PrintSettings): HTMLElement[] {
  const widths = part.cols.map((c) => {
    const w = part.paper ?? part.widths[c];
    return w && w > 0 ? w : COL_WIDTH;
  });
  const contentWidth = widths.reduce((a, b) => a + b, 0) + (settings.headings ? ROW_HEAD_WIDTH : 0);
  const zoom = printScale(settings, contentWidth);
  const firstRow = settings.repeatFirstRow ? part.rows[0] : null;
  const bodyRows = settings.repeatFirstRow ? part.rows.slice(1) : part.rows;
  const breaks = pageBreakRows(part.rows.length, settings.rowsPerPage, settings.repeatFirstRow).map(
    (at) => at - (settings.repeatFirstRow ? 1 : 0),
  );
  const runs: number[][] = [];
  let start = 0;
  for (const at of [...breaks, bodyRows.length]) {
    runs.push(bodyRows.slice(start, at));
    start = at;
  }
  return runs.map((rows, i) => {
    const table = el('table', { className: `print-table${part.paper ? ' print-paper' : ''}` });
    table.classList.toggle('print-nowrap', !part.wrap);
    if (part.bands) {
      table.classList.add('print-banded');
      table.dataset.bandLevel = String(part.bands);
    }
    table.style.width = `${contentWidth}px`;
    table.style.zoom = String(zoom);
    if (i > 0) {
      table.classList.add('print-page-break');
    }
    const colgroup = el('colgroup');
    if (settings.headings) {
      colgroup.append(widthCol(ROW_HEAD_WIDTH));
    }
    colgroup.append(...widths.map(widthCol));
    const head = el('thead');
    if (settings.headings) {
      head.append(
        el('tr', { className: 'print-headings' }, [
          el('th'),
          ...part.cols.map((c) => el('th', { text: columnLabel(c) })),
        ]),
      );
    }
    if (firstRow !== null) {
      head.append(rowElement(part, firstRow, settings.headings));
    }
    // Bands count shown rows from the top of the sheet, as on screen, so they carry on across pages.
    const offset = part.rows.indexOf(rows[0]);
    const body = el(
      'tbody',
      {},
      rows.map((row, k) => {
        const tr = rowElement(part, row, settings.headings);
        tr.classList.toggle('alt', (offset + k) % 2 === 1);
        return tr;
      }),
    );
    table.append(colgroup, head, body);
    return table;
  });
}

function widthCol(width: number): HTMLElement {
  const col = el('col');
  col.style.width = `${width}px`;
  return col;
}

function rowElement(part: GridPart, row: number, headings: boolean): HTMLElement {
  const tr = el('tr');
  if (part.paper) {
    tr.style.height = `${part.paper}px`;
  }
  if (headings) {
    tr.append(el('th', { className: 'print-row-heading', text: String(row + 1) }));
  }
  for (const col of part.cols) {
    tr.append(cellElement(part, row, col));
  }
  return tr;
}

function cellElement(part: GridPart, row: number, col: number): HTMLElement {
  const td = el('td');
  placeObjects(part, row, col, td);
  const value = part.value(row, col);
  const style = part.style(row, col);
  const conditional = part.conditional(row, col);
  const runs = style?.runs && part.input(row, col) === value ? runsForText(style.runs, value) : null;
  const text = runs ? richTextNodes(runs, style, conditional?.textColor) : [value];
  // Unwrapped text shows one line, cut at the cell's edge as on screen; the
  // box keeps anchored objects out of that cut.
  td.append(...(part.wrap || value === '' ? text : [el('div', { className: 'print-line' }, text)]));
  if (!style && !conditional) {
    return td;
  }
  td.classList.toggle('cell-bold', !!style?.bold);
  td.classList.toggle('cell-italic', !!style?.italic);
  td.classList.toggle('cell-underline', !!style?.underline && !runs);
  paintFont(td, style);
  td.style.textAlign = style?.horizontalAlign ?? '';
  td.style.color = conditional?.textColor ?? style?.textColor ?? '';
  td.style.backgroundColor = conditional?.backgroundColor ?? style?.backgroundColor ?? '';
  td.style.borderTop = cssBorder(borderSideValue(style, 'borderTop'));
  td.style.borderRight = cssBorder(borderSideValue(style, 'borderRight'));
  td.style.borderBottom = cssBorder(borderSideValue(style, 'borderBottom'));
  td.style.borderLeft = cssBorder(borderSideValue(style, 'borderLeft'));
  return td;
}

/**
 * The objects anchored to this cell, drawn in it at their offsets (over
 * later cells, in the sheet's stacking order). Objects anchored to a cell
 * that is not printed (outside the selection, or on a row the filter
 * hides) are left out.
 */
function placeObjects(part: GridPart, row: number, col: number, td: HTMLElement): void {
  const here = part.objects.get(`${row}:${col}`)?.filter(({ o }) => !part.drawn.has(o.id));
  if (!here?.length) {
    return;
  }
  td.classList.add('print-object-anchor');
  for (const { o, z } of here) {
    part.drawn.add(o.id);
    const node = part.draw(o);
    node.style.zIndex = String(z);
    td.append(node);
  }
}

function cssBorder(border: BorderSideValue | null): string {
  return border ? `${BORDER_WIDTH_PX[border.width]}px ${border.lineStyle} ${border.color}` : '';
}

/** Adopt an `@page` rule for this print; returns how to take it back. */
function setPageStyle(doc: Document, settings: PrintSettings): () => void {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  if (!view || typeof view.CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in doc)) {
    return () => undefined;
  }
  try {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(`@page { size: ${pageSizeCss(settings)}; margin: ${PRINT_MARGIN_MM}mm; }`);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    return () => {
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  } catch {
    return () => undefined;
  }
}

/**
 * Open the File > Print… panel for the active tab. Each Print remembers the
 * settings in this browser and prints whatever tab is active at that moment.
 */
export function openPrint(state: AppState, notify: (text: string) => void): void {
  const doc = state.activeTab?.doc;
  void openPrintPanel(
    { settings: getPrintSettings(), canPrintFile: isWorkbook(doc) && doc.sheets.length > 1 },
    (settings) => {
      setPrintSettings(settings);
      const tab = state.activeTab;
      const refusal = tab ? printTab(state, tab, settings) : 'empty';
      if (refusal) {
        notify(
          refusal === 'empty'
            ? t('print.empty')
            : t('print.tooLarge', { n: MAX_PRINT_CELLS.toLocaleString() }),
        );
      }
    },
  );
}
