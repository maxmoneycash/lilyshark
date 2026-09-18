# Local preview verification

2026-09-14

## Initial preview

`npm test`: eight checks passed. The suite builds the 50 static pages, validates each device's internal links and image paths, checks source-data exclusion and preview routing, and exercises search, URL sanitization, saved-data recovery and comparison limits. `npm run build` also passed after the final responsive CSS adjustment.

Manual browser verification used the existing signed-in Arc profile through Playwriter, in a dedicated task tab. No other browser was launched. Effective CSS viewport widths of 320, 390 and 1280 pixels were checked; Arc's existing 110% zoom was left intact.

Completed flows:

- Search for a device, combine search with the Radio & mesh category, and open its permanent page.
- Search with no matches, clear filters, and switch between gallery and index.
- Filter availability independently, including the original hardware concept.
- Save a device, navigate to Saved, confirm persistence across navigation, and remove the last saved item to reach the empty state. A card label initially intercepted the mobile bookmark button; its stacking order was fixed and removal was verified at 320 pixels.
- Compare The Hacker Pager, T-Deck Plus and LilyShark; enforce the three-device limit, remove a selection and restore it with browser Back.
- Follow the separate original-hardware and firmware pages, and verify the development status and LILYGO attribution.
- Check the gallery, index, firmware article and concept page for horizontal document overflow at the tested narrow widths. The concept placeholder initially imposed an intrinsic minimum width; its grid sizing was corrected and rechecked at 320 pixels.

Screenshots: [mobile gallery](qa/mobile-gallery.png), [320px index](qa/mobile-index.png), [desktop gallery](qa/desktop-gallery.png), [320px concept page](qa/concept-mobile.png). They include the Playwriter extension's floating toolbar, which is not part of the site. Screenshots were captured through Playwriter's CDP helper after its screenshot wrapper returned empty buffers.

Arc's installed wallet extensions emitted an `ethereum` property-redefinition error with a `chrome-extension://` stack. No application-origin page errors were observed in these flows. Extensions and browser-wide data were left unchanged.

This is representative interaction and layout verification, not a full accessibility audit or an independent hardware review. At this initial checkpoint, most product entries still required source verification. See the completed source-review pass below. Image reuse permissions remain unresolved for commercial publication. Production hosting, domain acquisition, affiliate tracking, payments, storage integration and physical hardware were not exercised by this website task.

## Catalog source and image pass

Completed 2026-09-14. All 44 archive entries now have dated reviews and local source images; 41 have source-checked claims and three retain partial-review labels. The separate LilyShark concept is unchanged. See [the full review](catalog-review-2026-09-14.md).

`npm test`: all eight checks pass after the final data and template changes. Coverage now also checks image provenance fields, review notes on every imported entry, partial-review labels in wiki/comparison views, revision caveats in comparisons, and HTML escaping of source notes. The preview startup check now reports early process exits and has a timeout, so an unavailable port cannot hang the suite. `npm run build` produced all 50 pages.

All 44 downloaded image files were decoded, visually inspected, and checked against their recorded dimensions and SHA-256 hashes. Contact sheets: [entries 1–25](qa/catalog-images-1.jpg), [entries 26–44](qa/catalog-images-2.jpg). These are QA compositions; the downloaded product assets remain unmodified.

Arc checks used the same dedicated Playwriter task tab and verified extension, with the existing 110% browser zoom intact:

- Search for Kode Dot, follow its device link, and confirm the P4/C5 design, current image, source credit, preorder label and revision notes.
- Load the preorder index (five entries), switch Availability to Crowdfunding (two entries), and confirm the URL and results update together.
- Open a comparison URL for Kode Dot, CyperPRO and LilyShark. Confirm checked, partial and concept evidence states, plus the new revision-notes row.
- Inspect the Kode image and credit at 354 CSS pixels; inspect its longer source notes and the comparison at 320 CSS pixels. Neither page caused horizontal document overflow. The comparison retains its own horizontal scroll area.
- Inspect the pocket-computer index at 1280 CSS pixels, with labeled product/prototype imagery and no horizontal document overflow.

