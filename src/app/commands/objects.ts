// SPDX-License-Identifier: MIT
import { isWorkbook } from '../../core/editor-document';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import {
  isLineKind,
  isPositionLocked,
  nextObjectId,
  objectListsEqual,
  MAX_SHEET_OBJECTS,
  wholePixels,
  type SheetObject,
  type SheetObjectKind,
} from '../../core/workbook/sheet-objects';
import { imageSize, MAX_IMAGE_BYTES, sniffImageType } from '../../core/workbook/sheet-images';
import { chartDataFromRows, chartDataToRows, dataRegionAround } from '../../core/workbook/sheet-charts';
import { copyObjects, pasteObjects, type ObjectClip } from '../../core/workbook/object-clipboard';
import {
  arrangeBoxes,
  arrangementMinimum,
  nextGroupId,
  type Arrangement,
  type Box,
} from '../../core/workbook/object-arrange';
import { toSquares } from '../../core/workbook/grid-paper';
import type { AppState, Tab } from '../state';
import { t } from '../i18n';
import type { ConvertReason, NotifyPort } from '../ui-port';

/** The kinds Insert > Rectangle… makes (an image comes from a picture: {@link ObjectCommands.insertImage}). */
export type ShapeKind = Exclude<SheetObjectKind, 'image' | 'chart'>;

/** A new object's size, in px at 100% zoom. */
const DEFAULT_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  rect: { width: 128, height: 72 },
  ellipse: { width: 96, height: 72 },
  line: { width: 128, height: 0 },
  arrow: { width: 128, height: 0 },
  text: { width: 160, height: 48 },
};
/** A new picture is shown at its own size, shrunk (never grown) to fit this box. */
const IMAGE_FIT = { width: 480, height: 360 };
/** A picture that states no size (some SVGs) starts at this size. */
const IMAGE_FALLBACK = { width: 240, height: 180 };

/** The fields that place an object; changing one is a move or resize. */
const GEOMETRY_KEYS = ['row', 'col', 'dx', 'dy', 'width', 'height', 'rotation', 'flipH', 'flipV'] as const;
/** The fields the list changes, allowed under either lock. */
const LIST_KEYS = ['hidden', 'lockPosition', 'lockEdit'] as const;

export type ObjectOrder = 'front' | 'back' | 'forward' | 'backward';

