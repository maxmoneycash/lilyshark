# gadgets.sh: discover, build and buy useful pocket hardware

## Brand separation — explicit user direction

**gadgets.sh and LilyShark are separate products.** gadgets.sh is the hardware catalog and build-sharing platform. LilyShark is the radio firmware/hardware project, eligible for a clearly attributed listing and build page like another maker. Shared ownership should be disclosed without presenting gadgets.sh as LilyShark's new identity or treating every catalog visitor as a LilyShark sales prospect.

Platform navigation goes to a general Builds directory. The LilyShark example retains its own name, author, source repository, project status and concept labeling. The preview is a separate application under `gadgets/`; no LilyShark firmware, native app or analyzer has been renamed or merged into it.

## September 16 business decision — current offer

Test one [maker-funded companion-page pilot at a proposed $750](strategy/revenue-plan-2026-09-16.md#exact-750-pilot-scope). It turns an existing approved demonstration and its sources into an editable page, parts/reference export and one sharing design in three crops. Production is proposed as five working days after complete materials and scope agreement, with one consolidated review. Public hosting is agreed separately. New filming, physical reproduction and custom firmware engineering need a different scope.

The [three maker pitches](strategy/first-three-maker-pitches-2026-09-16.md) are unsent. The [Wio scope sample](strategy/wio-l1-sample-scope.md) is a prefilled discussion document, not a client agreement. An actual buyer, publication destination, media approvals, technical reviewer and payment arrangement remain unconfirmed. First test whether a seller will commission the defined work for a real use; record total sales/production hours and acceptance. Keep the catalog and free creator-sharing path available regardless of that result.

## September 15 user direction — catalog and setups together

The user explicitly likes helping people build their own setups **alongside a hardware catalog** and wants broader hardware coverage. They selected the exact Vertical Carousel 3D preview in `website-cloner` for the catalog UI.

The catalog supplies discoverable parts, revision-specific specifications, source evidence and setup requirements. Build/setup pages explain what those parts do together, why they were chosen and how to reproduce or adapt the result. The catalog now has 67 entries and uses the requested carousel by default, with functional search, filters, details, saves and Add to setup. See [the expansion](catalog-expansion-2026-09-15.md) and [carousel notes](hardware-carousel.md).

Next, complete the power, antenna, enclosure and connector requirements of real builds. Add “used in this build” links when there is an actual documented build. The current setup picker does not validate compatibility or prove a combination was physically tested. The user has selected this direction and reference; adoption and revenue remain hypotheses to test.

## September 15 implementation — discovery and one usable build

The local preview now implements the next experiment from the competitive research:

- A compact discovery homepage at `/`, with real project photography, six selected hardware discoveries and a separate `/hardware/` directory.
- A LilyShark build at `/builds/lilyshark/`: physical T-Deck photography, an interactive 24-frame synthetic capture, exact frame links, a downloadable fixture, the parts/firmware path, development-status notes and a starting setup to remix.
- Existing setup drafts, source notes, guides, saves and comparisons remain available. Old root filter links redirect to the hardware directory.
- An initial [physical-production proposal](strategy/maker-pilot-offer.md), with a historical $1,500 price. That draft is now archived; the [current $750 companion-page scope](strategy/revenue-plan-2026-09-16.md#exact-750-pilot-scope) governs the first sales test. Neither has been sent, sold or published.

This replaces the earlier oversized wordmark and creator-invitation homepage. Instrument Sans, restrained neutral surfaces, compact navigation and object photography now form the shared interface. The build's sample is useful without owning a radio; following its hardware path is optional.

**What this establishes:** a reviewable discovery → try → inspect → parts → adapt flow. It does not establish adoption, virality, revenue or a physically reproduced tutorial. The photographed display and the downloadable fixture both use simulated data and are labeled accordingly. The next content milestone is a recorded live workflow with its exact firmware revision and a second-person reproduction.

**Current business decision:** test the [bounded $750 production scope](strategy/revenue-plan-2026-09-16.md#exact-750-pilot-scope) with a real maker, record total sales/production hours and buyer objections, and decide whether the economics support another project. Public hosting and share previews need their own content and image review. Build larger community infrastructure only when real creators want to use it.

See [asset provenance](build-assets-2026-09-15.md) and [verification](verification.md) for the limits of this implementation.

## September 14 research update — strategy behind the experiment

The creator showcase recorded below was an earlier prototype, not an accepted product direction. The user rejected its UI and asked for competitive research and a credible business model. The [competitive strategy report](research/competitive-strategy-2026-09-14.md) now governs the next experiment.

**Recommended focus:** original demonstrations and reproducible projects for experienced hobbyists using hackable handhelds and radio gear, with exact parts and eventually supported kits. Build gadgets.sh's own audience and business across makers; LilyShark remains a separate project. Personal builds remain a source of content and sharing.

Research found that Everyday Carry already combines personal setups and shopping; Gadget Flow offers discovery, videos and collections; Adafruit supports reproducible guides and parts from multiple vendors; Hackster sells services to hardware brands. These features alone are not a competitive advantage. The report links the primary evidence and distinguishes published offers from verified business results.

**Next scope:** one discovery screen and one complete, physically reproduced project using original media. Test usefulness and a real commercial offer before extending the platform. The immediate cash-flow experiment can be a scoped technical-content service for a maker; affiliate links supplement it where accepted. Curated kits and original hardware require actual demand and contribution economics. Paid promotion requires demonstrated audience value.

The current preview has neither real hosted community activity nor commerce. The first priority is evidence that people want the projects and will reproduce, share or buy them. The infrastructure priorities in the earlier proposal below are conditional on that evidence.

---

## Earlier creator-showcase proposal (historical)

### Prototype premise

Serve experienced hardware and radio hobbyists **showing their own builds and setups**. The shareable object is a project page: what it does, a photo or demonstration, the parts used, and the story behind the choices. The catalog supplies ingredients and trustworthy technical context.

The loop to test is: **see a distinctive build → explore the parts → make or adapt it → share your version → bring another builder in**. A creator gets credit and a useful record of their work; a visitor gets enough detail to do something with it. A comparison table helps at one point in that loop.

## What that prototype implemented

- A new editorial homepage: a large wordmark, warm paper, bold type, a LilyShark project feature and the invitation to share a setup. Maker product photography is labeled; it does not stand in for evidence of a finished user build.
- A setup editor with a title, optional creator credit, a build note, custom parts/modifications, a project/demo URL and an optional public HTTPS photo URL.
- Up to six linked catalog devices. A custom build can be shared without a catalog device by describing its work or custom parts.
- A browser-local draft, a shareable URL, a read-only shared view and explicit Remix action. Opening someone’s link preserves the visitor’s draft; Remix copies the shared setup into that draft. Remixes retain the source setup’s title and creator credit. Creator names in this prototype are supplied text, not authenticated identities.
- Four curated hardware collections, surprising discoveries and a grid-first parts directory. Existing guides, source notes, saves and comparisons remain available.
- No accounts, fabricated members, likes, popularity rankings or unverified community projects.

The preview runs on localhost. Links work on this machine; they need public hosting before people elsewhere can open them. Setup data is encoded in the URL. This is an interaction prototype, not a hosted community: there is no database, photo upload service, public feed, moderation queue, or per-project social card rendered for crawlers. Users can supply a publicly hosted photo. Browser storage is not a backup, and a shared URL is a snapshot rather than a live edited project.

## What could earn sharing

**An outcome people can understand immediately.** “A portable mesh rig that kept our hiking group connected” is a stronger project premise than “three devices I own.” The page should open with the finished object and a short demonstration, followed by reproducible details. Performance claims need conditions and evidence.

**Credit for the maker.** A stable, good-looking project URL should identify the builder and link to their code, build log or video. Give them an attractive image and concise caption they can use when sharing their own work. Preserve the original builder’s credit when someone remixes it.

**A useful next action.** Visitors should be able to follow the parts, understand substitutions, see firmware versions and begin their own version. A remix should link back to its source and record what changed.

This is a product hypothesis, not a promise of virality. [Hackaday](https://hackaday.com/) leads with concrete projects and their stories; [Hackster](https://www.hackster.io/) organizes discovery around projects and makers. [Product Hunt’s launch resources](https://www.producthunt.com/launch) put makers and sharing into the launch process. These are examples of distribution mechanics, not proof that copying their surface will produce growth.

## The first traction experiment

1. **Make the first exceptional page ourselves.** Photograph the actual LilyShark development hardware. Record a short demonstration of a verified workflow. Publish firmware/revision information, what worked and what remains experimental. Keep the original hardware concept separate.
2. **Invite a small founding group of real builders.** Aim for roughly ten distinctive projects across radio rigs, handheld computers, instruments and custom boards. Ask each maker to tell the story in their own words. This is proposed outreach; no invitations have been sent.
3. **Help each project travel.** Give its maker a public URL and downloadable sharing image. Let them choose where to share it. Highlight the project outcome, credit the maker, and link back to the full build.
4. **Watch for meaningful actions.** Did recipients open the demo, follow the parts, start a remix, finish a setup, or return to update it? Ask makers whether the page was worth sharing and what would make it their permanent project page.
5. **Decide from the first cohort.** Repeat when several unrelated builders voluntarily share and visitors complete useful actions. If people only skim photographs, improve the project story and reproducibility before adding voting systems or a larger feed.

Measure completed shared setups, referred visits, project/demo opens, remix starts and completions, and builder return visits. Track distributions by project; one unusually popular project can hide a weak general experience. There is no analytics instrumentation in this preview.

## Next implementation priorities

1. Public hosting, durable project IDs, server-rendered project metadata and image cards for link previews.
2. Photo uploads, stable storage and creator authentication with ownership/edit controls.
3. Original/remix relationships and attribution; revision-specific parts and firmware details.
4. A small editorial project feed with submissions, reporting, moderation and spam controls.
5. Downloadable sharing images and transparent referral measurement.

Finish these around real creator projects. Notifications, comments, reactions and follows should answer observed needs. They are not substitutes for projects worth sharing.

## Publication constraints already known

Device sources were reviewed on September 14, 2026: 41 source-checked, three partial reviews, plus our original hardware concept. Maker images are credited; commercial reuse permission has not been cleared for every image. Keep the preview unindexed until the publication review is complete. No deployment, outreach or external posting was performed.


## Current interface direction

The hardware carousel is deliberately richer: larger cards, device-page links, practical device context and visible browsing/setup controls. Other pages use fewer words and clearer hierarchy, with detailed specifications and evidence available on demand. See [interface simplification](interface-simplification.md) and [carousel notes](hardware-carousel.md).
