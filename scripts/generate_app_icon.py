#!/usr/bin/env python3
"""Render the Lilyshark iOS app icon: the black wordmark on brand pink.

The icon is generated rather than drawn by hand so it cannot drift from the
wordmark the web app and the deck already use. There is one logo in this
project; an icon traced separately would be a second one that only looks the
same until somebody edits either.

iOS 26 composites its own Liquid Glass treatment -- the specular highlight,
the rim, the parallax on the home screen -- over the artwork an app supplies,
and it does that from a flat, full-bleed square. So this deliberately does NOT
bake in a highlight or a rounded corner: drawing our own gloss would be a
second, static reflection sitting under the real one, and pre-rounding the
corners leaves pale fringes where iOS masks again. Full bleed, no alpha, no
gloss.

Usage:
  scripts/generate_app_icon.py            # write the icon set
  scripts/generate_app_icon.py --check    # verify the committed icons match
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WORDMARK = REPO_ROOT / "assets/brand/lilyshark-wordmark-black.svg"

# The brand pink, the same value the wordmark uses in its pink variant and the
# web app uses for fills. Named here rather than repeated as a literal.
BRAND_PINK = "#FF4F9D"

# Where the icon has to land. Every target that shows an icon gets the same
# artwork; a widget whose icon differs from its app reads as a different app.
ICON_SETS = [
    REPO_ROOT / "ios/Shared/Assets.xcassets/AppIcon.appiconset",
    REPO_ROOT / "ios/PommeCore Widgets/Assets.xcassets/AppIcon.appiconset",
    REPO_ROOT / "ios/PommeCore Watch Complications/Assets.xcassets/AppIcon.appiconset",
]

# 1024 is the only size iOS still requires; macOS wants the older ladder, and
# those files already exist in the set, so all of them are rewritten.
SIZES = [1024, 512, 256, 128, 64, 32, 16]

# How much of the square the mark's INK occupies edge to edge, after the SVG's
# surrounding whitespace is trimmed away. iOS masks the corners and crops
# further under parallax, so this leaves a margin the mark can afford to lose.
MARK_FRACTION = 0.74


def fail(message: str) -> None:
    raise SystemExit(f"generate_app_icon: {message}")


def render_mark(width: int) -> bytes:
    """The wordmark alone, black on transparent, at `width` pixels."""
    if not WORDMARK.exists():
        fail(f"missing {WORDMARK}")
    try:
        result = subprocess.run(
            ["rsvg-convert", "--width", str(width), "--format", "png", str(WORDMARK)],
            check=True,
            capture_output=True,
        )
    except FileNotFoundError:
        fail("rsvg-convert is required (brew install librsvg)")
    except subprocess.CalledProcessError as error:
        fail(f"rsvg-convert failed: {error.stderr.decode('utf-8', 'replace')}")
    return result.stdout


def build_icon(size: int) -> bytes:
    from io import BytesIO

    from PIL import Image

    # Render generously, then trim to the ink. The wordmark's viewBox carries
    # whitespace around the glyphs, so scaling and centring the BOX leaves the
    # mark small and sitting high in the square -- the box is centred and the
    # ink is not. Trimming first makes both the size and the centre honest.
    mark = Image.open(BytesIO(render_mark(size * 2))).convert("RGBA")
    ink = mark.getbbox()
    if ink is not None:
        mark = mark.crop(ink)
    target_width = int(size * MARK_FRACTION)
    scale = target_width / mark.width
    mark = mark.resize(
        (target_width, max(1, int(mark.height * scale))), Image.LANCZOS
    )

    # Flat, opaque, full bleed. No rounding and no gloss -- see the module
    # docstring; iOS supplies both and doubling them looks wrong.
    canvas = Image.new("RGB", (size, size), BRAND_PINK)
    # Centred on the ink, which the trim above made possible.
    left = (size - mark.width) // 2
    top = (size - mark.height) // 2
    canvas.paste(mark, (left, top), mark)

    out = BytesIO()
    canvas.save(out, format="PNG", optimize=True)
    return out.getvalue()


def icon_filename(size: int) -> str:
    return "AppIcon.png" if size == 1024 else f"AppIcon-{size}.png"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the committed icons match what this would generate",
    )
    args = parser.parse_args()

    rendered = {size: build_icon(size) for size in SIZES}

    mismatched: list[str] = []
    for icon_set in ICON_SETS:
        if not icon_set.exists():
            fail(f"missing icon set {icon_set}")
        for size, data in rendered.items():
            target = icon_set / icon_filename(size)
            if args.check:
                if not target.exists():
                    mismatched.append(f"{target} is missing")
                elif hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(
                    data
                ).digest():
                    mismatched.append(f"{target} differs from the wordmark")
            else:
                target.write_bytes(data)

    if args.check:
        if mismatched:
            print("The app icon does not match the brand wordmark:", file=sys.stderr)
            for line in mismatched:
                print(f"  {line}", file=sys.stderr)
            print("\nRun scripts/generate_app_icon.py to regenerate.", file=sys.stderr)
            return 1
        print(f"App icons match the wordmark ({len(ICON_SETS)} sets)")
        return 0

    print(f"Wrote {len(SIZES)} sizes to {len(ICON_SETS)} icon sets")
    print(f"  mark: {WORDMARK.relative_to(REPO_ROOT)} on {BRAND_PINK}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
