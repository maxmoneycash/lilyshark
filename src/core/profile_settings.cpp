#include "lilyshark/core/profile_settings.h"

#include "lilyshark/core/builtin_profiles.h"
#include "lilyshark/core/profile_tuning.h"
#include "lilyshark/core/settings_checksum.h"

#include <algorithm>
#include <iterator>

namespace lilyshark {
namespace {

constexpr std::uint8_t kVersion1 = 1U;
constexpr std::uint8_t kVersion2 = 2U;
constexpr std::uint8_t kVersion3 = 3U;

constexpr std::size_t kV3ChecksumOffset = 24U;
constexpr std::uint8_t kPreambleOverrideFlag = 1U << 0U;
constexpr std::uint8_t kKnownV3Flags = kPreambleOverrideFlag;

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
           (size == kSavedProfileV2Size && bytes[2] == kVersion2) ||
           (size == kSavedProfileV3Size && bytes[2] == kVersion3);
}

} // namespace

SavedProfileDecodeResult decodeSavedProfile(const std::uint8_t *bytes, std::size_t size,
                                            RadioProfile &profile) noexcept
{
    if ((size != kSavedProfileV1Size && size != kSavedProfileV2Size &&
         size != kSavedProfileV3Size) ||
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
        candidate.preamble_override = false;
        candidate.preamble_symbols = derivePreambleSymbols(candidate);
    } else {
        if (bytes[3] > static_cast<std::uint8_t>(FrequencyTuningPolicy::ExplicitSlot)) {
            return SavedProfileDecodeResult::Invalid;
        }
        candidate.frequency_tuning_policy = static_cast<FrequencyTuningPolicy>(bytes[3]);
        candidate.frequency_slot = getU16(&bytes[16]);

        if (size == kSavedProfileV2Size) {
            // Version 2 predates stored sync words and preambles. Both come
            // from the built-in preset the record's id names, which is where
            // they came from when the record was written.
            candidate.preamble_override = false;
            candidate.preamble_symbols = derivePreambleSymbols(candidate);
            result = SavedProfileDecodeResult::MigratedV2;
        } else {
            // Version 3 is the first checksummed profile record. Reject the
            // whole thing before a single field is trusted.
            if (getU32(&bytes[kV3ChecksumOffset]) !=
                    settingsCrc32(bytes, kV3ChecksumOffset) ||
                bytes[22] >= static_cast<std::uint8_t>(RegionCode::Count) ||
                (bytes[23] & static_cast<std::uint8_t>(~kKnownV3Flags)) != 0U) {
                return SavedProfileDecodeResult::Invalid;
            }
            candidate.sync_word = getU16(&bytes[18]);
            candidate.region = static_cast<RegionCode>(bytes[22]);
            candidate.preamble_override = (bytes[23] & kPreambleOverrideFlag) != 0U;
            candidate.preamble_symbols = candidate.preamble_override
                                             ? getU16(&bytes[20])
                                             : derivePreambleSymbols(candidate);
            // A record that claims a derived preamble but stores a different
            // number was not written by this encoder. Refuse it rather than
            // quietly substituting the derived value.
            if (!candidate.preamble_override &&
                getU16(&bytes[20]) != candidate.preamble_symbols) {
                return SavedProfileDecodeResult::Invalid;
            }
            result = SavedProfileDecodeResult::LoadedV3;
        }
    }

    if (!isSupportedTunedProfile(candidate)) {
        return SavedProfileDecodeResult::Invalid;
    }

    profile = candidate;
    return result;
}

bool encodeSavedProfileV3(const RadioProfile &profile, std::uint8_t *bytes,
                          std::size_t size) noexcept
{
    const RadioProfile *base = findBuiltinProfile(profile.id);
    if (bytes == nullptr || size != kSavedProfileV3Size || base == nullptr ||
        base->protocol_hint != profile.protocol_hint || base->modulation != profile.modulation ||
        profile.region >= RegionCode::Count || !isSupportedTunedProfile(profile)) {
        return false;
    }

    std::uint8_t encoded[kSavedProfileV3Size]{};
    encoded[0] = 'L';
    encoded[1] = 'P';
    encoded[2] = kVersion3;
    encoded[3] = static_cast<std::uint8_t>(profile.frequency_tuning_policy);
    putU16(&encoded[4], profile.id);
    putU32(&encoded[6], profile.center_frequency_hz);
    putU32(&encoded[10], profile.bandwidth_hz);
    encoded[14] = profile.spreading_factor;
    encoded[15] = profile.coding_rate_denominator;
    putU16(&encoded[16], profile.frequency_slot);
    putU16(&encoded[18], profile.sync_word);
    putU16(&encoded[20], profile.preamble_symbols);
    encoded[22] = static_cast<std::uint8_t>(profile.region);
    encoded[23] = profile.preamble_override ? kPreambleOverrideFlag : 0U;
    putU32(&encoded[kV3ChecksumOffset], settingsCrc32(encoded, kV3ChecksumOffset));
    std::copy(std::begin(encoded), std::end(encoded), bytes);
    return true;
}

} // namespace lilyshark
