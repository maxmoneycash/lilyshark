# Demo production guide

Everything needed to produce the submission video in about two hours. Three
routes are covered: a screen-recorded 90-second demo (section 1, the primary
deliverable), an AI-generated 3D video version (section 2), and a flat 2D
animated version (section 3). All three tell the same story in the same order
and share one narration script. Section 4 is the talking-point list for live
Q&A.

The numbers used throughout are the measured ones: R = 7.36 transmissions per
delivered message on a flooded mesh at realistic density (against the 3–5
usually assumed), and reach falling from 68.6% to 25.8% as nodes are added.
The pointer is 82 bytes, magic `SHLB`, defined in
`include/lilyshark/shelby/shelby_pointer.h`.

Palette, for anything you generate or overlay: near-black background, pink
`#F05AA6` accent, lime `#66F05A` for live data, cyan `#71D8DF` for
information, off-white `#F0F4EF` for text.

---

## 1. 90-second screen-recording storyboard

One continuous video cut from four screen recordings. Record each source
separately, then assemble in any editor (iMovie, CapCut, DaVinci Resolve) and
read the narration over the cut, or record the narration first and cut to it.

### Shot list

| # | Time | Source | On screen | Narration (see full script below) |
| - | --- | --- | --- | --- |
| 1 | 0:00–0:08 | `site/` 3D demo, record mode | Cold open: T-Deck standing in a dark field, mesh nodes scattered across terrain, translucent radio rings expanding and overlapping. Caption overlays from record mode are on. | "A flooded LoRa mesh spends most of its airtime repeating itself…" |
| 2 | 0:08–0:20 | `site/` 3D demo, record mode | The scripted sequence continues: a small glowing packet hops node to node; the camera follows it to the gateway; the gateway beams up to the Shelby lattice and the blob resolves back down. | "…7.36 transmissions per delivered message… reach falls from 68.6 to 25.8 percent…" |
| 3 | 0:20–0:28 | LVGL simulator | Traffic view (`.pio/build/simulator/program 1`): dense green-on-black frame feed, one row focused. | "This is Lilyshark: Wireshark for mesh radio…" |
| 4 | 0:28–0:34 | LVGL simulator | Spectrum view (`program 2`): the SX1262 power-histogram sweep rendering in color. | "…captures Meshtastic, MeshCore, and Reticulum frames straight off the SX1262…" |
| 5 | 0:34–0:48 | LVGL simulator | Packet detail (`program 5`) on a frame carrying a Shelby pointer: decoded fields — magic `SHLB`, version, flags, 32-byte commitment, owner address, size, expiry — above the raw hex view. Hold this shot; it is the core of the demo. | "Here it decodes something new: a Shelby pointer. Eighty-two bytes…" |
| 6 | 0:48–1:00 | Webapp (`webapp/`, `pnpm dev`) | Traffic tab: click "Open .lscap", load a capture, scroll the frame table, open the same Shelby-pointer frame in the browser. Then type a blob name into the "Shelby blob name…" field and fetch the capture from Shelby itself. | "When the pointer reaches a gateway with an IP path…" |
| 7 | 1:00–1:15 | Webapp | Shelby Pulse dashboard: step through overview → activity → economy → providers tabs. Let the live charts draw. | "…on the dashboard, the same capture opens in the browser, and Shelby's network activity is live underneath it." |
| 8 | 1:15–1:30 | End card | Static frame, near-black, pink wordmark (`assets/brand/lilyshark-wordmark-pink.svg`), then in mono: `github.com/maxmoneycash/lilyshark` and `Open source · GPL-3.0`. Hold 8 seconds, fade out. | "Everything here is open source, GPL-3.0…" |

### Narration script (~185 words, read in about 80 seconds at a calm pace)

