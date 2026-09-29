// SPDX-License-Identifier: MIT
import { isWorkbook } from '../../core/editor-document';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import {
  isLineKind,
  isPositionLocked,
  nextObjectId,
  objectListsEqual,
  MAX_SHEET_OBJECTS,
  type SheetObject,
  type SheetObjectKind,
} from '../../core/workbook/sheet-objects';
import type { AppState, Tab } from '../state';
import { t } from '../i18n';
import type { ConvertReason, NotifyPort } from '../ui-port';

/** A new object's size, in px at 100% zoom. */
const DEFAULT_SIZE: Record<SheetObjectKind, { width: number; height: number }> = {
  rect: { width: 128, height: 72 },
  ellipse: { width: 96, height: 72 },
  line: { width: 128, height: 0 },
  arrow: { width: 128, height: 0 },
  text: { width: 160, height: 48 },
};

/** The fields that place an object; changing one is a move or resize. */
const GEOMETRY_KEYS = ['row', 'col', 'dx', 'dy', 'width', 'height', 'rotation', 'flipH', 'flipV'] as const;
/** The fields the list changes, allowed under either lock. */
const LIST_KEYS = ['hidden', 'lockPosition', 'lockEdit'] as const;

export type ObjectOrder = 'front' | 'back' | 'forward' | 'backward';

/**
 * Shapes over a spreadsheet worksheet (Insert > Rectangle…, the object
 * list, and moving, resizing and editing them on the grid). Every change is
 * one undoable history entry swapping the worksheet's object list (see
 * `src/core/workbook/sheet-objects.ts`), and every change goes through
 * {@link replace}, which enforces the two locks: 配置を固定 refuses moving
 * and resizing, 編集をロック also refuses editing and deleting.
 */
export class ObjectCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: NotifyPort,
    private readonly ensureRsf: (tab: Tab, reason: ConvertReason) => Promise<RsfDocument | null>,
  ) {}

  /** Whether the active sheet can hold objects (a spreadsheet sheet; a CSV file is converted first). */
  canInsert(tab: Tab): boolean {
    const doc = tab.doc;
    return !isWorkbook(doc) || doc.activeSheet.kind === 'grid';
  }

  /** The active worksheet's objects, bottom to top (none on a CSV file). */
  objects(tab: Tab): readonly SheetObject[] {
    return isWorkbook(tab.doc) ? tab.doc.objects : [];
  }

  /** Insert a new object at the active cell and select it. */
  async insert(tab: Tab, kind: SheetObjectKind): Promise<boolean> {
    const doc = await this.ensureRsf(tab, 'command');
    if (!doc || doc.activeSheet.kind !== 'grid') {
      return false;
    }
    const before = doc.objects;
    if (before.length >= MAX_SHEET_OBJECTS) {
      this.ui.notify(t('object.tooMany', { max: MAX_SHEET_OBJECTS }), 'warn');
      return false;
    }
    const cell = tab.selection ?? { row: 0, col: 0 };
    const n = before.filter((o) => o.kind === kind).length + 1;
    const object: SheetObject = {
      id: nextObjectId(before),
      name: t(`object.kind.${kind}`) + ` ${n}`,
      kind,
      row: Math.min(cell.row, doc.rowCount - 1),
      col: Math.min(cell.col, doc.columnCount - 1),
      dx: 8,
      dy: isLineKind(kind) ? 10 : 4,
      ...DEFAULT_SIZE[kind],
      ...(kind === 'text' ? { text: t('object.defaultText') } : {}),
    };
    if (!this.replace(tab, [...before, object], 'history.insertObject')) {
      return false;
    }
    this.state.objectSelection.select(tab, [object.id]);
    return true;
  }

  /**
   * Replace the active worksheet's objects with `next` as one undoable entry.
   * Refused (with a message) when it would move, resize, edit or delete a
   * locked object; reordering, showing/hiding and the locks themselves are
   * always allowed.
   */
  replace(tab: Tab, next: readonly SheetObject[], label: string): boolean {
    const doc = tab.doc;
    if (!isWorkbook(doc) || doc.activeSheet.kind !== 'grid') {
      return false;
    }
    const before = doc.objects;
    if (objectListsEqual(before, next)) {
      return false;
    }
    const refusal = lockRefusal(before, next);
    if (refusal) {
      this.ui.notify(t(refusal), 'warn');
      return false;
    }
    const sheetId = doc.activeSheetId;
    return this.state.pushEntry(tab, {
      label,
      sheetId,
      ops: [{ type: 'objects', before, after: next, sheetId }],
    });
  }

  /** Change some objects (matched by id) in place, keeping the stacking order. */
  update(tab: Tab, changed: readonly SheetObject[], label: string): boolean {
    const byId = new Map(changed.map((o) => [o.id, o]));
    return this.replace(
      tab,
      this.objects(tab).map((o) => byId.get(o.id) ?? o),
      label,
    );
  }

  /** Delete the selected objects. */
  deleteSelected(tab: Tab): boolean {
    const picked = new Set(this.state.objectSelection.selected(tab));
    if (picked.size === 0) {
      return false;
    }
    const done = this.replace(
      tab,
      this.objects(tab).filter((o) => !picked.has(o.id)),
      'history.deleteObject',
    );
    if (done) {
      this.state.objectSelection.select(tab, []);
    }
    return done;
  }

  /** Move the selected objects in the stacking order. */
  order(tab: Tab, order: ObjectOrder): boolean {
    const picked = new Set(this.state.objectSelection.selected(tab));
    return (
      picked.size > 0 && this.replace(tab, reorder(this.objects(tab), picked, order), 'history.objectOrder')
    );
  }

  /** Whether an order change would change anything. */
  canOrder(tab: Tab, order: ObjectOrder): boolean {
    const picked = new Set(this.state.objectSelection.selected(tab));
    const objects = this.objects(tab);
    return picked.size > 0 && !objectListsEqual(objects, reorder(objects, picked, order));
  }
}

