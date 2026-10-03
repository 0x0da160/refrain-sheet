// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getPetsShown, setPetsShown } from '../../src/app/pets-prefs';
import { LOOP_TICKS, petScene, PixelPets, SCENE_W } from '../../src/ui/pixel-pets';

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

  it('stay inside the scene and never step more than a few pixels at once, across the loop', () => {
    for (let tick = 0; tick < LOOP_TICKS; tick++) {
      const now = petScene(tick);
      const next = petScene(tick + 1);
      for (const pet of ['puppy', 'kitten'] as const) {
        expect(now[pet].x).toBeGreaterThanOrEqual(0);
        expect(now[pet].x + 16).toBeLessThanOrEqual(SCENE_W);
        expect(now[pet].y).toBeLessThanOrEqual(0);
        expect(Math.abs(next[pet].x - now[pet].x)).toBeLessThanOrEqual(2);
      }
      // The puppy is always on the kitten's left: they play, never overlap.
      expect(now.puppy.x + 14).toBeLessThanOrEqual(now.kitten.x + 1);
    }
    expect(petScene(LOOP_TICKS)).toEqual(petScene(0));
  });
});
