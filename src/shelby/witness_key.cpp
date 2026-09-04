#include "lilyshark/shelby/witness_key.h"

#include "lilyshark/crypto/sha256.h"

namespace lilyshark {
namespace {

void putLe32(std::uint8_t *destination, std::uint32_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8U);
    destination[2] = static_cast<std::uint8_t>(value >> 16U);
    destination[3] = static_cast<std::uint8_t>(value >> 24U);
}

} // namespace

std::uint32_t roundWitnessFrequencyHz(std::uint32_t freq_hz) noexcept
{
    // 64-bit intermediate: freq_hz + 12,500 must not wrap near UINT32_MAX.
    // Real tunings sit below 1 GHz, far inside u32, so the final cast is safe
    // for every frequency the radio can produce.
    const std::uint64_t stepped =
        (static_cast<std::uint64_t>(freq_hz) + kWitnessFrequencyStepHz / 2U) /
        kWitnessFrequencyStepHz;
    return static_cast<std::uint32_t>(stepped * kWitnessFrequencyStepHz);
}

std::uint32_t witnessTimeBucket(std::uint64_t unix_seconds) noexcept
{
    return static_cast<std::uint32_t>(unix_seconds / kWitnessBucketSeconds);
}

WitnessEligibility witnessEligibility(const RawFrame &frame, bool has_wall_clock) noexcept
{
    // Synthetic first, matching the reference implementation: simulated frames
    // are refused, not merely skipped, so callers can report them loudly.
    if (frame.rf.origin == FrameOrigin::Synthetic) {
        return WitnessEligibility::Synthetic;
    }
    // Our own transmissions sit in the same store as everything we heard, and
    // they are not evidence of reception. Refuse them before the field checks,
    // beside the synthetic refusal, because they fail for the same reason: the
    // frame is ours, not the channel's.
    if (frame.rf.direction == FrameDirection::Transmit) {
        return WitnessEligibility::SelfTransmitted;
    }
    if (frame.rf.crc != CrcStatus::Valid) {
        return WitnessEligibility::CrcNotValid;
    }
    if (frame.captured_length < 1) {
        return WitnessEligibility::EmptyPayload;
    }
    if (frame.captured_length != frame.original_length) {
        return WitnessEligibility::Truncated;
    }
    constexpr std::uint32_t kRequired = RfFieldTimestamp | RfFieldFrequency;
    if ((frame.rf.present_fields & kRequired) != kRequired) {
        return WitnessEligibility::RequiredFieldsAbsent;
    }
    if (!has_wall_clock) {
        return WitnessEligibility::NoWallClock;
    }
    return WitnessEligibility::Eligible;
}

void computeWitnessKey(const std::uint8_t *payload, std::size_t payload_length,
                       std::uint32_t freq_hz, std::uint64_t unix_seconds,
                       std::uint8_t out_key[kWitnessKeySize]) noexcept
{
    static_assert(kWitnessKeySize == crypto::kSha256DigestSize,
                  "witness key is a raw SHA-256 digest");

    std::uint8_t tail[8];
    putLe32(tail, roundWitnessFrequencyHz(freq_hz));
    putLe32(tail + 4, witnessTimeBucket(unix_seconds));

    crypto::Sha256 hasher{};
    hasher.update(payload, payload_length);
    hasher.update(tail, sizeof(tail));
    hasher.finish(out_key);
}

const char *witnessEligibilityLabel(WitnessEligibility eligibility) noexcept
{
    switch (eligibility) {
    case WitnessEligibility::Eligible: return "eligible";
    case WitnessEligibility::Synthetic: return "synthetic";
    case WitnessEligibility::CrcNotValid: return "crc_not_valid";
    case WitnessEligibility::EmptyPayload: return "empty_payload";
    case WitnessEligibility::Truncated: return "truncated";
    case WitnessEligibility::RequiredFieldsAbsent: return "required_fields_absent";
    case WitnessEligibility::NoWallClock: return "no_wall_clock";
    case WitnessEligibility::SelfTransmitted: return "self_transmitted";
    }
    return "unknown";
}

} // namespace lilyshark
