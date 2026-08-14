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

struct RadioProfile {
    static constexpr std::size_t kNameCapacity = 24;

    std::uint16_t id = 0;
    char name[kNameCapacity]{};
    ProtocolId protocol_hint = ProtocolId::Unknown;
    Modulation modulation = Modulation::LoRa;
    std::uint32_t center_frequency_hz = 0;
    std::uint32_t bandwidth_hz = 0;
    FrequencyTuningPolicy frequency_tuning_policy = FrequencyTuningPolicy::DeploymentDefined;
    std::uint16_t frequency_slot = 0;
    std::uint32_t bit_rate_bps = 0;
    std::uint32_t frequency_deviation_hz = 0;
    std::uint16_t preamble_symbols = 0;
    std::uint16_t sync_word = 0;
    std::uint8_t spreading_factor = 0;
    std::uint8_t coding_rate_denominator = 0;
    std::int8_t tx_power_dbm = 0;
    bool crc_enabled = true;
    bool implicit_header = false;
    bool inverted_iq = false;

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
