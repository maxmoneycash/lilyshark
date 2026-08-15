# Third-party notices

Lilyshark is GPL-3.0. It incorporates the following third-party work, whose
copyright and license notices are preserved with the code.

## SigurdOS

- **Location in this repo:** `third_party/sigurdos/`
- **Upstream:** https://github.com/hermes-gadget/SigurdOS-tdeck
- **Copyright:** (C) 2025 Ben (`hermes-gadget`), with contributions from
  `n30nex`, `gadgethd`, `Jah-yee`
- **License:** GPL-3.0-or-later (`third_party/sigurdos/LICENSE`)
- **Version:** `beta-0.1.47-RC9`, commit `ce59f0f`
- **Modified:** no — verbatim import

SigurdOS is standalone MeshCore messaging firmware for the LilyGo T-Deck.
Lilyshark builds its analyzer and Shelby storage layer on top of it; see
`third_party/sigurdos/ATTRIBUTION.md` for what we use and why.

SigurdOS itself vendors and depends on further third-party work — LVGL,
RadioLib, LovyanGFX, lodepng, DejaVu and Noto Emoji fonts, MeshCore, and
others — under their own licenses, recorded upstream in
`third_party/sigurdos/LICENSES/` and in that project's README.

## MeshCore

Both SigurdOS and the Lilyshark web analyzer speak the MeshCore protocol.
MeshCore (https://meshcore.co.uk) is MIT licensed. Its authors ask that
support go to them rather than to downstream projects, and we pass that
request along.

## meshcore-terminal

The Lilyshark web analyzer's terminal interface is ported from
`maxmoneycash/meshcore-terminal` (MIT), which was itself ported from
`perereus/meshtastic-terminal` (MIT). Recolored and extended here under
those licenses.
