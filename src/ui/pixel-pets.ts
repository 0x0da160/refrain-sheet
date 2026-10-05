// SPDX-License-Identifier: MIT
/**
 * The pixel pets: a white puppy and a black kitten playing in the free space
 * at the top right of the window. Pure decoration — drawn on a small canvas
 * from in-code sprites (`pixel-pets-sprites.ts`, no image files), hidden
 * from assistive tech, and never hit by the pointer, so it cannot get in the
 * way of anything. What they do is a set of short episodes
 * (`pixel-pets-episodes.ts`) played one after another in a random order.
 *
 * Hidden unless turned on in File > Settings… (`pets-prefs.ts`). With
 * "reduce motion" requested by the system it shows one still frame, and it
 * stops drawing while the page is in the background.
 */
import { getPetsShown } from '../app/pets-prefs';
import { el } from './dom';
import { EPISODES, SCENE_H, SCENE_W, stillScene, type PetScene } from './pixel-pets-episodes';
import { FIXED_COLORS, SPRITES } from './pixel-pets-sprites';

type Sprite = readonly string[];

/**
 * The next episode to play after `current` (an index into `EPISODES`): any
 * other one, at random, so the same one never plays twice in a row.
 */
export function nextEpisode(current: number, random: () => number = Math.random): number {
  const pick = Math.floor(random() * (EPISODES.length - 1));
  return pick >= current ? pick + 1 : pick;
}

/** Milliseconds per animation step. */
const TICK_MS = 100;

function drawSprite(
  g: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  flip: boolean,
  colors: Readonly<Record<string, string>>,
): void {
  const width = sprite[0]!.length;
  sprite.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const color = colors[row[dx]!];
      if (color) {
        g.fillStyle = color;
        g.fillRect(x + (flip ? width - 1 - dx : dx), y + dy, 1, 1);
      }
    }
  });
}

export class PixelPets {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  /** The episode playing (an index into `EPISODES`) and the step within it. */
  private episode = Math.floor(Math.random() * EPISODES.length);
  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly reducedMotion: MediaQueryList | null =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  constructor() {
    this.canvas = el('canvas', { attrs: { width: String(SCENE_W), height: String(SCENE_H) } });
    this.element = el('div', { className: 'pixel-pets', attrs: { 'aria-hidden': 'true' } }, [this.canvas]);
    document.addEventListener('visibilitychange', () => this.render());
    this.reducedMotion?.addEventListener('change', () => this.render());
    this.render();
  }

  /** Show or hide per the setting, and run or pause the animation to match. */
  render(): void {
    const shown = getPetsShown();
    this.element.hidden = !shown;
    const animate = shown && !document.hidden && !this.reducedMotion?.matches;
    if (animate && this.timer === null) {
      this.timer = setInterval(() => this.step(), TICK_MS);
    } else if (!animate && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (shown) {
      this.draw(this.reducedMotion?.matches ? stillScene() : this.scene());
    }
  }

  private scene(): PetScene {
    return EPISODES[this.episode]!.frame(this.tick);
  }

  private step(): void {
    this.tick += 1;
    if (this.tick >= EPISODES[this.episode]!.ticks) {
      this.episode = nextEpisode(this.episode);
      this.tick = 0;
    }
    this.draw(this.scene());
  }

  private draw(scene: PetScene): void {
    const g = this.canvas.getContext('2d');
    if (!g) {
      return;
    }
    const style = getComputedStyle(this.element);
    const colors = {
      ...FIXED_COLORS,
      c: style.getPropertyValue('--pet-kitten-line').trim() || '#000000',
      B: style.getPropertyValue('--pet-kitten-fur').trim() || '#1f1f22',
    };
    g.clearRect(0, 0, SCENE_W, SCENE_H);
    for (const pose of [scene.puppy, scene.kitten]) {
      drawSprite(g, SPRITES[pose.sprite], pose.x, pose.y, pose.flip, colors);
    }
    for (const thing of scene.props) {
      drawSprite(g, SPRITES[thing.sprite], thing.x, thing.y, false, colors);
    }
  }
}
