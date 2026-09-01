#include "lilyshark/core/builtin_profiles.h"
#include "lilyshark/core/profile_tuning.h"

namespace lilyshark {
namespace {

RadioProfile makeProfile(std::uint16_t id, const char *name, ProtocolId protocol,
                         RegionCode region, std::uint32_t frequency_hz,
                         std::uint32_t bandwidth_hz, std::uint8_t spreading_factor,
                         std::uint8_t coding_rate, std::uint16_t sync_word) noexcept
{
    RadioProfile profile{};
    profile.id = id;
    profile.setName(name);
    profile.protocol_hint = protocol;
    profile.region = region;
    profile.modulation = Modulation::LoRa;
    profile.center_frequency_hz = frequency_hz;
    profile.bandwidth_hz = bandwidth_hz;
    profile.spreading_factor = spreading_factor;
    profile.coding_rate_denominator = coding_rate;
    profile.sync_word = sync_word;
    if (protocol == ProtocolId::Meshtastic) {
        profile.frequency_tuning_policy = FrequencyTuningPolicy::DefaultHashed;
    }
    profile.preamble_symbols = derivePreambleSymbols(profile);
    profile.tx_power_dbm = 10;
    profile.crc_enabled = true;
    profile.implicit_header = false;
    profile.inverted_iq = false;
    return profile;
}

/// A regional Meshtastic preset pinned to an explicit occupied-band slot.
///
/// Meshtastic picks its default slot by hashing the primary channel name
/// modulo the number of slots the region holds, so the answer differs per band
/// plan and per channel name. This firmware only knows the US hash, so a
/// regional preset names its slot outright instead of implying a default it
/// cannot compute. Slot 0 is the lowest legal centre in the band — a defined,
/// in-band starting point the operator steps away from with +/-, not a claim
/// about where a particular mesh is listening.
RadioProfile makeRegionalMeshtasticProfile(std::uint16_t id, const char *name,
                                           RegionCode region,
                                           std::uint32_t bandwidth_hz,
                                           std::uint8_t spreading_factor,
                                           std::uint16_t slot) noexcept
{
    std::uint32_t lower_hz = 0;
    std::uint32_t upper_hz = 0;
    if (!regionBandLimits(region, lower_hz, upper_hz)) {
        return RadioProfile{};
    }
    const std::uint32_t center_hz = lower_hz + ((bandwidth_hz + 1U) / 2U) +
                                    (static_cast<std::uint32_t>(slot) * bandwidth_hz);
    RadioProfile profile = makeProfile(id, name, ProtocolId::Meshtastic, region, center_hz,
                                       bandwidth_hz, spreading_factor, 5U, 0x2b);
    profile.frequency_tuning_policy = FrequencyTuningPolicy::ExplicitSlot;
    profile.frequency_slot = slot;
    return profile;
}

const RadioProfile profiles[] = {
    // US LongFast center frequency follows Meshtastic's DJB2 slot selection:
    // 902 + 0.125 + (19 * 0.250) = 906.875 MHz.
    makeProfile(1, "MESHTASTIC US LF", ProtocolId::Meshtastic, RegionCode::US915,
                906875000U, 250000U, 11, 5, 0x2b),
    // MeshCore's current USA/Canada recommendation.
    makeProfile(2, "MESHCORE US", ProtocolId::MeshCore, RegionCode::US915,
                910525000U, 62500U, 7, 5, 0x1424),
    // Widely deployed legacy/example MeshCore profile.
    makeProfile(3, "MESHCORE LEGACY", ProtocolId::MeshCore, RegionCode::US915,
                915000000U, 250000U, 10, 5, 0x1424),
    // Official RNode documentation example, intentionally labeled as an
    // example because Reticulum/RNode PHY settings are user-defined.
    makeProfile(4, "RNODE EXAMPLE EU", ProtocolId::Reticulum, RegionCode::EU863,
                867200000U, 125000U, 8, 5, 0x1424),
    // A US-band starting point for deployment-defined RNode settings. This is
    // not a universal Reticulum channel; tune it to the peer interface.
    makeProfile(5, "RNODE EXAMPLE US", ProtocolId::Reticulum, RegionCode::US915,
                915000000U, 125000U, 8, 5, 0x1424),

    // Regional Meshtastic presets. Every band edge is cited in the
    // kRegionalBands table in profile_tuning.cpp; the modulation is the
    // LongFast shape (SF11 / 250 kHz / CR 4:5) that Meshtastic ships as its
    // default preset, except where the band is too narrow to hold it.
    //
    // EU868 is 250 kHz wide end to end, so it holds exactly one 250 kHz slot.
    // Slot 0 is 869.525 MHz — the same centre Meshtastic's EU_868 LongFast
    // lands on, and one of the three channel centres ETSI EN 300 220-2 names
    // for the 869.4-869.65 MHz sub-band.
    makeRegionalMeshtasticProfile(6, "MESHTASTIC EU868", RegionCode::EU868,
                                  250000U, 11U, 0U),
    // AU915 (ANZ) is 915-928 MHz: 52 slots at 250 kHz. Slot 0 is 915.125 MHz.
    makeRegionalMeshtasticProfile(7, "MESHTASTIC AU915", RegionCode::AU915,
                                  250000U, 11U, 0U),
    // AS923 as used here is 920-925 MHz: 20 slots at 250 kHz. Slot 0 is
    // 920.125 MHz.
    makeRegionalMeshtasticProfile(8, "MESHTASTIC AS923", RegionCode::AS923,
                                  250000U, 11U, 0U),
    // IN865 is 865-867 MHz: 8 slots at 250 kHz. Slot 0 is 865.125 MHz.
    makeRegionalMeshtasticProfile(9, "MESHTASTIC IN865", RegionCode::IN865,
                                  250000U, 11U, 0U),
    // KR920 is 920-923 MHz: 12 slots at 250 kHz. Slot 0 is 920.125 MHz. It
    // shares its lower edge with AS923 and not its upper one, which is why the
    // two presets carry different band plans rather than one shared centre.
    makeRegionalMeshtasticProfile(10, "MESHTASTIC KR920", RegionCode::KR920,
                                  250000U, 11U, 0U),
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
