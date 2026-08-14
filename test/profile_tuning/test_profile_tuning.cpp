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
    profile.preamble_symbols = 16;
    profile.sync_word = 0x1424;
    profile.spreading_factor = 11;
    profile.coding_rate_denominator = 5;
    profile.tx_power_dbm = 10;
    profile.crc_enabled = true;
    profile.implicit_header = false;
    profile.inverted_iq = true;
    return profile;
}

bool sameProfile(const RadioProfile &left, const RadioProfile &right) noexcept
{
    return left.id == right.id && std::strcmp(left.name, right.name) == 0 &&
           left.protocol_hint == right.protocol_hint && left.modulation == right.modulation &&
           left.center_frequency_hz == right.center_frequency_hz &&
           left.bandwidth_hz == right.bandwidth_hz && left.bit_rate_bps == right.bit_rate_bps &&
           left.frequency_deviation_hz == right.frequency_deviation_hz &&
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
    assert(sameProfile(before, normalized));
}

void testMeshtasticFrequencyStepsAndWraps()
{
    const RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 250000U);
    RadioProfile tuned = stepProfileFrequency(profile, 1);
    assert(tuned.center_frequency_hz == 907125000U);
    assertOnlyFrequencyChanged(profile, tuned);

    tuned = stepProfileFrequency(profile, -1);
    assert(tuned.center_frequency_hz == 906625000U);
    assertOnlyFrequencyChanged(profile, tuned);

    const RadioProfile lower = makeProfile(ProtocolId::Meshtastic, 902125000U, 250000U);
    tuned = stepProfileFrequency(lower, -1);
    assert(tuned.center_frequency_hz == 927875000U);

    const RadioProfile upper = makeProfile(ProtocolId::Meshtastic, 927875000U, 250000U);
    tuned = stepProfileFrequency(upper, 1);
    assert(tuned.center_frequency_hz == 902125000U);
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

void testBandwidthCycle()
{
    RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 906875000U, 62500U);
    constexpr std::uint32_t expected[] = {125000U, 250000U, 500000U, 62500U};
    for (const std::uint32_t value : expected) {
        const RadioProfile before = profile;
        profile = cycleProfileBandwidth(profile);
        assert(profile.bandwidth_hz == value);
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
    constexpr std::uint8_t expected[] = {8U, 9U, 10U, 11U, 12U, 7U};
    for (const std::uint8_t value : expected) {
        const RadioProfile before = profile;
        profile = cycleProfileSpreadingFactor(profile);
        assert(profile.spreading_factor == value);
        RadioProfile normalized = profile;
        normalized.spreading_factor = before.spreading_factor;
        assert(sameProfile(before, normalized));
    }

    profile.spreading_factor = 6;
    assert(cycleProfileSpreadingFactor(profile).spreading_factor == 7U);
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
    RadioProfile profile = makeProfile(ProtocolId::Meshtastic, 914125000U, 250000U);
    assert(isSupportedTunedProfile(profile));

    profile.center_frequency_hz = 902000000U;
    assert(!isSupportedTunedProfile(profile));
    profile.center_frequency_hz = 914125000U;

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
    testMeshCoreUsesSafeUsCenters();
    testReticulumUsesSafeEuCenters();
    testUnsupportedAndInvalidFrequencyStepsAreNoOps();
    testBandwidthCycle();
    testSpreadingFactorCycle();
    testCodingRateCycle();
    testNonLoRaCyclesAreNoOps();
    testPersistedProfileValidation();
    std::puts("profile tuning tests passed");
    return 0;
}
