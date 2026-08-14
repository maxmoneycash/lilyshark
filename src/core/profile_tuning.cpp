#include "lilyshark/core/profile_tuning.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace {

struct FrequencyBand {
    std::uint32_t lower_hz;
    std::uint32_t upper_hz;
};

struct FrequencyGrid {
    std::uint64_t first_center_hz;
    std::uint64_t step_hz;
    std::uint64_t slot_count;
};

constexpr FrequencyBand kUs902Band{902000000U, 928000000U};
constexpr FrequencyBand kEu863Band{863000000U, 870000000U};

bool tuningBand(const RadioProfile &profile, FrequencyBand &band) noexcept
{
    if (profile.modulation != Modulation::LoRa) {
        return false;
    }

    const std::uint32_t frequency = profile.center_frequency_hz;
    if ((profile.protocol_hint == ProtocolId::Meshtastic ||
         profile.protocol_hint == ProtocolId::MeshCore) &&
        frequency >= kUs902Band.lower_hz && frequency <= kUs902Band.upper_hz) {
        band = kUs902Band;
        return true;
    }

    if (profile.protocol_hint == ProtocolId::Reticulum) {
        if (frequency >= kEu863Band.lower_hz && frequency <= kEu863Band.upper_hz) {
            band = kEu863Band;
            return true;
        }
        if (frequency >= kUs902Band.lower_hz && frequency <= kUs902Band.upper_hz) {
            band = kUs902Band;
            return true;
        }
    }

    return false;
}

template <typename Value, std::size_t Count>
Value nextValue(Value current, const Value (&values)[Count]) noexcept
{
    for (std::size_t index = 0; index < Count; ++index) {
        if (values[index] == current) {
            return values[(index + 1U) % Count];
        }
    }
    return values[0];
}

bool isLoRa(const RadioProfile &profile) noexcept
{
    return profile.modulation == Modulation::LoRa;
}

bool occupiedBandGrid(FrequencyBand band, std::uint32_t bandwidth_hz,
                      FrequencyGrid &grid) noexcept
{
    if (bandwidth_hz == 0U) {
        return false;
    }

    const std::uint64_t bandwidth = bandwidth_hz;
    const std::uint64_t band_width =
        static_cast<std::uint64_t>(band.upper_hz) - band.lower_hz;
    const std::uint64_t slot_count = band_width / bandwidth;
    if (slot_count == 0U) {
        return false;
    }

    grid.first_center_hz = static_cast<std::uint64_t>(band.lower_hz) +
                           ((bandwidth + 1U) / 2U);
    grid.step_hz = bandwidth;
    grid.slot_count = slot_count;
    return true;
}

std::uint64_t gridCenter(const FrequencyGrid &grid, std::uint64_t slot) noexcept
{
    return grid.first_center_hz + (slot * grid.step_hz);
}

bool exactGridSlot(const FrequencyGrid &grid, std::uint64_t center_hz,
                   std::uint64_t &slot) noexcept
{
    if (center_hz < grid.first_center_hz) {
        return false;
    }
    const std::uint64_t offset = center_hz - grid.first_center_hz;
    if (offset % grid.step_hz != 0U) {
        return false;
    }
    slot = offset / grid.step_hz;
    return slot < grid.slot_count;
}

bool defaultHashedSlot(std::uint32_t bandwidth_hz, std::uint64_t &slot) noexcept
{
    // DJB2("LongFast") modulo the number of occupied US slots.
    switch (bandwidth_hz) {
    case 62500U:
        slot = 227U;
        return true;
    case 125000U:
    case 250000U:
    case 500000U:
        slot = 19U;
        return true;
    default:
        return false;
    }
}

bool configuredMeshtasticSlot(const RadioProfile &profile, const FrequencyGrid &grid,
                              std::uint64_t &slot) noexcept
{
    if (profile.frequency_tuning_policy == FrequencyTuningPolicy::DefaultHashed) {
        return profile.frequency_slot == 0U && defaultHashedSlot(profile.bandwidth_hz, slot) &&
               slot < grid.slot_count;
    }
    if (profile.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot) {
        slot = profile.frequency_slot;
        return slot < grid.slot_count;
    }
    return false;
}

RadioProfile stepMeshtasticFrequency(const RadioProfile &profile, FrequencyBand band,
                                     int direction) noexcept
{
    RadioProfile tuned = profile;
    FrequencyGrid grid{};
    if (!occupiedBandGrid(band, profile.bandwidth_hz, grid)) {
        return tuned;
    }

    std::uint64_t slot = 0;
    if (!configuredMeshtasticSlot(profile, grid, slot)) {
        return tuned;
    }

    slot = direction > 0
               ? (slot + 1U) % grid.slot_count
               : (slot + grid.slot_count - 1U) % grid.slot_count;
    tuned.frequency_tuning_policy = FrequencyTuningPolicy::ExplicitSlot;
    tuned.frequency_slot = static_cast<std::uint16_t>(slot);
    tuned.center_frequency_hz = static_cast<std::uint32_t>(gridCenter(grid, slot));
    return tuned;
}

