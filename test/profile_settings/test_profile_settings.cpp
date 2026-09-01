#include "lilyshark/core/builtin_profiles.h"
#include "lilyshark/core/profile_settings.h"
#include "lilyshark/core/profile_tuning.h"
#include "lilyshark/core/settings_checksum.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;

constexpr std::size_t kV3ChecksumOffset = 24U;

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

std::array<std::uint8_t, kSavedProfileV1Size>
makeV1(std::uint16_t id, std::uint32_t center_hz, std::uint32_t bandwidth_hz,
       std::uint8_t spreading_factor = 11U, std::uint8_t coding_rate = 5U) noexcept
{
    std::array<std::uint8_t, kSavedProfileV1Size> bytes{};
    bytes[0] = 'L';
    bytes[1] = 'P';
    bytes[2] = 1U;
    putU16(&bytes[4], id);
    putU32(&bytes[6], center_hz);
    putU32(&bytes[10], bandwidth_hz);
    bytes[14] = spreading_factor;
    bytes[15] = coding_rate;
    return bytes;
}

std::array<std::uint8_t, kSavedProfileV2Size>
makeV2(std::uint16_t id, std::uint32_t center_hz, std::uint32_t bandwidth_hz,
       FrequencyTuningPolicy policy, std::uint16_t slot,
       std::uint8_t spreading_factor = 11U, std::uint8_t coding_rate = 5U) noexcept
{
    std::array<std::uint8_t, kSavedProfileV2Size> bytes{};
    bytes[0] = 'L';
    bytes[1] = 'P';
    bytes[2] = 2U;
    bytes[3] = static_cast<std::uint8_t>(policy);
    putU16(&bytes[4], id);
    putU32(&bytes[6], center_hz);
    putU32(&bytes[10], bandwidth_hz);
    bytes[14] = spreading_factor;
    bytes[15] = coding_rate;
    putU16(&bytes[16], slot);
    return bytes;
}

void refreshChecksum(std::array<std::uint8_t, kSavedProfileV3Size> &bytes) noexcept
{
    putU32(&bytes[kV3ChecksumOffset], settingsCrc32(bytes.data(), kV3ChecksumOffset));
}

void assertCoreTuningEqual(const RadioProfile &left, const RadioProfile &right)
{
    assert(left.id == right.id);
    assert(left.protocol_hint == right.protocol_hint);
    assert(left.region == right.region);
    assert(left.center_frequency_hz == right.center_frequency_hz);
    assert(left.bandwidth_hz == right.bandwidth_hz);
    assert(left.spreading_factor == right.spreading_factor);
    assert(left.coding_rate_denominator == right.coding_rate_denominator);
    assert(left.preamble_symbols == right.preamble_symbols);
    assert(left.preamble_override == right.preamble_override);
    assert(left.sync_word == right.sync_word);
    assert(left.frequency_tuning_policy == right.frequency_tuning_policy);
    assert(left.frequency_slot == right.frequency_slot);
}

void testV1MeshtasticHashedCentersMigrateAsDefaultHashed()
{
    struct Case {
        std::uint32_t bandwidth_hz;
        std::uint32_t center_hz;
    };
    constexpr Case cases[] = {
        {62500U, 916218750U},
        {125000U, 904437500U},
        {250000U, 906875000U},
        {500000U, 911750000U},
    };

    for (const Case &value : cases) {
        const auto bytes = makeV1(1U, value.center_hz, value.bandwidth_hz);
        RadioProfile profile{};
        assert(decodeSavedProfile(bytes.data(), bytes.size(), profile) ==
               SavedProfileDecodeResult::MigratedV1);
        assert(profile.frequency_tuning_policy == FrequencyTuningPolicy::DefaultHashed);
        assert(profile.frequency_slot == 0U);
        assert(profile.center_frequency_hz == value.center_hz);
        assert(profile.preamble_symbols == 16U);
        assert(!profile.preamble_override);
        // The sync word and band plan came from the built-in preset, which is
        // where they lived when a version 1 record was written.
        assert(profile.sync_word == 0x2bU);
        assert(profile.region == RegionCode::US915);
    }
}

