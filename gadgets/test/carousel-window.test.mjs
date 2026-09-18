import test from 'node:test';
import assert from 'node:assert/strict';
import {carouselWindow, wrapIndex, CAROUSEL_SLOTS} from '../src/carousel-window.mjs';

test('the eight-card scene preserves catalog order through forward, reverse and catalog wrap', () => {
  const items = Array.from({length: 67}, (_, id) => ({id}));
  for (const progress of [-135, -1, 0, .49, .51, 7, 8, 65, 66, 67, 134, 2000]) {
    const slots = carouselWindow(items, progress), center = Math.round(progress);
    assert.equal(slots.length, CAROUSEL_SLOTS);
    for (let offset = -3; offset <= 3; offset++) {
      assert.equal(slots[wrapIndex(center + offset, 8)], items[wrapIndex(center + offset, 67)]);
    }
  }
  const before = carouselWindow(items, 7), after = carouselWindow(items, 8);
  assert.equal(before.filter((item, index) => item !== after[index]).length, 1);
});

test('small and empty results have no missing or invented cards', () => {
  assert.deepEqual(carouselWindow([]), []);
  for (const count of [1, 2, 3, 4, 7, 8]) {
    const items = Array.from({length: count}, (_, id) => ({id}));
    for (const progress of [-9, 0, 1, 7, 8, 9]) {
      assert.ok(carouselWindow(items, progress).every(item => items.includes(item)));
    }
  }
});
