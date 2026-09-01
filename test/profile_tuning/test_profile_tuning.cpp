#include "lilyshark/core/builtin_profiles.h"
#include "lilyshark/core/profile_tuning.h"

#include <cassert>
#include <cstdio>
#include <cstring>

namespace {

using namespace lilyshark;

RadioProfile makeProfile(ProtocolId protocol, std::uint32_t frequency_hz,
                         std::uint32_t bandwidth_hz) noexcept
{
    RadioProfile profile{};
    profile.id = 42;
    profile.setName("TEST PROFILE");
    profile.protocol_hint = protocol;
    profile.modulation = Modulation::LoRa;
    profile.center_frequency_hz = frequency_hz;
    profile.bandwidth_hz = bandwidth_hz;
    profile.bit_rate_bps = 4800;
    profile.frequency_deviation_hz = 2400;
    profile.sync_word = 0x1424;
    profile.spreading_factor = 11;
    profile.coding_rate_denominator = 5;
    profile.tx_power_dbm = 10;
    profile.crc_enabled = true;
    profile.implicit_header = false;
    profile.inverted_iq = true;
    if (protocol == ProtocolId::Meshtastic) {
        profile.frequency_tuning_policy = FrequencyTuningPolicy::DefaultHashed;
    }
    profile.preamble_symbols = derivePreambleSymbols(profile);
    return profile;
}

RadioProfile makeExplicitMeshtastic(std::uint16_t slot, std::uint32_t bandwidth_hz) noexcept
{
    const std::uint32_t center = 902000000U + (bandwidth_hz / 2U) +
                                 (static_cast<std::uint32_t>(slot) * bandwidth_hz);
    RadioProfile profile = makeProfile(ProtocolId::Meshtastic, center, bandwidth_hz);
    profile.frequency_tuning_policy = FrequencyTuningPolicy::ExplicitSlot;
    profile.frequency_slot = slot;
    return profile;
}

bool sameProfile(const RadioProfile &left, const RadioProfile &right) noexcept
{
    return left.id == right.id && std::strcmp(left.name, right.name) == 0 &&
           left.protocol_hint == right.protocol_hint && left.modulation == right.modulation &&
           left.center_frequency_hz == right.center_frequency_hz &&
           left.bandwidth_hz == right.bandwidth_hz && left.bit_rate_bps == right.bit_rate_bps &&
           left.frequency_deviation_hz == right.frequency_deviation_hz &&
           left.frequency_tuning_policy == right.frequency_tuning_policy &&
           left.frequency_slot == right.frequency_slot &&
           left.preamble_symbols == right.preamble_symbols && left.sync_word == right.sync_word &&
           left.spreading_factor == right.spreading_factor &&
           left.coding_rate_denominator == right.coding_rate_denominator &&
           left.tx_power_dbm == right.tx_power_dbm && left.crc_enabled == right.crc_enabled &&
           left.implicit_header == right.implicit_header &&
           left.inverted_iq == right.inverted_iq;
}

void assertOnlyFrequencyChanged(const RadioProfile &before, const RadioProfile &after)
{
    RadioProfile normalized = after;
    normalized.center_frequency_hz = before.center_frequency_hz;
    normalized.frequency_tuning_policy = before.frequency_tuning_policy;
    normalized.frequency_slot = before.frequency_slot;
    assert(sameProfile(before, normalized));
}

void assertOnlyFrequencyAndBandwidthChanged(const RadioProfile &before,
                                            const RadioProfile &after)
{
    RadioProfile normalized = after;
    normalized.center_frequency_hz = before.center_frequency_hz;
    normalized.bandwidth_hz = before.bandwidth_hz;
    normalized.preamble_symbols = before.preamble_symbols;
    assert(sameProfile(before, normalized));
}

void testMeshtasticFrequencyStepsAndWraps()
{
    const RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    RadioProfile tuned = stepProfileFrequency(profile, 1);
    assert(tuned.center_frequency_hz == 907125000U);
    assert(tuned.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot);
    assert(tuned.frequency_slot == 20U);
    assertOnlyFrequencyChanged(profile, tuned);

    tuned = stepProfileFrequency(profile, -1);
    assert(tuned.center_frequency_hz == 906625000U);
    assert(tuned.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot);
    assert(tuned.frequency_slot == 18U);
    assertOnlyFrequencyChanged(profile, tuned);

    const RadioProfile lower = makeExplicitMeshtastic(0U, 250000U);
    tuned = stepProfileFrequency(lower, -1);
    assert(tuned.center_frequency_hz == 927875000U);
    assert(tuned.frequency_slot == 103U);

    const RadioProfile upper = makeExplicitMeshtastic(103U, 250000U);
    tuned = stepProfileFrequency(upper, 1);
    assert(tuned.center_frequency_hz == 902125000U);
    assert(tuned.frequency_slot == 0U);
}

void testMeshtasticDefaultHashedBandwidthCenters()
{
    RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    struct Expected {
        std::uint32_t bandwidth_hz;
        std::uint32_t center_frequency_hz;
    };
    constexpr Expected expected[] = {
        {500000U, 911750000U},
        {62500U, 916218750U},
        {125000U, 904437500U},
        {250000U, 906875000U},
    };
    for (const Expected &value : expected) {
        const RadioProfile before = profile;
        profile = cycleProfileBandwidth(profile);
        assert(profile.bandwidth_hz == value.bandwidth_hz);
        assert(profile.center_frequency_hz == value.center_frequency_hz);
        assert(profile.frequency_tuning_policy == FrequencyTuningPolicy::DefaultHashed);
        assert(profile.frequency_slot == 0U);
        assertOnlyFrequencyAndBandwidthChanged(before, profile);
    }
}

void testMeshCoreUsesSafeUsCenters()
{
    const RadioProfile profile = makeProfile(ProtocolId::MeshCore, 910525000U, 62500U);
    RadioProfile tuned = stepProfileFrequency(profile, 1);
    assert(tuned.center_frequency_hz == 910587500U);
    assertOnlyFrequencyChanged(profile, tuned);

    const RadioProfile below_safe_center =
        makeProfile(ProtocolId::MeshCore, 902000000U, 62500U);
    tuned = stepProfileFrequency(below_safe_center, 1);
    assert(tuned.center_frequency_hz == 902031250U);

    const RadioProfile above_safe_center =
        makeProfile(ProtocolId::MeshCore, 928000000U, 62500U);
    tuned = stepProfileFrequency(above_safe_center, -1);
    assert(tuned.center_frequency_hz == 927968750U);
}

void testReticulumUsesSafeEuCenters()
{
    const RadioProfile profile = makeProfile(ProtocolId::Reticulum, 867200000U, 125000U);
    RadioProfile tuned = stepProfileFrequency(profile, 1);
    assert(tuned.center_frequency_hz == 867325000U);
    assertOnlyFrequencyChanged(profile, tuned);

    const RadioProfile lower = makeProfile(ProtocolId::Reticulum, 863062500U, 125000U);
    tuned = stepProfileFrequency(lower, -1);
    assert(tuned.center_frequency_hz == 869937500U);

    const RadioProfile upper = makeProfile(ProtocolId::Reticulum, 869937500U, 125000U);
    tuned = stepProfileFrequency(upper, 1);
    assert(tuned.center_frequency_hz == 863062500U);

    const RadioProfile us = makeProfile(ProtocolId::Reticulum, 915000000U, 125000U);
    tuned = stepProfileFrequency(us, 1);
    assert(tuned.center_frequency_hz == 915125000U);
    assertOnlyFrequencyChanged(us, tuned);
}

void testUnsupportedAndInvalidFrequencyStepsAreNoOps()
{
    RadioProfile profile = makeProfile(ProtocolId::Custom, 915000000U, 250000U);
    assert(sameProfile(profile, stepProfileFrequency(profile, 1)));

    profile = makeProfile(ProtocolId::Meshtastic, 869500000U, 250000U);
    assert(sameProfile(profile, stepProfileFrequency(profile, 1)));

    profile = makeProfile(ProtocolId::MeshCore, 915000000U, 0U);
    assert(sameProfile(profile, stepProfileFrequency(profile, 1)));

    profile = makeProfile(ProtocolId::MeshCore, 915000000U, 26000001U);
    assert(sameProfile(profile, stepProfileFrequency(profile, 1)));

    profile = makeProfile(ProtocolId::MeshCore, 915000000U, 250000U);
    assert(sameProfile(profile, stepProfileFrequency(profile, 0)));

    profile.modulation = Modulation::Fsk;
    assert(sameProfile(profile, stepProfileFrequency(profile, 1)));
}

void testMeshtasticExplicitBandwidthCyclePreservesSlot()
{
    RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    profile = stepProfileFrequency(profile, 1);
    assert(profile.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot);
    assert(profile.frequency_slot == 20U);

    struct Expected {
        std::uint32_t bandwidth_hz;
        std::uint32_t center_frequency_hz;
    };
    constexpr Expected expected[] = {
        {500000U, 912250000U},
        {62500U, 903281250U},
        {125000U, 904562500U},
        {250000U, 907125000U},
    };
    for (const Expected &value : expected) {
        const RadioProfile before = profile;
        profile = cycleProfileBandwidth(profile);
        assert(profile.bandwidth_hz == value.bandwidth_hz);
        assert(profile.center_frequency_hz == value.center_frequency_hz);
        assert(profile.frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot);
        assert(profile.frequency_slot == 20U);
        assertOnlyFrequencyAndBandwidthChanged(before, profile);
    }

    profile = makeExplicitMeshtastic(415U, 62500U);
    profile = cycleProfileBandwidth(profile);
    assert(profile.bandwidth_hz == 125000U);
    assert(profile.center_frequency_hz == 927937500U);
    assert(profile.frequency_slot == 207U);
}

void testBandwidthCycleDoesNotSnapDeploymentCenters()
{
    RadioProfile profile = makeProfile(ProtocolId::MeshCore, 910525000U, 62500U);
    constexpr std::uint32_t expected[] = {125000U, 250000U, 500000U, 62500U};
    for (const std::uint32_t value : expected) {
        const RadioProfile before = profile;
        profile = cycleProfileBandwidth(profile);
        assert(profile.bandwidth_hz == value);
        assert(profile.center_frequency_hz == before.center_frequency_hz);
        RadioProfile normalized = profile;
        normalized.bandwidth_hz = before.bandwidth_hz;
        assert(sameProfile(before, normalized));
    }

    profile.bandwidth_hz = 12345U;
    assert(cycleProfileBandwidth(profile).bandwidth_hz == 62500U);
}

void testSpreadingFactorCycle()
{
    RadioProfile profile = makeProfile(ProtocolId::MeshCore, 910525000U, 62500U);
    profile.spreading_factor = 7;
    profile.preamble_symbols = derivePreambleSymbols(profile);
    struct Expected {
        std::uint8_t spreading_factor;
        std::uint16_t preamble_symbols;
    };
    constexpr Expected expected[] = {
        {8U, 32U}, {9U, 16U}, {10U, 16U}, {11U, 16U}, {12U, 16U}, {7U, 32U},
    };
    for (const Expected &value : expected) {
        const RadioProfile before = profile;
        profile = cycleProfileSpreadingFactor(profile);
        assert(profile.spreading_factor == value.spreading_factor);
        assert(profile.preamble_symbols == value.preamble_symbols);
        RadioProfile normalized = profile;
        normalized.spreading_factor = before.spreading_factor;
        normalized.preamble_symbols = before.preamble_symbols;
        assert(sameProfile(before, normalized));
    }

    profile.spreading_factor = 6;
    profile.preamble_symbols = derivePreambleSymbols(profile);
    profile = cycleProfileSpreadingFactor(profile);
    assert(profile.spreading_factor == 7U);
    assert(profile.preamble_symbols == 32U);
}

void testDerivedPreambleSymbols()
{
    RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    profile.spreading_factor = 7U;
    profile.bandwidth_hz = 62500U;
    assert(derivePreambleSymbols(profile) == 16U);

    profile = makeProfile(ProtocolId::MeshCore, 910525000U, 62500U);
    for (std::uint8_t sf = 7U; sf <= 12U; ++sf) {
        profile.spreading_factor = sf;
        assert(derivePreambleSymbols(profile) == (sf <= 8U ? 32U : 16U));
    }

    profile = makeProfile(ProtocolId::Reticulum, 867200000U, 62500U);
    constexpr std::uint32_t bandwidths[] = {62500U, 125000U, 250000U, 500000U};
    constexpr std::uint16_t expected[][6] = {
        {18U, 18U, 18U, 18U, 18U, 18U},
        {24U, 18U, 18U, 18U, 18U, 18U},
        {47U, 24U, 18U, 18U, 18U, 18U},
        {94U, 47U, 24U, 18U, 18U, 18U},
    };
    for (std::size_t bandwidth = 0; bandwidth < 4U; ++bandwidth) {
        profile.bandwidth_hz = bandwidths[bandwidth];
        for (std::uint8_t sf = 7U; sf <= 12U; ++sf) {
            profile.spreading_factor = sf;
            assert(derivePreambleSymbols(profile) == expected[bandwidth][sf - 7U]);
        }
    }

    profile = makeProfile(ProtocolId::Custom, 915000000U, 250000U);
    profile.preamble_symbols = 23U;
    assert(derivePreambleSymbols(profile) == 23U);
}

void testTuningAppliesDerivedPreambles()
{
    RadioProfile profile = makeProfile(ProtocolId::Reticulum, 867200000U, 125000U);
    profile.spreading_factor = 7U;
    profile.preamble_symbols = derivePreambleSymbols(profile);
    assert(profile.preamble_symbols == 24U);

    profile = cycleProfileBandwidth(profile);
    assert(profile.bandwidth_hz == 250000U);
    assert(profile.preamble_symbols == 47U);

    profile = cycleProfileSpreadingFactor(profile);
    assert(profile.spreading_factor == 8U);
    assert(profile.preamble_symbols == 24U);
}

void testBuiltinProfilesUseValidatedPoliciesAndPreambles()
{
    const RadioProfile *meshtastic = findBuiltinProfile(1U);
    assert(meshtastic != nullptr);
    assert(meshtastic->frequency_tuning_policy == FrequencyTuningPolicy::DefaultHashed);
    assert(meshtastic->frequency_slot == 0U);
    assert(meshtastic->center_frequency_hz == 906875000U);

    for (std::size_t index = 0; index < builtinProfileCount(); ++index) {
        const RadioProfile &profile = builtinProfiles()[index];
        assert(profile.preamble_symbols == derivePreambleSymbols(profile));
        assert(isSupportedTunedProfile(profile));
    }
}

void testCodingRateCycle()
{
    RadioProfile profile = makeProfile(ProtocolId::Reticulum, 867200000U, 125000U);
    profile.coding_rate_denominator = 5;
    constexpr std::uint8_t expected[] = {6U, 7U, 8U, 5U};
    for (const std::uint8_t value : expected) {
        const RadioProfile before = profile;
        profile = cycleProfileCodingRate(profile);
        assert(profile.coding_rate_denominator == value);
        RadioProfile normalized = profile;
        normalized.coding_rate_denominator = before.coding_rate_denominator;
        assert(sameProfile(before, normalized));
    }

    profile.coding_rate_denominator = 4;
    assert(cycleProfileCodingRate(profile).coding_rate_denominator == 5U);
}

void testNonLoRaCyclesAreNoOps()
{
    RadioProfile profile = makeProfile(ProtocolId::Custom, 915000000U, 250000U);
    profile.modulation = Modulation::Fsk;
    assert(sameProfile(profile, cycleProfileBandwidth(profile)));
    assert(sameProfile(profile, cycleProfileSpreadingFactor(profile)));
    assert(sameProfile(profile, cycleProfileCodingRate(profile)));
}

void testPersistedProfileValidation()
{
    RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    assert(isSupportedTunedProfile(profile));

    profile.center_frequency_hz = 914125000U;
    assert(!isSupportedTunedProfile(profile));
    profile.center_frequency_hz = 906875000U;

    profile = makeExplicitMeshtastic(48U, 250000U);
    assert(isSupportedTunedProfile(profile));

    profile.center_frequency_hz = 902000000U;
    assert(!isSupportedTunedProfile(profile));
    profile.center_frequency_hz = 914125000U;

    profile.center_frequency_hz = 914150000U;
    assert(!isSupportedTunedProfile(profile));
    profile.center_frequency_hz = 914125000U;

    profile.frequency_slot = 49U;
    assert(!isSupportedTunedProfile(profile));
    profile.frequency_slot = 48U;

    profile.frequency_tuning_policy = FrequencyTuningPolicy::DeploymentDefined;
    assert(!isSupportedTunedProfile(profile));
    profile.frequency_tuning_policy = FrequencyTuningPolicy::ExplicitSlot;

    profile.bandwidth_hz = 12345U;
    assert(!isSupportedTunedProfile(profile));
    profile.bandwidth_hz = 250000U;

    profile.spreading_factor = 6U;
    assert(!isSupportedTunedProfile(profile));
    profile.spreading_factor = 11U;

    profile.coding_rate_denominator = 9U;
    assert(!isSupportedTunedProfile(profile));
    profile.coding_rate_denominator = 5U;

    profile.modulation = Modulation::Fsk;
    assert(!isSupportedTunedProfile(profile));
}

void testSyncWordLimitsFollowTheSx1262Register()
{
    // Every one-byte logical sync word is programmable.
    for (unsigned value = 0; value <= 0xffU; ++value) {
        assert(isSupportedSyncWord(static_cast<std::uint16_t>(value)));
    }
    // Register form: the low nibble of each byte is RadioLib's control field.
    assert(isSupportedSyncWord(0x1424U));
    assert(isSupportedSyncWord(0x3444U));
    assert(isSupportedSyncWord(0xf4f4U));
    assert(!isSupportedSyncWord(0x1425U));
    assert(!isSupportedSyncWord(0x1524U));
    assert(!isSupportedSyncWord(0x2b00U));
    assert(!isSupportedSyncWord(0xffffU));
}

void testSyncWordEditsApplyOrAreRefusedOutright()
{
    const RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    RadioProfile out{};

    assert(setProfileSyncWord(profile, 0x2bU, out) == ProfileEditResult::Applied);
    assert(out.sync_word == 0x2bU);
    RadioProfile normalized = out;
    normalized.sync_word = profile.sync_word;
    assert(sameProfile(profile, normalized));

    assert(setProfileSyncWord(out, 0x2bU, out) == ProfileEditResult::Unchanged);
    assert(out.sync_word == 0x2bU);

    // A refused value leaves the radio exactly where it was. No clamping, no
    // masking the low nibbles into a shape the register happens to accept.
    RadioProfile refused = profile;
    refused.sync_word = 0xabcdU;
    assert(setProfileSyncWord(profile, 0x1425U, refused) == ProfileEditResult::OutOfRange);
    assert(refused.sync_word == 0xabcdU);

    RadioProfile fsk = profile;
    fsk.modulation = Modulation::Fsk;
    assert(setProfileSyncWord(fsk, 0x2bU, out) == ProfileEditResult::UnsupportedModulation);
}

void testPreambleEditsPinTheValueAndSurviveOtherTuning()
{
    const RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    assert(profile.preamble_symbols == 16U);
    assert(!profile.preamble_override);

    RadioProfile out{};
    assert(setProfilePreambleSymbols(profile, kMinimumPreambleSymbols - 1U, out) ==
           ProfileEditResult::OutOfRange);
    assert(setProfilePreambleSymbols(profile, 0U, out) == ProfileEditResult::OutOfRange);

    assert(setProfilePreambleSymbols(profile, kMaximumPreambleSymbols, out) ==
           ProfileEditResult::Applied);
    assert(out.preamble_symbols == kMaximumPreambleSymbols);
    assert(setProfilePreambleSymbols(profile, kMinimumPreambleSymbols, out) ==
           ProfileEditResult::Applied);
    assert(out.preamble_symbols == kMinimumPreambleSymbols);
    assert(out.preamble_override);
    assert(setProfilePreambleSymbols(out, kMinimumPreambleSymbols, out) ==
           ProfileEditResult::Unchanged);

    // Typing the derived value still pins it: the operator asked for 16, not
    // for whatever the next bandwidth change would have produced.
    RadioProfile pinned{};
    assert(setProfilePreambleSymbols(profile, 16U, pinned) == ProfileEditResult::Applied);
    assert(pinned.preamble_override);

    // Bandwidth and spreading-factor cycles leave a pinned preamble alone.
    RadioProfile tuned = cycleProfileBandwidth(pinned);
    assert(tuned.preamble_symbols == 16U);
    assert(tuned.preamble_override);
    tuned = cycleProfileSpreadingFactor(pinned);
    assert(tuned.preamble_symbols == 16U);

    // A Reticulum profile makes the difference visible: without the override
    // the preamble tracks the derived table, with it the typed value holds.
    RadioProfile reticulum = makeProfile(ProtocolId::Reticulum, 867200000U, 125000U);
    reticulum.spreading_factor = 7U;
    reticulum.preamble_symbols = derivePreambleSymbols(reticulum);
    assert(reticulum.preamble_symbols == 24U);
    assert(cycleProfileBandwidth(reticulum).preamble_symbols == 47U);

    RadioProfile held{};
    assert(setProfilePreambleSymbols(reticulum, 100U, held) == ProfileEditResult::Applied);
    assert(cycleProfileBandwidth(held).preamble_symbols == 100U);

    RadioProfile released{};
    assert(clearProfilePreambleOverride(held, released) == ProfileEditResult::Applied);
    assert(!released.preamble_override);
    assert(released.preamble_symbols == 24U);
    assert(clearProfilePreambleOverride(released, released) == ProfileEditResult::Unchanged);
}

void testPersistedValidationCoversSyncWordAndPreamble()
{
    RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    assert(isSupportedTunedProfile(profile));

    profile.sync_word = 0x1425U;
    assert(!isSupportedTunedProfile(profile));
    profile.sync_word = 0x2bU;
    assert(isSupportedTunedProfile(profile));

    // Without an override the preamble must equal the derived value.
    profile.preamble_symbols = 17U;
    assert(!isSupportedTunedProfile(profile));
    profile.preamble_override = true;
    assert(isSupportedTunedProfile(profile));
    profile.preamble_symbols = 0U;
    assert(!isSupportedTunedProfile(profile));
    profile.preamble_symbols = kMinimumPreambleSymbols;
    assert(isSupportedTunedProfile(profile));
}

void testRegionalBandsAreDeclaredNotGuessed()
{
    std::uint32_t lower = 0;
    std::uint32_t upper = 0;
    assert(!regionBandLimits(RegionCode::Unspecified, lower, upper));
    assert(!regionBandLimits(RegionCode::Count, lower, upper));
    assert(!regionBandLimits(static_cast<RegionCode>(0xffU), lower, upper));

    struct Expected {
        RegionCode region;
        const char *label;
        std::uint32_t lower_hz;
        std::uint32_t upper_hz;
    };
    const Expected expected[] = {
        {RegionCode::US915, "US915", 902000000U, 928000000U},
        {RegionCode::EU868, "EU868", 869400000U, 869650000U},
        {RegionCode::EU863, "EU863", 863000000U, 870000000U},
        {RegionCode::AU915, "AU915", 915000000U, 928000000U},
        {RegionCode::AS923, "AS923", 920000000U, 925000000U},
        {RegionCode::IN865, "IN865", 865000000U, 867000000U},
        {RegionCode::KR920, "KR920", 920000000U, 923000000U},
    };
    for (const Expected &value : expected) {
        assert(regionBandLimits(value.region, lower, upper));
        assert(lower == value.lower_hz && upper == value.upper_hz);
        assert(std::strcmp(regionLabel(value.region), value.label) == 0);
    }
    assert(std::strcmp(regionLabel(RegionCode::Unspecified), "AUTO") == 0);

    // 916 MHz is legal under both US915 and AU915 with different band edges,
    // so the declared plan decides, not the centre frequency.
    RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 916125000U, 250000U);
    profile.frequency_tuning_policy = FrequencyTuningPolicy::ExplicitSlot;
    profile.region = RegionCode::US915;
    profile.frequency_slot = 56U;
    assert(isSupportedTunedProfile(profile));
    profile.region = RegionCode::AU915;
    assert(!isSupportedTunedProfile(profile));
    profile.frequency_slot = 4U;
    assert(isSupportedTunedProfile(profile));

