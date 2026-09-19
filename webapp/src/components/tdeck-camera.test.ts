import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceAcrossTurn, FIT_MARGIN, requiredDistance } from './tdeck-camera.ts';
import { SPIN_RATE, spinYaw } from './tdeck-pose.ts';

const tanV = Math.tan((32 * Math.PI) / 180 / 2);
const tanH = tanV * 0.75; // a portrait canvas

/** A box, as eight corners centred on the origin. */
function box(halfWidth: number, halfHeight: number, halfDepth: number) {
  const points = [];
  for (const x of [-halfWidth, halfWidth])
    for (const y of [-halfHeight, halfHeight])
      for (const z of [-halfDepth, halfDepth]) points.push({ x, y, z });
  return points;
}

/** Turn a point about the vertical axis, the way the device turns. */
function turned(points: ReturnType<typeof box>, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((p) => ({ x: p.x * cos + p.z * sin, y: p.y, z: -p.x * sin + p.z * cos }));
}

test('a taller subject needs the camera further away', () => {
  const near = requiredDistance(box(0.04, 0.05, 0.01), tanV, tanH);
  const far = requiredDistance(box(0.04, 0.12, 0.01), tanV, tanH);
  assert.ok(far > near);
});

test('the framing floor holds when the subject is small', () => {
  assert.equal(requiredDistance([{ x: 0, y: 0, z: 0 }], tanV, tanH, 0.9), 0.9);
});

test('the margin keeps the subject off the edge', () => {
  const half = 0.05;
  const distance = requiredDistance([{ x: 0, y: half, z: 0 }], tanV, tanH);
  assert.ok(Math.abs(distance - (half * FIT_MARGIN) / tanV) < 1e-12);
});

test('one distance clears every angle of the turn', () => {
  const shape = box(0.05, 0.09, 0.012);
  const distance = distanceAcrossTurn((angle) => turned(shape, angle), 72, tanV, tanH);
  // Nothing leaves the frame at any angle: that is what stops the device
  // swelling and shrinking as it turns.
  for (let i = 0; i < 360; i += 1) {
    const at = requiredDistance(turned(shape, (i / 360) * Math.PI * 2), tanV, tanH);
    assert.ok(at <= distance + 1e-3, `angle ${i} needs ${at}, placed at ${distance}`);
  }
  // And it is not simply the worst case of a much larger sphere.
  assert.ok(distance < requiredDistance(box(0.09, 0.09, 0.09), tanV, tanH));
});

test('the idle turn is slow and never runs away', () => {
  assert.ok(SPIN_RATE > 0, 'the device turns on its own');
  const secondsPerTurn = (Math.PI * 2) / SPIN_RATE;
  assert.ok(secondsPerTurn > 15 && secondsPerTurn < 60, `one turn takes ${secondsPerTurn}s`);
  let yaw = 0;
  for (let i = 0; i < 60 * 600; i += 1) yaw = spinYaw(yaw, 1 / 60);
  assert.ok(yaw >= 0 && yaw < Math.PI * 2, 'ten minutes later the angle is still bounded');
  assert.equal(spinYaw(0, 0), 0);
});
