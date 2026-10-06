// SPDX-License-Identifier: MIT
import { Type } from 'lucide';
import type { ApplyHandler, FontDialogResult } from '../../app/commands';
import { t } from '../../app/i18n';
import { fontFamilySelect, fontSizeSelect } from '../font-choices';
import { dialogButton } from './shared';
import { openSidePanel } from './side-panel';
import { formField, formSection } from './form-layout';

/**
 * Format > Font…: the selected cells' own font and size. Each list starts
 * with the sheet's own (no font or size of the cell's own); Apply sets both,
 * and Use Sheet Font clears both. Resolves null when cancelled.
 */
export function chooseFont(
  current: FontDialogResult,
  onApply?: ApplyHandler<FontDialogResult>,
): Promise<FontDialogResult | null> {
  return openSidePanel<FontDialogResult | null>(
    { title: t('dialog.font.title'), icon: Type, fallback: null, onApply },
    (body, buttons, apply) => {
      const choice: FontDialogResult = { ...current };
      const family = fontFamilySelect(current.fontFamily, (value) => (choice.fontFamily = value), {
        id: 'format-font-family',
        'data-autofocus': 'true',
      });
      const size = fontSizeSelect(current.fontSize, (value) => (choice.fontSize = value), {
        id: 'format-font-size',
      });
      body.append(
        formSection(null, [
          formField(t('dialog.font.family'), family, t('dialog.font.hint')),
          formField(t('dialog.font.size'), size),
        ]),
      );
      buttons.append(
        dialogButton(t('dialog.font.clear'), false, false, () => apply({ fontFamily: null, fontSize: null })),
        dialogButton(t('dialog.font.apply'), true, false, () => apply({ ...choice })),
      );
    },
  );
}