/** Where objects are on screen, from the grid (cell sizes live in the view). */
export interface ObjectGeometry {
  /** The top-left corner from the sheet's, in pixels at 100% zoom. */
  objectPosition(tab: Tab, o: SheetObject): { x: number; y: number };
  /** `o` moved so its top-left corner is at (`x`, `y`). */
  objectMovedTo(tab: Tab, o: SheetObject, x: number, y: number): SheetObject;
}

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

  /** Insert a new shape at the active cell and select it. */
  async insert(tab: Tab, kind: ShapeKind): Promise<boolean> {
    return this.place(tab, kind, () => ({
      ...DEFAULT_SIZE[kind],
      ...(kind === 'text' ? { text: t('object.defaultText') } : {}),
    }));
  }

  /**
   * Insert a picture (a PNG, JPEG, WebP or SVG file's bytes, from Insert >
   * Image… or a paste) at the active cell and select it. Anything else, or
   * a picture over the size limit, is refused with a message.
   */
  async insertImage(tab: Tab, bytes: Uint8Array): Promise<boolean> {
    const type = sniffImageType(bytes);
    if (!type) {
      this.ui.notify(t('object.image.unsupported'), 'warn');
      return false;
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      this.refuseTooLarge();
      return false;
    }
    return this.place(tab, 'image', (doc) => {
      const image = { type, bytes };
      const natural = imageSize(image) ?? IMAGE_FALLBACK;
      const scale = Math.min(1, IMAGE_FIT.width / natural.width, IMAGE_FIT.height / natural.height);
      return {
        image: doc.images.add(image),
        width: Math.max(1, Math.round(natural.width * scale)),
        height: Math.max(1, Math.round(natural.height * scale)),
      };
    });
  }

  /** Say a picture is over the size limit. */
  refuseTooLarge(): void {
    this.ui.notify(t('object.image.tooLarge', { max: Math.round(MAX_IMAGE_BYTES / 1024 / 1024) }), 'warn');
  }

  /**
   * Insert a bar chart of the selected cells (or, when one cell is
   * selected, the filled block around it) and select it. Its range follows
   * the cells; the object list changes its type, range and look.
   */
  async insertChart(tab: Tab): Promise<boolean> {
    const doc = await this.ensureRsf(tab, 'command');
    if (!doc || doc.activeSheet.kind !== 'grid') {
      return false;
    }
    let range = this.state.selectedRange(tab) ?? { top: 0, left: 0, bottom: 0, right: 0 };
    if (range.top === range.bottom && range.left === range.right) {
      range = dataRegionAround(
        (r, c) => doc.getValue(r, c) !== '',
        range.top,
        range.left,
        doc.rowCount,
        doc.columnCount,
      );
    }
    if (
      range.top === range.bottom &&
      range.left === range.right &&
      doc.getValue(range.top, range.left) === ''
    ) {
      this.ui.notify(t('object.chart.noData'), 'warn');
      return false;
    }
    const source = { sheetId: doc.activeSheetId, ...range };
    // Beside the data, not over it.
    const at = { row: range.top, col: Math.min(range.right + 1, doc.columnCount - 1) };
    return this.place(tab, 'chart', () => ({ width: 480, height: 300, chart: { type: 'bar', source } }), at);
  }

  /** Add an object of `kind` near the active cell (fields from `fill`) and select it. */
  private async place(
    tab: Tab,
    kind: SheetObjectKind,
    fill: (doc: RsfDocument) => Pick<SheetObject, 'width' | 'height'> & Partial<SheetObject>,
    at?: { row: number; col: number },
  ): Promise<boolean> {
    const doc = await this.ensureRsf(tab, 'command');
    if (!doc || doc.activeSheet.kind !== 'grid') {
      return false;
    }
    const before = doc.objects;
    if (before.length >= MAX_SHEET_OBJECTS) {
      this.ui.notify(t('object.tooMany', { max: MAX_SHEET_OBJECTS }), 'warn');
      return false;
    }
    const cell = at ?? tab.selection ?? { row: 0, col: 0 };
    const n = before.filter((o) => o.kind === kind).length + 1;
    let object: SheetObject = {
      id: nextObjectId(before),
      name: t(`object.kind.${kind}`) + ` ${n}`,
      kind,
      row: Math.min(cell.row, doc.rowCount - 1),
      col: Math.min(cell.col, doc.columnCount - 1),
      dx: 8,
      dy: isLineKind(kind) ? 10 : 4,
      ...fill(doc),
    };
    const square = doc.activeSheet.paper;
    if (square !== undefined) {
      object = this.onSquares(tab, object, square, at === undefined);
    }
    if (!this.replace(tab, [...before, object], 'history.insertObject')) {
      return false;
    }
    this.state.objectSelection.select(tab, [object.id]);
    return true;
  }

  /**
   * A new object on grid paper: in the corner of its square and a whole
   * number of squares in size (a line lies along the squares' edge). A text
   * box inserted over several selected squares covers them.
   */
  private onSquares(tab: Tab, o: SheetObject, square: number, atSelection: boolean): SheetObject {
    const range = atSelection ? this.state.selectedRange(tab) : null;
    const spans = o.kind === 'text' && range && (range.bottom > range.top || range.right > range.left);
    if (spans) {
      return {
        ...o,
        row: range.top,
        col: range.left,
        dx: 0,
        dy: 0,
        width: (range.right - range.left + 1) * square,
        height: (range.bottom - range.top + 1) * square,
      };
    }
    return {
      ...o,
      dx: 0,
      dy: 0,
      width: toSquares(o.width, square),
      height: isLineKind(o.kind) ? 0 : toSquares(o.height, square),
    };
  }

  /**
   * Replace the active worksheet's objects with `next` as one undoable entry.
   * Refused (with a message) when it would move, resize, edit or delete a
   * locked object; reordering, showing/hiding and the locks themselves are
   * always allowed.
   */
  replace(tab: Tab, changed: readonly SheetObject[], label: string): boolean {
    // Every edit leaves objects on whole pixels (see `wholePixels`).
    const next = changed.map(wholePixels);
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

  /** A copy of the selected objects, or null when none is selected. */
  copySelected(tab: Tab): ObjectClip | null {
    const doc = tab.doc;
    const picked = new Set(this.state.objectSelection.selected(tab));
    if (!isWorkbook(doc) || picked.size === 0) {
      return null;
    }
    return copyObjects(
      doc,
      doc.activeSheetId,
      doc.objects.filter((o) => picked.has(o.id)),
    );
  }

  /**
   * Paste copied objects onto the active sheet (a CSV file is converted
   * first), on top of the others, and select them: see `object-clipboard.ts`
   * for where they go and what a chart pasted into another file shows.
   */
  async paste(tab: Tab, clip: ObjectClip): Promise<boolean> {
    const doc = await this.ensureRsf(tab, 'command');
    if (!doc || doc.activeSheet.kind !== 'grid') {
      return false;
    }
    const before = doc.objects;
    if (before.length + clip.objects.length > MAX_SHEET_OBJECTS) {
      this.ui.notify(t('object.tooMany', { max: MAX_SHEET_OBJECTS }), 'warn');
      return false;
    }
    const pasted = pasteObjects(clip, {
      book: doc,
      sheetId: doc.activeSheetId,
      rowCount: doc.rowCount,
      columnCount: doc.columnCount,
      objects: before,
      images: doc.images,
      gridSheet: (id) => {
        const sheet = doc.sheetById(id);
        return sheet?.kind === 'grid' ? sheet : null;
      },
    });
    if (!this.replace(tab, [...before, ...pasted], 'history.pasteObjects')) {
      return false;
    }
    this.state.objectSelection.select(
      tab,
      pasted.map((o) => o.id),
    );
    return true;
  }

  /** Replace the data a chart keeps (not a range) with `rows` as {@link chartDataToRows} writes them. */
  setChartData(tab: Tab, id: string, rows: readonly (readonly string[])[]): boolean {
    const o = this.objects(tab).find((x) => x.id === id);
    if (!o?.chart?.data) {
      return false;
    }
    return this.update(
      tab,
      [{ ...o, chart: { ...o.chart, data: chartDataFromRows(rows) } }],
      'history.editObject',
    );
  }

  /**
   * Put the data a chart keeps into a new sheet after the active one and
   * point the chart at those cells, as one undoable step; the new sheet is
   * shown. Returns its name, or null.
   */
  chartDataToSheet(tab: Tab, id: string): string | null {
    const doc = tab.doc;
    const o = this.objects(tab).find((x) => x.id === id);
    const data = o?.chart?.data;
    if (!isWorkbook(doc) || !o?.chart || !data) {
      return null;
    }
    if (o.lockEdit) {
      this.ui.notify(t('object.locked.edit'), 'warn');
      return null;
    }
    const rows = chartDataToRows(data, (n) => t('chart.series', { n }));
    const chartSheet = doc.activeSheetId;
    const before = doc.objects;
    const name = doc.uniqueSheetName(t('object.chart.dataSheetName'));
    const sheet = this.state.addSheetFromValues(tab, name, rows, (added) => {
      const chart = {
        ...o.chart!,
        source: { sheetId: added.id, top: 0, left: 0, bottom: rows.length - 1, right: rows[0].length - 1 },
      };
      delete chart.data;
      return [
        {
          type: 'objects',
          before,
          after: before.map((x) => (x.id === id ? { ...x, chart } : x)),
          sheetId: chartSheet,
        },
      ];
    });
    return sheet?.name ?? null;
  }

  /** The selected objects, bottom to top. */
  private picked(tab: Tab): SheetObject[] {
    const picked = new Set(this.state.objectSelection.selected(tab));
    return this.objects(tab).filter((o) => picked.has(o.id));
  }

  /** Whether the selection is two or more objects not already one group. */
  canGroup(tab: Tab): boolean {
    const picked = this.picked(tab);
    return picked.length >= 2 && !picked.every((o) => o.group !== undefined && o.group === picked[0].group);
  }

  /** Make the selected objects one group (leaving any group they were in). */
  group(tab: Tab): boolean {
    if (!this.canGroup(tab)) {
      return false;
    }
    const group = nextGroupId(this.objects(tab));
    return this.update(
      tab,
      this.picked(tab).map((o) => ({ ...o, group })),
      'history.groupObjects',
    );
  }

  /** Whether any selected object is in a group. */
  canUngroup(tab: Tab): boolean {
    return this.picked(tab).some((o) => o.group !== undefined);
  }

  /** Break up every group a selected object is in. */
  ungroup(tab: Tab): boolean {
    const groups = new Set(this.picked(tab).map((o) => o.group));
    const members = this.objects(tab).filter((o) => o.group !== undefined && groups.has(o.group));
    return (
      members.length > 0 &&
      this.update(
        tab,
        members.map(({ group: _, ...rest }) => rest),
        'history.ungroupObjects',
      )
    );
  }

  /**
   * How many things an arrangement moves: each whole selected group counts
   * once (it keeps its own layout), every other object alone.
   */
  private units(tab: Tab): SheetObject[][] {
    const picked = this.picked(tab);
    const all = this.objects(tab);
    const byGroup = new Map<string, SheetObject[]>();
    const units: SheetObject[][] = [];
    for (const o of picked) {
      const whole =
        o.group !== undefined && all.filter((x) => x.group === o.group).every((x) => picked.includes(x));
      if (!whole) {
        units.push([o]);
      } else if (!byGroup.has(o.group!)) {
        const unit = picked.filter((x) => x.group === o.group);
        byGroup.set(o.group!, unit);
        units.push(unit);
      }
    }
    return units;
  }

  canArrange(tab: Tab, how: Arrangement): boolean {
    return this.units(tab).length >= arrangementMinimum(how);
  }

  /** Line the selected objects up, or space them evenly, as one step. */
  arrange(tab: Tab, how: Arrangement, geometry: ObjectGeometry): boolean {
    const units = this.units(tab);
    if (units.length < arrangementMinimum(how)) {
      return false;
    }
    const boxes = units.map((unit): Box => {
      const corners = unit.map((o) => ({ ...geometry.objectPosition(tab, o), w: o.width, h: o.height }));
      const x = Math.min(...corners.map((c) => c.x));
      const y = Math.min(...corners.map((c) => c.y));
      return {
        x,
        y,
        w: Math.max(...corners.map((c) => c.x + c.w)) - x,
        h: Math.max(...corners.map((c) => c.y + c.h)) - y,
      };
    });
    const moved = arrangeBoxes(boxes, how).flatMap((to, i) =>
      units[i].map((o) => {
        const at = geometry.objectPosition(tab, o);
        const x = Math.max(0, at.x + to.x - boxes[i].x);
        const y = Math.max(0, at.y + to.y - boxes[i].y);
        return geometry.objectMovedTo(tab, o, x, y);
      }),
    );
    return this.update(tab, moved, 'history.moveObject');
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
        // By value: a crop is an object.
        JSON.stringify((old as unknown as Record<string, unknown>)[key]) !==
          JSON.stringify((now as unknown as Record<string, unknown>)[key]),
    );
    if (edited && old.lockEdit) {
      return 'object.locked.edit';
    }
  }
  return null;
}
