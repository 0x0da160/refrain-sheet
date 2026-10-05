// SPDX-License-Identifier: MIT
/**
 * What the pixel pets do (`pixel-pets.ts`): a set of short episodes, played
 * one after another in a random order. Every episode starts and ends with
 * both pets at home — the puppy on the left facing right, the kitten on the
 * right facing it — so any episode can follow any other without a jump.
 * A pet never steps more than two pixels per tick, stays inside the scene,
 * and the puppy always stays on the kitten's left (they play, never overlap).
 */
import type { SpriteName } from './pixel-pets-sprites';

/** Scene size in sprite pixels; CSS draws each one as a 2×2 block. */
export const SCENE_W = 64;
export const SCENE_H = 12;

interface PetPose {
  sprite: SpriteName;
  x: number;
  y: number;
  /** Facing left (the sprites face right). */
  flip: boolean;
}

/** A small thing drawn over the scene: a heart, a ball, a note… */
interface PetProp {
  sprite: SpriteName;
  x: number;
  y: number;
}

export interface PetScene {
  puppy: PetPose;
  kitten: PetPose;
  props: PetProp[];
}

export interface PetEpisode {
  /** Its name, for tests and debugging. */
  name: string;
  /** Length in ticks. */
  ticks: number;
  /** The scene at `tick` (0 ≤ tick < ticks). */
  frame: (tick: number) => PetScene;
}

/** Where both pets stand between episodes. */
export const HOME = { puppy: 6, kitten: 34 } as const;

interface Segment {
  ticks: number;
  frame: (t: number) => PetScene;
}

const pose = (sprite: SpriteName, x: number, y = 0, flip = false): PetPose => ({ sprite, x, y, flip });
const prop = (sprite: SpriteName, x: number, y: number): PetProp => ({ sprite, x, y });

/** Every `every` ticks, switch between `a` and `b`. */
function alt<T>(t: number, a: T, b: T, every = 2): T {
  return Math.floor(t / every) % 2 === 0 ? a : b;
}

/** From `a` at t = 0 to `b` at t = n (whole pixels). */
function lerp(a: number, b: number, t: number, n: number): number {
  return Math.round(a + ((b - a) * Math.min(t, n)) / n);
}

const HOP_Y = [-1, -2, -2, -2, -1, 0];

const puppyHome = (t: number): PetPose => pose(alt(t, 'puppyStand', 'puppyWag', 3), HOME.puppy);
const kittenHome = (t: number): PetPose =>
  pose(t % 23 === 22 ? 'kittenBlink' : 'kittenStand', HOME.kitten, 0, true);

/** Both at home for `ticks` ticks, with `props` (given the tick) over them. */
function atHome(ticks: number, props: (t: number) => PetProp[] = () => []): Segment {
  return { ticks, frame: (t) => ({ puppy: puppyHome(t), kitten: kittenHome(t), props: props(t) }) };
}

function seg(ticks: number, frame: (t: number) => PetScene): Segment {
  return { ticks, frame };
}

function episode(name: string, ...segments: Segment[]): PetEpisode {
  const ticks = segments.reduce((sum, s) => sum + s.ticks, 0);
  return {
    name,
    ticks,
    frame: (tick) => {
      let t = Math.max(0, Math.min(ticks - 1, Math.floor(tick)));
      for (const s of segments) {
        if (t < s.ticks) {
          return s.frame(t);
        }
        t -= s.ticks;
      }
      throw new Error('unreachable');
    },
  };
}

/** A heart rising from (`x`, 4) while `t` runs from 0 to 16. */
function heart(x: number, t: number): PetProp[] {
  return t < 16 ? [prop('heart', x, 4 - Math.floor(t / 4))] : [];
}

