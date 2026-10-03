// SPDX-License-Identifier: MIT
/**
 * The pixel pets: a white puppy and a black kitten playing in the free space
 * at the top right of the window. Pure decoration — drawn on a small canvas
 * from the sprites below (no image files), hidden from assistive tech, and
 * never hit by the pointer, so it cannot get in the way of anything.
 *
 * Hidden unless turned on in File > Settings… (`pets-prefs.ts`). With
 * "reduce motion" requested by the system it shows one still frame, and it
 * stops drawing while the page is in the background.
 */
import { getPetsShown } from '../app/pets-prefs';
import { el } from './dom';

/** Scene size in sprite pixels; CSS draws each one as a 2×2 block. */
export const SCENE_W = 64;
const SCENE_H = 12;
/** Milliseconds per animation step. */
const TICK_MS = 100;
/** Steps in one full play loop. */
export const LOOP_TICKS = 120;
/** The step shown as a still picture when motion is reduced: facing each other, with a heart. */
const STILL_TICK = 104;

// ---------------------------------------------------------------------------
// Sprites: 16 pixels wide, facing right. One letter per pixel, '.' is empty.
// o puppy outline, w white, s light shade, e ear, k eye/nose, r collar,
// p tongue; c kitten outline, B kitten fur, Y kitten eyes, q kitten nose.
// ---------------------------------------------------------------------------

type Sprite = readonly string[];

function puppy(tail: readonly string[], legs: readonly string[], happy = false): Sprite {
  return [
    '................',
    '.........ooooo..',
    '........owwwwwo.',
    tail[0] + (happy ? 'oeewwkwwo' : 'oeewwwwwo'),
    tail[1] + (happy ? 'oeewkwkwo' : 'oeewwkwwo'),
    tail[2] + 'oeewwwwwk',
    tail[3] + (happy ? 'ooewwwpo.' : 'ooewwwoo.'),
    '..owwwwwwrrrro..',
    '..owwwwwwwwwo...',
    '..oswwwwwwwso...',
    ...legs,
  ];
}

const TAIL_UP = ['.o.....', 'owo....', '.owo...', '..owooo'];
const TAIL_BACK = ['o......', 'wo.....', 'owo....', '.owwooo'];
const PUPPY_STAND = ['..owwo...owwo...', '...oo.....oo....'];
const PUPPY_RUN_A = ['.owo.......owo..', '.oo.........oo..'];
const PUPPY_RUN_B = ['...owo..owo.....', '....o....o......'];

function kitten(legs: readonly string[], paw = false): Sprite {
  return [
    '................',
    '................',
    '..........c...c.',
    '.........cBc.cBc',
    '..c......cBBBBBc',
    '.cBc.....cBYBBYc',
    '.cBc.....cBBqBBc',
    '..cBcccccccBBBc.',
    paw ? '...cBBBBBBBBBccc' : '...cBBBBBBBBBc..',
    paw ? '...cBBBBBBBBBcBc' : '...cBBBBBBBBBc..',
    ...legs,
  ];
}

const KITTEN_STAND = kitten(['...cBc.cBcBc....', '....c...c.c.....']);

const SPRITES = {
  puppyStand: puppy(TAIL_UP, PUPPY_STAND),
  puppyWag: puppy(TAIL_BACK, PUPPY_STAND),
  puppyRunA: puppy(TAIL_BACK, PUPPY_RUN_A),
  puppyRunB: puppy(TAIL_BACK, PUPPY_RUN_B),
  puppyHappy: puppy(TAIL_UP, PUPPY_STAND, true),
  puppyHappyWag: puppy(TAIL_BACK, PUPPY_STAND, true),
  kittenStand: KITTEN_STAND,
  kittenWalkA: kitten(['..cBc.....cBc...', '..cc.......cc...']),
  kittenWalkB: kitten(['....cBc.cBc.....', '.....c...c......']),
  kittenPaw: kitten(['...cBc.cBc......', '....c...c.......'], true),
  // Low to the ground, ready to spring.
  kittenCrouch: ['................', ...KITTEN_STAND.slice(0, 10), '...cc..cccc.....'],
  heart: ['.h.h.', 'hhhhh', '.hhh.', '..h..'],
} satisfies Record<string, Sprite>;

type SpriteName = keyof typeof SPRITES;

interface PetPose {
  sprite: SpriteName;
  x: number;
  y: number;
  /** Facing left (the sprites face right). */
  flip: boolean;
}

