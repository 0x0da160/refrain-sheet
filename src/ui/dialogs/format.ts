// SPDX-License-Identifier: MIT
import type {
  ApplyHandler,
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
import { Hash, PaintBucket, Palette, Sparkles, Table, type IconNode } from 'lucide';
import { el } from '../dom';
import {
  CF_DEFAULT_BACKGROUND,
  CF_DEFAULT_SCALE_MAX_COLOR,
  CF_DEFAULT_SCALE_MIN_COLOR,
  CF_DEFAULT_TEXT,
  ensureSwatchList,
} from '../document-colors';
import { dialogButton, openSidePanel, panelCheck, panelField, panelSection, submitOnEnter } from './shared';

const DEFAULT_COLOR = '#000000';

const CF_OPERATORS: readonly CellValueOperator[] = [
  'greaterThan',
  'lessThan',
  'between',
  'equal',
  'textContains',
];
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
    attrs: {
      type: 'color',
      id: `${idPrefix}-bg-color`,
      value: initial.backgroundColor ?? CF_DEFAULT_BACKGROUND,
      list: ensureSwatchList(),
    },
  }) as HTMLInputElement;
  const textCheckbox = el('input', {
    attrs: { type: 'checkbox', id: `${idPrefix}-text-enable` },
  }) as HTMLInputElement;
  textCheckbox.checked = initial.textColor !== undefined;
  const textInput = el('input', {
    attrs: {
      type: 'color',
      id: `${idPrefix}-text-color`,
      value: initial.textColor ?? DEFAULT_COLOR,
      list: ensureSwatchList(),
    },
  }) as HTMLInputElement;
  for (const control of [bgCheckbox, bgInput, textCheckbox, textInput]) {
    control.addEventListener('change', onChange);
  }
  const row = el('div', { className: 'panel-stack' }, [
    colorToggleRow(bgCheckbox, t('dialog.conditionalFormat.backgroundColor'), bgInput),
    colorToggleRow(textCheckbox, t('dialog.conditionalFormat.textColor'), textInput),
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

/**
 * One optional color: a checkbox + label on the left enabling it, and its
 * swatch on the right, lined up with every other such row in the panel.
 */
function colorToggleRow(checkbox: HTMLInputElement, label: string, swatch: HTMLInputElement): HTMLElement {
  swatch.classList.add('panel-swatch');
  return el('div', { className: 'panel-row panel-row-spread' }, [panelCheck(checkbox, label), swatch]);
}

/**
 * A native color picker styled as the panels' shared fixed-size swatch,
 * suggesting the design system's document colours (see document-colors.ts).
 */
function colorSwatch(id: string, value: string): HTMLInputElement {
  return el('input', {
    className: 'panel-swatch',
    attrs: { type: 'color', id, value, list: ensureSwatchList() },
  }) as HTMLInputElement;
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
  private chooseColor(
    title: string,
    icon: IconNode,
    current: string | null,
    onApply?: ApplyHandler<ColorDialogResult>,
  ): Promise<ColorDialogResult | null> {
    return openSidePanel<ColorDialogResult | null>(
      { title, icon, fallback: null, onApply },
      (body, buttons, apply) => {
        const input = colorSwatch('format-color-input', current ?? DEFAULT_COLOR);
        input.dataset.autofocus = 'true';
        body.append(panelSection(null, [panelField(t('dialog.color.label'), input)]));
        buttons.append(
          dialogButton(t('dialog.color.clear'), false, false, () => apply({ action: 'clear' })),
          dialogButton(t('dialog.color.apply'), true, false, () =>
            apply({ action: 'apply', color: input.value.toLowerCase() }),
          ),
        );
      },
    );
  }

  chooseTextColor(
    current: string | null,
    onApply?: ApplyHandler<ColorDialogResult>,
  ): Promise<ColorDialogResult | null> {
    return this.chooseColor(t('dialog.color.title.text'), Palette, current, onApply);
  }

  chooseBackgroundColor(
    current: string | null,
    onApply?: ApplyHandler<ColorDialogResult>,
  ): Promise<ColorDialogResult | null> {
    return this.chooseColor(t('dialog.color.title.background'), PaintBucket, current, onApply);
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
    onApply?: ApplyHandler<BordersDialogResult>,
  ): Promise<BordersDialogResult | null> {
    return openSidePanel<BordersDialogResult | null>(
      {
        title: t('dialog.borders.title'),
        icon: Table,
        fallback: null,
        onApply,
      },
      (body, buttons, apply) => {
        const colorId = 'format-borders-color';
        const lineStyleId = 'format-borders-line-style';
        const widthId = 'format-borders-width';
        const initialColor = BORDER_SIDES.map((side) => current[side]).find(
          (c): c is string => c !== undefined,
        );
        const colorInput = colorSwatch(colorId, initialColor ?? DEFAULT_COLOR);
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
        // A spatial cross layout (top/left/right/bottom checkboxes arranged in
        // the same positions as the edges they control, "All" in the center)
        // plus an "All" toggle that checks/unchecks every side at once and
        // stays in sync when the individual checkboxes are (#393).
        const SIDE_POSITION_CLASS: Record<BorderSide, string> = {
          borderTop: 'format-borders-top',
          borderRight: 'format-borders-right',
          borderBottom: 'format-borders-bottom',
          borderLeft: 'format-borders-left',
        };
        const checkboxes = new Map<BorderSide, HTMLInputElement>();
        const allCheckboxId = 'format-border-all';
        const allCheckbox = el('input', {
          attrs: { type: 'checkbox', id: allCheckboxId, 'data-autofocus': 'true' },
        }) as HTMLInputElement;
        const grid = el('div', { className: 'format-borders-cross' });
        BORDER_SIDES.forEach((side) => {
          const checkboxId = `format-border-${side}`;
          const checkbox = el('input', {
            attrs: { type: 'checkbox', id: checkboxId },
          }) as HTMLInputElement;
          checkbox.checked = current[side] !== undefined;
          checkboxes.set(side, checkbox);
          checkbox.addEventListener('change', syncAllCheckbox);
          grid.append(
            el('div', { className: `format-borders-cell ${SIDE_POSITION_CLASS[side]}` }, [
              checkbox,
              el('label', { text: t(BORDER_SIDE_LABEL_KEY[side]), attrs: { for: checkboxId } }),
            ]),
          );
        });
        grid.append(
          el('div', { className: 'format-borders-cell format-borders-all' }, [
            allCheckbox,
            el('label', { text: t('dialog.borders.all'), attrs: { for: allCheckboxId } }),
          ]),
        );
        function syncAllCheckbox(): void {
          const checkedCount = [...checkboxes.values()].filter((cb) => cb.checked).length;
          allCheckbox.checked = checkedCount === checkboxes.size;
          allCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.size;
        }
        allCheckbox.addEventListener('change', () => {
          allCheckbox.indeterminate = false;
          for (const checkbox of checkboxes.values()) {
            checkbox.checked = allCheckbox.checked;
          }
        });
        syncAllCheckbox();
        body.append(
          panelSection(null, [grid]),
          panelSection(null, [
            el('div', { className: 'panel-grid' }, [
              panelField(t('dialog.borders.color'), colorInput),
              panelField(t('dialog.borders.style'), lineStyleSelect),
              panelField(t('dialog.borders.width'), widthSelect),
            ]),
          ]),
        );
        buttons.append(
          dialogButton(t('dialog.borders.apply'), true, false, () => {
            const color = isHexColor(colorInput.value) ? colorInput.value.toLowerCase() : DEFAULT_COLOR;
            const sides: Partial<Record<BorderSide, string | null>> = {};
            for (const [side, checkbox] of checkboxes) {
              sides[side] = checkbox.checked ? color : null;
            }
            apply({
              action: 'apply',
              sides,
              lineStyle: lineStyleSelect.value as BorderLineStyle,
              width: widthSelect.value as BorderWidth,
            });
          }),
        );
      },
    );
  }

  /**
   * Choose a cell's numeric display format: kind (number/percent/currency),
   * decimal places, thousands separator, and — for currency — a symbol.
   * `current` preselects every field from the top-left selected cell's
   * existing format (falls back to a 2-decimal Number when there is none).
   * "Clear" removes the format ("General"); resolves null when cancelled,
   * leaving the format untouched.
   */
  chooseNumberFormat(
    current: NumberFormat | null,
    onApply?: ApplyHandler<NumberFormatDialogResult>,
  ): Promise<NumberFormatDialogResult | null> {
    return openSidePanel<NumberFormatDialogResult | null>(
      {
        title: t('dialog.numberFormat.title'),
        icon: Hash,
        fallback: null,
        onApply,
      },
      (body, buttons, apply) => {
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
          panelSection(null, [
            el('div', { className: 'panel-grid' }, [
              panelField(t('dialog.numberFormat.kind'), kindSelect),
              panelField(t('dialog.numberFormat.decimals'), decimalsInput),
            ]),
            panelCheck(thousandsInput, t('dialog.numberFormat.thousands')),
            panelField(t('dialog.numberFormat.currencySymbol'), symbolInput),
          ]),
        );
        const submit = (): void => {
          const decimals = Number.parseInt(decimalsInput.value, 10);
          apply({
            action: 'apply',
            format: normalizeNumberFormat({
              kind: kindSelect.value as NumberFormatKind,
              decimals: Number.isFinite(decimals) ? decimals : 0,
              thousands: thousandsInput.checked,
              currencySymbol: symbolInput.value,
            }),
          });
        };
        submitOnEnter(decimalsInput, submit);
        submitOnEnter(symbolInput, submit);

        buttons.append(
          dialogButton(t('dialog.numberFormat.clear'), false, false, () => apply({ action: 'clear' })),
          dialogButton(t('dialog.numberFormat.apply'), true, false, submit),
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
  chooseConditionalFormat(
    input: ConditionalFormatDialogInput,
    onApply?: ApplyHandler<ConditionalFormatDialogResult>,
  ): Promise<ConditionalFormatDialogResult | null> {
    return openSidePanel<ConditionalFormatDialogResult | null>(
      {
        title: t('dialog.conditionalFormat.title'),
        icon: Sparkles,
        fallback: null,
        onApply,
      },
      (body, buttons, apply) => {
        body.append(
          el('p', {
            className: 'panel-lead',
            text: t('dialog.conditionalFormat.range', { range: input.rangeLabel }),
          }),
        );

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
          panelSection(null, [
            el('div', { className: 'panel-choices', attrs: { role: 'radiogroup' } }, [
              panelCheck(kindCellValue, t('dialog.conditionalFormat.kindCellValue')),
              panelCheck(kindDuplicate, t('dialog.conditionalFormat.kindDuplicate')),
              panelCheck(kindColorScale, t('dialog.conditionalFormat.kindColorScale')),
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
        const value2Row = panelField(t('dialog.conditionalFormat.value2'), value2Input);
        const cellValueStyle = styleFields(
          'cf-cellvalue',
          existingCellValue?.style ?? { backgroundColor: CF_DEFAULT_BACKGROUND, textColor: CF_DEFAULT_TEXT },
          refresh,
        );
        const cellValueSection = panelSection(null, [
          panelField(t('dialog.conditionalFormat.operator'), operatorSelect),
          el('div', { className: 'panel-grid' }, [
            panelField(t('dialog.conditionalFormat.value1'), value1Input),
            value2Row,
          ]),
          cellValueStyle.row,
        ]);
        body.append(cellValueSection);

        // ----- Duplicate values section -----
        const existingDuplicateStyle =
          input.existing?.kind === 'duplicate'
            ? input.existing.style
            : { backgroundColor: CF_DEFAULT_BACKGROUND, textColor: CF_DEFAULT_TEXT };
        const duplicateStyle = styleFields('cf-duplicate', existingDuplicateStyle, refresh);
        const duplicateSection = panelSection(null, [duplicateStyle.row]);
        body.append(duplicateSection);

        // ----- Color scale section -----
        const existingColorScale = input.existing?.kind === 'colorScale' ? input.existing : null;
        const minColorInput = colorSwatch(
          'cf-min-color',
          existingColorScale?.minColor ?? CF_DEFAULT_SCALE_MIN_COLOR,
        );
        const maxColorInput = colorSwatch(
          'cf-max-color',
          existingColorScale?.maxColor ?? CF_DEFAULT_SCALE_MAX_COLOR,
        );
        const colorScaleSection = panelSection(null, [
          el('div', { className: 'panel-grid' }, [
            panelField(t('dialog.conditionalFormat.minColor'), minColorInput),
            panelField(t('dialog.conditionalFormat.maxColor'), maxColorInput),
          ]),
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
            if (value1Input.value.trim() === '' || !Number.isFinite(Number(value1Input.value))) {
              return null;
            }
            if (
              operator === 'between' &&
              (value2Input.value.trim() === '' || !Number.isFinite(Number(value2Input.value)))
            ) {
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

        const submit = (): void => {
          const rule = buildRule();
          if (rule) {
            apply({ action: 'apply', rule });
          }
        };
        const applyBtn = dialogButton(t('dialog.conditionalFormat.apply'), true, false, submit);
        submitOnEnter(value1Input, submit);
        submitOnEnter(value2Input, submit);

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
          dialogButton(t('dialog.conditionalFormat.clear'), false, false, () => apply({ action: 'clear' })),
          applyBtn,
        );
      },
    );
  }
}
