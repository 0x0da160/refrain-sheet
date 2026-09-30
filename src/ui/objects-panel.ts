// SPDX-License-Identifier: MIT
import { colorField } from './color-picker';
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Pin, Shapes, type IconNode } from 'lucide';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import type { AppState, Tab } from '../app/state';
import { isWorkbook } from '../core/editor-document';
import { chartData } from '../core/workbook/sheet-charts';
import {
  isLineKind,
  isPositionLocked,
  MAX_OBJECT_LINE_WIDTH,
  MAX_OBJECT_NAME_LENGTH,
  MAX_OBJECT_TEXT_LENGTH,
  MIN_OBJECT_LINE_WIDTH,
  OBJECT_TEXT_ALIGNS,
  OBJECT_TEXT_VALIGNS,
  objectDefaults,
  type ObjectCrop,
  type SheetObject,
} from '../core/workbook/sheet-objects';
import {
  applySidePanelPosition,
  buildSidePanelChrome,
  currentSidePanelPlacement,
  panelCheck,
  panelField,
  panelSection,
  releaseSidePanel,
  type SidePanelChrome,
} from './dialogs/side-panel';
import { clearChildren, el } from './dom';
import { fontSizeSelect } from './font-choices';
import type { Grid } from './grid';
import { createIcon } from './icon';
import { chartSection } from './objects-panel-chart';

type Unit = 'px' | 'mm';
const MM_PER_PX = 25.4 / 96;

/** The optional flags an object carries as `true` or not at all. */
type Flag = 'hidden' | 'lockPosition' | 'lockEdit' | 'bold' | 'italic';

function withFlag(o: SheetObject, key: Flag, on: boolean): SheetObject {
  const next = { ...o };
  if (on) {
    next[key] = true;
  } else {
    delete next[key];
  }
  return next;
}