interface PetScene {
  puppy: PetPose;
  kitten: PetPose;
  heart: { x: number; y: number } | null;
}

/** Every other step: the two frames of a run, a wag, or a swipe. */
function alt<T>(tick: number, a: T, b: T, every = 2): T {
  return Math.floor(tick / every) % 2 === 0 ? a : b;
}

const HOP_Y = [-1, -2, -2, -2, -1, 0];

/**
 * Where both pets are and what they are doing at step `tick` of the loop:
 * the puppy chases the kitten to the right; the kitten turns, crouches and
 * springs back; they meet nose to nose; the kitten chases the puppy back to
 * the left; and they end facing each other while the kitten pats the puppy
 * and a heart floats up. The last step leads straight into the first.
 */
export function petScene(tick: number): PetScene {
  const t = ((Math.floor(tick) % LOOP_TICKS) + LOOP_TICKS) % LOOP_TICKS;
  if (t < 30) {
    // Chase to the right.
    return {
      puppy: { sprite: alt(t, 'puppyRunA', 'puppyRunB'), x: t, y: alt(t, 0, -1), flip: false },
      kitten: {
        sprite: alt(t, 'kittenWalkA', 'kittenWalkB'),
        x: 22 + Math.round((t * 26) / 29),
        y: 0,
        flip: false,
      },
      heart: null,
    };
  }
  if (t < 52) {
    // The kitten turns at the edge, crouches and springs toward the waiting puppy.
    const kitten: PetPose =
      t < 38
        ? { sprite: 'kittenCrouch', x: 48, y: 0, flip: true }
        : t < 44
          ? { sprite: 'kittenWalkA', x: 48 - Math.round((t - 38) / 3), y: HOP_Y[t - 38]!, flip: true }
          : { sprite: alt(t, 'kittenStand', 'kittenPaw', 3), x: 46, y: 0, flip: true };
    return {
      puppy: { sprite: alt(t, 'puppyStand', 'puppyWag'), x: 30, y: 0, flip: false },
      kitten,
      heart: null,
    };
  }
  if (t < 82) {
    // Now the kitten chases the puppy back to the left.
    const s = t - 52;
    return {
      puppy: {
        sprite: alt(t, 'puppyRunA', 'puppyRunB'),
        x: Math.max(0, 30 - s),
        y: alt(t, 0, -1),
        flip: true,
      },
      kitten: {
        sprite: alt(t, 'kittenWalkA', 'kittenWalkB'),
        x: 46 - Math.round((s * 24) / 29),
        y: 0,
        flip: true,
      },
      heart: null,
    };
  }
  // Face to face: a happy wag, a few pats, and a heart.
  return {
    puppy: { sprite: alt(t, 'puppyHappy', 'puppyHappyWag'), x: 0, y: 0, flip: false },
    kitten: {
      sprite: t >= 90 && t < 102 ? alt(t, 'kittenPaw', 'kittenStand', 3) : 'kittenStand',
      x: 22,
      y: 0,
      flip: true,
    },
    heart: t >= 96 && t < 112 ? { x: 17, y: 4 - Math.floor((t - 96) / 4) } : null,
  };
}

/** Pixel colors; the kitten's outline and fur come from CSS so they read on a dark bar too. */
const FIXED_COLORS: Readonly<Record<string, string>> = {
  o: '#3a3530',
  w: '#ffffff',
  s: '#dcd6cc',
  e: '#e6c9a0',
  k: '#1b1b1b',
  r: '#e0463c',
  p: '#ff8fa3',
  Y: '#d8e04a',
  q: '#f2a0b0',
  h: '#ff5d7a',
};

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
      this.timer = setInterval(() => {
        this.tick = (this.tick + 1) % LOOP_TICKS;
        this.draw();
      }, TICK_MS);
    } else if (!animate && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (shown) {
      this.draw(this.reducedMotion?.matches ? STILL_TICK : this.tick);
    }
  }

  private draw(tick = this.tick): void {
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
    const scene = petScene(tick);
    g.clearRect(0, 0, SCENE_W, SCENE_H);
    for (const pose of [scene.puppy, scene.kitten]) {
      drawSprite(g, SPRITES[pose.sprite], pose.x, pose.y, pose.flip, colors);
    }
    if (scene.heart) {
      drawSprite(g, SPRITES.heart, scene.heart.x, scene.heart.y, false, colors);
    }
  }
}
