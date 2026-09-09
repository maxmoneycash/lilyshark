# Lilyshark design guidance

The user requested Apple Design and Appllama on 2026-09-08. Read the full skills
when applying them; this document preserves the project decisions and verified
sources between sessions. It does not imply that a model has permanent memory.

## Verified skills

All installed skill files and bundled references matched their upstream revision
byte for byte on 2026-09-08. Existing installations were preserved.

| Skill | Official source | Verified revision | Installed directory |
| --- | --- | --- | --- |
| Apple Design | [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/main/skills/apple-design) | `d23d7f88a2e21c9e4b1418c7abe420f5c1052ba7` | `~/.agents/skills/apple-design/` and `~/.codex/skills/apple-design/` |
| Appllama App Design | [Appllama/appllama-skills](https://github.com/Appllama/appllama-skills/tree/main/skills/appllama-app-design-skill) | `dd5caaec3d5d50ad7fc0324da238119c6b7c3707` | `~/.agents/skills/appllama-app-design-skill/` and `~/.codex/skills/appllama-app-design-skill/` |
| Appllama Usage | [Appllama/appllama-skills](https://github.com/Appllama/appllama-skills/tree/main/skills/appllama-usage) | `dd5caaec3d5d50ad7fc0324da238119c6b7c3707` | `~/.agents/skills/appllama-usage/` and `~/.codex/skills/appllama-usage/` |

Appllama's research MCP was not available in this session. Its app design skill
works independently. Do not claim its screen library was researched. Read
`appllama-usage` before using that service if it becomes available.

## Product direction

Lilyshark owns the map, navigation, controls, and detail views. Build coverage
capabilities into SwiftUI/MapKit and React/Leaflet. Do not embed a competitor's
site, reproduce its interface, or add competitor branding to the product.
External datasets may be used through authorized access with their required
attribution. A denied or absent dataset must produce an honest, useful state.

Keep capabilities and measurement meanings aligned across iOS and web. Adapt
presentation to each platform: a native sheet on iPhone may become an adjacent
detail panel on desktop. Keep the established pink terminal identity on the web
and the existing semantic theme and Design tokens on iOS. These skills do not
authorize replacing the stack with Expo or introducing a different visual brand.

## Map design rules

- Give the map the main surface. Group layers, filters, and search into a small
  set of stable controls. Opening details must preserve the user's map position.
- Use the same words for the same actions on both platforms. Put advanced
  controls one level deeper without hiding the common path.
- Distinguish the connected radio, phone location, received node positions,
  recorded samples, and external observations. Missing coordinates are a state
  to explain; they are not evidence that a radio is absent from the mesh.
- Display data age and distinguish measured reception from calculated distance
  or estimated reach. Do not make a straight line imply a verified route.
- Keep one action accent, one neutral palette, and existing radius/spacing
  scales. Signal and warning colors communicate data, accompanied by text or
  symbols. Do not add decorative gradients, glows, emoji controls, or glass cards.
- Use platform typography and stable numeric alignment. Let longer node names
  wrap or truncate intentionally. Make useful identities and values copyable.
- Use native SwiftUI controls and existing accessible web primitives. Every
  touch control needs at least a 44-point or 44-pixel target. Icon buttons need
  accessible names, and browser controls need visible keyboard focus.
- Give feedback immediately. Keep gestures interruptible. Use platform motion
  for frequent actions; do not animate values people are reading. Honor reduced
  motion and use opaque surfaces when reduced transparency requires them.
- Preserve useful cached content during refresh. Design loading, empty, denied,
  offline, partial-data, and error states along with the populated map.

### User correction: compact map controls

The user rejected the tall filled source buttons, opaque navigation strip,
oversized search card and dominant map circles. Source tabs must be compact
segmented controls floating over the map. Keep Lilyshark's light theme and pink
accents as the finished presentation; the user explicitly rejected changing
the app to a dark theme. Restore any temporary QA theme setting before handing
back the preview. Use neutral map surfaces, keep the
accent for meaningful selection, and prevent terminal hover/raised-key styles
from leaking into map controls. The visible face may be smaller than its touch
target. Keep public keys and detailed coordinates in a disclosure, preserve
camera position between sources, and show a clear selected marker. A static
city heading must not imply that a panned map is still centered on that city.

## Verification required before claiming completion

Inspect the running iPhone and desktop/mobile web layouts. Exercise every new
control, filtering and detail dismissal, keyboard focus, long names, missing
positions, empty data, network failure, and cache restoration. Check light/dark
themes, larger text, safe areas, and reduced motion. Review whole interaction
flows in motion; screenshots establish layout but cannot establish smoothness.
Do not claim measured frame rates or hardware radio visibility from a simulator.

Use the currently authorized tooling: Argent for native simulator interaction,
and Arc through Playwriter for local browser automation. The source skills'
example commands do not override those session rules.
