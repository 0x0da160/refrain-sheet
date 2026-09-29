// SPDX-License-Identifier: MIT
/**
 * Menus without the commands this edition leaves out (see
 * `src/app/edition.ts`): each such item goes, then any submenu, group
 * heading or menu left with nothing in it, and the separators that no
 * longer separate anything.
 */
import type { CommandId } from '../../app/commands';

/** The shape shared by the menu bar's and the right-click menu's items. */
interface PrunableItem {
  command?: CommandId;
  heading?: boolean;
  submenu?: ReadonlyArray<PrunableItem | 'separator'>;
}

/** `items` without the commands `keep` rejects, tidied as described above. */
export function pruneItems<T extends PrunableItem>(
  items: ReadonlyArray<T | 'separator'>,
  keep: (id: CommandId) => boolean,
): Array<T | 'separator'> {
  const kept: Array<T | 'separator'> = [];
  for (const item of items) {
    if (item === 'separator') {
      kept.push(item);
    } else if (item.submenu) {
      const submenu = pruneItems(item.submenu, keep);
      if (submenu.some((entry) => entry !== 'separator' && !entry.heading)) {
        kept.push({ ...item, submenu });
      }
    } else if (!item.command || keep(item.command)) {
      kept.push(item);
    }
  }
  // A heading with no command under it before the next separator or heading goes too.
  const withoutEmptyHeadings = kept.filter((item, i) => {
    if (item === 'separator' || !item.heading) {
      return true;
    }
    const next = kept[i + 1];
    return next !== undefined && next !== 'separator' && !next.heading;
  });
  return withoutEmptyHeadings.filter(
    (item, i, list) => item !== 'separator' || (i > 0 && i < list.length - 1 && list[i - 1] !== 'separator'),
  );
}