/** The puppy chases the kitten right; the kitten springs back and chases it home; a pat and a heart. */
const chase = episode(
  'chase',
  seg(24, (t) => ({
    puppy: pose(alt(t, 'puppyRunA', 'puppyRunB'), lerp(HOME.puppy, 30, t, 23), alt(t, 0, -1)),
    kitten: pose(alt(t, 'kittenWalkA', 'kittenWalkB'), lerp(HOME.kitten, 48, t, 23)),
    props: [],
  })),
  seg(22, (t) => ({
    puppy: pose(alt(t, 'puppyStand', 'puppyWag'), 30),
    kitten:
      t < 8
        ? pose('kittenCrouch', 48, 0, true)
        : t < 14
          ? pose('kittenWalkA', 48 - Math.round((t - 8) / 3), HOP_Y[t - 8]!, true)
          : pose(alt(t, 'kittenStand', 'kittenPaw', 3), 46, 0, true),
    props: [],
  })),
  seg(24, (t) => ({
    puppy: pose(alt(t, 'puppyRunA', 'puppyRunB'), lerp(30, HOME.puppy, t, 23), alt(t, 0, -1), true),
    kitten: pose(alt(t, 'kittenWalkA', 'kittenWalkB'), lerp(46, 22, t, 23), 0, true),
    props: [],
  })),
  seg(30, (t) => ({
    puppy: pose(alt(t, 'puppyHappy', 'puppyHappyWag'), HOME.puppy),
    kitten: pose(t >= 8 && t < 20 ? alt(t, 'kittenPaw', 'kittenStand', 3) : 'kittenStand', 22, 0, true),
    props: t >= 14 ? heart(17, t - 14) : [],
  })),
  seg(12, (t) => ({
    puppy: puppyHome(t),
    kitten: pose(
      t < 11 ? alt(t, 'kittenWalkA', 'kittenWalkB') : 'kittenStand',
      lerp(22, HOME.kitten, t, 11),
      0,
      t === 11,
    ),
    props: [],
  })),
);

/** A ball dropped between them goes back and forth: the puppy noses it, the kitten swipes it back. */
const ball = episode(
  'ball',
  atHome(8, (t) => [prop('ball', 22, lerp(-4, 8, t, 7))]),
  ...[0, 1, 2].map(() =>
    seg(24, (t) => {
      const x = t < 8 ? lerp(22, 30, t, 7) : t < 12 ? 30 : t < 20 ? lerp(30, 22, t - 12, 7) : 22;
      return {
        puppy: pose(
          t >= 20 ? 'puppyHappy' : alt(t, 'puppyStand', 'puppyWag'),
          HOME.puppy,
          t >= 20 ? alt(t, -1, 0) : 0,
        ),
        kitten: pose(
          t >= 8 && t < 12 ? alt(t, 'kittenPaw', 'kittenStand') : 'kittenStand',
          HOME.kitten,
          0,
          true,
        ),
        props: [prop('ball', x, 8)],
      };
    }),
  ),
  atHome(20, (t) => (t < 8 ? [prop('ball', 22, lerp(8, -4, t, 7))] : heart(27, t - 8))),
);

/** A nap: both curl up, sleep marks rise in turn, then a stretch and a wag. */
const nap = episode(
  'nap',
  atHome(6),
  seg(80, (t) => {
    const props: PetProp[] = [];
    const a = t % 20;
    if (a < 15) props.push(prop('sleepMark', 18 + Math.floor(a / 8), 2 - Math.floor(a / 5)));
    const b = (t + 10) % 20;
    if (t >= 10 && b < 15) props.push(prop('sleepMark', 38 + Math.floor(b / 8), 3 - Math.floor(b / 5)));
    return {
      puppy: pose('puppySleep', HOME.puppy),
      kitten: pose('kittenCurl', HOME.kitten, 0, true),
      props,
    };
  }),
  seg(14, (t) => ({
    puppy: pose(t < 8 ? 'puppyStand' : alt(t, 'puppyHappy', 'puppyHappyWag'), HOME.puppy),
    kitten: pose(t < 8 ? 'kittenCrouch' : 'kittenStand', HOME.kitten, 0, true),
    props: [],
  })),
);

/** A butterfly flutters across and back; the kitten turns to follow it and hops as it passes over. */
const butterfly = episode(
  'butterfly',
  seg(90, (t) => {
    const bx = t < 45 ? lerp(0, 60, t, 44) : lerp(60, 0, t - 45, 44);
    const by = 1 + Math.round(Math.sin(t / 3));
    const over = Math.abs(bx - (HOME.kitten + 7)) < 4;
    return {
      puppy: pose(alt(t, 'puppySit', 'puppySitWag', 4), HOME.puppy, 0, bx < HOME.puppy + 4),
      kitten: pose(over ? 'kittenWalkA' : 'kittenStand', HOME.kitten, over ? -2 : 0, bx < HOME.kitten + 6),
      props: [prop(alt(t, 'butterflyOpen', 'butterflyShut'), bx, by)],
    };
  }),
  atHome(6),
);

