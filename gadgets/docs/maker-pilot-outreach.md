# Buy-button pilot: first maker outreach

Send from a real address (orders@gadgets.sh or Max's own). One maker per email, personalised first line. Keep it under 150 words; makers are busy and suspicious of platforms.

## Who first

Colonel Panic (OUI-Spy, mesh-detect v2), AntiHunter (DIGI Node), PINGEQUA (Scout Lite), InfiShark (BLEShark Nano), M5Shark (Marauder V8, C5). All five sell direct, ship today, and answer email. Addresses are in `docs/sellable-devices-2026-09-17.md`.

## Draft

> Subject: Selling {device} through gadgets.sh — 5%, you ship, Stripe pays you
>
> Hi {name},
>
> I run gadgets.sh, a catalogue of pocket radio and security hardware with build guides. {Device} already has a page there: {url}. {One specific, true sentence about their device or a build that uses it.}
>
> I'd like to add a Buy button to that page. It works like this: the buyer pays on gadgets.sh through Stripe, the money goes straight to your Stripe account minus a 5% fee, you get an email with the shipping address, and you ship as normal. You stay the seller of record; refunds and support are yours, same as your own store. No listing fees, no inventory sent anywhere, and you can stop any time.
>
> Setup is one link: Stripe's onboarding, about five minutes. I'd then need a price, a stock count and a flat shipping rate per region from you.
>
> Would you try it with {device}? Happy to answer anything.
>
> {Max}

## After a yes

1. Add them to `data/listings.json` (`makers`), send `https://<worker>/connect/start?maker=<id>&key=<ADMIN_KEY>`.
2. Once `/connect/return` shows charges and payouts on, paste the account id, add the listing, set `active: true`, rebuild.
3. Place one test order yourself, then tell them it's live.

## Objections you'll hear

- **"Why not just link to my store?"** We do, and we will keep doing that. The Buy button is for people who are on gadgets.sh comparing devices and want to buy without leaving; it converts better than a click-out, and you keep 95%.
- **"What about tax?"** You're the seller of record, exactly as on your own store. Stripe Tax can be turned on for your account if you want it.
- **"Exclusivity?"** None. Sell everywhere.
