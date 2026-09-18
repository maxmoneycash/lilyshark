import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../buy/worker.mjs';
import { signPayload, encodeForm, verifyWebhook } from '../buy/stripe.mjs';
import { validateListings, activeListing, platformFee } from '../src/listings.mjs';

const listings = {
  platformFeeBps: 500,
  makers: [{ id: 'acme', name: 'Acme Radios', email: 'orders@acme.test', account: 'acct_123' }, { id: 'nobody', name: 'No Account', email: 'x@y.test', account: null }],
  listings: [
    { slug: 'widget', name: 'Widget', maker: 'acme', active: true, priceCents: 12000, currency: 'usd', stock: 2, shipping: { US: 800, DE: 1500 }, leadTime: 'Ships in 2 days' },
    { slug: 'orphan', name: 'Orphan', maker: 'nobody', active: true, priceCents: 5000, currency: 'usd', stock: 1, shipping: { US: 500 } },
    { slug: 'paused', name: 'Paused', maker: 'acme', active: false, priceCents: 5000, currency: 'usd', stock: 1, shipping: { US: 500 } }
  ]
};
const catalog = [{ slug: 'widget' }, { slug: 'orphan' }, { slug: 'paused' }];

function memoryKV() { const map = new Map(); return { map, get: async k => map.has(k) ? map.get(k) : null, put: async (k, v) => { map.set(k, v); } }; }
function env(overrides = {}) {
  return { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', ORDER_TOKEN_SECRET: 'tok', ADMIN_KEY: 'admin', RESEND_API_KEY: 're_x', SITE_ORIGIN: 'https://gadgets.sh', ORDERS_FROM: 'orders@gadgets.sh', ORDERS: memoryKV(), ...overrides };
}
function mockFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [pattern, reply] of routes) if (url.includes(pattern)) { const r = typeof reply === 'function' ? reply(url, init) : reply; return new Response(JSON.stringify(r.body ?? r), { status: r.status || 200 }); }
    throw new Error(`Unexpected fetch ${url}`);
  };
  return { fetch, calls };
}
const req = (path, init = {}) => new Request(`https://buy.gadgets.sh${path}`, { headers: { Origin: 'https://gadgets.sh', ...(init.headers || {}) }, ...init });

test('listings validate and only active, stocked, connected listings are sold', () => {
  assert.throws(() => validateListings(listings, catalog), /orphan: active listing needs a connected maker account/);
  validateListings({ ...listings, listings: listings.listings.filter(l => l.slug !== 'orphan') }, catalog);
  assert.ok(activeListing(listings, 'widget'));
  assert.equal(activeListing(listings, 'orphan'), null, 'maker without account is never sold even if the data slipped through');
  assert.equal(activeListing(listings, 'paused'), null);
  assert.equal(platformFee(12000, 500), 600);
  assert.throws(() => validateListings({ ...listings, listings: [{ ...listings.listings[0], slug: 'ghost' }] }, catalog), /unknown device/);
  assert.throws(() => validateListings({ ...listings, listings: [{ ...listings.listings[0], shipping: { usa: 100 } }] }, catalog), /bad shipping/);
});

test('form encoding nests keys the way Stripe expects', () => {
  assert.equal(encodeForm({ a: 1, b: { c: 'x y' }, d: [{ e: 2 }] }).join('&'), 'a=1&b%5Bc%5D=x%20y&d%5B0%5D%5Be%5D=2');
});

