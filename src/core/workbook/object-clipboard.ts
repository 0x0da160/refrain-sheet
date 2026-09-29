// SPDX-License-Identifier: MIT
/**
 * Copying sheet objects (shapes, pictures and charts, see `sheet-objects.ts`)
 * and pasting them onto a worksheet of the same file or of another one.
 *
 * A copy keeps the objects as they were, the pictures they show, and the
 * data each chart showed then. Pasted into the same file, a chart keeps its
 * range (while that worksheet is still there); pasted into another file it
 * keeps the copied data instead, so it never depends on the first file
 * (`embedChartData` does the same when a chart's worksheet is deleted).
 */
import { chartData, chartSourceFits, type ChartCells, type ChartData, type ChartSpec } from './sheet-charts';
import { nextGroupId } from './object-arrange';
import type { ImageStore, SheetImageEntry } from './sheet-images';
import { MAX_OBJECT_EXTENT, nextObjectId, type SheetObject } from './sheet-objects';

export interface ObjectClip {
  /** The file the objects came from (compared by identity). */
  readonly source: object;
  readonly sheetId: string;
  /** Bottom to top, as they were stacked. */
  readonly objects: readonly SheetObject[];
  readonly images: readonly SheetImageEntry[];
  /** What each chart (by object id) showed when copied. */
  readonly chartData: ReadonlyMap<string, ChartData>;
}

/** A pasted copy on the sheet it came from is moved this far (px at 100%) so both show. */
const PASTE_OFFSET = 10;

interface ClipSource<S> extends ChartCells<S> {
  readonly images: ImageStore;
}

/** A copy of `objects` (of worksheet `sheetId` of `book`). */
export function copyObjects<S>(
  book: ClipSource<S>,
  sheetId: string,
  objects: readonly SheetObject[],
): ObjectClip {
  const imageIds = objects.flatMap((o) => (o.image !== undefined ? [o.image] : []));
  const data = new Map<string, ChartData>();
  for (const o of objects) {
    const shown = o.chart ? chartData(book, o.chart) : null;
    if (shown) data.set(o.id, shown);
  }
  return {
    source: book,
    sheetId,
    objects: objects.slice(),
    images: book.images.entries(new Set(imageIds)),
    chartData: data,
  };
}

/** The worksheet a paste lands on, and the file it belongs to. */
export interface PasteTarget {
  readonly book: object;
  readonly sheetId: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly objects: readonly SheetObject[];
  readonly images: ImageStore;
  /** A worksheet of the target file a chart may show, or null when there is none by that id. */
  readonly gridSheet: (id: string) => { rowCount: number; columnCount: number } | null;
}

function pastedChart(o: SheetObject, clip: ObjectClip, target: PasteTarget): ChartSpec | undefined {
  const chart = o.chart;
  if (!chart?.source) {
    return chart;
  }
  const sheet = clip.source === target.book ? target.gridSheet(chart.source.sheetId) : null;
  if (sheet && chartSourceFits(chart.source, sheet.rowCount, sheet.columnCount)) {
    return chart;
  }
  const kept: ChartSpec = { ...chart, data: clip.chartData.get(o.id) ?? { categories: [], series: [] } };
  delete kept.source;
  delete kept.seriesInRows;
  return kept;
}

/**
 * The objects `clip` pastes onto `target` (new ids, on top of the others),
 * adding their pictures to the target file's pictures.
 */
export function pasteObjects(clip: ObjectClip, target: PasteTarget): SheetObject[] {
  const onItself = clip.source === target.book && clip.sheetId === target.sheetId;
  const pictures = new Map<string, string>();
  for (const entry of clip.images) {
    pictures.set(entry.id, target.images.add({ type: entry.type, bytes: entry.bytes }));
  }
  // Each copied group becomes a new group, apart from the one it was copied from.
  const groups = new Map<string, string>();
  for (const o of clip.objects) {
    if (o.group && !groups.has(o.group)) {
      groups.set(o.group, nextGroupId(target.objects, new Set(groups.values())));
    }
  }
  const placed: SheetObject[] = [];
  for (const o of clip.objects) {
    const copy: SheetObject = {
      ...o,
      id: nextObjectId([...target.objects, ...placed]),
      row: Math.min(o.row, target.rowCount - 1),
      col: Math.min(o.col, target.columnCount - 1),
    };
    if (onItself) {
      copy.dx = Math.min(o.dx + PASTE_OFFSET, MAX_OBJECT_EXTENT);
      copy.dy = Math.min(o.dy + PASTE_OFFSET, MAX_OBJECT_EXTENT);
    }
    if (o.image !== undefined) {
      copy.image = pictures.get(o.image) ?? o.image;
    }
    if (o.group) {
      copy.group = groups.get(o.group);
    }
    const chart = pastedChart(o, clip, target);
    if (chart) copy.chart = chart;
    placed.push(copy);
  }
  return placed;
}
