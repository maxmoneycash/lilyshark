#pragma once

#include "lilyshark/core/frame_store.h"

#include <array>
#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kDiagnosticBucketCount = 60U;
inline constexpr std::uint32_t kDiagnosticBucketDurationMs = 1000U;
inline constexpr std::size_t kDiagnosticProtocolCount = 5U;

// Stable display order for the Protocols screen. Do not use ProtocolId's
// underlying value as an array index; future protocol IDs need an explicit
// mapping here.
enum class DiagnosticProtocolSlot : std::uint8_t {
    Meshtastic = 0U,
    MeshCore,
    Reticulum,
    Unknown,
    Custom,
    Count,
};

static_assert(static_cast<std::size_t>(DiagnosticProtocolSlot::Count) ==
              kDiagnosticProtocolCount);

[[nodiscard]] constexpr DiagnosticProtocolSlot diagnosticProtocolSlot(
    ProtocolId protocol) noexcept
{
    switch(protocol) {
    case ProtocolId::Meshtastic:
        return DiagnosticProtocolSlot::Meshtastic;
    case ProtocolId::MeshCore:
        return DiagnosticProtocolSlot::MeshCore;
    case ProtocolId::Reticulum:
        return DiagnosticProtocolSlot::Reticulum;
    case ProtocolId::Custom:
        return DiagnosticProtocolSlot::Custom;
    case ProtocolId::Unknown:
    default:
        return DiagnosticProtocolSlot::Unknown;
    }
}

struct DiagnosticProtocolMetrics {
    std::uint64_t frames = 0U;
    std::uint64_t malformed_frames = 0U;
    std::uint64_t crc_invalid_frames = 0U;
    std::int64_t snr_sum_db_x10 = 0;
    std::uint64_t snr_sample_count = 0U;
    std::uint64_t airtime_us = 0U;
    std::uint64_t nonmalformed_crc_invalid_frames = 0U;
    std::int64_t nonmalformed_snr_sum_db_x10 = 0;
    std::uint64_t nonmalformed_snr_sample_count = 0U;

    [[nodiscard]] bool hasMeanSnr() const noexcept
    {
        return snr_sample_count != 0U;
    }

    // Arithmetic mean in tenths of a decibel, truncated toward zero.
    [[nodiscard]] std::int16_t meanSnrDbX10() const noexcept
    {
        return hasMeanSnr()
                   ? static_cast<std::int16_t>(
                         snr_sum_db_x10 /
                         static_cast<std::int64_t>(snr_sample_count))
                   : 0;
    }

    [[nodiscard]] bool hasNonmalformedMeanSnr() const noexcept
    {
        return nonmalformed_snr_sample_count != 0U;
    }

    [[nodiscard]] std::int16_t nonmalformedMeanSnrDbX10() const noexcept
    {
        return hasNonmalformedMeanSnr()
                   ? static_cast<std::int16_t>(
                         nonmalformed_snr_sum_db_x10 /
                         static_cast<std::int64_t>(nonmalformed_snr_sample_count))
                   : 0;
    }
};

struct DiagnosticCounters {
    // Per-second protocol counters use 32-bit storage to keep the fixed
    // 60-bucket window compact. Four billion frames in one retained minute is
    // beyond the physical receive rate of the radio.
    std::array<std::uint32_t, kDiagnosticProtocolCount> protocol_frames{};
    std::array<std::uint32_t, kDiagnosticProtocolCount>
        protocol_malformed_frames{};
    std::array<std::uint32_t, kDiagnosticProtocolCount>
        protocol_crc_invalid_frames{};
    std::array<std::int32_t, kDiagnosticProtocolCount>
        protocol_snr_sum_db_x10{};
    std::array<std::uint32_t, kDiagnosticProtocolCount>
        protocol_snr_sample_count{};
    std::array<std::uint32_t, kDiagnosticProtocolCount> protocol_airtime_us{};
    std::array<std::uint32_t, kDiagnosticProtocolCount>
        protocol_nonmalformed_crc_invalid_frames{};
    std::array<std::int32_t, kDiagnosticProtocolCount>
        protocol_nonmalformed_snr_sum_db_x10{};
    std::array<std::uint32_t, kDiagnosticProtocolCount>
        protocol_nonmalformed_snr_sample_count{};
    std::uint64_t total_frames = 0U;
    std::uint64_t malformed_frames = 0U;
    std::uint64_t crc_invalid_frames = 0U;
    std::int64_t snr_sum_db_x10 = 0;
    std::uint64_t snr_sample_count = 0U;
    std::uint64_t airtime_us = 0U;
    std::uint64_t event_marker_count = 0U;

    [[nodiscard]] std::uint64_t protocolFrames(ProtocolId protocol) const noexcept
    {
        return protocol_frames[static_cast<std::size_t>(
            diagnosticProtocolSlot(protocol))];
    }

