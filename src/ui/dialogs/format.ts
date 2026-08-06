// SPDX-License-Identifier: MIT
import type {
  BordersDialogResult,
  ColorDialogResult,
  ConditionalFormatDialogInput,
  ConditionalFormatDialogResult,
  NumberFormatDialogResult,
} from '../../app/commands';
import { t } from '../../app/i18n';
import {
  BORDER_LINE_STYLES,
  BORDER_SIDES,
  BORDER_WIDTHS,
  DEFAULT_BORDER_LINE_STYLE,
  DEFAULT_BORDER_WIDTH,
  isHexColor,
  MAX_CURRENCY_SYMBOL_LENGTH,
  MAX_NUMBER_FORMAT_DECIMALS,
  normalizeNumberFormat,
  NUMBER_FORMAT_KINDS,
  type BorderLineStyle,
  type BorderSide,
  type BorderWidth,
  type NumberFormat,
  type NumberFormatKind,
} from '../../core/cell-style';
import type {
  CellValueOperator,
  ConditionalFormatRule,
  ConditionalFormatStyle,
} from '../../core/conditional-format';
import { el } from '../dom';
import { dialogButton, openDialog } from './shared';

const DEFAULT_COLOR = '#000000';

const CF_DEFAULT_BACKGROUND = '#ffc7ce';
const CF_DEFAULT_SCALE_MIN_COLOR = '#ffffff';
const CF_DEFAULT_SCALE_MAX_COLOR = '#63be7b';

const CF_OPERATORS: readonly CellValueOperator[] = ['greaterThan', 'lessThan', 'between', 'equal', 'textContains'];
const CF_OPERATOR_LABEL_KEY: Record<CellValueOperator, string> = {
  greaterThan: 'dialog.conditionalFormat.operator.greaterThan',
  lessThan: 'dialog.conditionalFormat.operator.lessThan',
  between: 'dialog.conditionalFormat.operator.between',
  equal: 'dialog.conditionalFormat.operator.equal',
  textContains: 'dialog.conditionalFormat.operator.textContains',
};

/**
 * The optional background/text color pair every conditional-format rule
 * style carries: a checkbox enables each color independently, mirroring the
 * Borders dialog's per-side checkbox pattern. `onChange` re-runs the
 * caller's live-validation refresh (a style with neither color enabled is
 * incomplete).
 */
function styleFields(
  idPrefix: string,
  initial: ConditionalFormatStyle,
  onChange: () => void,
): { row: HTMLElement; read: () => ConditionalFormatStyle } {
  const bgCheckbox = el('input', {
    attrs: { type: 'checkbox', id: `${idPrefix}-bg-enable` },
  }) as HTMLInputElement;
  bgCheckbox.checked = initial.backgroundColor !== undefined;
  const bgInput = el('input', {
    attrs: { type: 'color', id: `${idPrefix}-bg-color`, value: initial.backgroundColor ?? CF_DEFAULT_BACKGROUND },
  }) as HTMLInputElement;
  const textCheckbox = el('input', {
    attrs: { type: 'checkbox', id: `${idPrefix}-text-enable` },
  }) as HTMLInputElement;
  textCheckbox.checked = initial.textColor !== undefined;
  const textInput = el('input', {
    attrs: { type: 'color', id: `${idPrefix}-text-color`, value: initial.textColor ?? DEFAULT_COLOR },
  }) as HTMLInputElement;
  for (const control of [bgCheckbox, bgInput, textCheckbox, textInput]) {
    control.addEventListener('change', onChange);
  }
  const row = el('div', { className: 'format-borders-list' }, [
    el('div', { className: 'format-borders-row' }, [
      bgCheckbox,
      el('label', { text: t('dialog.conditionalFormat.backgroundColor'), attrs: { for: `${idPrefix}-bg-enable` } }),
      bgInput,
    ]),
    el('div', { className: 'format-borders-row' }, [
      textCheckbox,
      el('label', { text: t('dialog.conditionalFormat.textColor'), attrs: { for: `${idPrefix}-text-enable` } }),
      textInput,
    ]),
  ]);
  return {
    row,
    read: () => {
      const style: ConditionalFormatStyle = {};
      if (bgCheckbox.checked) {
        style.backgroundColor = bgInput.value.toLowerCase();
      }
      if (textCheckbox.checked) {
        style.textColor = textInput.value.toLowerCase();
      }
      return style;
    },
  };
}

