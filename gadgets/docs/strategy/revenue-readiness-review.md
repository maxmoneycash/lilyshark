# Revenue and creator readiness review

16 September 2026. Read-only review of the current source and strategy documents. No browser session, build, outreach, payment or hardware test was performed for this review. Line references describe the inspected snapshot and may move as other agents work.

## Decision

**The $750 production pilot is coherent enough to test with a buyer. It is not yet a complete public purchase or creator-sharing journey.** The next useful work is to close the handoff, show the promised deliverables, and test whether a real seller values that work. More catalog entries or another pricing tier would not answer those questions.

The public maker pages, brief export and three prospect drafts consistently describe a proposed $750 fee, existing approved media, five working days after agreed inputs, one review, and separate hosting. They do not claim a paying client, audience, affiliate relationship or physical testing. The Wio example credits Seeed; the Scout guide pins SigRoam 0.3, separates the host app from the scanner firmware, and states its evidence limits. Keep those strengths.

## 1. There is no complete path from “interested” to an actual conversation

**Impact:** blocks an outside maker from evaluating and responding independently; blocks a creator's local setup link from reaching followers.

**Evidence**

- The standalone demo's handoff explicitly leaves the public URL and receiving channel unconfigured: `docs/research/maker-demo-handoff.md:51`. Its README asks the reviewer to run a local Python server: `scripts/build-maker-demo.mjs:32`. That is a reviewable engineering artifact, but asks considerable effort of a cold prospect.
- Both maker forms finish with copy/download and no receiving destination: `src/maker-pilot.mjs:25`, `src/maker-demo.mjs:95`, `public/maker-pilot.js:58`. Their “nothing sent” language is accurate; the missing next step remains a conversion gap.
- Setup sharing and card captions derive their URL from `location.origin`: `public/kits.js:144` and `:160`. From the current preview that means localhost. The successful clipboard message nevertheless says anyone with the link can see it at `:151`.
- The first three pitches correctly mark their external review URLs pending: `docs/strategy/first-three-maker-pitches-2026-09-16.md:126`.

**Smallest local fix:** make setup success/caption guidance recognize a local preview address and explain that the link works on this machine. Keep the functioning downloads. Prepare one receiving instruction beside the maker export action, populated only when a real address/channel is chosen. For a direct sales conversation, “Reply to the person who sent you this demo with your brief” can work without building a submission service.

**External prerequisite:** choose and authorize the actual public host and receiving channel; identify who replies and who can issue the agreed invoice. Do not invent an inbox, quietly publish the full preview, or substitute an unreviewed catalog deployment for the cleared standalone example. The standalone Wio package already offers a narrower media path; the existing Scout photos still have a separate publication boundary documented in `docs/research/scout-companion-source-note.md:35`.

**Ready when:** someone on a different device/network can open the reviewed example, obtain its reference, and identify the real next contact step. A copied public setup opens the intended snapshot. Local exports explicitly identify their local links. No custom checkout or CRM is necessary for this first service sale.

## 2. The paid package is described more completely than it is demonstrated

**Impact:** a maker may reasonably see a nicer summary of its own free documentation and ask what the $750 buys.

**Evidence**

- The scope promises editable files, social-preview metadata, a source checklist, and one share design in three crops: `docs/strategy/revenue-plan-2026-09-16.md:100` through `:106`.
- The standalone demo shows the page, references and parts download, but its exact ten-file allowlist contains no sharing images or finished caption asset: `scripts/build-maker-demo.mjs:12`. Its head has description metadata, but no Open Graph image metadata: `src/maker-demo.mjs:24`. The README explicitly says this is not the complete paid-pilot deliverable; this is a proof gap, not a false completion claim.
- The existing setup-card utility already supports all three promised dimensions: `src/setup-card.mjs:3`. The capability exists; a maker-facing example of the final commissioned assets is missing from the reviewed package.
- The strongest visible technical value is the Scout explanation of what goes on each board, its supported release and storage path: `src/scout-companion.mjs:84`. The Wio miniature identifies the OLED model and firmware target, but delegates details such as “suitable power” to the original source: `src/maker-demo.mjs:65`. Neither is a reproduced bench test, and both correctly say so.
- The existing competitive research itself reports free branded hubs and inexpensive creator shops, and concludes that a template alone is weak differentiation: `docs/strategy/revenue-plan-2026-09-16.md:29` and `:36`. This review did not recheck those vendors' current prices.

**Smallest local fix:** finish one bounded demonstration delivery folder using the cleared Wio material: the existing page/reference, a source-and-open-questions checklist, one actual design in the three promised dimensions, its caption, and brief edit/publish instructions. Show those real outputs next to the three deliverables. Add deploy-time metadata instructions using the eventual real origin; never claim dynamic previews for URL-encoded setups. Keep the “miniature source example” label until the selected SKU, power bundle and software path are as specific as the paid scope requires.

Use the existing technical work to explain the fee concretely: “We reconcile which version, which software goes where, and which extra parts this one demonstration needs, then deliver files you can reuse.” Do not make an unsupported time-saving or conversion claim.

**External prerequisite:** a seller must identify a current use worth outsourcing. Our ability to produce the files does not prove that it wants them.

**Ready when:** a maker can inspect every promised output type and name where it would use this package. One excellent sample is enough for this test; no additional catalog or storefront feature is required.

## 3. The existing photo-card feature is hidden behind the wrong first action

**Impact:** creators who came to share a photographed build can miss the most immediately useful output.

