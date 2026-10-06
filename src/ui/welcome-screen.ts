// SPDX-License-Identifier: MIT
import { isCommandAvailable, isMinimalEdition } from '../app/edition';
import {
  Cloud,
  FileCode,
  FileJson,
  FilePenLine,
  FilePlus,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FileType,
  FolderClock,
  FolderOpen,
  TableProperties,
  type IconNode,
} from 'lucide';
import type { CommandId, Commands } from '../app/commands';
import type { RecentFileChoice } from '../app/ui-port';
import { getLocale, t } from '../app/i18n';
import { createAppLogotype } from './app-icon';
import { el, clearChildren } from './dom';
import { createIcon } from './icon';

/** How many recent files the home screen lists; the rest are behind "Show all". */
const RECENT_SHOWN = 5;

/**
 * The home screen: shown on first launch and restored whenever the last
 * document tab is closed, so the application never sits on an empty tab strip
 * or a blank grid. Two groups of entry points side by side — Open (a file,
 * Google Drive, a JSON table) and New (every kind File > New makes) — then
 * the recent files and the drag & drop hint. The fuller app description
 * lives in Help ▸ About, not here. Application-level preferences live
 * outside the tab lifecycle and are unaffected; the screen simply re-renders
 * in the active locale.
 */
export class WelcomeScreen {
  readonly element: HTMLElement;
  /** Bumped on every render, so a slow recent-files lookup never fills a newer screen. */
  private renderId = 0;

  constructor(private readonly commands: Commands) {
    this.element = el('div', { className: 'welcome-screen' });
    this.element.hidden = true;
    this.render(false);
  }

  /** Re-render the localized content and show/hide the screen. */
  refresh(visible: boolean): void {
    this.render(visible);
    this.element.hidden = !visible;
  }

  private render(visible: boolean): void {
    this.renderId += 1;
    clearChildren(this.element);
    const recent = el('section', {
      className: 'welcome-recent-section',
      attrs: { 'aria-labelledby': 'welcome-recent-heading' },
    });
    recent.hidden = true;
    this.element.append(
      el('div', { className: 'welcome-inner' }, [
        // The design system's fixed icon+wordmark logotype, not the icon and
        // product name re-set separately: nothing else here states the product
        // name, so (unlike the small app icon elsewhere) it carries a real
        // accessible name instead of being decorative. Wrapped in the page's
        // one <h1> for heading semantics; sized via width/height attributes so
        // it never shifts layout, and it follows the light/dark theme.
        el('header', { className: 'welcome-header' }, [
          el('h1', {}, [createAppLogotype('welcome-logotype', 44)]),
          el('p', { text: t(isMinimalEdition() ? 'app.subtitleMinimal' : 'app.subtitle') }),
        ]),
        el('div', { className: 'welcome-groups' }, [this.openGroup(), this.newGroup()]),
        recent,
        el('p', { className: 'welcome-drop', text: t('welcome.drop') }),
      ]),
    );
    if (visible && this.commands.isEnabled('file.openRecent')) {
      void this.fillRecent(recent, this.renderId);
    }
  }

  /** A group of entry points under its own heading. */
  private group(id: string, titleKey: string, className: string, buttons: HTMLElement[]): HTMLElement {
    return el('section', { className: `welcome-group ${className}`, attrs: { 'aria-labelledby': id } }, [
      el('h2', { className: 'welcome-group-title', text: t(titleKey), attrs: { id } }),
      el('div', { className: 'welcome-group-items' }, buttons),
    ]);
  }

  private button(
    className: string,
    command: CommandId,
    labelKey: string,
    icon: IconNode,
    iconSize: number,
  ): HTMLButtonElement {
    const button = el('button', { className, attrs: { type: 'button' } }, [
      createIcon(icon, 'welcome-icon', iconSize),
      el('span', { text: t(labelKey) }),
    ]) as HTMLButtonElement;
    button.addEventListener('click', () => void this.commands.run(command));
    return button;
  }

