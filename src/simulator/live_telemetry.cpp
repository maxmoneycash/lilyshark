#if !defined(LILYSHARK_DEVICE)

#include "lilyshark/simulator/live_telemetry.h"

#include <algorithm>
#include <limits>

namespace lilyshark::simulator {
namespace {

constexpr std::uint32_t kClockStartSeconds = 14U * 60U * 60U + 2U * 60U + 11U;
constexpr std::uint32_t kSecondsPerDay = 24U * 60U * 60U;
constexpr std::uint32_t kSpectrumStartKhz = 902000U;
constexpr std::uint32_t kSpectrumSpanKhz = 26000U;

constexpr std::array<std::uint8_t, kNodeCount> kInitialBatteryPercent = {{
    85U, 100U, 78U, 92U, 61U, 55U, 67U, 48U,
}};

constexpr std::array<std::uint32_t, kNodeCount> kNodeIds = {{
    0x7a2f1041U, 0x34c98122U, 0xa17e30d5U, 0x55b6c203U,
    0x92d4418eU, 0x0f7ac619U, 0xc3e80572U, 0x681dba44U,
}};

constexpr std::array<SimulatedProtocol, kNodeCount> kNodeProtocols = {{
    SimulatedProtocol::Meshtastic,
    SimulatedProtocol::Meshtastic,
    SimulatedProtocol::Meshtastic,
    SimulatedProtocol::Meshtastic,
    SimulatedProtocol::Meshtastic,
    SimulatedProtocol::Meshtastic,
    SimulatedProtocol::Meshtastic,
    SimulatedProtocol::Meshtastic,
}};

constexpr std::array<SimulatedRfProfile, 4U> kSeedRfProfiles = {{
    {SimulatedProtocol::Meshtastic, 906875000U, 250000U, 11U, 5U, 0x002bU, 1U},
    {SimulatedProtocol::MeshCore, 910525000U, 62500U, 7U, 5U, 0x1424U, 2U},
    {SimulatedProtocol::Reticulum, 867200000U, 125000U, 8U, 5U, 0x1424U, 4U},
    {SimulatedProtocol::Unknown, 915000000U, 125000U, 9U, 5U, 0x0012U, 0U},
}};

template <typename Value>
constexpr Value clampValue(Value value, Value lower, Value upper) noexcept
{
    return value < lower ? lower : (value > upper ? upper : value);
}

constexpr std::uint32_t mix32(std::uint32_t value) noexcept
{
    value ^= value >> 16U;
    value *= 0x7feb352dU;
    value ^= value >> 15U;
    value *= 0x846ca68bU;
    value ^= value >> 16U;
    return value;
}

constexpr int absolute(int value) noexcept
{
    return value < 0 ? -value : value;
}

constexpr int triangle(std::uint64_t phase, int half_period) noexcept
{
    const std::uint64_t period = static_cast<std::uint64_t>(half_period * 2);
    const int position = static_cast<int>(phase % period);
    return position <= half_period ? position : (half_period * 2 - position);
}

constexpr std::uint64_t divideRoundUp(std::uint64_t numerator,
                                      std::uint64_t denominator) noexcept
{
    return denominator == 0U ? 0U : (numerator + denominator - 1U) / denominator;
}

constexpr std::uint16_t simulatedPreambleSymbols(
    const SimulatedRfProfile &profile) noexcept
{
    if(profile.protocol == SimulatedProtocol::Meshtastic) return 16U;
    if(profile.protocol == SimulatedProtocol::MeshCore) {
        return profile.spreading_factor == 7U || profile.spreading_factor == 8U
            ? 32U : 16U;
    }
    if(profile.protocol != SimulatedProtocol::Reticulum ||
       profile.spreading_factor < 7U || profile.spreading_factor > 12U) {
        return 16U;
    }
    constexpr std::array<std::uint32_t, 4U> bandwidths = {{
        62500U, 125000U, 250000U, 500000U,
    }};
    constexpr std::array<std::array<std::uint16_t, 6U>, 4U> preambles = {{
        {{18U, 18U, 18U, 18U, 18U, 18U}},
        {{24U, 18U, 18U, 18U, 18U, 18U}},
        {{47U, 24U, 18U, 18U, 18U, 18U}},
        {{94U, 47U, 24U, 18U, 18U, 18U}},
    }};
    for(std::size_t index = 0U; index < bandwidths.size(); ++index) {
        if(profile.bandwidth_hz == bandwidths[index]) {
            return preambles[index][profile.spreading_factor - 7U];
        }
    }
    return 0U;
}

std::uint32_t simulatedLoRaAirtimeUs(const SimulatedRfProfile &profile,
                                     std::uint16_t captured_bytes) noexcept
{
    if(profile.bandwidth_hz == 0U || profile.spreading_factor < 5U ||
       profile.spreading_factor > 15U || profile.coding_rate_denominator < 5U ||
       profile.coding_rate_denominator > 8U) {
        return 0U;
    }

    // Match the device's receive-side assumptions: explicit LoRa header,
    // CRC present (valid or invalid), derived built-in preamble, and the full
    // captured frame length rather than a decoded payload length.
    const std::uint32_t spreading_symbols = 1U << profile.spreading_factor;
    const bool low_data_rate_optimization =
        static_cast<std::uint64_t>(spreading_symbols) * 1000000ULL >=
        static_cast<std::uint64_t>(profile.bandwidth_hz) * 16000ULL;
    const std::int64_t numerator =
        8LL * captured_bytes - 4LL * profile.spreading_factor + 28LL + 16LL;
    const std::uint32_t denominator = 4U *
        (profile.spreading_factor - (low_data_rate_optimization ? 2U : 0U));
    const std::uint64_t encoded_blocks = numerator > 0
        ? divideRoundUp(static_cast<std::uint64_t>(numerator), denominator) : 0U;
    const std::uint64_t payload_symbols =
        8U + encoded_blocks * profile.coding_rate_denominator;
    const std::uint64_t quarter_symbols =
        4U * (simulatedPreambleSymbols(profile) + payload_symbols) + 17U;
    const std::uint64_t airtime = divideRoundUp(
        quarter_symbols * spreading_symbols * 1000000ULL,
        4ULL * profile.bandwidth_hz);
    return static_cast<std::uint32_t>(std::min<std::uint64_t>(
        airtime, std::numeric_limits<std::uint32_t>::max()));
}

void putLittleEndian32(std::array<std::uint8_t, kSimulatedCapturedByteCapacity> &bytes,
                       std::size_t offset, std::uint32_t value) noexcept
{
    if(offset + 4U > bytes.size()) return;
    bytes[offset] = static_cast<std::uint8_t>(value);
    bytes[offset + 1U] = static_cast<std::uint8_t>(value >> 8U);
    bytes[offset + 2U] = static_cast<std::uint8_t>(value >> 16U);
    bytes[offset + 3U] = static_cast<std::uint8_t>(value >> 24U);
}

void putNetwork32(std::array<std::uint8_t, kSimulatedCapturedByteCapacity> &bytes,
                  std::size_t offset, std::uint32_t value) noexcept
{
    if(offset + 4U > bytes.size()) return;
    bytes[offset] = static_cast<std::uint8_t>(value >> 24U);
    bytes[offset + 1U] = static_cast<std::uint8_t>(value >> 16U);
    bytes[offset + 2U] = static_cast<std::uint8_t>(value >> 8U);
    bytes[offset + 3U] = static_cast<std::uint8_t>(value);
}

constexpr std::size_t protocolIndex(SimulatedProtocol protocol) noexcept
{
    const std::size_t index = static_cast<std::size_t>(protocol);
    return index < kProtocolCount ? index : kProtocolCount - 1U;
}

} // namespace

std::uint8_t SpectrumSnapshot::intensity(std::size_t age, std::size_t column) const noexcept
{
    if(age >= kSpectrumHistoryRowCount || column >= kSpectrumColumnCount) return 0U;
    const std::size_t row =
        (newest_row + kSpectrumHistoryRowCount - age) % kSpectrumHistoryRowCount;
    return rows[row][column];
}

const TrafficSample *TrafficSnapshot::newest(std::size_t age) const noexcept
{
    if(age >= size || age >= kTrafficHistoryCapacity) return nullptr;
    const std::size_t row =
        (newest_row + kTrafficHistoryCapacity - age) % kTrafficHistoryCapacity;
    return &rows[row];
}

std::int16_t NodeSnapshot::snr(std::size_t age) const noexcept
{
    if(age >= history_size || age >= kNodeHistoryCapacity) return 0;
    const std::size_t sample =
        (newest_sample + kNodeHistoryCapacity - age) % kNodeHistoryCapacity;
    return snr_history_db_x10[sample];
}

std::int16_t NodeSnapshot::rssi(std::size_t age) const noexcept
{
    if(age >= history_size || age >= kNodeHistoryCapacity) return 0;
    const std::size_t sample =
        (newest_sample + kNodeHistoryCapacity - age) % kNodeHistoryCapacity;
    return rssi_history_dbm_x10[sample];
}

const EventSample *EventsSnapshot::newest(std::size_t age) const noexcept
{
    if(age >= size || age >= kEventHistoryCapacity) return nullptr;
    const std::size_t row =
        (newest_row + kEventHistoryCapacity - age) % kEventHistoryCapacity;
    return &rows[row];
}

const RfTimelineBucket *RfTimelineSnapshot::newest(std::size_t age) const noexcept
{
    if(age >= kTimelineBucketCount) return nullptr;
    const std::size_t bucket =
        (newest_bucket + kTimelineBucketCount - age) % kTimelineBucketCount;
    return &buckets[bucket];
}

RfTimelineProtocolBucket LiveTelemetry::timelineProtocolBucket(
    SimulatedProtocol protocol, std::size_t age) const noexcept
{
    const std::size_t protocol_index = static_cast<std::size_t>(protocol);
    if(protocol_index >= kProtocolCount || age >= kTimelineBucketCount) return {};
    const std::size_t bucket =
        (timeline_.newest_bucket + kTimelineBucketCount - age) % kTimelineBucketCount;
    const std::uint16_t frames = protocol_buckets_[bucket][protocol_index];
    return {
        frames,
        protocol_malformed_buckets_[bucket][protocol_index],
        protocol_crc_buckets_[bucket][protocol_index],
        protocol_snr_sum_buckets_[bucket][protocol_index],
        frames,
    };
}

std::uint16_t LiveTelemetry::timelineOutcomeFrames(
    SimulatedDecodeOutcome outcome, std::size_t age) const noexcept
{
    if(age >= kTimelineBucketCount) return 0U;
    const std::size_t bucket =
        (timeline_.newest_bucket + kTimelineBucketCount - age) % kTimelineBucketCount;
    if(outcome == SimulatedDecodeOutcome::Opaque) return opaque_buckets_[bucket];
    if(outcome == SimulatedDecodeOutcome::Raw) return raw_buckets_[bucket];
    if(outcome == SimulatedDecodeOutcome::Malformed) return malformed_buckets_[bucket];
    const std::uint16_t total = timeline_.buckets[bucket].packets_per_second;
    const std::uint16_t undecoded = static_cast<std::uint16_t>(
        opaque_buckets_[bucket] + raw_buckets_[bucket] + malformed_buckets_[bucket]);
    return undecoded <= total ? static_cast<std::uint16_t>(total - undecoded) : 0U;
}

LiveTelemetry::LiveTelemetry(std::uint32_t seed) noexcept
{
    reset(seed);
}

void LiveTelemetry::reset(std::uint32_t seed) noexcept
{
    seed_ = seed;
    random_state_ = seed == 0U ? 0xa341316cU : seed;
    step_accumulator_ms_ = 0U;
    second_accumulator_ms_ = 0U;
    elapsed_ms_ = 0U;
    tick_ = 0U;
    minute_bucket_ = kTimelineBucketCount - 1U;
    survey_nodes_mask_ = 0U;
    capture_paused_ = false;
    active_rf_profile_ = kSeedRfProfiles[0U];
    node_snr_sum_db_x10_ = {};
    protocol_buckets_ = {};
    protocol_crc_buckets_ = {};
    protocol_malformed_buckets_ = {};
    protocol_nonmalformed_crc_buckets_ = {};
    protocol_snr_sum_buckets_ = {};
    protocol_nonmalformed_snr_sum_buckets_ = {};
    protocol_nonmalformed_snr_count_buckets_ = {};
    opaque_buckets_ = {};
    raw_buckets_ = {};
    malformed_buckets_ = {};
    timeline_snr_samples_ = {};
    timeline_snr_sample_counts_ = {};
    spectrum_ = {};
    traffic_ = {};
    nodes_ = {};
    survey_ = {};
    airtime_ = {};
    protocol_mix_ = {};
    timeline_ = {};
    events_ = {};

    spectrum_.newest_row = kSpectrumHistoryRowCount - 1U;
    for(std::uint64_t generation = 1U;
        generation <= static_cast<std::uint64_t>(kSpectrumHistoryRowCount); ++generation) {
        writeSpectrumRow(generation);
    }
    updateSpectrumMetrics();

    for(std::size_t node = 0U; node < kNodeCount; ++node) {
        node_age_ms_[node] = 0U;
        NodeSnapshot &snapshot = nodes_.nodes[node];
        snapshot.newest_sample = kNodeHistoryCapacity - 1U;
        snapshot.id = kNodeIds[node];
        snapshot.protocol = kNodeProtocols[node];
        snapshot.battery_percent = kInitialBatteryPercent[node];
    }
    nodes_.generation = 1U;

    timeline_.newest_bucket = kTimelineBucketCount - 1U;
    for(std::size_t age = 0U; age < kTimelineBucketCount; ++age) {
        const std::size_t bucket =
            (timeline_.newest_bucket + kTimelineBucketCount - age) % kTimelineBucketCount;
        timeline_.buckets[bucket].timestamp_seconds_of_day =
            (kClockStartSeconds + kSecondsPerDay - static_cast<std::uint32_t>(age)) %
            kSecondsPerDay;
    }
    timeline_.generation = 1U;

    traffic_.newest_row = kTrafficHistoryCapacity - 1U;
    for(std::size_t row = 0U; row < kTrafficHistoryCapacity; ++row) {
        // The initial rolling window represents observations retained from
        // earlier profile changes. New samples after reset follow the selected
        // active protocol below.
        active_rf_profile_ = kSeedRfProfiles[row % kSeedRfProfiles.size()];
        TrafficSample sample = makeTrafficSample();
        const std::uint32_t age_seconds =
            static_cast<std::uint32_t>((kTrafficHistoryCapacity - 1U - row) * 2U);
        sample.timestamp_seconds_of_day =
            (kClockStartSeconds + kSecondsPerDay - age_seconds) % kSecondsPerDay;
        appendTraffic(sample, false);
        const std::size_t age_bucket = static_cast<std::size_t>(age_seconds % 60U);
        const std::size_t bucket =
            (minute_bucket_ + kTimelineBucketCount - age_bucket) % kTimelineBucketCount;
        const std::size_t protocol = protocolIndex(sample.protocol);
        ++protocol_buckets_[bucket][protocol];
        if(!sample.crc_valid) ++protocol_crc_buckets_[bucket][protocol];
        protocol_snr_sum_buckets_[bucket][protocol] += sample.snr_db_x10;
        if(sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
            ++protocol_malformed_buckets_[bucket][protocol];
        } else {
            if(!sample.crc_valid) ++protocol_nonmalformed_crc_buckets_[bucket][protocol];
            protocol_nonmalformed_snr_sum_buckets_[bucket][protocol] += sample.snr_db_x10;
            ++protocol_nonmalformed_snr_count_buckets_[bucket][protocol];
        }
        if(sample.decode_outcome == SimulatedDecodeOutcome::Opaque) {
            ++opaque_buckets_[bucket];
        } else if(sample.decode_outcome == SimulatedDecodeOutcome::Raw) {
            ++raw_buckets_[bucket];
        } else if(sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
            ++malformed_buckets_[bucket];
        }
        addTimelinePacket(bucket, sample);
    }
    active_rf_profile_ = kSeedRfProfiles[0U];
    updateProtocolMix();

    const std::size_t seeded_airtime_count = std::min(
        traffic_.size, static_cast<std::size_t>(kAirtimeBarCount));
    for(std::size_t index = 0U; index < seeded_airtime_count; ++index) {
        const TrafficSample *sample = traffic_.newest(seeded_airtime_count - 1U - index);
        if(sample == nullptr) continue;
        airtime_.bars_airtime_us[index] = sample->airtime_us;
        airtime_.bar_crc_invalid[index] = !sample->crc_valid;
    }
    airtime_.noise_floor_dbm = spectrum_.noise_floor_dbm;
    updateAirtime();

    appendEvent(SimulatedEventKind::CaptureReady, SimulatedEventSeverity::Success, 0,
                kNoNode, false);
    events_.rows[events_.newest_row].timestamp_seconds_of_day =
        kClockStartSeconds - 11U * 60U;
    appendEvent(SimulatedEventKind::NodeAppeared, SimulatedEventSeverity::Success, -121, 4U,
                false);
    events_.rows[events_.newest_row].timestamp_seconds_of_day = kClockStartSeconds - 8U * 60U;
    appendEvent(SimulatedEventKind::Interference, SimulatedEventSeverity::Warning, 914800,
                kNoNode, false);
    events_.rows[events_.newest_row].timestamp_seconds_of_day = kClockStartSeconds - 4U * 60U;
    appendEvent(SimulatedEventKind::NodeSilent, SimulatedEventSeverity::Error, 15, 5U, false);
    events_.rows[events_.newest_row].timestamp_seconds_of_day = kClockStartSeconds - 2U * 60U;
    appendEvent(SimulatedEventKind::HighUtilization, SimulatedEventSeverity::Warning, 67,
                kNoNode, false);
    events_.rows[events_.newest_row].timestamp_seconds_of_day = kClockStartSeconds - 40U;
    const std::size_t marker_bucket =
        (timeline_.newest_bucket + kTimelineBucketCount - 40U) % kTimelineBucketCount;
    timeline_.buckets[marker_bucket].markers |= TimelineMarker::HighUtilization;

    survey_.noise_floor_dbm = spectrum_.noise_floor_dbm;
    ticks_until_traffic_ = static_cast<std::uint16_t>(16U + nextRandom() % 27U);
}

TelemetryChange LiveTelemetry::advance(std::uint32_t elapsed_ms) noexcept
{
    const std::uint32_t bounded_elapsed =
        std::min(elapsed_ms, kLiveTelemetryMaximumCatchUpMs);
    step_accumulator_ms_ += bounded_elapsed;
    TelemetryChange changes = TelemetryChange::None;
    while(step_accumulator_ms_ >= kLiveTelemetryStepMs) {
        step_accumulator_ms_ -= kLiveTelemetryStepMs;
        changes |= step();
    }
    return changes;
}

TelemetryChange LiveTelemetry::setSurveyRunning(bool running) noexcept
{
    if(survey_.running == running) return TelemetryChange::None;
    if(running) {
        survey_.running = true;
        survey_.complete = false;
        survey_.elapsed_ms = 0U;
        survey_.frames = 0U;
        survey_.crc_invalid_frames = 0U;
        survey_.nodes_heard = 0U;
        survey_.best_snr_db_x10 = 0;
        survey_nodes_mask_ = 0U;
    } else {
        survey_.running = false;
        survey_.complete = false;
        survey_.elapsed_ms = 0U;
        survey_.frames = 0U;
        survey_.crc_invalid_frames = 0U;
        survey_.nodes_heard = 0U;
        survey_.best_snr_db_x10 = 0;
        survey_nodes_mask_ = 0U;
    }
    survey_.noise_floor_dbm = spectrum_.noise_floor_dbm;
    ++survey_.generation;
    return TelemetryChange::Survey;
}

void LiveTelemetry::setActiveProtocol(SimulatedProtocol protocol) noexcept
{
    active_rf_profile_.protocol = protocol == SimulatedProtocol::Count
        ? SimulatedProtocol::Unknown : protocol;
}

void LiveTelemetry::setActiveRfProfile(const SimulatedRfProfile &profile) noexcept
{
    active_rf_profile_ = profile;
    if(active_rf_profile_.protocol == SimulatedProtocol::Count) {
        active_rf_profile_.protocol = SimulatedProtocol::Unknown;
    }
}

std::uint32_t LiveTelemetry::clockSecondsOfDay() const noexcept
{
    return (kClockStartSeconds + elapsed_ms_ / 1000U) % kSecondsPerDay;
}

TelemetryChange LiveTelemetry::step() noexcept
{
    ++tick_;
    elapsed_ms_ += kLiveTelemetryStepMs;
    TelemetryChange changes = TelemetryChange::None;

    if(!capture_paused_) {
        for(std::uint32_t &age : node_age_ms_) {
            if(age <= std::numeric_limits<std::uint32_t>::max() - kLiveTelemetryStepMs) {
                age += kLiveTelemetryStepMs;
            }
        }

        second_accumulator_ms_ += kLiveTelemetryStepMs;
        if(second_accumulator_ms_ >= 1000U) {
            second_accumulator_ms_ -= 1000U;
            rotateMinuteBucket();
            changes |= TelemetryChange::Traffic;
            changes |= TelemetryChange::ProtocolMix;
            changes |= TelemetryChange::Timeline;
        }

        if(ticks_until_traffic_ > 0U) --ticks_until_traffic_;
        if(ticks_until_traffic_ == 0U) {
            appendTraffic(makeTrafficSample(), true);
            ticks_until_traffic_ = static_cast<std::uint16_t>(16U + nextRandom() % 27U);
            changes |= TelemetryChange::Traffic;
            changes |= TelemetryChange::Nodes;
            changes |= TelemetryChange::ProtocolMix;
            changes |= TelemetryChange::Timeline;
            if(survey_.running) changes |= TelemetryChange::Survey;
        }
    }

    if((tick_ % 2U) == 0U) {
        writeSpectrumRow(spectrum_.row_generation + 1U);
        updateSpectrumMetrics();
        changes |= TelemetryChange::Spectrum;
    }
    if((tick_ % 6U) == 0U) {
        updateAirtime();
        changes |= TelemetryChange::Airtime;
    }
    if(!capture_paused_ && (tick_ % 8U) == 0U) {
        updateNodes();
        changes |= TelemetryChange::Nodes;
    }
    if(survey_.running && !capture_paused_) {
        survey_.elapsed_ms = std::min(60000U, survey_.elapsed_ms + kLiveTelemetryStepMs);
        survey_.noise_floor_dbm = spectrum_.noise_floor_dbm;
        if((tick_ % 3U) == 0U) {
            ++survey_.generation;
            changes |= TelemetryChange::Survey;
        }
        if(survey_.elapsed_ms >= 60000U) {
            survey_.running = false;
            survey_.complete = true;
            ++survey_.generation;
            appendEvent(SimulatedEventKind::SurveyComplete, SimulatedEventSeverity::Success,
                        static_cast<std::int32_t>(survey_.frames));
            changes |= TelemetryChange::Survey;
            changes |= TelemetryChange::Events;
            changes |= TelemetryChange::Timeline;
        }
    }

    if(!capture_paused_ && (tick_ % 240U) == 0U) {
        maybeAppendSemanticEvent();
        changes |= TelemetryChange::Events;
        changes |= TelemetryChange::Timeline;
    }
    return changes;
}

std::uint32_t LiveTelemetry::nextRandom() noexcept
{
    random_state_ ^= random_state_ << 13U;
    random_state_ ^= random_state_ >> 17U;
    random_state_ ^= random_state_ << 5U;
    return random_state_;
}

std::uint32_t LiveTelemetry::sampleHash(std::uint64_t generation,
                                        std::uint32_t lane) const noexcept
{
    const std::uint32_t low = static_cast<std::uint32_t>(generation);
    const std::uint32_t high = static_cast<std::uint32_t>(generation >> 32U);
    return mix32(seed_ ^ low * 0x9e3779b9U ^ high * 0x85ebca6bU ^ lane * 0xc2b2ae35U);
}

void LiveTelemetry::writeSpectrumRow(std::uint64_t generation) noexcept
{
    spectrum_.newest_row = (spectrum_.newest_row + 1U) % kSpectrumHistoryRowCount;
    std::array<std::uint8_t, kSpectrumColumnCount> &row =
        spectrum_.rows[spectrum_.newest_row];

    const int persistent_center = 65 + triangle(generation / 4U, 12) - 6;
    const bool burst_active = ((generation / 13U) % 7U) < 2U;
    const int burst_center = 25 + triangle(generation / 2U, 8) - 4;
    const bool lora_active = (generation % 41U) < 4U;
    const int lora_center = 96 + triangle(generation, 10) - 5;
    const bool wideband_active = (generation % 113U) >= 82U &&
                                 (generation % 113U) <= 91U;

    for(std::size_t column = 0U; column < kSpectrumColumnCount; ++column) {
        const std::uint32_t noise = sampleHash(generation, static_cast<std::uint32_t>(column));
        int energy = 7 + static_cast<int>(noise % 19U);

        const int persistent_distance =
            absolute(static_cast<int>(column) - persistent_center);
        if(persistent_distance <= 5) energy += (6 - persistent_distance) * 29;

        const int burst_distance = absolute(static_cast<int>(column) - burst_center);
        if(burst_active && burst_distance <= 9) energy += (10 - burst_distance) * 17;

        const int lora_distance = absolute(static_cast<int>(column) - lora_center);
        if(lora_active && lora_distance <= 12) energy += 118 - lora_distance * 6;

        if(wideband_active && column >= 44U && column <= 86U) {
            energy += 42 + static_cast<int>((noise >> 9U) % 32U);
        }
        if((noise & 0xffU) > 246U) energy += 54;

        row[column] = static_cast<std::uint8_t>(clampValue(energy, 0, 255));
    }
    spectrum_.row_generation = generation;
}

void LiveTelemetry::updateSpectrumMetrics() noexcept
{
    std::uint32_t busiest_energy = 0U;
    std::uint32_t quietest_energy = std::numeric_limits<std::uint32_t>::max();
    std::size_t busiest_column = 0U;
    std::size_t quietest_column = 0U;
    std::uint8_t peak = 0U;
    std::uint64_t total_energy = 0U;

    for(std::size_t column = 0U; column < kSpectrumColumnCount; ++column) {
        std::uint32_t column_energy = 0U;
        for(std::size_t row = 0U; row < kSpectrumHistoryRowCount; ++row) {
            const std::uint8_t value = spectrum_.rows[row][column];
            column_energy += value;
            total_energy += value;
            peak = std::max(peak, value);
        }
        if(column_energy > busiest_energy) {
            busiest_energy = column_energy;
            busiest_column = column;
        }
        if(column_energy < quietest_energy) {
            quietest_energy = column_energy;
            quietest_column = column;
        }
    }

    const auto frequencyForColumn = [](std::size_t column) noexcept {
        return kSpectrumStartKhz + static_cast<std::uint32_t>(
            (column * kSpectrumSpanKhz) / (kSpectrumColumnCount - 1U));
    };
    spectrum_.busiest_frequency_khz = frequencyForColumn(busiest_column);
    spectrum_.quietest_frequency_khz = frequencyForColumn(quietest_column);
    spectrum_.peak_intensity = peak;
    const std::uint64_t average = total_energy /
        static_cast<std::uint64_t>(kSpectrumColumnCount * kSpectrumHistoryRowCount);
    spectrum_.noise_floor_dbm = static_cast<std::int16_t>(
        clampValue(-119 + static_cast<int>(average / 7U), -119, -104));
}

TrafficSample LiveTelemetry::makeTrafficSample() noexcept
{
    TrafficSample sample{};
    sample.sequence = traffic_.generation + 1U;
    sample.timestamp_seconds_of_day = clockSecondsOfDay();
    sample.center_frequency_hz = active_rf_profile_.center_frequency_hz;
    sample.bandwidth_hz = active_rf_profile_.bandwidth_hz;
    sample.spreading_factor = active_rf_profile_.spreading_factor;
    sample.coding_rate_denominator = active_rf_profile_.coding_rate_denominator;
    sample.preamble_symbols = simulatedPreambleSymbols(active_rf_profile_);
    sample.sync_word = active_rf_profile_.sync_word;
    sample.profile_id = active_rf_profile_.profile_id;

    sample.protocol = active_rf_profile_.protocol == SimulatedProtocol::Count
        ? SimulatedProtocol::Unknown : active_rf_profile_.protocol;

    const std::uint32_t outcome_roll = nextRandom() % 100U;
    if(sample.protocol == SimulatedProtocol::Unknown) {
        sample.decode_outcome = SimulatedDecodeOutcome::Raw;
    } else if((sample.sequence % 19U) == 0U || outcome_roll < 3U) {
        sample.decode_outcome = SimulatedDecodeOutcome::Malformed;
    } else if(sample.protocol == SimulatedProtocol::MeshCore &&
              ((sample.sequence % 11U) == 0U || outcome_roll < 14U)) {
        sample.decode_outcome = SimulatedDecodeOutcome::Decoded;
    } else {
        sample.decode_outcome = SimulatedDecodeOutcome::Opaque;
    }

    const std::uint32_t source_roll = nextRandom();
    const bool exposes_route = sample.protocol == SimulatedProtocol::Meshtastic;
    sample.source_node = exposes_route
        ? static_cast<std::uint8_t>(source_roll % kNodeCount) : kNoNode;
    if((nextRandom() % 100U) < 57U) {
        sample.destination_node = kNoNode;
    } else {
        const std::uint32_t destination_roll = nextRandom();
        if(exposes_route) {
            std::uint8_t destination = static_cast<std::uint8_t>(
                destination_roll % kNodeCount);
            if(destination == sample.source_node) {
                destination = static_cast<std::uint8_t>((destination + 1U) % kNodeCount);
            }
            sample.destination_node = destination;
        }
    }
    const std::uint8_t generated_port = static_cast<std::uint8_t>(nextRandom() % 6U);
    constexpr std::array<std::uint8_t, 4U> meshcore_header_types = {{9U, 10U, 11U, 15U}};
    sample.port = sample.decode_outcome == SimulatedDecodeOutcome::Decoded
        ? 3U : (sample.protocol == SimulatedProtocol::MeshCore
                    ? meshcore_header_types[generated_port % meshcore_header_types.size()] : 0U);
    const std::uint8_t generated_hops = static_cast<std::uint8_t>(nextRandom() % 4U);
    sample.hops = exposes_route ? generated_hops : 0U;
    sample.snr_db_x10 = static_cast<std::int16_t>(-42 - static_cast<int>(nextRandom() % 131U));
    sample.rssi_dbm_x10 = static_cast<std::int16_t>(clampValue(
        -900 + sample.snr_db_x10 / 2 -
            static_cast<int>((sample.sequence * 17U + sample.source_node * 13U) % 81U),
        -1250, -650));
    sample.has_frequency_error = (sample.sequence % 5U) != 0U;
    sample.frequency_error_hz = sample.has_frequency_error
        ? static_cast<std::int32_t>((sampleHash(sample.sequence, 0x9f0U) % 5001U)) - 2500
        : 0;
    sample.captured_bytes = static_cast<std::uint16_t>(81U + nextRandom() % 40U);
    if(sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
        sample.captured_bytes = sample.protocol == SimulatedProtocol::Meshtastic ? 8U : 1U;
    }
    sample.airtime_us = simulatedLoRaAirtimeUs(active_rf_profile_, sample.captured_bytes);
    sample.crc_valid = (nextRandom() % 100U) >= 5U;
    if(sample.decode_outcome == SimulatedDecodeOutcome::Raw ||
       sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
        sample.source_node = kNoNode;
        sample.destination_node = kNoNode;
        sample.port = 0U;
        sample.hops = 0U;
        sample.payload_offset = 0U;
        sample.payload_bytes = 0U;
    } else {
        if(sample.protocol == SimulatedProtocol::Meshtastic) {
            sample.payload_offset = 16U;
        } else if(sample.protocol == SimulatedProtocol::MeshCore) {
            const std::uint16_t path_hash_count = static_cast<std::uint16_t>(
                sample.sequence % 4U);
            const std::uint16_t path_hash_size = static_cast<std::uint16_t>(
                1U + sample.sequence % 3U);
            sample.payload_offset = static_cast<std::uint16_t>(
                2U + path_hash_count * path_hash_size);
        } else if(sample.protocol == SimulatedProtocol::Reticulum) {
            sample.payload_offset = (sample.sequence % 2U) == 0U ? 36U : 20U;
        }
        sample.payload_bytes = static_cast<std::uint16_t>(
            sample.captured_bytes - sample.payload_offset);
    }
    fillTrafficBytes(sample);
    return sample;
}

void LiveTelemetry::fillTrafficBytes(TrafficSample &sample) const noexcept
{
    for(std::size_t offset = 0U; offset < sample.captured_bytes; ++offset) {
        sample.bytes[offset] = static_cast<std::uint8_t>(sampleHash(
            sample.sequence, static_cast<std::uint32_t>(0x700U + offset)));
    }
    if(sample.decode_outcome == SimulatedDecodeOutcome::Raw) {
        return;
    }
    if(sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
        if(sample.protocol == SimulatedProtocol::Meshtastic) {
            putLittleEndian32(sample.bytes, 4U, 0U);
        } else if(sample.protocol == SimulatedProtocol::MeshCore) {
            sample.bytes[0U] = 1U;
        } else if(sample.protocol == SimulatedProtocol::Reticulum) {
            sample.bytes[0U] = 0U;
        }
        return;
    }

    if(sample.protocol == SimulatedProtocol::Meshtastic) {
        const std::uint32_t destination = sample.destination_node == kNoNode
            ? 0xffffffffU : kNodeIds[sample.destination_node % kNodeCount];
        putLittleEndian32(sample.bytes, 0U, destination);
        putLittleEndian32(sample.bytes, 4U, kNodeIds[sample.source_node % kNodeCount]);
        putLittleEndian32(sample.bytes, 8U, mix32(
            seed_ ^ static_cast<std::uint32_t>(sample.sequence)));
        const std::uint8_t hops = static_cast<std::uint8_t>(sample.hops & 0x07U);
        sample.bytes[12U] = static_cast<std::uint8_t>(hops << 5U);
        sample.bytes[13U] = static_cast<std::uint8_t>(sample.sequence * 29U);
        sample.bytes[14U] = sample.destination_node == kNoNode
            ? 0xffU : static_cast<std::uint8_t>(kNodeIds[sample.destination_node] >> 24U);
        sample.bytes[15U] = static_cast<std::uint8_t>(kNodeIds[sample.source_node] >> 24U);
        return;
    }

    if(sample.protocol == SimulatedProtocol::MeshCore) {
        const std::uint8_t route = (sample.sequence % 2U) == 0U ? 1U : 2U;
        const std::uint8_t path_hash_count = static_cast<std::uint8_t>(sample.sequence % 4U);
        const std::uint8_t path_hash_size = static_cast<std::uint8_t>(
            1U + sample.sequence % 3U);
        sample.bytes[0U] = static_cast<std::uint8_t>((sample.port << 2U) | route);
        sample.bytes[1U] = static_cast<std::uint8_t>(
            ((path_hash_size - 1U) << 6U) | path_hash_count);
        if(sample.decode_outcome == SimulatedDecodeOutcome::Decoded) {
            putLittleEndian32(sample.bytes, sample.payload_offset,
                              mix32(seed_ ^ static_cast<std::uint32_t>(sample.sequence)));
        }
        return;
    }

    if(sample.protocol == SimulatedProtocol::Reticulum) {
        const bool header_two = sample.payload_offset == 36U;
        sample.bytes[0U] = 0U;
        sample.bytes[1U] = static_cast<std::uint8_t>((header_two ? 0x40U : 0U) | 0x08U);
        sample.bytes[2U] = 0U;
        if(header_two) {
            putNetwork32(sample.bytes, 3U, mix32(
                seed_ ^ static_cast<std::uint32_t>(sample.sequence) ^ 0x524e5301U));
        }
        const std::size_t destination_offset = header_two ? 19U : 3U;
        putNetwork32(sample.bytes, destination_offset, mix32(
            seed_ ^ static_cast<std::uint32_t>(sample.sequence) ^ 0x524e5302U));
        sample.bytes[destination_offset + 16U] = 0U;
    }
}

void LiveTelemetry::appendTraffic(const TrafficSample &sample, bool live) noexcept
{
    traffic_.newest_row = (traffic_.newest_row + 1U) % kTrafficHistoryCapacity;
    traffic_.rows[traffic_.newest_row] = sample;
    traffic_.size = std::min(traffic_.size + 1U, kTrafficHistoryCapacity);
    ++traffic_.generation;

    const bool contributes_to_node = updateNodeFromTraffic(sample);
    if(!live) return;
    const std::size_t protocol = protocolIndex(sample.protocol);
    std::uint8_t &bucket = protocol_buckets_[minute_bucket_][protocol];
    if(bucket < std::numeric_limits<std::uint8_t>::max()) ++bucket;
    if(!sample.crc_valid) {
        std::uint8_t &crc_bucket = protocol_crc_buckets_[minute_bucket_][protocol];
        if(crc_bucket < std::numeric_limits<std::uint8_t>::max()) ++crc_bucket;
    }
    protocol_snr_sum_buckets_[minute_bucket_][protocol] += sample.snr_db_x10;
    if(sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
        std::uint8_t &malformed = protocol_malformed_buckets_[minute_bucket_][protocol];
        if(malformed < std::numeric_limits<std::uint8_t>::max()) ++malformed;
    } else {
        if(!sample.crc_valid) {
            std::uint8_t &crc = protocol_nonmalformed_crc_buckets_[minute_bucket_][protocol];
            if(crc < std::numeric_limits<std::uint8_t>::max()) ++crc;
        }
        protocol_nonmalformed_snr_sum_buckets_[minute_bucket_][protocol] += sample.snr_db_x10;
        std::uint8_t &count = protocol_nonmalformed_snr_count_buckets_[minute_bucket_][protocol];
        if(count < std::numeric_limits<std::uint8_t>::max()) ++count;
    }
    if(sample.decode_outcome == SimulatedDecodeOutcome::Opaque) {
        std::uint8_t &opaque = opaque_buckets_[minute_bucket_];
        if(opaque < std::numeric_limits<std::uint8_t>::max()) ++opaque;
    } else if(sample.decode_outcome == SimulatedDecodeOutcome::Raw) {
        std::uint8_t &raw = raw_buckets_[minute_bucket_];
        if(raw < std::numeric_limits<std::uint8_t>::max()) ++raw;
    } else if(sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
        std::uint8_t &malformed = malformed_buckets_[minute_bucket_];
        if(malformed < std::numeric_limits<std::uint8_t>::max()) ++malformed;
    }
    addTimelinePacket(minute_bucket_, sample);
    updateProtocolMix();

    const std::size_t source = contributes_to_node
        ? sample.source_node : 0U;

    if(survey_.running) {
        ++survey_.frames;
        if(!sample.crc_valid && survey_.crc_invalid_frames !=
                                std::numeric_limits<std::uint32_t>::max()) {
            ++survey_.crc_invalid_frames;
        }
        if(contributes_to_node) {
            survey_nodes_mask_ = static_cast<std::uint8_t>(
                survey_nodes_mask_ | (1U << source));
        }
        std::uint8_t heard = 0U;
        for(std::size_t node_index = 0U; node_index < kNodeCount; ++node_index) {
            if((survey_nodes_mask_ & (1U << node_index)) != 0U) ++heard;
        }
        survey_.nodes_heard = heard;
        if(survey_.frames == 1U || sample.snr_db_x10 > survey_.best_snr_db_x10) {
            survey_.best_snr_db_x10 = sample.snr_db_x10;
        }
        ++survey_.generation;
    }

    for(std::size_t index = 1U; index < kAirtimeBarCount; ++index) {
        airtime_.bars_airtime_us[index - 1U] = airtime_.bars_airtime_us[index];
        airtime_.bar_crc_invalid[index - 1U] = airtime_.bar_crc_invalid[index];
    }
    airtime_.bars_airtime_us[kAirtimeBarCount - 1U] = sample.airtime_us;
    airtime_.bar_crc_invalid[kAirtimeBarCount - 1U] = !sample.crc_valid;
}

bool LiveTelemetry::updateNodeFromTraffic(const TrafficSample &sample) noexcept
{
    if(sample.source_node == kNoNode || sample.source_node >= kNodeCount ||
       sample.decode_outcome == SimulatedDecodeOutcome::Raw ||
       sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
        return false;
    }

    const std::size_t source = sample.source_node;
    NodeSnapshot &node = nodes_.nodes[source];
    if(node.protocol != sample.protocol) return false;

    if(!sample.crc_valid) {
        if(node.frame_count != 0U && node.crc_errors !=
                                      std::numeric_limits<std::uint16_t>::max()) {
            ++node.crc_errors;
            ++nodes_.generation;
        }
        return false;
    }

    const std::uint32_t now = clockSecondsOfDay();
    const std::uint32_t age_seconds = now >= sample.timestamp_seconds_of_day
        ? now - sample.timestamp_seconds_of_day
        : now + kSecondsPerDay - sample.timestamp_seconds_of_day;
    node_age_ms_[source] = age_seconds * 1000U;
    node.last_seen_seconds = age_seconds;
    node.active = age_seconds <= 20U * 60U;
    node.latest_snr_db_x10 = sample.snr_db_x10;
    node.latest_rssi_dbm_x10 = sample.rssi_dbm_x10;

    if(node.frame_count != std::numeric_limits<std::uint16_t>::max()) {
        ++node.frame_count;
        node_snr_sum_db_x10_[source] += sample.snr_db_x10;
        node.mean_snr_db_x10 = static_cast<std::int16_t>(
            node_snr_sum_db_x10_[source] / node.frame_count);
    }

    node.newest_sample = (node.newest_sample + 1U) % kNodeHistoryCapacity;
    node.snr_history_db_x10[node.newest_sample] = sample.snr_db_x10;
    node.rssi_history_dbm_x10[node.newest_sample] = sample.rssi_dbm_x10;
    node.history_size = std::min(node.history_size + 1U, kNodeHistoryCapacity);
    ++node.history_generation;
    ++nodes_.generation;
    return true;
}

void LiveTelemetry::rotateMinuteBucket() noexcept
{
    minute_bucket_ = (minute_bucket_ + 1U) % protocol_buckets_.size();
    protocol_buckets_[minute_bucket_].fill(0U);
    protocol_crc_buckets_[minute_bucket_].fill(0U);
    protocol_malformed_buckets_[minute_bucket_].fill(0U);
    protocol_nonmalformed_crc_buckets_[minute_bucket_].fill(0U);
    protocol_snr_sum_buckets_[minute_bucket_].fill(0);
    protocol_nonmalformed_snr_sum_buckets_[minute_bucket_].fill(0);
    protocol_nonmalformed_snr_count_buckets_[minute_bucket_].fill(0U);
    opaque_buckets_[minute_bucket_] = 0U;
    raw_buckets_[minute_bucket_] = 0U;
    malformed_buckets_[minute_bucket_] = 0U;
    timeline_snr_samples_[minute_bucket_].fill(0);
    timeline_snr_sample_counts_[minute_bucket_] = 0U;
    timeline_.newest_bucket = minute_bucket_;
    timeline_.buckets[minute_bucket_] = {};
    timeline_.buckets[minute_bucket_].timestamp_seconds_of_day = clockSecondsOfDay();
    ++timeline_.generation;
    updateProtocolMix();
}

void LiveTelemetry::updateProtocolMix() noexcept
{
    protocol_mix_.packets_last_minute.fill(0U);
    protocol_mix_.crc_failures_last_minute.fill(0U);
    protocol_mix_.malformed_by_protocol_last_minute.fill(0U);
    protocol_mix_.nonmalformed_crc_failures_last_minute.fill(0U);
    protocol_mix_.opaque_last_minute = 0U;
    protocol_mix_.raw_last_minute = 0U;
    protocol_mix_.malformed_last_minute = 0U;
    std::array<std::int64_t, kProtocolCount> snr_sum{};
    std::array<std::int64_t, kProtocolCount> nonmalformed_snr_sum{};
    std::array<std::uint16_t, kProtocolCount> nonmalformed_snr_count{};
    for(std::size_t bucket_index = 0U; bucket_index < protocol_buckets_.size(); ++bucket_index) {
        for(std::size_t protocol = 0U; protocol < kProtocolCount; ++protocol) {
            protocol_mix_.packets_last_minute[protocol] = static_cast<std::uint16_t>(
                protocol_mix_.packets_last_minute[protocol] +
                protocol_buckets_[bucket_index][protocol]);
            protocol_mix_.crc_failures_last_minute[protocol] = static_cast<std::uint16_t>(
                protocol_mix_.crc_failures_last_minute[protocol] +
                protocol_crc_buckets_[bucket_index][protocol]);
            protocol_mix_.malformed_by_protocol_last_minute[protocol] =
                static_cast<std::uint16_t>(
                    protocol_mix_.malformed_by_protocol_last_minute[protocol] +
                    protocol_malformed_buckets_[bucket_index][protocol]);
            protocol_mix_.nonmalformed_crc_failures_last_minute[protocol] =
                static_cast<std::uint16_t>(
                    protocol_mix_.nonmalformed_crc_failures_last_minute[protocol] +
                    protocol_nonmalformed_crc_buckets_[bucket_index][protocol]);
            snr_sum[protocol] += protocol_snr_sum_buckets_[bucket_index][protocol];
            nonmalformed_snr_sum[protocol] +=
                protocol_nonmalformed_snr_sum_buckets_[bucket_index][protocol];
            nonmalformed_snr_count[protocol] = static_cast<std::uint16_t>(
                nonmalformed_snr_count[protocol] +
                protocol_nonmalformed_snr_count_buckets_[bucket_index][protocol]);
        }
        protocol_mix_.opaque_last_minute = static_cast<std::uint16_t>(
            protocol_mix_.opaque_last_minute + opaque_buckets_[bucket_index]);
        protocol_mix_.raw_last_minute = static_cast<std::uint16_t>(
            protocol_mix_.raw_last_minute + raw_buckets_[bucket_index]);
        protocol_mix_.malformed_last_minute = static_cast<std::uint16_t>(
            protocol_mix_.malformed_last_minute + malformed_buckets_[bucket_index]);
    }

    std::uint16_t total = 0U;
    std::size_t largest = 0U;
    for(std::size_t protocol = 0U; protocol < kProtocolCount; ++protocol) {
        total = static_cast<std::uint16_t>(
            total + protocol_mix_.packets_last_minute[protocol]);
        if(protocol_mix_.packets_last_minute[protocol] >
           protocol_mix_.packets_last_minute[largest]) {
            largest = protocol;
        }
    }
    protocol_mix_.total_last_minute = total;
    const std::uint16_t undecoded = static_cast<std::uint16_t>(
        protocol_mix_.opaque_last_minute + protocol_mix_.raw_last_minute +
        protocol_mix_.malformed_last_minute);
    protocol_mix_.decoded_last_minute = undecoded <= total
        ? static_cast<std::uint16_t>(total - undecoded) : 0U;
    protocol_mix_.share_percent.fill(0U);
    protocol_mix_.crc_valid_percent.fill(0U);
    protocol_mix_.mean_snr_db_x10.fill(0);
    protocol_mix_.nonmalformed_mean_snr_db_x10.fill(0);
    if(total > 0U) {
        std::uint16_t assigned = 0U;
        for(std::size_t protocol = 0U; protocol < kProtocolCount; ++protocol) {
            const std::uint16_t count = protocol_mix_.packets_last_minute[protocol];
            const std::uint8_t share = static_cast<std::uint8_t>(
                (static_cast<std::uint32_t>(protocol_mix_.packets_last_minute[protocol]) * 100U) /
                total);
            protocol_mix_.share_percent[protocol] = share;
            assigned = static_cast<std::uint16_t>(assigned + share);
            if(count > 0U) {
                const std::uint16_t failures = protocol_mix_.crc_failures_last_minute[protocol];
                protocol_mix_.crc_valid_percent[protocol] = static_cast<std::uint8_t>(
                    (static_cast<std::uint32_t>(count - failures) * 100U) / count);
                protocol_mix_.mean_snr_db_x10[protocol] = static_cast<std::int16_t>(
                    snr_sum[protocol] / count);
            }
            if(nonmalformed_snr_count[protocol] > 0U) {
                protocol_mix_.nonmalformed_mean_snr_db_x10[protocol] =
                    static_cast<std::int16_t>(nonmalformed_snr_sum[protocol] /
                                              nonmalformed_snr_count[protocol]);
            }
        }
        protocol_mix_.share_percent[largest] = static_cast<std::uint8_t>(
            protocol_mix_.share_percent[largest] + (100U - assigned));
    }
    traffic_.packets_per_minute = total;
    ++protocol_mix_.generation;
}

void LiveTelemetry::addTimelinePacket(std::size_t bucket_index,
                                      const TrafficSample &sample) noexcept
{
    if(bucket_index >= kTimelineBucketCount) return;
    RfTimelineBucket &bucket = timeline_.buckets[bucket_index];
    if(bucket.packets_per_second < std::numeric_limits<std::uint16_t>::max()) {
        ++bucket.packets_per_second;
    }
    bucket.has_packets = true;
    bucket.airtime_us += sample.airtime_us;
    bucket.snr_sum_db_x10 += sample.snr_db_x10;
    if(bucket.snr_sample_count != std::numeric_limits<std::uint16_t>::max()) {
        ++bucket.snr_sample_count;
    }
    if(!sample.crc_valid) {
        if(bucket.crc_failures < std::numeric_limits<std::uint16_t>::max()) {
            ++bucket.crc_failures;
        }
        bucket.markers |= TimelineMarker::CrcFailure;
    }

    std::uint8_t &sample_count = timeline_snr_sample_counts_[bucket_index];
    std::array<std::int16_t, kTimelineSnrSampleCapacity> &samples =
        timeline_snr_samples_[bucket_index];
    if(sample_count < kTimelineSnrSampleCapacity) {
        std::size_t insertion = sample_count;
        while(insertion > 0U && samples[insertion - 1U] > sample.snr_db_x10) {
            samples[insertion] = samples[insertion - 1U];
            --insertion;
        }
        samples[insertion] = sample.snr_db_x10;
        ++sample_count;
    }
    if(sample_count > 0U) {
        const std::size_t middle = sample_count / 2U;
        bucket.median_snr_db_x10 = (sample_count % 2U) == 1U
            ? samples[middle]
            : static_cast<std::int16_t>((static_cast<std::int32_t>(samples[middle - 1U]) +
                                         samples[middle]) / 2);
    }
    ++timeline_.generation;
}

void LiveTelemetry::addTimelineMarker(TimelineMarker marker) noexcept
{
    if(marker == TimelineMarker::None) return;
    timeline_.buckets[timeline_.newest_bucket].markers |= marker;
    ++timeline_.generation;
}

void LiveTelemetry::updateNodes() noexcept
{
    for(std::size_t node_index = 0U; node_index < kNodeCount; ++node_index) {
        NodeSnapshot &node = nodes_.nodes[node_index];
        if(node.frame_count == 0U) {
            node.last_seen_seconds = 0U;
            node.active = false;
            continue;
        }
        node.last_seen_seconds = node_age_ms_[node_index] / 1000U;
        node.active = node.last_seen_seconds <= 20U * 60U;
    }
    ++nodes_.generation;
}

void LiveTelemetry::updateAirtime() noexcept
{
    std::uint64_t rolling_airtime_us = 0U;
    std::uint8_t peak_second_percent = 0U;
    for(const RfTimelineBucket &bucket : timeline_.buckets) {
        rolling_airtime_us += bucket.airtime_us;
        const std::uint8_t bucket_percent = static_cast<std::uint8_t>(
            std::min<std::uint64_t>(100U, bucket.airtime_us / 10000U));
        peak_second_percent = std::max(peak_second_percent, bucket_percent);
    }
    airtime_.utilization_percent = static_cast<std::uint8_t>(
        std::min<std::uint64_t>(100U, rolling_airtime_us / 600000U));
    airtime_.peak_one_minute_percent = peak_second_percent;
    airtime_.noise_floor_dbm = spectrum_.noise_floor_dbm;
    ++airtime_.generation;
}

void LiveTelemetry::appendEvent(SimulatedEventKind kind, SimulatedEventSeverity severity,
                                std::int32_t value, std::uint8_t node,
                                bool mark_timeline) noexcept
{
    events_.newest_row = (events_.newest_row + 1U) % kEventHistoryCapacity;
    EventSample &event = events_.rows[events_.newest_row];
    event.sequence = events_.generation + 1U;
    event.timestamp_seconds_of_day = clockSecondsOfDay();
    event.kind = kind;
    event.severity = severity;
    event.value = value;
    event.node = node;
    events_.size = std::min(events_.size + 1U, kEventHistoryCapacity);
    ++events_.generation;

    if(!mark_timeline) return;
    TimelineMarker marker = TimelineMarker::None;
    switch(kind) {
        case SimulatedEventKind::NodeAppeared:
        case SimulatedEventKind::NodeSilent:
            marker = TimelineMarker::NodeChange;
            break;
        case SimulatedEventKind::Interference:
            marker = TimelineMarker::Interference;
            break;
        case SimulatedEventKind::HighUtilization:
            marker = TimelineMarker::HighUtilization;
            break;
        case SimulatedEventKind::TrafficBurst:
            marker = TimelineMarker::TrafficBurst;
            break;
        case SimulatedEventKind::SurveyComplete:
            marker = TimelineMarker::SurveyComplete;
            break;
        case SimulatedEventKind::CaptureReady:
        default:
            break;
    }
    addTimelineMarker(marker);
}

void LiveTelemetry::maybeAppendSemanticEvent() noexcept
{
    switch((tick_ / 240U) % 4U) {
        case 0U:
            appendEvent(SimulatedEventKind::NodeAppeared, SimulatedEventSeverity::Success,
                        nodes_.nodes[4U].latest_snr_db_x10, 4U);
            break;
        case 1U:
            appendEvent(SimulatedEventKind::Interference, SimulatedEventSeverity::Warning,
                        static_cast<std::int32_t>(spectrum_.busiest_frequency_khz));
            break;
        case 2U:
            appendEvent(SimulatedEventKind::HighUtilization, SimulatedEventSeverity::Warning,
                        airtime_.utilization_percent);
            break;
        case 3U:
        default:
            appendEvent(SimulatedEventKind::TrafficBurst, SimulatedEventSeverity::Info,
                        traffic_.packets_per_minute);
            break;
    }
}

} // namespace lilyshark::simulator

#endif
