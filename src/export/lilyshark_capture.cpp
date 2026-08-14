#include "lilyshark/export/lilyshark_capture.h"

#include <cstdint>
#include <cstring>

namespace lilyshark {
namespace {

static_assert(static_cast<std::uint8_t>(Modulation::Unknown) == 0);
static_assert(static_cast<std::uint8_t>(Modulation::LoRa) == 1);
static_assert(static_cast<std::uint8_t>(Modulation::Fsk) == 2);
static_assert(static_cast<std::uint8_t>(FrameDirection::Unknown) == 0);
static_assert(static_cast<std::uint8_t>(FrameDirection::Receive) == 1);
static_assert(static_cast<std::uint8_t>(FrameDirection::Transmit) == 2);
static_assert(static_cast<std::uint8_t>(CrcStatus::Unknown) == 0);
static_assert(static_cast<std::uint8_t>(CrcStatus::NotPresent) == 1);
static_assert(static_cast<std::uint8_t>(CrcStatus::Valid) == 2);
static_assert(static_cast<std::uint8_t>(CrcStatus::Invalid) == 3);
static_assert(RfFieldTimestamp == (1U << 0));
static_assert(RfFieldFrequency == (1U << 1));
static_assert(RfFieldBandwidth == (1U << 2));
static_assert(RfFieldAirtime == (1U << 3));
static_assert(RfFieldFrequencyError == (1U << 4));
static_assert(RfFieldRssi == (1U << 5));
static_assert(RfFieldSnr == (1U << 6));
static_assert(RfFieldTxPower == (1U << 7));
static_assert(RfFieldPreamble == (1U << 8));
static_assert(RfFieldSyncWord == (1U << 9));
static_assert(RfFieldProfile == (1U << 10));
static_assert(RfFieldSpreadingFactor == (1U << 11));
static_assert(RfFieldCodingRate == (1U << 12));
static_assert(RfFieldChannel == (1U << 13));
static_assert(RfFieldRadioStatus == (1U << 14));
static_assert(RfFieldBitRate == (1U << 15));
static_assert(RfFieldFrequencyDeviation == (1U << 16));

constexpr std::size_t kLilysharkCaptureRecordBufferSize =
    kLilysharkCaptureRecordHeaderSize + kMaxFrameBytes;

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

void putLe64(std::uint8_t *destination, std::uint64_t value) noexcept
{
    putLe32(destination, static_cast<std::uint32_t>(value));
    putLe32(destination + 4, static_cast<std::uint32_t>(value >> 32U));
}

std::uint8_t metadataFlags(const RfMetadata &metadata) noexcept
{
    constexpr std::uint8_t kImplicitHeader = 1U << 0;
    constexpr std::uint8_t kInvertedIq = 1U << 1;
    return static_cast<std::uint8_t>((metadata.implicit_header ? kImplicitHeader : 0U) |
                                     (metadata.inverted_iq ? kInvertedIq : 0U));
}

} // namespace

LilysharkCaptureWriteResult LilysharkCaptureWriter::begin() noexcept
{
    if (started_) {
        return LilysharkCaptureWriteResult::AlreadyStarted;
    }
    if (failed_) {
        return LilysharkCaptureWriteResult::SinkError;
    }

    std::uint8_t header[kLilysharkCaptureFileHeaderSize]{};
    header[0] = 'L';
    header[1] = 'S';
    header[2] = 'C';
    header[3] = 'P';
    putLe16(header + 4, 1); // Format major version.
    putLe16(header + 6, 0); // Format minor version.
    putLe16(header + 8, static_cast<std::uint16_t>(kLilysharkCaptureFileHeaderSize));
    putLe16(header + 10, static_cast<std::uint16_t>(kLilysharkCaptureRecordHeaderSize));
    putLe32(header + 12, 0);       // File flags, reserved for v1 extensions.
    putLe32(header + 16, 1000000); // timestamp_us ticks per second.
    putLe32(header + 20, 0);       // Reserved; writers must emit zero.

    if (!sink_.write(header, sizeof(header))) {
        failed_ = true;
        return LilysharkCaptureWriteResult::SinkError;
    }
    started_ = true;
    return LilysharkCaptureWriteResult::Ok;
}

LilysharkCaptureWriteResult LilysharkCaptureWriter::write(const RawFrame &frame) noexcept
{
    return writeRecord(frame, 0);
}

LilysharkCaptureWriteResult LilysharkCaptureWriter::write(const FrameRecord &record) noexcept
{
    return writeRecord(record.raw, record.sequence);
}

LilysharkCaptureWriteResult LilysharkCaptureWriter::writeRecord(const RawFrame &frame,
                                                                 std::uint64_t sequence) noexcept
{
    if (failed_) {
        return LilysharkCaptureWriteResult::SinkError;
    }
    if (!started_) {
        return LilysharkCaptureWriteResult::NotStarted;
    }
    if (frame.captured_length > kMaxFrameBytes || frame.original_length < frame.captured_length) {
        return LilysharkCaptureWriteResult::InvalidFrame;
    }

    std::uint8_t record[kLilysharkCaptureRecordBufferSize]{};
    record[0] = 'L';
    record[1] = 'S';
    record[2] = 'F';
    record[3] = 'R';
    putLe16(record + 4, static_cast<std::uint16_t>(kLilysharkCaptureRecordHeaderSize));
    putLe16(record + 6, 1); // Record layout version.
    putLe16(record + 8, frame.captured_length);
    putLe16(record + 10, frame.original_length);
    putLe64(record + 12, sequence);
    putLe64(record + 20, frame.rf.timestamp_us);
    putLe32(record + 28, frame.rf.present_fields);
    putLe32(record + 32, frame.rf.center_frequency_hz);
    putLe32(record + 36, frame.rf.bandwidth_hz);
    putLe32(record + 40, frame.rf.bit_rate_bps);
    putLe32(record + 44, frame.rf.frequency_deviation_hz);
    putLe32(record + 48, frame.rf.airtime_us);
    putLe32(record + 52, static_cast<std::uint32_t>(frame.rf.frequency_error_hz));
    putLe16(record + 56, static_cast<std::uint16_t>(frame.rf.rssi_dbm_x10));
    putLe16(record + 58, static_cast<std::uint16_t>(frame.rf.snr_db_x10));
    putLe16(record + 60, frame.rf.preamble_symbols);
    putLe16(record + 62, frame.rf.sync_word);
    putLe16(record + 64, frame.rf.profile_id);
    putLe16(record + 66, static_cast<std::uint16_t>(frame.rf.radio_status));
    record[68] = static_cast<std::uint8_t>(frame.rf.tx_power_dbm);
    record[69] = frame.rf.spreading_factor;
    record[70] = frame.rf.coding_rate_denominator;
    record[71] = frame.rf.channel_index;
    record[72] = frame.rf.radio_index;
    record[73] = static_cast<std::uint8_t>(frame.rf.modulation);
    record[74] = static_cast<std::uint8_t>(frame.rf.direction);
    record[75] = static_cast<std::uint8_t>(frame.rf.crc);
    record[76] = metadataFlags(frame.rf);
    // Bytes 77..79 are reserved and remain zero.

    if (frame.captured_length != 0) {
        std::memcpy(record + kLilysharkCaptureRecordHeaderSize, frame.bytes,
                    frame.captured_length);
    }
    const std::size_t record_size = kLilysharkCaptureRecordHeaderSize + frame.captured_length;
    if (!sink_.write(record, record_size)) {
        failed_ = true;
        return LilysharkCaptureWriteResult::SinkError;
    }
    return LilysharkCaptureWriteResult::Ok;
}

} // namespace lilyshark
