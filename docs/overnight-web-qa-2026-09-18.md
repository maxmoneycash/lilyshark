# Overnight web QA — September 18, 2026

## What shipped (all on `main`, all live on lilyshark.com)

- **Intro on phones.** One design everywhere: the pinned 3D T-Deck whose
  screen changes as you scroll. The chapter copy takes its natural height and
  never scrolls inside itself; the device box is sized from the stage height
  minus the measured copy height (`--intro-copy-height`) minus padding and
  gap, floored at 150px and capped at 60dvh. Headline clamp(22px, 6.4vw,
  30px), body 15px; a step down under 700px tall. On phones the model is
  width-bound, so a taller cap only adds empty space; 60dvh is the verified
  value.
- **Chapter deep links.** `#intro?chapter=N` opens on chapter N (1-based,
  clamped). Used for every render below.
- **3D scene.** A canvas resize now paints a frame synchronously when the
  model is ready. `setSize` clears the canvas and the queued frame could be
  dropped by the visibility gate, leaving a blank box after late layout.
- **Map on phones.** The Leaflet attribution sits above the source footer
  (46px up, clear of a two-line footer) instead of behind it; the coverage
  legend moves up to stay clear.
- **Mesh summary.** "PUBLIC KEY" instead of "WITH PKI"; no empty HOPS panel;
  tile labels wrap only at spaces (320px used to show "POSITIO N").
- **Config.** Channel rows say KEY and NEW KEY instead of PSK and GEN.
- **iOS CI.** `testCancelDuringReenumerationDoesNotReopenThePort` waits for
  the fake deck's pseudo-terminal reader to go quiet before taking its
  baseline; it had failed on every main run since September 10 because a
  HELLO written just before the identify timeout arrived late. First
  all-green main run since then: 35333700195.
- **Docs index.** Three documents added to docs/README.md so `test_docs_sync`
  passes; the pnpm lockfile is v9 so the webapp CI job installs again.

## How it was verified

No Playwriter extension was connected in Arc or Polar, so the loop was:
serve `webapp/dist` on 127.0.0.1:4173 with a plain static server, expose it
through a Cloudflare quick tunnel, and render with remote screenshot services
(microlink until its daily quota, PhantomJsCloud's public demo key, and
thum.io through an iframe harness that fixes the viewport). The 3D model
renders in all of them. Live renders of lilyshark.com after each deploy are
the evidence that counts; branch renders through the harness caught the
defects before they shipped.

Viewports checked for the intro: 320×568, 375×667, 390×700, 390×701,
390×844, 430×932, 844×390 (landscape phone), 1440×900. Every other tab was
rendered at 320×568, 390×844 and 1440×900.

## Evidence

[qa/intro-sizing-2026-09-18](qa/intro-sizing-2026-09-18/): live renders of
the deployed intro (390×844 chapter 1, 390×700 and 320×568 chapter 4), the
live phone map with the fixed footer, and branch renders of the landscape
intro, the Mesh tiles at 320 and the Config channel rows at 390.

## Not done

- The static harness has no `/api` routes, so the MeshCore directory shows
  "could not be loaded" in harness renders; the live site loads it (62,268
  nodes in the live render). Not a bug.
- No physical iPhone Safari check. Scroll-snap feel on a real phone remains
  Max's call.
- Five pre-existing biome a11y warnings in IntroTab.tsx (focusable scroll
  regions) are untouched.
