import assert from 'node:assert/strict';
import test from 'node:test';
import { clampPitch, PITCH_MAX, PITCH_MIN, REST_PITCH, REST_ROLL, REST_YAW } from './tdeck-pose.ts';

test('the rest pose is a three-quarter view, not face-on', () => {
  assert.ok(Math.abs(REST_YAW) > 0.45, 'yaw must show a side of the chassis');
  assert.ok(Math.abs(REST_PITCH) > 0.25, 'pitch must show the deck’s thickness');
  assert.ok(REST_ROLL < 0, 'a slight bank reads the chassis as a volume');
});

test('pitch supports full rotation and wraps without changing orientation', () => {
  assert.equal(clampPitch(0), 0);
  for (const angle of [PITCH_MAX + 1, PITCH_MIN - 1, 20 * Math.PI + 0.6, -20 * Math.PI - 0.6]) {
    const wrapped = clampPitch(angle);
    assert.ok(wrapped >= PITCH_MIN && wrapped <= PITCH_MAX);
    assert.ok(Math.abs(Math.sin(wrapped) - Math.sin(angle)) < 1e-12);
    assert.ok(Math.abs(Math.cos(wrapped) - Math.cos(angle)) < 1e-12);
  }
});
