#pragma once

// The one checksum every persisted preference record on this device uses.
//
// App settings, the saved radio profile, and the channel-key store all end in
// a little-endian CRC-32 over the bytes before it. Sharing the routine is the
// point: three copies of a polynomial is three chances for one of them to be
// subtly different, and a settings record that validates under one copy and
// not another is worse than no checksum at all.
//
// Standard CRC-32 (reflected, polynomial 0xedb88320, initial value
// 0xffffffff, final inversion) — the same value zlib and PNG produce.

#include <cstddef>
#include <cstdint>

namespace lilyshark {

[[nodiscard]] inline std::uint32_t settingsCrc32(const std::uint8_t *bytes,
                                                 std::size_t size) noexcept
{
    std::uint32_t crc = 0xffffffffU;
    for (std::size_t index = 0; index < size; ++index) {
        crc ^= bytes[index];
        for (std::uint8_t bit = 0; bit < 8U; ++bit) {
            const std::uint32_t mask = 0U - (crc & 1U);
            crc = (crc >> 1U) ^ (0xedb88320U & mask);
        }
    }
    return ~crc;
}

} // namespace lilyshark
