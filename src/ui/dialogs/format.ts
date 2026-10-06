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
} from '../../core/workbook/cell-style';
import type {
  CellValueOperator,
  ConditionalFormatRule,
  ConditionalFormatStyle,
} from '../../core/workbook/conditional-format';
import { Hash, PaintBucket, Palette, Sparkles, Table, type IconNode } from 'lucide';
import { el } from '../dom';
import { openAnchoredPopover, takeInvokerPlacement } from '../anchored-popover';
import { buildColorPicker, colorField } from '../color-picker';
import { installTooltips } from '../tooltip';
import { BORDER_PRESETS, type BorderPreset } from '../../core/workbook/border-presets';
import {
  CF_DEFAULT_BACKGROUND,
  CF_DEFAULT_SCALE_MAX_COLOR,
  CF_DEFAULT_SCALE_MIN_COLOR,
  CF_DEFAULT_TEXT,
} from '../document-colors';
import { dialogButton, submitOnEnter } from './shared';
import { formCheck, formField, formSection, formGrid } from './form-layout';
import { openSidePanel } from './side-panel';

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
  const bgInput = colorField(
    `${idPrefix}-bg-color`,
    initial.backgroundColor ?? CF_DEFAULT_BACKGROUND,
    t('dialog.conditionalFormat.backgroundColor'),
  );
  const textCheckbox = el('input', {
    attrs: { type: 'checkbox', id: `${idPrefix}-text-enable` },
  }) as HTMLInputElement;
  textCheckbox.checked = initial.textColor !== undefined;
  const textInput = colorField(
    `${idPrefix}-text-color`,
    initial.textColor ?? DEFAULT_COLOR,
    t('dialog.conditionalFormat.textColor'),
  );
  for (const control of [bgCheckbox, bgInput, textCheckbox, textInput]) {
    control.addEventListener('change', onChange);
  }
  const row = el('div', { className: 'form-stack' }, [
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
function colorToggleRow(checkbox: HTMLInputElement, label: string, swatch: HTMLButtonElement): HTMLElement {
  return el('div', { className: 'form-inline form-inline-spread' }, [formCheck(checkbox, label), swatch]);
}

const BORDER_PRESET_LABEL_KEY: Record<BorderPreset, string> = {
  all: 'dialog.borders.preset.all',
  outside: 'dialog.borders.preset.outside',
  inside: 'dialog.borders.preset.inside',
  top: 'dialog.borders.preset.top',
  bottom: 'dialog.borders.preset.bottom',
  left: 'dialog.borders.preset.left',
  right: 'dialog.borders.preset.right',
  none: 'dialog.borders.preset.none',
};

/** The lines of a 2×2 block of cells, as [x1, y1, x2, y2] on a 16px square. */
const PRESET_ICON_LINES: Record<'top' | 'bottom' | 'left' | 'right' | 'midH' | 'midV', number[]> = {
  top: [2, 2, 14, 2],
  bottom: [2, 14, 14, 14],
  left: [2, 2, 2, 14],
  right: [14, 2, 14, 14],
  midH: [2, 8, 14, 8],
  midV: [8, 2, 8, 14],
};

const PRESET_ICON_DRAWN: Record<BorderPreset, Array<keyof typeof PRESET_ICON_LINES>> = {
  all: ['top', 'bottom', 'left', 'right', 'midH', 'midV'],
  outside: ['top', 'bottom', 'left', 'right'],
  inside: ['midH', 'midV'],
  top: ['top'],
  bottom: ['bottom'],
  left: ['left'],
  right: ['right'],
  none: [],
};

/**
 * A preset's icon: a 2×2 block of cells whose every line is shown faint and
 * dotted, with the lines the preset draws solid on top.
 */
function borderPresetIcon(preset: BorderPreset): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('format-borders-preset-icon');
  const drawn = new Set(PRESET_ICON_DRAWN[preset]);
  for (const [name, [x1, y1, x2, y2]] of Object.entries(PRESET_ICON_LINES)) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.classList.add(drawn.has(name as keyof typeof PRESET_ICON_LINES) ? 'drawn' : 'faint');
    svg.append(line);
  }
  return svg;
}

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
   * Text Color and Background Color: the shared color picker (see
   * color-picker.ts). Chosen from the toolbar or the right-click menu it opens
   * as a popover beside the control, and closes once a color is picked;
   * otherwise it opens in the side panel, which stays open. Either way a pick
   * is applied at once, and "No color" removes the color. `current`
   * preselects the selection's color.
   */
  private chooseColor(
    title: string,
    icon: IconNode,
    current: string | null,
    onApply?: ApplyHandler<ColorDialogResult>,
  ): Promise<ColorDialogResult | null> {
    const resultOf = (color: string | null): ColorDialogResult =>
      color === null ? { action: 'clear' } : { action: 'apply', color };
    const placement = takeInvokerPlacement();
    if (placement && onApply) {
      return openAnchoredPopover({
        placement,
        label: title,
        className: 'color-popover',
        build: (root, close) => {
          root.append(
            el('div', { className: 'anchored-popover-title', text: title }),
            buildColorPicker({
              current,
              noneLabel: t('colorPicker.none'),
              onPick: (color) => {
                close();
                void onApply(resultOf(color));
              },
            }),
          );
        },
      }).then(() => null);
    }
    return openSidePanel<ColorDialogResult | null>(
      { title, icon, fallback: null, onApply },
      (body, _buttons, apply) => {
        let chosen = current;
        const draw = (): void => {
          const picker = buildColorPicker({
            current: chosen,
            noneLabel: t('colorPicker.none'),
            onPick: (color) => {
              chosen = color;
              apply(resultOf(color));
              draw();
            },
          });
          picker.id = 'format-color-picker';
          section.replaceChildren(picker);
        };
        const section = formSection(null, []);
        body.append(section);
        draw();
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
   * Borders: a row of presets (all lines, outline, inside lines, one edge,
   * none) drawn across the selection as soon as one is pressed, with the
   * line's color, style and width chosen first. `current`/`currentLineStyle`/
   * `currentWidth` preselect the line from the selection's existing borders.
   * Opens as a popover beside the toolbar button or right-click menu that
   * chose it, else in the side panel; both stay open so presets combine
   * (outline, then inside lines).
   */
  chooseBorders(
    current: Partial<Record<BorderSide, string>>,
    currentLineStyle: BorderLineStyle | null,
    currentWidth: BorderWidth | null,
    onApply?: ApplyHandler<BordersDialogResult>,
  ): Promise<BordersDialogResult | null> {
    const initialColor = BORDER_SIDES.map((side) => current[side]).find((c): c is string => c !== undefined);
    const build = (container: HTMLElement, apply: (result: BordersDialogResult) => void): void => {
      const colorInput = colorField(
        'format-borders-color',
        initialColor ?? DEFAULT_COLOR,
        t('dialog.borders.color'),
      );
      const lineStyleSelect = el('select', {
        attrs: { id: 'format-borders-line-style' },
      }) as HTMLSelectElement;
      for (const lineStyle of BORDER_LINE_STYLES) {
        const option = el('option', {
          text: t(BORDER_LINE_STYLE_LABEL_KEY[lineStyle]),
          attrs: { value: lineStyle },
        }) as HTMLOptionElement;
        option.selected = lineStyle === (currentLineStyle ?? DEFAULT_BORDER_LINE_STYLE);
        lineStyleSelect.append(option);
      }
      const widthSelect = el('select', { attrs: { id: 'format-borders-width' } }) as HTMLSelectElement;
      for (const width of BORDER_WIDTHS) {
        const option = el('option', {
          text: t(BORDER_WIDTH_LABEL_KEY[width]),
          attrs: { value: width },
        }) as HTMLOptionElement;
        option.selected = width === (currentWidth ?? DEFAULT_BORDER_WIDTH);
        widthSelect.append(option);
      }
      const presets = el(
        'div',
        {
          className: 'format-borders-presets',
          attrs: { role: 'group', 'aria-label': t('dialog.borders.presets') },
        },
        BORDER_PRESETS.map((preset) => {
          const label = t(BORDER_PRESET_LABEL_KEY[preset]);
          const button = el('button', {
            className: 'format-borders-preset',
            attrs: {
              type: 'button',
              id: `format-borders-preset-${preset}`,
              'aria-label': label,
              'data-tooltip': label,
            },
          });
          button.append(borderPresetIcon(preset));
          button.addEventListener('click', () =>
            apply({
              action: 'preset',
              preset,
              color: isHexColor(colorInput.value) ? colorInput.value.toLowerCase() : DEFAULT_COLOR,
              lineStyle: lineStyleSelect.value as BorderLineStyle,
              width: widthSelect.value as BorderWidth,
            }),
          );
          return button;
        }),
      );
      container.append(
        presets,
        el('div', { className: 'format-borders-line' }, [
          formField(t('dialog.borders.color'), colorInput),
          formField(t('dialog.borders.style'), lineStyleSelect),
          formField(t('dialog.borders.width'), widthSelect),
        ]),
        el('p', { className: 'dialog-note', text: t('dialog.borders.note') }),
      );
    };
    const placement = takeInvokerPlacement();
    if (placement && onApply) {
      return openAnchoredPopover({
        placement,
        label: t('dialog.borders.title'),
        className: 'borders-popover',
        build: (root) => {
          root.append(el('div', { className: 'anchored-popover-title', text: t('dialog.borders.title') }));
          installTooltips(root);
          build(root, (result) => void onApply(result));
        },
      }).then(() => null);
    }
    return openSidePanel<BordersDialogResult | null>(
      { title: t('dialog.borders.title'), icon: Table, fallback: null, onApply },
      (body, _buttons, apply) => {
        const section = formSection(null, []);
        installTooltips(section);
        build(section, apply);
        body.append(section);
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
          formSection(null, [
            formGrid([
              formField(t('dialog.numberFormat.kind'), kindSelect),
              formField(t('dialog.numberFormat.decimals'), decimalsInput),
            ]),
            formCheck(thousandsInput, t('dialog.numberFormat.thousands')),
            formField(t('dialog.numberFormat.currencySymbol'), symbolInput),
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
            className: 'form-lead',
            text: t('dialog.conditionalFormat.range', { range: input.rangeLabel }),
          }),
        );

        const { kindCellValue, kindDuplicate, kindColorScale } = ruleKindChoices(
          body,
          input.existing?.kind ?? 'cellValue',
        );

        // ----- Cell value section -----
        const existingCellValue = input.existing?.kind === 'cellValue' ? input.existing : null;
        const operatorSelect = cellValueOperatorSelect(existingCellValue?.operator ?? 'greaterThan');
        const value1Input = el('input', {
          attrs: { type: 'text', id: 'cf-value1' },
        }) as HTMLInputElement;
        value1Input.value = existingCellValue?.value1 ?? '';
        const value2Input = el('input', {
          attrs: { type: 'text', id: 'cf-value2' },
        }) as HTMLInputElement;
        value2Input.value = existingCellValue?.value2 ?? '';
        const value2Row = formField(t('dialog.conditionalFormat.value2'), value2Input);
        const cellValueStyle = styleFields(
          'cf-cellvalue',
          existingCellValue?.style ?? { backgroundColor: CF_DEFAULT_BACKGROUND, textColor: CF_DEFAULT_TEXT },
          refresh,
        );
        const cellValueSection = formSection(null, [
          formField(t('dialog.conditionalFormat.operator'), operatorSelect),
          formGrid([formField(t('dialog.conditionalFormat.value1'), value1Input), value2Row]),
          cellValueStyle.row,
        ]);
        body.append(cellValueSection);

        // ----- Duplicate values section -----
        const existingDuplicateStyle =
          input.existing?.kind === 'duplicate'
            ? input.existing.style
            : { backgroundColor: CF_DEFAULT_BACKGROUND, textColor: CF_DEFAULT_TEXT };
        const duplicateStyle = styleFields('cf-duplicate', existingDuplicateStyle, refresh);
        const duplicateSection = formSection(null, [duplicateStyle.row]);
        body.append(duplicateSection);

        // ----- Color scale section -----
        const existingColorScale = input.existing?.kind === 'colorScale' ? input.existing : null;
        const { minColorInput, maxColorInput, colorScaleSection } = colorScaleFields(
          existingColorScale?.minColor ?? CF_DEFAULT_SCALE_MIN_COLOR,
          existingColorScale?.maxColor ?? CF_DEFAULT_SCALE_MAX_COLOR,
        );
        body.append(colorScaleSection);

        const error = el('p', {
          className: 'dialog-error',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        body.append(error);

        const buildRule = (): ConditionalFormatRule | null => {
          if (kindCellValue.checked) {
            return cellValueRule(
              operatorSelect.value as CellValueOperator,
              value1Input.value,
              value2Input.value,
              cellValueStyle.read(),
            );
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

/** The cell-value rule's operator picker, preselecting `selected`. */
function cellValueOperatorSelect(selected: CellValueOperator): HTMLSelectElement {
  const select = el('select', { attrs: { id: 'cf-operator' } }) as HTMLSelectElement;
  for (const op of CF_OPERATORS) {
    const option = el('option', {
      text: t(CF_OPERATOR_LABEL_KEY[op]),
      attrs: { value: op },
    }) as HTMLOptionElement;
    option.selected = op === selected;
    select.append(option);
  }
  return select;
}

/**
 * A cell-value rule from the dialog's fields, or null when it is incomplete:
 * no style, an empty "contains" text, or a non-numeric comparison value.
 */
function cellValueRule(
  operator: CellValueOperator,
  value1: string,
  value2: string,
  style: ConditionalFormatStyle,
): ConditionalFormatRule | null {
  if (style.backgroundColor === undefined && style.textColor === undefined) {
    return null;
  }
  if (operator === 'textContains') {
    return value1.trim() === '' ? null : { kind: 'cellValue', operator, value1, style };
  }
  const numeric = (text: string): boolean => text.trim() !== '' && Number.isFinite(Number(text));
  if (!numeric(value1) || (operator === 'between' && !numeric(value2))) {
    return null;
  }
  return { kind: 'cellValue', operator, value1, ...(operator === 'between' ? { value2 } : {}), style };
}

/** The rule-kind radio group (cell value, duplicates, color scale), appended to `body`. */
function ruleKindChoices(
  body: HTMLElement,
  initialKind: ConditionalFormatRule['kind'],
): { kindCellValue: HTMLInputElement; kindDuplicate: HTMLInputElement; kindColorScale: HTMLInputElement } {
  const kindCellValue = el('input', {
    attrs: { type: 'radio', name: 'cf-kind', id: 'cf-kind-cellvalue', 'data-autofocus': 'true' },
  }) as HTMLInputElement;
  const kindDuplicate = el('input', {
    attrs: { type: 'radio', name: 'cf-kind', id: 'cf-kind-duplicate' },
  }) as HTMLInputElement;
  const kindColorScale = el('input', {
    attrs: { type: 'radio', name: 'cf-kind', id: 'cf-kind-colorscale' },
  }) as HTMLInputElement;
  kindCellValue.checked = initialKind === 'cellValue';
  kindDuplicate.checked = initialKind === 'duplicate';
  kindColorScale.checked = initialKind === 'colorScale';
  body.append(
    formSection(null, [
      el('div', { className: 'form-choices', attrs: { role: 'radiogroup' } }, [
        formCheck(kindCellValue, t('dialog.conditionalFormat.kindCellValue')),
        formCheck(kindDuplicate, t('dialog.conditionalFormat.kindDuplicate')),
        formCheck(kindColorScale, t('dialog.conditionalFormat.kindColorScale')),
      ]),
    ]),
  );
  return { kindCellValue, kindDuplicate, kindColorScale };
}

/** The color scale's min/max color swatches and their section. */
function colorScaleFields(
  minColor: string,
  maxColor: string,
): { minColorInput: HTMLButtonElement; maxColorInput: HTMLButtonElement; colorScaleSection: HTMLElement } {
  const minColorInput = colorField('cf-min-color', minColor, t('dialog.conditionalFormat.minColor'));
  const maxColorInput = colorField('cf-max-color', maxColor, t('dialog.conditionalFormat.maxColor'));
  const colorScaleSection = formSection(null, [
    formGrid([
      formField(t('dialog.conditionalFormat.minColor'), minColorInput),
      formField(t('dialog.conditionalFormat.maxColor'), maxColorInput),
    ]),
  ]);
  return { minColorInput, maxColorInput, colorScaleSection };
}