**Evidence**

- The primary action is “Share setup”; it opens native URL sharing or copies a link: `src/templates.mjs:130`, `public/kits.js:142`.
- The image flow is behind the secondary “Export” action, then “Image for a post”: `src/templates.mjs:156`. Only then can a creator select a local photo: `public/setup-card.js:128`.
- The editor's separately labelled “Your build photo” instead requires an already-hosted HTTPS image URL: `src/templates.mjs:150`. A creator with a camera-roll photo can reasonably conclude it cannot be used, despite the new local-file path already existing.
- The local-photo help accurately says the image is only included in the PNG and not the shared setup: `public/setup-card.js:130`. Preserve this distinction.

**Smallest local fix:** surface the existing image option as “Create a post” beside a clearly named “Copy setup link”; alternatively let the primary Share action expose the existing two output choices. Beside the hosted-photo field, link to the existing local-photo card flow. Do not add photo hosting or silently suggest that a selected PNG photo appears on the shared page.

**External prerequisite:** none for finding and exporting a local card. Opening the attached setup link elsewhere still depends on finding 1. Whether creators actually choose to post it requires a real creator trial.

**Ready when:** a creator can find the camera-roll-to-card flow directly from the editor without knowing the word “export,” and can tell which output includes their photo. Root owns browser validation. Long URL/caption transport is being audited separately and is not duplicated here.

## 4. Agreement details are scattered, leaving the buyer to discover extra work late

**Impact:** slows the first payment and can consume the thin pilot margin through approval and hosting coordination.

**Evidence**

- Public scope and the exported brief say hosting, reuse rights and acceptance are agreed later: `src/maker-pilot.mjs:24`, `src/pilot-brief.mjs:50`. This is truthful, but “a page worth putting in your bio” is not yet an operational handoff for a maker without someone to publish static files.
- The revenue plan defines a five-working-day review window, fourteen days of correction coverage and a bounded remedy: `docs/strategy/revenue-plan-2026-09-16.md:106`, `:123`, `:125`. The brief export carries none of those specifics. It is a draft, not an agreement, so the omission is not itself a broken contract; the buyer still needs one concise agreement before paying.
- Current public $750 scope is consistent. Internal entry points are not: `docs/product-direction.md:24` still points to the older $1,500 physical-production pilot, and `docs/strategy/maker-pilot-offer.md:11` does not mark itself superseded. The current plan separately proposes $2,250 for that more demanding future service at `revenue-plan-2026-09-16.md:60`.
- The modeled contribution becomes negative at fifteen total hours: `docs/strategy/revenue-plan-2026-09-16.md:52`. Indefinite fact gathering, media clearance or custom CMS work would therefore matter materially.

**Smallest local fix:** prepare one short, prefilled scope sheet from the existing plan: exact outcome/SKU/software path; known sources and unresolved questions; supplied media and agreed reuse; actual publication owner/destination; one reviewer; deliverables; $375/$375 milestones; review window and correction boundaries. Have gadgets.sh prefill known facts. Ask the buyer to correct or approve them and resolve only the highlighted gaps. Mark the old offer as archived and link the current one from the product-direction entry point. Keep the initial three-field brief short.

**External prerequisite:** the paying maker and any independent creator must actually approve their respective facts/media; the selected publication owner must accept the handoff. A maker cannot approve another creator's footage. Payment/remedy terms need agreement before payment, not inferred consent from a downloaded brief.

**Ready when:** a buyer can approve one concrete scope rather than reconcile several documents, and delivery can start without an unknown host/CMS task. No extra approval checklist belongs in the public hero.

## 5. The prepared sales questions test configuration interest more directly than buying intent

**Impact:** the first conversations could generate useful technical answers or sample offers without testing the revenue hypothesis.

**Evidence**

- The three otherwise well-researched drafts finish by asking which software path, shipping batch, or Wio configuration to use: `docs/strategy/first-three-maker-pitches-2026-09-16.md:52`, `:87`, `:122`.
- Their price and independent-example status are clear. But the actual next-use date, person controlling a content budget, and willingness to commission the asset remain unknown; the same document acknowledges this at `:154`.
- The generic draft has the stronger commercial question already: whether the scope is useful for a specific next use and worth $750, `docs/strategy/maker-outreach-draft.md:19`. The canonical plan calls for that test at `revenue-plan-2026-09-16.md:170`.

**Smallest local fix:** change each unsent closing question to test a paid use first. For example: “Would your team commission this $750 package for an upcoming Scout post, and who would own the scope and budget?” Ask which firmware path after there is a real use or buyer interest. Keep the technical observation as the reason the proposal is relevant. Do not spend another full custom-production cycle merely to obtain that answer.

**External prerequisite:** authorized one-to-one outreach, a real reply and an agreed start payment. The official media/business/affiliate contacts are routes to a company, not verified paying budget owners. Do not count an affiliate invitation, offered device or configuration answer as a purchase.

**Ready when:** one unrelated seller identifies a real intended placement, agrees the bounded scope and pays the $375 start milestone; accepted delivery within the time budget then tests whether the service is viable. A website improvement cannot establish that evidence by itself.

## Recommended order

First fix the local link messaging and make the existing photo-card action findable. Complete one visible delivery sample and one prefilled scope sheet. Then resolve the real public review/contact handoff and conduct the already bounded sales test when authorized. Keep the hardware catalog and free creator flow available; neither needs to become a paid marketplace to learn whether this service earns its first fee.
