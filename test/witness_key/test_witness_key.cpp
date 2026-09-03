#include "lilyshark/shelby/witness_key.h"

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

using namespace lilyshark;

// WITNESS-VECTOR-1, frozen in docs/protocol/field-receipts.md and shared
// byte-exact with scripts/field_receipts.py and the webapp.
constexpr std::uint32_t kVectorFreqHz = 906862500U;   // exactly half-way
constexpr std::uint32_t kVectorRoundedFreqHz = 906875000U;
constexpr std::uint64_t kVectorUnixSeconds = 1893456000ULL; // 2030-01-01T00:00:00Z
constexpr std::uint32_t kVectorTimeBucket = 31557600U;
constexpr char kVectorKeyHex[] =
    "94ed6915ddbbfb1b5c2557f5ecb61cfe3783f40be380323af53beb8c3b610125";

void fillVectorPayload(std::uint8_t payload[32])
{
    for (std::size_t index = 0; index < 32; ++index) {
        payload[index] = static_cast<std::uint8_t>(0xA0 + index);
    }
}

void keyHex(const std::uint8_t key[kWitnessKeySize], char out[2 * kWitnessKeySize + 1])
{
    for (std::size_t index = 0; index < kWitnessKeySize; ++index) {
        std::snprintf(out + index * 2, 3, "%02x", key[index]);
    }
}

void testWitnessVector1ByteExact()
{
    std::uint8_t payload[32];
    fillVectorPayload(payload);

    assert(roundWitnessFrequencyHz(kVectorFreqHz) == kVectorRoundedFreqHz);
    assert(witnessTimeBucket(kVectorUnixSeconds) == kVectorTimeBucket);

    std::uint8_t key[kWitnessKeySize]{};
    computeWitnessKey(payload, sizeof(payload), kVectorFreqHz, kVectorUnixSeconds, key);
    char hex[2 * kWitnessKeySize + 1]{};
    keyHex(key, hex);
    // Printed so the runner can diff it against
    // `python3 scripts/field_receipts.py vector`.
    std::printf("WITNESS-VECTOR-1 key: %s\n", hex);
    assert(std::strcmp(hex, kVectorKeyHex) == 0);
}

void testFrequencyRoundingHalfUp()
{
    // On-step values are fixed points.
    assert(roundWitnessFrequencyHz(906875000U) == 906875000U);
    assert(roundWitnessFrequencyHz(0U) == 0U);
    // Just below half-way rounds down; exactly half-way rounds up (the vector
    // pins this); just above half-way rounds up.
    assert(roundWitnessFrequencyHz(906862499U) == 906850000U);
    assert(roundWitnessFrequencyHz(906862500U) == 906875000U);
    assert(roundWitnessFrequencyHz(906862501U) == 906875000U);
    // One below and above a step edge.
    assert(roundWitnessFrequencyHz(906874999U) == 906875000U);
    assert(roundWitnessFrequencyHz(906887499U) == 906875000U);
    assert(roundWitnessFrequencyHz(12499U) == 0U);
    assert(roundWitnessFrequencyHz(12500U) == 25000U);
    // The +12,500 offset must not wrap 32-bit arithmetic near UINT32_MAX.
    assert(roundWitnessFrequencyHz(4294950000U) == 4294950000U);
}

void testTimeBucketFloors()
{
    assert(witnessTimeBucket(0ULL) == 0U);
    assert(witnessTimeBucket(59ULL) == 0U);
    assert(witnessTimeBucket(60ULL) == 1U);
    assert(witnessTimeBucket(kVectorUnixSeconds + 59ULL) == kVectorTimeBucket);
    assert(witnessTimeBucket(kVectorUnixSeconds + 60ULL) == kVectorTimeBucket + 1U);
}

void testKeyDependsOnEveryInput()
{
    std::uint8_t payload[32];
    fillVectorPayload(payload);

    std::uint8_t base[kWitnessKeySize]{};
    computeWitnessKey(payload, sizeof(payload), kVectorFreqHz, kVectorUnixSeconds, base);

    // A different payload byte changes the key.
    payload[0] ^= 0x01U;
    std::uint8_t changed[kWitnessKeySize]{};
    computeWitnessKey(payload, sizeof(payload), kVectorFreqHz, kVectorUnixSeconds, changed);
    assert(std::memcmp(base, changed, kWitnessKeySize) != 0);
    payload[0] ^= 0x01U;

    // A different 25 kHz step changes the key; a different offset inside the
    // same step does not (crystal offset between receivers must cancel).
    computeWitnessKey(payload, sizeof(payload), kVectorFreqHz + kWitnessFrequencyStepHz,
                      kVectorUnixSeconds, changed);
    assert(std::memcmp(base, changed, kWitnessKeySize) != 0);
    computeWitnessKey(payload, sizeof(payload), kVectorFreqHz + 100U, kVectorUnixSeconds,
                      changed);
    assert(std::memcmp(base, changed, kWitnessKeySize) == 0);

    // A different 60 s bucket changes the key; the same bucket does not.
    computeWitnessKey(payload, sizeof(payload), kVectorFreqHz, kVectorUnixSeconds + 60ULL,
                      changed);
    assert(std::memcmp(base, changed, kWitnessKeySize) != 0);
    computeWitnessKey(payload, sizeof(payload), kVectorFreqHz, kVectorUnixSeconds + 59ULL,
                      changed);
    assert(std::memcmp(base, changed, kWitnessKeySize) == 0);
}