Screenshots: [mobile device image and credit](qa/review-kode-mobile.png), [320px source notes](qa/review-kode-notes-mobile.png), [320px comparison notes](qa/review-comparison-mobile.png), [desktop computer index](qa/review-computers-desktop.png). The comparison screenshot was taken during the pass, before a wording-only edit removed an unnecessary sentence about archive allegations. Two Playwriter actions reached their execution timeout; fresh accessibility snapshots established the resulting page state, and the later checks completed. Screenshots used the extension's CDP helper and retain its floating toolbar.

No application-origin errors were observed. Installed wallet extensions continued to emit their existing initialization warnings. The local preview remains running on http://127.0.0.1:54644; no publication or hardware testing was performed.

## Redesign for experienced hardware hobbyists

Completed 2026-09-14. Applied the installed `product-frontend-design` and `web-design-guidelines` skills. The new default is a light technical list with radio, processor and host requirements, independent radio/protocol and workflow filters, source caveats, persistent comparison controls and shortlists. Six selection guides and three permanent comparison pages bring the build to 60 pages. See [the product direction](product-direction.md).

`npm test`: 12 checks pass. New coverage exercises combined radio/format/source filters, optional-capability exclusions, complete filter URL round-trips, differences-only row classification, and comparison history. A regression was fixed where Back to a permanent comparison lost its preset selection; an explicit `?devices=` still clears the selection. Customizing a named comparison now also updates its heading instead of retaining an inaccurate device list.

Arc verification used the same dedicated task tab and extension. Completed desktop checks at 1280 CSS pixels:

- Filter to 5 GHz hardware (13 entries), then expansion boards (Scout Lite, Rabbit-Labs C5 and Apex 5). Confirm results and shareable URL state agree.
- Enforce the three-device comparison limit, remove a selection, and add another through the catalog controls.
- Save Scout Lite, follow Shortlist, confirm it survives navigation, then remove it to restore the empty state.
- Open the permanent RFID comparison. Differences-only hides the identical availability, price and source-check rows. Setup requirements, radio specifications and revision notes remain visible.
- Remove Chameleon Ultra from that comparison and use Back. All three original devices, the permanent URL and the original heading return.
- Inspect the final desktop catalog and comparison layout, loaded device images, and document width. No horizontal document overflow was observed.

Screenshots: [desktop catalog](qa/redesign-desktop.png), [desktop comparison](qa/redesign-comparison-desktop.png). These contain Arc's Playwriter toolbar. The comparison screenshot precedes the heading-history and footer-copy corrections; its table design is current.

Several Arc automation commands timed out after dispatch. Fresh snapshots and URL/DOM observations established the resulting state before continuing. For the comparison removal check, a DOM-backed click on the discovered button was used after pointer dispatch stalled; that verifies the UI handler and history, not pointer dispatch for that particular control. Installed wallet extensions emitted their existing initialization warnings; no application-origin error was observed.

Completed responsive checks:

- At 320 CSS pixels, expand the collapsed Filters panel, select 5 GHz Wi-Fi plus Expansion board, and collapse it again. Three matching devices and both removable filter chips remain visible. The list and photo grid each fit the document width; their mobile layouts are now distinct.
- On the radio guide, complete the first checklist item, reload, and confirm both the checkmark and “1 of 3” progress persist. Restore the original unchecked state. The guide fits at 320 CSS pixels.
- Inspect Scout Lite's image credit, host/firmware requirement, separate-host caveat and maker link at 481 CSS pixels.
- Scroll the comparison vertically and horizontally at 320 CSS pixels. Its device header and row labels remain fixed within the table; the document itself does not scroll sideways. The first check exposed a column-width problem. After correction, each device column measured 180 pixels with 186 pixels available beside the fixed labels at a 320-pixel viewport. The final screenshot shows a complete device column after horizontal scrolling.

Effective CSS widths were measured in the page. The ratio between requested viewport size and CSS width changed during the pass; emulation sizes were adjusted for the 320-pixel assertions. Browser zoom settings were not changed by this task.

Additional screenshots: [320px technical list](qa/redesign-filter-mobile.png), [320px photo grid](qa/redesign-grid-mobile.png), [mobile device page](qa/redesign-device-mobile.png), [320px comparison](qa/redesign-comparison-mobile.png). The checklist and shortlist were restored after testing. These checks establish representative layout and interaction behavior, not a full accessibility audit or evidence of adoption. Source review remains distinct from hands-on hardware testing.

