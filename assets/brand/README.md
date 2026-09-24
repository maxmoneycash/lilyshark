# Lilyshark brand assets

The wordmark is a transparent, single-path SVG with no embedded bitmap, font, script, or external resource.

- `lilyshark-wordmark-pink.svg` uses Lily Pink (`#FF4F9D`), the primary brand color.
- `lilyshark-wordmark.svg` uses `currentColor` and can be recolored when embedded inline.
- `lilyshark-wordmark-black.svg` is the fixed black version for light surfaces.
- `lilyshark-wordmark-white.svg` is the fixed white version for dark surfaces.

The logotype -- LILY in a neutral, SHARK in Lily Pink, with the fin cut into the A -- ships as transparent PNGs cropped to the letterforms:

- `lilyshark-logotype-light.png`: black LILY, for light surfaces.
- `lilyshark-logotype-dark.png`: white LILY, for dark surfaces.

Both are 2078x757 at full resolution; the web app carries 1000px-wide copies in `webapp/public/`. The mark (the "lily" shark above) and the logotype are used together: mark first, logotype after, as in the analyzer header and the top of the project README. A vector logotype does not exist yet; regenerate the PNGs from the source artwork rather than upscaling these.

The project README shows the mark in Lily Pink on both GitHub themes and swaps the logotype by `prefers-color-scheme`. The fixed black and white files are available for one-color production work. Use the `currentColor` file inline when CSS needs to control the logo color.
