import { normalizeHardwareQuantities } from './build-projects.mjs';

export const INVENTORY_KEY = 'gadgets.inventory';
const STORAGE_LIMIT = 100_000;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugOK = value => typeof value === 'string' && slugPattern.test(value);
const quantityOK = value => Number.isInteger(value) && value >= 1 && value <= 99;
const record = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const emptyInventory = () => ({ version: 1, quantities: {} });

// Reject the whole envelope rather than silently deleting an invalid record.
// Catalog membership is deliberately not part of stored-data validation.
export function normalizeInventory(value) {
  if (!record(value) || !Object.hasOwn(value, 'version') || value.version !== 1 || !Object.hasOwn(value, 'quantities') || !record(value.quantities)) return null;
  const entries = Object.entries(value.quantities);
  if (!entries.every(([slug, quantity]) => slugOK(slug) && quantityOK(quantity))) return null;
  return { version: 1, quantities: Object.fromEntries(entries) };
}

// This helper can accept UI quantity strings, so only pass strictly validated
// inventory data to it. It supplies the same catalog matching as build finder.
export function inventoryHardware(inventory, catalog) {
  const normalized = normalizeInventory(inventory);
  return normalized ? normalizeHardwareQuantities(normalized.quantities, catalog) : {};
}

export function readInventory(storage, catalog) {
  const failure = status => ({ inventory: null, quantities: {}, status });
  let raw;
  try { raw = storage.getItem(INVENTORY_KEY); }
  catch { return failure('unavailable'); }
  if (raw === null) return { inventory: emptyInventory(), quantities: {}, status: 'missing' };
  if (typeof raw !== 'string' || raw.length > STORAGE_LIMIT) return failure('invalid');
  let value;
  try { value = JSON.parse(raw); }
  catch { return failure('invalid'); }
  if (record(value) && Object.hasOwn(value, 'version') && Number.isSafeInteger(value.version) && value.version > 1) return failure('unsupported');
  const inventory = normalizeInventory(value);
  return inventory ? { inventory, quantities: inventoryHardware(inventory, catalog), status: 'ready' } : failure('invalid');
}

function requireInventory(value) {
  const inventory = normalizeInventory(value);
  if (!inventory) throw new TypeError('A valid version 1 inventory is required.');
  return inventory;
}

export function setInventoryQuantity(value, slug, quantity, catalog) {
  const inventory = requireInventory(value);
  if (!slugOK(slug)) throw new TypeError('A valid device slug is required.');
  if (typeof quantity !== 'number') throw new TypeError('Quantity must be a number.');
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) throw new RangeError('Quantity must be an integer from 0 to 99.');
  const known = normalizeHardwareQuantities({ [slug]: 1 }, catalog);
  if (!Object.hasOwn(known, slug) && !Object.hasOwn(inventory.quantities, slug)) throw new RangeError('New inventory devices must exist in the catalog.');
  if (quantity === 0) delete inventory.quantities[slug];
  else inventory.quantities[slug] = quantity;
  return inventory;
}

export function importKitInventory(value, kit, catalog) {
  const inventory = requireInventory(value), added = [], kept = [];
  if (!record(kit) || !Object.hasOwn(kit, 'devices') || !Array.isArray(kit.devices) || !Object.hasOwn(kit, 'items') || !record(kit.items)) return { inventory, added, kept };
  const entries = [];
  for (const slug of new Set(kit.devices)) {
    if (!slugOK(slug) || !Object.hasOwn(kit.items, slug)) continue;
    const item = kit.items[slug];
    if (!record(item) || !Object.hasOwn(item, 'state') || item.state !== 'have') continue;
    // Legacy setup items can omit quantity; an explicitly malformed quantity
    // must not be normalized into an ownership claim.
    const quantity = Object.hasOwn(item, 'quantity') ? item.quantity : 1;
    if (quantityOK(quantity)) entries.push([slug, quantity]);
  }
  const owned = normalizeHardwareQuantities(Object.fromEntries(entries), catalog);
  for (const [slug, quantity] of Object.entries(owned)) {
    if (Object.hasOwn(inventory.quantities, slug)) kept.push(slug);
    else { inventory.quantities[slug] = quantity; added.push(slug); }
  }
  return { inventory, added, kept };
}