The final `npm test` run passes all 12 checks after the mobile table-width correction. The local preview remains at http://127.0.0.1:54644.

## Creator redesign: builds and setups

2026-09-14. Applied Hallmark, product-frontend-design and web-design-guidelines. The homepage now leads with a real LilyShark project feature and setup creation. The hardware directory is a parts resource with grid/list views, existing filters and source notes. Four editorial collections and setup/kit routes bring the build to 67 pages.

`npm test`: 18 checks pass. Added coverage for setup URL round-trips (including Unicode stories, creator credit, custom parts and project/photo URLs), malformed or blocked storage, immutable edits, the six-device limit, executable URL/credential rejection and remix attribution. Generated links and asset paths are checked across the new routes as well as the existing device, guide and comparison pages.

Arc / Playwriter checks in the existing dedicated task tab:

- Create a named setup with a creator credit, build note, custom parts and a linked T-Deck. Preview the shared page, confirm the editor is hidden, then return to the saved draft.
- Reject a `javascript:` project URL with an inline explanation and a disabled copy action; restore a valid HTTPS link and confirm sharing becomes available.
- Open a different creator’s shared setup and choose Remix. The draft gets the new setup, a remix title and an empty author field; source credit is retained by the data helper.
- Add devices through the rendered picker to reach six. Both picker controls disable with an explanation; removing a device enables another addition.
- Activate Copy setup link with the keyboard. Clipboard success is reported. The manual-copy fallback remains implemented but was not forced in Arc.
- Start a new setup, Undo to restore all five test devices, and start fresh again to remove QA data. Existing comparison selections were preserved.
- Inspect homepage layouts at effective CSS widths of 320, 375, 414, 768 and 1280 pixels, and the shared page at 375 pixels. The first laptop pass exposed an oversized masthead; it was tightened so the primary creation action fits at 1280×800. Mobile now leads with the project photograph and retains the creation link in the navigation. A hidden line-break spacing issue was corrected.

Screenshots: [320px home](qa/creator-home-320.png), [375px home](qa/creator-home-375.png), [414px home](qa/creator-home-414.png), [768px home](qa/creator-home-768.png), [desktop home](qa/creator-home-desktop.png), [shared setup on mobile](qa/creator-shared-mobile.png). The shared-page screenshot intentionally contains labeled QA content. The Playwriter toolbar and cursor may appear in the captures; they are not site UI.

Some extension commands exceeded their 45-second response window while completing in the browser. Fresh observations verified the resulting state. DOM-backed activation was used for several controls because pointer actions were intermittently delayed; the copy action was exercised with a keyboard event. This is representative browser and layout QA, not a full accessibility certification. Existing wallet extensions emitted their own initialization errors; no application-origin error was observed in the checked flows.

Public hosting, authenticated creators, file uploads, durable project storage, a real community feed, moderation and per-project social previews are not implemented. See [the revised product direction](product-direction.md) for the concrete next steps and first-builder experiment.

Additional final checks: searching “t-deck” yields one device, hides the discovery sections and preserves an explicit List view in the URL. Computed-color checks on the new theme returned contrast ratios of 15.70:1 for body text, 6.20:1 for secondary text, 5.76:1 for photo captions, 16.83:1 for the dark invitation panel, 6.66:1 for its orange CTA, and 6.42:1 for links/focus against paper. These sample pairs pass their WCAG contrast thresholds; they do not constitute an audit of every inherited research-page style.

The final 320px setup check loaded an intentionally missing photo URL and showed the fallback message while keeping the build note and hardware available. Returning from that shared link left the personal draft empty (zero devices, sharing disabled), confirming that simply opening a shared setup did not populate or replace the draft. [320px editor screenshot](qa/creator-editor-320.png).

The existing three-device comparison was also checked at 320px: the document stayed at 320px while its 640px table scrolled within a 286px container. The final homepage was left open at 1280×800 with an empty setup draft and the main creation button above the fold. The last browser log check showed only the existing wallet-extension `ethereum` redefinition error.


## September 15: discovery and an interactive LilyShark build