> A flooded LoRa mesh spends most of its airtime repeating itself. Measured
> against Meshtastic's own simulator, a delivered message costs 7.36
> transmissions at realistic density, and reach falls from 68.6 percent to
> 25.8 percent as nodes are added. Airtime is the scarce resource.
>
> This is Lilyshark: Wireshark for mesh radio, running on a LILYGO T-Deck. It
> captures Meshtastic, MeshCore, and Reticulum frames straight off the SX1262
> — raw bytes, RF measurements, spectrum — all on the device.
>
> Here it decodes something new: a Shelby pointer. Eighty-two bytes that
> reference a blob on Shelby, the storage protocol built on Aptos. Instead of
> pushing a photo or a capture file through the mesh, a node sends the
> reference. Any unmodified node forwards it — it is a payload convention,
> not a new protocol.
>
> When the pointer reaches a gateway with an IP path, the gateway resolves it
> against Shelby and fetches the real bytes. On the dashboard, the same
> capture opens in the browser, and Shelby's network activity is live
> underneath it.
>
> Everything here is open source, GPL-3.0, and runs on any Meshtastic-class
> hardware with a screen.

### Recording notes

- Record at 1080p or higher. Retina Macs capture at 2x; keep it — downscale
  at export, never upscale.
- macOS: `Cmd+Shift+5`, choose "Record Selected Portion", set the region once
  and reuse it for every browser shot so cuts do not jump. QuickTime is fine;
  OBS if you want one session with scene switching.
- Browser shots: hide the bookmarks bar (`Cmd+Shift+B`), use a clean profile
  or a guest window, go full screen or crop the chrome out in the edit. Hide
  the dock and menu bar auto-hide before recording.
- Simulator shots: the SDL window is 320x240 — record it small and scale up
  with nearest-neighbor in the editor so pixels stay crisp, or record a
  4x-zoomed region.
- Do not resize any window mid-shot. Kill notifications (macOS Focus mode).
- Record narration separately with any USB mic or AirPods in a quiet room;
  one continuous take is easier to cut against than per-shot lines.
- The `site/` record mode auto-plays its scripted sequence with captions —
  start the recording, trigger record mode, and do not touch the mouse until
  it finishes.
- Export: H.264, 1080p, 30 fps is enough. Check audio level peaks around
  -6 dB.

---

## 2. AI-generated realistic 3D video prompts

Six prompts for a text-to-video model (Veo 3, Sora, Runway Gen-4). One prompt
per shot, 5–8 second clips, cut together against the same narration as
section 1 in the same order. Keep the seed/style consistent where the tool
allows it. Shared visual grammar for every prompt: night or dusk, near-black
ambient, pink #F05AA6 as the single accent light, lime green for data and
signal, cyan for information overlays, no lens flares, no text unless stated.

Physical accuracy for the device in every shot: the LILYGO T-Deck is a small
black handheld, roughly palm-sized, with a landscape 2.8-inch color screen in
the upper half, a compact QWERTY thumb keyboard below it, a small trackball
between screen and keyboard, and a stubby SMA antenna on the top edge. It is
not a phone and not a walkie-talkie; think tiny blackberry-shaped terminal.

**(a) Macro product shot — 6s.**
Macro lens, shallow depth of field, slow push-in. A small black handheld
device held in one hand at golden hour in a remote high-desert landscape,
mountains soft in the background. The device is a LILYGO T-Deck: landscape
2.8-inch color screen above a compact QWERTY thumb keyboard, a small
trackball between them, a stubby black SMA antenna on the top edge. The
screen shows a dense green-on-black monospaced packet feed scrolling slowly,
with one row highlighted in pink #F05AA6. Warm rim light from the setting sun
on the antenna and the user's knuckles; the screen glow is lime green
#66F05A. Camera drifts from a three-quarter angle to nearly straight-on over
the screen. Realistic skin, dust in the air, no text overlays.

