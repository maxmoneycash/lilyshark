// Weak defaults for baked field imagery.
//
// scripts/embed_map_tiles.py turns assets/maps/*.rgb565 into
// src/assets/map_tiles_baked.cpp, which is ~8 MB of generated source and is
// deliberately not committed. These weak definitions let the firmware build
// and run without it — the map simply falls back to the drawn field chart.
// When the generated file is present its strong definitions win.
//
//   python3 scripts/embed_map_tiles.py --lat <cell-lat> --lon <cell-lon> \
//       --out src/assets/map_tiles_baked.cpp
//
// Coordinates are the tile cell: latitude and longitude rounded to 3 decimals.

#if defined(LILYSHARK_DEVICE)

#include <cstddef>
#include <cstdint>

namespace lilyshark {

__attribute__((weak)) const std::uint16_t *bakedMapTile(const char *, double, double,
                                                        int) noexcept
{
    return nullptr;
}

/// Deepest baked zoom at or below the one asked for, or 0 when nothing is
/// baked. Added to the generator after the first version of this file, which
/// is why the device build linked here and failed on a clean checkout: the
/// generated source is gitignored, so only a tree that had already run
/// embed_map_tiles.py could resolve it.
__attribute__((weak)) int bakedMapTileZoomAtOrBelow(const char *, double, double,
                                                    int) noexcept
{
    return 0;
}

__attribute__((weak)) double bakedMapTileLat() noexcept { return 0.0; }
__attribute__((weak)) double bakedMapTileLon() noexcept { return 0.0; }
__attribute__((weak)) bool hasBakedMapTiles() noexcept { return false; }

} // namespace lilyshark

#endif // LILYSHARK_DEVICE