Applied `product-frontend-design` and `web-design-guidelines`. Replaced the previous homepage and shared masthead, moved the full catalog to `/hardware/`, and added `/builds/lilyshark/`. The build uses physical project photography with a simulated-display caption, a 24-frame synthetic fixture, a packet inspector, parts/firmware links and a setup that can be remixed. See [the design decisions](workbench-design.md), [asset provenance](build-assets-2026-09-15.md) and [the draft maker-pilot offer](strategy/maker-pilot-offer.md).

### Automated checks

`npm test`: **21 pass**. The build produces **69 pages and 45 device records**. New tests establish that the downloadable fixture is unchanged, its public JSON equals the project parser's output, CRC failure 14 and truncated frame 20 are selected correctly, every displayed byte is preserved, and malformed/non-synthetic data is rejected. Generated links/assets are checked across the homepage, build, directory and retained device, guide, collection, setup and comparison routes. The fixture provenance test requires Python 3.

### Arc interactions

Used the same verified Arc extension and Playwriter session 21. The task tab had been closed between turns; resetting the session supplied a blank task tab, which was used for the local preview. An unrelated localhost tab was left alone. The initial navigation timed out, then a fresh snapshot confirmed the loaded page. Subsequent checks completed with locator actions and observations.

- Search the homepage for `t-deck`: navigate to `/hardware/?q=t-deck`, with one matching device. An old `/?q=t-deck&view=list` URL redirects to the directory while retaining both filters and view.
- Open the featured build; load all 24 frames; select the CRC failure and the truncated frame; inspect the exact bytes. The latter shows 46 of 53 bytes, with seven missing.
- Back and Forward restore the selected challenge/frame. Reload preserves the truncated-frame deep link. Focusing the CRC filter and pressing Enter selects frame 14.
- Fulfill the local sample request with a one-time 503 response. The page exposes a retry action and disables unavailable controls. Retry restores all 24 frames. The interception was removed afterward.
- Force clipboard rejection in the task page, then activate Copy build link. The manual-copy field receives the full selected-frame URL and keyboard focus. Navigating away removes the temporary clipboard override.
- Open the prefilled LilyShark setup without changing the personal draft. Remix copies its T-Deck, build notes and source credit into an editable draft and clears the author field. Restore the exact original draft after the check.
- Save the T-Deck, follow Saved, and remove it. Restore the original saved-storage value. The existing three-device comparison remains intact; exact draft/saved/comparison storage values match the pre-test snapshot.

### Layout and visual checks

Inspected the homepage at 320, 375, 414, 768, 1280 and 1440 CSS pixels. Checked the build at 320, 375 and 1440, plus the directory, setup editor and comparison at 320. No horizontal document overflow was observed. The 640-pixel comparison table retains its internal scroll container. The build's topic navigation and raw bytes likewise scroll locally when needed.

Mobile refinements shorten the feature and remove repeated introductory labels. Filtering to one frame collapses the mobile packet list to its 54-pixel row, keeping the inspector close to the selected record. Desktop pairs the list with the inspector. All homepage images loaded.

Sample token contrast ratios: body/background 15.31:1, secondary/background 5.57:1, link/background 5.96:1, feature text/background 15.31:1, feature secondary/background 9.28:1, valid-status/white 7.20:1 and failure-status/background 6.18:1. These checked pairs pass normal-text contrast thresholds; this is not an exhaustive accessibility audit.

Screenshots: [desktop discovery](qa/workbench-home-desktop.png), [320px discovery](qa/workbench-home-320.png), [375px discovery](qa/workbench-home-375.png), [414px discovery](qa/workbench-home-414.png), [tablet discovery](qa/workbench-home-768.png), [desktop build](qa/workbench-build-desktop.png), [desktop packet inspector](qa/workbench-demo-desktop.png), [mobile packet inspector](qa/workbench-demo-375.png). Captures include the extension toolbar and may include its pointer.

The intentional 503 generated the expected failed request; installed wallet extensions emitted their existing provider warnings. No unexpected application-origin error was observed in the checked flows. This remains a local, unindexed preview with no payment collection, affiliate commissions, hosted creator accounts or newly performed physical hardware test. The final production assets and sample provenance are documented separately. The maker-pilot offer is a draft commercial experiment, not a launched offer or revenue claim.


## Expanded catalog and requested Vertical Carousel 3D — September 15

