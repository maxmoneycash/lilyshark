#pragma once

#include "lilyshark/core/frame_store.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

// RadioStatus is owned by the device layer. Keeping this declaration opaque
// lets host-side filter users include this header without pulling in RadioLib.
struct RadioStatus;

enum class TrafficProtocolPredicate : std::uint8_t {
    Any = 0U,
    Meshtastic,
    MeshCore,
    Reticulum,
    Custom,
    Unknown,
    Count,
};

enum class TrafficDecodePredicate : std::uint8_t {
    Any = 0U,
    PayloadDecoded,
    HeaderOnly,
    Raw,
    NonMalformed,
    Malformed,
    Count,
};

enum class TrafficCrcPredicate : std::uint8_t {
    Any = 0U,
    Valid,
    Invalid,
    NotPresent,
    Unknown,
    Count,
};

struct TrafficFilter {
    TrafficProtocolPredicate protocol = TrafficProtocolPredicate::Any;
    TrafficDecodePredicate decode = TrafficDecodePredicate::Any;
    TrafficCrcPredicate crc = TrafficCrcPredicate::Any;

    [[nodiscard]] bool active() const noexcept;
    [[nodiscard]] bool matches(const FrameRecord &record) const noexcept;
};

[[nodiscard]] const char *trafficProtocolPredicateLabel(
    TrafficProtocolPredicate predicate) noexcept;
[[nodiscard]] const char *trafficDecodePredicateLabel(
    TrafficDecodePredicate predicate) noexcept;
[[nodiscard]] const char *trafficCrcPredicateLabel(
    TrafficCrcPredicate predicate) noexcept;

[[nodiscard]] TrafficProtocolPredicate nextTrafficProtocolPredicate(
    TrafficProtocolPredicate predicate) noexcept;
[[nodiscard]] TrafficProtocolPredicate previousTrafficProtocolPredicate(
    TrafficProtocolPredicate predicate) noexcept;
[[nodiscard]] TrafficDecodePredicate nextTrafficDecodePredicate(
    TrafficDecodePredicate predicate) noexcept;
[[nodiscard]] TrafficDecodePredicate previousTrafficDecodePredicate(
    TrafficDecodePredicate predicate) noexcept;
[[nodiscard]] TrafficCrcPredicate nextTrafficCrcPredicate(
    TrafficCrcPredicate predicate) noexcept;
[[nodiscard]] TrafficCrcPredicate previousTrafficCrcPredicate(
    TrafficCrcPredicate predicate) noexcept;

struct TrafficFilterSnapshot {
    std::size_t retained_frames = 0U;
    std::size_t matching_frames = 0U;
    std::uint64_t total_frames_seen = 0U;
    std::uint64_t ram_overwrites = 0U;
    bool filter_active = false;
};

template <std::size_t Capacity>
[[nodiscard]] const FrameRecord *newestMatchingFrame(
    const FrameStore<Capacity> &store, const TrafficFilter &filter,
    std::size_t matching_offset = 0U) noexcept
{
    std::size_t seen_matches = 0U;
    for(std::size_t offset = 0U; offset < store.size(); ++offset) {
        const FrameRecord *record = store.newest(offset);
        if(record != nullptr && filter.matches(*record)) {
            if(seen_matches == matching_offset) return record;
            ++seen_matches;
        }
    }
    return nullptr;
}

template <std::size_t Capacity>
[[nodiscard]] TrafficFilterSnapshot trafficFilterSnapshot(
    const FrameStore<Capacity> &store, const TrafficFilter &filter) noexcept
{
    TrafficFilterSnapshot snapshot{};
    snapshot.retained_frames = store.size();
    snapshot.total_frames_seen = store.totalSeen();
    snapshot.ram_overwrites = store.droppedCount();
    snapshot.filter_active = filter.active();
    for(std::size_t index = 0U; index < store.size(); ++index) {
        const FrameRecord *record = store.at(index);
        if(record != nullptr && filter.matches(*record)) {
            ++snapshot.matching_frames;
        }
    }
    return snapshot;
}

enum class CaptureStreamHealth : std::uint8_t {
    Disabled = 0U,
    Starting,
    Recording,
    Unsupported,
    Fault,
};

