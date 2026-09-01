#pragma once

#include "lilyshark/core/protocol.h"
#include "lilyshark/core/raw_frame.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

enum class FrequencyTuningPolicy : std::uint8_t {
    // MeshCore and Reticulum centers are deployment-defined values.
    DeploymentDefined = 0,
    // Meshtastic derives the slot from its primary-channel name hash.
    DefaultHashed,
    // A user frequency step selects and then preserves a numeric slot.
    ExplicitSlot,
};

/// Which regional band plan a profile is tuned inside.
///
/// A band plan is a regulatory choice, not something a centre frequency can be
/// reverse-engineered into: 916 MHz is legal under US915 and under AU915, and
/// the two bands have different edges, so the profile has to say which one it
/// means. `Unspecified` keeps the pre-region behaviour — the band is inferred
/// from the protocol and the centre frequency — and is what version 1 and
/// version 2 saved profiles decode to.
///
/// The band edges themselves, with a citation each, live in
/// `regionBandLimits()` in profile_tuning.cpp.
enum class RegionCode : std::uint8_t {
    Unspecified = 0,
    US915,
    EU868,
    EU863,
    AU915,
    AS923,
    IN865,
    KR920,
    Count,
};

struct RadioProfile {
    static constexpr std::size_t kNameCapacity = 24;

    std::uint16_t id = 0;
    char name[kNameCapacity]{};
    ProtocolId protocol_hint = ProtocolId::Unknown;
    Modulation modulation = Modulation::LoRa;
    std::uint32_t center_frequency_hz = 0;
    std::uint32_t bandwidth_hz = 0;
    FrequencyTuningPolicy frequency_tuning_policy = FrequencyTuningPolicy::DeploymentDefined;
    RegionCode region = RegionCode::Unspecified;
    std::uint16_t frequency_slot = 0;
    std::uint32_t bit_rate_bps = 0;
    std::uint32_t frequency_deviation_hz = 0;
    std::uint16_t preamble_symbols = 0;
    /// SX1262 sync word. Values at or below 0xff are the one-byte logical form
    /// RadioLib takes; larger values are the raw two-byte register pair
    /// (0x1424 private, 0x3444 public LoRaWAN). See `isSupportedSyncWord()`.
    std::uint16_t sync_word = 0;
    std::uint8_t spreading_factor = 0;
    std::uint8_t coding_rate_denominator = 0;
    std::int8_t tx_power_dbm = 0;
    bool crc_enabled = true;
    bool implicit_header = false;
    bool inverted_iq = false;
    /// True once an operator has typed a preamble length by hand. While it is
    /// false the preamble tracks `derivePreambleSymbols()` and is recomputed
    /// whenever bandwidth or spreading factor changes; while it is true the
    /// typed value survives those changes untouched.
    bool preamble_override = false;

    void setName(const char *value) noexcept
    {
        std::size_t index = 0;
        if (value != nullptr) {
            while (index + 1 < kNameCapacity && value[index] != '\0') {
                name[index] = value[index];
                ++index;
            }
        }
        name[index] = '\0';
    }
};

} // namespace lilyshark
