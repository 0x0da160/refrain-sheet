// SPDX-License-Identifier: MIT
/**
 * View commands (`view.*`): wrapping, pinned rows/columns, freeze, panels,
 * full screen, spreadsheet zoom, and the per-device display preferences.
 * None of them touches document content or CSV bytes.
 */
import { workbookOf } from '../../../core/editor-document';
import { getBandedRows, setBandedRows } from '../../banded-rows';
import { setDensity, type DensityChoice } from '../../density';
import { t } from '../../i18n';
import {
  DEFAULT_SHEET_ZOOM,
  getAutoFitOnOpen,
  getEditHints,
  setAutoFitOnOpen,
  setEditHints,
} from '../../settings';
import { setBrowserSheetFont, type SheetFontId } from '../../sheet-font';
import { setTheme, type ThemeChoice } from '../../theme';
import { withTab, type CommandContext, type CommandSpec } from './types';

/** A pure preference toggle: re-emit `view` so menus, checkmarks and editors refresh. */
function preference(toggle: () => void): CommandSpec {
  return {
    run: (ctx) => {
      toggle();
      ctx.state.emit('view');
    },
  };
}

/**
 * Application-level zoom, never the browser's page zoom (whose shortcuts are
 * deliberately not intercepted). Without a document there is nothing to zoom.
 */
function zoomTo(percent: number): CommandSpec {
  return withTab((ctx, tab) => ctx.state.setTabZoom(tab, percent));
}

/**
 * Step through the shared zoom presets (same state as the menu and Ctrl/Cmd
 * + mouse wheel; browser zoom is never touched).
 */
function zoomStep(direction: 1 | -1): CommandSpec {
  return withTab((ctx, tab) => ctx.commands.zoomStep(tab, direction));
}

/**
 * An RSF worksheet remembers its own font (the narrowest level, so it wins);
 * anything else sets this browser's font. Main applies the effective font on
 * the `view` event, which also refreshes the menu checkmark and the grid
 * (which measures with the active font).
 */
function sheetFont(font: SheetFontId): CommandSpec {
  return {
    run: (ctx) => {
      const doc = workbookOf(ctx.tab?.doc);
      if (doc) {
        doc.activeSheet.displayFont = font;
      } else {
        setBrowserSheetFont(font);
      }
      ctx.state.emit('view');
    },
  };
}

/** Applying the theme is pure CSS (data-theme attribute); document bytes are never touched. */
function theme(choice: ThemeChoice): CommandSpec {
  return preference(() => setTheme(choice));
}

/** Pure CSS (data-density attribute), stored on this device only. */
function density(choice: DensityChoice): CommandSpec {
  return preference(() => setDensity(choice));
}

/**
 * Show the whole app full screen, or leave full screen. Uses the page's own
 * Fullscreen API rather than the browser's F11 full screen, so the menu item
 * can also leave it; Escape leaves it too (browser-owned). The View menu
 * refreshes from the `fullscreenchange` listener in main.ts.
 */
async function toggleFullscreen(ctx: CommandContext): Promise<void> {
  try {
    if (ctx.commands.isFullscreen()) {
      await ctx.dom.exitFullscreen();
    } else {
      await ctx.dom.documentElement.requestFullscreen();
    }
  } catch {
    ctx.ui.notify(t('notify.fullscreenFailed'), 'error');
  }
}

export const VIEW_COMMANDS = {
  'view.wrap': { run: ({ state }) => state.setWrapCells(!state.wrapCells) },
  'view.stickyFirstRow': { run: ({ state }) => state.setStickyFirstRow(!state.stickyFirstRowShown) },
  'view.stickyFirstColumn': { run: ({ state }) => state.setStickyFirstColumn(!state.stickyFirstColumnShown) },
  // Freezing at A1 would freeze nothing; once frozen, the toggle always clears.
  'view.freezeAtSelection': withTab(
    ({ state }, tab) => {
      if (tab.freeze) {
        state.setTabFreeze(tab, null);
      } else if (tab.selection) {
        // Rows count in display order, so a sorted view freezes what is shown above.
        state.setTabFreeze(tab, { rows: state.sortSlot(tab, tab.selection.row), cols: tab.selection.col });
      }
    },
    ({ state }, tab) =>
      tab.freeze !== null ||
      (tab.selection !== null && (state.sortSlot(tab, tab.selection.row) > 0 || tab.selection.col > 0)),
  ),
  'view.commentsPanel': {
    run: (ctx) => {
      ctx.commands.panelActions?.toggleComments();
      // Pure UI-visibility toggle: re-emit so the View menu checkbox reflects it.
      ctx.state.emit('view');
    },
  },
  // False where the page may not go full screen (e.g. an iframe without
  // permission, or iPhone Safari).
  'view.fullscreen': { enabled: (ctx) => ctx.dom.fullscreenEnabled === true, run: toggleFullscreen },
  'view.zoom.in': zoomStep(1),
  'view.zoom.out': zoomStep(-1),
  'view.zoom.50': zoomTo(50),
  'view.zoom.75': zoomTo(75),
  'view.zoom.90': zoomTo(90),
  'view.zoom.100': zoomTo(100),
  'view.zoom.110': zoomTo(110),
  'view.zoom.125': zoomTo(125),
  'view.zoom.150': zoomTo(150),
  'view.zoom.200': zoomTo(200),
  'view.zoom.reset': zoomTo(DEFAULT_SHEET_ZOOM),
  'view.editHints': preference(() => setEditHints(!getEditHints())),
  'view.bandedRows': preference(() => setBandedRows(!getBandedRows())),
  // Takes effect on the next file open; re-emitted so the checkbox updates now.
  'view.autoFitOnOpen': preference(() => setAutoFitOnOpen(!getAutoFitOnOpen())),
  'view.sheetFont.bizUd': sheetFont('biz-ud'),
  'view.sheetFont.ms': sheetFont('ms'),
  'view.sheetFont.msUi': sheetFont('ms-ui'),
  'view.sheetFont.notoSansJp': sheetFont('noto-sans-jp'),
  'view.sheetFont.meiryoUi': sheetFont('meiryo-ui'),
  'view.sheetFont.yuGothicUi': sheetFont('yu-gothic-ui'),
  'view.theme.system': theme('system'),
  'view.theme.light': theme('light'),
  'view.theme.dark': theme('dark'),
  'view.theme.hybrid': theme('hybrid'),
  'view.density.compact': density('compact'),
  'view.density.standard': density('standard'),
  'view.density.comfortable': density('comfortable'),
} satisfies Record<string, CommandSpec>;