const BORDER_SIDE_LABEL_KEY: Record<BorderSide, string> = {
  borderTop: 'dialog.borders.top',
  borderRight: 'dialog.borders.right',
  borderBottom: 'dialog.borders.bottom',
  borderLeft: 'dialog.borders.left',
};

const BORDER_LINE_STYLE_LABEL_KEY: Record<BorderLineStyle, string> = {
  solid: 'dialog.borders.lineStyle.solid',
  dashed: 'dialog.borders.lineStyle.dashed',
  dotted: 'dialog.borders.lineStyle.dotted',
  double: 'dialog.borders.lineStyle.double',
};

const BORDER_WIDTH_LABEL_KEY: Record<BorderWidth, string> = {
  thin: 'dialog.borders.width.thin',
  medium: 'dialog.borders.width.medium',
  thick: 'dialog.borders.width.thick',
};

const NUMBER_FORMAT_KIND_LABEL_KEY: Record<NumberFormatKind, string> = {
  number: 'dialog.numberFormat.kind.number',
  percent: 'dialog.numberFormat.kind.percent',
  currency: 'dialog.numberFormat.kind.currency',
};

/**
 * The Text Color / Background Color / Borders / Number Format dialogs for
 * cell formatting (Format menu). Extracted as a cohesive slice, mirroring
 * `SheetOpsDialogs` — `Dialogs` still implements the same `UiPort` surface,
 * delegating to an instance of this class.
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
   * Choose which of the four sides carry a border, and their shared color,
   * line style, and width. `current`/`currentLineStyle`/`currentWidth`
   * reflect the selection's existing borders (a side is preselected when it
   * already has a color; the color/style/width inputs start at the first
   * side found, or the defaults). Applying sets every checked side to the
   * chosen color/style/width and clears every unchecked one; resolves null
   * when cancelled, leaving every border untouched.
   */
  chooseBorders(
    current: Partial<Record<BorderSide, string>>,
    currentLineStyle: BorderLineStyle | null,
    currentWidth: BorderWidth | null,
  ): Promise<BordersDialogResult | null> {
    return openDialog<BordersDialogResult | null>(t('dialog.borders.title'), null, (body, buttons, close) => {
      const colorId = 'format-borders-color';
      const lineStyleId = 'format-borders-line-style';
      const widthId = 'format-borders-width';
      const initialColor = BORDER_SIDES.map((side) => current[side]).find(
        (c): c is string => c !== undefined,
      );
      const colorInput = el('input', {
        attrs: { type: 'color', id: colorId, value: initialColor ?? DEFAULT_COLOR },
      }) as HTMLInputElement;
      const lineStyleSelect = el('select', { attrs: { id: lineStyleId } }) as HTMLSelectElement;
      for (const lineStyle of BORDER_LINE_STYLES) {
        const option = el('option', {
          text: t(BORDER_LINE_STYLE_LABEL_KEY[lineStyle]),
          attrs: { value: lineStyle },
        }) as HTMLOptionElement;
        option.selected = lineStyle === (currentLineStyle ?? DEFAULT_BORDER_LINE_STYLE);
        lineStyleSelect.append(option);
      }
      const widthSelect = el('select', { attrs: { id: widthId } }) as HTMLSelectElement;
      for (const width of BORDER_WIDTHS) {
        const option = el('option', {
          text: t(BORDER_WIDTH_LABEL_KEY[width]),
          attrs: { value: width },
        }) as HTMLOptionElement;
        option.selected = width === (currentWidth ?? DEFAULT_BORDER_WIDTH);
        widthSelect.append(option);
      }
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
        el('label', { text: t('dialog.borders.style'), attrs: { for: lineStyleId } }),
        lineStyleSelect,
        el('label', { text: t('dialog.borders.width'), attrs: { for: widthId } }),
        widthSelect,
      );
      buttons.append(
        dialogButton(t('dialog.borders.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.borders.apply'), true, false, () => {
          const color = isHexColor(colorInput.value) ? colorInput.value.toLowerCase() : DEFAULT_COLOR;
          const sides: Partial<Record<BorderSide, string | null>> = {};
          for (const [side, checkbox] of checkboxes) {
            sides[side] = checkbox.checked ? color : null;
          }
          close({
            action: 'apply',
            sides,
            lineStyle: lineStyleSelect.value as BorderLineStyle,
            width: widthSelect.value as BorderWidth,
          });
        }),
      );
    });
  }

  /**
   * Choose a cell's numeric display format: kind (number/percent/currency),
   * decimal places, thousands separator, and — for currency — a symbol.
   * `current` preselects every field from the top-left selected cell's
   * existing format (falls back to a 2-decimal Number when there is none).
   * "Clear" removes the format ("General"); resolves null when cancelled,
   * leaving the format untouched.
   */
  chooseNumberFormat(current: NumberFormat | null): Promise<NumberFormatDialogResult | null> {
    return openDialog<NumberFormatDialogResult | null>(
      t('dialog.numberFormat.title'),
      null,
      (body, buttons, close) => {
        const kindId = 'format-number-kind';
        const decimalsId = 'format-number-decimals';
        const thousandsId = 'format-number-thousands';
        const symbolId = 'format-number-symbol';

        const kindSelect = el('select', {
          attrs: { id: kindId, 'data-autofocus': 'true' },
        }) as HTMLSelectElement;
        for (const kind of NUMBER_FORMAT_KINDS) {
          const option = el('option', {
            text: t(NUMBER_FORMAT_KIND_LABEL_KEY[kind]),
            attrs: { value: kind },
          }) as HTMLOptionElement;
          option.selected = kind === (current?.kind ?? 'number');
          kindSelect.append(option);
        }

        const decimalsInput = el('input', {
          attrs: {
            type: 'number',
            id: decimalsId,
            min: '0',
            max: String(MAX_NUMBER_FORMAT_DECIMALS),
            value: String(current?.decimals ?? 2),
          },
        }) as HTMLInputElement;

        const thousandsInput = el('input', {
          attrs: { type: 'checkbox', id: thousandsId },
        }) as HTMLInputElement;
        thousandsInput.checked = current?.thousands ?? false;

        const symbolInput = el('input', {
          attrs: {
            type: 'text',
            id: symbolId,
            maxlength: String(MAX_CURRENCY_SYMBOL_LENGTH),
            value: current?.currencySymbol ?? '$',
          },
        }) as HTMLInputElement;
        const updateSymbolEnabled = (): void => {
          symbolInput.disabled = kindSelect.value !== 'currency';
        };
        kindSelect.addEventListener('change', updateSymbolEnabled);
        updateSymbolEnabled();

        body.append(
          el('label', { text: t('dialog.numberFormat.kind'), attrs: { for: kindId } }),
          kindSelect,
          el('label', { text: t('dialog.numberFormat.decimals'), attrs: { for: decimalsId } }),
          decimalsInput,
          el('div', { className: 'format-borders-row' }, [
            thousandsInput,
            el('label', { text: t('dialog.numberFormat.thousands'), attrs: { for: thousandsId } }),
          ]),
          el('label', { text: t('dialog.numberFormat.currencySymbol'), attrs: { for: symbolId } }),
          symbolInput,
        );
        buttons.append(
          dialogButton(t('dialog.numberFormat.cancel'), false, false, () => close(null)),
          dialogButton(t('dialog.numberFormat.clear'), false, false, () => close({ action: 'clear' })),
          dialogButton(t('dialog.numberFormat.apply'), true, false, () => {
            const decimals = Number.parseInt(decimalsInput.value, 10);
            close({
              action: 'apply',
              format: normalizeNumberFormat({
                kind: kindSelect.value as NumberFormatKind,
                decimals: Number.isFinite(decimals) ? decimals : 0,
                thousands: thousandsInput.checked,
                currencySymbol: symbolInput.value,
              }),
            });
          }),
        );
      },
    );
  }

  /**
   * The accessible conditional-formatting dialog for the selected range: a
   * rule kind (a value comparison, duplicate highlighting, or a two-color
   * scale) and its parameters. Mirrors `SheetOpsDialogs.chooseDataValidation`'s
   * live-validation pattern: the Apply button stays disabled, with an inline
   * explanation, until the current fields describe a usable rule. Resolves
   * with the chosen action, or null when cancelled (nothing changes).
   */
  chooseConditionalFormat(input: ConditionalFormatDialogInput): Promise<ConditionalFormatDialogResult | null> {
    return openDialog<ConditionalFormatDialogResult | null>(
      t('dialog.conditionalFormat.title'),
      null,
      (body, buttons, close) => {
        body.append(el('p', { text: t('dialog.conditionalFormat.range', { range: input.rangeLabel }) }));

        const kindCellValue = el('input', {
          attrs: { type: 'radio', name: 'cf-kind', id: 'cf-kind-cellvalue', 'data-autofocus': 'true' },
        }) as HTMLInputElement;
        const kindDuplicate = el('input', {
          attrs: { type: 'radio', name: 'cf-kind', id: 'cf-kind-duplicate' },
        }) as HTMLInputElement;
        const kindColorScale = el('input', {
          attrs: { type: 'radio', name: 'cf-kind', id: 'cf-kind-colorscale' },
        }) as HTMLInputElement;
        const initialKind = input.existing?.kind ?? 'cellValue';
        kindCellValue.checked = initialKind === 'cellValue';
        kindDuplicate.checked = initialKind === 'duplicate';
        kindColorScale.checked = initialKind === 'colorScale';
        body.append(
          el('div', { className: 'form-row' }, [
            el('label', { attrs: { for: 'cf-kind-cellvalue' } }, [
              kindCellValue,
              el('span', { text: t('dialog.conditionalFormat.kindCellValue') }),
            ]),
            el('label', { attrs: { for: 'cf-kind-duplicate' } }, [
              kindDuplicate,
              el('span', { text: t('dialog.conditionalFormat.kindDuplicate') }),
            ]),
            el('label', { attrs: { for: 'cf-kind-colorscale' } }, [
              kindColorScale,
              el('span', { text: t('dialog.conditionalFormat.kindColorScale') }),
            ]),
          ]),
        );

        // ----- Cell value section -----
        const existingCellValue = input.existing?.kind === 'cellValue' ? input.existing : null;
        const operatorSelect = el('select', { attrs: { id: 'cf-operator' } }) as HTMLSelectElement;
        for (const op of CF_OPERATORS) {
          const option = el('option', {
            text: t(CF_OPERATOR_LABEL_KEY[op]),
            attrs: { value: op },
          }) as HTMLOptionElement;
          option.selected = op === (existingCellValue?.operator ?? 'greaterThan');
          operatorSelect.append(option);
        }
        const value1Input = el('input', {
          attrs: { type: 'text', id: 'cf-value1' },
        }) as HTMLInputElement;
        value1Input.value = existingCellValue?.value1 ?? '';
        const value2Input = el('input', {
          attrs: { type: 'text', id: 'cf-value2' },
        }) as HTMLInputElement;
        value2Input.value = existingCellValue?.value2 ?? '';
        const value2Row = el('div', { className: 'form-row' }, [
          el('label', { text: t('dialog.conditionalFormat.value2'), attrs: { for: 'cf-value2' } }),
          value2Input,
        ]);
        const cellValueStyle = styleFields(
          'cf-cellvalue',
          existingCellValue?.style ?? { backgroundColor: CF_DEFAULT_BACKGROUND },
          refresh,
        );
        const cellValueSection = el('div', { className: 'form-row' }, [
          el('label', { text: t('dialog.conditionalFormat.operator'), attrs: { for: 'cf-operator' } }),
          operatorSelect,
          el('label', { text: t('dialog.conditionalFormat.value1'), attrs: { for: 'cf-value1' } }),
          value1Input,
          value2Row,
          cellValueStyle.row,
        ]);
        body.append(cellValueSection);

        // ----- Duplicate values section -----
        const existingDuplicateStyle =
          input.existing?.kind === 'duplicate' ? input.existing.style : { backgroundColor: CF_DEFAULT_BACKGROUND };
        const duplicateStyle = styleFields('cf-duplicate', existingDuplicateStyle, refresh);
        const duplicateSection = el('div', { className: 'form-row' }, [duplicateStyle.row]);
        body.append(duplicateSection);

        // ----- Color scale section -----
        const existingColorScale = input.existing?.kind === 'colorScale' ? input.existing : null;
        const minColorInput = el('input', {
          attrs: {
            type: 'color',
            id: 'cf-min-color',
            value: existingColorScale?.minColor ?? CF_DEFAULT_SCALE_MIN_COLOR,
          },
        }) as HTMLInputElement;
        const maxColorInput = el('input', {
          attrs: {
            type: 'color',
            id: 'cf-max-color',
            value: existingColorScale?.maxColor ?? CF_DEFAULT_SCALE_MAX_COLOR,
          },
        }) as HTMLInputElement;
        const colorScaleSection = el('div', { className: 'form-row' }, [
          el('label', { text: t('dialog.conditionalFormat.minColor'), attrs: { for: 'cf-min-color' } }),
          minColorInput,
          el('label', { text: t('dialog.conditionalFormat.maxColor'), attrs: { for: 'cf-max-color' } }),
          maxColorInput,
        ]);
        body.append(colorScaleSection);

        const error = el('p', {
          className: 'dialog-error',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        body.append(error);

        const buildRule = (): ConditionalFormatRule | null => {
          if (kindCellValue.checked) {
            const style = cellValueStyle.read();
            if (style.backgroundColor === undefined && style.textColor === undefined) {
              return null;
            }
            const operator = operatorSelect.value as CellValueOperator;
            if (operator === 'textContains') {
              return value1Input.value.trim() === ''
                ? null
                : { kind: 'cellValue', operator, value1: value1Input.value, style };
            }
            if (!Number.isFinite(Number(value1Input.value))) {
              return null;
            }
            if (operator === 'between' && !Number.isFinite(Number(value2Input.value))) {
              return null;
            }
            return {
              kind: 'cellValue',
              operator,
              value1: value1Input.value,
              ...(operator === 'between' ? { value2: value2Input.value } : {}),
              style,
            };
          }
          if (kindDuplicate.checked) {
            const style = duplicateStyle.read();
            return style.backgroundColor === undefined && style.textColor === undefined
              ? null
              : { kind: 'duplicate', style };
          }
          return {
            kind: 'colorScale',
            minColor: minColorInput.value.toLowerCase(),
            maxColor: maxColorInput.value.toLowerCase(),
          };
        };

        const applyBtn = dialogButton(t('dialog.conditionalFormat.apply'), true, false, () => {
          const rule = buildRule();
          if (rule) {
            close({ action: 'apply', rule });
          }
        });

        function refresh(): void {
          cellValueSection.hidden = !kindCellValue.checked;
          duplicateSection.hidden = !kindDuplicate.checked;
          colorScaleSection.hidden = !kindColorScale.checked;
          value2Row.hidden = operatorSelect.value !== 'between';
          const rule = buildRule();
          error.textContent = rule ? '' : t('dialog.conditionalFormat.incomplete');
          applyBtn.disabled = rule === null;
        }
        kindCellValue.addEventListener('change', refresh);
        kindDuplicate.addEventListener('change', refresh);
        kindColorScale.addEventListener('change', refresh);
        operatorSelect.addEventListener('change', refresh);
        value1Input.addEventListener('input', refresh);
        value2Input.addEventListener('input', refresh);
        refresh();

        buttons.append(
          dialogButton(t('dialog.conditionalFormat.cancel'), false, false, () => close(null)),
          dialogButton(t('dialog.conditionalFormat.clear'), false, false, () => close({ action: 'clear' })),
          applyBtn,
        );
      },
    );
  }
}
