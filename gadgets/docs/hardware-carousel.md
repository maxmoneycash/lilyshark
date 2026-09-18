# Hardware carousel

## Reference and current direction

- Original preview: http://127.0.0.1:5186/
- Source: `/Users/maxmohammadi/website-cloner/sites/vertical-carousel-3d/source`
- User recording: `/Users/maxmohammadi/Screenshots/Screen Recording 2026-09-15 at 8.15.06 PM.mov` (13.62 seconds, 1080 × 2018).

The first integration changed too much of the selected reference. The subsequent correction isolated the renderer from site CSS, restored cover photography and the original typography and motion equations. The latest user direction asks for **larger, clickable cards and more useful information around this carousel**, while making the rest of the site simpler.

## Implementation

The moving stack lives in a Shadow DOM boundary. React/Motion/loader bundles and their source manifest remain copies of the reference. The copied Inter font retains its OFL license. The original website-cloner source is unchanged.

Cards are now 360 × 450 on a sufficiently large viewport, up from 320 × 400. Narrow or short viewports reduce their dimensions to leave room for controls. Spacing remains 240px. The original 24px corners, 28px padding, full-bleed cover photos, flanking labels, blur, scale and background crossfades remain.

Eight stable card slots browse all 67 entries. As the selection passes a device, the farthest offscreen slot receives the next device. Catalog text, images and links update directly through cached DOM bindings, synchronously before Motion paints the new position. The React animation tree does not re-render during scrolling or dragging. React renders remain responsible for mounting, filter changes, resizing and reduced-motion changes. Tests cover forward/reverse order, catalog wrap and small/empty result sets.

Motion retains the reference's wheel spring (stiffness 400, damping 40), 150ms wheel-release timer, rounding and snap spring (250, 35), direct drag tracking, and 0.15-second release-velocity projection. No autoplay.

Search & filters includes a saved **Carousel motion** preference: Use device setting, Full animation, or Reduced motion. The default follows the device; an explicit choice takes precedence and is saved as `gadgets.carousel-motion`. Reduced motion uses immediate changes. Full animation runs the original springs even when the operating system requests reduced motion. The user's preview is explicitly set to Full animation, as requested; no operating-system setting was changed.

Clicking a neighboring card centers it with the original snap spring; clicking the centered card opens its device page. Cards remain native anchors with modifier-click support. Pointer travel greater than seven pixels suppresses the release click after a drag. Keyboard browsing uses arrows, Home/End and Enter, with a live selected-device announcement. Wheel events over the surrounding toolbar and controls now reach the original handler too; the search dialog remains independent.

The bottom area is one compact toolbar with 44px targets: Add to setup, Save, Compare and Share. The previous/next arrows, duplicate View device button and visible scroll hint are removed. Position and result count share one counter at the top, beside Search & filters and Your setup. Desktop also shows the selected device's use, connectivity, requirements and source status. Narrow layouts retain its short use description and actions. Search opens a native dialog with the existing facets and grid/list options. Empty results can be cleared; live search retains focus.

## Evidence and limits

**Correction after the user's report of no animation:** the operating system requests reduced motion. Earlier browser QA forced `no-preference`, hiding the difference between that preview and ordinary browsing. Once the browser override was cleared with an empty feature value, the existing integration jumped directly from progress 0 to 1, with zero intermediate positions. The original component does not contain this reduced-motion branch. Matching normal-mode equations therefore did not establish the behavior the user was seeing.

The current real-input check uses the native system preference. With Use device setting, 59 frames contained zero intermediate positions and one distinct card transform. After selecting Full animation and reloading, the same wheel input produced nine intermediate positions and ten distinct rendered transforms, while the browser still reported reduced motion. [System-preference trace](qa/carousel-motion/system-reduced-live.json), [saved Full animation trace](qa/carousel-motion/full-animation-live.json). This proves the animation bypass is fixed; it is not a stable frame-rate benchmark. Significant scheduling gaps remain in this loaded environment.

