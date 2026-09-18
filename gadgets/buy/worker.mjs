// gadgets.sh checkout worker: Stripe Connect direct charges, one device per order.
// Routes:
//   GET  /connect/start?maker=ID&key=ADMIN_KEY   create/continue Stripe onboarding for a maker
//   GET  /connect/return?maker=ID                 status page after onboarding
//   POST /checkout {slug}                         create a Checkout Session, returns {url}
//   POST /webhook                                 Stripe events
//   GET  /orders/lookup?session=cs_…              buyer confirmation data
//   GET|POST /orders/:id/ship?token=…             maker marks an order shipped
import listingsData from '../data/listings.json' with { type: 'json' };
import { activeListing, platformFee, formatMoney } from '../src/listings.mjs';
import { stripeClient, verifyWebhook, orderToken, checkOrderToken } from './stripe.mjs';

export function createHandler({ listings = listingsData, fetch: doFetch = globalThis.fetch, now = () => Date.now() } = {}) {
  return async function handle(request, env) {
    const url = new URL(request.url), path = url.pathname.replace(/\/$/, '') || '/';
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const stripe = stripeClient({ secretKey: env.STRIPE_SECRET_KEY, fetch: doFetch });
    const ctx = { request, env, url, listings, stripe, cors, doFetch, now };
    try {
      if (path === '/connect/start' && request.method === 'GET') return connectStart(ctx);
      if (path === '/connect/return' && request.method === 'GET') return connectReturn(ctx);
      if (path === '/checkout' && request.method === 'POST') return checkout(ctx);
      if (path === '/webhook' && request.method === 'POST') return webhook(ctx);
      if (path === '/orders/lookup' && request.method === 'GET') return lookup(ctx);
      const ship = path.match(/^\/orders\/([a-z0-9-]+)\/ship$/);
      if (ship) return shipOrder(ctx, ship[1]);
      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: 'Something went wrong. Nothing was charged.' }, 500, cors);
    }
  };
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = new Set([env.SITE_ORIGIN, 'http://127.0.0.1:54644', 'http://localhost:54644'].filter(Boolean));
  return {
    'Access-Control-Allow-Origin': allowed.has(origin) ? origin : env.SITE_ORIGIN || '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const html = (body, status = 200) => new Response(page(body), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>gadgets.sh orders</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#111}h1{font-size:22px}label{display:block;margin:16px 0 6px}input{font:inherit;padding:8px;width:100%;box-sizing:border-box}button{font:inherit;padding:10px 16px;margin-top:16px}.muted{color:#666;font-size:14px}</style></head><body>${body}</body></html>`;

function makerById(listings, id) { return listings.makers.find(m => m.id === id) || null; }

// --- Onboarding -------------------------------------------------------------
async function connectStart({ url, env, listings, stripe }) {
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return html('<h1>Not allowed</h1>', 403);
  const maker = makerById(listings, url.searchParams.get('maker'));
  if (!maker) return html('<h1>Unknown maker</h1>', 404);
  let account = maker.account || await env.ORDERS.get(`maker:${maker.id}`);
  if (!account) {
    const created = await stripe.post('/accounts', { type: 'express', email: maker.email, business_profile: { name: maker.name, product_description: 'Hardware sold through gadgets.sh' }, capabilities: { card_payments: { requested: true }, transfers: { requested: true } }, metadata: { maker: maker.id } });
    account = created.id;
    await env.ORDERS.put(`maker:${maker.id}`, account);
  }
  const link = await stripe.post('/account_links', { account, type: 'account_onboarding', refresh_url: `${url.origin}/connect/start?maker=${maker.id}&key=${env.ADMIN_KEY}`, return_url: `${url.origin}/connect/return?maker=${maker.id}` });
  return Response.redirect(link.url, 303);
}

async function connectReturn({ url, env, listings, stripe }) {
  const maker = makerById(listings, url.searchParams.get('maker'));
  if (!maker) return html('<h1>Unknown maker</h1>', 404);
  const account = maker.account || await env.ORDERS.get(`maker:${maker.id}`);
  if (!account) return html('<h1>No Stripe account yet</h1>', 404);
  const info = await stripe.get(`/accounts/${account}`);
  const ready = info.charges_enabled && info.payouts_enabled;
  return html(`<h1>${esc(maker.name)} on gadgets.sh</h1><p>${ready ? 'Stripe is ready. Buyers can pay you.' : 'Stripe still needs some details before payouts can start. Reopen the onboarding link to finish.'}</p><p class="muted">Account ${esc(account)} · charges ${info.charges_enabled ? 'on' : 'off'} · payouts ${info.payouts_enabled ? 'on' : 'off'}</p><p class="muted">Add <code>"account": "${esc(account)}"</code> to this maker in data/listings.json so the site can show a Buy button.</p>`);
}

// --- Checkout ---------------------------------------------------------------
async function checkout({ request, env, url, listings, stripe, cors }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON with a slug.' }, 400, cors); }
  const listing = activeListing(listings, body?.slug);
  if (!listing) return json({ error: 'This device is not for sale through gadgets.sh right now.' }, 404, cors);
  const sold = Number(await env.ORDERS.get(`sold:${listing.slug}`)) || 0;
  if (sold >= listing.stock) return json({ error: 'Sold out. The maker will restock or you can buy from their site.' }, 409, cors);
  const site = env.SITE_ORIGIN || url.origin;
  const session = await stripe.post('/checkout/sessions', {
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: listing.currency, unit_amount: listing.priceCents, product_data: { name: listing.name || listing.slug, metadata: { slug: listing.slug } } } }],
    shipping_address_collection: { allowed_countries: Object.keys(listing.shipping) },
    shipping_options: Object.entries(listing.shipping).map(([country, cents]) => ({ shipping_rate_data: { type: 'fixed_amount', display_name: `Shipping to ${country}`, fixed_amount: { amount: cents, currency: listing.currency }, metadata: { country } } })),
    payment_intent_data: { application_fee_amount: platformFee(listing.priceCents, listings.platformFeeBps), metadata: { slug: listing.slug, maker: listing.maker } },
    metadata: { slug: listing.slug, maker: listing.maker },
    customer_creation: 'if_required',
    success_url: `${site}/buy/thanks/?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/devices/${listing.slug}/`
  }, { account: listing.account });
  return json({ url: session.url }, 200, cors);
}

