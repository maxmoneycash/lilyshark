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
    std::puts("profile tuning tests passed");
    return 0;
}
