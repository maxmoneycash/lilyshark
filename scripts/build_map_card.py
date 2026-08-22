#!/usr/bin/env python3
"""Build a microSD map card: a tile pyramid the T-Deck can read anywhere.

The firmware carries imagery for one baked location. Away from it the map falls
back to a drawn chart, and moving the imagery means a rebuild and a reflash. A
card fixes that.

Card tiles sit on the Web Mercator pixel grid: tile (i, j) at zoom z is exactly
the world pixels [i*320, i*320+320) by [j*204, j*204+204). They meet edge to
edge with no gaps, which the older 0.001-degree cell naming cannot do -- a cell
is 55 m by 87 m while a z20 tile spans only 37 m, so deep-zoom neighbours fall
short of each other and leave holes.

Copy the output directory onto the card as /maps.
"""
from __future__ import print_function

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fetch_satellite_map import render_view, to_rgb565  # noqa: E402

TILE_W = 320
TILE_H = 204
BASE_PX = 256.0


def world_span_px(zoom):
    return BASE_PX * (2 ** zoom)


def px_x(lon, zoom):
    return (lon + 180.0) / 360.0 * world_span_px(zoom)


def px_y(lat, zoom):
    sine = math.sin(math.radians(lat))
    sine = max(-0.9999, min(0.9999, sine))
    return (0.5 - math.log((1.0 + sine) / (1.0 - sine)) / (4.0 * math.pi)) * world_span_px(zoom)


def meters_per_pixel(lat, zoom):
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** zoom)


def tile_plan(lat, lon, zoom, radius_m, max_tiles):
    """Which tiles to build, shrunk to fit the budget rather than silently cut."""
    mpp = meters_per_pixel(lat, zoom)
    radius_px = radius_m / mpp
    centre_i = int(math.floor(px_x(lon, zoom) / TILE_W))
    centre_j = int(math.floor(px_y(lat, zoom) / TILE_H))
    rx = max(0, int(math.ceil((radius_px - TILE_W / 2.0) / TILE_W)))
    ry = max(0, int(math.ceil((radius_px - TILE_H / 2.0) / TILE_H)))
    asked = (2 * rx + 1) * (2 * ry + 1)
    while (2 * rx + 1) * (2 * ry + 1) > max_tiles and (rx > 0 or ry > 0):
        if rx >= ry and rx > 0:
            rx -= 1
        elif ry > 0:
            ry -= 1
        else:
            break
    return centre_i, centre_j, rx, ry, mpp, asked


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--radius-km", type=float, default=1.0,
                    help="how far from the centre to cover (default 1 km)")
    ap.add_argument("--min-zoom", type=int, default=12)
    ap.add_argument("--max-zoom", type=int, default=20)
    ap.add_argument("--style", choices=("satellite", "dark", "both"), default="both")
    ap.add_argument("--out", required=True, help="directory to become /maps on the card")
    ap.add_argument("--max-tiles", type=int, default=49,
                    help="per zoom per style; the radius shrinks to fit (default 49)")
    ap.add_argument("--force", action="store_true", help="rebuild tiles that already exist")
    ap.add_argument("--dry-run", action="store_true", help="report the plan, download nothing")
    ap.add_argument("--cache",
                    default=os.path.join(os.path.expanduser("~"), ".cache", "lilyshark-tiles"))
    args = ap.parse_args()

    if args.min_zoom > args.max_zoom:
        print("--min-zoom must not exceed --max-zoom", file=sys.stderr)
        return 2
    styles = ("satellite", "dark") if args.style == "both" else (args.style,)
    radius_m = args.radius_km * 1000.0

    total = 0
    written = 0
    for zoom in range(args.min_zoom, args.max_zoom + 1):
        centre_i, centre_j, rx, ry, mpp, asked = tile_plan(
            args.lat, args.lon, zoom, radius_m, args.max_tiles
        )
        count = (2 * rx + 1) * (2 * ry + 1)
        span_e = (2 * rx + 1) * TILE_W * mpp
        span_n = (2 * ry + 1) * TILE_H * mpp
        note = ""
        if count < asked:
            # Say so out loud. A card that quietly covers less than asked looks
            # like a working map right up until you walk off the edge of it.
            note = " (trimmed from %d by --max-tiles)" % asked
        print("z%-2d  %2d tiles/style  covers %.0f m x %.0f m  %.2f m/px%s"
              % (zoom, count, span_e, span_n, mpp, note))
        for style in styles:
            kind = "sat" if style == "satellite" else "dark"
            for j in range(centre_j - ry, centre_j + ry + 1):
                for i in range(centre_i - rx, centre_i + rx + 1):
                    total += 1
                    path = os.path.join(args.out, kind, "z%d" % zoom, "%d_%d.rgb565" % (i, j))
                    if args.dry_run:
                        continue
                    if os.path.exists(path) and not args.force:
                        continue
                    image = render_view(
                        args.lat, args.lon, TILE_W, TILE_H, zoom, args.cache, style,
                        origin=(i * TILE_W, j * TILE_H),
                    )
                    parent = os.path.dirname(path)
                    if parent:
                        os.makedirs(parent, exist_ok=True)
                    with open(path, "wb") as handle:
                        handle.write(to_rgb565(image))
                    written += 1
                    print("  wrote %s" % path)

    megabytes = total * TILE_W * TILE_H * 2 / (1024.0 * 1024.0)
    if args.dry_run:
        print("\nplan: %d tiles, %.1f MB. Re-run without --dry-run to build." % (total, megabytes))
    else:
        print("\n%d tiles (%d new), %.1f MB in %s" % (total, written, megabytes, args.out))
        print("Copy it to the card root as /maps, then the map follows you there.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
