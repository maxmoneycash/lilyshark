#!/usr/bin/env python3
"""Composite a T-Deck RGB565 field map: satellite or dark streets, with contours."""

from __future__ import print_function

import argparse
import math
import os
import struct
import subprocess
import sys

try:
    from PIL import Image
except ImportError:
    print("Pillow is required", file=sys.stderr)
    sys.exit(2)

TILE_SIZE = 256
USER_AGENT = "LilysharkMap/1.0 (field simulator)"

# Esri uses z/y/x. OSM / Carto / Mapzen use z/x/y.
SOURCES = {
    "imagery": (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        "World_Imagery/MapServer/tile/%d/%d/%d",
        "esri",
    ),
    "hillshade": (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        "Elevation/World_Hillshade/MapServer/tile/%d/%d/%d",
        "esri",
    ),
    "terrarium": (
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/%d/%d/%d.png",
        "osm",
    ),
    "dark": (
        "https://basemaps.cartocdn.com/dark_all/%d/%d/%d.png",
        "osm",
    ),
    "labels": (
        "https://basemaps.cartocdn.com/dark_only_labels/%d/%d/%d.png",
        "osm",
    ),
}


def deg_to_tile(lat, lon, zoom):
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def tile_url(source, zoom, tx, ty):
    template, scheme = SOURCES[source]
    if scheme == "esri":
        return template % (zoom, ty, tx)
    return template % (zoom, tx, ty)


