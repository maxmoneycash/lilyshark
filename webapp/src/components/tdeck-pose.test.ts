import assert from 'node:assert/strict';
import test from 'node:test';
import { clampPitch, PITCH_MAX, PITCH_MIN, REST_PITCH, REST_ROLL, REST_YAW } from './tdeck-pose.ts';

test('the rest pose is a three-quarter view, not face-on', () => {
  assert.ok(Math.abs(REST_YAW) > 0.45, 'yaw must show a side of the chassis');
  assert.ok(Math.abs(REST_PITCH) > 0.25, 'pitch must show the deck’s thickness');
  assert.ok(REST_ROLL < 0, 'a slight bank reads the chassis as a volume');
});

test('pitch stays short of flipping through the handset', () => {
  assert.equal(clampPitch(0), 0);
  assert.equal(clampPitch(PITCH_MAX + 1), PITCH_MAX);
  assert.equal(clampPitch(PITCH_MIN - 1), PITCH_MIN);
  assert.ok(PITCH_MAX > 1, 'enough pitch to see the top of the deck');
});