template <typename Value, std::size_t Count>
bool contains(Value value, const Value (&values)[Count]) noexcept
{
    for (const Value candidate : values) {
        if (candidate == value) {
            return true;
        }
    }
    return false;
}

} // namespace

RadioProfile stepProfileFrequency(const RadioProfile &profile, int direction) noexcept
{
    RadioProfile tuned = profile;
    if (direction == 0 || profile.bandwidth_hz == 0) {
        return tuned;
    }

    FrequencyBand band{};
    if (!tuningBand(profile, band)) {
        return tuned;
    }

    if (profile.protocol_hint == ProtocolId::Meshtastic) {
        return stepMeshtasticFrequency(profile, band, direction);
    }

    const std::uint64_t bandwidth = profile.bandwidth_hz;
    const std::uint64_t band_width =
        static_cast<std::uint64_t>(band.upper_hz) - band.lower_hz;
    if (bandwidth > band_width) {
        return tuned;
    }

    // Keep the complete occupied bandwidth inside the regional band. The
    // ceiling makes this conservative for an odd bandwidth value.
    const std::uint64_t half_bandwidth = (bandwidth + 1U) / 2U;
    const std::uint64_t minimum =
        static_cast<std::uint64_t>(band.lower_hz) + half_bandwidth;
    const std::uint64_t maximum =
        static_cast<std::uint64_t>(band.upper_hz) - half_bandwidth;
    if (minimum > maximum) {
        return tuned;
    }

    const std::uint64_t current = profile.center_frequency_hz;
    if (current < minimum || current > maximum) {
        tuned.center_frequency_hz = static_cast<std::uint32_t>(
            direction > 0 ? minimum : maximum);
        return tuned;
    }

    if (direction > 0) {
        tuned.center_frequency_hz = static_cast<std::uint32_t>(
            bandwidth > maximum - current ? minimum : current + bandwidth);
    } else {
        tuned.center_frequency_hz = static_cast<std::uint32_t>(
            bandwidth > current - minimum ? maximum : current - bandwidth);
    }
    return tuned;
}

RadioProfile cycleProfileBandwidth(const RadioProfile &profile) noexcept
{
    if (!isLoRa(profile)) {
        return profile;
    }

    constexpr std::uint32_t values[] = {62500U, 125000U, 250000U, 500000U};
    RadioProfile tuned = profile;
    tuned.bandwidth_hz = nextValue(profile.bandwidth_hz, values);

    if (profile.protocol_hint == ProtocolId::Meshtastic) {
        FrequencyBand band{};
        FrequencyGrid new_grid{};
        if (!tuningBand(profile, band) ||
            !occupiedBandGrid(band, tuned.bandwidth_hz, new_grid)) {
            tuned.preamble_symbols = derivePreambleSymbols(tuned);
            return tuned;
        }

        std::uint64_t slot = 0;
        if (profile.frequency_tuning_policy == FrequencyTuningPolicy::DefaultHashed) {
            if (!defaultHashedSlot(tuned.bandwidth_hz, slot)) {
                tuned.preamble_symbols = derivePreambleSymbols(tuned);
                return tuned;
            }
            tuned.frequency_slot = 0U;
        } else if (profile.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot) {
            slot = static_cast<std::uint64_t>(profile.frequency_slot) % new_grid.slot_count;
            tuned.frequency_slot = static_cast<std::uint16_t>(slot);
        } else {
            tuned.preamble_symbols = derivePreambleSymbols(tuned);
            return tuned;
        }
        tuned.center_frequency_hz = static_cast<std::uint32_t>(
            gridCenter(new_grid, slot));
    }
    tuned.preamble_symbols = derivePreambleSymbols(tuned);
    return tuned;
}

RadioProfile cycleProfileSpreadingFactor(const RadioProfile &profile) noexcept
{
    if (!isLoRa(profile)) {
        return profile;
    }

    constexpr std::uint8_t values[] = {7U, 8U, 9U, 10U, 11U, 12U};
    RadioProfile tuned = profile;
    tuned.spreading_factor = nextValue(profile.spreading_factor, values);
    tuned.preamble_symbols = derivePreambleSymbols(tuned);
    return tuned;
}