    [[nodiscard]] DiagnosticProtocolMetrics protocolMetrics(
        ProtocolId protocol) const noexcept
    {
        const std::size_t slot = static_cast<std::size_t>(
            diagnosticProtocolSlot(protocol));
        return {
            protocol_frames[slot],
            protocol_malformed_frames[slot],
            protocol_crc_invalid_frames[slot],
            protocol_snr_sum_db_x10[slot],
            protocol_snr_sample_count[slot],
            protocol_airtime_us[slot],
            protocol_nonmalformed_crc_invalid_frames[slot],
            protocol_nonmalformed_snr_sum_db_x10[slot],
            protocol_nonmalformed_snr_sample_count[slot],
        };
    }

    [[nodiscard]] bool hasMeanSnr() const noexcept
    {
        return snr_sample_count != 0U;
    }

    // Arithmetic mean in tenths of a decibel, truncated toward zero.
    [[nodiscard]] std::int16_t meanSnrDbX10() const noexcept
    {
        return hasMeanSnr()
                   ? static_cast<std::int16_t>(
                         snr_sum_db_x10 /
                         static_cast<std::int64_t>(snr_sample_count))
                   : 0;
    }
};

struct DiagnosticBucket {
    std::uint32_t start_timestamp_ms = 0U;
    DiagnosticCounters counters{};

    [[nodiscard]] DiagnosticProtocolMetrics protocolMetrics(
        ProtocolId protocol) const noexcept
    {
        return counters.protocolMetrics(protocol);
    }
};

struct RollingDiagnosticSnapshot {
    DiagnosticCounters counters{};
    std::uint32_t oldest_bucket_start_ms = 0U;
    std::uint32_t newest_bucket_start_ms = 0U;
    std::size_t bucket_count = 0U;
    bool initialized = false;

    [[nodiscard]] DiagnosticProtocolMetrics protocolMetrics(
        ProtocolId protocol) const noexcept
    {
        return counters.protocolMetrics(protocol);
    }
};

// An explicit packet observation, or an event-only marker when has_frame is
// false. Frame metrics are invalid on event-only observations.
struct DiagnosticObservation {
    std::uint32_t timestamp_ms = 0U;
    ProtocolId protocol = ProtocolId::Unknown;
    std::uint32_t event_marker_count = 0U;
    std::uint32_t airtime_us = 0U;
    std::int16_t snr_db_x10 = 0;
    bool has_frame = true;
    bool malformed = false;
    bool crc_invalid = false;
    bool has_snr = false;
    bool has_airtime = false;
};

enum class DiagnosticUpdateResult : std::uint8_t {
    Applied = 0U,
    MissingTimestamp,
    StaleTimestamp,
    InvalidObservation,
};

// A fixed-memory, single-owner rolling window. Timestamps use 32-bit
// monotonic milliseconds and RFC-1982-style serial comparison, so normal
// updates continue across millis() rollover. Callers must provide at least one
// update within each half-range (~24.8 days) to keep ordering unambiguous.
class RollingDiagnosticAccumulator
{
  public:
    void reset() noexcept;

    [[nodiscard]] DiagnosticUpdateResult ingest(
        const FrameRecord &record,
        std::uint32_t event_marker_count = 0U) noexcept;
    [[nodiscard]] DiagnosticUpdateResult ingest(
        const DiagnosticObservation &observation) noexcept;
    [[nodiscard]] DiagnosticUpdateResult advanceTo(
        std::uint32_t timestamp_ms) noexcept;

    [[nodiscard]] const RollingDiagnosticSnapshot &snapshot() const noexcept
    {
        return snapshot_;
    }

    // Pointers remain valid until the next mutation. oldest(0) is the first
    // retained second; newest(0) is the current second.
    [[nodiscard]] const DiagnosticBucket *at(
        std::size_t index_from_oldest) const noexcept;
    [[nodiscard]] const DiagnosticBucket *oldest(
        std::size_t offset_from_oldest = 0U) const noexcept
    {
        return at(offset_from_oldest);
    }
    [[nodiscard]] const DiagnosticBucket *newest(
        std::size_t offset_from_newest = 0U) const noexcept;

    [[nodiscard]] std::size_t size() const noexcept { return size_; }
    [[nodiscard]] bool empty() const noexcept { return size_ == 0U; }
    [[nodiscard]] static constexpr std::size_t capacity() noexcept
    {
        return kDiagnosticBucketCount;
    }

  private:
    [[nodiscard]] DiagnosticUpdateResult advanceInternal(
        std::uint32_t timestamp_ms) noexcept;
    void appendEmptyBucket(std::uint32_t start_timestamp_ms) noexcept;
    void rebuildSnapshot() noexcept;

    std::array<DiagnosticBucket, kDiagnosticBucketCount> buckets_{};
    RollingDiagnosticSnapshot snapshot_{};
    std::size_t oldest_index_ = 0U;
    std::size_t current_index_ = 0U;
    std::size_t size_ = 0U;
    std::uint32_t current_start_ms_ = 0U;
    std::uint32_t last_timestamp_ms_ = 0U;
};

} // namespace lilyshark
