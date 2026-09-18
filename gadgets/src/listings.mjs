// Devices makers sell through gadgets.sh. Shared by the static build and the checkout worker.
const country = /^[A-Z]{2}$/;
export function validateListings(data, catalog) {
  if (!data || typeof data !== 'object') throw new Error('Listings must be an object');
  if (!Number.isInteger(data.platformFeeBps) || data.platformFeeBps < 0 || data.platformFeeBps > 3000) throw new Error('platformFeeBps must be 0–3000');
  const makers = new Map();
  for (const maker of data.makers || []) {
    if (!/^[a-z0-9-]+$/.test(maker.id) || makers.has(maker.id)) throw new Error('Invalid or duplicate maker id');
    if (!maker.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(maker.email || '')) throw new Error(`${maker.id}: maker needs a name and email`);
    if (maker.account !== null && !/^acct_[A-Za-z0-9]+$/.test(maker.account)) throw new Error(`${maker.id}: invalid Stripe account id`);
    makers.set(maker.id, maker);
  }
  const slugs = new Set(catalog.map(d => d.slug)), seen = new Set();
  for (const listing of data.listings || []) {
    const fail = reason => { throw new Error(`${listing.slug}: ${reason}`); };
    if (!slugs.has(listing.slug)) fail('unknown device');
    if (seen.has(listing.slug)) fail('duplicate listing');
    seen.add(listing.slug);
    if (!makers.has(listing.maker)) fail('unknown maker');
    if (typeof listing.active !== 'boolean') fail('active must be true or false');
    if (!Number.isInteger(listing.priceCents) || listing.priceCents < 100 || listing.priceCents > 1000000) fail('priceCents must be 100–1000000');
    if (!['usd', 'eur', 'gbp'].includes(listing.currency)) fail('currency must be usd, eur or gbp');
    if (!Number.isInteger(listing.stock) || listing.stock < 0 || listing.stock > 10000) fail('stock must be 0–10000');
    const shipping = Object.entries(listing.shipping || {});
    if (!shipping.length) fail('at least one shipping region');
    for (const [code, cents] of shipping) if (!country.test(code) || !Number.isInteger(cents) || cents < 0 || cents > 100000) fail(`bad shipping entry ${code}`);
    if (listing.active && !makers.get(listing.maker).account) fail('active listing needs a connected maker account');
  }
  return data;
}

export function activeListing(data, slug) {
  const listing = (data.listings || []).find(l => l.slug === slug && l.active && l.stock > 0);
  if (!listing) return null;
  const maker = data.makers.find(m => m.id === listing.maker);
  return maker?.account ? { ...listing, makerName: maker.name, makerEmail: maker.email, account: maker.account } : null;
}

export function formatMoney(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export function platformFee(priceCents, bps) {
  return Math.round(priceCents * bps / 10000);
}