/** The kitten turns round, bats a ball of yarn that rolls in, pounces after it, and walks back. */
const yarn = episode(
  'yarn',
  seg(4, () => ({
    puppy: puppyHome(0),
    kitten: pose('kittenStand', HOME.kitten),
    props: [prop('yarn', 66, 8)],
  })),
  seg(10, (t) => ({
    puppy: puppyHome(t),
    kitten: pose('kittenStand', HOME.kitten),
    props: [prop('yarn', lerp(66, 56, t, 9), 8)],
  })),
  seg(8, (t) => ({
    puppy: puppyHome(t),
    kitten: pose(alt(t, 'kittenWalkA', 'kittenWalkB'), lerp(HOME.kitten, 40, t, 7)),
    props: [prop('yarn', 56, 8)],
  })),
  seg(12, (t) => ({
    puppy: puppyHome(t),
    kitten: pose(alt(t, 'kittenPaw', 'kittenStand'), 40),
    props: [prop('yarn', alt(t, 56, 57), 8)],
  })),
  seg(8, (t) => ({
    puppy: puppyHome(t),
    kitten: pose('kittenCrouch', 40),
    props: [prop('yarn', lerp(56, 60, t, 7), 8)],
  })),
  seg(6, (t) => ({
    puppy: puppyHome(t),
    kitten: pose('kittenWalkA', lerp(40, 46, t, 5), HOP_Y[t]!),
    props: [prop('yarn', lerp(60, 62, t, 5), 8)],
  })),
  seg(12, (t) => ({
    puppy: pose(alt(t, 'puppyHappy', 'puppyHappyWag'), HOME.puppy),
    kitten: pose(alt(t, 'kittenPaw', 'kittenStand', 3), 46),
    props: [prop('yarn', 62, 8)],
  })),
  seg(12, (t) => ({
    puppy: puppyHome(t),
    kitten: pose(alt(t, 'kittenWalkA', 'kittenWalkB'), lerp(46, HOME.kitten, t, 11), 0, true),
    props: [prop('yarn', 62, 8)],
  })),
  atHome(6),
);

/** A hopping game: the puppy hops, the kitten answers higher, three times, then a heart. */
const hops = episode(
  'hops',
  ...[0, 1, 2, 3, 4, 5].map((round) =>
    seg(8, (t) => {
      const puppyTurn = round % 2 === 0;
      const y = t < 6 ? HOP_Y[t]! : 0;
      return {
        puppy: puppyTurn
          ? pose('puppyHappy', HOME.puppy, Math.max(-1, y))
          : pose(alt(t, 'puppyStand', 'puppyWag'), HOME.puppy),
        kitten: puppyTurn
          ? pose('kittenStand', HOME.kitten, 0, true)
          : pose(y < 0 ? 'kittenWalkA' : 'kittenStand', HOME.kitten, y, true),
        props: [],
      };
    }),
  ),
  atHome(16, (t) => heart(27, t)),
);

/** A song: both sit and sway while notes float up from each in turn. */
const song = episode(
  'song',
  seg(72, (t) => {
    const sway = alt(t, 0, 1, 4);
    const props: PetProp[] = [];
    for (const [start, x] of [
      [0, 20],
      [10, 30],
    ] as const) {
      const n = (t - start + 20) % 20;
      if (t >= start && n < 10) props.push(prop('note', x + Math.floor(n / 3), 4 - n));
    }
    return {
      puppy: pose(alt(t, 'puppySit', 'puppySitWag', 4), HOME.puppy + sway),
      kitten: pose(alt(t, 'kittenSit', 'kittenBlink', 8), HOME.kitten - sway, 0, true),
      props,
    };
  }),
  atHome(4),
);

/** A fish drops in: the kitten crouches, pats it, and it is shared — sparkles and a heart. */
const fish = episode(
  'fish',
  atHome(10, (t) => [prop('fish', 26, lerp(-3, 9, t, 9))]),
  seg(10, (t) => ({
    puppy: puppyHome(t),
    kitten: pose('kittenCrouch', HOME.kitten, 0, true),
    props: [prop('fish', 26, alt(t, 9, 8))],
  })),
  seg(12, (t) => ({
    puppy: pose(alt(t, 'puppyHappy', 'puppyHappyWag'), HOME.puppy),
    kitten: pose(alt(t, 'kittenPaw', 'kittenStand'), HOME.kitten, 0, true),
    props: [prop('fish', 26, 9)],
  })),
  atHome(6, (t) => [prop('sparkle', 25 + alt(t, 0, 3), alt(t, 8, 6))]),
  seg(16, (t) => ({
    puppy: pose(alt(t, 'puppyHappy', 'puppyHappyWag'), HOME.puppy),
    kitten: kittenHome(t),
    props: heart(27, t),
  })),
);