The catalog now contains 67 entries (66 devices and the LilyShark concept) and builds 91 pages. The 22 new entries have dated primary-source reviews and unmodified local maker images. The image manifest includes original URLs, source pages, captions, credits, dimensions and checksums. [Expansion contact sheet](qa/expansion-images-2026-09-15.png). All 22 images loaded and were visually inspected; none were broken.

`npm test`: **22 checks passed**. The suite covers all static device routes/local links, provenance hashes for the additions, combined category and SDR filters, optional GPS exclusions, comparison/saved/setup behavior, capture parsing and preview serving. The two initial failures were old assertions for the 45-entry catalog and grid default; these were updated to the expanded catalog and requested carousel default. Subsequent builds produced 91 pages successfully.

Arc verification reused the dedicated Playwriter task tab and existing session. Completed checks:

- Previous/next controls, keyboard End and wrap from the last concept back to Flipper Zero.
- Wheel navigation and a CDP-delivered touch drag on the mobile viewport.
- One-result search (Pico 2 W), disabled navigation for that single card, a two-result HackRF carousel and wrap, and zero-result recovery.
- Reduced-motion emulation through Playwriter's CDP helper: the media query matched, and next/wrap controls immediately changed the selected device.
- Add Pico 2 W to setup, save it, open details, confirm the maker image loads, and return to the filtered catalog.
- Switch to grid (all 67 cards) and back to carousel. Filter boards (four devices), then radio plus SDR (four devices). The URL reflected the selected facets.
- Click the centered Airspy card to open its device page.
- Layout checks at 320 × 640, 375 × 812 and 1280 × 900. No horizontal document overflow at the narrow widths. Filter chips initially overlapped the card title at 320 pixels; the carousel now uses the search box and Refine controls to show/edit filters without covering the card. Long evidence badges were resized to fit.
- Original setup, saved and comparison state restored after QA; no unrelated tabs or browser data changed.

Screenshots: [reference](qa/carousel-reference.png), [desktop](qa/carousel-desktop.png), [375px mobile](qa/carousel-mobile.png), [320px filtered view](qa/carousel-320.png). The screenshots retain Playwriter's floating extension toolbar, which is not part of the website.

No application-origin page errors were observed. Arc's existing wallet extension continued to emit its unrelated ethereum property-redefinition warning. One initial browser wait targeted the wrong expected second device; a fresh DOM read established T-Deck Plus as the actual second item and the corrected navigation checks passed. Playwright's media-emulation wrapper was unavailable through the extension; the supported CDP helper completed the reduced-motion check.

The preview remains local at http://127.0.0.1:54644/hardware/. This check does not establish hardware compatibility, physical test results or public image/component licensing. The supplied carousel source folder was left intact.


## Carousel fidelity correction after user rejection

The user supplied a 13.62-second recording of the original. The first integration was not an accepted UI: its site chrome, contained images, responsive sizing and text overrides were removed. See [the corrected implementation and comparison evidence](hardware-carousel.md).

The renderer is now isolated from site CSS. A temporary, matching-content fixture compared the reference and integration at requested CSS viewports of 1280 × 900 and 540 × 1009. Heading typography and bounds match. The original card geometry, full-bleed image crop, flanking titles and motion settings are retained. The recording's settled and transitional frames were inspected. Screenshot differences include cursor/extension overlays and minor compositor rounding, so this verification does not claim identical pixels or frame-for-frame timing with the user's recording.

`npm test`: all 22 checks passed during the correction. The final build produces 91 pages / 67 catalog entries and removes temporary QA routes. Browser checks cover opening the badge's native controls dialog, typing a search one character at a time without losing focus, empty results with controls still usable, filtered setup actions, grid/carousel switching, Enter to open details, wheel navigation and last-to-first wrap. The user’s setup and saved state were restored after the checks.

## Larger linked carousel and simpler supporting pages — September 15, evening

The user clarified two distinct UI directions: add useful context and larger clickable cards to the carousel; remove excessive text and repetitive typography elsewhere. See [carousel implementation](hardware-carousel.md) and [supporting-page simplification](interface-simplification.md).

