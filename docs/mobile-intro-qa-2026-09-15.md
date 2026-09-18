# Mobile web intro — September 15, 2026

## Result

The T-Deck leads the portrait layout and uses the available space above compact
chapter text. The full handset and metal antenna base stay in view; the long
rubber boot/whip may extend beyond the stage. Landscape and desktop retain the
side-by-side layout. All 12 chapters and 33 curated firmware screens remain.

Vertical swipes starting on the model scroll the introduction in either direction.
Sideways drags rotate it. The model wrapper had `touch-action: none`, which blocked
scrolling even though the canvas allowed vertical panning. Both surfaces now allow
vertical pan and pinch zoom, and touch rotation waits for horizontal intent.
Mouse and keyboard rotation remain available.

## Validation

Used the dedicated Arc tab through Playwriter session 28 against the local Vite
preview at `http://127.0.0.1:5173/`.

- Visually checked 320×568, 390×844, 540×960, 844×390, and 1440×900 layouts.
- Actual touch input over the canvas advanced splash → Home; the reverse gesture
  returned Home → splash. Confirmed the rendered firmware frame after each gesture.
- A sideways touch drag rotated the handset to its back while the splash frame
  remained selected. Keyboard Home restored the original pose.
- Long chapter text scrolls within its panel. Scrolled to the routing diagram,
  switched to MeshCore routing, and verified its controls and caption were visible.
- Reached the final storage frame and scrolled the short-phone text panel to its
  action buttons.
- All 621 web tests pass; TypeScript and the final production build pass.
  Vite reports the existing large-chunk advisory. `git diff --check` passes.

Touch checks used Arc touch emulation, not physical iPhone Safari. Some automation
calls timed out after sending input; subsequent frame observations confirmed the
actions completed. This is not a browser-performance measurement.

## Evidence

Screenshots are in [qa/mobile-intro-2026-09-15](qa/mobile-intro-2026-09-15/).
The small white toolbar over the header belongs to Playwriter.

Changes are local and uncommitted. Nothing was published.
