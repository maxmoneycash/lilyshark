#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace lilyshark::simulator {

inline constexpr std::uint32_t kDefaultLiveTelemetrySeed = 0x4c494c59U;
inline constexpr std::uint32_t kLiveTelemetryStepMs = 33U;
inline constexpr std::uint32_t kLiveTelemetryMaximumCatchUpMs = 1000U;

inline constexpr std::size_t kSpectrumColumnCount = 128U;
inline constexpr std::size_t kSpectrumHistoryRowCount = 72U;
inline constexpr std::size_t kTrafficHistoryCapacity = 24U;
inline constexpr std::size_t kSimulatedCapturedByteCapacity = 120U;
inline constexpr std::size_t kNodeCount = 8U;
inline constexpr std::size_t kNodeHistoryCapacity = 48U;
inline constexpr std::size_t kAirtimeBarCount = 22U;
inline constexpr std::size_t kProtocolCount = 4U;
inline constexpr std::size_t kTimelineBucketCount = 60U;
inline constexpr std::size_t kTimelineSnrSampleCapacity = 8U;
inline constexpr std::size_t kEventHistoryCapacity = 16U;
inline constexpr std::uint8_t kNoNode = 0xffU;

enum class TelemetryChange : std::uint16_t {
    None = 0U,
    Spectrum = 1U << 0U,
    Traffic = 1U << 1U,
    Nodes = 1U << 2U,
    Survey = 1U << 3U,
    Airtime = 1U << 4U,
    Events = 1U << 5U,
    ProtocolMix = 1U << 6U,
    Timeline = 1U << 7U,
};

constexpr TelemetryChange operator|(TelemetryChange left, TelemetryChange right) noexcept
{
    return static_cast<TelemetryChange>(static_cast<std::uint16_t>(left) |
                                        static_cast<std::uint16_t>(right));
}

constexpr TelemetryChange &operator|=(TelemetryChange &left, TelemetryChange right) noexcept
{
    left = left | right;
    return left;
}

constexpr bool changed(TelemetryChange changes, TelemetryChange field) noexcept
{
    return (static_cast<std::uint16_t>(changes) & static_cast<std::uint16_t>(field)) != 0U;
}

enum class SimulatedProtocol : std::uint8_t {
    Meshtastic = 0U,
    MeshCore,
    Reticulum,
    Unknown,
    Count,
};

static_assert(static_cast<std::size_t>(SimulatedProtocol::Count) == kProtocolCount);

struct SimulatedRfProfile {
    SimulatedProtocol protocol = SimulatedProtocol::Meshtastic;
    std::uint32_t center_frequency_hz = 906875000U;
    std::uint32_t bandwidth_hz = 250000U;
    std::uint8_t spreading_factor = 11U;
    std::uint8_t coding_rate_denominator = 5U;
    std::uint16_t sync_word = 0x002bU;
    std::uint8_t profile_id = 0U;
};

enum class SimulatedDecodeOutcome : std::uint8_t {
    Decoded = 0U,
    Opaque,
    Raw,
    Malformed,
};

enum class SimulatedEventKind : std::uint8_t {
    NodeAppeared = 0U,
    HighUtilization,
    NodeSilent,
    Interference,
    TrafficBurst,
    CaptureReady,
    SurveyComplete,
};

enum class SimulatedEventSeverity : std::uint8_t {
    Info = 0U,
    Success,
    Warning,
    Error,
};

enum class TimelineMarker : std::uint8_t {
    None = 0U,
    CrcFailure = 1U << 0U,
    Interference = 1U << 1U,
    HighUtilization = 1U << 2U,
    NodeChange = 1U << 3U,
    SurveyComplete = 1U << 4U,
    TrafficBurst = 1U << 5U,
};

constexpr TimelineMarker operator|(TimelineMarker left, TimelineMarker right) noexcept
{
    return static_cast<TimelineMarker>(static_cast<std::uint8_t>(left) |
                                       static_cast<std::uint8_t>(right));
}

constexpr TimelineMarker &operator|=(TimelineMarker &left, TimelineMarker right) noexcept
{
    left = left | right;
    return left;
}

constexpr bool marked(TimelineMarker markers, TimelineMarker marker) noexcept
{
    return (static_cast<std::uint8_t>(markers) & static_cast<std::uint8_t>(marker)) != 0U;
}

