#include "lilyshark/export/pcap_loratap.h"

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
    std::array<std::uint8_t, 1024> bytes_{};
    std::size_t size_ = 0;
    std::size_t fail_on_write_ = 0;
    std::size_t write_count_ = 0;
    std::size_t last_write_length_ = 0;
};

void expectBytes(const FixedSink &sink, const std::uint8_t *expected, std::size_t length)
{
    assert(sink.size() == length);
    assert(std::memcmp(sink.data(), expected, length) == 0);
}

RawFrame makeFrame()
{
    RawFrame frame{};
    const std::uint8_t payload[] = {0xde, 0xad, 0xbe};
    assert(frame.assignPayload(payload, sizeof(payload)));
    frame.rf.timestamp_us = 1234567;
    frame.rf.center_frequency_hz = 915000000;
    frame.rf.bandwidth_hz = 250000;
    frame.rf.spreading_factor = 10;
    frame.rf.rssi_dbm_x10 = -1000;
    frame.rf.snr_db_x10 = -70;
    frame.rf.sync_word = 0x2b;
    frame.rf.direction = FrameDirection::Receive;
    frame.rf.present_fields = RfFieldTimestamp | RfFieldFrequency | RfFieldBandwidth |
                              RfFieldSpreadingFactor | RfFieldRssi | RfFieldSnr | RfFieldSyncWord;
    return frame;
}

void testExactGlobalHeaderAndPacketBytes()
{
    FixedSink sink{};
    PcapLoraTapWriter writer(sink);
    assert(writer.write(makeFrame()) == PcapWriteResult::NotStarted);
    assert(writer.begin() == PcapWriteResult::Ok);
    assert(writer.begin() == PcapWriteResult::AlreadyStarted);
    assert(writer.write(makeFrame()) == PcapWriteResult::Ok);
    assert(sink.writeCount() == 2);

    const std::uint8_t expected[] = {
        // Classic PCAP, little endian, v2.4, snaplen 270, DLT_LORATAP 270.
        0xd4, 0xc3, 0xb2, 0xa1, 0x02, 0x00, 0x04, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x0e, 0x01, 0x00, 0x00, 0x0e, 0x01, 0x00, 0x00,
        // Record header: 1.234567 seconds; 18 captured/original bytes.
        0x01, 0x00, 0x00, 0x00, 0x47, 0x94, 0x03, 0x00,
        0x12, 0x00, 0x00, 0x00, 0x12, 0x00, 0x00, 0x00,
        // LoRaTap v0, big endian fields: 915 MHz, BW 250k, SF10.
        0x00, 0x00, 0x00, 0x0f, 0x36, 0x89, 0xca, 0xc0,
        0x02, 0x0a, 0x27, 0xff, 0xff, 0xe4, 0x2b,
        // Original RF payload, unchanged.
        0xde, 0xad, 0xbe,
    };
    expectBytes(sink, expected, sizeof(expected));
}

void testFrameRecordAndOriginalLength()
{
    FixedSink sink{};
    PcapLoraTapWriter writer(sink);
    assert(writer.begin() == PcapWriteResult::Ok);

    FrameRecord record{};
    record.raw = makeFrame();
    record.raw.captured_length = 2;
    record.raw.original_length = 5;
    assert(writer.write(record) == PcapWriteResult::Ok);

    // PCAP record captured length is 15 + 2, original length is 15 + 5.
    assert(sink.size() == 24 + 16 + 15 + 2);
    assert(sink.data()[24 + 8] == 17);
    assert(sink.data()[24 + 12] == 20);
    assert(sink.data()[sink.size() - 2] == 0xde);
    assert(sink.data()[sink.size() - 1] == 0xad);
}

