// SPDX-License-Identifier: MIT
/** Application commands: settings, language, help, and document tabs (`app.*`, `lang.*`, `help.*`, `tab.*`). */
import { workbookOf } from '../../../core/editor-document';
import { setLocale, t } from '../../i18n';
import {
  getBrowserWrap,
  getBrowserZoom,
  getMaxFileSize,
  getShiftPasteMode,
  setBrowserWrap,
  setBrowserZoom,
  setMaxFileSize,
  setShiftPasteMode,
} from '../../settings';
import { GRID_LOOK_KEYS } from '../../../core/grid-look';
import { getBrowserGridLook, setBrowserGridLook } from '../../grid-look';
import { getBrowserSheetFont, isSheetFontId, setBrowserSheetFont } from '../../sheet-font';
import type { Tab } from '../../state';
import { getPetsShown, setPetsShown } from '../../pets-prefs';
import { getToolbarShown, setToolbarShown } from '../../toolbar-prefs';
import { withTab, type CommandContext, type CommandSpec } from './types';

/** File > Settings…: the per-device preferences and, for a workbook, its file-level display settings. */
async function settings(ctx: CommandContext): Promise<void> {
  const rsf = workbookOf(ctx.tab?.doc);
  const chosen = await ctx.ui.chooseSettings({
    maxFileSize: getMaxFileSize(),
    shiftPaste: getShiftPasteMode(),
    showToolbar: getToolbarShown(),
    showPets: getPetsShown(),
    browserDisplay: {
      zoom: getBrowserZoom(),
      wrap: getBrowserWrap(),
      font: getBrowserSheetFont(),
      look: getBrowserGridLook(),
    },
    fileDisplay: rsf
      ? {
          zoom: rsf.fileZoom,
          wrap: rsf.fileWrap,
          font: isSheetFontId(rsf.fileFont) ? rsf.fileFont : undefined,
          look: { ...rsf.fileLook },
        }
      : null,
  });
  if (chosen === null) {
    return;
  }
  const applied = setMaxFileSize(chosen.maxFileSize);
  setShiftPasteMode(chosen.shiftPaste);
  setToolbarShown(chosen.showToolbar);
  setPetsShown(chosen.showPets);
  setBrowserZoom(chosen.browserDisplay.zoom);
  setBrowserWrap(chosen.browserDisplay.wrap);
  setBrowserSheetFont(chosen.browserDisplay.font);
  setBrowserGridLook(chosen.browserDisplay.look);
  // The file level is presentational like zoom: kept with the next save,
  // never marks the document dirty. Choosing a file-level value clears each
  // worksheet's own one, so the file setting takes effect everywhere (a
  // worksheet would outrank it).
  if (rsf && chosen.fileDisplay) {
    const { zoom, wrap, font, look } = chosen.fileDisplay;
    if (zoom !== undefined && zoom !== rsf.fileZoom) {
      for (const sheet of rsf.sheets) sheet.displayZoom = undefined;
    }
    if (wrap !== undefined && wrap !== rsf.fileWrap) {
      for (const sheet of rsf.sheets) sheet.displayWrap = undefined;
    }
    if (font !== undefined && font !== rsf.fileFont) {
      for (const sheet of rsf.sheets) sheet.displayFont = undefined;
    }
    for (const key of GRID_LOOK_KEYS) {
      if (look[key] !== undefined && look[key] !== rsf.fileLook[key]) {
        for (const sheet of rsf.sheets) delete sheet.displayLook[key];
      }
    }
    rsf.fileLook = { ...look };
    rsf.fileZoom = zoom;
    rsf.fileWrap = wrap;
    rsf.fileFont = font;
  }
  // Re-resolve zoom/wrap everywhere; menus also label Ctrl+Shift+V on
  // whichever command it now runs.
  ctx.state.reapplyViewSettings();
  ctx.ui.notify(t('notify.settingsSaved', { size: Math.round(applied / (1024 * 1024)) }), 'info');
}

type TabMove = 'first' | 'last' | 'left' | 'right';

/** Move the active tab (menu/keyboard path; announced via the status toast). */
function moveTab(move: TabMove): CommandSpec {
  const run = ({ state, ui }: CommandContext, tab: Tab): void => {
    const index = state.tabIndex(tab.id);
    const target = { first: 0, last: state.tabs.length - 1, left: index - 1, right: index + 1 }[move];
    if (state.moveTab(tab.id, target)) {
      ui.notify(
        t('notify.tabMoved', { name: tab.name, pos: state.tabIndex(tab.id) + 1, total: state.tabs.length }),
        'info',
      );
    }
  };
  return withTab(run, ({ state }, tab) =>
    move === 'first' || move === 'left'
      ? state.tabIndex(tab.id) > 0
      : state.tabIndex(tab.id) < state.tabs.length - 1,
  );
}

export const APP_COMMANDS = {
  'app.settings': { run: settings },
  'lang.en': { run: () => setLocale('en') },
  'lang.ja': { run: () => setLocale('ja') },
  'help.formula': { run: (ctx) => ctx.ui.showFormulaHelp() },
  'help.shortcuts': { run: (ctx) => ctx.ui.showAbout('shortcuts') },
  'help.about': { run: (ctx) => ctx.ui.showAbout('about') },
  'tab.moveLeft': moveTab('left'),
  'tab.moveRight': moveTab('right'),
  'tab.moveFirst': moveTab('first'),
  'tab.moveLast': moveTab('last'),
} satisfies Record<string, CommandSpec>;
