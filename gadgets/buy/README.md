# Checkout worker

A Cloudflare Worker that lets buyers pay for a device on gadgets.sh while the maker ships it and gets paid. Design and rules: `../docs/buy-pilot.md`.

## One-time setup

1. **Stripe account** (individual or company). In the dashboard, enable Connect and choose Express accounts. Copy the secret key (`sk_test_…` first).
2. **Resend account** for order emails; verify the sending domain and copy the API key.
3. `cd gadgets/buy && npx wrangler login`
4. `npx wrangler kv namespace create ORDERS` and paste the id into `wrangler.toml`.
5. Secrets: `npx wrangler secret put STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (after step 7), `ORDER_TOKEN_SECRET`, `ADMIN_KEY`, `RESEND_API_KEY`.
6. `npx wrangler deploy` → note the worker URL.
7. In Stripe, add a webhook endpoint `https://<worker>/webhook` for the event `checkout.session.completed`, **listening on connected accounts**. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
8. In `scripts/build.mjs`, set `BUY_ENDPOINT` (or the `GADGETS_BUY_ENDPOINT` env var) to the worker URL and rebuild the site.

## Adding a maker

1. Add them to `makers` in `data/listings.json` with `"account": null`.
2. Send them `https://<worker>/connect/start?maker=<id>&key=<ADMIN_KEY>`. Stripe collects their details; they land on `/connect/return`, which shows the account id.
3. Put that id in `account`, add their device under `listings` with price, stock and shipping, set `"active": true`, rebuild. The Buy button appears.

## Local testing

`npm test` covers the worker with Stripe and email mocked. To exercise real Stripe test mode: `npx wrangler dev` with test keys and `stripe listen --forward-to localhost:8787/webhook`.
