import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeLoadedHistory, messageFromRow, messageToRow, nodeFromRow, nodeToRow } from './historyRecords';
import type { Message, NodeEntry, Waypoint } from './store';
import { saveMessage, saveNode } from './db';

const node = (patch: Partial<NodeEntry> = {}): NodeEntry => ({
  num: 7, longName: 'Field radio', shortName: 'FLD', lastHeard: 100, ...patch,
});
const message = (patch: Partial<Message> = {}): Message => ({
  id: 12, ts: 1000, convo: 'dm:7', from: 9, to: 7, channel: 0,
  text: 'At the trailhead', mine: true, state: 'failed', ...patch,
});

test('saved nodes retain simulation and internet origin, position time, and path', () => {
  const original = node({ viaSim: true, viaNet: true, lastAdvert: 80,
    lat: 37, lon: -122, hopsAway: 2, outPath: [4, 5], fav: true, ignored: false });
  const restored = nodeFromRow(structuredClone(nodeToRow(original)));
  for (const key of ['viaSim', 'viaNet', 'lastAdvert', 'lat', 'lon', 'hopsAway', 'outPath', 'fav', 'ignored'] as const) {
    assert.deepEqual(restored[key], original[key], key);
  }
});

test('saved identity does not restore volatile battery and radio reception as current', () => {
  const restored = nodeFromRow(nodeToRow(node({ batteryLevel: 50, snr: 12, rssi: -80 })));
  assert.equal(restored.batteryLevel, undefined);
  assert.equal(restored.snr, undefined);
  assert.equal(restored.rssi, undefined);
});

test('legacy node records remain readable without fabricating new provenance', () => {
  const restored = nodeFromRow({ num: 4, publicKey: null, type: null,
    longName: 'Saved contact', shortName: 'SAVE', lastHeard: 40,
    lat: null, lon: null, hopsAway: null, fav: 0, ignored: 0 });
  assert.equal(restored.publicKey, undefined);
  assert.equal(restored.viaSim, undefined);
  assert.equal(restored.viaNet, undefined);
  assert.equal(restored.lastHeard, 40);
});

test('message history preserves failure details and original reception measurements', () => {
  const original = message({ failureReason: 'Radio rejected this packet.', hops: 0, snr: -5, rssi: -120, replyId: 2 });
  const restored = messageFromRow(structuredClone(messageToRow(original)));
  for (const key of ['failureReason', 'hops', 'snr', 'rssi', 'replyId', 'state', 'ts'] as const) {
    assert.equal(restored[key], original[key], key);
  }
});

test('an interrupted outgoing queue is actionable without implying delivery or resending', () => {
  const restored = messageFromRow(messageToRow(message({ state: 'queued' })));
  assert.equal(restored.state, 'failed');
  assert.match(restored.failureReason!, /Delivery unknown/);
  assert.match(restored.failureReason!, /before retrying/);
  for (const state of ['sent', 'delivered', 'failed'] as const) {
    assert.equal(messageFromRow(messageToRow(message({ state }))).state, state);
  }
  assert.equal(messageFromRow(messageToRow(message({ mine: false, state: 'delivered' }))).state, 'delivered');
});

test('late history merges preserve live updates, stable saved fields, and message identity', () => {
  const waypoint: Waypoint = { id: 1, lat: 37, lon: -122, name: 'Saved', description: '', icon: 0, expire: 0, lockedTo: 0, from: 9 };
  const currentMessage = message({ state: 'delivered' });
  const merged = mergeLoadedHistory({
    nodes: new Map([[7, node({ lat: 37, lon: -122, viaNet: true, fav: true })]]),
    messages: [message(), message({ ts: 900, text: 'Earlier packet with same ID' })],
    waypoints: new Map([[1, waypoint]]),
  }, {
    nodes: new Map([[7, node({ longName: 'Updated name', lastHeard: 200, lat: undefined, viaNet: false, snr: 5 })], [8, node({ num: 8 })]]),
    messages: [currentMessage, message({ id: 13, ts: 1100 })],
    waypoints: new Map([[1, { ...waypoint, name: 'Edited while history loaded' }]]),
  });
  assert.equal(merged.nodes.size, 2);
  assert.equal(merged.nodes.get(7)?.lastHeard, 200);
  assert.equal(merged.nodes.get(7)?.lat, 37);
  assert.equal(merged.nodes.get(7)?.viaNet, false);
  assert.equal(merged.nodes.get(7)?.fav, true);
  assert.equal(merged.nodes.get(7)?.snr, 5);
  assert.deepEqual(merged.messages.map(m => m.ts), [900, 1000, 1100]);
  assert.equal(merged.messages[1], currentMessage);
  assert.equal(merged.waypoints.get(1)?.name, 'Edited while history loaded');
});

test('demo records never open or write the history database', async () => {
  // Node has no IndexedDB. A database access would throw and fail this test.
  await saveNode(node({ viaDemo: true }));
  await saveMessage(message({ viaDemo: true }));
});