    // A centre outside the declared plan is rejected rather than re-homed.
    profile.region = RegionCode::EU868;
    assert(!isSupportedTunedProfile(profile));
    assert(sameProfile(profile, stepProfileFrequency(profile, 1)));

    // The US hashed-slot table does not generalise, so no other band plan may
    // claim the default-hashed policy.
    profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    profile.region = RegionCode::US915;
    assert(isSupportedTunedProfile(profile));
    profile.region = RegionCode::AU915;
    assert(!isSupportedTunedProfile(profile));
}

void testRegionalPresetsTuneInsideTheirOwnBand()
{
    struct Expected {
        std::uint16_t id;
        RegionCode region;
        std::uint32_t center_hz;
        std::uint32_t stepped_up_hz;
    };
    const Expected expected[] = {
        // EU868 is one 250 kHz slot wide, so stepping wraps onto itself.
        {6U, RegionCode::EU868, 869525000U, 869525000U},
        {7U, RegionCode::AU915, 915125000U, 915375000U},
        {8U, RegionCode::AS923, 920125000U, 920375000U},
        {9U, RegionCode::IN865, 865125000U, 865375000U},
        {10U, RegionCode::KR920, 920125000U, 920375000U},
    };
    for (const Expected &value : expected) {
        const RadioProfile *profile = findBuiltinProfile(value.id);
        assert(profile != nullptr);
        assert(profile->region == value.region);
        assert(profile->protocol_hint == ProtocolId::Meshtastic);
        assert(profile->frequency_tuning_policy == FrequencyTuningPolicy::ExplicitSlot);
        assert(profile->frequency_slot == 0U);
        assert(profile->center_frequency_hz == value.center_hz);
        assert(isSupportedTunedProfile(*profile));

        const RadioProfile up = stepProfileFrequency(*profile, 1);
        assert(up.center_frequency_hz == value.stepped_up_hz);
        assert(isSupportedTunedProfile(up));

        std::uint32_t lower = 0;
        std::uint32_t upper = 0;
        assert(regionBandLimits(value.region, lower, upper));
        const RadioProfile down = stepProfileFrequency(*profile, -1);
        assert(down.center_frequency_hz >= lower && down.center_frequency_hz <= upper);
        assert(isSupportedTunedProfile(down));
    }

    // EU868 holds a single 250 kHz slot, so widening past it has no valid
    // centre; the refusal happens at the validation boundary, not by clamping.
    const RadioProfile *eu868 = findBuiltinProfile(6U);
    assert(eu868 != nullptr);
    RadioProfile widened = cycleProfileBandwidth(*eu868);
    assert(widened.bandwidth_hz == 500000U);
    assert(!isSupportedTunedProfile(widened));
}

