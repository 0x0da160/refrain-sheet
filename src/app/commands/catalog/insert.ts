// SPDX-License-Identifier: MIT
/** Insert menu: shapes, pictures and charts over the sheet, and the object list and order commands. */
import { MAX_IMAGE_BYTES } from '../../../core/workbook/sheet-images';
import { pickImageFile } from '../../file-access';
import type { ObjectOrder, ShapeKind } from '../objects';
import { withTab, type CommandSpec } from './types';

const shape = (kind: ShapeKind): CommandSpec =>
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
  'insert.image': withTab(
    async (ctx, tab) => {
      const picked = await pickImageFile(ctx.dom, MAX_IMAGE_BYTES);
      if (picked === 'too-large') {
        ctx.parts.objects.refuseTooLarge();
      } else if (picked) {
        await ctx.parts.objects.insertImage(tab, picked);
      }
    },
    (ctx, tab) => ctx.parts.objects.canInsert(tab),
  ),
  'insert.chart': withTab(
    (ctx, tab) => ctx.parts.objects.insertChart(tab),
    (ctx, tab) => ctx.parts.objects.canInsert(tab),
  ),
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