void testV1MeshtasticGridCenterMigratesAsExplicitSlot()
{
    const auto bytes = makeV1(1U, 903218750U, 62500U);
    RadioProfile profile{};
    assert(decodeSavedProfile(bytes.data(), bytes.size(), profile) ==
           SavedProfileDecodeResult::MigratedV1);
    assert(profile.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot);
    assert(profile.frequency_slot == 19U);
    assert(profile.center_frequency_hz == 903218750U);
    assert(isSupportedTunedProfile(profile));
}

void testV1DeploymentCentersAndPreamblesArePreserved()
{
    auto bytes = makeV1(2U, 910525000U, 125000U, 8U, 6U);
    RadioProfile profile{};
    assert(decodeSavedProfile(bytes.data(), bytes.size(), profile) ==
           SavedProfileDecodeResult::MigratedV1);
    assert(profile.protocol_hint == ProtocolId::MeshCore);
    assert(profile.frequency_tuning_policy == FrequencyTuningPolicy::DeploymentDefined);
    assert(profile.frequency_slot == 0U);
    assert(profile.center_frequency_hz == 910525000U);
    assert(profile.preamble_symbols == 32U);

    bytes = makeV1(4U, 867200000U, 250000U, 7U, 5U);
    assert(decodeSavedProfile(bytes.data(), bytes.size(), profile) ==
           SavedProfileDecodeResult::MigratedV1);
    assert(profile.protocol_hint == ProtocolId::Reticulum);
    assert(profile.frequency_tuning_policy == FrequencyTuningPolicy::DeploymentDefined);
    assert(profile.center_frequency_hz == 867200000U);
    assert(profile.preamble_symbols == 47U);
    assert(profile.region == RegionCode::EU863);
}

void testInvalidV1ValuesAreRejectedWithoutChangingOutput()
{
    RadioProfile output{};
    output.id = 99U;

    auto bytes = makeV1(1U, 906900000U, 250000U);
    assert(decodeSavedProfile(bytes.data(), bytes.size(), output) ==
           SavedProfileDecodeResult::Invalid);
    assert(output.id == 99U);

    bytes = makeV1(99U, 906875000U, 250000U);
    assert(decodeSavedProfile(bytes.data(), bytes.size(), output) ==
           SavedProfileDecodeResult::Invalid);
    bytes = makeV1(1U, 906875000U, 12345U);
    assert(decodeSavedProfile(bytes.data(), bytes.size(), output) ==
           SavedProfileDecodeResult::Invalid);
    bytes = makeV1(1U, 906875000U, 250000U, 6U, 5U);
    assert(decodeSavedProfile(bytes.data(), bytes.size(), output) ==
           SavedProfileDecodeResult::Invalid);
    bytes = makeV1(1U, 906875000U, 250000U, 11U, 9U);
    assert(decodeSavedProfile(bytes.data(), bytes.size(), output) ==
           SavedProfileDecodeResult::Invalid);

    bytes = makeV1(1U, 906875000U, 250000U);
    bytes[0] = 'X';
    assert(decodeSavedProfile(bytes.data(), bytes.size(), output) ==
           SavedProfileDecodeResult::Invalid);
    assert(decodeSavedProfile(bytes.data(), bytes.size() - 1U, output) ==
           SavedProfileDecodeResult::Invalid);
    assert(decodeSavedProfile(nullptr, bytes.size(), output) ==
           SavedProfileDecodeResult::Invalid);
}

void testMigratedProfileReencodesAsChecksummedV3()
{
    const auto v1 = makeV1(1U, 914125000U, 250000U);
    RadioProfile migrated{};
    assert(decodeSavedProfile(v1.data(), v1.size(), migrated) ==
           SavedProfileDecodeResult::MigratedV1);
    assert(migrated.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot);
    assert(migrated.frequency_slot == 48U);

    std::array<std::uint8_t, kSavedProfileV3Size> v3{};
    assert(encodeSavedProfileV3(migrated, v3.data(), v3.size()));
    assert(v3[0] == 'L' && v3[1] == 'P' && v3[2] == 3U);

    RadioProfile loaded{};
    assert(decodeSavedProfile(v3.data(), v3.size(), loaded) ==
           SavedProfileDecodeResult::LoadedV3);
    assertCoreTuningEqual(migrated, loaded);

    // A well-formed field change without a matching checksum is refused.
    auto tampered = v3;
    tampered[3] = 0U;
    assert(decodeSavedProfile(tampered.data(), tampered.size(), loaded) ==
           SavedProfileDecodeResult::Invalid);
    refreshChecksum(tampered);
    assert(decodeSavedProfile(tampered.data(), tampered.size(), loaded) ==
           SavedProfileDecodeResult::Invalid);
}

