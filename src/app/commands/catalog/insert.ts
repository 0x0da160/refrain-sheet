// SPDX-License-Identifier: MIT
/** Insert menu: shapes, pictures and charts over the sheet, and the object list and order commands. */
import { MAX_IMAGE_BYTES } from '../../../core/workbook/sheet-images';
import { pickImageFile } from '../../file-access';
import { ARRANGEMENTS, type Arrangement } from '../../../core/workbook/object-arrange';
import type { ObjectOrder, ShapeKind } from '../objects';
import { exportableObjects, exportObjectImage, type ObjectImageFormat } from '../object-export';
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

const arrange = (how: Arrangement): CommandSpec =>
  withTab(
    (ctx, tab) => {
      const geometry = ctx.commands.objectGeometry;
      if (geometry) ctx.parts.objects.arrange(tab, how, geometry);
    },
    (ctx, tab) => ctx.parts.objects.canArrange(tab, how),
  );

const saveImage = (format: ObjectImageFormat): CommandSpec =>
  withTab(
    (ctx, tab) => {
      const port = ctx.commands.objectImages;
      return port ? exportObjectImage(ctx.state, ctx.ui, ctx.dom, tab, format, port) : false;
    },
    (ctx, tab) => exportableObjects(ctx.state, tab).length > 0,
  );

/** `object.alignLeft`, … `object.distributeVertically`. */
const ARRANGE_COMMANDS = Object.fromEntries(
  ARRANGEMENTS.map((how) => [`object.${how}`, arrange(how)]),
) as Record<`object.${Arrangement}`, CommandSpec>;

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
  'object.group': withTab(
    (ctx, tab) => ctx.parts.objects.group(tab),
    (ctx, tab) => ctx.parts.objects.canGroup(tab),
  ),
  'object.ungroup': withTab(
    (ctx, tab) => ctx.parts.objects.ungroup(tab),
    (ctx, tab) => ctx.parts.objects.canUngroup(tab),
  ),
  ...ARRANGE_COMMANDS,
  'object.saveAsPng': saveImage('png'),
  'object.saveAsSvg': saveImage('svg'),
  'object.delete': withTab(
    (ctx, tab) => ctx.parts.objects.deleteSelected(tab),
    (ctx, tab) => ctx.state.objectSelection.selected(tab).length > 0,
  ),
} satisfies Record<string, CommandSpec>;
