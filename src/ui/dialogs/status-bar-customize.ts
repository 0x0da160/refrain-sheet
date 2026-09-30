// SPDX-License-Identifier: MIT
import { PanelBottom } from 'lucide';
import { t } from '../../app/i18n';
import {
  getStatusItemPlace,
  setStatusItemPlace,
  STATUS_ITEM_PLACES,
  STATUS_ITEMS,
  type StatusItemPlace,
} from '../../app/status-bar-prefs';
import { el } from '../dom';
import { openSidePanel, panelField, panelSection } from './side-panel';

/**
 * View > Customize Status Bar…: for each status bar item, whether it shows
 * in the bar, behind the bar's Details button, or not at all. Every change
 * is saved (in this browser only) and shown at once; the panel's × closes it.
 */
export function customizeStatusBar(onChange: () => void): Promise<null> {
  return openSidePanel<null>(
    { title: t('dialog.statusBar.title'), icon: PanelBottom, fallback: null },
    (body) => {
      const fields = STATUS_ITEMS.map((id) => {
        const select = el(
          'select',
          { attrs: { id: `status-item-${id}`, 'data-item': id } },
          STATUS_ITEM_PLACES.map((place) =>
            el('option', { text: t(`dialog.statusBar.place.${place}`), attrs: { value: place } }),
          ),
        ) as HTMLSelectElement;
        select.value = getStatusItemPlace(id);
        select.addEventListener('change', () => {
          setStatusItemPlace(id, select.value as StatusItemPlace);
          onChange();
        });
        return panelField(t(`dialog.statusBar.item.${id}`), select);
      });
      body.append(
        el('p', { className: 'dialog-note', text: t('dialog.statusBar.note') }),
        panelSection(null, fields),
      );
    },
  );
}