/** A shooting star falls across the sky; both sit to watch the sparkles it leaves. */
const stars = episode(
  'stars',
  seg(30, (t) => {
    const x = lerp(62, 22, t, 29);
    const y = lerp(-5, 3, t, 29);
    return {
      puppy: pose('puppySit', HOME.puppy),
      kitten: pose('kittenSit', HOME.kitten, 0, true),
      props: [prop('star', x, y), ...(t % 2 === 0 ? [prop('sparkle', x + 6, y - 2)] : [])],
    };
  }),
  seg(30, (t) => ({
    puppy: pose(alt(t, 'puppySit', 'puppySitWag', 3), HOME.puppy),
    kitten: pose(alt(t, 'kittenSit', 'kittenBlink', 6), HOME.kitten, 0, true),
    props: [
      ...(alt(t, true, false, 3) ? [prop('sparkle', 22, 0)] : []),
      ...(alt(t, false, true, 4) ? [prop('sparkle', 28, 2)] : []),
      ...(alt(t, true, false, 5) ? [prop('sparkle', 54, 1)] : []),
    ],
  })),
  atHome(4),
);

/** The puppy has the zoomies: dashes left and right while the kitten sits and watches. */
const zoomies = episode(
  'zoomies',
  ...(
    [
      [HOME.puppy, 0, 3],
      [0, 18, 9],
      [18, 0, 9],
      [0, 18, 9],
      [18, HOME.puppy, 6],
    ] as const
  ).map(([from, to, ticks]) =>
    seg(ticks, (t) => ({
      puppy: pose(
        alt(t, 'puppyRunA', 'puppyRunB', 1),
        lerp(from, to, t + 1, ticks),
        alt(t, 0, -1, 1),
        to < from,
      ),
      kitten: pose('kittenSit', HOME.kitten, 0, true),
      props: [],
    })),
  ),
  seg(12, (t) => ({
    puppy: pose(alt(t, 'puppyHappy', 'puppyHappyWag'), HOME.puppy),
    kitten: pose(t < 6 ? 'kittenSit' : 'kittenStand', HOME.kitten, 0, true),
    props: [],
  })),
);

/** The puppy walks up to sniff; the kitten boops its nose; it hops back, and they make friends. */
const sniff = episode(
  'sniff',
  seg(12, (t) => ({
    puppy: pose(alt(t, 'puppyRunA', 'puppyRunB', 3), lerp(HOME.puppy, 18, t + 1, 12)),
    kitten: kittenHome(t),
    props: [],
  })),
  seg(8, (t) => ({ puppy: pose('puppyStand', alt(t, 18, 19)), kitten: kittenHome(t), props: [] })),
  seg(6, (t) => ({
    puppy: pose('puppyStand', 18),
    kitten: pose(t < 4 ? 'kittenPaw' : 'kittenStand', HOME.kitten, 0, true),
    props: t < 3 ? [prop('sparkle', 32, 3)] : [],
  })),
  seg(6, (t) => ({
    puppy: pose('puppyWag', lerp(18, 12, t + 1, 6), t < 5 ? -1 : 0),
    kitten: kittenHome(t),
    props: [],
  })),
  seg(14, (t) => ({
    puppy: pose(alt(t, 'puppyHappy', 'puppyHappyWag'), 12),
    kitten: kittenHome(t),
    props: heart(29, t),
  })),
  seg(6, (t) => ({
    puppy: pose(alt(t, 'puppyRunA', 'puppyRunB'), lerp(12, HOME.puppy, t + 1, 6), 0, true),
    kitten: kittenHome(t),
    props: [],
  })),
  atHome(2),
);

/** A bone drops in front of the puppy, who chews it happily while the kitten pats along. */
const bone = episode(
  'bone',
  atHome(10, (t) => [prop('bone', 22, lerp(-5, 7, t, 9))]),
  seg(24, (t) => ({
    puppy: pose(alt(t, 'puppyHappy', 'puppyHappyWag'), HOME.puppy + alt(t, 0, 1)),
    kitten: pose(
      t >= 12 && t < 18 ? alt(t, 'kittenPaw', 'kittenStand') : 'kittenStand',
      HOME.kitten,
      0,
      true,
    ),
    props: [prop('bone', 22 + alt(t, 0, 1), 7)],
  })),
  atHome(8, (t) => (t < 4 ? [prop('sparkle', 24, 8 - t)] : [])),
  atHome(6),
);

/** Every episode, in no particular order (the player picks them at random). */
export const EPISODES: readonly PetEpisode[] = [
  chase,
  ball,
  nap,
  butterfly,
  yarn,
  hops,
  song,
  fish,
  stars,
  zoomies,
  sniff,
  bone,
];

/** The still picture shown when motion is reduced: face to face, with a heart. */
export function stillScene(): PetScene {
  return chase.frame(24 + 22 + 24 + 20);
}