void testV2RecordsMigrateWithPresetSyncAndPreamble()
{
    const auto v2 = makeV2(1U, 914125000U, 250000U, FrequencyTuningPolicy::ExplicitSlot, 48U);
    RadioProfile profile{};
    assert(decodeSavedProfile(v2.data(), v2.size(), profile) ==
           SavedProfileDecodeResult::MigratedV2);
    assert(profile.frequency_slot == 48U);
    assert(profile.center_frequency_hz == 914125000U);
    assert(profile.sync_word == 0x2bU);
    assert(profile.preamble_symbols == 16U);
    assert(!profile.preamble_override);
    assert(profile.region == RegionCode::US915);

    auto invalid_policy = v2;
    invalid_policy[3] = 0xffU;
    assert(decodeSavedProfile(invalid_policy.data(), invalid_policy.size(), profile) ==
           SavedProfileDecodeResult::Invalid);
}

void testEditedSyncWordAndPreambleRoundTrip()
{
    const RadioProfile *builtin = findBuiltinProfile(1U);
    assert(builtin != nullptr);

    RadioProfile edited{};
    assert(setProfileSyncWord(*builtin, 0x3444U, edited) == ProfileEditResult::Applied);
    RadioProfile with_preamble{};
    assert(setProfilePreambleSymbols(edited, 512U, with_preamble) ==
           ProfileEditResult::Applied);
    assert(with_preamble.preamble_override);
    assert(isSupportedTunedProfile(with_preamble));

    std::array<std::uint8_t, kSavedProfileV3Size> bytes{};
    assert(encodeSavedProfileV3(with_preamble, bytes.data(), bytes.size()));
    RadioProfile loaded{};
    assert(decodeSavedProfile(bytes.data(), bytes.size(), loaded) ==
           SavedProfileDecodeResult::LoadedV3);
    assert(loaded.sync_word == 0x3444U);
    assert(loaded.preamble_symbols == 512U);
    assert(loaded.preamble_override);
    assertCoreTuningEqual(with_preamble, loaded);

    // Dropping the override restores the derived preamble and round-trips too.
    RadioProfile restored{};
    assert(clearProfilePreambleOverride(loaded, restored) == ProfileEditResult::Applied);
    assert(!restored.preamble_override);
    assert(restored.preamble_symbols == derivePreambleSymbols(restored));
    assert(encodeSavedProfileV3(restored, bytes.data(), bytes.size()));
    assert(decodeSavedProfile(bytes.data(), bytes.size(), loaded) ==
           SavedProfileDecodeResult::LoadedV3);
    assert(!loaded.preamble_override);
    assert(loaded.preamble_symbols == 16U);
}

void testRegionalPresetsRoundTripUnderTheirOwnBandPlan()
{
    for (std::size_t index = 0; index < builtinProfileCount(); ++index) {
        const RadioProfile &profile = builtinProfiles()[index];
        std::array<std::uint8_t, kSavedProfileV3Size> bytes{};
        assert(encodeSavedProfileV3(profile, bytes.data(), bytes.size()));
        RadioProfile loaded{};
        assert(decodeSavedProfile(bytes.data(), bytes.size(), loaded) ==
               SavedProfileDecodeResult::LoadedV3);
        assertCoreTuningEqual(profile, loaded);
    }

    // A regional profile whose stored band plan is swapped for one that does
    // not contain its centre must not decode: the band plan is what makes the
    // centre legal, so a mismatch is a corrupt record, not a detail to fix up.
    const RadioProfile *eu868 = findBuiltinProfile(6U);
    assert(eu868 != nullptr);
    std::array<std::uint8_t, kSavedProfileV3Size> bytes{};
    assert(encodeSavedProfileV3(*eu868, bytes.data(), bytes.size()));
    bytes[22] = static_cast<std::uint8_t>(RegionCode::US915);
    refreshChecksum(bytes);
    RadioProfile loaded{};
    assert(decodeSavedProfile(bytes.data(), bytes.size(), loaded) ==
           SavedProfileDecodeResult::Invalid);

    bytes[22] = static_cast<std::uint8_t>(RegionCode::Count);
    refreshChecksum(bytes);
    assert(decodeSavedProfile(bytes.data(), bytes.size(), loaded) ==
           SavedProfileDecodeResult::Invalid);
}