The carousel now recycles eight animated slots through 67 records. Native anchors replace the unreliable card-tap callback; pointer movement suppresses accidental navigation after dragging. Cards increase to 360 × 450 when space permits. Useful device context, source status, search and setup actions remain visible around the stack. The original input/snap equations are retained. Frame timing remains unverified under stable load: both reference and candidate experienced severe scheduling gaps during later measurements. The implementation notes record those results without claiming timing parity.

Arc interaction checks:

- Mouse click opens the Flipper Zero page; a touch tap opens the T-Deck Plus page.
- A mouse drag and a CDP-delivered touch drag change selection while remaining on `/hardware/`.
- End selects LilyShark; Next wraps 67 → 1. The live card pool remains eight.
- Empty search recovers to the single Pico 2 W result; one-result navigation is disabled.
- Current-card Add to setup and Save update their pressed state. Grid mode restores all 67 entries; carousel mode returns correctly.
- Reduced-motion navigation uses immediate changes; normal motion is restored afterward.
- Native Specifications opens on Cerberus. A `#sources` deep link opens its source notes. The build's development-status navigation opens its disclosure.
- The capture challenge still selects Frame 14. General Builds navigation reaches `/builds/`, and the featured project opens the separately credited LilyShark build.
- Exact saved, setup and comparison values were restored and compared with the pre-check snapshot. Only the dedicated Arc task tab was used.

Desktop screenshots were inspected for home, device, setup, build, guides, the new Builds directory and carousel. At 375px, home/device/setup/build/guide layouts have no horizontal document overflow. At 320px, about/saved/comparison/collections/firmware also fit; the comparison table scrolls inside its 286px container. The mobile carousel retains a short device summary and its actions.

Final automated result: **24 passed**, generating **92 pages / 67 entries**. The new route is the general Builds directory. One old literal-copy assertion was replaced by assertions for the checked-evidence marker and explicit lack of hands-on testing. Concept, partial-review, ownership, escaping and catalog integrity checks remain in place.

The user's final brand clarification is implemented in About, platform navigation, concept maker metadata and firmware/build copy: gadgets.sh and LilyShark are separate projects with shared ownership. No LilyShark firmware, analyzer or native-app files were changed. Existing Cerberus and SLIM Signal Sleuth entries were confirmed against the supplied 463n7.io maker site; no claim is made that its full product range is cataloged.

## Original motion behavior and quieter carousel footer — September 15, final pass

Applied the Framer Motion React skill. The animation tree now stays mounted during gestures: eight stable slots receive catalog content through cached DOM bindings, without calling React render as selection changes. Recycled content updates before Motion paints. Neighboring cards once again center with the reference spring; the centered card opens its native device link. Wheel input over the header/footer reaches the original handler.

The footer now contains one compact row of setup, save and navigation controls. Removed the duplicate View device button and visible scroll hint; moved the position/count to the top. Device context remains available around the cards. [Current screenshots and implementation](hardware-carousel.md).

### Motion evidence

An untouched reference component and the integration were exercised side by side in a dedicated Arc QA tab. Under an identical 120Hz test clock, **all 440 samples match exactly** across wheel pulses, reversal, a drag with momentum, and interrupting a wheel spring with a drag. Both controlled and real-time checks recorded **zero React animation-tree re-renders during motion**. The copied Motion vendor bundle is still byte-identical to the original.

The real-time run had browser scheduling gaps, including one large interruption outlier before the trajectories converged. This establishes matching controlled gesture/spring behavior, not equal real-world frame rate or subjective feel. The traces and repeatable fixture/check scripts are linked from the implementation document. A normal build removes the test-only routes and clock overrides.

### Interaction and layout checks

- Clicking an exposed neighboring card centers T-Deck Plus without leaving the catalog; clicking it after centering opens its device page.
- Wheel input over Add to setup changes the selected device.
- Mobile touch drags change selection without navigating, in both normal and reduced-motion modes. A subsequent centered-card touch tap opens the MeowKit device page.
- Direct progress jumps through wrap, reverse and large offsets preserve the visible card's title, slug and destination; the card pool remains eight.
- An empty-search recovery check exposed stale visual selection when returning to the same result set. Filter revisions now remount the scene, and empty results unmount it. Repeating the sequence from the last device restores both the Flipper card and its details.
- A one-result Pico 2 W search disables navigation. Grid restores all 67 devices and returns to the carousel. Some Arc actions exceeded the extension response window after completing; fresh DOM observations confirmed the state, and DOM activation completed the final view switch.
- At 320 × 640, 375 × 812 and 1280 × 900, there is no horizontal document overflow. The footer is one 42px-high row at each width.

