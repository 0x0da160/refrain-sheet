// SPDX-License-Identifier: MIT
/**
 * File > New, New CSV and New Markdown / JSON / YAML: blank documents in a
 * new active tab. A part of `FileIoCommands` (`fileIo.creating`).
 */
import { LosslessDocument } from '../../core/csv/lossless-document';
import { isValidSheetName } from '../../core/formula';
import { RsfDocument, NEW_DOC_ROWS, NEW_DOC_COLS, RSF_EXTENSION } from '../../core/workbook/rsf-document';
import type { AppState, Tab } from '../state';
import { defaultSheetName } from '../state/defaults';
import { getLocale, t } from '../i18n';
import { CSV_EXTENSION } from './shared';

/** The kinds of document File > New can create besides RSF and CSV. */
export type NewTextFileKind = 'markdown' | 'json' | 'yaml';

const NEW_TEXT_EXTENSIONS: Record<NewTextFileKind, string> = {
  markdown: '.md',
  json: '.json',
  yaml: '.yaml',
};

export class NewDocuments {
  /** Blank-document counter so each File > New tab gets a distinct default name. */
  private newDocCount = 0;
  /** Blank-document counter so each File > New CSV tab gets a distinct default name. */
  private newCsvDocCount = 0;
  /** Blank-document counters for File > New Markdown / JSON / YAML, one per kind. */
  private readonly newTextDocCounts: Partial<Record<NewTextFileKind, number>> = {};

  constructor(private readonly state: AppState) {}

  /**
   * File > New: create a blank spreadsheet document in a new active tab. New
   * documents are RSF because a blank spreadsheet may gain formulas,
   * structural edits, metadata, and user-defined dimensions that a plain CSV
   * cannot hold. The document starts unsaved (marked dirty) and is saved as
   * `.rsf`; its filename and location are chosen on the first save. Creating
   * it never mutates any other open document.
   */
  newDocument(): Tab {
    this.newDocCount += 1;
    const suffix = this.newDocCount > 1 ? `-${this.newDocCount}` : '';
    const name = `${t('untitled.new')}${suffix}${RSF_EXTENSION}`;
    const doc = RsfDocument.blank(name, NEW_DOC_ROWS, NEW_DOC_COLS, defaultSheetName(), getLocale());
    return this.state.addTab(name, doc, null);
  }

  /**
   * File > New CSV: create a blank, byte-preserving CSV document in a new
   * active tab (#396) — the CSV counterpart of `newDocument`'s blank RSF
   * spreadsheet. The starting content is a single blank line (one empty
   * row/column) rather than zero bytes: a genuinely empty (0-row) document
   * renders no selectable cell at all (see `Grid.refresh`'s `grid.empty`
   * state), which would leave a freshly created tab with no way to select a
   * cell, paste, or insert a row — a dead end for a command whose whole
   * point is to start editing. Unlike `newDocument`'s RSF workbook, the tab
   * is not force-marked dirty: `LosslessDocument.isDirty` tracks actual
   * edits, so an untouched new CSV closes silently, exactly like opening a
   * real file and not touching it. Its filename and location are chosen on
   * the first save (as `.csv`). Creating it never mutates any other open
   * document.
   */
  newCsvDocument(): Tab {
    this.newCsvDocCount += 1;
    const suffix = this.newCsvDocCount > 1 ? `-${this.newCsvDocCount}` : '';
    const name = `${t('untitled.new')}${suffix}${CSV_EXTENSION}`;
    const doc = LosslessDocument.fromBytes(new TextEncoder().encode('\n'));
    const tab = this.state.addTab(name, doc, null);
    // Until the first save there is no on-disk byte layout to protect, so
    // row/column structural edits are allowed directly on this CSV document
    // (#479) — see `Tab.neverSaved` and `StructuralOpsState`.
    tab.neverSaved = true;
    return tab;
  }

  /**
   * File > New Markdown / JSON / YAML (and the welcome screen's buttons):
   * create an empty document of that kind in a new active tab — the same
   * one-worksheet editor a `.md` / `.json` / `.yaml` file opens in. It has
   * no file yet, so the first save asks where to save it (or downloads it)
   * as UTF-8 with LF line endings. Like File > New CSV, an untouched new
   * document closes without asking.
   */
  newTextDocument(kind: NewTextFileKind): Tab {
    const count = (this.newTextDocCounts[kind] ?? 0) + 1;
    this.newTextDocCounts[kind] = count;
    const base = `${t('untitled.new')}${count > 1 ? `-${count}` : ''}`;
    const name = `${base}${NEW_TEXT_EXTENSIONS[kind]}`;
    const sheetName = isValidSheetName(base) ? base : defaultSheetName();
    const doc = RsfDocument.fromSourceText(name, kind, '', sheetName, getLocale());
    const tab = this.state.addTab(name, doc, null);
    tab.textFile = {
      kind,
      encoding: 'utf-8',
      bom: false,
      lineEnding: 'lf',
      savedText: '',
      savedBytes: new Uint8Array(0),
    };
    this.state.emit('tabs');
    return tab;
  }
}
