#include "lilyshark/export/witness_sidecar.h"

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

    const char *text() const noexcept
    {
        return reinterpret_cast<const char *>(bytes_.data());
    }
    std::size_t size() const noexcept { return size_; }
    std::size_t writeCount() const noexcept { return write_count_; }

  private:
    std::array<std::uint8_t, 1024> bytes_{};
    std::size_t size_ = 0;
    std::size_t fail_on_write_ = 0;
    std::size_t write_count_ = 0;
};

// The sidecar epoch anchors capture tick 0 to wall time. 1893455995 puts a
// frame stamped 5,000,000 us at exactly 1893456000 (2030-01-01T00:00:00Z) —
// WITNESS-VECTOR-1's wall clock.
constexpr std::uint64_t kEpochUnixSeconds = 1893455995ULL;

FrameRecord vectorRecord()
{
    FrameRecord record{};
    record.sequence = 7;
    std::uint8_t payload[32];
    for (std::size_t index = 0; index < sizeof(payload); ++index) {
        payload[index] = static_cast<std::uint8_t>(0xA0 + index);
    }
    assert(record.raw.assignPayload(payload, sizeof(payload)));
    record.raw.rf.timestamp_us = 5000000ULL;
    record.raw.rf.present_fields = RfFieldTimestamp | RfFieldFrequency;
    record.raw.rf.center_frequency_hz = 906862500U; // WITNESS-VECTOR-1
    record.raw.rf.crc = CrcStatus::Valid;
    record.raw.rf.origin = FrameOrigin::Radio;
    return record;
}

FrameRecord secondRecord()
{
    FrameRecord record{};
    record.sequence = 9;
    const std::uint8_t payload[] = {0x11};
    assert(record.raw.assignPayload(payload, sizeof(payload)));
    record.raw.rf.timestamp_us = 65000000ULL; // unix 1893456060, next bucket
    record.raw.rf.present_fields = RfFieldTimestamp | RfFieldFrequency;
    record.raw.rf.center_frequency_hz = 868100000U;
    record.raw.rf.crc = CrcStatus::Valid;
    record.raw.rf.origin = FrameOrigin::Radio;
    return record;
}

// The complete file for one session: header with version + anchor source +
// epoch, then one `sequence key-hex` line per eligible frame, in capture
// order. Ineligible frames between them leave no trace. Golden bytes, because
// this text is a format the analyzer and scripts/field_receipts.py must parse.
void testGoldenSidecarBytes()
{
    FixedSink sink{};
    WitnessSidecarWriter writer{sink};

    assert(writer.write(vectorRecord()) == WitnessSidecarWriteResult::NotStarted);
    assert(writer.begin(WitnessAnchorSource::Gps, kEpochUnixSeconds) ==
           WitnessSidecarWriteResult::Ok);
    assert(writer.begin(WitnessAnchorSource::Gps, kEpochUnixSeconds) ==
           WitnessSidecarWriteResult::AlreadyStarted);

    assert(writer.write(vectorRecord()) == WitnessSidecarWriteResult::Ok);

    // An ineligible frame in the middle of the session writes nothing.
    FrameRecord bad_crc = secondRecord();
    bad_crc.sequence = 8;
    bad_crc.raw.rf.crc = CrcStatus::Invalid;
    const std::size_t size_before = sink.size();
    assert(writer.write(bad_crc) == WitnessSidecarWriteResult::Ineligible);
    assert(writer.lastIneligibility() == WitnessEligibility::CrcNotValid);
    assert(sink.size() == size_before);

    assert(writer.write(secondRecord()) == WitnessSidecarWriteResult::Ok);
    assert(writer.eligibleCount() == 2U);
    assert(sink.writeCount() == 3U); // header + two lines, one write each

    const char *expected =
        "lilyshark-witness 1 gps 1893455995\n"
        "7 94ed6915ddbbfb1b5c2557f5ecb61cfe3783f40be380323af53beb8c3b610125\n"
        "9 e7779f63b5122285045990dad889211dbae93f9b808417996afe8b0985db37c6\n";
    assert(sink.size() == std::strlen(expected));
    assert(std::memcmp(sink.text(), expected, sink.size()) == 0);
}

