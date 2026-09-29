// SPDX-License-Identifier: MIT
/** Insert menu: shapes over the sheet, and the object list and order commands. */
import type { SheetObjectKind } from '../../../core/workbook/sheet-objects';
import type { ObjectOrder } from '../objects';
import { withTab, type CommandSpec } from './types';

const shape = (kind: SheetObjectKind): CommandSpec =>
  withTab(
    (ctx, tab) => ctx.parts.objects.insert(tab, kind),
    (ctx, tab) => ctx.parts.objects.canInsert(tab),
  );

const order = (to: ObjectOrder): CommandSpec =>
  withTab(
    (ctx, tab) => ctx.parts.objects.order(tab, to),
    (ctx, tab) => ctx.parts.objects.canOrder(tab, to),
  );

export const INSERT_COMMANDS = {
  'insert.rectangle': shape('rect'),
  'insert.ellipse': shape('ellipse'),
  'insert.line': shape('line'),
  'insert.arrow': shape('arrow'),
  'insert.textBox': shape('text'),
  'insert.objectList': {
    run: (ctx) => {
      ctx.commands.panelActions?.openObjects();
    },
  },
  'object.bringToFront': order('front'),
  'object.bringForward': order('forward'),
  'object.sendBackward': order('backward'),
  'object.sendToBack': order('back'),
  'object.delete': withTab(
    (ctx, tab) => ctx.parts.objects.deleteSelected(tab),
    (ctx, tab) => ctx.state.objectSelection.selected(tab).length > 0,
  ),
} satisfies Record<string, CommandSpec>;
