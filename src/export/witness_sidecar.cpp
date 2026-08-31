#include "lilyshark/export/witness_sidecar.h"

#include <cstdio>
#include <cstring>

namespace lilyshark {
namespace {

// Header: "lilyshark-witness 1 gps 18446744073709551615\n" -> 45 bytes max.
// Line: 20-digit sequence + space + 64 hex digits + newline -> 86 bytes max.
constexpr std::size_t kWitnessLineCapacity = 96;

void appendKeyHex(char *destination, const std::uint8_t key[kWitnessKeySize]) noexcept
{
    static constexpr char kHexDigits[] = "0123456789abcdef";
    for (std::size_t index = 0; index < kWitnessKeySize; ++index) {
        destination[index * 2U] = kHexDigits[key[index] >> 4U];
        destination[index * 2U + 1U] = kHexDigits[key[index] & 0x0FU];
    }
}

} // namespace

const char *witnessAnchorSourceToken(WitnessAnchorSource source) noexcept
{
    switch (source) {
    case WitnessAnchorSource::Gps: return "gps";
    }
    return "unknown";
}

WitnessSidecarWriteResult WitnessSidecarWriter::begin(WitnessAnchorSource anchor,
                                                      std::uint64_t epoch_unix_seconds,
                                                      std::uint32_t ticks_per_second) noexcept
{
    if (started_) {
        return WitnessSidecarWriteResult::AlreadyStarted;
    }
    if (failed_) {
        return WitnessSidecarWriteResult::SinkError;
    }
    if (ticks_per_second == 0U) {
        return WitnessSidecarWriteResult::InvalidAnchor;
    }

    char header[kWitnessLineCapacity]{};
    const int written = std::snprintf(header, sizeof(header), "lilyshark-witness %lu %s %llu\n",
                                      static_cast<unsigned long>(kWitnessSidecarVersion),
                                      witnessAnchorSourceToken(anchor),
                                      static_cast<unsigned long long>(epoch_unix_seconds));
    if (written <= 0 || static_cast<std::size_t>(written) >= sizeof(header)) {
        return WitnessSidecarWriteResult::InvalidAnchor;
    }
    if (!sink_.write(reinterpret_cast<const std::uint8_t *>(header),
                     static_cast<std::size_t>(written))) {
        failed_ = true;
        return WitnessSidecarWriteResult::SinkError;
    }

    epoch_unix_seconds_ = epoch_unix_seconds;
    ticks_per_second_ = ticks_per_second;
    eligible_count_ = 0;
    last_ineligibility_ = WitnessEligibility::Eligible;
    started_ = true;
    return WitnessSidecarWriteResult::Ok;
}

WitnessSidecarWriteResult WitnessSidecarWriter::write(const FrameRecord &record) noexcept
{
    if (failed_) {
        return WitnessSidecarWriteResult::SinkError;
    }
    if (!started_) {
        return WitnessSidecarWriteResult::NotStarted;
    }

    // The writer only starts with a wall-clock anchor, so has_wall_clock holds
    // for every frame it sees.
    const WitnessEligibility eligibility = witnessEligibility(record.raw, true);
    if (eligibility != WitnessEligibility::Eligible) {
        last_ineligibility_ = eligibility;
        return WitnessSidecarWriteResult::Ineligible;
    }

    const std::uint64_t unix_seconds =
        epoch_unix_seconds_ + record.raw.rf.timestamp_us / ticks_per_second_;
    std::uint8_t key[kWitnessKeySize];
    computeWitnessKey(record.raw.bytes, record.raw.captured_length,
                      record.raw.rf.center_frequency_hz, unix_seconds, key);

    char line[kWitnessLineCapacity]{};
    const int prefix = std::snprintf(line, sizeof(line), "%llu ",
                                     static_cast<unsigned long long>(record.sequence));
    if (prefix <= 0 ||
        static_cast<std::size_t>(prefix) + 2U * kWitnessKeySize + 1U >= sizeof(line)) {
        return WitnessSidecarWriteResult::SinkError;
    }
    appendKeyHex(line + prefix, key);
    const std::size_t length = static_cast<std::size_t>(prefix) + 2U * kWitnessKeySize;
    line[length] = '\n';

    if (!sink_.write(reinterpret_cast<const std::uint8_t *>(line), length + 1U)) {
        failed_ = true;
        return WitnessSidecarWriteResult::SinkError;
    }
    ++eligible_count_;
    return WitnessSidecarWriteResult::Ok;
}

} // namespace lilyshark
