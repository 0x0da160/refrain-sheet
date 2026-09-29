// SPDX-License-Identifier: MIT
/**
 * Insert > Save as PNG Image… / Save as SVG Image…: the selected objects
 * saved as one picture, laid out and stacked as on the sheet, on a
 * transparent background. Hidden objects are left out. Drawing the picture
 * needs the grid's view, so the UI supplies it through
 * {@link ObjectImagePort}.
 */
import { isWorkbook } from '../../core/editor-document';
import type { SheetObject } from '../../core/workbook/sheet-objects';
import { requestSaveHandle, saveBytes } from '../file-access';
import { t } from '../i18n';
import type { AppState, Tab } from '../state';
import type { NotifyPort } from '../ui-port';

export type ObjectImageFormat = 'png' | 'svg';

const MEDIA_TYPES: Record<ObjectImageFormat, string> = { png: 'image/png', svg: 'image/svg+xml' };

/** Draws objects as a picture (set by the UI). */
export interface ObjectImagePort {
  /** `objects` (bottom to top) as a PNG or SVG file's bytes, or null when the browser cannot draw it. */
  render(tab: Tab, objects: readonly SheetObject[], format: ObjectImageFormat): Promise<Uint8Array | null>;
}

/** The selected objects a picture would show: the shown ones, bottom to top. */
export function exportableObjects(state: AppState, tab: Tab): SheetObject[] {
  const doc = tab.doc;
  const picked = new Set(state.objectSelection.selected(tab));
  if (!isWorkbook(doc) || doc.activeSheet.kind !== 'grid' || picked.size === 0) {
    return [];
  }
  return doc.objects.filter((o) => picked.has(o.id) && !o.hidden);
}

/** A file name for the picture: the object's own name, or a general one for several. */
export function objectImageName(objects: readonly SheetObject[], format: ObjectImageFormat): string {
  const base = objects.length === 1 ? objects[0].name : t('object.export.defaultName');
  // Characters no common file system allows in a name.
  const safe =
    Array.from(base, (ch) => (ch < ' ' || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
      .join('')
      .trim() || t('object.export.defaultName');
  return `${safe}.${format}`;
}

/**
 * Save the selected objects as a picture. The save picker opens first,
 * while the menu click still counts as a user gesture; where the browser
 * has none, the picture is downloaded.
 */
export async function exportObjectImage(
  state: AppState,
  ui: NotifyPort,
  dom: Document,
  tab: Tab,
  format: ObjectImageFormat,
  port: ObjectImagePort,
): Promise<boolean> {
  const objects = exportableObjects(state, tab);
  if (objects.length === 0) {
    return false;
  }
  const name = objectImageName(objects, format);
  try {
    const handle = await requestSaveHandle(name, format);
    const bytes = await port.render(tab, objects, format);
    if (!bytes) {
      ui.notify(t('notify.objectImageFailed'), 'error');
      return false;
    }
    const outcome = await saveBytes(dom, name, bytes, handle, MEDIA_TYPES[format]);
    ui.notify(
      outcome.mode === 'download'
        ? t('notify.objectImageDownload', { name })
        : t('notify.objectImageSaved', { name: outcome.handle?.name ?? name }),
      'info',
    );
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return false;
    }
    throw err;
  }
}
