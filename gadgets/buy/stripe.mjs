// Minimal Stripe REST client for Workers: no SDK, form-encoded bodies, WebCrypto signatures.

// Stripe expects nested objects as bracketed keys: line_items[0][price_data][currency]=usd
export function encodeForm(value, prefix = '', out = []) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) value.forEach((item, index) => encodeForm(item, `${prefix}[${index}]`, out));
  else if (typeof value === 'object') for (const [key, item] of Object.entries(value)) encodeForm(item, prefix ? `${prefix}[${key}]` : key, out);
  else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  return out;
}

export function stripeClient({ secretKey, fetch: doFetch = globalThis.fetch }) {
  async function request(method, path, params, { account, idempotencyKey } = {}) {
    const headers = { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': '2024-06-20' };
    if (account) headers['Stripe-Account'] = account;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let url = `https://api.stripe.com/v1${path}`, body;
    if (method === 'GET') { const query = encodeForm(params).join('&'); if (query) url += `?${query}`; }
    else { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = encodeForm(params).join('&'); }
    const response = await doFetch(url, { method, headers, body });
    const data = await response.json();
    if (!response.ok) throw new Error(`Stripe ${response.status}: ${data.error?.message || 'request failed'}`);
    return data;
  }
  return { get: (path, params, options) => request('GET', path, params, options), post: (path, params, options) => request('POST', path, params, options) };
}

const encoder = new TextEncoder();
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verifies a Stripe-Signature header against the raw body. Returns the parsed event or throws.
export async function verifyWebhook({ payload, header, secret, toleranceSeconds = 300, now = Date.now() }) {
  const parts = Object.fromEntries((header || '').split(',').map(part => part.split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k.trim(), v.trim()]));
  const timestamp = Number(parts.t);
  if (!timestamp || !parts.v1) throw new Error('Malformed signature header');
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) throw new Error('Signature timestamp outside tolerance');
  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  const candidates = (header.match(/v1=([0-9a-f]+)/g) || []).map(s => s.slice(3));
  if (!candidates.some(candidate => timingSafeEqual(candidate, expected))) throw new Error('Signature mismatch');
  return JSON.parse(payload);
}

// Signs a Stripe-style header for tests and local tools.
export async function signPayload({ payload, secret, timestamp = Math.floor(Date.now() / 1000) }) {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${payload}`)}`;
}

// Short tokens that let a maker act on one order from an email link, without an account.
export async function orderToken(secret, orderId, purpose) {
  return (await hmacHex(secret, `${purpose}:${orderId}`)).slice(0, 32);
}
export async function checkOrderToken(secret, orderId, purpose, token) {
  return typeof token === 'string' && timingSafeEqual(token, await orderToken(secret, orderId, purpose));
}
