// SPDX-License-Identifier: MIT
/**
 * A workbook's worksheet list: display order, the active worksheet, name
 * lookup under the case-insensitive uniqueness policy, and identifier minting.
 *
 * Owned by `RsfDocument`, which records every structural change as a mutation
 * (dirty + recalculation); the registry itself only keeps the list consistent.
 */
import { sheetNameKey } from '../formula';
import { MAX_RSF_SHEETS } from './rsf-codec';
import type { Worksheet } from './worksheet';

/** Maximum number of worksheets a workbook may hold (mirrors the container bound). */
export const MAX_WORKSHEETS = MAX_RSF_SHEETS;

/**
 * Fallback name for the first worksheet. The application passes a localized
 * name (`Sheet1` / `シート1`); this constant only applies when a caller
 * supplies none, keeping the core layer free of i18n dependencies.
 */
export const DEFAULT_SHEET_NAME = 'Sheet1';

export class SheetRegistry {
  private list: Worksheet[];
  private activeId: string;
  private nextSeq: number;
  /** Worksheet lookup by name key, rebuilt after any structural change. */
  private nameIndex: Map<string, Worksheet> | null = null;

  constructor(sheets: Worksheet[], activeId?: string) {
    this.list = sheets;
    this.activeId = sheets[0].id;
    this.nextSeq = sheets.length + 1;
    if (activeId !== undefined) {
      this.restoreActive(activeId);
    }
  }

  /** The worksheets, in display order (read-only view). */
  get sheets(): readonly Worksheet[] {
    return this.list;
  }

  get active(): Worksheet {
    return this.list.find((s) => s.id === this.activeId) ?? this.list[0];
  }

  byId(id: string): Worksheet | null {
    return this.list.find((s) => s.id === id) ?? null;
  }

  /** Resolve a worksheet by display name, case-insensitively (the uniqueness policy). */
  byName(name: string): Worksheet | null {
    if (!this.nameIndex) {
      this.nameIndex = new Map();
      for (const sheet of this.list) {
        this.nameIndex.set(sheetNameKey(sheet.name), sheet);
      }
    }
    return this.nameIndex.get(sheetNameKey(name)) ?? null;
  }

  /** 0-based position of a worksheet, or -1. */
  indexOf(id: string): number {
    return this.list.findIndex((s) => s.id === id);
  }

  /** Activate a worksheet; false when it is already active or does not exist. */
  setActive(id: string): boolean {
    if (this.activeId === id || !this.list.some((s) => s.id === id)) {
      return false;
    }
    this.activeId = id;
    return true;
  }

  /** True when `name` is free (case-insensitively), ignoring `exceptId`. */
  isNameAvailable(name: string, exceptId?: string): boolean {
    const key = sheetNameKey(name);
    return !this.list.some((s) => s.id !== exceptId && sheetNameKey(s.name) === key);
  }

  /**
   * `desired` if free, otherwise the first available `desired (2)`,
   * `desired (3)`, … so a generated name never collides.
   */
  uniqueName(desired: string, exceptId?: string): string {
    const base = desired.trim() || DEFAULT_SHEET_NAME;
    if (this.isNameAvailable(base, exceptId)) {
      return base;
    }
    for (let n = 2; n <= MAX_WORKSHEETS + 2; n++) {
      const candidate = `${base} (${n})`;
      if (this.isNameAvailable(candidate, exceptId)) {
        return candidate;
      }
    }
    return `${base} (${Date.now()})`;
  }

  /** Mint an identifier that no current worksheet uses. */
  mintId(): string {
    for (;;) {
      const id = `s${this.nextSeq++}`;
      if (!this.list.some((s) => s.id === id)) {
        return id;
      }
    }
  }

  /** Insert an existing worksheet at `index`; false when full or the id is taken. */
  insertAt(index: number, sheet: Worksheet): boolean {
    if (this.list.length >= MAX_WORKSHEETS || this.byId(sheet.id)) {
      return false;
    }
    const at = Math.max(0, Math.min(this.list.length, index));
    this.list.splice(at, 0, sheet);
    return true;
  }

  /** Remove a worksheet (never the last one), activating its neighbour if it was active. */
  remove(id: string): { sheet: Worksheet; index: number } | null {
    if (this.list.length <= 1) {
      return null;
    }
    const index = this.indexOf(id);
    if (index < 0) {
      return null;
    }
    const [sheet] = this.list.splice(index, 1);
    if (this.activeId === id) {
      // Activate the neighbour that takes the removed worksheet's place.
      this.activeId = this.list[Math.min(index, this.list.length - 1)].id;
    }
    return { sheet, index };
  }

  /** Move a worksheet to a new position; false when nothing moved. */
  move(id: string, toIndex: number): boolean {
    const from = this.indexOf(id);
    if (from < 0) {
      return false;
    }
    const to = Math.max(0, Math.min(this.list.length - 1, toIndex));
    if (from === to) {
      return false;
    }
    const [sheet] = this.list.splice(from, 1);
    this.list.splice(to, 0, sheet);
    return true;
  }

  /** Replace every worksheet (a version-history restore), restoring `activeId` when it still exists. */
  replaceAll(sheets: Worksheet[], activeId: string | undefined): void {
    this.list = sheets;
    this.activeId = sheets[0].id;
    if (activeId !== undefined) {
      this.restoreActive(activeId);
    }
    this.nextSeq = sheets.length + 1;
  }

  /** Forget cached name lookups after a structural change or rename. */
  invalidateNames(): void {
    this.nameIndex = null;
  }

  private restoreActive(activeId: string): void {
    // Restore the saved active worksheet when it still exists; otherwise fall
    // back safely to the first worksheet.
    const active = activeId && this.list.find((s) => s.id === activeId);
    this.activeId = active ? active.id : this.list[0].id;
  }
}