struct SpectrumSnapshot {
    std::array<std::array<std::uint8_t, kSpectrumColumnCount>,
               kSpectrumHistoryRowCount> rows{};
    std::size_t newest_row = 0U;
    std::uint64_t row_generation = 0U;
    std::int16_t noise_floor_dbm = -115;
    std::uint32_t busiest_frequency_khz = 915000U;
    std::uint32_t quietest_frequency_khz = 903000U;
    std::uint8_t peak_intensity = 0U;

    std::uint8_t intensity(std::size_t age, std::size_t column) const noexcept;
};

struct TrafficSample {
    std::uint64_t sequence = 0U;
    std::uint32_t timestamp_seconds_of_day = 0U;
    SimulatedProtocol protocol = SimulatedProtocol::Unknown;
    std::uint8_t source_node = 0U;
    std::uint8_t destination_node = kNoNode;
    std::uint8_t port = 0U;
    std::uint8_t hops = 0U;
    std::int16_t snr_db_x10 = 0;
    std::int16_t rssi_dbm_x10 = 0;
    std::uint32_t center_frequency_hz = 0U;
    std::uint32_t bandwidth_hz = 0U;
    std::uint8_t spreading_factor = 0U;
    std::uint8_t coding_rate_denominator = 0U;
    std::uint16_t preamble_symbols = 0U;
    std::uint16_t sync_word = 0U;
    std::uint8_t profile_id = 0U;
    std::int32_t frequency_error_hz = 0;
    bool has_frequency_error = false;
    std::uint32_t airtime_us = 0U;
    std::uint16_t captured_bytes = 0U;
    std::uint16_t payload_offset = 0U;
    std::uint16_t payload_bytes = 0U;
    std::array<std::uint8_t, kSimulatedCapturedByteCapacity> bytes{};
    SimulatedDecodeOutcome decode_outcome = SimulatedDecodeOutcome::Decoded;
    bool crc_valid = true;

    std::uint8_t byteAt(std::size_t offset) const noexcept
    {
        return offset < captured_bytes && offset < bytes.size() ? bytes[offset] : 0U;
    }
};

struct TrafficSnapshot {
    std::array<TrafficSample, kTrafficHistoryCapacity> rows{};
    std::size_t newest_row = 0U;
    std::size_t size = 0U;
    std::uint64_t generation = 0U;
    std::uint16_t packets_per_minute = 0U;

    const TrafficSample *newest(std::size_t age) const noexcept;
};

struct NodeSnapshot {
    std::array<std::int16_t, kNodeHistoryCapacity> snr_history_db_x10{};
    std::array<std::int16_t, kNodeHistoryCapacity> rssi_history_dbm_x10{};
    std::size_t newest_sample = 0U;
    std::size_t history_size = 0U;
    std::uint64_t history_generation = 0U;
    std::uint32_t id = 0U;
    SimulatedProtocol protocol = SimulatedProtocol::Unknown;
    std::uint16_t frame_count = 0U;
    std::uint16_t crc_errors = 0U;
    std::uint32_t last_seen_seconds = 0U;
    std::int16_t latest_snr_db_x10 = 0;
    std::int16_t mean_snr_db_x10 = 0;
    std::int16_t latest_rssi_dbm_x10 = 0;
    std::uint8_t battery_percent = 0U;
    bool active = false;

    std::int16_t snr(std::size_t age) const noexcept;
    std::int16_t rssi(std::size_t age) const noexcept;
};

struct NodesSnapshot {
    std::array<NodeSnapshot, kNodeCount> nodes{};
    std::uint64_t generation = 0U;
};

struct SurveySnapshot {
    bool running = false;
    bool complete = false;
    std::uint32_t elapsed_ms = 0U;
    std::uint32_t frames = 0U;
    std::uint32_t crc_invalid_frames = 0U;
    std::uint8_t nodes_heard = 0U;
    std::int16_t best_snr_db_x10 = 0;
    std::int16_t noise_floor_dbm = -115;
    std::uint64_t generation = 0U;
};

struct AirtimeSnapshot {
    std::array<std::uint32_t, kAirtimeBarCount> bars_airtime_us{};
    std::array<bool, kAirtimeBarCount> bar_crc_invalid{};
    std::uint8_t utilization_percent = 0U;
    std::uint8_t peak_one_minute_percent = 0U;
    std::int16_t noise_floor_dbm = -115;
    std::uint64_t generation = 0U;
};

