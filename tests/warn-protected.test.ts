// SPDX-License-Identifier: MIT
/**
 * `warnProtectedAndOfferUnlock` (src/app/commands/shared.ts): the shared
 * blocking-warning-dialog primitive behind both `AppState.warnBlocked`
 * (wired in main.ts to cover every mutation entry point, including the
 * Markdown/JSON worksheet textareas — see #541) and
 * `FileIoCommands.ensureRsf`'s own protected-tab guard (covered in
 * commands.test.ts). This file exercises it directly, including the
 * worksheet-lock scope that ensureRsf never reaches.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { warnProtectedAndOfferUnlock } from '../src/app/commands/shared';
import { t } from '../src/app/i18n';
import { RsfDocument } from '../src/core/rsf-document';
import { doc } from './helpers';

function stubConfirm(result: boolean) {
  return vi.fn(async () => result);
}

describe('warnProtectedAndOfferUnlock', () => {
  it('warns about a protected book and unlocks it when confirmed', async () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('a\n'), null, true);
    const confirm = stubConfirm(true);

    await warnProtectedAndOfferUnlock({ confirm } as never, state, tab, 'book');

    expect(confirm).toHaveBeenCalledWith(
      t('dialog.warnProtected.bookTitle'),
      t('dialog.warnProtected.bookMessage', { name: 'a.csv' }),
      t('dialog.warnProtected.unlock'),
      t('dialog.warnProtected.cancel'),
    );
    expect(tab.readOnly).toBe(false);
  });

  it('leaves a protected book untouched when the warning is declined', async () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('a\n'), null, true);

    await warnProtectedAndOfferUnlock({ confirm: stubConfirm(false) } as never, state, tab, 'book');

    expect(tab.readOnly).toBe(true);
  });

  it('warns about a locked worksheet (naming it, not the book) and unlocks it when confirmed', async () => {
    const state = new AppState();
    const workbook = RsfDocument.blank('a.rsf', 3, 3, 'Budget');
    const tab = state.addTab('a.rsf', workbook, null);
    state.setSheetLocked(tab, workbook.activeSheetId, true);
    const confirm = stubConfirm(true);

    await warnProtectedAndOfferUnlock({ confirm } as never, state, tab, 'sheet');

    expect(confirm).toHaveBeenCalledWith(
      t('dialog.warnProtected.sheetTitle'),
      t('dialog.warnProtected.sheetMessage', { name: 'Budget' }),
      t('dialog.warnProtected.unlock'),
      t('dialog.warnProtected.cancel'),
    );
    expect(workbook.activeSheet.locked).toBe(false);
  });

  it('leaves a locked worksheet untouched when the warning is declined', async () => {
    const state = new AppState();
    const workbook = RsfDocument.blank('a.rsf', 3, 3, 'Budget');
    const tab = state.addTab('a.rsf', workbook, null);
    state.setSheetLocked(tab, workbook.activeSheetId, true);

    await warnProtectedAndOfferUnlock({ confirm: stubConfirm(false) } as never, state, tab, 'sheet');

    expect(workbook.activeSheet.locked).toBe(true);
  });
});