/** `o` with `key` set to `value`, or left out (the default) when `value` is undefined. */
function withValue<K extends keyof SheetObject>(
  o: SheetObject,
  key: K,
  value: SheetObject[K] | undefined,
): SheetObject {
  const next = { ...o };
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

/**
 * Insert > Object List…: the shapes, pictures and charts on the active sheet, top first, each
 * with show/hide, the two locks (配置を固定 keeps it where it is; 編集をロック
 * also keeps its content and format as they are) and a step up or down the
 * stacking order; and, for the one selected object, its name, position,
 * size, rotation, fill, line and text (a picture: its crop, mirroring and
 * whether it keeps its shape; a chart: its settings, `objects-panel-chart.ts`). A dockable side panel like the
 * comments list, closed only by its ×. Every change is one undoable step
 * through `Commands.updateObjects`, which refuses what a lock forbids.
 */
export class ObjectsPanel {
  readonly element: HTMLElement;
  private readonly chrome: SidePanelChrome;
  private readonly body: HTMLElement;
  private unit: Unit = 'px';
  /** Set while a field's change is applied: the redraw waits (see {@link update}). */
  private deferRender = false;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
    private readonly grid: Grid,
  ) {
    this.element = el('div', {
      className: 'side-panel objects-panel',
      attrs: { role: 'complementary', 'aria-label': t('panel.objects.title') },
    });
    this.chrome = buildSidePanelChrome(this.element, {
      icon: Shapes,
      title: t('panel.objects.title'),
      closeLabel: t('panel.objects.close'),
      onClose: () => this.close(),
    });
    this.body = el('div', { className: 'dialog-body' });
    this.element.append(this.chrome.heading, this.body, this.chrome.resizeHandle);
    this.element.hidden = true;
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    if (!this.isOpen) {
      this.element.hidden = false;
      const { position, size } = currentSidePanelPlacement();
      applySidePanelPosition(this.element, position, size);
    }
    this.render();
  }

  close(): void {
    this.element.hidden = true;
    releaseSidePanel(this.element);
  }

  /** Re-translate the title (locale change) and redraw. */
  refresh(): void {
    this.chrome.relabel(t('panel.objects.title'), t('panel.objects.close'));
    this.element.setAttribute('aria-label', t('panel.objects.title'));
    this.render();
  }

  render(): void {
    if (!this.isOpen) {
      return;
    }
    if (this.deferRender) {
      setTimeout(() => this.render(), 0);
      return;
    }
    // Redrawing replaces every control: keep the keyboard where it was.
    const focused = document.activeElement;
    const focusKey =
      focused instanceof HTMLElement && this.body.contains(focused) ? focused.dataset.focusKey : undefined;
    clearChildren(this.body);
    const tab = this.state.activeTab;
    if (!tab || !isWorkbook(tab.doc) || tab.doc.activeSheet.kind !== 'grid') {
      this.body.append(el('p', { className: 'dialog-note', text: t('panel.objects.unavailable') }));
      return;
    }
    const objects = tab.doc.objects;
    if (objects.length === 0) {
      this.body.append(el('p', { className: 'dialog-note', text: t('panel.objects.empty') }));
      return;
    }
    const selected = this.state.objectSelection.selected(tab);
    this.body.append(panelSection(null, [this.list(tab, objects, selected)]));
    if (selected.length === 1) {
      const object = objects.find((o) => o.id === selected[0]);
      if (object) {
        this.body.append(...this.properties(tab, object));
      }
    } else if (selected.length > 1) {
      this.body.append(
        el('p', { className: 'dialog-note', text: t('panel.objects.many', { n: selected.length }) }),
      );
    }
    if (focusKey) {
      this.body.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
    }
  }

  /**
   * Apply the fields `next` changes from `before` (the object as this panel
   * drew it) to the object as it is now, so a change made from a control
   * drawn before an earlier change still keeps that earlier one. After a
   * field's change the redraw waits for the keyboard to reach the next field
   * (`defer`), so Tab still moves on.
   */
  private update(tab: Tab, before: SheetObject, next: SheetObject, label: string, defer = true): void {
    const current = this.commands.objectsOf(tab).find((x) => x.id === before.id) ?? before;
    const merged: Record<string, unknown> = { ...current };
    const was = before as unknown as Record<string, unknown>;
    const now = next as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (was[key] !== now[key]) {
        if (now[key] === undefined) {
          delete merged[key];
        } else {
          merged[key] = now[key];
        }
      }
    }
    this.deferRender = defer;
    try {
      this.commands.updateObjects(tab, [merged as unknown as SheetObject], label);
    } finally {
      this.deferRender = false;
    }
  }

  // ----- The list -----

  private list(tab: Tab, objects: readonly SheetObject[], selected: readonly string[]): HTMLElement {
    const list = el('ol', { className: 'objects-list', attrs: { 'aria-label': t('panel.objects.list') } });
    // Top of the stack first, like the drawing order seen from above.
    const topFirst = [...objects].reverse();
    for (const [i, o] of topFirst.entries()) {
      const isSelected = selected.includes(o.id);
      const toggle = (
        icon: IconNode,
        labelKey: string,
        key: Flag,
        pressed: boolean,
        on: boolean,
      ): HTMLElement => {
        const button = this.tool(icon, t(labelKey, { name: o.name }), `${o.id}:${key}`, () =>
          this.update(tab, o, withFlag(o, key, on), 'history.objectState', false),
        );
        button.setAttribute('aria-pressed', String(pressed));
        return button;
      };
      const name = el('button', {
        className: 'objects-name',
        text: o.name,
        attrs: { type: 'button', 'aria-pressed': String(isSelected), 'data-focus-key': `${o.id}:name` },
      });
      name.addEventListener('click', (event) => {
        const ids =
          event.ctrlKey || event.metaKey || event.shiftKey
            ? isSelected
              ? selected.filter((id) => id !== o.id)
              : [...selected, o.id]
            : [o.id];
        this.state.objectSelection.select(tab, ids);
      });
      const move = (offset: number): void => {
        const order = topFirst.slice();
        const [item] = order.splice(i, 1);
        order.splice(i + offset, 0, item);
        this.commands.replaceObjects(tab, order.reverse(), 'history.objectOrder');
      };
      const up = this.tool(ArrowUp, t('panel.objects.forward', { name: o.name }), `${o.id}:up`, () =>
        move(-1),
      );
      const down = this.tool(ArrowDown, t('panel.objects.backward', { name: o.name }), `${o.id}:down`, () =>
        move(1),
      );
      (up as HTMLButtonElement).disabled = i === 0;
      (down as HTMLButtonElement).disabled = i === topFirst.length - 1;
      list.append(
        el(
          'li',
          { className: `objects-row${isSelected ? ' selected' : ''}`, attrs: { 'data-object-id': o.id } },
          [
            toggle(o.hidden ? EyeOff : Eye, 'panel.objects.shown', 'hidden', !o.hidden, !o.hidden),
            name,
            toggle(
              Pin,
              'panel.objects.lockPosition',
              'lockPosition',
              o.lockPosition === true,
              !o.lockPosition,
            ),
            toggle(Lock, 'panel.objects.lockEdit', 'lockEdit', o.lockEdit === true, !o.lockEdit),
            up,
            down,
          ],
        ),
      );
    }
    return list;
  }

  private tool(icon: IconNode, label: string, focusKey: string, onClick: () => void): HTMLElement {
    const button = el('button', {
      className: 'objects-tool',
      attrs: { type: 'button', title: label, 'aria-label': label, 'data-focus-key': focusKey },
    });
    button.append(createIcon(icon, 'objects-tool-icon', 14));
    button.addEventListener('click', onClick);
    return button;
  }

  // ----- The selected object's properties -----

  private properties(tab: Tab, o: SheetObject): HTMLElement[] {
    const positionLocked = isPositionLocked(o);
    const editLocked = o.lockEdit === true;
    const name = this.input('text', 'name', o.name, editLocked, (value) => {
      const text = value.trim().slice(0, MAX_OBJECT_NAME_LENGTH);
      if (text !== '') {
        this.update(tab, o, { ...o, name: text }, 'history.editObject');
      }
    });
    name.maxLength = MAX_OBJECT_NAME_LENGTH;
    const sections = [
      panelSection(null, [panelField(t('panel.objects.name'), name)]),
      this.placement(tab, o, positionLocked),
    ];
    const doc = tab.doc;
    if (o.chart && isWorkbook(doc)) {
      sections.push(
        chartSection({
          spec: o.chart,
          data: chartData(doc, o.chart),
          sheets: doc.sheets,
          disabled: editLocked,
          apply: (chart) => this.update(tab, o, { ...o, chart }, 'history.editObject'),
          editData: (rows) => this.commands.objectActions.setChartData(tab, o.id, rows),
          dataToSheet: () => {
            const name = this.commands.objectActions.chartDataToSheet(tab, o.id);
            if (name) this.commands.notify(t('notify.chartDataToSheet', { name }), 'info');
          },
        }),
      );
    } else if (o.kind === 'image') {
      sections.push(this.picture(tab, o, editLocked, positionLocked));
    } else {
      sections.push(this.style(tab, o, editLocked));
    }
    if (!isLineKind(o.kind) && o.kind !== 'image' && o.kind !== 'chart') {
      sections.push(this.textSection(tab, o, editLocked));
    }
    return sections;
  }

  /** Position and size, in pixels at 100% zoom or millimetres, and rotation. */
  private placement(tab: Tab, o: SheetObject, positionLocked: boolean): HTMLElement {
    const unit = el('select', { attrs: { 'data-focus-key': 'unit' } }) as HTMLSelectElement;
    for (const value of ['px', 'mm'] as const) {
      unit.append(el('option', { text: t(`panel.objects.unit.${value}`), attrs: { value } }));
    }
    unit.value = this.unit;
    unit.addEventListener('change', () => {
      this.unit = unit.value === 'mm' ? 'mm' : 'px';
      this.render();
    });
    const toUnit = (px: number): string =>
      this.unit === 'mm' ? String(Math.round(px * MM_PER_PX * 10) / 10) : String(Math.round(px));
    const fromUnit = (text: string): number | null => {
      const value = Number(text);
      if (text.trim() === '' || !Number.isFinite(value) || value < 0) {
        return null;
      }
      return Math.round(this.unit === 'mm' ? value / MM_PER_PX : value);
    };
    const at = this.grid.objectPosition(tab, o);
    const keepsRatio = o.kind === 'image' && o.aspectFree !== true;
    const number = (key: string, px: number, apply: (px: number) => SheetObject): HTMLElement => {
      const input = this.input('number', key, toUnit(px), positionLocked, (value) => {
        const next = fromUnit(value);
        if (next !== null) {
          this.update(tab, o, apply(next), 'history.moveObject');
        }
      });
      input.min = '0';
      input.step = this.unit === 'mm' ? '0.1' : '1';
      return panelField(t(`panel.objects.${key}`), input);
    };
    const rotation = this.input('number', 'rotation', String(o.rotation ?? 0), positionLocked, (value) => {
      const degrees = Number(value);
      if (value.trim() !== '' && Number.isFinite(degrees)) {
        const r = Math.round((((degrees % 360) + 360) % 360) * 10) / 10;
        this.update(
          tab,
          o,
          withValue(o, 'rotation', r === 0 || r === 360 ? undefined : r),
          'history.moveObject',
        );
      }
    });
    rotation.step = '1';
    return panelSection(t('panel.objects.placement'), [
      panelField(t('panel.objects.unit'), unit),
      el('div', { className: 'objects-grid' }, [
        number('x', at.x, (x) => this.grid.objectMovedTo(tab, o, x, at.y)),
        number('y', at.y, (y) => this.grid.objectMovedTo(tab, o, at.x, y)),
        // A picture that keeps its shape follows one side with the other.
        number('width', o.width, (width) =>
          keepsRatio && o.width > 0
            ? { ...o, width, height: Math.round((width * o.height) / o.width) }
            : { ...o, width },
        ),
        number('height', o.height, (height) =>
          keepsRatio && o.height > 0
            ? { ...o, height, width: Math.round((height * o.width) / o.height) }
            : { ...o, height },
        ),
        panelField(t('panel.objects.rotation'), rotation),
      ]),
    ]);
  }

  /**
   * A picture's shape and crop: whether resizing keeps its width-to-height
   * ratio, mirroring, and how much is cut off each side (percent).
   */
  private picture(tab: Tab, o: SheetObject, editLocked: boolean, positionLocked: boolean): HTMLElement {
    const check = (
      key: 'aspectFree' | 'flipH' | 'flipV',
      checked: boolean,
      disabled: boolean,
    ): HTMLElement => {
      const box = el('input', { attrs: { type: 'checkbox', 'data-focus-key': key } }) as HTMLInputElement;
      box.checked = checked;
      box.disabled = disabled;
      box.addEventListener('change', () => {
        const on = key === 'aspectFree' ? !box.checked : box.checked;
        const label = key === 'aspectFree' ? 'history.editObject' : 'history.moveObject';
        this.update(tab, o, withValue(o, key, on ? true : undefined), label);
      });
      return panelCheck(box, t(`panel.objects.${key === 'aspectFree' ? 'keepAspect' : key}`));
    };
    const crop = o.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const side = (key: keyof ObjectCrop): HTMLElement => {
      // Cropping cuts the picture down rather than stretching what is left, so it resizes the box.
      const locked = editLocked || positionLocked;
      const input = this.input('number', `crop:${key}`, String(crop[key]), locked, (value) => {
        const percent = Math.round(Number(value) * 10) / 10;
        const next = { ...crop, [key]: percent };
        if (
          value.trim() === '' ||
          !Number.isFinite(percent) ||
          percent < 0 ||
          next.top + next.bottom >= 100 ||
          next.left + next.right >= 100
        ) {
          return;
        }
        const none = Object.values(next).every((v) => v === 0);
        const across = (100 - next.left - next.right) / (100 - crop.left - crop.right);
        const down = (100 - next.top - next.bottom) / (100 - crop.top - crop.bottom);
        const cropped = {
          ...withValue(o, 'crop', none ? undefined : next),
          width: Math.max(1, Math.round(o.width * across)),
          height: Math.max(1, Math.round(o.height * down)),
        };
        this.update(tab, o, cropped, 'history.editObject');
      });
      input.min = '0';
      input.max = '99';
      input.step = '1';
      return panelField(t(`panel.objects.crop.${key}`), input);
    };
    return panelSection(t('panel.objects.picture'), [
      check('aspectFree', o.aspectFree !== true, editLocked),
      check('flipH', o.flipH === true, positionLocked),
      check('flipV', o.flipV === true, positionLocked),
      el('p', { className: 'dialog-note', text: t('panel.objects.crop') }),
      el('div', { className: 'objects-grid' }, [side('top'), side('bottom'), side('left'), side('right')]),
    ]);
  }

  /** Fill and line. */
  private style(tab: Tab, o: SheetObject, editLocked: boolean): HTMLElement {
    const d = objectDefaults(o.kind);
    const style: HTMLElement[] = [];
    if (!isLineKind(o.kind)) {
      style.push(...this.paint(tab, o, 'fill', o.fill ?? d.fill, editLocked));
    }
    style.push(...this.paint(tab, o, 'stroke', o.stroke ?? d.stroke, editLocked));
    const lineWidth = this.input(
      'number',
      'strokeWidth',
      String(o.strokeWidth ?? d.strokeWidth),
      editLocked,
      (value) => {
        const width = Number(value);
        if (value.trim() !== '' && width >= MIN_OBJECT_LINE_WIDTH && width <= MAX_OBJECT_LINE_WIDTH) {
          this.update(tab, o, { ...o, strokeWidth: width }, 'history.editObject');
        }
      },
    );
    lineWidth.min = String(MIN_OBJECT_LINE_WIDTH);
    lineWidth.max = String(MAX_OBJECT_LINE_WIDTH);
    lineWidth.step = '0.25';
    style.push(panelField(t('panel.objects.strokeWidth'), lineWidth));
    return panelSection(t('panel.objects.style'), style);
  }

  /** The text on a shape or text box. */
  private textSection(tab: Tab, o: SheetObject, editLocked: boolean): HTMLElement {
    const d = objectDefaults(o.kind);
    const text = el('textarea', {
      className: 'objects-text',
      attrs: { rows: '3', 'data-focus-key': 'text', maxlength: String(MAX_OBJECT_TEXT_LENGTH) },
    }) as HTMLTextAreaElement;
    text.value = o.text ?? '';
    text.disabled = editLocked;
    text.addEventListener('change', () =>
      this.update(
        tab,
        o,
        withValue(o, 'text', text.value === '' ? undefined : text.value),
        'history.editObject',
      ),
    );
    const color = this.color(
      'textColor',
      o.textColor ?? '#000000',
      editLocked,
      t('panel.objects.textColor'),
      (value) => this.update(tab, o, { ...o, textColor: value }, 'history.editObject'),
    );
    const size = fontSizeSelect(
      o.fontSize ?? null,
      (points) => this.update(tab, o, withValue(o, 'fontSize', points ?? undefined), 'history.editObject'),
      { 'data-focus-key': 'fontSize' },
    );
    size.disabled = editLocked;
    const check = (key: 'bold' | 'italic'): HTMLElement => {
      const box = el('input', { attrs: { type: 'checkbox', 'data-focus-key': key } }) as HTMLInputElement;
      box.checked = o[key] === true;
      box.disabled = editLocked;
      box.addEventListener('change', () =>
        this.update(tab, o, withFlag(o, key, box.checked), 'history.editObject'),
      );
      return panelCheck(box, t(`panel.objects.${key}`));
    };
    const choice = <T extends string>(
      key: 'align' | 'valign',
      values: readonly T[],
      current: T,
    ): HTMLElement => {
      const select = el('select', { attrs: { 'data-focus-key': key } }) as HTMLSelectElement;
      for (const value of values) {
        select.append(el('option', { text: t(`panel.objects.${key}.${value}`), attrs: { value } }));
      }
      select.value = current;
      select.disabled = editLocked;
      select.addEventListener('change', () =>
        this.update(tab, o, { ...o, [key]: select.value } as SheetObject, 'history.editObject'),
      );
      return panelField(t(`panel.objects.${key}`), select);
    };
    return panelSection(t('panel.objects.text'), [
      panelField(t('panel.objects.textContent'), text),
      el('div', { className: 'objects-grid' }, [
        panelField(t('panel.objects.textColor'), color),
        panelField(t('panel.objects.fontSize'), size),
        choice('align', OBJECT_TEXT_ALIGNS, o.align ?? d.align),
        choice('valign', OBJECT_TEXT_VALIGNS, o.valign ?? d.valign),
      ]),
      check('bold'),
      check('italic'),
    ]);
  }

  /** A colour picker with a "none" box, for the fill or the line. */
  private paint(
    tab: Tab,
    o: SheetObject,
    key: 'fill' | 'stroke',
    value: string,
    disabled: boolean,
  ): HTMLElement[] {
    const none = el('input', {
      attrs: { type: 'checkbox', 'data-focus-key': `${key}:none` },
    }) as HTMLInputElement;
    none.checked = value === 'none';
    none.disabled = disabled;
    const color = this.color(
      key,
      value === 'none' ? '#ffffff' : value,
      disabled || value === 'none',
      t(`panel.objects.${key}`),
      (next) => this.update(tab, o, { ...o, [key]: next }, 'history.editObject'),
    );
    none.addEventListener('change', () =>
      this.update(
        tab,
        o,
        { ...o, [key]: none.checked ? 'none' : color.value.toLowerCase() },
        'history.editObject',
      ),
    );
    return [panelField(t(`panel.objects.${key}`), color), panelCheck(none, t(`panel.objects.${key}.none`))];
  }

  /** A color field (the shared picker) that reports each pick. */
  private color(
    key: string,
    value: string,
    disabled: boolean,
    label: string,
    onChange: (value: string) => void,
  ): HTMLButtonElement {
    const field = colorField(null, value, label);
    field.dataset.focusKey = key;
    field.disabled = disabled;
    field.addEventListener('change', () => onChange(field.value.toLowerCase()));
    return field;
  }

  private input(
    type: string,
    key: string,
    value: string,
    disabled: boolean,
    onChange: (value: string) => void,
  ): HTMLInputElement {
    const input = el('input', { attrs: { type, 'data-focus-key': key } }) as HTMLInputElement;
    input.value = value;
    input.disabled = disabled;
    input.addEventListener('change', () => onChange(input.value));
    return input;
  }
}