test('checkout creates a direct-charge session on the maker account with the platform fee', async () => {
  const { fetch, calls } = mockFetch([['/v1/checkout/sessions', { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' }]]);
  const handle = createHandler({ listings, fetch });
  const response = await handle(req('/checkout', { method: 'POST', body: JSON.stringify({ slug: 'widget' }) }), env());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, 'https://checkout.stripe.com/c/cs_test_1');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://gadgets.sh');
  const call = calls[0];
  assert.equal(call.init.headers['Stripe-Account'], 'acct_123');
  const params = new URLSearchParams(call.init.body);
  assert.equal(params.get('payment_intent_data[application_fee_amount]'), '600');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '12000');
  assert.equal(params.get('shipping_address_collection[allowed_countries][0]'), 'US');
  assert.equal(params.get('shipping_options[1][shipping_rate_data][fixed_amount][amount]'), '1500');
  assert.equal(params.get('success_url'), 'https://gadgets.sh/buy/thanks/?session={CHECKOUT_SESSION_ID}');
});

test('checkout refuses unknown, paused, unconnected and sold-out listings', async () => {
  const { fetch } = mockFetch([]);
  const handle = createHandler({ listings, fetch });
  for (const slug of ['nope', 'paused', 'orphan']) assert.equal((await handle(req('/checkout', { method: 'POST', body: JSON.stringify({ slug }) }), env())).status, 404, slug);
  const e = env(); await e.ORDERS.put('sold:widget', '2');
  assert.equal((await handle(req('/checkout', { method: 'POST', body: JSON.stringify({ slug: 'widget' }) }), e)).status, 409);
});

test('webhook records the order once, counts stock, and emails maker and buyer', async () => {
  const { fetch, calls } = mockFetch([['api.resend.com', { id: 'email' }]]);
  const now = () => Date.parse('2026-09-17T12:00:00Z');
  const handle = createHandler({ listings, fetch, now });
  const e = env();
  const session = { id: 'cs_test_abcdefghijkl', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 12800, currency: 'usd', metadata: { slug: 'widget', maker: 'acme' }, customer_details: { email: 'buyer@example.test', name: 'Bo Buyer' }, shipping_details: { name: 'Bo Buyer', address: { line1: '1 Main St', city: 'Denver', state: 'CO', postal_code: '80202', country: 'US' } } };
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', account: 'acct_123', data: { object: session } });
  const header = await signPayload({ payload, secret: 'whsec_test', timestamp: Math.floor(now() / 1000) });
  const first = await handle(req('/webhook', { method: 'POST', body: payload, headers: { 'Stripe-Signature': header } }), e);
  assert.equal(first.status, 200);
  const { order } = await first.json();
  assert.equal(order, 'o-cs_test_abcd'.replace('cs_test_abcd', 'abcdefghijkl'));
  const stored = JSON.parse(await e.ORDERS.get(`order:${order}`));
  assert.equal(stored.buyer.address.city, 'Denver');
  assert.equal(stored.applicationFee, 600);
  assert.equal(await e.ORDERS.get('sold:widget'), '1');
  const emails = calls.filter(c => c.url.includes('resend')).map(c => JSON.parse(c.init.body));
  assert.deepEqual(emails.map(m => m.to[0]), ['orders@acme.test', 'buyer@example.test']);
  assert.match(emails[0].text, /1 Main St[\s\S]*Denver/);
  assert.match(emails[0].text, /\/orders\/o-abcdefghijkl\/ship\?token=[0-9a-f]{32}/);
  // Replay is ignored.
  const again = await handle(req('/webhook', { method: 'POST', body: payload, headers: { 'Stripe-Signature': header } }), e);
  assert.equal((await again.json()).duplicate, true);
  assert.equal(await e.ORDERS.get('sold:widget'), '1');
  // Lookup for the thanks page.
  const lookup = await handle(req('/orders/lookup?session=cs_test_abcdefghijkl'), e);
  assert.equal((await lookup.json()).total, '$128.00');
});

test('webhook rejects bad signatures and stale timestamps', async () => {
  const handle = createHandler({ listings, fetch: mockFetch([]).fetch });
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
  const bad = await handle(req('/webhook', { method: 'POST', body: payload, headers: { 'Stripe-Signature': 't=1,v1=00' } }), env());
  assert.equal(bad.status, 400);
  const header = await signPayload({ payload, secret: 'whsec_test', timestamp: Math.floor(Date.now() / 1000) - 3600 });
  await assert.rejects(verifyWebhook({ payload, header, secret: 'whsec_test' }), /tolerance/);
});

test('ship link needs the token, records tracking once, and emails the buyer', async () => {
  const { fetch, calls } = mockFetch([['api.resend.com', { id: 'email' }]]);
  const handle = createHandler({ listings, fetch });
  const e = env();
  const order = { id: 'o-1', slug: 'widget', maker: 'acme', amountTotal: 12800, currency: 'usd', buyer: { email: 'buyer@example.test', name: 'Bo', address: { country: 'US' } }, shippedAt: null, tracking: null };
  await e.ORDERS.put('order:o-1', JSON.stringify(order));
  assert.equal((await handle(req('/orders/o-1/ship?token=wrong'), e)).status, 403);
  const { orderToken } = await import('../buy/stripe.mjs');
  const token = await orderToken('tok', 'o-1', 'ship');
  const form = await handle(req(`/orders/o-1/ship?token=${token}`), e);
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Mark order o-1 as shipped/);
  const body = new URLSearchParams({ tracking: '1Z999' });
  const done = await handle(req(`/orders/o-1/ship?token=${token}`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), e);
  assert.equal(done.status, 200);
  assert.equal(JSON.parse(await e.ORDERS.get('order:o-1')).tracking, '1Z999');
  assert.equal(JSON.parse(calls.at(-1).init.body).to[0], 'buyer@example.test');
  const twice = await handle(req(`/orders/o-1/ship?token=${token}`, { method: 'POST', body: new URLSearchParams({ tracking: 'X' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), e);
  assert.match(await twice.text(), /Already marked shipped/);
});

test('onboarding is admin-only and creates an Express account once', async () => {
  const { fetch, calls } = mockFetch([['/v1/accounts', { id: 'acct_new' }], ['/v1/account_links', { url: 'https://connect.stripe.com/setup/x' }]]);
  const handle = createHandler({ listings, fetch });
  const e = env();
  assert.equal((await handle(req('/connect/start?maker=nobody&key=wrong'), e)).status, 403);
  const go = await handle(req('/connect/start?maker=nobody&key=admin'), e);
  assert.equal(go.status, 303);
  assert.equal(go.headers.get('Location'), 'https://connect.stripe.com/setup/x');
  assert.equal(await e.ORDERS.get('maker:nobody'), 'acct_new');
  await handle(req('/connect/start?maker=nobody&key=admin'), e);
  assert.equal(calls.filter(c => c.url.endsWith('/v1/accounts')).length, 1, 'account reused');
});
