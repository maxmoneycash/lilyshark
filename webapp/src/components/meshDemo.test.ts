import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MESH_DEMO_COPY,
  MESH_DEMO_NODES,
  MESH_DEMO_REDUCED_MOTION_PROGRESS,
  MESH_FLOOD_LINKS,
  MESH_ROUTE,
  meshDemoProgress,
  meshDemoPulses,
} from './meshDemo.ts';

test('the demo keeps a labelled you/peer pair and a three-hop MeshCore path', () => {
  assert.equal(MESH_DEMO_NODES[0].label, 'You');
  assert.equal(MESH_DEMO_NODES.at(-1)?.label, 'Peer');
  assert.deepEqual([...MESH_ROUTE], [0, 2, 5, 6]);
  assert.equal(MESH_FLOOD_LINKS.filter((link) => link.wave === 0).length, 2);
});

test('flood mid-cycle has several simultaneous rebroadcasts; routed has one hop', () => {
  const flood = meshDemoPulses('flood', MESH_DEMO_REDUCED_MOTION_PROGRESS);
  const routed = meshDemoPulses('routed', MESH_DEMO_REDUCED_MOTION_PROGRESS);
  assert.ok(flood.length >= 3, `expected a flood wave, got ${flood.length}`);
  assert.equal(new Set(flood.map((pulse) => pulse.kind)).size, 1);
  assert.equal(routed.length, 1);
  assert.equal(routed[0].kind, 'packet');
  assert.equal(routed[0].from, 2);
  assert.equal(routed[0].to, 5);
});

test('a MeshCore receipt travels home after the outbound hops', () => {
  const receipt = meshDemoPulses('routed', 0.70);
  assert.equal(receipt.length, 1);
  assert.equal(receipt[0].kind, 'receipt');
  assert.equal(receipt[0].from, 6);
  assert.equal(receipt[0].to, 5);
  assert.deepEqual(meshDemoPulses('routed', 0.02), []);
  assert.deepEqual(meshDemoPulses('flood', 0.02), []);
});

test('progress wraps a cycle and clamps invalid values', () => {
  assert.equal(meshDemoProgress(0, 4000), 0);
  assert.equal(meshDemoProgress(2000, 4000), 0.5);
  assert.equal(meshDemoProgress(4000, 4000), 0);
  assert.equal(meshDemoProgress(-1000, 4000), 0.75);
  assert.equal(meshDemoProgress(Number.NaN), 0);
  assert.deepEqual(meshDemoPulses('flood', Number.NaN), []);
  assert.deepEqual(meshDemoPulses('routed', 2), []);
});

test('the captions name both stacks without replacing the intro chapters', () => {
  assert.match(MESH_DEMO_COPY.flood.title, /Meshtastic/);
  assert.match(MESH_DEMO_COPY.routed.title, /MeshCore/);
  assert.match(MESH_DEMO_COPY.flood.body, /flood/i);
  assert.match(MESH_DEMO_COPY.routed.body, /receipt/i);
});
