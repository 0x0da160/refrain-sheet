// SPDX-License-Identifier: MIT
import type { BordersDialogResult, ColorDialogResult } from '../../app/commands';
import { t } from '../../app/i18n';
import { BORDER_SIDES, isHexColor, type BorderSide } from '../../core/cell-style';
import { el } from '../dom';
import { dialogButton, openDialog } from './shared';

const DEFAULT_COLOR = '#000000';

const BORDER_SIDE_LABEL_KEY: Record<BorderSide, string> = {
  borderTop: 'dialog.borders.top',
  borderRight: 'dialog.borders.right',
  borderBottom: 'dialog.borders.bottom',
  borderLeft: 'dialog.borders.left',
};

/**
 * The Text Color / Background Color / Borders dialogs for cell formatting
 * (Format menu). Extracted as a cohesive slice, mirroring `SheetOpsDialogs` —
 * `Dialogs` still implements the same `UiPort` surface, delegating to an
 * instance of this class.
 */
export class FormatDialogs {
  /**
   * A single color picker (native `<input type="color">`, which every target
   * browser supports) used for both Text Color and Background Color. `current`
   * preselects the picker when the whole selection already shares one color;
   * a "Clear color" button removes it instead of choosing one. Resolves null
   * when cancelled.
   */
  private chooseColor(title: string, current: string | null): Promise<ColorDialogResult | null> {
    return openDialog<ColorDialogResult | null>(title, null, (body, buttons, close) => {
      const inputId = 'format-color-input';
      const input = el('input', {
        attrs: { type: 'color', id: inputId, value: current ?? DEFAULT_COLOR, 'data-autofocus': 'true' },
      }) as HTMLInputElement;
      body.append(el('label', { text: t('dialog.color.label'), attrs: { for: inputId } }), input);
      buttons.append(
        dialogButton(t('dialog.color.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.color.clear'), false, false, () => close({ action: 'clear' })),
        dialogButton(t('dialog.color.apply'), true, false, () =>
          close({ action: 'apply', color: input.value.toLowerCase() }),
        ),
      );
    });
  }

  chooseTextColor(current: string | null): Promise<ColorDialogResult | null> {
    return this.chooseColor(t('dialog.color.title.text'), current);
  }

  chooseBackgroundColor(current: string | null): Promise<ColorDialogResult | null> {
    return this.chooseColor(t('dialog.color.title.background'), current);
  }

  /**
   * Choose which of the four sides carry a border and their shared color.
   * `current` reflects the selection's existing borders (the side is
   * preselected when it already has a color; the color input starts at the
   * first one found, or black). Applying sets every checked side to the
   * chosen color and clears every unchecked one; resolves null when
   * cancelled, leaving every border untouched.
   */
  chooseBorders(current: Partial<Record<BorderSide, string>>): Promise<BordersDialogResult | null> {
    return openDialog<BordersDialogResult | null>(t('dialog.borders.title'), null, (body, buttons, close) => {
      const colorId = 'format-borders-color';
      const initialColor = BORDER_SIDES.map((side) => current[side]).find(
        (c): c is string => c !== undefined,
      );
      const colorInput = el('input', {
        attrs: { type: 'color', id: colorId, value: initialColor ?? DEFAULT_COLOR },
      }) as HTMLInputElement;
      const checkboxes = new Map<BorderSide, HTMLInputElement>();
      const list = el('div', { className: 'format-borders-list' });
      BORDER_SIDES.forEach((side, i) => {
        const checkboxId = `format-border-${side}`;
        const checkbox = el('input', {
          attrs: { type: 'checkbox', id: checkboxId, ...(i === 0 ? { 'data-autofocus': 'true' } : {}) },
        }) as HTMLInputElement;
        checkbox.checked = current[side] !== undefined;
        checkboxes.set(side, checkbox);
        list.append(
          el('div', { className: 'format-borders-row' }, [
            checkbox,
            el('label', { text: t(BORDER_SIDE_LABEL_KEY[side]), attrs: { for: checkboxId } }),
          ]),
        );
      });
      body.append(
        list,
        el('label', { text: t('dialog.borders.color'), attrs: { for: colorId } }),
        colorInput,
      );
      buttons.append(
        dialogButton(t('dialog.borders.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.borders.apply'), true, false, () => {
          const color = isHexColor(colorInput.value) ? colorInput.value.toLowerCase() : DEFAULT_COLOR;
          const sides: Partial<Record<BorderSide, string | null>> = {};
          for (const [side, checkbox] of checkboxes) {
            sides[side] = checkbox.checked ? color : null;
          }
          close({ action: 'apply', sides });
        }),
      );
    });
  }
}
