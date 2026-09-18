import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVENTORY_KEY, normalizeInventory, readInventory, setInventoryQuantity,
  importKitInventory, inventoryHardware,
} from '../src/inventory.mjs';

const catalog = Array.from({ length: 12 }, (_, index) => ({ slug: `device-${index + 1}`, name: `Device ${index + 1}` }));
const envelope = quantities => ({ version: 1, quantities });
const failure = status => ({ inventory: null, quantities: {}, status });
function storage(raw) {
  return {
    getItem(key) { assert.equal(key, INVENTORY_KEY); return raw; },
    setItem() { assert.fail('Reading inventory must not write to storage.'); },
    removeItem() { assert.fail('Reading inventory must not delete storage.'); },
  };
}

test('read distinguishes missing, ready, invalid, unsupported and unavailable without writes', () => {
  assert.equal(INVENTORY_KEY, 'gadgets.inventory');
  assert.deepEqual(readInventory(storage(null), catalog), { inventory: envelope({}), quantities: {}, status: 'missing' });
  const inventory = envelope({ 'device-1': 3 });
  assert.deepEqual(readInventory(storage(JSON.stringify(inventory)), catalog), { inventory, quantities: inventory.quantities, status: 'ready' });
  for (const raw of ['', '{', 'null', '[]', 'false', '1', '{}', '{"version":"1","quantities":{}}', '{"version":0,"quantities":{}}', undefined, 42]) {
    assert.deepEqual(readInventory(storage(raw), catalog), failure('invalid'));
  }
  for (const version of [2, 99]) {
    assert.deepEqual(readInventory(storage(JSON.stringify({ version, futureData: {} })), catalog), failure('unsupported'));
  }
  assert.deepEqual(readInventory({ getItem() { throw new Error('Storage blocked'); } }, catalog), failure('unavailable'));
  assert.deepEqual(readInventory(null, catalog), failure('unavailable'));
});

test('invalid records reject the whole envelope without coercing quantities or pruning bytes', () => {
  for (const quantity of ['1', true, null, 0, -1, 1.5, 100, NaN, Infinity, {}, []]) {
    const value = envelope({ 'device-1': 2, 'device-2': quantity });
    assert.equal(normalizeInventory(value), null);
    assert.deepEqual(readInventory(storage(JSON.stringify(value)), catalog), failure('invalid'));
  }
  for (const quantities of [[], null, 'device-1', { 'Bad Slug': 1 }, { 'double--hyphen': 1 }, JSON.parse('{"__proto__":1}')]) {
    assert.equal(normalizeInventory(envelope(quantities)), null);
  }
  for (const value of [null, [], {}, { quantities: {} }, { version: 1 }, { version: 2, quantities: {} }]) assert.equal(normalizeInventory(value), null);
  const original = JSON.stringify(envelope({ 'device-1': 2, 'device-2': '3' }));
  const saved = storage(original);
  assert.equal(readInventory(saved, catalog).status, 'invalid');
  assert.equal(saved.getItem(INVENTORY_KEY), original);
});

test('oversized storage is left untouched and the 100000-character boundary is explicit', () => {
  const raw = JSON.stringify(envelope({ 'device-1': 1 }));
  const atLimit = raw.padEnd(100_000, ' ');
  assert.equal(readInventory(storage(atLimit), catalog).status, 'ready');
  const oversized = atLimit + ' ';
  const saved = storage(oversized);
  assert.deepEqual(readInventory(saved, catalog), failure('invalid'));
  assert.equal(saved.getItem(INVENTORY_KEY), oversized);
});

test('unknown valid devices survive reads and edits and can rejoin a future catalog', () => {
  const original = envelope({ 'retired-board': 4, 'device-1': 2 });
  const read = readInventory(storage(JSON.stringify(original)), catalog);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.inventory, original);
  assert.deepEqual(read.quantities, { 'device-1': 2 });
  const changed = setInventoryQuantity(read.inventory, 'retired-board', 7, catalog);
  assert.equal(changed.quantities['retired-board'], 7);
  assert.equal(original.quantities['retired-board'], 4);
  assert.deepEqual(inventoryHardware(changed, [...catalog, { slug: 'retired-board' }]), changed.quantities);
  const removed = setInventoryQuantity(changed, 'retired-board', 0, catalog);
  assert.deepEqual(removed.quantities, { 'device-1': 2 });
  assert.equal(changed.quantities['retired-board'], 7);
  for (const quantity of [0, 1]) assert.throws(() => setInventoryQuantity(original, 'invented-board', quantity, catalog), RangeError);
});

test('quantity edits are immutable, strict, removable and have no six-device cap', () => {
  const empty = Object.freeze({ version: 1, quantities: Object.freeze({}) });
  let inventory = empty;
  for (const [index, device] of catalog.entries()) inventory = setInventoryQuantity(inventory, device.slug, index + 1, catalog);
  assert.equal(Object.keys(inventory.quantities).length, 12);
  assert.deepEqual(empty, envelope({}));
  const before = structuredClone(inventory);
  const updated = setInventoryQuantity(inventory, 'device-1', 99, catalog);
  assert.equal(updated.quantities['device-1'], 99);
  assert.deepEqual(inventory, before);
  const removed = setInventoryQuantity(updated, 'device-1', 0, catalog);
  assert.ok(!Object.hasOwn(removed.quantities, 'device-1'));
  assert.equal(updated.quantities['device-1'], 99);
  assert.deepEqual(setInventoryQuantity(empty, 'device-1', 0, catalog), empty);
  for (const quantity of ['2', null, undefined, true, {}, []]) assert.throws(() => setInventoryQuantity(inventory, 'device-1', quantity, catalog), TypeError);
  for (const quantity of [-1, 100, 1.5, NaN, Infinity]) assert.throws(() => setInventoryQuantity(inventory, 'device-1', quantity, catalog), RangeError);
  for (const slug of ['', 'Device-1', '../device-1', '__proto__', null, {}]) assert.throws(() => setInventoryQuantity(inventory, slug, 1, catalog), TypeError);
  assert.throws(() => setInventoryQuantity(null, 'device-1', 1, catalog), TypeError);
  assert.deepEqual(inventory, before);
});