void testEveryIneligibilityWritesNothing()
{
    FixedSink sink{};
    WitnessSidecarWriter writer{sink};
    assert(writer.begin(WitnessAnchorSource::Gps, kEpochUnixSeconds) ==
           WitnessSidecarWriteResult::Ok);
    const std::size_t header_size = sink.size();

    FrameRecord synthetic = vectorRecord();
    synthetic.raw.rf.origin = FrameOrigin::Synthetic;
    assert(writer.write(synthetic) == WitnessSidecarWriteResult::Ineligible);
    assert(writer.lastIneligibility() == WitnessEligibility::Synthetic);

    FrameRecord truncated = vectorRecord();
    truncated.raw.original_length =
        static_cast<std::uint16_t>(truncated.raw.captured_length + 1U);
    assert(writer.write(truncated) == WitnessSidecarWriteResult::Ineligible);
    assert(writer.lastIneligibility() == WitnessEligibility::Truncated);

    FrameRecord empty = vectorRecord();
    empty.raw.captured_length = 0;
    empty.raw.original_length = 0;
    assert(writer.write(empty) == WitnessSidecarWriteResult::Ineligible);
    assert(writer.lastIneligibility() == WitnessEligibility::EmptyPayload);

    FrameRecord missing_fields = vectorRecord();
    missing_fields.raw.rf.present_fields = RfFieldFrequency;
    assert(writer.write(missing_fields) == WitnessSidecarWriteResult::Ineligible);
    assert(writer.lastIneligibility() == WitnessEligibility::RequiredFieldsAbsent);

    assert(writer.eligibleCount() == 0U);
    assert(sink.size() == header_size); // header only; no placeholders, ever
}

void testSinkErrorsLatch()
{
    // Header write fails: the writer never starts and later writes still
    // report the sink failure.
    FixedSink broken{1};
    WitnessSidecarWriter writer{broken};
    assert(writer.begin(WitnessAnchorSource::Gps, kEpochUnixSeconds) ==
           WitnessSidecarWriteResult::SinkError);
    assert(writer.failed());
    assert(writer.write(vectorRecord()) == WitnessSidecarWriteResult::SinkError);
    assert(writer.begin(WitnessAnchorSource::Gps, kEpochUnixSeconds) ==
           WitnessSidecarWriteResult::SinkError);

    // A line write fails mid-session.
    FixedSink flaky{2};
    WitnessSidecarWriter session{flaky};
    assert(session.begin(WitnessAnchorSource::Gps, kEpochUnixSeconds) ==
           WitnessSidecarWriteResult::Ok);
    assert(session.write(vectorRecord()) == WitnessSidecarWriteResult::SinkError);
    assert(session.failed());
    assert(session.eligibleCount() == 0U);

    // reset() re-arms for the next session, mirroring the capture writers.
    session.reset();
    assert(!session.failed());
    assert(session.begin(WitnessAnchorSource::Gps, kEpochUnixSeconds) ==
           WitnessSidecarWriteResult::Ok);
    assert(session.write(vectorRecord()) == WitnessSidecarWriteResult::Ok);
}

void testInvalidAnchorIsRejected()
{
    FixedSink sink{};
    WitnessSidecarWriter writer{sink};
    assert(writer.begin(WitnessAnchorSource::Gps, kEpochUnixSeconds, 0U) ==
           WitnessSidecarWriteResult::InvalidAnchor);
    assert(!writer.started());
    assert(sink.size() == 0U);
    assert(std::strcmp(witnessAnchorSourceToken(WitnessAnchorSource::Gps), "gps") == 0);
}

} // namespace

int main()
{
    testGoldenSidecarBytes();
    testEveryIneligibilityWritesNothing();
    testSinkErrorsLatch();
    testInvalidAnchorIsRejected();
    std::puts("witness sidecar tests passed");
    return 0;
}
