import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeNodeUpdate } from './nodeUpdates';
import { mergeLoadedHistory } from './historyRecords';
import type { NodeEntry } from './store';

const external: NodeEntry = { num: 12, longName: 'External name', shortName: 'EXT',
  lastHeard: 100, lat: 37, lon: -122, snr: 9, batteryLevel: 60,
  fav: true, viaNet: true, viaSim: false };

test('local edits preserve the source and its reported position', () => {
  const edited = mergeNodeUpdate({ ...external, viaSim: true }, { fav: false });
  assert.equal(edited.viaNet, true);
  assert.equal(edited.viaSim, true);
  assert.equal(edited.lat, 37);
  assert.equal(edited.fav, false);
});

test('real reception replaces external evidence without claiming its position', () => {
  for (const origin of [{ viaNet: true }, { viaSim: true }, { viaDemo: true }]) {
    const received = mergeNodeUpdate({ ...external, ...origin }, { lastHeard: 200, snr: 4 }, true);
    assert.equal(received.viaNet, false);
    assert.equal(received.viaSim, false);
    assert.equal(received.viaDemo, false);
    assert.equal(received.lat, undefined);
    assert.equal(received.lon, undefined);
    assert.equal(received.batteryLevel, undefined);
    assert.equal(received.snr, 4);
    assert.equal(received.fav, true);
  }
});

test('radio positions persist across later radio updates that omit coordinates', () => {
  const positioned = mergeNodeUpdate(external, { lat: 38, lon: -123, lastHeard: 200 }, true);
  const received = mergeNodeUpdate(positioned, { lastHeard: 300 }, true);
  assert.equal(received.lat, 38);
  assert.equal(received.lon, -123);
});

test('late history cannot put an old external position back onto a radio node', () => {
  const live = mergeNodeUpdate(external, { lastHeard: 200 }, true);
  const merged = mergeLoadedHistory({ nodes: new Map([[12, external]]), messages: [], waypoints: new Map() },
    { nodes: new Map([[12, live]]), messages: [], waypoints: new Map() });
  assert.equal(merged.nodes.get(12)?.viaNet, false);
  assert.equal(merged.nodes.get(12)?.lat, undefined);
  assert.equal(merged.nodes.get(12)?.lastHeard, 200);
});