def fetch_tile(source, zoom, x, y, cache_dir, mode="RGB"):
    ext = "jpg" if source in ("imagery", "hillshade") else "png"
    path = os.path.join(cache_dir, source, "%d-%d-%d.%s" % (zoom, x, y, ext))
    if not (os.path.isfile(path) and os.path.getsize(path) > 512):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        url = tile_url(source, zoom, x, y)
        try:
            subprocess.check_call(
                [
                    "curl",
                    "--http1.1",
                    "-fsSL",
                    "--retry",
                    "2",
                    "--max-time",
                    "30",
                    "-A",
                    USER_AGENT,
                    "-o",
                    path,
                    url,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError:
            if os.path.isfile(path):
                os.remove(path)
            raise RuntimeError("tile fetch failed %s" % url)
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            raise RuntimeError("empty tile %s" % url)
    return Image.open(path).convert(mode)


def composite(lat, lon, width, height, zoom, cache_dir, source, mode="RGB", origin=None):
    """Render a width x height patch of `source`.

    Centred on lat/lon by default. Pass `origin` as a (left, top) world-pixel
    corner to render an exact patch of the Web Mercator grid instead -- that is
    what the microSD tile pyramid needs, since its tiles must line up edge to
    edge rather than each being centred on somewhere.
    """
    if origin is None:
        cx, cy = deg_to_tile(lat, lon, zoom)
        left = int(math.floor(cx * TILE_SIZE - width / 2.0))
        top = int(math.floor(cy * TILE_SIZE - height / 2.0))
    else:
        left = int(origin[0])
        top = int(origin[1])
    right = left + width
    bottom = top + height
    x0 = int(math.floor(left / float(TILE_SIZE)))
    y0 = int(math.floor(top / float(TILE_SIZE)))
    x1 = int(math.floor((right - 1) / float(TILE_SIZE)))
    y1 = int(math.floor((bottom - 1) / float(TILE_SIZE)))
    fill = (0, 0, 0, 0) if mode == "RGBA" else (0, 0, 0)
    mosaic = Image.new(mode, (width, height), fill)
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            tile = fetch_tile(source, zoom, tx, ty, cache_dir, mode)
            paste_x = tx * TILE_SIZE - left
            paste_y = ty * TILE_SIZE - top
            if mode == "RGBA":
                mosaic.paste(tile, (paste_x, paste_y), tile)
            else:
                mosaic.paste(tile, (paste_x, paste_y))
    return mosaic


def terrarium_elevation(image):
    pixels = image.load()
    width, height = image.size
    elev = [[0.0] * width for _ in range(height)]
    for y in range(height):
        for x in range(width):
            red, green, blue = pixels[x, y]
            elev[y][x] = (red * 256.0 + green + blue / 256.0) - 32768.0
    return elev


def contour_interval(zoom):
    if zoom >= 15:
        return 10.0
    if zoom >= 12:
        return 20.0
    return 50.0


def punch_imagery(image, contrast=1.38, lift=18):
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            red, green, blue = pixels[x, y]
            red = int((red - 128) * contrast + 128 + lift)
            green = int((green - 128) * contrast + 128 + lift)
            blue = int((blue - 128) * contrast + 128 + lift)
            pixels[x, y] = (
                0 if red < 0 else 255 if red > 255 else red,
                0 if green < 0 else 255 if green > 255 else green,
                0 if blue < 0 else 255 if blue > 255 else blue,
            )
    return image


def draw_contours(base, elevation, interval, dark):
    pixels = base.load()
    width, height = base.size
    index_every = 5
    if dark:
        line = (214, 190, 118)
        major = (255, 224, 140)
        halo = (0, 0, 0)
        line_alpha = 0.70
        major_alpha = 0.92
    else:
        line = (248, 248, 236)
        major = (255, 255, 255)
        halo = (16, 18, 14)
        line_alpha = 0.50
        major_alpha = 0.84

    def crosses(here, there):
        if here < 2.0 or there < 2.0:
            return False
        return int(math.floor(here / interval)) != int(math.floor(there / interval))

    def index_level(here, there):
        lo = min(here, there)
        hi = max(here, there)
        step = interval * index_every
        level = math.ceil(lo / step) * step
        return level < hi - 1e-6

    marks = [[0] * width for _ in range(height)]
    for y in range(height):
        row = elevation[y]
        for x in range(width):
            here = row[x]
            hit = False
            is_major = False
            if x + 1 < width and crosses(here, row[x + 1]):
                hit = True
                is_major = is_major or index_level(here, row[x + 1])
            if y + 1 < height and crosses(here, elevation[y + 1][x]):
                hit = True
                is_major = is_major or index_level(here, elevation[y + 1][x])
            if hit:
                marks[y][x] = 2 if is_major else 1

    def blend(x, y, color, alpha):
        red, green, blue = pixels[x, y]
        pixels[x, y] = (
            int(red * (1.0 - alpha) + color[0] * alpha),
            int(green * (1.0 - alpha) + color[1] * alpha),
            int(blue * (1.0 - alpha) + color[2] * alpha),
        )

    for y in range(height):
        for x in range(width):
            if marks[y][x] == 0:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height and marks[ny][nx] == 0:
                    blend(nx, ny, halo, 0.55)
    for y in range(height):
        for x in range(width):
            mark = marks[y][x]
            if mark == 2:
                blend(x, y, major, major_alpha)
            elif mark == 1:
                blend(x, y, line, line_alpha)


def blend_hillshade(imagery, hillshade, strength=0.22):
    out = imagery.copy()
    dest = out.load()
    src = imagery.load()
    hill = hillshade.load()
    width, height = imagery.size
    for y in range(height):
        for x in range(width):
            red, green, blue = src[x, y]
            shade = sum(hill[x, y]) / (3.0 * 255.0)
            factor = 1.0 - strength + strength * shade
            dest[x, y] = (
                min(255, int(red * factor)),
                min(255, int(green * factor)),
                min(255, int(blue * factor)),
            )
    return out


def overlay_labels(base, labels):
    return Image.alpha_composite(base.convert("RGBA"), labels).convert("RGB")


def to_rgb565(image):
    pixels = image.load()
    width, height = image.size
    out = bytearray(width * height * 2)
    offset = 0
    for y in range(height):
        for x in range(width):
            red, green, blue = pixels[x, y]
            value = ((red & 0xF8) << 8) | ((green & 0xFC) << 3) | (blue >> 3)
            struct.pack_into("<H", out, offset, value)
            offset += 2
    return bytes(out)


def render_view(lat, lon, width, height, zoom, cache, style, origin=None):
    """The finished picture: imagery under hillshade, contours, and labels."""
    dark = style == "dark"
    if dark:
        image = composite(lat, lon, width, height, zoom, cache, "dark", origin=origin)
    else:
        imagery = composite(lat, lon, width, height, zoom, cache, "imagery", origin=origin)
        hillshade = composite(lat, lon, width, height, zoom, cache, "hillshade", origin=origin)
        image = punch_imagery(blend_hillshade(imagery, hillshade))
    # Terrarium elevation stops at z15, so deeper views upsample it.
    elev_zoom = zoom if zoom <= 15 else 15
    if elev_zoom == zoom:
        terrain = composite(lat, lon, width, height, zoom, cache, "terrarium", origin=origin)
    else:
        factor = 2 ** (zoom - elev_zoom)
        src_w = max(1, int(round(width / float(factor))))
        src_h = max(1, int(round(height / float(factor))))
        low = None
        if origin is not None:
            low = (int(math.floor(origin[0] / float(factor))),
                   int(math.floor(origin[1] / float(factor))))
        terrain = composite(
            lat, lon, src_w, src_h, elev_zoom, cache, "terrarium", origin=low
        ).resize((width, height), Image.BILINEAR)
    draw_contours(image, terrarium_elevation(terrain), contour_interval(zoom), dark)
    if not dark:
        labels = composite(
            lat, lon, width, height, zoom, cache, "labels", "RGBA", origin=origin
        )
        image = overlay_labels(image, labels)
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, default=320)
    parser.add_argument("--height", type=int, default=204)
    parser.add_argument("--zoom", type=int, default=15)
    parser.add_argument("--style", choices=("satellite", "dark"), default="satellite")
    parser.add_argument("--preview", default="")
    parser.add_argument(
        "--cache",
        default=os.path.join(os.path.expanduser("~"), ".cache", "lilyshark-tiles"),
    )
    parser.epilog = (
        "The T-Deck has no Wi-Fi tile fetch. Copy rgb565 files to the microSD "
        "as /maps/{sat|dark}_LAT_LON_zZ.rgb565 (lat/lon rounded to 3 decimals) "
        "to show real imagery on device. Without that file the firmware paints "
        "a georeferenced field chart instead of a black radar plot."
    )
    args = parser.parse_args()
    image = render_view(
        args.lat, args.lon, args.width, args.height, args.zoom, args.cache, args.style
    )
    payload = to_rgb565(image)
    parent = os.path.dirname(os.path.abspath(args.out))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(args.out, "wb") as handle:
        handle.write(payload)
    if args.preview:
        image.save(args.preview)
    print("wrote %s (%d bytes)" % (args.out, len(payload)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