**(b) Aerial mesh pull-back — 8s.**
Aerial drone shot beginning 30 meters above a lone figure holding a small
black handheld radio in scrubland at dusk, pulling straight up and back to
2 kilometers. As the camera rises, translucent expanding radio-wave rings —
thin lime-green #66F05A circles on the dark terrain — ripple outward from a
dozen scattered points of pink #F05AA6 light: mesh nodes on ridgelines,
rooftops, and a water tower. The rings overlap and interfere where nodes are
dense. The landscape is near-black with faint cyan #71D8DF haze at the
horizon. Smooth constant-speed ascent, slight forward tilt at the end to
frame the whole mesh. Realistic terrain, stylized signal graphics, no text.

**(c) Packet-hop data visualization — 6s.**
Stylized 3D data visualization, tracking shot. Over a dark low-poly terrain,
a tiny glowing packet — a compact pink #F05AA6 capsule labeled only by its
size, small enough to read as a fragment — leaps node to node along a chain
of lime-green points of light, each hop emitting one thin expanding ring.
Beside the path, enormous translucent gray blocks — full-size blobs, hundreds
of times the packet's volume — sit inert on the ground, never lifting off. The
camera tracks laterally with the packet at its speed, blobs sliding past in
the foreground as scale reference. Near-black sky, cyan grid lines fading
into the terrain. Clean, precise motion; no text.

**(d) Gateway uplink to Shelby — 7s.**
Low-angle hero shot, slow orbit. A gateway node — a small mast with a stubby
antenna and one pink #F05AA6 status light — stands on a ridge under a
star-dense night sky. The tiny pink packet arrives with a final lime-green
ring, and a narrow vertical beam of cyan #71D8DF light rises from the mast
into a vast constellation overhead: a geometric lattice of white and cyan
points connected by faint lines, reading as a storage network rather than
stars. One lattice cell brightens pink as the beam touches it, and a thicker
stream of light returns down the beam — the resolved blob, visibly larger
than what went up. Camera orbits 90 degrees around the mast during the
exchange. No text.

**(e) Resolution on the dashboard — 5s.**
Close-up, static camera with a slow rack focus. A phone and an open laptop on
a dark table, both showing the same near-black dashboard with lime and cyan
charts and a pink accent header. On the phone, a progress ring completes and
a full photograph resolves sharply into view — the payload the mesh never had
to carry. Screen glow lights the scene; faint reflection of the image on the
table surface. Rack focus from the laptop's live charts to the phone as the
image lands. Realistic devices, believable UI density, no readable text
beyond chart shapes.

**(f) Closing hero — 6s.**
Slow cinematic pull-back at night. The T-Deck (same physical description as
shot a: landscape screen over QWERTY thumb keyboard, trackball, stubby SMA
antenna) stands propped on a rock, screen on, green packet feed running, the
lone warm object in a vast dark landscape. Behind and above it, the whole
scene from earlier shots is faintly visible at once: pink node lights on the
terrain, one thin cyan beam on the horizon, the lattice dim in the sky. The
camera pulls back and up until the device is a single green-lit point among
the nodes — one more participant in the mesh. Fade to black. No text; the end
card from section 1 is overlaid in the edit.

---

## 3. 2D stop-motion / animated version

The same story as flat 2D animation. Illustrate the keyframes by hand or
generate them as a consistent-style series and animate with simple cuts,
slides, and pops (2–4 seconds per keyframe covers the same narration).

Base style string, prepended to every prompt:

> Flat 2D technical illustration, paper-cutout stop-motion style, visible
> paper texture and hard drop shadows, dark near-black background, limited
> palette: pink #F05AA6, lime green #66F05A, cyan #71D8DF, off-white #F0F4EF.
> No gradients, no 3D shading, no photographic elements.

**K1 — The flooded mesh.**
A field of ten paper-cutout radio towers on a dark ground line. Every tower
emits overlapping lime concentric arcs that collide and crowd the sky until
almost no dark space remains. One small off-white envelope is lost among the
arcs. Composition: wide, cluttered on purpose.

