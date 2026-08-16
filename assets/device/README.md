# Device wordmark asset

The T-Deck splash uses a native-size, 264×128 alpha mask generated from
`assets/brand/lilyshark-wordmark-pink.svg`. Center it on the 320×240 display at
`x=28`, `y=56`. Draw it at its native size so the panel receives the exact
antialiased pixels.

The A8 format stores one opacity byte per pixel. The committed image uses
33,792 bytes of flash and does not reserve a second framebuffer or a decoded
pixel copy. LVGL supplies the color at draw time, so the same mask can be pink,
white, or black. Lily Pink is `#FF4F9D`; its RGB565 value is `0xFA73`.

```cpp
#include "lilyshark/ui/assets/lilyshark_wordmark_a8.h"

lv_obj_t *logo = lv_image_create(parent);
lv_image_set_src(logo, &lilyshark_wordmark_a8);
lv_obj_set_style_image_recolor(logo, lv_color_hex(LILYSHARK_PINK_RGB888), 0);
lv_obj_set_style_image_recolor_opa(logo, LV_OPA_COVER, 0);
lv_obj_align(logo, LV_ALIGN_CENTER, 0, 0);
```

The checked-in C array is part of the firmware source. Normal builds do not
need an SVG renderer. To regenerate it, use librsvg 2.61.3 and Pillow 10.4.0:

```sh
uv run --with Pillow==10.4.0 scripts/generate_logo_asset.py
```

The source logo and generated mask are distributed under the repository's
GPL-3.0 license. librsvg and Pillow are generation tools and are not linked into
the firmware.