enum class CaptureHealthState : std::uint8_t {
    Off = 0U,
    Starting,
    Recording,
    Degraded,
    Unavailable,
    Fault,
};

// The caller translates each concrete writer's result into a stream state.
// Unsupported is intentionally distinct from Fault: for example, PCAP cannot
// represent every bandwidth while the native LSCAP writer can keep recording.
struct CaptureHealthInput {
    bool capture_requested = false;
    bool storage_available = false;
    CaptureStreamHealth native_stream = CaptureStreamHealth::Disabled;
    CaptureStreamHealth pcap_stream = CaptureStreamHealth::Disabled;
};

struct CaptureHealthSnapshot {
    CaptureHealthState state = CaptureHealthState::Off;
    CaptureStreamHealth native_stream = CaptureStreamHealth::Disabled;
    CaptureStreamHealth pcap_stream = CaptureStreamHealth::Disabled;
    std::size_t retained_frames = 0U;
    std::size_t buffer_capacity = 0U;
    std::uint64_t total_frames_seen = 0U;
    // These are overwrites in the in-memory inspection ring. They do not mean
    // an active file writer lost the same number of frames.
    std::uint64_t ram_overwrites = 0U;
    std::uint16_t buffer_fill_percent_x10 = 0U;
    bool capture_requested = false;
    bool storage_available = false;
};

[[nodiscard]] CaptureHealthSnapshot makeCaptureHealthSnapshot(
    const CaptureHealthInput &input, std::size_t retained_frames,
    std::size_t buffer_capacity, std::uint64_t total_frames_seen,
    std::uint64_t ram_overwrites) noexcept;

template <std::size_t Capacity>
[[nodiscard]] CaptureHealthSnapshot makeCaptureHealthSnapshot(
    const FrameStore<Capacity> &store, const CaptureHealthInput &input) noexcept
{
    return makeCaptureHealthSnapshot(input, store.size(), store.capacity(),
                                     store.totalSeen(), store.droppedCount());
}

[[nodiscard]] const char *captureHealthStateLabel(
    CaptureHealthState state) noexcept;
[[nodiscard]] const char *captureStreamHealthLabel(
    CaptureStreamHealth state) noexcept;

enum class RxHealthState : std::uint8_t {
    Offline = 0U,
    Recovering,
    Listening,
};

struct RxHealthSnapshot {
    RxHealthState state = RxHealthState::Offline;
    std::uint32_t received_frames = 0U;
    std::uint32_t crc_errors = 0U;
    std::uint32_t receive_errors = 0U;
    std::uint32_t profile_switch_failures = 0U;
    std::uint32_t last_frame_age_ms = 0U;
    std::uint16_t crc_error_percent_x10 = 0U;
    std::uint16_t receive_error_percent_x10 = 0U;
    std::int16_t last_error = 0;
    std::int16_t last_profile_error = 0;
    bool has_last_frame = false;
};

[[nodiscard]] RxHealthSnapshot makeRxHealthSnapshot(
    const RadioStatus &status, std::uint32_t now_ms) noexcept;
[[nodiscard]] const char *rxHealthStateLabel(RxHealthState state) noexcept;

// Formatting helpers never allocate. They return false for a null/zero-sized
// destination or when the complete value did not fit; any non-empty valid
// destination is still NUL-terminated by snprintf.
[[nodiscard]] bool formatDiagnosticCount(
    char *destination, std::size_t capacity, std::uint64_t value) noexcept;
[[nodiscard]] bool formatDiagnosticPercentX10(
    char *destination, std::size_t capacity,
    std::uint16_t percent_x10) noexcept;
[[nodiscard]] bool formatDiagnosticAge(
    char *destination, std::size_t capacity, bool available,
    std::uint32_t age_ms) noexcept;
[[nodiscard]] bool formatCaptureBufferUse(
    char *destination, std::size_t capacity,
    const CaptureHealthSnapshot &snapshot) noexcept;
[[nodiscard]] bool formatTrafficFilterSummary(
    char *destination, std::size_t capacity,
    const TrafficFilter &filter) noexcept;

} // namespace lilyshark