Final automated result: **24 passed**, building **92 pages / 67 entries**. No setup, saved or comparison data was changed during this pass. Only the existing task tab and a temporary QA tab were used; the latter is closed after verification.

## No-animation root cause and persistent motion choice — September 15

The user's continued report was reproduced under the actual operating-system preference. macOS Reduce Motion is enabled. The integration followed that preference with immediate position changes; the original component continued animating. Earlier QA had forced `prefers-reduced-motion: no-preference`, so the controlled motion comparisons did not exercise the user's normal browsing behavior.

Added Carousel motion to Search & filters, with Use device setting, Full animation and Reduced motion choices. The preference persists in local storage and synchronizes across tabs. The user's preview is set to Full animation following the explicit request. The system setting is unchanged, and the QA media override was cleared rather than left forcing normal motion.

Real wheel input with the native system preference produced zero intermediate positions before the override was selected. Full animation persisted after reload and produced nine intermediate positions and ten distinct DOM transforms with the browser still reporting reduced motion. Explicit Reduced motion and Full animation selections update the effective mode. [Traces and repeatable browser check](hardware-carousel.md). Frame scheduling remained irregular under high system load; these checks establish that the spring animation runs, not a frame-rate guarantee.

`npm test`: **24 passed**, building **92 pages / 67 entries**. Only the carousel-motion preference was intentionally saved; setup, saved-device and comparison data were not modified.


## Overnight checkpoint — 16 September 2026

The current data contains 73 entries / 72 product images / 73 reference profiles, with 1,486 cited specification rows and 463 resource entries. There are 19 source-based guides covering 17 exact models. The full suite reached **97 passing checks** and the build generates **100 pages**. The subsequent cross-tab recovery guard passed syntax/build and the controlled browser check below; no physical hardware testing is claimed.

Arc / Playwriter session 21 reused the verified task tab. Representative checks at 320px and 1280px include:

- New E1001, HUSKYLENS 2 and NanoVNA pages load their images without document overflow. Device-to-guide links select the intended guide. Clicking the centered Cynthion carousel card opens its page; searching specifications for “cables” exposes the two matching source-linked rows.
- Two-XIAO selections survive reload with their quantity and existing campaign parameter. **Use these core parts** opens the correct quantity, original guide link and planning status without altering the saved setup. Remix retains source credit and does not claim ownership.
- **Restore previous setup** restores the previous saved draft exactly, including ownership and per-part notes. Repeated empty reset preserves recovery; the recovery panel is visible beside the name field on the narrow layout. Blocked writes keep the warning and suppress success claims. Recovery is explicitly limited to the current page session.
- A controlled storage event after a write failure leaves unsaved notes intact. Browser storage was unchanged; the stub was removed and reload restored the prior persisted draft. A physical multi-tab race was not exercised.
- The standalone maker demo's eighteen-file package, image provenance, 320/1280 layouts and downloadable sharing assets are covered in [its handoff](research/maker-demo-handoff.md). Main setup post-caption/photo export and long snapshot checks are detailed in [export integration](research/setup-card-integration.md) and [snapshot portability](research/setup-share-portability-audit.md).

Screenshots: [narrow recovery](qa/overnight/remix-recovery-320.png), [desktop guide handoff](qa/overnight/build-handoff-desktop.png), [narrow E1001 carousel](qa/overnight/e1001-carousel-320.png). They include the browser extension toolbar. These are desktop Arc viewport checks, not physical-phone Safari tests. The build-finder screenshot predates the independent inventory work; it shows the earlier setup-based import description.

The latest incremental reference audit checked 58 new URLs; all returned HTTP 200. Prior access restrictions remain documented separately. Reachability does not establish content accuracy or media permission. See [the audit](research/reference-link-followup-latest-2026-09-16.md).

All changes remain local. No maker accepted an offer and no revenue, public deployment, outreach or physical-build validation is claimed. Browser QA uses temporary fixture storage; the original backups are retained for restoration after the overnight session.