  /** Open: the file picker first, then Google Drive and the JSON-table import where this build has them. */
  private openGroup(): HTMLElement {
    const items = [
      this.button('welcome-action welcome-open primary', 'file.open', 'welcome.open', FolderOpen, 18),
    ];
    if (isCommandAvailable('drive.open') && this.commands.driveAvailable()) {
      items.push(this.button('welcome-open', 'drive.open', 'welcome.openDrive', Cloud, 18));
    }
    if (isCommandAvailable('file.importJsonTable')) {
      items.push(
        this.button('welcome-open', 'file.importJsonTable', 'welcome.importJsonTable', TableProperties, 18),
      );
    }
    return this.group('welcome-open-heading', 'welcome.openTitle', 'welcome-open-group', items);
  }

  /**
   * New: the spreadsheet kinds first (`.welcome-action`), then the text
   * kinds (`.welcome-text-action`) — the same editors a `.md` / `.json` /
   * `.yaml` / `.txt` file opens in.
   */
  private newGroup(): HTMLElement {
    const kinds: Array<{ command: CommandId; labelKey: string; icon: IconNode; text: boolean }> = [
      { command: 'file.new', labelKey: 'welcome.new', icon: FilePlus, text: false },
      { command: 'file.newCsv', labelKey: 'welcome.newCsv', icon: FilePlus2, text: false },
      { command: 'file.newMarkdown', labelKey: 'welcome.newMarkdown', icon: FilePenLine, text: true },
      { command: 'file.newJson', labelKey: 'welcome.newJson', icon: FileJson, text: true },
      { command: 'file.newYaml', labelKey: 'welcome.newYaml', icon: FileCode, text: true },
      { command: 'file.newText', labelKey: 'welcome.newText', icon: FileType, text: true },
    ];
    const items = kinds
      .filter(({ command }) => isCommandAvailable(command))
      .map(({ command, labelKey, icon, text }) =>
        this.button(
          `welcome-new ${text ? 'welcome-text-action' : 'welcome-action'}`,
          command,
          labelKey,
          icon,
          24,
        ),
      );
    return this.group('welcome-new-heading', 'welcome.newTitle', 'welcome-new-group', items);
  }

  /** List the newest recent files (both places together), with Show All for the rest. */
  private async fillRecent(section: HTMLElement, renderId: number): Promise<void> {
    let entries: RecentFileChoice[];
    try {
      entries = await this.commands.recentFiles();
    } catch {
      return;
    }
    if (renderId !== this.renderId || entries.length === 0) {
      return;
    }
    entries = entries.slice().sort((a, b) => b.openedAt - a.openedAt);
    const list = el('ul', { className: 'welcome-recent-list' });
    for (const entry of entries.slice(0, RECENT_SHOWN)) {
      const button = el('button', { className: 'welcome-recent-file', attrs: { type: 'button' } }, [
        createIcon(recentIcon(entry.name), 'welcome-icon', 16),
        el('span', { className: 'welcome-recent-name', text: entry.name }),
        ...(entry.where === 'drive'
          ? [el('span', { className: 'welcome-recent-where', text: t('dialog.recentFiles.drive') })]
          : []),
        el('span', {
          className: 'welcome-recent-time',
          text: new Date(entry.openedAt).toLocaleString(getLocale(), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        }),
      ]);
      button.addEventListener('click', () => void this.commands.openRecentFile(entry.id));
      list.append(el('li', {}, [button]));
    }
    const all = el('button', { className: 'welcome-recent-all', attrs: { type: 'button' } }, [
      createIcon(FolderClock, 'welcome-icon', 16),
      el('span', { text: t('welcome.recentAll') }),
    ]);
    all.addEventListener('click', () => void this.commands.run('file.openRecent'));
    section.append(
      el('div', { className: 'welcome-recent-header' }, [
        el('h2', {
          className: 'welcome-group-title',
          text: t('dialog.recentFiles.title'),
          attrs: { id: 'welcome-recent-heading' },
        }),
        all,
      ]),
      list,
    );
    section.hidden = false;
  }
}

/** A recent file's icon from its name: a spreadsheet or a text file. */
function recentIcon(name: string): IconNode {
  return /\.(rsf|rcsv|csv|tsv|xlsx)$/i.test(name) ? FileSpreadsheet : FileText;
}
