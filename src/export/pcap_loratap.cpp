#include "lilyshark/export/pcap_loratap.h"

#include <cstdint>
#include <limits>

namespace lilyshark {
namespace {

constexpr std::size_t kPcapGlobalHeaderSize = 24;
constexpr std::size_t kPcapRecordHeaderSize = 16;

void putLe16(std::uint8_t *destination, std::uint16_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8U);
}

void putLe32(std::uint8_t *destination, std::uint32_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8U);
    destination[2] = static_cast<std::uint8_t>(value >> 16U);
    destination[3] = static_cast<std::uint8_t>(value >> 24U);
}

void putBe16(std::uint8_t *destination, std::uint16_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value >> 8U);
    destination[1] = static_cast<std::uint8_t>(value);
}

void putBe32(std::uint8_t *destination, std::uint32_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value >> 24U);
    destination[1] = static_cast<std::uint8_t>(value >> 16U);
    destination[2] = static_cast<std::uint8_t>(value >> 8U);
    destination[3] = static_cast<std::uint8_t>(value);
}

std::int32_t divideRounded(std::int32_t numerator, std::int32_t denominator) noexcept
{
    const std::int32_t half = denominator / 2;
    return numerator >= 0 ? (numerator + half) / denominator : (numerator - half) / denominator;
}

std::uint8_t encodeRssi(const RfMetadata &metadata) noexcept
{
    if (metadata.direction == FrameDirection::Transmit || !metadata.hasField(RfFieldRssi)) {
        return 255;
    }

    std::int32_t encoded = divideRounded(metadata.rssi_dbm_x10, 10) + 139;
    if (encoded < 0) {
        encoded = 0;
    } else if (encoded > 254) {
        encoded = 254;
    }
    return static_cast<std::uint8_t>(encoded);
}

std::uint8_t encodeSnr(const RfMetadata &metadata) noexcept
{
    if (!metadata.hasField(RfFieldSnr)) {
        return 0;
    }

    std::int32_t quarter_db = divideRounded(static_cast<std::int32_t>(metadata.snr_db_x10) * 2, 5);
    if (quarter_db < std::numeric_limits<std::int8_t>::min()) {
        quarter_db = std::numeric_limits<std::int8_t>::min();
    } else if (quarter_db > std::numeric_limits<std::int8_t>::max()) {
        quarter_db = std::numeric_limits<std::int8_t>::max();
    }
    return static_cast<std::uint8_t>(static_cast<std::int8_t>(quarter_db));
}

std::uint8_t encodeSyncWord(std::uint16_t sync_word) noexcept
{
    if (sync_word <= 0xffU) {
        return static_cast<std::uint8_t>(sync_word);
    }

    const std::uint8_t high = static_cast<std::uint8_t>(sync_word >> 8U);
    const std::uint8_t low = static_cast<std::uint8_t>(sync_word);
    return static_cast<std::uint8_t>((high & 0xf0U) | ((low & 0xf0U) >> 4U));
}

bool bandwidthCode(std::uint32_t bandwidth_hz, std::uint8_t &code) noexcept
{
    constexpr std::uint32_t kBandwidthStepHz = 125000;
    if (bandwidth_hz == 0 || bandwidth_hz % kBandwidthStepHz != 0) {
        return false;
    }

    const std::uint32_t steps = bandwidth_hz / kBandwidthStepHz;
    if (steps == 0 || steps > std::numeric_limits<std::uint8_t>::max()) {
        return false;
    }
    code = static_cast<std::uint8_t>(steps);
    return true;
}

} // namespace

PcapWriteResult PcapLoraTapWriter::begin() noexcept
{
    if (started_) {
        return PcapWriteResult::AlreadyStarted;
    }
    if (failed_) {
        return PcapWriteResult::SinkError;
    }

    std::uint8_t header[kPcapGlobalHeaderSize]{};
    putLe32(header + 0, 0xa1b2c3d4U);
    putLe16(header + 4, 2);
    putLe16(header + 6, 4);
    putLe32(header + 8, 0);
    putLe32(header + 12, 0);
    putLe32(header + 16, kPcapCaptureLength);
    putLe32(header + 20, kPcapLoraTapLinkType);

    if (!sink_.write(header, sizeof(header))) {
        failed_ = true;
        return PcapWriteResult::SinkError;
    }
    started_ = true;
    return PcapWriteResult::Ok;
}

PcapWriteResult PcapLoraTapWriter::write(const RawFrame &frame) noexcept
{
    if (failed_) {
        return PcapWriteResult::SinkError;
    }
    if (!started_) {
        return PcapWriteResult::NotStarted;
    }

    std::uint8_t bandwidth = 0;
    if (!bandwidthCode(frame.rf.bandwidth_hz, bandwidth)) {
        return PcapWriteResult::InvalidBandwidth;
    }

    const std::uint64_t timestamp_seconds = frame.rf.timestamp_us / 1000000U;
    const std::uint32_t seconds = timestamp_seconds > std::numeric_limits<std::uint32_t>::max()
                                      ? std::numeric_limits<std::uint32_t>::max()
                                      : static_cast<std::uint32_t>(timestamp_seconds);
    const std::uint32_t microseconds = static_cast<std::uint32_t>(frame.rf.timestamp_us % 1000000U);
    const std::uint32_t captured_length =
        static_cast<std::uint32_t>(kLoraTapV0HeaderSize + frame.captured_length);
    const std::uint32_t original_length =
        static_cast<std::uint32_t>(kLoraTapV0HeaderSize + frame.original_length);

    std::uint8_t prefix[kPcapRecordHeaderSize + kLoraTapV0HeaderSize]{};
    putLe32(prefix + 0, seconds);
    putLe32(prefix + 4, microseconds);
    putLe32(prefix + 8, captured_length);
    putLe32(prefix + 12, original_length);

    std::uint8_t *loratap = prefix + kPcapRecordHeaderSize;
    loratap[0] = 0;
    loratap[1] = 0;
    putBe16(loratap + 2, static_cast<std::uint16_t>(kLoraTapV0HeaderSize));
    putBe32(loratap + 4, frame.rf.center_frequency_hz);
    loratap[8] = bandwidth;
    loratap[9] = frame.rf.spreading_factor;
    loratap[10] = encodeRssi(frame.rf);
    loratap[11] = 255;
    loratap[12] = 255;
    loratap[13] = encodeSnr(frame.rf);
    loratap[14] = encodeSyncWord(frame.rf.sync_word);

    if (!sink_.write(prefix, sizeof(prefix)) ||
        (frame.captured_length != 0 && !sink_.write(frame.bytes, frame.captured_length))) {
        failed_ = true;
        return PcapWriteResult::SinkError;
    }
    return PcapWriteResult::Ok;
}

} // namespace lilyshark
