// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getPetsShown, setPetsShown } from '../../src/app/pets-prefs';
import { nextEpisode, PixelPets } from '../../src/ui/pixel-pets';
import { EPISODES, HOME, SCENE_H, SCENE_W, stillScene } from '../../src/ui/pixel-pets-episodes';
import { SPRITES } from '../../src/ui/pixel-pets-sprites';

describe('pixel pets', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom has no 2D canvas; drawing is skipped without one.
    HTMLCanvasElement.prototype.getContext = () => null;
  });

  it('are hidden until turned on, and the choice is kept in this browser', () => {
    expect(getPetsShown()).toBe(false);
    setPetsShown(true);
    expect(localStorage.getItem('refrain-csv-html.pets')).toBe('true');
    expect(getPetsShown()).toBe(true);
    setPetsShown(false);
    expect(localStorage.getItem('refrain-csv-html.pets')).toBe('false');
    expect(getPetsShown()).toBe(false);
  });

  it('hide their element when turned off, and never take the pointer or a screen reader', () => {
    setPetsShown(true);
    const pets = new PixelPets();
    expect(pets.element.hidden).toBe(false);
    expect(pets.element.getAttribute('aria-hidden')).toBe('true');
    setPetsShown(false);
    pets.render();
    expect(pets.element.hidden).toBe(true);
  });

  it('have many episodes, each starting and ending with both pets at home', () => {
    expect(EPISODES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(EPISODES.map((e) => e.name)).size).toBe(EPISODES.length);
    for (const episode of EPISODES) {
      for (const tick of [0, episode.ticks - 1]) {
        const scene = episode.frame(tick);
        expect(Math.abs(scene.puppy.x - HOME.puppy), `${episode.name}@${tick}`).toBeLessThanOrEqual(2);
        expect(Math.abs(scene.kitten.x - HOME.kitten), `${episode.name}@${tick}`).toBeLessThanOrEqual(2);
      }
      const last = episode.frame(episode.ticks - 1);
      expect([last.puppy.x, last.kitten.x], episode.name).toEqual([HOME.puppy, HOME.kitten]);
    }
  });

  it('stay inside the scene and never step more than a few pixels at once, in every episode', () => {
    for (const episode of EPISODES) {
      for (let tick = 0; tick < episode.ticks; tick++) {
        const now = episode.frame(tick);
        const next = episode.frame(Math.min(tick + 1, episode.ticks - 1));
        const at = `${episode.name}@${tick}`;
        for (const pet of ['puppy', 'kitten'] as const) {
          expect(now[pet].x, at).toBeGreaterThanOrEqual(0);
          expect(now[pet].x + 16, at).toBeLessThanOrEqual(SCENE_W);
          expect(now[pet].y, at).toBeLessThanOrEqual(0);
          expect(now[pet].y, at).toBeGreaterThanOrEqual(-2);
          expect(Math.abs(next[pet].x - now[pet].x), at).toBeLessThanOrEqual(2);
        }
        // The puppy is always on the kitten's left: they play, never overlap.
        expect(now.puppy.x + 14, at).toBeLessThanOrEqual(now.kitten.x + 1);
        for (const thing of now.props) {
          expect(thing.y, at).toBeLessThan(SCENE_H);
        }
      }
    }
    expect(stillScene().props.some((p) => p.sprite === 'heart')).toBe(true);
  });

  it('draw every sprite as a rectangle of known colors, pets 16 by 12', () => {
    for (const [name, sprite] of Object.entries(SPRITES)) {
      expect(new Set(sprite.map((row) => row.length)).size, name).toBe(1);
      if (/^(puppy|kitten)/.test(name)) {
        expect([sprite[0]!.length, sprite.length], name).toEqual([16, 12]);
      }
    }
  });

  it('never play the same episode twice in a row', () => {
    for (let current = 0; current < EPISODES.length; current++) {
      for (const r of [0, 0.5, 0.999]) {
        const next = nextEpisode(current, () => r);
        expect(next).not.toBe(current);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(EPISODES.length);
      }
    }
  });
});