// --- Webhook ----------------------------------------------------------------
async function webhook({ request, env, url, listings, stripe, doFetch, now }) {
  const payload = await request.text();
  let event;
  try { event = await verifyWebhook({ payload, header: request.headers.get('Stripe-Signature'), secret: env.STRIPE_WEBHOOK_SECRET, now: now() }); }
  catch (error) { return json({ error: error.message }, 400); }
  if (event.type !== 'checkout.session.completed') return json({ received: true, ignored: event.type });
  const session = event.data.object, account = event.account;
  if (session.payment_status !== 'paid') return json({ received: true, ignored: 'unpaid' });
  const slug = session.metadata?.slug, listing = listings.listings.find(l => l.slug === slug), maker = listing && makerById(listings, listing.maker);
  if (!listing || !maker) return json({ error: `No listing for session ${session.id}` }, 200);
  const id = `o-${session.id.slice(-12).toLowerCase()}`;
  if (await env.ORDERS.get(`order:${id}`)) return json({ received: true, duplicate: true });
  const details = session.shipping_details || session.collected_information?.shipping_details || {};
  const order = {
    id, sessionId: session.id, paymentIntent: session.payment_intent, account, slug, maker: maker.id,
    amountTotal: session.amount_total, currency: session.currency, applicationFee: platformFee(listing.priceCents, listings.platformFeeBps),
    buyer: { email: session.customer_details?.email || null, name: details.name || session.customer_details?.name || null, address: details.address || null },
    createdAt: new Date(now()).toISOString(), shippedAt: null, tracking: null
  };
  await env.ORDERS.put(`order:${id}`, JSON.stringify(order));
  await env.ORDERS.put(`session:${session.id}`, id);
  await env.ORDERS.put(`sold:${slug}`, String((Number(await env.ORDERS.get(`sold:${slug}`)) || 0) + 1));
  const shipUrl = `${url.origin}/orders/${id}/ship?token=${await orderToken(env.ORDER_TOKEN_SECRET, id, 'ship')}`;
  const addr = order.buyer.address ? [order.buyer.name, order.buyer.address.line1, order.buyer.address.line2, `${order.buyer.address.postal_code || ''} ${order.buyer.address.city || ''}`.trim(), order.buyer.address.state, order.buyer.address.country].filter(Boolean).join('\n') : 'No shipping address was collected.';
  const total = formatMoney(order.amountTotal, order.currency);
  await sendEmail(env, doFetch, { to: maker.email, subject: `New gadgets.sh order ${id}: ${listing.name || slug}`, text: `You have a new order through gadgets.sh.\n\nItem: ${listing.name || slug} × 1\nPaid: ${total} (Stripe fees and the gadgets.sh fee come out of this)\nOrder: ${id}\n\nShip to:\n${addr}\n\nBuyer email: ${order.buyer.email || 'not provided'}\n\nWhen it ships, add the tracking number here:\n${shipUrl}\n\nRefunds and disputes are handled from your Stripe dashboard. Reply to this email if anything is wrong with the order.` });
  if (order.buyer.email) await sendEmail(env, doFetch, { to: order.buyer.email, subject: `Your gadgets.sh order ${id}`, text: `Thanks for buying through gadgets.sh.\n\nItem: ${listing.name || slug}\nPaid: ${total}\nOrder: ${id}\n\n${maker.name} makes and ships this device. ${listing.leadTime || 'They will ship it soon'}, and you'll get another email with the tracking number.\n\nQuestions about the order go to ${maker.email}. gadgets.sh takes a small fee from each sale; it doesn't change the price.` });
  return json({ received: true, order: id });
}

