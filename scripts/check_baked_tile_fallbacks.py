#!/usr/bin/env python3
"""Every symbol embed_map_tiles.py emits must have a weak fallback.

src/assets/map_tiles_baked.cpp is generated and gitignored, so a clean checkout
links against the weak defaults in map_tiles_fallback.cpp instead. A function
added to the generator but not to the fallback therefore builds on the machine
that ran the generator and fails to link everywhere else -- which is exactly
how bakedMapTileZoomAtOrBelow reached CI.
"""
from __future__ import print_function

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = ROOT / "scripts" / "embed_map_tiles.py"
FALLBACK = ROOT / "src" / "assets" / "map_tiles_fallback.cpp"

# The generator writes its C++ as string literals; find the definitions it emits.
DEFINITION = re.compile(
    r"(?:const\s+std::uint16_t\s*\*|int|double|bool)\s+(bakedMapTile\w*|hasBakedMapTiles)\s*\("
)


def main():
    if not GENERATOR.exists() or not FALLBACK.exists():
        print("check_baked_tile_fallbacks: generator or fallback missing", file=sys.stderr)
        return 1
    emitted = set(DEFINITION.findall(GENERATOR.read_text()))
    if not emitted:
        print("check_baked_tile_fallbacks: found no emitted symbols to check", file=sys.stderr)
        return 1
    fallback = FALLBACK.read_text()
    missing = sorted(name for name in emitted if f"{name}(" not in fallback)
    if missing:
        print("Baked-tile symbols with no weak fallback:", file=sys.stderr)
        for name in missing:
            print(f"  {name}", file=sys.stderr)
        print(
            "\nAdd a weak definition to src/assets/map_tiles_fallback.cpp, or the\n"
            "firmware will not link without the generated (gitignored) tile file.",
            file=sys.stderr,
        )
        return 1
    print(f"baked tile fallbacks: {len(emitted)} symbols, all covered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