Earlier matching-content screenshots established typography and geometry alignment at 1280 × 900 and 540 × 1009; they did not establish animation timing. They remain historical evidence for the prior 320 × 400 correction, not the current enlarged design.

The current paired check runs the original component and catalog in two same-origin frames. With both clocks advanced at 120Hz, **all 440 sampled progress values match exactly** across wheel pulses, reversal, dragging with momentum and interrupting a wheel spring with a drag. The catalog animation tree re-rendered zero times during these gestures. [Controlled trace](qa/carousel-motion/reference-parity.json).

The real-time paired check also recorded zero animation-tree re-renders. Its wheel/reversal maximum progress differences were 0.0072/0.0050, with matching settled positions; drag samples matched. A scheduling gap produced a larger interruption outlier before the curves converged again. [Real-time trace](qa/carousel-motion/browser-parity.json). Earlier reference and candidate runs likewise experienced severe scheduling gaps under high machine load. **Controlled gesture/spring behavior is verified; identical real-world frame rate or subjective feel is not established by these traces.**

Trusted Arc interactions verified neighboring-card centering, centered-card navigation and scrolling over the footer. Direct progress jumps, including catalog wrap and large positive/negative positions, preserved visible device titles, images and links. At 320, 375 and 1280 CSS pixels, the footer fits in one row and the document has no horizontal overflow.

Current product screenshots: [desktop](qa/carousel-motion/footer-1280.png), [375px](qa/carousel-motion/footer-375.png), [320px](qa/carousel-motion/footer-320.png). Playwriter's extension controls and cursor markers are not product UI.

## Reproduce the motion check

First check ordinary browsing: clear any QA media override using `Emulation.setEmulatedMedia` with `features: [{name: 'prefers-reduced-motion', value: ''}]`. Do not force `no-preference`. In the verified Arc session, open the catalog as `state.motionPage` and evaluate `scripts/qa/check-carousel-live-motion.cjs` inside an async function. It sends a real wheel input and records both Motion values and DOM transforms, together with the system, saved and effective preferences. It fails if Full animation produces no intermediate rendered positions. Repeat after a reload to verify persistence. `state.motionResultPath` chooses the JSON output.

For the separate controlled comparison:

Run a normal build and start the local preview. Generate the temporary fixtures from the supplied reference source:

```sh
node scripts/qa/prepare-carousel-motion.mjs /path/to/vertical-carousel-3d/source
```

In the existing, verified Arc Playwriter session, create or reuse a dedicated QA tab as `state.motionPage`, navigate it to `/__motion-qa/stepped.html`, and wait for both frames to load. Set `state.motionStepped = true`, then evaluate `scripts/qa/check-carousel-motion.cjs` inside an async function. Set `state.motionResultPath` to choose the JSON output; otherwise it writes `/tmp/gadgets-carousel-motion.json`. The check throws if controlled trajectories diverge or the animation tree re-renders. For diagnostic real-time sampling, use `/__motion-qa/` and `state.motionStepped = false`.

Run a normal build afterward to remove the QA routes and clock overrides. They are never included in the normal build. The clock helper is test-only and does not modify the production animation runtime.

Reference component SHA-256: `72a889083938c7a48cdf41d08c8c77c207d79439d6618961f061be85eafa6ca8`. The copied Motion vendor bundle remains byte-identical to the reference: `3e821e8b46494bd9f718d1b7ddce95257983e221f8c7744fc7fe8d59b0f5adc5`.

The source identifies itself as an adaptation of a published Ameva preview, not recovered authored source or a purchased Framer package. Existing source and image provenance records still apply to this local preview.


## Return to the selected card — 16 September 2026

The wrapper stores the selected device and canonical catalog filters in tab-local `gadgets.catalog-visit` storage when leaving or opening a card. A known selection is restored only for the same filters. Device back links retain the referring catalog query. The runtime accepts `initialProgress` (default zero) so a return starts at the selected card without a first-frame jump. Wheel, drag, momentum and spring parameters are unchanged. Both plain and filtered return paths passed in Arc; blocked/malformed storage falls back to the first card. The new state stores only a device slug and catalog URL.
