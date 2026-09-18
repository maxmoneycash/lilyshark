# Simpler supporting pages — September 15, 2026

## User direction

Keep the carousel informative. Simplify every other page: fewer words, fewer repeated labels, and clearer differences between headings, body text and supporting information.

## Changes

- **Home:** product names and one short idea per discovery; a single action on the featured build; removed repeated maker labels, promotional explanations and the curation paragraph.
- **Device pages:** object photograph, name, use, actions and three practical facts. Full specifications and source/revision notes remain in native expandable sections. Evidence status and the main tradeoff stay visible.
- **Setup:** direct labels and shorter help; removed the repeated motivational panel. On phones the hardware picker comes before the writing fields. Draft, sharing and remix behavior retain their existing hooks.
- **Build:** shorter introduction and explanation; removed repeated fact rows; development status is expandable. The synthetic capture label, validation limits, source links and working inspector remain.
- **Guides, collections, saved, comparison, about and firmware:** shorter introductions, simpler headings, fewer redundant section labels and clearer reading rhythm.
- **Type:** Bricolage Grotesque for display headings, Instrument Sans for reading and controls, and limited monospace labels for technical facts. The larger title scale and smaller metadata create hierarchy without introducing extra copy.

`public/quiet-pages.css` scopes supporting-page styles to `body:not(.carousel-mode)`. The carousel keeps its Inter typography, larger cards and richer context. Native details work without JavaScript; links to sections open the matching details when JavaScript is available.

## Verification

All 24 automated checks pass. The build generates 92 pages and 67 device records. Existing tests still cover ownership, source uncertainty, concept status, escaping, setup state and links. One copy-specific assertion was updated to test the visible checked-evidence marker and hands-on-test disclaimer.

Arc checks include desktop home/device/setup/build/guides and 375px home/device/setup/build/guide pages. At 320px, about, saved, comparison, collections and firmware have no horizontal document overflow. The comparison table scrolls within its 286px container. Full interaction results are in [verification.md](verification.md).

Screenshots: [home](qa/simple-home-desktop.png), [device](qa/simple-device-desktop.png), [setup](qa/simple-setup-desktop.png), [build](qa/simple-build-desktop.png), [guides](qa/simple-guides-desktop.png), [mobile home](qa/simple-home-mobile.png), [mobile device](qa/simple-device-mobile.png).

## Subsequent brand clarification

The user wants LilyShark and gadgets.sh to remain separate. Main navigation now opens a general Builds index. About, device and firmware copy names LilyShark as its own project, and the concept uses LilyShark as maker. Shared ownership is disclosed without describing gadgets.sh as part of LilyShark. No firmware or analyzer files changed.
