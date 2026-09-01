# iOS 6 lab

A 320×240 playground for iterating an iOS 6-style shell on the T-Deck
panel. Nothing here is compiled into the firmware.

The device is 320×240 RGB565 (76,800 pixels, 65,536 colours), ST7789 at
rotation 1, LilyGO 2.8″ IPS. The skeuomorphic Messages treatment that
briefly lived on main now sits on `agent/ios6-chat-ui` (held at
`2ae8e70`, moved off main by `a15bd3e`). Main is the terminal chat
again. This folder is the sketchbook for taking that language further
before anyone ports it back.

HOME and the analyzer views still paint the 1-bit `font_pixel_6x8` face
on the same 16-bit panel. The extra tones on the iOS 6 frames come from
`font_condensed_12` (4 bpp) plus gradient fills and corner AA.

## Open it

From the repository root:

```sh
python3 -m http.server 8765
```

Then <http://localhost:8765/experiments/ios6/>.

The Barlow and IBM Plex faces load from `assets/fonts`. Serving from
this directory instead of the repo root leaves those URLs broken; the
lab still runs on Helvetica / Arial.

## Screens

| Screen | What it is |
| --- | --- |
| Lock | Wallpaper, clock, slide to unlock |
| Home | SpringBoard icon grid + dock |
| Field | HOME’s radio facts in grouped iOS 6 chrome |
| Messages | The `agent/ios6-chat-ui` CHAT layout, same `kIos6*` / `kChat*` numbers |
| Nodes | Heard roster as a grouped table |
| Radio | Felt face, LCD readout, LISTEN |
| Settings | Grouped tables + the RGB565 switch |
| Kit | Shared primitives on one frame |

Click icons, type on Messages (Enter sends, Tab cycles peers), drag the
lock slider. 1× / 2× / 3× are integer scales of the real panel.
Quantize to RGB565 walks the framebuffer the way the ST7789 does.
Distinct colors is a live count of that frame.

Font faces:

- **Helvetica** — the iOS 6 face
- **Barlow** — firmware 4 bpp condensed
- **Pixel 6×8** — firmware 1 bpp (Adafruit GLCD 5×7 in a 6 px cell)

## Palette

`js/palette.js` holds the kit from `agent/ios6-chat-ui` @ `2ae8e70`.
`test/ios6_lab/test_ios6_lab.py` freezes those numbers. It does not
read the terminal chat still in `src/sim_main.cpp`.

The measured reference screenshot for bubbles is the kit’s
`public/reference/chat.png` (content-sized multi-line blocks, not
single-line strips).

## Porting

A draft that earns its pixels goes onto `agent/ios6-chat-ui` the same
way CHAT did there: `ios6_panel`, the existing LVGL fonts, no new
flash cost. This folder stays the sketchbook. Main stays the terminal
chat until that branch is ready to come back.