RadioProfile cycleProfileCodingRate(const RadioProfile &profile) noexcept
{
    if (!isLoRa(profile)) {
        return profile;
    }

    constexpr std::uint8_t values[] = {5U, 6U, 7U, 8U};
    RadioProfile tuned = profile;
    tuned.coding_rate_denominator = nextValue(profile.coding_rate_denominator, values);
    return tuned;
}

std::uint16_t derivePreambleSymbols(const RadioProfile &profile) noexcept
{
    if (profile.protocol_hint == ProtocolId::Meshtastic) {
        return 16U;
    }
    if (profile.protocol_hint == ProtocolId::MeshCore) {
        return profile.spreading_factor == 7U || profile.spreading_factor == 8U ? 32U : 16U;
    }
    if (profile.protocol_hint != ProtocolId::Reticulum ||
        profile.spreading_factor < 7U || profile.spreading_factor > 12U) {
        return profile.preamble_symbols;
    }

    constexpr std::uint32_t bandwidths[] = {62500U, 125000U, 250000U, 500000U};
    constexpr std::uint16_t preambles[][6] = {
        {18U, 18U, 18U, 18U, 18U, 18U},
        {24U, 18U, 18U, 18U, 18U, 18U},
        {47U, 24U, 18U, 18U, 18U, 18U},
        {94U, 47U, 24U, 18U, 18U, 18U},
    };
    for (std::size_t index = 0; index < 4U; ++index) {
        if (profile.bandwidth_hz == bandwidths[index]) {
            return preambles[index][profile.spreading_factor - 7U];
        }
    }
    return profile.preamble_symbols;
}

bool inferLegacyFrequencyTuningPolicy(RadioProfile &profile) noexcept
{
    profile.frequency_tuning_policy = FrequencyTuningPolicy::DeploymentDefined;
    profile.frequency_slot = 0U;
    if (profile.protocol_hint == ProtocolId::MeshCore ||
        profile.protocol_hint == ProtocolId::Reticulum) {
        return true;
    }
    if (profile.protocol_hint != ProtocolId::Meshtastic) {
        return false;
    }

    FrequencyBand band{};
    FrequencyGrid grid{};
    std::uint64_t slot = 0;
    if (!tuningBand(profile, band) ||
        !occupiedBandGrid(band, profile.bandwidth_hz, grid) ||
        !exactGridSlot(grid, profile.center_frequency_hz, slot)) {
        return false;
    }

    std::uint64_t hashed_slot = 0;
    if (defaultHashedSlot(profile.bandwidth_hz, hashed_slot) && slot == hashed_slot) {
        profile.frequency_tuning_policy = FrequencyTuningPolicy::DefaultHashed;
        return true;
    }
    if (slot > 0xffffU) {
        return false;
    }

    profile.frequency_tuning_policy = FrequencyTuningPolicy::ExplicitSlot;
    profile.frequency_slot = static_cast<std::uint16_t>(slot);
    return true;
}

bool isSupportedTunedProfile(const RadioProfile &profile) noexcept
{
    constexpr std::uint32_t bandwidths[] = {62500U, 125000U, 250000U, 500000U};
    constexpr std::uint8_t spreading_factors[] = {7U, 8U, 9U, 10U, 11U, 12U};
    constexpr std::uint8_t coding_rates[] = {5U, 6U, 7U, 8U};
    if (!contains(profile.bandwidth_hz, bandwidths) ||
        !contains(profile.spreading_factor, spreading_factors) ||
        !contains(profile.coding_rate_denominator, coding_rates)) {
        return false;
    }
    if (profile.preamble_symbols != derivePreambleSymbols(profile)) {
        return false;
    }

    FrequencyBand band{};
    if (!tuningBand(profile, band)) {
        return false;
    }

    if (profile.protocol_hint == ProtocolId::Meshtastic) {
        FrequencyGrid grid{};
        std::uint64_t slot = 0;
        return occupiedBandGrid(band, profile.bandwidth_hz, grid) &&
               configuredMeshtasticSlot(profile, grid, slot) &&
               profile.center_frequency_hz == gridCenter(grid, slot);
    }
    if (profile.frequency_tuning_policy != FrequencyTuningPolicy::DeploymentDefined ||
        profile.frequency_slot != 0U) {
        return false;
    }
    const std::uint64_t half_bandwidth =
        (static_cast<std::uint64_t>(profile.bandwidth_hz) + 1U) / 2U;
    const std::uint64_t center = profile.center_frequency_hz;
    return center >= static_cast<std::uint64_t>(band.lower_hz) + half_bandwidth &&
           center <= static_cast<std::uint64_t>(band.upper_hz) - half_bandwidth;
}

} // namespace lilyshark
