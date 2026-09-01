# iOS 6 lab

A 320×240 playground for iterating an iOS 6-style shell on the T-Deck
panel. Nothing here is compiled into the firmware.

The device is 320×240 RGB565 (76,800 pixels, 65,536 colours), ST7789 at
rotation 1, LilyGO 2.8″ IPS. Firmware CHAT already uses this chrome —
glossy `ios6_panel` fills, 4 bpp `font_condensed_12` on bubbles, 1 bpp
`font_pixel_6x8` on chrome. HOME and the analyzer views still paint the
1-bit face on the same 16-bit panel. This folder is where the rest of
that language gets tried before anyone ports it.

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
| Messages | Firmware CHAT layout, same `kIos6*` / `kChat*` numbers |
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

`js/palette.js` copies `kIos6*` and `kChat*` from `src/sim_main.cpp`.
`test/ios6_lab/test_ios6_lab.py` fails if those numbers drift.

## Porting

A draft that earns its pixels goes into `src/sim_main.cpp` the same way
CHAT did: `ios6_panel`, the existing LVGL fonts, no new flash cost.
This folder stays the sketchbook.
