#include "lilyshark/core/rolling_diagnostics.h"

#include <limits>

namespace lilyshark {
namespace {

constexpr std::uint32_t kMaximumOrderedDeltaMs =
    static_cast<std::uint32_t>(std::numeric_limits<std::int32_t>::max());

bool validEventOnlyObservation(const DiagnosticObservation &observation) noexcept
{
    return observation.event_marker_count != 0U && !observation.malformed &&
           !observation.crc_invalid && !observation.has_snr &&
           !observation.has_airtime;
}

void addCounters(DiagnosticCounters &destination,
                 const DiagnosticCounters &source) noexcept
{
    for(std::size_t protocol = 0U; protocol < kDiagnosticProtocolCount;
        ++protocol) {
        destination.protocol_frames[protocol] +=
            source.protocol_frames[protocol];
        destination.protocol_malformed_frames[protocol] +=
            source.protocol_malformed_frames[protocol];
        destination.protocol_crc_invalid_frames[protocol] +=
            source.protocol_crc_invalid_frames[protocol];
        destination.protocol_snr_sum_db_x10[protocol] +=
            source.protocol_snr_sum_db_x10[protocol];
        destination.protocol_snr_sample_count[protocol] +=
            source.protocol_snr_sample_count[protocol];
        destination.protocol_airtime_us[protocol] +=
            source.protocol_airtime_us[protocol];
        destination.protocol_nonmalformed_crc_invalid_frames[protocol] +=
            source.protocol_nonmalformed_crc_invalid_frames[protocol];
        destination.protocol_nonmalformed_snr_sum_db_x10[protocol] +=
            source.protocol_nonmalformed_snr_sum_db_x10[protocol];
        destination.protocol_nonmalformed_snr_sample_count[protocol] +=
            source.protocol_nonmalformed_snr_sample_count[protocol];
    }
    destination.total_frames += source.total_frames;
    destination.malformed_frames += source.malformed_frames;
    destination.crc_invalid_frames += source.crc_invalid_frames;
    destination.snr_sum_db_x10 += source.snr_sum_db_x10;
    destination.snr_sample_count += source.snr_sample_count;
    destination.airtime_us += source.airtime_us;
    destination.event_marker_count += source.event_marker_count;
}

} // namespace

void RollingDiagnosticAccumulator::reset() noexcept
{
    buckets_ = {};
    snapshot_ = {};
    oldest_index_ = 0U;
    current_index_ = 0U;
    size_ = 0U;
    current_start_ms_ = 0U;
    last_timestamp_ms_ = 0U;
}

DiagnosticUpdateResult RollingDiagnosticAccumulator::ingest(
    const FrameRecord &record, std::uint32_t event_marker_count) noexcept
{
    if(!record.raw.rf.hasField(RfFieldTimestamp)) {
        return DiagnosticUpdateResult::MissingTimestamp;
    }

    DiagnosticObservation observation{};
    observation.timestamp_ms = static_cast<std::uint32_t>(
        record.raw.rf.timestamp_us / 1000ULL);
    observation.protocol = record.decoded.protocol;
    observation.event_marker_count = event_marker_count;
    observation.airtime_us = record.raw.rf.airtime_us;
    observation.snr_db_x10 = record.raw.rf.snr_db_x10;
    observation.malformed = record.decoded.state == DecodeState::Malformed;
    observation.crc_invalid = record.raw.rf.crc == CrcStatus::Invalid;
    observation.has_snr = record.raw.rf.hasField(RfFieldSnr);
    observation.has_airtime = record.raw.rf.hasField(RfFieldAirtime);
    return ingest(observation);
}

DiagnosticUpdateResult RollingDiagnosticAccumulator::ingest(
    const DiagnosticObservation &observation) noexcept
{
    if(!observation.has_frame && !validEventOnlyObservation(observation)) {
        return DiagnosticUpdateResult::InvalidObservation;
    }

    const DiagnosticUpdateResult advance_result =
        advanceInternal(observation.timestamp_ms);
    if(advance_result != DiagnosticUpdateResult::Applied) {
        return advance_result;
    }

    DiagnosticCounters &bucket = buckets_[current_index_].counters;
    if(observation.has_frame) {
        const std::size_t protocol = static_cast<std::size_t>(
            diagnosticProtocolSlot(observation.protocol));
        ++bucket.protocol_frames[protocol];
        ++bucket.total_frames;
        if(observation.malformed) {
            ++bucket.malformed_frames;
            ++bucket.protocol_malformed_frames[protocol];
        }
        if(observation.crc_invalid) {
            ++bucket.crc_invalid_frames;
            ++bucket.protocol_crc_invalid_frames[protocol];
            if(!observation.malformed) {
                ++bucket.protocol_nonmalformed_crc_invalid_frames[protocol];
            }
        }
        if(observation.has_snr) {
            bucket.snr_sum_db_x10 += observation.snr_db_x10;
            ++bucket.snr_sample_count;
            bucket.protocol_snr_sum_db_x10[protocol] +=
                observation.snr_db_x10;
            ++bucket.protocol_snr_sample_count[protocol];
            if(!observation.malformed) {
                bucket.protocol_nonmalformed_snr_sum_db_x10[protocol] +=
                    observation.snr_db_x10;
                ++bucket.protocol_nonmalformed_snr_sample_count[protocol];
            }
        }
        if(observation.has_airtime) {
            bucket.airtime_us += observation.airtime_us;
            bucket.protocol_airtime_us[protocol] += observation.airtime_us;
        }
    }
    bucket.event_marker_count += observation.event_marker_count;
    rebuildSnapshot();
    return DiagnosticUpdateResult::Applied;
}

DiagnosticUpdateResult RollingDiagnosticAccumulator::advanceTo(
    std::uint32_t timestamp_ms) noexcept
{
    const DiagnosticUpdateResult result = advanceInternal(timestamp_ms);
    if(result == DiagnosticUpdateResult::Applied) rebuildSnapshot();
    return result;
}

DiagnosticUpdateResult RollingDiagnosticAccumulator::advanceInternal(
    std::uint32_t timestamp_ms) noexcept
{
    if(size_ == 0U) {
        oldest_index_ = 0U;
        current_index_ = 0U;
        size_ = 1U;
        current_start_ms_ = timestamp_ms;
        last_timestamp_ms_ = timestamp_ms;
        buckets_[0] = {};
        buckets_[0].start_timestamp_ms = timestamp_ms;
        return DiagnosticUpdateResult::Applied;
    }

    const std::uint32_t since_last = timestamp_ms - last_timestamp_ms_;
    if(since_last > kMaximumOrderedDeltaMs) {
        return DiagnosticUpdateResult::StaleTimestamp;
    }
    last_timestamp_ms_ = timestamp_ms;

    const std::uint32_t since_bucket_start = timestamp_ms - current_start_ms_;
    const std::uint32_t elapsed_buckets =
        since_bucket_start / kDiagnosticBucketDurationMs;
    if(elapsed_buckets == 0U) return DiagnosticUpdateResult::Applied;

    if(elapsed_buckets >= kDiagnosticBucketCount) {
        const std::uint32_t next_start =
            current_start_ms_ + elapsed_buckets * kDiagnosticBucketDurationMs;
        buckets_ = {};
        oldest_index_ = 0U;
        current_index_ = 0U;
        size_ = 1U;
        current_start_ms_ = next_start;
        buckets_[0].start_timestamp_ms = next_start;
        return DiagnosticUpdateResult::Applied;
    }

    for(std::uint32_t elapsed = 0U; elapsed < elapsed_buckets; ++elapsed) {
        current_start_ms_ += kDiagnosticBucketDurationMs;
        appendEmptyBucket(current_start_ms_);
    }
    return DiagnosticUpdateResult::Applied;
}

void RollingDiagnosticAccumulator::appendEmptyBucket(
    std::uint32_t start_timestamp_ms) noexcept
{
    const std::size_t destination =
        (current_index_ + 1U) % kDiagnosticBucketCount;
    if(size_ == kDiagnosticBucketCount) {
        oldest_index_ = (oldest_index_ + 1U) % kDiagnosticBucketCount;
    } else {
        ++size_;
    }
    current_index_ = destination;
    buckets_[destination] = {};
    buckets_[destination].start_timestamp_ms = start_timestamp_ms;
}

void RollingDiagnosticAccumulator::rebuildSnapshot() noexcept
{
    snapshot_ = {};
    snapshot_.initialized = size_ != 0U;
    snapshot_.bucket_count = size_;
    if(size_ == 0U) return;

    snapshot_.oldest_bucket_start_ms =
        buckets_[oldest_index_].start_timestamp_ms;
    snapshot_.newest_bucket_start_ms =
        buckets_[current_index_].start_timestamp_ms;
    for(std::size_t index = 0U; index < size_; ++index) {
        const DiagnosticBucket *bucket = at(index);
        addCounters(snapshot_.counters, bucket->counters);
    }
}

const DiagnosticBucket *RollingDiagnosticAccumulator::at(
    std::size_t index_from_oldest) const noexcept
{
    if(index_from_oldest >= size_) return nullptr;
    const std::size_t index =
        (oldest_index_ + index_from_oldest) % kDiagnosticBucketCount;
    return &buckets_[index];
}

const DiagnosticBucket *RollingDiagnosticAccumulator::newest(
    std::size_t offset_from_newest) const noexcept
{
    if(offset_from_newest >= size_) return nullptr;
    return at(size_ - 1U - offset_from_newest);
}

} // namespace lilyshark
