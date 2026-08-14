#include "lilyshark/core/profile_tuning.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace {

struct FrequencyBand {
    std::uint32_t lower_hz;
    std::uint32_t upper_hz;
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

    FrequencyBand band{};
    if (!tuningBand(profile, band)) {
        return false;
    }
    const std::uint64_t half_bandwidth =
        (static_cast<std::uint64_t>(profile.bandwidth_hz) + 1U) / 2U;
    const std::uint64_t center = profile.center_frequency_hz;
    return center >= static_cast<std::uint64_t>(band.lower_hz) + half_bandwidth &&
           center <= static_cast<std::uint64_t>(band.upper_hz) - half_bandwidth;
}

} // namespace lilyshark
