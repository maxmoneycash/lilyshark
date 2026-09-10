import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTDeckTune,
  setTDeckTune,
  subscribeTDeckTune,
  TDECK_SCENE,
  TDECK_TUNE_DEFAULTS,
} from './tdeck-tune';

test('live knobs default to the shipping scene, not a second set of numbers', () => {
  assert.equal(TDECK_TUNE_DEFAULTS.halfHeight, TDECK_SCENE.halfHeight);
  assert.equal(TDECK_TUNE_DEFAULTS.pan, TDECK_SCENE.pan);
  assert.equal(TDECK_TUNE_DEFAULTS.breathe, TDECK_SCENE.breathe);
  assert.deepEqual(getTDeckTune(), TDECK_TUNE_DEFAULTS);
});

test('AgX exposure and the room env are scene constants, not live knobs', () => {
  assert.equal(TDECK_SCENE.exposure, 1);
  assert.equal(TDECK_SCENE.envIntensity, 1.05);
  assert.equal('exposure' in TDECK_TUNE_DEFAULTS, false);
  assert.equal('envIntensity' in TDECK_TUNE_DEFAULTS, false);
});

test('setTDeckTune ignores a no-op and publishes a real change', () => {
  const seen: number[] = [];
  const unsub = subscribeTDeckTune(() => {
    seen.push(getTDeckTune().pan);
  });
  try {
    setTDeckTune({ pan: TDECK_SCENE.pan });
    assert.equal(seen.length, 0, 'identity writes must not notify');
    setTDeckTune({ pan: 0.12 });
    assert.deepEqual(seen, [0.12]);
  } finally {
    setTDeckTune({ ...TDECK_TUNE_DEFAULTS });
    unsub();
  }
});