struct ProtocolMixSnapshot {
    std::array<std::uint16_t, kProtocolCount> packets_last_minute{};
    std::array<std::uint16_t, kProtocolCount> crc_failures_last_minute{};
    std::array<std::uint16_t, kProtocolCount> malformed_by_protocol_last_minute{};
    std::array<std::uint16_t, kProtocolCount> nonmalformed_crc_failures_last_minute{};
    std::array<std::uint8_t, kProtocolCount> share_percent{};
    std::array<std::uint8_t, kProtocolCount> crc_valid_percent{};
    std::array<std::int16_t, kProtocolCount> mean_snr_db_x10{};
    std::array<std::int16_t, kProtocolCount> nonmalformed_mean_snr_db_x10{};
    std::uint16_t total_last_minute = 0U;
    std::uint16_t decoded_last_minute = 0U;
    std::uint16_t opaque_last_minute = 0U;
    std::uint16_t raw_last_minute = 0U;
    std::uint16_t malformed_last_minute = 0U;
    std::uint64_t generation = 0U;
};

struct RfTimelineBucket {
    std::uint32_t timestamp_seconds_of_day = 0U;
    std::uint16_t packets_per_second = 0U;
    std::uint16_t crc_failures = 0U;
    std::int32_t snr_sum_db_x10 = 0;
    std::uint16_t snr_sample_count = 0U;
    std::uint64_t airtime_us = 0U;
    std::int16_t median_snr_db_x10 = 0;
    TimelineMarker markers = TimelineMarker::None;
    bool has_packets = false;
};

struct RfTimelineSnapshot {
    std::array<RfTimelineBucket, kTimelineBucketCount> buckets{};
    std::size_t newest_bucket = 0U;
    std::uint64_t generation = 0U;

    const RfTimelineBucket *newest(std::size_t age) const noexcept;
};

struct RfTimelineProtocolBucket {
    std::uint16_t frames = 0U;
    std::uint16_t malformed_frames = 0U;
    std::uint16_t crc_failures = 0U;
    std::int32_t snr_sum_db_x10 = 0;
    std::uint16_t snr_sample_count = 0U;

    bool hasMeanSnr() const noexcept { return snr_sample_count != 0U; }
    std::int16_t meanSnrDbX10() const noexcept
    {
        return hasMeanSnr()
            ? static_cast<std::int16_t>(snr_sum_db_x10 / snr_sample_count) : 0;
    }
};

struct EventSample {
    std::uint64_t sequence = 0U;
    std::uint32_t timestamp_seconds_of_day = 0U;
    SimulatedEventKind kind = SimulatedEventKind::CaptureReady;
    SimulatedEventSeverity severity = SimulatedEventSeverity::Info;
    std::int32_t value = 0;
    std::uint8_t node = kNoNode;
};

struct EventsSnapshot {
    std::array<EventSample, kEventHistoryCapacity> rows{};
    std::size_t newest_row = 0U;
    std::size_t size = 0U;
    std::uint64_t generation = 0U;

    const EventSample *newest(std::size_t age) const noexcept;
};

class LiveTelemetry {
  public:
    explicit LiveTelemetry(std::uint32_t seed = kDefaultLiveTelemetrySeed) noexcept;

    void reset(std::uint32_t seed = kDefaultLiveTelemetrySeed) noexcept;
    TelemetryChange advance(std::uint32_t elapsed_ms) noexcept;
    TelemetryChange setSurveyRunning(bool running) noexcept;
    void setActiveProtocol(SimulatedProtocol protocol) noexcept;
    void setActiveRfProfile(const SimulatedRfProfile &profile) noexcept;
    void setCapturePaused(bool paused) noexcept { capture_paused_ = paused; }

    std::uint32_t seed() const noexcept { return seed_; }
    std::uint64_t tick() const noexcept { return tick_; }
    std::uint32_t elapsedMilliseconds() const noexcept { return elapsed_ms_; }
    std::uint32_t clockSecondsOfDay() const noexcept;
    bool capturePaused() const noexcept { return capture_paused_; }
    SimulatedProtocol activeProtocol() const noexcept { return active_rf_profile_.protocol; }
    const SimulatedRfProfile &activeRfProfile() const noexcept { return active_rf_profile_; }