**K2 — The cost, as a diagram.**
Centered infographic card: one envelope on the left, an arrow to the right,
and 7.36 tally-mark transmission icons stacked above the arrow. Below, a
simple two-bar chart: a tall lime bar labeled 68.6% and a short pink bar
labeled 25.8%. Off-white hand-set numerals; nothing else on the card.

**K3 — The device.**
A single large paper-cutout T-Deck, straight-on: black rounded rectangle,
landscape screen showing five rows of tiny lime dashes (a packet feed, one
row pink), a grid of small keyboard dots below, a round trackball dot, a
stubby antenna nub on top. Centered on dark, slight paper shadow.

**K4 — The pointer.**
The T-Deck's screen zoomed to fill the frame. On it, one small pink ticket
labeled "SHLB · 82 B" beside an enormous folded gray paper bundle labeled
only by its bulk. A cutout hand places the ticket — not the bundle — onto an
outgoing lime arc. The bundle stays put.

**K5 — The hops.**
A horizontal chain of five paper radio towers. The pink SHLB ticket slides
along the chain, one thin lime arc popping at each tower it passes. The
towers are plain and identical — nothing about them changes to carry the
ticket. Wide shot, lots of dark space, calm rhythm.

**K6 — The gateway and the lattice.**
The last tower in the chain stands taller, with a cyan dashed line rising
from its tip to a paper-cutout lattice of white dots and lines across the top
of the frame — the Shelby network. One lattice dot is pink. The dashed line
is the only vertical element; everything else is horizontal.

**K7 — The blob comes back.**
Same composition as K6, but now a wide cyan band flows down the dashed line
into the gateway, and the big gray bundle from K4 reappears at its base,
unfolded into a visible photograph cutout. The pink ticket sits beside it,
spent.

**K8 — Open source.**
Closing card: the pink Lilyshark wordmark shape centered, below it in
off-white cutout letters `github.com/maxmoneycash/lilyshark` and a small
lime `GPL-3.0` tag. Dark background, paper shadows, nothing else.

---

## 4. Talking points

- On a flooded mesh at realistic density, a delivered message costs a
  measured R = 7.36 transmissions — roughly double the 3–5 usually assumed —
  so channel time, not node count, is the binding constraint.
- Reach falls from 68.6% to 25.8% as nodes are added, because every relay
  consumes the same shared airtime; adding hardware makes delivery worse.
- The design response is to send a reference, not a payload: an 82-byte
  Shelby pointer instead of the blob itself, cutting the on-air cost of large
  content to a single small frame.
- The pointer is a payload convention, not a new link layer — it rides inside
  Meshtastic, MeshCore, or Reticulum payloads, so every unmodified node on an
  existing mesh already forwards it.
- 82 bytes carries a full 32-byte blob commitment, a 32-byte owner account
  address, size, expiry, and chunk fields, and still leaves headroom inside a
  practical ~200-byte Meshtastic payload.
- Resolution is asymmetric by design: any node with an IP path — a fixed
  gateway or the operator's phone when it next has signal — fetches the real
  bytes from Shelby, the paid storage protocol with settlement on Aptos.
- The whole stack is open: GPL-3.0 firmware, an open webapp (Shelby Pulse
  dashboard plus a browser `.lscap` viewer that can fetch captures from
  Shelby by blob name), and commodity LILYGO hardware.
- The analyzer core is hardware-portable — capture records, decoders, and
  export formats are independent of the T-Deck's display and input — so the
  pointer workflow runs on any Meshtastic-class device with a screen.
- Lilyshark is also the measurement instrument for its own claim: it captures
  the frames, RF metadata, and airtime numbers that make the retransmission
  economics visible in the field.
- The pattern composes with DePIN backhaul: gateways can resolve pointers
  over decentralized transport such as DoubleZero, so the off-grid edge and
  the settlement layer are both community-operated infrastructure.
