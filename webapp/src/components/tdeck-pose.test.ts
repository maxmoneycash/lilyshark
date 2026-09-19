import assert from 'node:assert/strict';
import test from 'node:test';
import { clampPitch, PITCH_MAX, PITCH_MIN, REST_PITCH, REST_ROLL, REST_YAW } from './tdeck-pose.ts';

test('the device stands upright and is turned enough to show a side', () => {
  assert.ok(Math.abs(REST_YAW) > 0.45, 'yaw must show a side of the chassis');
  // Upright, not leaning towards the reader: a turntable, not a display stand.
  assert.ok(Math.abs(REST_PITCH) < 0.2, `rest pitch ${REST_PITCH} leans too far forward`);
  assert.ok(Math.abs(REST_ROLL) < 0.1, `rest bank ${REST_ROLL} leans too far sideways`);
});

test('a drag can tilt it a little, and can never flip it over', () => {
  assert.ok(PITCH_MIN < 0 && PITCH_MAX > 0, 'it tilts both ways');
  assert.ok(PITCH_MAX < Math.PI / 4, 'never far enough to lie on its back');
  assert.equal(clampPitch(0), 0);
  assert.equal(clampPitch(PITCH_MAX / 2), PITCH_MAX / 2);
  // However hard someone drags, it comes to rest somewhere it can be turned
  // again in the obvious direction.
  for (const angle of [10, -10, Math.PI, -Math.PI, 1e6, -1e6]) {
    const held = clampPitch(angle);
    assert.ok(held >= PITCH_MIN && held <= PITCH_MAX, `${angle} escaped to ${held}`);
  }
  assert.equal(clampPitch(PITCH_MAX + 1), PITCH_MAX);
  assert.equal(clampPitch(PITCH_MIN - 1), PITCH_MIN);
});
