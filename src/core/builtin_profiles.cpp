#include "lilyshark/core/builtin_profiles.h"

namespace lilyshark {
namespace {

RadioProfile makeProfile(std::uint16_t id, const char *name, ProtocolId protocol,
                         std::uint32_t frequency_hz, std::uint32_t bandwidth_hz,
                         std::uint8_t spreading_factor, std::uint8_t coding_rate,
                         std::uint16_t sync_word, std::uint16_t preamble) noexcept
{
    RadioProfile profile{};
    profile.id = id;
    profile.setName(name);
    profile.protocol_hint = protocol;
    profile.modulation = Modulation::LoRa;
    profile.center_frequency_hz = frequency_hz;
    profile.bandwidth_hz = bandwidth_hz;
    profile.spreading_factor = spreading_factor;
    profile.coding_rate_denominator = coding_rate;
    profile.sync_word = sync_word;
    profile.preamble_symbols = preamble;
    profile.tx_power_dbm = 10;
    profile.crc_enabled = true;
    profile.implicit_header = false;
    profile.inverted_iq = false;
    return profile;
}

const RadioProfile profiles[] = {
    // US LongFast center frequency follows Meshtastic's DJB2 slot selection:
    // 902 + 0.125 + (19 * 0.250) = 906.875 MHz.
    makeProfile(1, "MESHTASTIC US LF", ProtocolId::Meshtastic, 906875000U, 250000U, 11, 5, 0x2b, 16),
    // MeshCore's current USA/Canada recommendation.
    makeProfile(2, "MESHCORE US", ProtocolId::MeshCore, 910525000U, 62500U, 7, 5, 0x1424, 32),
    // Widely deployed legacy/example MeshCore profile.
    makeProfile(3, "MESHCORE LEGACY", ProtocolId::MeshCore, 915000000U, 250000U, 10, 5, 0x1424, 16),
    // Official RNode documentation example, intentionally labeled as an
    // example because Reticulum/RNode PHY settings are user-defined.
    makeProfile(4, "RNODE EXAMPLE EU", ProtocolId::Reticulum, 867200000U, 125000U, 8, 5, 0x1424, 18),
    // A US-band starting point for deployment-defined RNode settings. This is
    // not a universal Reticulum channel; tune it to the peer interface.
    makeProfile(5, "RNODE EXAMPLE US", ProtocolId::Reticulum, 915000000U, 125000U, 8, 5, 0x1424, 18),
};

} // namespace

const RadioProfile *builtinProfiles() noexcept
{
    return profiles;
}

std::size_t builtinProfileCount() noexcept
{
    return sizeof(profiles) / sizeof(profiles[0]);
}

const RadioProfile *findBuiltinProfile(std::uint16_t id) noexcept
{
    for (std::size_t index = 0; index < builtinProfileCount(); ++index) {
        if (profiles[index].id == id) {
            return &profiles[index];
        }
    }
    return nullptr;
}

} // namespace lilyshark
