import assert from 'node:assert/strict';
import test from 'node:test';
import { DIRECTORY_SOURCE, directoryRoleLabel, parseDirectory, parseDirectorySnapshot } from './communityDirectory';
const key = 'ab'.repeat(32);
const row = { public_key: key, type: 1, adv_lat: 37.8, adv_lon: -122.2, adv_name: 'Trail contact', last_advert: '2024-01-02T00:00:00Z', updated_date: '2026-09-16T00:00:00Z' };

test('public directory includes every MeshCore role with full published identities', () => {
  const nodes = parseDirectory([1, 2, 3, 4].map(type => ({ ...row, type, public_key: String(type).repeat(64) })));
  assert.deepEqual(nodes.map(n => directoryRoleLabel(n.type)), ['Contact', 'Repeater', 'Room', 'Sensor']);
  assert.ok(nodes.every(n => n.hex.length === 64 && n.directory));
});

test('missing, malformed and prefix-only identities cannot produce a pin', () => {
  const nodes = parseDirectory([row, ...[undefined, '', 'ab', 'zz'.repeat(32), '0'.repeat(64)].map(public_key => ({ ...row, public_key }))]);
  assert.equal(nodes.length, 1);
  for (const bad of [null, {}, 'upstream error']) assert.throws(() => parseDirectory(bad));
  assert.throws(() => parseDirectory([{ ...row, public_key: 'ab' }]));
  assert.deepEqual(parseDirectory([]), []);
});

test('invalid and unknown positions or roles are omitted', () => {
  const nodes = parseDirectory([row,
    { ...row, adv_lat: 0, adv_lon: 0 }, { ...row, adv_lat: 91 },
    { ...row, adv_lon: Infinity }, { ...row, adv_lat: '37.8' },
    { ...row, type: 99 }, { ...row, type: '2' },
  ]);
  assert.equal(nodes.length, 1);
});

test('duplicate keys keep the newest record without redating its advertisement', () => {
  const nodes = parseDirectory([{ ...row, public_key: key.toUpperCase(), adv_name: 'Older record', updated_date: '2025-01-01T00:00:00Z' }, row]);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, 'Trail contact');
  assert.equal(nodes[0].hex, key);
  assert.equal(nodes[0].last_heard, Date.parse(row.last_advert) / 1000);
  assert.equal(nodes[0].updatedAt, Date.parse(row.updated_date) / 1000);
});

test('directory snapshots preserve source, dates and all roles on a cold load', () => {
  const snapshot = { at: Date.now(), nodes: parseDirectory([row]), source: DIRECTORY_SOURCE };
  assert.deepEqual(parseDirectorySnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  assert.throws(() => parseDirectorySnapshot({ ...snapshot, source: 'https://example.com' }));
  assert.throws(() => parseDirectorySnapshot({ ...snapshot, at: snapshot.at + 120000 }, snapshot.at));
  assert.throws(() => parseDirectorySnapshot({ ...snapshot, nodes: [{ hex: 'invented', lat: 37.8, lon: -122.2 }] }));
});
