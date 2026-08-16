#include "lilyshark/export/lilyshark_capture.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

using namespace lilyshark;

class FixedSink final : public ByteSink
{
  public:
    explicit FixedSink(std::size_t fail_on_write = 0) noexcept : fail_on_write_(fail_on_write) {}

    bool write(const std::uint8_t *data, std::size_t length) noexcept override
    {
        ++write_count_;
        last_write_length_ = length;
        if (write_count_ == fail_on_write_) {
            return false;
        }
        if ((data == nullptr && length != 0) || size_ + length > bytes_.size()) {
            return false;
        }
        if (length != 0) {
            std::memcpy(bytes_.data() + size_, data, length);
            size_ += length;
        }
        return true;
    }

    const std::uint8_t *data() const noexcept { return bytes_.data(); }
    std::size_t size() const noexcept { return size_; }
    std::size_t writeCount() const noexcept { return write_count_; }
    std::size_t lastWriteLength() const noexcept { return last_write_length_; }

  private:
    std::array<std::uint8_t, 512> bytes_{};
    std::size_t size_ = 0;
    std::size_t fail_on_write_ = 0;
    std::size_t write_count_ = 0;
    std::size_t last_write_length_ = 0;
};

FrameRecord makeRecord()
{
    FrameRecord record{};
    record.sequence = 0x0102030405060708ULL;
    const std::uint8_t payload[] = {0xde, 0xad, 0xbe};
    assert(record.raw.assignPayload(payload, sizeof(payload)));
    record.raw.original_length = 5;
    record.raw.rf.timestamp_us = 0x1112131415161718ULL;
    record.raw.rf.present_fields = 0x21222324U;
    record.raw.rf.center_frequency_hz = 0x31323334U;
    record.raw.rf.bandwidth_hz = 62500U;
    record.raw.rf.bit_rate_bps = 0x41424344U;
    record.raw.rf.frequency_deviation_hz = 0x51525354U;
    record.raw.rf.airtime_us = 0x61626364U;
    record.raw.rf.frequency_error_hz = -2;
    record.raw.rf.rssi_dbm_x10 = -987;
    record.raw.rf.snr_db_x10 = -72;
    record.raw.rf.preamble_symbols = 0x7172U;
    record.raw.rf.sync_word = 0x1424U;
    record.raw.rf.profile_id = 0x8182U;
    record.raw.rf.radio_status = -3;
    record.raw.rf.tx_power_dbm = -4;
    record.raw.rf.spreading_factor = 7;
    record.raw.rf.coding_rate_denominator = 5;
    record.raw.rf.channel_index = 9;
    record.raw.rf.radio_index = 1;
    record.raw.rf.modulation = Modulation::LoRa;
    record.raw.rf.direction = FrameDirection::Receive;
    record.raw.rf.crc = CrcStatus::Invalid;
    record.raw.rf.implicit_header = true;
    record.raw.rf.inverted_iq = true;
    return record;
}

void expectBytes(const FixedSink &sink, const std::uint8_t *expected, std::size_t length)
{
    assert(sink.size() == length);
    assert(std::memcmp(sink.data(), expected, length) == 0);
}

