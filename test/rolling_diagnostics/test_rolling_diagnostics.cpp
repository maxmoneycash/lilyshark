#include "lilyshark/core/rolling_diagnostics.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <type_traits>

namespace {

using namespace lilyshark;

FrameRecord makeRecord(std::uint64_t timestamp_us, ProtocolId protocol,
                       std::int16_t snr_db_x10, std::uint32_t airtime_us,
                       CrcStatus crc = CrcStatus::Valid,
                       DecodeState decode = DecodeState::PayloadDecoded)
{
    FrameRecord record{};
    record.raw.rf.timestamp_us = timestamp_us;
    record.raw.rf.present_fields =
        RfFieldTimestamp | RfFieldSnr | RfFieldAirtime;
    record.raw.rf.snr_db_x10 = snr_db_x10;
    record.raw.rf.airtime_us = airtime_us;
    record.raw.rf.crc = crc;
    record.decoded.protocol = protocol;
    record.decoded.state = decode;
    return record;
}

void testFrameRecordIngestionIsTruthful()
{
    static_assert(sizeof(RollingDiagnosticAccumulator) < 20U * 1024U,
                  "the full protocol-filterable window must stay below 20 KiB");
    static_assert(std::is_nothrow_default_constructible_v<
                  RollingDiagnosticAccumulator>);

    RollingDiagnosticAccumulator diagnostics{};
    FrameRecord missing_timestamp = makeRecord(
        1000U, ProtocolId::Meshtastic, -75, 12000U);
    missing_timestamp.raw.rf.present_fields &= ~RfFieldTimestamp;
    assert(diagnostics.ingest(missing_timestamp) ==
           DiagnosticUpdateResult::MissingTimestamp);
    assert(diagnostics.empty());

    assert(diagnostics.ingest(makeRecord(
               1234000U, ProtocolId::MeshCore, -75, 12000U,
               CrcStatus::Invalid, DecodeState::Malformed), 2U) ==
           DiagnosticUpdateResult::Applied);
    assert(diagnostics.ingest(makeRecord(
               1400000U, ProtocolId::Reticulum, -24, 8000U)) ==
           DiagnosticUpdateResult::Applied);

    const RollingDiagnosticSnapshot &snapshot = diagnostics.snapshot();
    assert(snapshot.initialized);
    assert(snapshot.bucket_count == 1U);
    assert(snapshot.counters.total_frames == 2U);
    assert(snapshot.counters.protocolFrames(ProtocolId::MeshCore) == 1U);
    assert(snapshot.counters.protocolFrames(ProtocolId::Reticulum) == 1U);
    assert(snapshot.counters.malformed_frames == 1U);
    assert(snapshot.counters.crc_invalid_frames == 1U);
    assert(snapshot.counters.snr_sample_count == 2U);
    assert(snapshot.counters.snr_sum_db_x10 == -99);
    assert(snapshot.counters.meanSnrDbX10() == -49);
    assert(snapshot.counters.airtime_us == 20000U);
    assert(snapshot.counters.event_marker_count == 2U);

    const DiagnosticProtocolMetrics meshcore =
        snapshot.protocolMetrics(ProtocolId::MeshCore);
    assert(meshcore.frames == 1U);
    assert(meshcore.malformed_frames == 1U);
    assert(meshcore.crc_invalid_frames == 1U);
    assert(meshcore.snr_sum_db_x10 == -75);
    assert(meshcore.snr_sample_count == 1U);
    assert(meshcore.hasMeanSnr());
    assert(meshcore.meanSnrDbX10() == -75);
    assert(meshcore.airtime_us == 12000U);
    assert(meshcore.nonmalformed_crc_invalid_frames == 0U);
    assert(meshcore.nonmalformed_snr_sample_count == 0U);
    assert(!meshcore.hasNonmalformedMeanSnr());

    const DiagnosticProtocolMetrics reticulum =
        diagnostics.newest()->protocolMetrics(ProtocolId::Reticulum);
    assert(reticulum.frames == 1U);
    assert(reticulum.malformed_frames == 0U);
    assert(reticulum.crc_invalid_frames == 0U);
    assert(reticulum.snr_sum_db_x10 == -24);
    assert(reticulum.snr_sample_count == 1U);
    assert(reticulum.airtime_us == 8000U);
    assert(reticulum.nonmalformed_crc_invalid_frames == 0U);
    assert(reticulum.nonmalformed_snr_sample_count == 1U);
    assert(reticulum.nonmalformedMeanSnrDbX10() == -24);

    const DiagnosticProtocolMetrics absent =
        snapshot.protocolMetrics(ProtocolId::Meshtastic);
    assert(absent.frames == 0U);
    assert(absent.malformed_frames == 0U);
    assert(!absent.hasMeanSnr());
    assert(absent.meanSnrDbX10() == 0);
}

void testAllProtocolSlotsAndInvalidIds()
{
    RollingDiagnosticAccumulator diagnostics{};
    const ProtocolId protocols[] = {
        ProtocolId::Meshtastic, ProtocolId::MeshCore, ProtocolId::Reticulum,
        ProtocolId::Unknown, ProtocolId::Custom,
        static_cast<ProtocolId>(0xffU),
    };
    for(const ProtocolId protocol : protocols) {
        DiagnosticObservation observation{};
        observation.timestamp_ms = 10U;
        observation.protocol = protocol;
        assert(diagnostics.ingest(observation) ==
               DiagnosticUpdateResult::Applied);
    }

    const DiagnosticCounters &counters = diagnostics.snapshot().counters;
    assert(counters.total_frames == 6U);
    assert(counters.protocolFrames(ProtocolId::Meshtastic) == 1U);
    assert(counters.protocolFrames(ProtocolId::MeshCore) == 1U);
    assert(counters.protocolFrames(ProtocolId::Reticulum) == 1U);
    assert(counters.protocolFrames(ProtocolId::Custom) == 1U);
    assert(counters.protocolFrames(ProtocolId::Unknown) == 2U);
}

void testRollingWindowKeepsExactlySixtySeconds()
{
    RollingDiagnosticAccumulator diagnostics{};
    for(std::uint32_t second = 0U; second < kDiagnosticBucketCount; ++second) {
        DiagnosticObservation observation{};
        observation.timestamp_ms = second * kDiagnosticBucketDurationMs;
        observation.protocol = ProtocolId::Meshtastic;
        observation.airtime_us = second + 1U;
        observation.has_airtime = true;
        assert(diagnostics.ingest(observation) ==
               DiagnosticUpdateResult::Applied);
    }

    assert(diagnostics.size() == kDiagnosticBucketCount);
    assert(diagnostics.at(0U)->start_timestamp_ms == 0U);
    assert(diagnostics.newest()->start_timestamp_ms == 59000U);
    assert(diagnostics.snapshot().counters.total_frames == 60U);

    DiagnosticObservation replacement{};
    replacement.timestamp_ms = 60000U;
    replacement.protocol = ProtocolId::Custom;
    assert(diagnostics.ingest(replacement) == DiagnosticUpdateResult::Applied);
    assert(diagnostics.size() == kDiagnosticBucketCount);
    assert(diagnostics.at(0U)->start_timestamp_ms == 1000U);
    assert(diagnostics.newest()->start_timestamp_ms == 60000U);
    assert(diagnostics.snapshot().counters.total_frames == 60U);
    assert(diagnostics.snapshot().counters.protocolFrames(
               ProtocolId::Meshtastic) == 59U);
    assert(diagnostics.snapshot().counters.protocolFrames(ProtocolId::Custom) ==
           1U);
    const DiagnosticProtocolMetrics meshtastic =
        diagnostics.snapshot().protocolMetrics(ProtocolId::Meshtastic);
    assert(meshtastic.frames == 59U);
    assert(meshtastic.airtime_us == 1829U);
    assert(meshtastic.crc_invalid_frames == 0U);
    assert(diagnostics.at(kDiagnosticBucketCount) == nullptr);
    assert(diagnostics.newest(kDiagnosticBucketCount) == nullptr);
}

void testEmptySecondsAndLargeJumpsAreRepresentedCorrectly()
{
    RollingDiagnosticAccumulator diagnostics{};
    DiagnosticObservation first{};
    first.timestamp_ms = 250U;
    first.protocol = ProtocolId::Meshtastic;
    assert(diagnostics.ingest(first) == DiagnosticUpdateResult::Applied);
    assert(diagnostics.advanceTo(3250U) == DiagnosticUpdateResult::Applied);
    assert(diagnostics.size() == 4U);
    assert(diagnostics.newest()->start_timestamp_ms == 3250U);
    assert(diagnostics.newest()->counters.total_frames == 0U);
    assert(diagnostics.snapshot().counters.total_frames == 1U);

    DiagnosticObservation event{};
    event.timestamp_ms = 3250U;
    event.has_frame = false;
    event.event_marker_count = 3U;
    assert(diagnostics.ingest(event) == DiagnosticUpdateResult::Applied);
    assert(diagnostics.snapshot().counters.total_frames == 1U);
    assert(diagnostics.snapshot().counters.event_marker_count == 3U);

    assert(diagnostics.advanceTo(120250U) == DiagnosticUpdateResult::Applied);
    assert(diagnostics.size() == 1U);
    assert(diagnostics.snapshot().counters.total_frames == 0U);
    assert(diagnostics.snapshot().counters.event_marker_count == 0U);
    assert(diagnostics.newest()->start_timestamp_ms == 120250U);
}

void testMillisRolloverAndStaleInput()
{
    RollingDiagnosticAccumulator diagnostics{};
    const std::uint32_t before_wrap =
        std::numeric_limits<std::uint32_t>::max() - 500U;

    DiagnosticObservation first{};
    first.timestamp_ms = before_wrap;
    first.protocol = ProtocolId::Reticulum;
    assert(diagnostics.ingest(first) == DiagnosticUpdateResult::Applied);

    DiagnosticObservation after_wrap{};
    after_wrap.timestamp_ms = 699U; // 1,200 ms after before_wrap.
    after_wrap.protocol = ProtocolId::MeshCore;
    assert(diagnostics.ingest(after_wrap) == DiagnosticUpdateResult::Applied);
    assert(diagnostics.size() == 2U);
    assert(diagnostics.at(0U)->start_timestamp_ms == before_wrap);
    assert(diagnostics.newest()->start_timestamp_ms == 499U);
    assert(diagnostics.snapshot().counters.total_frames == 2U);

    const RollingDiagnosticSnapshot before_stale = diagnostics.snapshot();
    DiagnosticObservation stale{};
    stale.timestamp_ms = 698U;
    assert(diagnostics.ingest(stale) ==
           DiagnosticUpdateResult::StaleTimestamp);
    assert(diagnostics.snapshot().counters.total_frames ==
           before_stale.counters.total_frames);
    assert(diagnostics.snapshot().newest_bucket_start_ms ==
           before_stale.newest_bucket_start_ms);

    const std::uint32_t ambiguous =
        after_wrap.timestamp_ms + (std::uint32_t{1U} << 31U);
    assert(diagnostics.advanceTo(ambiguous) ==
           DiagnosticUpdateResult::StaleTimestamp);
}

void testInvalidEventOnlyObservationsDoNotMutateState()
{
    RollingDiagnosticAccumulator diagnostics{};
    DiagnosticObservation invalid{};
    invalid.timestamp_ms = 50U;
    invalid.has_frame = false;
    assert(diagnostics.ingest(invalid) ==
           DiagnosticUpdateResult::InvalidObservation);
    assert(diagnostics.empty());

    invalid.event_marker_count = 1U;
    invalid.has_snr = true;
    assert(diagnostics.ingest(invalid) ==
           DiagnosticUpdateResult::InvalidObservation);
    assert(diagnostics.empty());

    invalid.has_snr = false;
    assert(diagnostics.ingest(invalid) == DiagnosticUpdateResult::Applied);
    assert(!diagnostics.empty());
    assert(diagnostics.snapshot().counters.event_marker_count == 1U);
}

void testResetClearsEveryPublicView()
{
    RollingDiagnosticAccumulator diagnostics{};
    DiagnosticObservation observation{};
    observation.timestamp_ms = 5U;
    assert(diagnostics.ingest(observation) == DiagnosticUpdateResult::Applied);
    diagnostics.reset();
    assert(diagnostics.empty());
    assert(!diagnostics.snapshot().initialized);
    assert(diagnostics.snapshot().bucket_count == 0U);
    assert(diagnostics.snapshot().counters.total_frames == 0U);
    assert(diagnostics.at(0U) == nullptr);
    assert(diagnostics.newest() == nullptr);
}

void assertSnapshotMatchesBuckets(const RollingDiagnosticAccumulator &diagnostics)
{
    DiagnosticCounters expected{};
    for(std::size_t index = 0U; index < diagnostics.size(); ++index) {
        const DiagnosticBucket *bucket = diagnostics.oldest(index);
        assert(bucket != nullptr);
        if(index != 0U) {
            const DiagnosticBucket *previous = diagnostics.oldest(index - 1U);
            assert(bucket->start_timestamp_ms - previous->start_timestamp_ms ==
                   kDiagnosticBucketDurationMs);
        }
        for(std::size_t protocol = 0U; protocol < kDiagnosticProtocolCount;
            ++protocol) {
            expected.protocol_frames[protocol] +=
                bucket->counters.protocol_frames[protocol];
            expected.protocol_malformed_frames[protocol] +=
                bucket->counters.protocol_malformed_frames[protocol];
            expected.protocol_crc_invalid_frames[protocol] +=
                bucket->counters.protocol_crc_invalid_frames[protocol];
            expected.protocol_snr_sum_db_x10[protocol] +=
                bucket->counters.protocol_snr_sum_db_x10[protocol];
            expected.protocol_snr_sample_count[protocol] +=
                bucket->counters.protocol_snr_sample_count[protocol];
            expected.protocol_airtime_us[protocol] +=
                bucket->counters.protocol_airtime_us[protocol];
            expected.protocol_nonmalformed_crc_invalid_frames[protocol] +=
                bucket->counters.protocol_nonmalformed_crc_invalid_frames[protocol];
            expected.protocol_nonmalformed_snr_sum_db_x10[protocol] +=
                bucket->counters.protocol_nonmalformed_snr_sum_db_x10[protocol];
            expected.protocol_nonmalformed_snr_sample_count[protocol] +=
                bucket->counters.protocol_nonmalformed_snr_sample_count[protocol];
        }
        expected.total_frames += bucket->counters.total_frames;
        expected.malformed_frames += bucket->counters.malformed_frames;
        expected.crc_invalid_frames += bucket->counters.crc_invalid_frames;
        expected.snr_sum_db_x10 += bucket->counters.snr_sum_db_x10;
        expected.snr_sample_count += bucket->counters.snr_sample_count;
        expected.airtime_us += bucket->counters.airtime_us;
        expected.event_marker_count += bucket->counters.event_marker_count;
    }

    const RollingDiagnosticSnapshot &actual = diagnostics.snapshot();
    assert(actual.bucket_count == diagnostics.size());
    assert(actual.counters.protocol_frames == expected.protocol_frames);
    assert(actual.counters.protocol_malformed_frames ==
           expected.protocol_malformed_frames);
    assert(actual.counters.protocol_crc_invalid_frames ==
           expected.protocol_crc_invalid_frames);
    assert(actual.counters.protocol_snr_sum_db_x10 ==
           expected.protocol_snr_sum_db_x10);
    assert(actual.counters.protocol_snr_sample_count ==
           expected.protocol_snr_sample_count);
    assert(actual.counters.protocol_airtime_us ==
           expected.protocol_airtime_us);
    assert(actual.counters.protocol_nonmalformed_crc_invalid_frames ==
           expected.protocol_nonmalformed_crc_invalid_frames);
    assert(actual.counters.protocol_nonmalformed_snr_sum_db_x10 ==
           expected.protocol_nonmalformed_snr_sum_db_x10);
    assert(actual.counters.protocol_nonmalformed_snr_sample_count ==
           expected.protocol_nonmalformed_snr_sample_count);
    assert(actual.counters.total_frames == expected.total_frames);
    assert(actual.counters.malformed_frames == expected.malformed_frames);
    assert(actual.counters.crc_invalid_frames == expected.crc_invalid_frames);
    assert(actual.counters.snr_sum_db_x10 == expected.snr_sum_db_x10);
    assert(actual.counters.snr_sample_count == expected.snr_sample_count);
    assert(actual.counters.airtime_us == expected.airtime_us);
    assert(actual.counters.event_marker_count == expected.event_marker_count);

    std::uint64_t protocol_total = 0U;
    for(const std::uint64_t count : actual.counters.protocol_frames) {
        protocol_total += count;
    }
    assert(protocol_total == actual.counters.total_frames);
    std::uint64_t protocol_crc_total = 0U;
    std::uint64_t protocol_malformed_total = 0U;
    std::uint64_t protocol_non_malformed_total = 0U;
    std::int64_t protocol_snr_sum = 0;
    std::uint64_t protocol_snr_samples = 0U;
    std::uint64_t protocol_airtime = 0U;
    for(std::size_t slot = 0U; slot < kDiagnosticProtocolCount; ++slot) {
        protocol_malformed_total +=
            actual.counters.protocol_malformed_frames[slot];
        assert(actual.counters.protocol_malformed_frames[slot] <=
               actual.counters.protocol_frames[slot]);
        protocol_non_malformed_total +=
            actual.counters.protocol_frames[slot] -
            actual.counters.protocol_malformed_frames[slot];
        protocol_crc_total +=
            actual.counters.protocol_crc_invalid_frames[slot];
        protocol_snr_sum += actual.counters.protocol_snr_sum_db_x10[slot];
        protocol_snr_samples +=
            actual.counters.protocol_snr_sample_count[slot];
        protocol_airtime += actual.counters.protocol_airtime_us[slot];
    }
    assert(protocol_malformed_total == actual.counters.malformed_frames);
    assert(protocol_non_malformed_total + protocol_malformed_total ==
           actual.counters.total_frames);
    assert(protocol_crc_total == actual.counters.crc_invalid_frames);
    assert(protocol_snr_sum == actual.counters.snr_sum_db_x10);
    assert(protocol_snr_samples == actual.counters.snr_sample_count);
    assert(protocol_airtime == actual.counters.airtime_us);
    if(!diagnostics.empty()) {
        assert(actual.oldest_bucket_start_ms ==
               diagnostics.oldest()->start_timestamp_ms);
        assert(actual.newest_bucket_start_ms ==
               diagnostics.newest()->start_timestamp_ms);
    }
}

void testLongMixedStreamMaintainsRingInvariantsAcrossWrap()
{
    RollingDiagnosticAccumulator diagnostics{};
    std::uint32_t timestamp =
        std::numeric_limits<std::uint32_t>::max() - 10000U;

    for(std::uint32_t index = 0U; index < 20000U; ++index) {
        timestamp += index % 257U == 0U ? 65000U : (index * 37U) % 1501U;
        DiagnosticObservation observation{};
        observation.timestamp_ms = timestamp;
        observation.protocol = static_cast<ProtocolId>(index % 5U);
        observation.event_marker_count = index % 113U == 0U ? 1U : 0U;
        observation.airtime_us = 1000U + (index % 500U);
        observation.snr_db_x10 =
            static_cast<std::int16_t>(-200 + static_cast<std::int32_t>(index % 250U));
        observation.malformed = index % 89U == 0U;
        observation.crc_invalid = index % 47U == 0U;
        observation.has_snr = index % 7U != 0U;
        observation.has_airtime = true;
        assert(diagnostics.ingest(observation) ==
               DiagnosticUpdateResult::Applied);
        assert(diagnostics.size() >= 1U);
        assert(diagnostics.size() <= kDiagnosticBucketCount);
        assertSnapshotMatchesBuckets(diagnostics);
    }
}

} // namespace

int main()
{
    testFrameRecordIngestionIsTruthful();
    testAllProtocolSlotsAndInvalidIds();
    testRollingWindowKeepsExactlySixtySeconds();
    testEmptySecondsAndLargeJumpsAreRepresentedCorrectly();
    testMillisRolloverAndStaleInput();
    testInvalidEventOnlyObservationsDoNotMutateState();
    testResetClearsEveryPublicView();
    testLongMixedStreamMaintainsRingInvariantsAcrossWrap();
    std::puts("rolling diagnostic accumulator tests passed");
    return 0;
}
