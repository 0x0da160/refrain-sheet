// SPDX-License-Identifier: MIT
/**
 * A workbook's version history (Sheet ▸ File Version History…): whether it is
 * recorded, the retained snapshots, and the per-file cap on how many are kept.
 *
 * Owned by `RsfDocument`, which persists all three in the `.rsf` container
 * (see knowledge/formats/rsf/) and marks itself dirty whenever a setter here
 * reports a change. Nothing here touches cell content; restoring a snapshot's
 * content is the workbook's job.
 */
import {
  DEFAULT_HISTORY_SNAPSHOT_LIMIT,
  encodeRsfBody,
  MAX_RSF_HISTORY_SNAPSHOTS,
  type RsfHistorySnapshot,
  type RsfWorkbookData,
} from './rsf-codec';

export class VersionHistory {
  /**
   * Whether version history is recorded for this document, a per-file
   * setting. Defaults to `true` for every new workbook and every file saved
   * before this setting existed.
   */
  private enabledFlag: boolean;

  /**
   * Past snapshots of this document's content, oldest first, capped at
   * {@link MAX_RSF_HISTORY_SNAPSHOTS}. Loaded from the file on open; a new
   * snapshot of the content being saved is appended on every successful save
   * while recording is enabled (see {@link record}).
   */
  private snapshots: RsfHistorySnapshot[];

  /**
   * Per-file override of the retained-snapshot cap. `undefined` uses the
   * default ({@link DEFAULT_HISTORY_SNAPSHOT_LIMIT} — every new workbook and
   * every file saved before this setting existed); `null` means "unlimited"
   * (still bounded by the hard technical ceiling {@link MAX_RSF_HISTORY_SNAPSHOTS}
   * to keep worst-case file growth and decode cost bounded); a number is an
   * explicit cap. See {@link effectiveMax}.
   */
  private maxOverrideValue: number | null | undefined;

  /** {@link contentKey} of the newest snapshot, once worked out (null: not yet). */
  private newestKey: string | null = null;

  /**
   * The file-level settings (see `RsfDocument`) as of the newest snapshot:
   * a snapshot holds only content, so a change to these is told apart here.
   */
  private settingsKey: string;

  constructor(
    enabled = true,
    snapshots: RsfHistorySnapshot[] = [],
    maxOverride: number | null | undefined = undefined,
    settingsKey = '',
  ) {
    this.enabledFlag = enabled;
    this.snapshots = snapshots;
    this.maxOverrideValue = maxOverride;
    this.settingsKey = settingsKey;
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  /** The retained snapshots, oldest first. */
  get list(): readonly RsfHistorySnapshot[] {
    return this.snapshots;
  }

  get maxOverride(): number | null | undefined {
    return this.maxOverrideValue;
  }

  /**
   * The retained-snapshot cap the next save actually enforces: the per-file
   * override, or {@link DEFAULT_HISTORY_SNAPSHOT_LIMIT} when none is set.
   * `null` means unlimited (still bounded by {@link MAX_RSF_HISTORY_SNAPSHOTS}).
   */
  get effectiveMax(): number | null {
    return this.maxOverrideValue === undefined ? DEFAULT_HISTORY_SNAPSHOT_LIMIT : this.maxOverrideValue;
  }

  /**
   * True when the next successful save will drop the oldest recorded
   * snapshot to stay within the retained cap. Always false when history is
   * off or the cap is unlimited, since neither ever drops a snapshot.
   */
  get willDropOldestOnNextSave(): boolean {
    if (!this.enabledFlag) {
      return false;
    }
    const max = this.effectiveMax;
    return max !== null && this.snapshots.length >= max;
  }

  /** Turn recording on or off; true when that changed anything. */
  setEnabled(enabled: boolean): boolean {
    if (enabled === this.enabledFlag) {
      return false;
    }
    this.enabledFlag = enabled;
    return true;
  }

  /** Discard every recorded snapshot; true when there were any. */
  clear(): boolean {
    if (this.snapshots.length === 0) {
      return false;
    }
    this.snapshots = [];
    this.newestKey = null;
    return true;
  }

  /**
   * Change the cap override: `undefined` reverts to the default, `null` is
   * unlimited, and a finite number is clamped into
   * `[1, MAX_RSF_HISTORY_SNAPSHOTS]`. True when that changed anything.
   */
  setMaxOverride(value: number | null | undefined): boolean {
    const normalized =
      value === undefined || value === null
        ? value
        : Math.max(1, Math.min(MAX_RSF_HISTORY_SNAPSHOTS, Math.round(value)));
    if (normalized === this.maxOverrideValue) {
      return false;
    }
    this.maxOverrideValue = normalized;
    return true;
  }

  /**
   * Record one save. While enabled, appends a snapshot of `content` — which
   * carries no history of its own, so its raw body encoding is exactly this
   * save's document state (see `encodeRsfBody`) — and drops the oldest
   * snapshots beyond the retained cap ("unlimited" still falls back to the
   * hard ceiling). Disabled recording never clears existing snapshots.
   *
   * A save that changes nothing since the newest snapshot adds none: not the
   * content (cells, styles, each worksheet's own settings…) and not the
   * file-level `settingsKey`. The save time, the writing release, and which
   * worksheet is shown do not count as changes. True when a snapshot was added.
   */
  record(content: RsfWorkbookData, timestamp: number, settingsKey = ''): boolean {
    if (!this.enabledFlag) {
      return false;
    }
    const bytes = encodeRsfBody(content);
    const key = contentKey(bytes);
    const newest = this.snapshots[this.snapshots.length - 1];
    if (newest && settingsKey === this.settingsKey && (this.newestKey ?? contentKey(newest.bytes)) === key) {
      this.newestKey = key;
      return false;
    }
    const limit = this.effectiveMax ?? MAX_RSF_HISTORY_SNAPSHOTS;
    this.snapshots = [...this.snapshots, { timestamp, bytes }].slice(-limit);
    this.newestKey = key;
    this.settingsKey = settingsKey;
    return true;
  }
}

/**
 * A snapshot's content without what changes on every save or does not
 * change the document: the save time, the writing release, and the shown
 * worksheet. Unreadable bytes key as themselves (never equal to a real save).
 */
function contentKey(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    delete json.app;
    delete json.updated;
    delete json.activeSheet;
    return JSON.stringify(json);
  } catch {
    return `raw:${text}`;
  }
}
