// SPDX-License-Identifier: MIT
/**
 * The pixel pets' pictures (`pixel-pets.ts`): the white puppy, the black
 * kitten, and the small things they play with. Pets are 16 pixels wide and
 * 12 tall, facing right; one letter per pixel, '.' is empty. Colors are in
 * {@link FIXED_COLORS}; the kitten's outline (c) and fur (B) come from CSS so
 * they read on a dark bar too.
 *
 * o puppy outline, w white, s light shade, e ear, k eye/nose, r collar/ball,
 * p tongue; c kitten outline, B kitten fur, Y kitten eyes, q kitten nose;
 * h heart, z sleep mark, n music note, b butterfly, g yarn, f fish,
 * x star, d bone.
 */

type Sprite = readonly string[];

type Eyes = 'open' | 'happy' | 'closed';

const PUPPY_EYES: Record<Eyes, [string, string]> = {
  open: ['oeewwwwwo', 'oeewwkwwo'],
  happy: ['oeewwkwwo', 'oeewkwkwo'],
  closed: ['oeewwwwwo', 'oeewkkwwo'],
};

function puppy(tail: readonly string[], legs: readonly string[], eyes: Eyes = 'open'): Sprite {
  return [
    '................',
    '.........ooooo..',
    '........owwwwwo.',
    tail[0] + PUPPY_EYES[eyes][0],
    tail[1] + PUPPY_EYES[eyes][1],
    tail[2] + 'oeewwwwwk',
    tail[3] + (eyes === 'happy' ? 'ooewwwpo.' : 'ooewwwoo.'),
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
const PUPPY_SIT = ['..owwwwwwowwo...', '..oooooo..oo....'];

function kitten(legs: readonly string[], paw = false, eyes: Exclude<Eyes, 'happy'> = 'open'): Sprite {
  const eye = eyes === 'open' ? 'Y' : 'c';
  return [
    '................',
    '................',
    '..........c...c.',
    '.........cBc.cBc',
    '..c......cBBBBBc',
    `.cBc.....cB${eye}BB${eye}c`,
    '.cBc.....cBBqBBc',
    '..cBcccccccBBBc.',
    paw ? '...cBBBBBBBBBccc' : '...cBBBBBBBBBc..',
    paw ? '...cBBBBBBBBBcBc' : '...cBBBBBBBBBc..',
    ...legs,
  ];
}

const KITTEN_LEGS = ['...cBc.cBcBc....', '....c...c.c.....'];
const KITTEN_STAND = kitten(KITTEN_LEGS);

export const SPRITES = {
  puppyStand: puppy(TAIL_UP, PUPPY_STAND),
  puppyWag: puppy(TAIL_BACK, PUPPY_STAND),
  puppyRunA: puppy(TAIL_BACK, PUPPY_RUN_A),
  puppyRunB: puppy(TAIL_BACK, PUPPY_RUN_B),
  puppyHappy: puppy(TAIL_UP, PUPPY_STAND, 'happy'),
  puppyHappyWag: puppy(TAIL_BACK, PUPPY_STAND, 'happy'),
  puppySit: puppy(TAIL_UP, PUPPY_SIT),
  puppySitWag: puppy(TAIL_BACK, PUPPY_SIT, 'happy'),
  // Lying flat with the eyes shut.
  puppySleep: [
    '................',
    '................',
    ...puppy(TAIL_BACK, [], 'closed').slice(1, 10),
    '..oooooooooo....',
  ],
  kittenStand: KITTEN_STAND,
  kittenWalkA: kitten(['..cBc.....cBc...', '..cc.......cc...']),
  kittenWalkB: kitten(['....cBc.cBc.....', '.....c...c......']),
  kittenPaw: kitten(['...cBc.cBc......', '....c...c.......'], true),
  kittenSit: kitten(['...cBBBBBBBBBc..', '....ccc..ccc....']),
  kittenBlink: kitten(KITTEN_LEGS, false, 'closed'),
  // Low to the ground, ready to spring (or stretching after a nap).
  kittenCrouch: ['................', ...KITTEN_STAND.slice(0, 10), '...cc..cccc.....'],
  // Curled up asleep.
  kittenCurl: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..........c...c.',
    '.........cBc.cBc',
    '..cccccccBBBBBBc',
    '.cBBBBBBBcBBcBBc',
    'cBBBBBBBBBBBBBc.',
    'cBcBBBBBBBBBBc..',
    '.c.cccccccccc...',
  ],
  heart: ['.h.h.', 'hhhhh', '.hhh.', '..h..'],
  ball: ['.rr.', 'rwrr', 'rrrr', '.rr.'],
  sleepMark: ['zzz', '..z', '.z.', 'zzz'],
  note: ['.nn', '.n.', '.n.', 'nn.', 'nn.'],
  butterflyOpen: ['b.b', 'bkb', 'b.b'],
  butterflyShut: ['...', 'bkb', '...'],
  yarn: ['.gg.', 'gggg', 'gwgg', '.gg.'],
  fish: ['.fff.f', 'fkffff', '.fff.f'],
  star: ['..x..', '.xxx.', 'xxxxx', '.xxx.', '.x.x.'],
  sparkle: ['.x.', 'xxx', '.x.'],
  bone: ['.oo..oo.', 'odoooodo', 'oddddddo', 'odoooodo', '.oo..oo.'],
} satisfies Record<string, Sprite>;

export type SpriteName = keyof typeof SPRITES;

/** Pixel colors other than the kitten's (see the module comment). */
export const FIXED_COLORS: Readonly<Record<string, string>> = {
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
  z: '#7f8ca3',
  n: '#5b6ee0',
  b: '#4f9bf0',
  g: '#9b7be0',
  f: '#4aa3d6',
  x: '#f2b90f',
  d: '#efe4cc',
};
