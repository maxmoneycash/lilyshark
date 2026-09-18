# Device pages and carousel actions — 15 September 2026

## Interface

The carousel footer now contains Add to setup, Save, Compare and Share. The up/down buttons are removed. Wheel/drag browsing, keyboard navigation, centered-card links and the saved motion preference remain available. The original Framer Motion scene and spring equations are unchanged.

Device pages use a large product photo, a distinct title and a short purpose statement. The first actions are adding the device to a setup, saving it and opening a comparison. Phones have a persistent bottom action bar; the duplicate generic setup tray is hidden on device pages. Specifications are searchable, grouped in native disclosure elements and individually sourced. Search opens matching groups and restores the previous disclosure state when cleared. Official manuals, firmware and design downloads have their own section.

A new lime geometric G mark and gadgets.sh wordmark appear in the shared header, carousel and SVG favicon. LilyShark retains its separate project identity and explicit hardware/firmware ownership text.

## Skills applied

Relevant guidance came from mobile-app-ui-design, product-frontend-design, apple-design-foundations, apple-design-navigation, apple-design-controls, apple-design-accessibility and apple-design-web, alongside the existing Framer Motion work. The decisions use hierarchy, progressive disclosure, one prominent setup action, 44px action targets, semantic navigation, native dialogs and mobile safe-area spacing. Unrelated native platform/framework skills were not applied to this static website.

## Verification

- 27 automated tests pass, including all 67 generated device routes, citation/profile validation, unsafe URL rejection, escaping, source caveats, setup data and comparisons.
- Arc session 21, verified extension identity: `install:Chromium:yh287i1ggxx70`.
- Device overview checked visually at 375px and 1440px. At 320px the page has no horizontal overflow and both persistent actions remain at least 44px.
- Save and Add to setup update browser state. Compare opens the selected device's table. User saved/setup/comparison storage is restored after testing.
- Search for “battery”, no-match search and clearing search pass, including restoration of disclosure state.
- Clipboard success and denied-clipboard fallback pass using controlled browser API stubs. No system share recipient was selected or contacted.
- Real carousel wheel input produced 10 distinct rendered transforms, with nine intermediate positions, under the actual system reduced-motion preference and the user's saved Full animation choice. The heavily loaded local machine still exhibits frame stalls; this does not establish sustained 60fps.
- Some Arc action calls reached the automation timeout after completing. Results were verified in a fresh observation before proceeding.

Detailed source scope and remaining gaps: [device-reference-audit.md](device-reference-audit.md).
