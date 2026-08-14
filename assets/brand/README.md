# Lilyshark brand assets

The wordmark is a transparent, single-path SVG with no embedded bitmap, font, script, or external resource.

- `lilyshark-wordmark.svg` uses `currentColor` and can be recolored when embedded inline.
- `lilyshark-wordmark-black.svg` is the fixed black version for light surfaces.
- `lilyshark-wordmark-white.svg` is the fixed white version for dark surfaces.

The README uses the fixed variants because an SVG loaded through an HTML `img` element cannot reliably inherit the surrounding text color. GitHub selects the matching version for the reader's light or dark theme.
