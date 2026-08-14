#include "lilyshark/core/profile_settings.h"

#include "lilyshark/core/builtin_profiles.h"
#include "lilyshark/core/profile_tuning.h"

#include <algorithm>

namespace lilyshark {
namespace {

constexpr std::uint8_t kVersion1 = 1U;
constexpr std::uint8_t kVersion2 = 2U;

std::uint16_t getU16(const std::uint8_t *bytes) noexcept
{
    return static_cast<std::uint16_t>(bytes[0]) |
           static_cast<std::uint16_t>(static_cast<std::uint16_t>(bytes[1]) << 8U);
}

std::uint32_t getU32(const std::uint8_t *bytes) noexcept
{
    return static_cast<std::uint32_t>(bytes[0]) |
           (static_cast<std::uint32_t>(bytes[1]) << 8U) |
           (static_cast<std::uint32_t>(bytes[2]) << 16U) |
           (static_cast<std::uint32_t>(bytes[3]) << 24U);
}

void putU16(std::uint8_t *bytes, std::uint16_t value) noexcept
{
    bytes[0] = static_cast<std::uint8_t>(value);
    bytes[1] = static_cast<std::uint8_t>(value >> 8U);
}

void putU32(std::uint8_t *bytes, std::uint32_t value) noexcept
{
    bytes[0] = static_cast<std::uint8_t>(value);
    bytes[1] = static_cast<std::uint8_t>(value >> 8U);
    bytes[2] = static_cast<std::uint8_t>(value >> 16U);
    bytes[3] = static_cast<std::uint8_t>(value >> 24U);
}

bool hasHeader(const std::uint8_t *bytes, std::size_t size) noexcept
{
    if (bytes == nullptr || bytes[0] != 'L' || bytes[1] != 'P') {
        return false;
    }
    return (size == kSavedProfileV1Size && bytes[2] == kVersion1) ||
           (size == kSavedProfileV2Size && bytes[2] == kVersion2);
}

} // namespace

SavedProfileDecodeResult decodeSavedProfile(const std::uint8_t *bytes, std::size_t size,
                                            RadioProfile &profile) noexcept
{
    if ((size != kSavedProfileV1Size && size != kSavedProfileV2Size) ||
        !hasHeader(bytes, size)) {
        return SavedProfileDecodeResult::Invalid;
    }

    const RadioProfile *base = findBuiltinProfile(getU16(&bytes[4]));
    if (base == nullptr) {
        return SavedProfileDecodeResult::Invalid;
    }

    RadioProfile candidate = *base;
    candidate.center_frequency_hz = getU32(&bytes[6]);
    candidate.bandwidth_hz = getU32(&bytes[10]);
    candidate.spreading_factor = bytes[14];
    candidate.coding_rate_denominator = bytes[15];

    SavedProfileDecodeResult result = SavedProfileDecodeResult::MigratedV1;
    if (size == kSavedProfileV1Size) {
        if (!inferLegacyFrequencyTuningPolicy(candidate)) {
            return SavedProfileDecodeResult::Invalid;
        }
    } else {
        if (bytes[3] > static_cast<std::uint8_t>(FrequencyTuningPolicy::ExplicitSlot)) {
            return SavedProfileDecodeResult::Invalid;
        }
        candidate.frequency_tuning_policy = static_cast<FrequencyTuningPolicy>(bytes[3]);
        candidate.frequency_slot = getU16(&bytes[16]);
        result = SavedProfileDecodeResult::LoadedV2;
    }

    candidate.preamble_symbols = derivePreambleSymbols(candidate);
    if (!isSupportedTunedProfile(candidate)) {
        return SavedProfileDecodeResult::Invalid;
    }

    profile = candidate;
    return result;
}

bool encodeSavedProfileV2(const RadioProfile &profile, std::uint8_t *bytes,
                          std::size_t size) noexcept
{
    const RadioProfile *base = findBuiltinProfile(profile.id);
    if (bytes == nullptr || size != kSavedProfileV2Size || base == nullptr ||
        base->protocol_hint != profile.protocol_hint || base->modulation != profile.modulation ||
        !isSupportedTunedProfile(profile)) {
        return false;
    }

    std::fill(bytes, bytes + size, 0U);
    bytes[0] = 'L';
    bytes[1] = 'P';
    bytes[2] = kVersion2;
    bytes[3] = static_cast<std::uint8_t>(profile.frequency_tuning_policy);
    putU16(&bytes[4], profile.id);
    putU32(&bytes[6], profile.center_frequency_hz);
    putU32(&bytes[10], profile.bandwidth_hz);
    bytes[14] = profile.spreading_factor;
    bytes[15] = profile.coding_rate_denominator;
    putU16(&bytes[16], profile.frequency_slot);
    return true;
}

} // namespace lilyshark