test('kit import is explicit, additive, idempotent and preserves existing quantities', () => {
  const original = Object.freeze({ version: 1, quantities: Object.freeze({ 'device-1': 7, 'retired-board': 4 }) });
  const kit = {
    devices: ['device-1', 'device-2', 'device-2', 'device-3', 'device-4', 'device-5', 'not-in-catalog'],
    items: {
      'device-1': { state: 'have', quantity: 2 },
      'device-2': { state: 'have', quantity: 3 },
      'device-3': { state: 'need', quantity: 5 },
      'device-4': { state: 'considering', quantity: 8 },
      'device-5': { state: 'have' },
      'device-6': { state: 'have', quantity: 10 },
      'not-in-catalog': { state: 'have', quantity: 9 },
    },
  };
  const before = structuredClone(kit);
  const first = importKitInventory(original, kit, catalog);
  assert.deepEqual(first.added, ['device-2', 'device-5']);
  assert.deepEqual(first.kept, ['device-1']);
  assert.deepEqual(first.inventory, envelope({ 'device-1': 7, 'retired-board': 4, 'device-2': 3, 'device-5': 1 }));
  assert.deepEqual(original, envelope({ 'device-1': 7, 'retired-board': 4 }));
  assert.deepEqual(kit, before);
  const second = importKitInventory(first.inventory, kit, catalog);
  assert.deepEqual(second.inventory, first.inventory);
  assert.notEqual(second.inventory, first.inventory);
  assert.notEqual(second.inventory.quantities, first.inventory.quantities);
  assert.deepEqual(second.added, []);
  assert.deepEqual(second.kept, ['device-1', 'device-2', 'device-5']);
});

test('malformed or inherited kit fields cannot manufacture ownership', () => {
  const empty = envelope({});
  const kitFor = item => ({ devices: ['device-1'], items: { 'device-1': item } });
  for (const quantity of ['2', true, null, 0, -1, 1.5, 100, NaN, Infinity, {}, []]) assert.deepEqual(importKitInventory(empty, kitFor({ state: 'have', quantity }), catalog).inventory, empty);
  for (const item of [null, [], {}, { state: true }, { state: 'Have it' }, { state: { toString() { return 'have'; } } }, Object.create({ state: 'have', quantity: 9 })]) assert.deepEqual(importKitInventory(empty, kitFor(item), catalog).added, []);
  for (const kit of [null, [], {}, { devices: ['device-1'] }, { items: { 'device-1': { state: 'have' } } }, Object.create({ devices: ['device-1'], items: { 'device-1': { state: 'have' } } })]) assert.deepEqual(importKitInventory(empty, kit, catalog), { inventory: empty, added: [], kept: [] });
  const inheritedItems = Object.create({ 'device-1': { state: 'have', quantity: 9 } });
  assert.deepEqual(importKitInventory(empty, { devices: ['device-1'], items: inheritedItems }, catalog).added, []);
  assert.throws(() => importKitInventory(null, kitFor({ state: 'have' }), catalog), TypeError);
});

test('all explicit known kit devices can import without the setup editor cap', () => {
  const kit = { devices: catalog.map(d => d.slug), items: Object.fromEntries(catalog.map((d, index) => [d.slug, { state: 'have', quantity: index + 1 }])) };
  const result = importKitInventory(envelope({}), kit, catalog);
  assert.equal(result.added.length, 12);
  assert.deepEqual(inventoryHardware(result.inventory, catalog), Object.fromEntries(catalog.map((d, index) => [d.slug, index + 1])));
});

test('prototype-named records are own data, while inherited data is rejected', () => {
  const original = JSON.parse('{"version":1,"quantities":{"constructor":2,"prototype":3,"device-1":1}}');
  const normalized = normalizeInventory(original);
  assert.ok(Object.hasOwn(normalized.quantities, 'constructor'));
  assert.equal(Object.getPrototypeOf(normalized.quantities), Object.prototype);
  assert.deepEqual(inventoryHardware(normalized, catalog), { 'device-1': 1 });
  assert.equal(setInventoryQuantity(normalized, 'constructor', 4, catalog).quantities.constructor, 4);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(normalizeInventory(Object.create({ version: 1, quantities: {} })), null);
  assert.equal(normalizeInventory(envelope(Object.create({ 'device-1': 99 }))), null);
  const nullPrototype = Object.assign(Object.create(null), { 'device-1': 2 });
  assert.deepEqual(normalizeInventory(envelope(nullPrototype)), envelope({ 'device-1': 2 }));
});

test('known quantities and normalization return copies without mutating stored records', () => {
  const original = envelope({ 'device-1': 2, 'retired-board': 8 });
  const read = readInventory(storage(JSON.stringify(original)), catalog);
  read.quantities['device-1'] = 9;
  assert.equal(read.inventory.quantities['device-1'], 2);
  const normalized = normalizeInventory(original);
  normalized.quantities['retired-board'] = 3;
  assert.equal(original.quantities['retired-board'], 8);
  for (const value of [null, envelope({ 'device-1': '2' }), { version: 2, quantities: { 'device-1': 2 } }]) assert.deepEqual(inventoryHardware(value, catalog), {});
});
