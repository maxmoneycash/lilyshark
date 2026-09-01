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

struct RegionalBand {
    RegionCode region;
    const char *label;
    FrequencyBand band;
};

// Regional band plans. Each entry cites the band plan it encodes; the analyzer
// is only as trustworthy as the numbers it tunes to, and an uncited edge is a
// number nobody can check.
//
// The Meshtastic figures come from meshtastic/firmware `regions[]` in
// src/mesh/RadioInterface.cpp at commit
// 34680833b88b37bbcffca0b31dffe45f29e9d35c — the same commit this repository's
// Meshtastic header parser is verified against — and each RDEF entry there
// carries the regulatory citation reproduced below it.
constexpr RegionalBand kRegionalBands[] = {
    // US915. Meshtastic RDEF(US, 902.0, 928.0). FCC 47 CFR §15.247 digital
    // modulation band 902-928 MHz; LoRa Alliance RP002 US902-928.
    {RegionCode::US915, "US915", {902000000U, 928000000U}},
    // EU868. Meshtastic RDEF(EU_868, 869.4, 869.65). ETSI EN 300 220-2 V3.2.1
    // table B.1 item H (869.4-869.65 MHz, 500 mW e.r.p., 10 % duty cycle).
    // Only 250 kHz wide, so it holds exactly one 250 kHz LoRa slot —
    // 869.525 MHz, the centre Meshtastic's EU_868 LongFast lands on.
    {RegionCode::EU868, "EU868", {869400000U, 869650000U}},
    // EU863. The general ETSI EN 300 220-2 SRD allocation 863-870 MHz, which
    // is the span RNode/Reticulum deployments tune freely inside; it is the
    // band the existing "RNODE EXAMPLE EU" preset has always used.
    {RegionCode::EU863, "EU863", {863000000U, 870000000U}},
    // AU915. Meshtastic RDEF(ANZ, 915.0, 928.0), citing the ACMA Low
    // Interference Potential Devices class licence and the NZ IoT Alliance
    // spectrum briefing. Overlaps US915, which is exactly why the band plan
    // has to be stored on the profile rather than guessed from the centre.
    {RegionCode::AU915, "AU915", {915000000U, 928000000U}},
    // AS923. LoRa Alliance RP002-1.0.4 groups AS923 as national sub-bands
    // rather than one range, so this uses the 920.0-925.0 MHz span shared by
    // Meshtastic's RDEF(TH, 920.0, 925.0) and RDEF(TW, 920.0, 925.0) entries
    // (NBTC 1033-2565 for TH; NCC low-power RF regulations §5.8.1 for TW).
    {RegionCode::AS923, "AS923", {920000000U, 925000000U}},
    // IN865. Meshtastic RDEF(IN, 865.0, 867.0), citing LoRaWAN regional
    // parameters v1.0.3revA IN865-867; India WPC delicensed 865-867 MHz.
    {RegionCode::IN865, "IN865", {865000000U, 867000000U}},
    // KR920. Meshtastic RDEF(KR, 920.0, 923.0), citing the Korean MSIT
    // radio-equipment notice and LoRa Alliance RP002-1.0.4 KR920-923.
    {RegionCode::KR920, "KR920", {920000000U, 923000000U}},
};

bool regionalBand(RegionCode region, FrequencyBand &band) noexcept
{
    for (const RegionalBand &entry : kRegionalBands) {
        if (entry.region == region) {
            band = entry.band;
            return true;
        }
    }
    return false;
}

bool tuningBand(const RadioProfile &profile, FrequencyBand &band) noexcept
{
    if (profile.modulation != Modulation::LoRa) {
        return false;
    }

    const std::uint32_t frequency = profile.center_frequency_hz;
    if (profile.region != RegionCode::Unspecified) {
        // A declared band plan is authoritative. Nothing is inferred from the
        // centre frequency, because overlapping plans make that ambiguous.
        FrequencyBand declared{};
        if (!regionalBand(profile.region, declared)) {
            return false;
        }
        if (frequency < declared.lower_hz || frequency > declared.upper_hz) {
            return false;
        }
        band = declared;
        return true;
    }

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
        // The hashed slot table above is the US band's, and Meshtastic's slot
        // hash is region- and channel-name-dependent. Rather than pretend the
        // US answer generalises, every other band plan must name its slot.
        if (profile.region != RegionCode::Unspecified &&
            profile.region != RegionCode::US915) {
            return false;
        }
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

/// Re-derive the preamble unless an operator has typed one. This is the single
/// place bandwidth and spreading-factor changes decide whether to disturb it.
void refreshDerivedPreamble(RadioProfile &profile) noexcept
{
    if (!profile.preamble_override) {
        profile.preamble_symbols = derivePreambleSymbols(profile);
    }
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
            refreshDerivedPreamble(tuned);
            return tuned;
        }

        std::uint64_t slot = 0;
        if (profile.frequency_tuning_policy == FrequencyTuningPolicy::DefaultHashed) {
            if (!defaultHashedSlot(tuned.bandwidth_hz, slot)) {
                refreshDerivedPreamble(tuned);
                return tuned;
            }
            tuned.frequency_slot = 0U;
        } else if (profile.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot) {
            slot = static_cast<std::uint64_t>(profile.frequency_slot) % new_grid.slot_count;
            tuned.frequency_slot = static_cast<std::uint16_t>(slot);
        } else {
            refreshDerivedPreamble(tuned);
            return tuned;
        }
        tuned.center_frequency_hz = static_cast<std::uint32_t>(
            gridCenter(new_grid, slot));
    }
    refreshDerivedPreamble(tuned);
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
    refreshDerivedPreamble(tuned);
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