void testExactVersionOneBytesAnd62500HzBandwidth()
{
    FixedSink sink{};
    LilysharkCaptureWriter writer(sink);
    assert(writer.write(makeRecord()) == LilysharkCaptureWriteResult::NotStarted);
    assert(writer.begin() == LilysharkCaptureWriteResult::Ok);
    assert(writer.begin() == LilysharkCaptureWriteResult::AlreadyStarted);
    assert(writer.write(makeRecord()) == LilysharkCaptureWriteResult::Ok);
    assert(sink.writeCount() == 2);

    const std::uint8_t expected[] = {
        // File header.
        0x4c, 0x53, 0x43, 0x50, 0x01, 0x00, 0x00, 0x00,
        0x18, 0x00, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00,
        // Record identity, lengths, and sequence.
        0x4c, 0x53, 0x46, 0x52, 0x50, 0x00, 0x01, 0x00,
        0x03, 0x00, 0x05, 0x00, 0x08, 0x07, 0x06, 0x05,
        0x04, 0x03, 0x02, 0x01,
        // Timestamp, presence mask, frequency, and exact 62.5 kHz bandwidth.
        0x18, 0x17, 0x16, 0x15, 0x14, 0x13, 0x12, 0x11,
        0x24, 0x23, 0x22, 0x21, 0x34, 0x33, 0x32, 0x31,
        0x24, 0xf4, 0x00, 0x00,
        // Bit rate, deviation, airtime, and signed frequency error.
        0x44, 0x43, 0x42, 0x41, 0x54, 0x53, 0x52, 0x51,
        0x64, 0x63, 0x62, 0x61, 0xfe, 0xff, 0xff, 0xff,
        // RSSI, SNR, preamble, sync, profile, and radio status.
        0x25, 0xfc, 0xb8, 0xff, 0x72, 0x71, 0x24, 0x14,
        0x82, 0x81, 0xfd, 0xff,
        // TX power, SF, CR, channel, radio, modulation, direction, CRC, flags.
        0xfc, 0x07, 0x05, 0x09, 0x01, 0x01, 0x01, 0x03,
        0x03, 0x00, 0x00, 0x00,
        // Captured RF bytes are unchanged.
        0xde, 0xad, 0xbe,
    };
    expectBytes(sink, expected, sizeof(expected));
}

void testBareFrameUsesZeroSequence()
{
    FixedSink sink{};
    LilysharkCaptureWriter writer(sink);
    assert(writer.begin() == LilysharkCaptureWriteResult::Ok);
    const FrameRecord record = makeRecord();
    assert(writer.write(record.raw) == LilysharkCaptureWriteResult::Ok);
    for (std::size_t offset = 24 + 12; offset < 24 + 20; ++offset) {
        assert(sink.data()[offset] == 0);
    }
}

void testInvalidFrameDoesNotWritePartialRecord()
{
    FixedSink sink{};
    LilysharkCaptureWriter writer(sink);
    assert(writer.begin() == LilysharkCaptureWriteResult::Ok);
    const std::size_t header_size = sink.size();

    RawFrame frame = makeRecord().raw;
    frame.original_length = frame.captured_length - 1;
    assert(writer.write(frame) == LilysharkCaptureWriteResult::InvalidFrame);
    assert(sink.size() == header_size);
    assert(sink.writeCount() == 1);

    frame = makeRecord().raw;
    frame.captured_length = static_cast<std::uint16_t>(kMaxFrameBytes + 1);
    frame.original_length = frame.captured_length;
    assert(writer.write(frame) == LilysharkCaptureWriteResult::InvalidFrame);
    assert(sink.size() == header_size);
    assert(sink.writeCount() == 1);
}

void testFailedRecordWriteLeavesOnlyFileHeader()
{
    FixedSink sink{2};
    LilysharkCaptureWriter writer(sink);
    assert(writer.begin() == LilysharkCaptureWriteResult::Ok);
    const std::size_t header_size = sink.size();

    RawFrame frame = makeRecord().raw;
    frame.captured_length = static_cast<std::uint16_t>(kMaxFrameBytes);
    frame.original_length = frame.captured_length;
    assert(writer.write(frame) == LilysharkCaptureWriteResult::SinkError);

    assert(sink.writeCount() == 2);
    assert(sink.lastWriteLength() == kLilysharkCaptureRecordHeaderSize + kMaxFrameBytes);
    assert(sink.size() == header_size);
    assert(writer.failed());
    assert(writer.write(frame) == LilysharkCaptureWriteResult::SinkError);
    assert(sink.writeCount() == 2);

    writer.reset();
    assert(!writer.started());
    assert(!writer.failed());
    assert(writer.begin() == LilysharkCaptureWriteResult::Ok);
}

} // namespace

int main()
{
    testExactVersionOneBytesAnd62500HzBandwidth();
    testBareFrameUsesZeroSequence();
    testInvalidFrameDoesNotWritePartialRecord();
    testFailedRecordWriteLeavesOnlyFileHeader();
    std::puts("Lilyshark capture tests passed");
    return 0;
}
