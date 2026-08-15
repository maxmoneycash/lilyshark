# Lilyshark — Product Context

## Register

**Product.** Design serves the work. This is an instrument: a mesh-radio traffic
analyzer and network dashboard. It is also the public face at lilyshark.com, so the
first screen has to explain itself — but it earns attention by showing real telemetry,
not by selling.

## Users & Purpose

**Who:** RF operators, mesh-network hobbyists, and protocol engineers. Ham radio
licensees, Meshtastic/MeshCore/Reticulum users, security researchers doing field
surveys. Technically literate; they use Wireshark, they read hex, they know what SNR
means. They are hostile to marketing language and allergic to companies.

**Context of use:** Two modes. In the field, next to a LILYGO T-Deck running the
firmware — outdoors, often bright, often one-handed on a phone. At a desk, reading a
capture properly on a wide screen with the hex pane open.

**The job:** *"What is on the air around me, and can I prove it later?"* Capture
frames, read their radio measurements, inspect bytes, and keep the evidence somewhere
that cannot be quietly edited.

**Primary task per screen:**
- Traffic — open a `.lscap` capture and inspect frames. This is the product.
- Network — is the Shelby network healthy, and how much is stored on it.
- Whitepaper — the research the design rests on.

## Brand & Personality

**Three words:** Instrument, measured, unembellished.

The device is the brand. The firmware runs a dark 320×240 screen where lime means
live, cyan means navigation, amber means warning, coral means fault. The web app is
the same instrument on a bigger screen and must feel continuous with it — someone
putting the T-Deck down and opening the laptop should not feel a change of product.

Pink (`#FF4F9D`) is the wordmark and the single accent. It marks the active thing and
nothing else. It is not a background.

## Anti-references

- **Terminal-cosplay chrome.** Fake window dots, `[ bracket ]` button decoration,
  everything monospace at one size. Costume, not instrument.
- **Light pink everywhere.** A pink page is a toy. Pink is an accent.
- **SaaS dashboard.** Rounded cards in an even grid, big number + small label + soft
  shadow, gradient hero. This is a measuring tool.
- **Crypto landing page.** Glow, glass, animated gradients, "The future of…".
- **Undifferentiated monospace walls.** One typeface at one size with no hierarchy
  means the reader cannot find anything.

## Strategic design principles

1. **Data is the interface.** The screen is mostly readings. Chrome recedes.
2. **Continuity with the device.** Dark ground, the firmware's semantic colors, dense
   tabular numbers.
3. **Hierarchy through weight and scale, not boxes.** Cards only where a card is
   genuinely the right affordance. No nested cards.
4. **Honest empty and unavailable states.** The firmware states "unavailable"
   explicitly rather than showing a plausible zero; the web app does the same.
5. **No scrollbars in view.** Panes scroll internally without visible bars; the page
   itself does not scroll horizontally, ever.

## Accessibility

Body text ≥4.5:1 on its background — non-negotiable on a dark ground, where muted
grays fail most often. Tabular numerals for all measurements. Full keyboard reach on
the frame table. `prefers-reduced-motion` honored on every transition.
