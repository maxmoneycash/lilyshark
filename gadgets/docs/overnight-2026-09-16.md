# Overnight work — 16 September 2026

Working window: approximately 00:30–07:00 Pacific, requested by the user. Work stays in the local gadgets.sh preview. LilyShark remains separate.

## Starting point

- 67 device profiles, 1,051 structured facts, 240 resource links.
- Device page redesign and new G logo; carousel footer has Setup, Save, Compare and Share.
- 27 automated checks pass. Existing Arc checks cover device actions, narrow layouts and live carousel movement.
- The full animation preference is saved for this preview. Ordinary system reduced-motion behavior is still supported.

## Work queue

1. Make setup pages useful as a working parts list: quantities, ownership/planning state, short part notes, requirements and a portable export. Preserve old shared links and browser drafts.
2. Review carousel rendering and interaction against the original reference. Preserve its motion character; measure before changing it.
3. Refine mobile navigation, sharing and page hierarchy through real browser checks.
4. Fill specific primary-source information gaps and improve links between devices and documented builds. Do not claim unspecified or conflicting hardware facts are settled.
5. Check the complete discovery → hardware → device → setup → share flow, save evidence, and write a morning handoff.

## Guardrails from the existing task

No fabricated builds, compatibility tests, people, popularity or revenue. No publishing, outreach or purchases. Preserve browser profiles and the user's saved/setup/comparison state after QA.

## Completed work

Results will be recorded here as each change is implemented and verified.

## Revenue and marketing scope added by the user

The user explicitly requested a swarm focused on an immediate path to revenue and marketing, gadget social creators, hardware sellers, build makers, approved promotions/discount codes and affiliates, plus a creative larger vision. Three independent agents are researching affiliate partnerships, creator distribution, and the first paid offer. Main work continues on the actual product and a local, reviewable maker/creator demo. No external outreach or enrollment is implied by these research tasks.

### First implementation checkpoint

- Setup data supports quantities, considering/need/have states, and per-part notes. Old links and drafts remain compatible.
- A remix keeps quantity and notes but resets the original creator's ownership state.
- Parts export includes requirements, tradeoffs and original maker links; creator text is escaped for Markdown.
- Setup page rebuilt around a compact parts list, expandable requirements and build notes; mobile share/export controls.
- 30 automated checks pass. Browser verification is in progress.

Browser note: the earlier dedicated gadgets tab had been closed before overnight QA. The existing session correctly failed before changing storage or navigating. Reconnecting through the verified Arc helper; unrelated tabs are untouched.

### Creator and maker checkpoint

- Three research reports cover 13 affiliate prospects, 15 creator prospects, eight growth mechanisms, and a single proposed $750 production pilot. No outreach, enrollment, code issuance or payments occurred.
- Creator parts accept their own buying links with affiliate disclosure. Sharing, remixing and export preserve the supplied link and its referral parameters.
- Type guards, multiline preservation and remix credits have regression coverage. The model retains the earliest known credit and immediate parent; it is not a complete version history.
- The `/for-makers/` local brief page and `/builds/scout-lite/` source guide are integrated. Forty automated checks passed at that checkpoint.
- Arc session 21 uses the reidentified gadgets tab. CLI calls use `--timeout 30000` because some completed actions exceeded ten seconds. Use `getCDPSession({page:state.page})`, never `context.newCDPSession()`.
- Native setup add/state/note/link/affiliate controls work. Preview preserves the visitor draft and shows the exact creator link and disclosure. The shared toolbar fits at 320px, with all actions at least 44px tall.
- Clipboard success and denied-clipboard fallback passed with controlled browser API stubs. Native system sharing has not been exercised with a recipient.
- Seven LILYGO/Seeed profiles were enriched. Current totals: 67 profiles, 1,154 facts and 261 resource links. Further source work is underway.

#### QA state to preserve

QA temporarily changed `gadgets.kit`. Exact originals for `gadgets.saved`, `gadgets.kit` and `gadgets.compare` are backed up in `/tmp/gadgets-overnight-storage-backup.json` and `state.overnightStorage`. Restore them before the final handoff. The current QA page has clipboard/native-share stubs; a reload removes them.

Reliable mobile screenshots use Emulation width 320/375, `mobile:false`, then `Page.captureScreenshot` through the verified Arc CDP helper. A `mobile:true` screenshot returned empty bytes and was discarded. These are desktop Arc checks of narrow layouts, not physical iOS Safari tests.

### Build discovery, source corrections and export checkpoint

- The Builds index links two available examples and an 11-guide finder. Native Arc checks at 320px passed: one XIAO yields one partial two-board guide; two XIAOs cover its core quantity; importing “Have it” hardware leaves the setup unchanged; a device with no sourced guide shows an honest empty state. Version exclusions remain visible.
- The maker brief passes required-field validation, local save, clipboard success/fallback, and a controlled browser download check. The download produced Markdown content and a safe filename; the test intercepted the final anchor click. Its original `gadgets.maker-pilot` value has been restored and added to the storage backup file.
- The public PINGEQUA BUILD10 banner is recorded with the 2+ item condition, no affiliate relationship, no checkout verification, and an internal freshness deadline. Build-time and client-side checks suppress stale offers. Browser offer-copy QA remains queued.
- The carousel now remembers the selected hardware in tab storage when leaving, and the device’s Hardware link preserves a referring filter query. Arc verified both ordinary and filtered returns. Initial progress is restored before the first paint; spring constants and gesture logic are unchanged. A real wheel trace after return recorded eight distinct transforms and five intermediate positions. This is evidence of animation, not a 60fps claim.
- The tab’s original `gadgets.catalog-visit` value is backed up in `/tmp/gadgets-catalog-visit-backup.json` and `state.catalogVisitBefore`; restore it after the final carousel QA.
- Source batches B, C and D are merged after review: creator hardware, exact CircuitMess revisions, and seven general hardware/tool profiles. Current totals: 67 profiles, 1,241 rows and 338 resource links. These remain source summaries, not exhaustive manuals or physical tests.
- Two exact Seeed wiki images now have explicit CC BY-SA 4.0 metadata and source/license/original-image links in their device-page credits. The remaining photo permissions are unchanged. A small standalone maker demo using the licensed image is being prepared separately; nothing is deployed.
- Social-card export is integrated through the setup Export menu: preview a PNG or download a Markdown parts list. Feed, story and wide cards use original graphics and creator text. Fifty-nine automated checks passed before the final batch-D data merge; Arc export QA is underway.


