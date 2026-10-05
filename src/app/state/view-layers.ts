// SPDX-License-Identifier: MIT
import { type EditorDocument, workbookOf } from '../../core/editor-document';
import { resolveGridLook as resolveLookLayers, type GridLook } from '../../core/grid-look';
import { resolveSetting, type ResolvedSetting, type SettingSource } from '../../core/settings-cascade';
import type { Worksheet } from '../../core/workbook/worksheet';
import { getBrowserGridLook } from '../grid-look';
import {
  clampSheetZoom,
  DEFAULT_SHEET_ZOOM,
  getBrowserWrap,
  getBrowserZoom,
  getSheetZoom,
  getWrapCells,
} from '../settings';
import {
  DEFAULT_SHEET_FONT,
  getBrowserSheetFont,
  isMonospaceSheetFont,
  isSheetFontId,
  type SheetFontId,
} from '../sheet-font';

/**
 * A document's effective zoom and wrap, resolved **worksheet > file > browser**
 * (`src/core/settings-cascade.ts`). The browser level lives in `localStorage`;
 * the file and worksheet levels exist only for RSF documents (the active
 * worksheet's). When no level specifies a value, the value last used in this
 * browser applies.
 */
export function resolveZoom(doc: EditorDocument): ResolvedSetting<number> {
  const rsf = workbookOf(doc);
  if (rsf && rsf.activeSheet.kind !== 'grid') {
    // A text worksheet (Markdown, JSON, YAML, plain text) has its own zoom,
    // 100% until changed; the file and browser levels are grid defaults.
    const zoom = rsf.activeSheet.displayZoom;
    return zoom === undefined
      ? { value: DEFAULT_SHEET_ZOOM, source: 'browser' }
      : { value: clampSheetZoom(zoom), source: 'sheet' };
  }
  const resolved = resolveSetting(
    { browser: getBrowserZoom(), file: rsf?.fileZoom, sheet: rsf?.activeSheet.displayZoom },
    getSheetZoom(),
  );
  return { value: clampSheetZoom(resolved.value), source: resolved.source };
}

/** See {@link resolveZoom}; `sheet` picks a worksheet other than the active one (for printing). */
export function resolveWrap(doc: EditorDocument, sheet?: Worksheet): ResolvedSetting<boolean> {
  const rsf = workbookOf(doc);
  const target = sheet ?? rsf?.activeSheet;
  if (target && target.kind !== 'grid') {
    // A text worksheet (Markdown, JSON, YAML, plain text) wraps unless it
    // says otherwise; the file and browser levels are grid defaults. Its
    // default is reported as inherited so it is never copied into the sheet.
    return target.displayWrap === undefined
      ? { value: true, source: 'browser' }
      : { value: target.displayWrap, source: 'sheet' };
  }
  return resolveSetting(
    { browser: getBrowserWrap(), file: rsf?.fileWrap, sheet: (sheet ?? rsf?.activeSheet)?.displayWrap },
    getWrapCells(),
  );
}

/**
 * A document's effective spreadsheet font, resolved like zoom and wrap. A
 * stored id this release does not know is treated as "not specified".
 */
export function resolveSheetFont(doc: EditorDocument | null): ResolvedSetting<SheetFontId> {
  const rsf = workbookOf(doc);
  const known = (id: string | undefined): SheetFontId | undefined => (isSheetFontId(id) ? id : undefined);
  return resolveSetting(
    {
      sheet: known(rsf?.activeSheet.displayFont),
      file: known(rsf?.fileFont),
      browser: getBrowserSheetFont(),
    },
    DEFAULT_SHEET_FONT,
  );
}

/**
 * The font the active worksheet shows, for menu check marks. A Markdown,
 * JSON, YAML or text worksheet uses only a font chosen for it; with none it
 * shows the interface font (proportional), reported as null.
 */
export function displayedSheetFont(doc: EditorDocument | null): SheetFontId | null {
  const rsf = workbookOf(doc);
  if (rsf && rsf.activeSheet.kind !== 'grid') {
    const id = rsf.activeSheet.displayFont;
    return isSheetFontId(id) ? id : null;
  }
  return resolveSheetFont(doc).value;
}

/**
 * Whether the active worksheet shows a proportional font (View >
 * Proportional Font). With no font chosen, a JSON or YAML worksheet shows a
 * fixed-pitch code face and a Markdown or text worksheet the interface font.
 */
export function showsProportionalFont(doc: EditorDocument | null): boolean {
  const font = displayedSheetFont(doc);
  if (font === null) {
    const kind = workbookOf(doc)?.activeSheet.kind;
    return kind === 'markdown' || kind === 'text';
  }
  return !isMonospaceSheetFont(font);
}

/**
 * A document's effective grid look (bands, band strength, gridlines, and the
 * selected row/column highlight), each key resolved like zoom and wrap. Only
 * RSF files carry a file and worksheet level; everything else uses this
 * browser's, else the defaults. `sheet` picks a worksheet other than the
 * active one (for printing).
 */
export function resolveGridLook(doc: EditorDocument | null, sheet?: Worksheet): GridLook {
  const rsf = workbookOf(doc);
  return resolveLookLayers({
    sheet: (sheet ?? rsf?.activeSheet)?.displayLook,
    file: rsf?.fileLook,
    browser: getBrowserGridLook(),
  });
}

/**
 * Whether the live value should be written back to the worksheet (on sheet
 * switch and save), as before layering existed: only when the worksheet
 * decides it or nothing does — never a value inherited from the file or the
 * browser, which would otherwise freeze into every worksheet.
 */
export function decidedBySheet(source: SettingSource): boolean {
  return source === 'sheet' || source === 'default';
}