void testUnknownRssiNormalizedSyncAndSnrClamping()
{
    FixedSink sink{};
    PcapLoraTapWriter writer(sink);
    assert(writer.begin() == PcapWriteResult::Ok);

    RawFrame frame = makeFrame();
    frame.rf.present_fields &= ~static_cast<std::uint32_t>(RfFieldRssi);
    frame.rf.snr_db_x10 = 1000;
    frame.rf.sync_word = 0x1424;
    assert(writer.write(frame) == PcapWriteResult::Ok);

    const std::size_t loratap = 24 + 16;
    assert(sink.data()[loratap + 10] == 255);
    assert(sink.data()[loratap + 13] == 0x7f);
    assert(sink.data()[loratap + 14] == 0x12);

    frame.rf.present_fields |= RfFieldRssi;
    frame.rf.rssi_dbm_x10 = 2000;
    frame.rf.snr_db_x10 = -1000;
    assert(writer.write(frame) == PcapWriteResult::Ok);
    const std::size_t second_loratap = 24 + (16 + 15 + 3) + 16;
    assert(sink.data()[second_loratap + 10] == 254);
    assert(sink.data()[second_loratap + 13] == 0x80);
}

void testMalformedBandwidthWritesNothing()
{
    FixedSink sink{};
    PcapLoraTapWriter writer(sink);
    assert(writer.begin() == PcapWriteResult::Ok);
    const std::size_t header_size = sink.size();

    RawFrame frame = makeFrame();
    frame.rf.bandwidth_hz = 62500;
    assert(writer.write(frame) == PcapWriteResult::InvalidBandwidth);
    assert(sink.size() == header_size);

    frame.rf.bandwidth_hz = 0;
    assert(writer.write(frame) == PcapWriteResult::InvalidBandwidth);
    assert(sink.size() == header_size);

    frame.rf.bandwidth_hz = 32000000;
    assert(writer.write(frame) == PcapWriteResult::InvalidBandwidth);
    assert(sink.size() == header_size);
}

void testMalformedFrameLengthsWriteNothing()
{
    FixedSink sink{};
    PcapLoraTapWriter writer(sink);
    assert(writer.begin() == PcapWriteResult::Ok);
    const std::size_t header_size = sink.size();

    RawFrame frame = makeFrame();
    frame.original_length = static_cast<std::uint16_t>(frame.captured_length - 1U);
    assert(writer.write(frame) == PcapWriteResult::InvalidFrame);
    assert(sink.size() == header_size);
    assert(sink.writeCount() == 1);

    frame = makeFrame();
    frame.captured_length = static_cast<std::uint16_t>(kMaxFrameBytes + 1U);
    frame.original_length = frame.captured_length;
    assert(writer.write(frame) == PcapWriteResult::InvalidFrame);
    assert(sink.size() == header_size);
    assert(sink.writeCount() == 1);
    assert(!writer.failed());
}

void testFailedRecordWriteLeavesOnlyGlobalHeader()
{
    FixedSink sink{2};
    PcapLoraTapWriter writer(sink);
    assert(writer.begin() == PcapWriteResult::Ok);
    const std::size_t header_size = sink.size();

    RawFrame frame = makeFrame();
    frame.captured_length = static_cast<std::uint16_t>(kMaxFrameBytes);
    frame.original_length = frame.captured_length;
    assert(writer.write(frame) == PcapWriteResult::SinkError);

    assert(sink.writeCount() == 2);
    assert(sink.lastWriteLength() == 16U + kPcapCaptureLength);
    assert(sink.size() == header_size);
    assert(writer.failed());
    assert(writer.write(frame) == PcapWriteResult::SinkError);
    assert(sink.writeCount() == 2);

    writer.reset();
    assert(!writer.started());
    assert(!writer.failed());
    assert(writer.begin() == PcapWriteResult::Ok);
}

} // namespace

int main()
{
    testExactGlobalHeaderAndPacketBytes();
    testFrameRecordAndOriginalLength();
    testUnknownRssiNormalizedSyncAndSnrClamping();
    testMalformedBandwidthWritesNothing();
    testMalformedFrameLengthsWriteNothing();
    testFailedRecordWriteLeavesOnlyGlobalHeader();
    std::puts("pcap export tests passed");
    return 0;
}