void testEveryUncheckedCorruptionOfV3IsRejected()
{
    const RadioProfile *builtin = findBuiltinProfile(1U);
    assert(builtin != nullptr);
    std::array<std::uint8_t, kSavedProfileV3Size> encoded{};
    assert(encodeSavedProfileV3(*builtin, encoded.data(), encoded.size()));

    RadioProfile sentinel{};
    sentinel.id = 4242U;
    for (std::size_t index = 0; index < encoded.size(); ++index) {
        auto corrupt = encoded;
        corrupt[index] ^= 0x01U;
        RadioProfile output = sentinel;
        assert(decodeSavedProfile(corrupt.data(), corrupt.size(), output) ==
               SavedProfileDecodeResult::Invalid);
        assert(output.id == sentinel.id);
    }

    // Reserved flag bits are refused even with a matching checksum.
    auto reserved = encoded;
    reserved[23] = 0x02U;
    refreshChecksum(reserved);
    RadioProfile output = sentinel;
    assert(decodeSavedProfile(reserved.data(), reserved.size(), output) ==
           SavedProfileDecodeResult::Invalid);
    assert(output.id == sentinel.id);

    // Claiming a derived preamble while storing another number is refused.
    auto mismatched = encoded;
    putU16(&mismatched[20], 33U);
    refreshChecksum(mismatched);
    assert(decodeSavedProfile(mismatched.data(), mismatched.size(), output) ==
           SavedProfileDecodeResult::Invalid);

    // An out-of-range sync word is refused even when the checksum agrees.
    auto bad_sync = encoded;
    putU16(&bad_sync[18], 0x1425U);
    refreshChecksum(bad_sync);
    assert(decodeSavedProfile(bad_sync.data(), bad_sync.size(), output) ==
           SavedProfileDecodeResult::Invalid);

    // So is an out-of-range overridden preamble.
    auto bad_preamble = encoded;
    bad_preamble[23] = 0x01U;
    putU16(&bad_preamble[20], 5U);
    refreshChecksum(bad_preamble);
    assert(decodeSavedProfile(bad_preamble.data(), bad_preamble.size(), output) ==
           SavedProfileDecodeResult::Invalid);
}

void testV3CodecRejectsInvalidProfilesAndSizes()
{
    const RadioProfile *builtin = findBuiltinProfile(1U);
    assert(builtin != nullptr);
    RadioProfile invalid = *builtin;
    invalid.center_frequency_hz = 906900000U;

    std::array<std::uint8_t, kSavedProfileV3Size> bytes{};
    bytes.fill(0xa5U);
    const auto untouched = bytes;
    assert(!encodeSavedProfileV3(invalid, bytes.data(), bytes.size()));
    assert(bytes == untouched);
    assert(!encodeSavedProfileV3(*builtin, nullptr, bytes.size()));
    assert(!encodeSavedProfileV3(*builtin, bytes.data(), bytes.size() - 1U));
    assert(bytes == untouched);

    invalid = *builtin;
    invalid.sync_word = 0x0100U;
    assert(!encodeSavedProfileV3(invalid, bytes.data(), bytes.size()));
    invalid = *builtin;
    invalid.preamble_override = true;
    invalid.preamble_symbols = 0U;
    assert(!encodeSavedProfileV3(invalid, bytes.data(), bytes.size()));
    assert(bytes == untouched);
}

} // namespace

int main()
{
    testV1MeshtasticHashedCentersMigrateAsDefaultHashed();
    testV1MeshtasticGridCenterMigratesAsExplicitSlot();
    testV1DeploymentCentersAndPreamblesArePreserved();
    testInvalidV1ValuesAreRejectedWithoutChangingOutput();
    testMigratedProfileReencodesAsChecksummedV3();
    testV2RecordsMigrateWithPresetSyncAndPreamble();
    testEditedSyncWordAndPreambleRoundTrip();
    testRegionalPresetsRoundTripUnderTheirOwnBandPlan();
    testEveryUncheckedCorruptionOfV3IsRejected();
    testV3CodecRejectsInvalidProfilesAndSizes();
    std::puts("profile settings tests passed");
    return 0;
}