/** The objects with `picked` moved to the top or bottom, or one step up or down. */
function reorder(objects: readonly SheetObject[], picked: Set<string>, order: ObjectOrder): SheetObject[] {
  const inPick = (o: SheetObject): boolean => picked.has(o.id);
  if (order === 'front') {
    return [...objects.filter((o) => !inPick(o)), ...objects.filter(inPick)];
  }
  if (order === 'back') {
    return [...objects.filter(inPick), ...objects.filter((o) => !inPick(o))];
  }
  const out = objects.slice();
  // One step: each picked object swaps with the unpicked neighbour above (or below) it.
  if (order === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) {
      if (inPick(out[i]) && !inPick(out[i + 1])) {
        [out[i], out[i + 1]] = [out[i + 1], out[i]];
      }
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (inPick(out[i]) && !inPick(out[i - 1])) {
        [out[i], out[i - 1]] = [out[i - 1], out[i]];
      }
    }
  }
  return out;
}

/** The message key for why `next` may not replace `before`, or null when the locks allow it. */
function lockRefusal(before: readonly SheetObject[], next: readonly SheetObject[]): string | null {
  const after = new Map(next.map((o) => [o.id, o]));
  for (const old of before) {
    const now = after.get(old.id);
    if (!now) {
      if (old.lockEdit) {
        return 'object.locked.edit';
      }
      continue;
    }
    if (now === old) {
      continue;
    }
    const moved = GEOMETRY_KEYS.some((key) => now[key] !== old[key]);
    if (moved && isPositionLocked(old)) {
      return old.lockEdit ? 'object.locked.edit' : 'object.locked.position';
    }
    const skip = new Set<string>([...GEOMETRY_KEYS, ...LIST_KEYS]);
    const keys = new Set([...Object.keys(old), ...Object.keys(now)]);
    const edited = [...keys].some(
      (key) =>
        !skip.has(key) &&
        (old as unknown as Record<string, unknown>)[key] !== (now as unknown as Record<string, unknown>)[key],
    );
    if (edited && old.lockEdit) {
      return 'object.locked.edit';
    }
  }
  return null;
}
