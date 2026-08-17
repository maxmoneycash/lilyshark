#pragma once

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// MeshCore on-air frames need an Ed25519 node identity. The SX1262 transmit
/// path is shared with Meshtastic; this encoder is the next join target.
inline constexpr bool kMeshCoreTransmitReady = false;

inline std::size_t encodeMeshCoreText(const char *, std::uint8_t *, std::size_t) noexcept
{
    return 0;
}

} // namespace lilyshark