RawFrame eligibleFrame()
{
    RawFrame frame{};
    std::uint8_t payload[32];
    fillVectorPayload(payload);
    assert(frame.assignPayload(payload, sizeof(payload)));
    frame.rf.timestamp_us = 5000000ULL;
    frame.rf.present_fields = RfFieldTimestamp | RfFieldFrequency;
    frame.rf.center_frequency_hz = kVectorFreqHz;
    frame.rf.crc = CrcStatus::Valid;
    frame.rf.origin = FrameOrigin::Radio;
    return frame;
}

// The spec's numbered eligibility rules, each violated in isolation.
void testEligibilityMatrix()
{
    assert(witnessEligibility(eligibleFrame(), true) == WitnessEligibility::Eligible);

    // Rule 5: synthetic frames are refused — and reported first, so tooling
    // can be loud about them even when other rules also fail.
    RawFrame synthetic = eligibleFrame();
    synthetic.rf.origin = FrameOrigin::Synthetic;
    assert(witnessEligibility(synthetic, true) == WitnessEligibility::Synthetic);
    synthetic.rf.crc = CrcStatus::Invalid;
    assert(witnessEligibility(synthetic, true) == WitnessEligibility::Synthetic);

    // Rule 1: every non-valid CRC state yields no key.
    RawFrame crc = eligibleFrame();
    crc.rf.crc = CrcStatus::Unknown;
    assert(witnessEligibility(crc, true) == WitnessEligibility::CrcNotValid);
    crc.rf.crc = CrcStatus::NotPresent;
    assert(witnessEligibility(crc, true) == WitnessEligibility::CrcNotValid);
    crc.rf.crc = CrcStatus::Invalid;
    assert(witnessEligibility(crc, true) == WitnessEligibility::CrcNotValid);

    // Rule 2: empty and truncated payloads.
    RawFrame empty = eligibleFrame();
    empty.captured_length = 0;
    empty.original_length = 0;
    assert(witnessEligibility(empty, true) == WitnessEligibility::EmptyPayload);
    RawFrame truncated = eligibleFrame();
    truncated.original_length = static_cast<std::uint16_t>(truncated.captured_length + 8U);
    assert(witnessEligibility(truncated, true) == WitnessEligibility::Truncated);

    // Rule 3: both present bits are required, individually.
    RawFrame no_timestamp = eligibleFrame();
    no_timestamp.rf.present_fields = RfFieldFrequency;
    assert(witnessEligibility(no_timestamp, true) == WitnessEligibility::RequiredFieldsAbsent);
    RawFrame no_frequency = eligibleFrame();
    no_frequency.rf.present_fields = RfFieldTimestamp;
    assert(witnessEligibility(no_frequency, true) == WitnessEligibility::RequiredFieldsAbsent);
    // Unrelated present bits do not satisfy the rule.
    RawFrame other_bits = eligibleFrame();
    other_bits.rf.present_fields = RfFieldRssi | RfFieldSnr;
    assert(witnessEligibility(other_bits, true) == WitnessEligibility::RequiredFieldsAbsent);

    // Rule 4: no wall-clock anchor, checked last so every structural problem
    // outranks the missing clock in diagnostics.
    assert(witnessEligibility(eligibleFrame(), false) == WitnessEligibility::NoWallClock);

    // Labels match scripts/field_receipts.py's reason tokens.
    assert(std::strcmp(witnessEligibilityLabel(WitnessEligibility::Synthetic), "synthetic") == 0);
    assert(std::strcmp(witnessEligibilityLabel(WitnessEligibility::CrcNotValid),
                       "crc_not_valid") == 0);
    assert(std::strcmp(witnessEligibilityLabel(WitnessEligibility::EmptyPayload),
                       "empty_payload") == 0);
    assert(std::strcmp(witnessEligibilityLabel(WitnessEligibility::Truncated), "truncated") == 0);
    assert(std::strcmp(witnessEligibilityLabel(WitnessEligibility::RequiredFieldsAbsent),
                       "required_fields_absent") == 0);
    assert(std::strcmp(witnessEligibilityLabel(WitnessEligibility::NoWallClock),
                       "no_wall_clock") == 0);
}

} // namespace

int main()
{
    testWitnessVector1ByteExact();
    testFrequencyRoundingHalfUp();
    testTimeBucketFloors();
    testKeyDependsOnEveryInput();
    testEligibilityMatrix();
    std::puts("witness key tests passed");
    return 0;
}