    const SpectrumSnapshot &spectrum() const noexcept { return spectrum_; }
    const TrafficSnapshot &traffic() const noexcept { return traffic_; }
    const NodesSnapshot &nodes() const noexcept { return nodes_; }
    const SurveySnapshot &survey() const noexcept { return survey_; }
    const AirtimeSnapshot &airtime() const noexcept { return airtime_; }
    const ProtocolMixSnapshot &protocolMix() const noexcept { return protocol_mix_; }
    const RfTimelineSnapshot &timeline() const noexcept { return timeline_; }
    RfTimelineProtocolBucket timelineProtocolBucket(
        SimulatedProtocol protocol, std::size_t age) const noexcept;
    std::uint16_t timelineOutcomeFrames(
        SimulatedDecodeOutcome outcome, std::size_t age) const noexcept;
    const EventsSnapshot &events() const noexcept { return events_; }

  private:
    TelemetryChange step() noexcept;
    std::uint32_t nextRandom() noexcept;
    std::uint32_t sampleHash(std::uint64_t generation, std::uint32_t lane) const noexcept;

    void writeSpectrumRow(std::uint64_t generation) noexcept;
    void updateSpectrumMetrics() noexcept;
    TrafficSample makeTrafficSample() noexcept;
    void fillTrafficBytes(TrafficSample &sample) const noexcept;
    void appendTraffic(const TrafficSample &sample, bool live) noexcept;
    bool updateNodeFromTraffic(const TrafficSample &sample) noexcept;
    void rotateMinuteBucket() noexcept;
    void updateProtocolMix() noexcept;
    void addTimelinePacket(std::size_t bucket, const TrafficSample &sample) noexcept;
    void addTimelineMarker(TimelineMarker marker) noexcept;
    void updateNodes() noexcept;
    void updateAirtime() noexcept;
    void appendEvent(SimulatedEventKind kind, SimulatedEventSeverity severity,
                     std::int32_t value, std::uint8_t node = kNoNode,
                     bool mark_timeline = true) noexcept;
    void maybeAppendSemanticEvent() noexcept;

    std::uint32_t seed_ = kDefaultLiveTelemetrySeed;
    std::uint32_t random_state_ = kDefaultLiveTelemetrySeed;
    std::uint32_t step_accumulator_ms_ = 0U;
    std::uint32_t second_accumulator_ms_ = 0U;
    std::uint32_t elapsed_ms_ = 0U;
    std::uint64_t tick_ = 0U;
    std::uint16_t ticks_until_traffic_ = 1U;
    std::size_t minute_bucket_ = 0U;
    std::uint8_t survey_nodes_mask_ = 0U;
    bool capture_paused_ = false;
    SimulatedRfProfile active_rf_profile_{};
    std::array<std::uint32_t, kNodeCount> node_age_ms_{};
    std::array<std::int64_t, kNodeCount> node_snr_sum_db_x10_{};
    std::array<std::array<std::uint8_t, kProtocolCount>,
               kTimelineBucketCount> protocol_buckets_{};
    std::array<std::array<std::uint8_t, kProtocolCount>,
               kTimelineBucketCount> protocol_crc_buckets_{};
    std::array<std::array<std::uint8_t, kProtocolCount>,
               kTimelineBucketCount> protocol_malformed_buckets_{};
    std::array<std::array<std::uint8_t, kProtocolCount>,
               kTimelineBucketCount> protocol_nonmalformed_crc_buckets_{};
    std::array<std::array<std::int32_t, kProtocolCount>,
               kTimelineBucketCount> protocol_snr_sum_buckets_{};
    std::array<std::array<std::int32_t, kProtocolCount>,
               kTimelineBucketCount> protocol_nonmalformed_snr_sum_buckets_{};
    std::array<std::array<std::uint8_t, kProtocolCount>,
               kTimelineBucketCount> protocol_nonmalformed_snr_count_buckets_{};
    std::array<std::uint8_t, kTimelineBucketCount> opaque_buckets_{};
    std::array<std::uint8_t, kTimelineBucketCount> raw_buckets_{};
    std::array<std::uint8_t, kTimelineBucketCount> malformed_buckets_{};
    std::array<std::array<std::int16_t, kTimelineSnrSampleCapacity>,
               kTimelineBucketCount> timeline_snr_samples_{};
    std::array<std::uint8_t, kTimelineBucketCount> timeline_snr_sample_counts_{};

    SpectrumSnapshot spectrum_{};
    TrafficSnapshot traffic_{};
    NodesSnapshot nodes_{};
    SurveySnapshot survey_{};
    AirtimeSnapshot airtime_{};
    ProtocolMixSnapshot protocol_mix_{};
    RfTimelineSnapshot timeline_{};
    EventsSnapshot events_{};
};

} // namespace lilyshark::simulator
