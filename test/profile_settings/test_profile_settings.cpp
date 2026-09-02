#include "lilyshark/core/builtin_profiles.h"
#include "lilyshark/core/profile_settings.h"
#include "lilyshark/core/profile_tuning.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;

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

void assertCoreTuningEqual(const RadioProfile &left, const RadioProfile &right)
{
    assert(left.id == right.id);
    assert(left.protocol_hint == right.protocol_hint);
    assert(left.center_frequency_hz == right.center_frequency_hz);
    assert(left.bandwidth_hz == right.bandwidth_hz);
    assert(left.spreading_factor == right.spreading_factor);
    assert(left.coding_rate_denominator == right.coding_rate_denominator);
    assert(left.preamble_symbols == right.preamble_symbols);
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

    // Profile id 4 used to be the EU RNode example; it is the Bay Area
    // Meshtastic preset now. A v1 save carrying the old EU tune must be
    // rejected outright -- migrating an 867 MHz Reticulum deployment onto a
    // US Meshtastic base would produce a profile that is a lie twice over.
    // Rejection sends the deck back to builtin defaults, which is the only
    // honest place for a save whose meaning no longer exists.
    bytes = makeV1(4U, 867200000U, 250000U, 7U, 5U);
    assert(decodeSavedProfile(bytes.data(), bytes.size(), profile) ==
           SavedProfileDecodeResult::Invalid);
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

void testMigratedProfileReencodesAsValidatedV2()
{
    const auto v1 = makeV1(1U, 914125000U, 250000U);
    RadioProfile migrated{};
    assert(decodeSavedProfile(v1.data(), v1.size(), migrated) ==
           SavedProfileDecodeResult::MigratedV1);
    assert(migrated.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot);
    assert(migrated.frequency_slot == 48U);

    std::array<std::uint8_t, kSavedProfileV2Size> v2{};
    assert(encodeSavedProfileV2(migrated, v2.data(), v2.size()));
    assert(v2[0] == 'L' && v2[1] == 'P' && v2[2] == 2U);

    RadioProfile loaded{};
    assert(decodeSavedProfile(v2.data(), v2.size(), loaded) ==
           SavedProfileDecodeResult::LoadedV2);
    assertCoreTuningEqual(migrated, loaded);

    v2[3] = 0xffU;
    assert(decodeSavedProfile(v2.data(), v2.size(), loaded) ==
           SavedProfileDecodeResult::Invalid);
}

void testV2CodecRejectsInvalidProfilesAndSizes()
{
    const RadioProfile *builtin = findBuiltinProfile(1U);
    assert(builtin != nullptr);
    RadioProfile invalid = *builtin;
    invalid.center_frequency_hz = 906900000U;

    std::array<std::uint8_t, kSavedProfileV2Size> bytes{};
    assert(!encodeSavedProfileV2(invalid, bytes.data(), bytes.size()));
    assert(!encodeSavedProfileV2(*builtin, nullptr, bytes.size()));
    assert(!encodeSavedProfileV2(*builtin, bytes.data(), bytes.size() - 1U));
}

} // namespace

int main()
{
    testV1MeshtasticHashedCentersMigrateAsDefaultHashed();
    testV1MeshtasticGridCenterMigratesAsExplicitSlot();
    testV1DeploymentCentersAndPreamblesArePreserved();
    testInvalidV1ValuesAreRejectedWithoutChangingOutput();
    testMigratedProfileReencodesAsValidatedV2();
    testV2CodecRejectsInvalidProfilesAndSizes();
    std::puts("profile settings tests passed");
    return 0;
}