### Maker demo and documentation checkpoint — 01:44 Pacific

- Seven RF/bench-tool profiles in batch E are merged. The complete catalog now has 1,279 rows and 371 resource links. Bus Pirate’s 300 mA rating is distinguished from its 500 mA current-limit setting; HackRF Pro precision modes and optional DC removal are qualified; Saleae’s threshold-documentation conflict stays visible.
- Device pages for the nine models represented in the build finder now have direct “Build with…” links. Finder selections and quantities can travel in a URL while preserving campaign parameters. Two focused tests pass; live browser review is queued for the next main build.
- The HTTP reference audit checked the pre-batch-E set of 322 unique URLs: 303 successful responses, 19 requiring follow-up, zero confirmed 404/410 responses. Follow-up found 18 explicit Cloudflare challenges and one working CircuitBlocks sign-in destination. These findings do not establish every target’s full contents. CircuitBlocks resource labels now state sign-in is required.
- A separate ten-file, approximately 102 KB maker demo ZIP uses one licensed Wio L1 photo, a real source-based BME280 example, the proposed $750 scope and an isolated local brief. It is served at http://127.0.0.1:5187/ for local review. No publication or outreach occurred.
- Arc checked the standalone demo at 320px: no horizontal overflow, image loaded, required/HTTPS errors focus the right field, reload preserves multiline draft text, copy includes the scope and source URL, clipboard denial selects the full fallback text, and the download begins with the expected Markdown filename/content. The final download anchor was intercepted for inspection. Its local storage is restored immediately after QA.
- Setup image export passed all three original text-only formats and controlled caption/download checks. A local-photo extension and denser sparse-card layout are in progress; these remain separate from uploaded/shared setup media.


### Sharing and revenue-readiness checkpoint

- The full suite reached **71 passing checks**, generating 94 pages / 67 records. Source batch F is being prepared separately.
- Optional local-photo export passed native Arc selection, feed/story/wide rendering, Fill frame and Show whole photo, unchanged caption/draft state, rejection of a mismatched replacement file while keeping the prior photo, removal and close cleanup. Temporary QA photos deliberately used a licensed test image and are not published build examples.
- A five-point revenue-readiness review is turning into concrete fixes: Create a post is now the primary setup action; link/Markdown choices remain in a compact secondary menu; the hosted-photo field is distinguished from choosing a device photo for a post. Local links are clearly labelled in captions, sharing messages and copy fallbacks. Root browser review is underway for these latest UI changes.
- A stress audit found valid long Unicode snapshots returning HTTP 431 and a surrogate-pair truncation defect. A bounded source-model fix is in progress, preserving old query links and using versioned fragments for longer snapshots. Do not treat the new format as verified until the integrated browser checks pass.
- The current $750 offer now replaces the archived $1,500 proposal in product-direction links. Three unsent pitch closings ask about a real commission and budget owner. A prefilled Wio source-example scope consolidates delivery, unresolved choices, acceptance, review and corrections; it is not a client agreement.
- Three actual photo-free sharing designs are being produced for the maker-demo handoff, so the sales sample demonstrates the promised assets. No public host, contact endpoint, payment or partnership is invented.


### Source and sharing checkpoint — 02:16 Pacific

- Source batch F is merged: five mesh profiles, with revision-specific firmware/power/accessory distinctions. Totals are now 67 profiles, 1,324 rows and 405 resource links. The original catalog stock/price dates remain unchanged.
- Standalone demo now contains eighteen files: one licensed product photo plus three original PNG/SVG sharing designs and a caption. Arc reviewed 320/1280 layouts; download responses are HTTP 200. PNG controls were enlarged to 44 × 44 targets. No public deployment.
- Versioned fragment snapshots render six-device Unicode notes, quantities, creator buying links, affiliate labels and both remix credits in Arc. Hash-only navigation and browser Back/Forward restore the right shared setup without changing the saved draft. The secondary Setup link action copies the exact complete fragment and labels the local destination. The invalid-link notice also passes after a fresh document load.
- Create a post now separates editable short captions from Copy setup link and collapsed Full details. Automatic attribution stays with the copied caption. Its 320px edit/count/copy/fallback/focus/reset checks now pass.
- The integrated full suite passes **91 checks**. One old copy assertion was updated to distinguish catalog-listing dates from detailed-documentation review dates.
- The first-sale execution plan consolidates the route to an actual proposed $375 start payment, three ranked prospects, required owner inputs and stop/go limits. It records no buyer acceptance. Further agent work focuses on missing hardware categories and exact-model build guides.