// --- Buyer confirmation -----------------------------------------------------
async function lookup({ url, env, listings, cors }) {
  const sessionId = url.searchParams.get('session') || '';
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json({ error: 'Bad session' }, 400, cors);
  const id = await env.ORDERS.get(`session:${sessionId}`);
  const order = id && JSON.parse(await env.ORDERS.get(`order:${id}`));
  if (!order) return json({ pending: true }, 202, cors);
  const maker = makerById(listings, order.maker), listing = listings.listings.find(l => l.slug === order.slug);
  return json({ id: order.id, slug: order.slug, name: listing?.name || order.slug, maker: maker?.name, makerEmail: maker?.email, total: formatMoney(order.amountTotal, order.currency), leadTime: listing?.leadTime || null, email: order.buyer.email }, 200, cors);
}

// --- Shipping ---------------------------------------------------------------
async function shipOrder({ request, env, url, listings, doFetch, now }, id) {
  if (!(await checkOrderToken(env.ORDER_TOKEN_SECRET, id, 'ship', url.searchParams.get('token')))) return html('<h1>This link is not valid</h1><p class="muted">Use the link from the order email.</p>', 403);
  const raw = await env.ORDERS.get(`order:${id}`);
  if (!raw) return html('<h1>Order not found</h1>', 404);
  const order = JSON.parse(raw), listing = listings.listings.find(l => l.slug === order.slug), maker = makerById(listings, order.maker);
  if (request.method === 'GET') {
    if (order.shippedAt) return html(`<h1>Order ${esc(id)} already marked shipped</h1><p>Tracking: ${esc(order.tracking)}</p>`);
    return html(`<h1>Mark order ${esc(id)} as shipped</h1><p>${esc(listing?.name || order.slug)} to ${esc(order.buyer.name || 'the buyer')}, ${esc(order.buyer.address?.country || '')}.</p><form method="post"><label for="tracking">Tracking number or link</label><input id="tracking" name="tracking" required maxlength="200" autocomplete="off"><button type="submit">Send shipping email to the buyer</button></form>`);
  }
  if (request.method !== 'POST') return html('<h1>Method not allowed</h1>', 405);
  const form = await request.formData();
  const tracking = String(form.get('tracking') || '').trim().slice(0, 200);
  if (!tracking) return html('<h1>Add a tracking number first</h1>', 400);
  if (order.shippedAt) return html(`<h1>Already marked shipped</h1><p>Tracking: ${esc(order.tracking)}</p>`);
  order.shippedAt = new Date(now()).toISOString(); order.tracking = tracking;
  await env.ORDERS.put(`order:${id}`, JSON.stringify(order));
  if (order.buyer.email) await sendEmail(env, doFetch, { to: order.buyer.email, subject: `Your gadgets.sh order ${id} has shipped`, text: `${maker?.name || 'The maker'} has shipped your ${listing?.name || order.slug}.\n\nTracking: ${tracking}\n\nQuestions go to ${maker?.email || 'the maker'}.` });
  return html(`<h1>Done</h1><p>Order ${esc(id)} is marked shipped and the buyer has been emailed.</p>`);
}

// --- Email ------------------------------------------------------------------
async function sendEmail(env, doFetch, { to, subject, text }) {
  if (!env.RESEND_API_KEY) { console.log(`[email not sent: no RESEND_API_KEY] to=${to} subject=${subject}`); return false; }
  const response = await doFetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.ORDERS_FROM || 'gadgets.sh <orders@gadgets.sh>', to: [to], subject, text }) });
  if (!response.ok) console.error(`Email to ${to} failed: ${response.status}`);
  return response.ok;
}

export default { fetch: createHandler() };