const char *regionLabel(RegionCode region) noexcept
{
    for (const RegionalBand &entry : kRegionalBands) {
        if (entry.region == region) {
            return entry.label;
        }
    }
    return "AUTO";
}

bool regionBandLimits(RegionCode region, std::uint32_t &lower_hz,
                      std::uint32_t &upper_hz) noexcept
{
    FrequencyBand band{};
    if (!regionalBand(region, band)) {
        return false;
    }
    lower_hz = band.lower_hz;
    upper_hz = band.upper_hz;
    return true;
}

bool isSupportedSyncWord(std::uint16_t sync_word) noexcept
{
    if (sync_word <= 0xffU) {
        return true;
    }
    // Two-byte register form. SX1262 registers 0x0740/0x0741 hold the logical
    // sync word in the upper nibble of each byte and RadioLib's control bits
    // (0x4, 0x4) in the lower nibbles, which is why the private and public
    // words read 0x1424 and 0x3444. Any other low nibble is not a value the
    // driver can round-trip, so it is refused rather than masked into shape.
    return (sync_word & 0x0f0fU) == 0x0404U;
}

bool isSupportedPreambleSymbols(const RadioProfile &profile,
                                std::uint16_t symbols) noexcept
{
    if (symbols < kMinimumPreambleSymbols || symbols > kMaximumPreambleSymbols) {
        return false;
    }
    return profile.preamble_override || symbols == derivePreambleSymbols(profile);
}

ProfileEditResult setProfileSyncWord(const RadioProfile &profile, std::uint16_t sync_word,
                                     RadioProfile &out) noexcept
{
    if (profile.modulation != Modulation::LoRa) {
        return ProfileEditResult::UnsupportedModulation;
    }
    if (!isSupportedSyncWord(sync_word)) {
        return ProfileEditResult::OutOfRange;
    }
    out = profile;
    if (profile.sync_word == sync_word) {
        return ProfileEditResult::Unchanged;
    }
    out.sync_word = sync_word;
    return ProfileEditResult::Applied;
}

ProfileEditResult setProfilePreambleSymbols(const RadioProfile &profile,
                                            std::uint16_t symbols,
                                            RadioProfile &out) noexcept
{
    if (profile.modulation != Modulation::LoRa) {
        return ProfileEditResult::UnsupportedModulation;
    }
    if (symbols < kMinimumPreambleSymbols || symbols > kMaximumPreambleSymbols) {
        return ProfileEditResult::OutOfRange;
    }
    out = profile;
    if (profile.preamble_override && profile.preamble_symbols == symbols) {
        return ProfileEditResult::Unchanged;
    }
    // Typing a value pins it, even when it happens to equal the derived one:
    // the operator asked for that number, not for whatever the next bandwidth
    // change would have produced.
    out.preamble_override = true;
    out.preamble_symbols = symbols;
    return ProfileEditResult::Applied;
}

ProfileEditResult clearProfilePreambleOverride(const RadioProfile &profile,
                                               RadioProfile &out) noexcept
{
    if (profile.modulation != Modulation::LoRa) {
        return ProfileEditResult::UnsupportedModulation;
    }
    out = profile;
    out.preamble_override = false;
    const std::uint16_t derived = derivePreambleSymbols(out);
    if (!profile.preamble_override && profile.preamble_symbols == derived) {
        return ProfileEditResult::Unchanged;
    }
    if (derived < kMinimumPreambleSymbols || derived > kMaximumPreambleSymbols) {
        out = profile;
        return ProfileEditResult::OutOfRange;
    }
    out.preamble_symbols = derived;
    return ProfileEditResult::Applied;
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
    if (!isSupportedSyncWord(profile.sync_word) ||
        !isSupportedPreambleSymbols(profile, profile.preamble_symbols)) {
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
