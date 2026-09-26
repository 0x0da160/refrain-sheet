// SPDX-License-Identifier: MIT
import { resolveSetting, type ResolvedSetting, type SettingSource } from '../../core/settings-cascade';
import type { EditorDocument } from '../app-state';
import { clampSheetZoom, getBrowserWrap, getBrowserZoom, getSheetZoom, getWrapCells } from '../settings';

/**
 * A document's effective zoom and wrap, resolved **worksheet > file > browser**
 * (`src/core/settings-cascade.ts`). The browser level lives in `localStorage`;
 * the file and worksheet levels exist only for RSF documents (the active
 * worksheet's). When no level specifies a value, the value last used in this
 * browser applies.
 */
export function resolveZoom(doc: EditorDocument): ResolvedSetting<number> {
  const rsf = doc.kind === 'rsf' ? doc : null;
  const resolved = resolveSetting(
    { browser: getBrowserZoom(), file: rsf?.fileZoom, sheet: rsf?.activeSheet.displayZoom },
    getSheetZoom(),
  );
  return { value: clampSheetZoom(resolved.value), source: resolved.source };
}

/** See {@link resolveZoom}. */
export function resolveWrap(doc: EditorDocument): ResolvedSetting<boolean> {
  const rsf = doc.kind === 'rsf' ? doc : null;
  return resolveSetting(
    { browser: getBrowserWrap(), file: rsf?.fileWrap, sheet: rsf?.activeSheet.displayWrap },
    getWrapCells(),
  );
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