void testBuiltinProfileIdsAreUniqueAndPersistable()
{
    const std::size_t count = builtinProfileCount();
    assert(count == 10U);
    for (std::size_t left = 0; left < count; ++left) {
        const RadioProfile &profile = builtinProfiles()[left];
        assert(profile.name[0] != '\0');
        assert(isSupportedSyncWord(profile.sync_word));
        assert(!profile.preamble_override);
        assert(findBuiltinProfile(profile.id) == &profile);
        for (std::size_t right = left + 1U; right < count; ++right) {
            assert(profile.id != builtinProfiles()[right].id);
        }
    }
}

} // namespace

int main()
{
    testMeshtasticFrequencyStepsAndWraps();
    testMeshtasticDefaultHashedBandwidthCenters();
    testMeshCoreUsesSafeUsCenters();
    testReticulumUsesSafeEuCenters();
    testUnsupportedAndInvalidFrequencyStepsAreNoOps();
    testMeshtasticExplicitBandwidthCyclePreservesSlot();
    testBandwidthCycleDoesNotSnapDeploymentCenters();
    testSpreadingFactorCycle();
    testDerivedPreambleSymbols();
    testTuningAppliesDerivedPreambles();
    testBuiltinProfilesUseValidatedPoliciesAndPreambles();
    testCodingRateCycle();
    testNonLoRaCyclesAreNoOps();
    testPersistedProfileValidation();
    testSyncWordLimitsFollowTheSx1262Register();
    testSyncWordEditsApplyOrAreRefusedOutright();
    testPreambleEditsPinTheValueAndSurviveOtherTuning();
    testPersistedValidationCoversSyncWordAndPreamble();
    testRegionalBandsAreDeclaredNotGuessed();
    testRegionalPresetsTuneInsideTheirOwnBand();
    testBuiltinProfileIdsAreUniqueAndPersistable();
    std::puts("profile tuning tests passed");
    return 0;
}
