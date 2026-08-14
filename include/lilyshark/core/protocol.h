#pragma once

#include <cstdint>

namespace lilyshark {

enum class ProtocolId : std::uint8_t {
    Unknown = 0,
    Meshtastic,
    MeshCore,
    Reticulum,
    Custom,
};

constexpr const char *protocolName(ProtocolId protocol) noexcept
{
    switch (protocol) {
    case ProtocolId::Meshtastic:
        return "Meshtastic";
    case ProtocolId::MeshCore:
        return "MeshCore";
    case ProtocolId::Reticulum:
        return "Reticulum";
    case ProtocolId::Custom:
        return "Custom";
    case ProtocolId::Unknown:
    default:
        return "Unknown";
    }
}

} // namespace lilyshark
