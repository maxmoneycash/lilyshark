# "Buy on gadgets.sh" pilot

Decision (2026-09-17): payments run on Stripe Connect. The maker is the seller of record; gadgets.sh takes a platform fee. Whop and PayPal were considered and set aside; see the conversation notes in `docs/product-direction.md`.

## What the buyer sees

1. A **Buy on gadgets.sh** button on a device page, next to the price, only for devices whose maker has onboarded.
2. Stripe Checkout: card, Apple Pay, Google Pay, Link. Shipping address collected by Stripe. Shipping cost is a flat rate set by the maker per region.
3. A confirmation page on gadgets.sh and an email receipt from Stripe.
4. A shipping email when the maker marks it shipped, with the tracking number.

## What the maker does

1. Clicks an onboarding link once. Stripe's hosted flow collects identity, bank and tax details; we never see them.
2. Sets a price, stock count and per-region shipping rate for each device (a small form, or we do it for them at first).
3. Gets an email per order with the address and a **Mark as shipped** link. That link asks for a tracking number and triggers the buyer's email.
4. Receives payouts from Stripe on their own schedule. Refunds and disputes are theirs to handle in their Stripe dashboard, with us in copy.

## Money

- Charge type: **direct charge** on the maker's connected account with an `application_fee_amount`. The maker is merchant of record; Stripe's processing fee comes out of the maker's side.
- Platform fee: start at **5%** of the item price. Low enough that it undercuts Tindie-style marketplaces once processing is counted, high enough to be worth running. Revisit after ten orders.
- Sales tax: the maker's responsibility as seller of record. Stripe Tax can be turned on per connected account later.

## What has to be built

| Piece | Where | Size |
|---|---|---|
| Onboarding link + return page | Cloudflare Worker (`/connect/start`, `/connect/return`) | small |
| Checkout session creation | Worker (`POST /checkout`), called by the Buy button | small |
| Stripe webhook: `checkout.session.completed` → order record, maker email, buyer confirmation | Worker + KV (or D1) for orders | medium |
| Mark-as-shipped page and buyer shipping email | Worker (`/orders/:id/ship?token=…`) | small |
| Buy button + confirmation page on the static site | `src/templates.mjs`, `public/buy.js` | small |
| Maker price/stock/shipping table | `data/listings.json` at first; a form later | small |
| Email sending | Resend or Postmark from the Worker | small |

No accounts, no login, no cart: one device per checkout. Orders live in the Worker's storage and in Stripe.

## What only Max can supply

- A Stripe account (individual is fine to start; see the LLC note) and its API keys. Test mode first.
- The first three to five makers, and an intro to each.
- A sending email address for order emails (e.g. orders@gadgets.sh).
- A hosted URL for the site and the Worker; the preview is local today.

## Order of work

1. Build and test everything against Stripe test mode with a fake connected account. No real money.
2. Onboard one friendly maker with one device. Place one real order ourselves.
3. Add the next makers only after the first order has shipped and been delivered.

## Rules

- Never show a Buy button for a device the maker hasn't priced and stocked.
- Never take payment for a device we cannot route to a maker.
- The disclosure near the button says plainly that the maker ships it and gadgets.sh takes a fee.
- Affiliate links and Buy buttons don't compete on the same page: if the maker sells through us, the affiliate link is not shown.
