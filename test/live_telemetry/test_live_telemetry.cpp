#include "lilyshark/simulator/live_telemetry.h"

#if defined(LILYSHARK_LIVE_TELEMETRY_DECODER_CROSSCHECK)
#include "lilyshark/core/radio_profile.h"
#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshtastic_decoder.h"
#include "lilyshark/protocols/reticulum_decoder.h"
#endif

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <limits>

namespace {

using namespace lilyshark::simulator;

class Fingerprint {
  public:
    template <typename Value>
    void add(Value value) noexcept
    {
        const std::uint64_t converted = static_cast<std::uint64_t>(value);
        for(std::size_t byte = 0U; byte < sizeof(Value); ++byte) {
            value_ ^= (converted >> (byte * 8U)) & 0xffU;
            value_ *= 1099511628211ULL;
        }
    }

    std::uint64_t value() const noexcept { return value_; }

  private:
    std::uint64_t value_ = 1469598103934665603ULL;
};

std::uint64_t publicStateFingerprint(const LiveTelemetry &telemetry)
{
    Fingerprint fingerprint{};
    fingerprint.add(telemetry.seed());
    fingerprint.add(telemetry.tick());
    fingerprint.add(telemetry.elapsedMilliseconds());
    fingerprint.add(telemetry.clockSecondsOfDay());
    fingerprint.add(static_cast<std::uint8_t>(telemetry.activeProtocol()));
    fingerprint.add(telemetry.activeRfProfile().center_frequency_hz);
    fingerprint.add(telemetry.activeRfProfile().bandwidth_hz);
    fingerprint.add(telemetry.activeRfProfile().spreading_factor);
    fingerprint.add(telemetry.activeRfProfile().coding_rate_denominator);
    fingerprint.add(telemetry.activeRfProfile().sync_word);
    fingerprint.add(telemetry.activeRfProfile().profile_id);

    const SpectrumSnapshot &spectrum = telemetry.spectrum();
    fingerprint.add(spectrum.newest_row);
    fingerprint.add(spectrum.row_generation);
    fingerprint.add(spectrum.noise_floor_dbm);
    fingerprint.add(spectrum.busiest_frequency_khz);
    fingerprint.add(spectrum.quietest_frequency_khz);
    fingerprint.add(spectrum.peak_intensity);
    for(const auto &row : spectrum.rows) {
        for(const std::uint8_t value : row) fingerprint.add(value);
    }

    const TrafficSnapshot &traffic = telemetry.traffic();
    fingerprint.add(traffic.newest_row);
    fingerprint.add(traffic.size);
    fingerprint.add(traffic.generation);
    fingerprint.add(traffic.packets_per_minute);
    for(const TrafficSample &sample : traffic.rows) {
        fingerprint.add(sample.sequence);
        fingerprint.add(sample.timestamp_seconds_of_day);
        fingerprint.add(static_cast<std::uint8_t>(sample.protocol));
        fingerprint.add(sample.source_node);
        fingerprint.add(sample.destination_node);
        fingerprint.add(sample.port);
        fingerprint.add(sample.hops);
        fingerprint.add(sample.snr_db_x10);
        fingerprint.add(sample.rssi_dbm_x10);
        fingerprint.add(sample.center_frequency_hz);
        fingerprint.add(sample.bandwidth_hz);
        fingerprint.add(sample.spreading_factor);
        fingerprint.add(sample.coding_rate_denominator);
        fingerprint.add(sample.preamble_symbols);
        fingerprint.add(sample.sync_word);
        fingerprint.add(sample.profile_id);
        fingerprint.add(sample.frequency_error_hz);
        fingerprint.add(sample.has_frequency_error);
        fingerprint.add(sample.airtime_us);
        fingerprint.add(sample.captured_bytes);
        fingerprint.add(sample.payload_offset);
        fingerprint.add(sample.payload_bytes);
        for(const std::uint8_t byte : sample.bytes) fingerprint.add(byte);
        fingerprint.add(static_cast<std::uint8_t>(sample.decode_outcome));
        fingerprint.add(sample.crc_valid);
    }

    const NodesSnapshot &nodes = telemetry.nodes();
    fingerprint.add(nodes.generation);
    for(const NodeSnapshot &node : nodes.nodes) {
        fingerprint.add(node.newest_sample);
        fingerprint.add(node.history_size);
        fingerprint.add(node.history_generation);
        fingerprint.add(node.id);
        fingerprint.add(static_cast<std::uint8_t>(node.protocol));
        fingerprint.add(node.frame_count);
        fingerprint.add(node.crc_errors);
        fingerprint.add(node.last_seen_seconds);
        fingerprint.add(node.latest_snr_db_x10);
        fingerprint.add(node.mean_snr_db_x10);
        fingerprint.add(node.latest_rssi_dbm_x10);
        fingerprint.add(node.battery_percent);
        fingerprint.add(node.active);
        for(const std::int16_t snr : node.snr_history_db_x10) fingerprint.add(snr);
        for(const std::int16_t rssi : node.rssi_history_dbm_x10) fingerprint.add(rssi);
    }

    const SurveySnapshot &survey = telemetry.survey();
    fingerprint.add(survey.running);
    fingerprint.add(survey.complete);
    fingerprint.add(survey.elapsed_ms);
    fingerprint.add(survey.frames);
    fingerprint.add(survey.crc_invalid_frames);
    fingerprint.add(survey.nodes_heard);
    fingerprint.add(survey.best_snr_db_x10);
    fingerprint.add(survey.noise_floor_dbm);
    fingerprint.add(survey.generation);

    const AirtimeSnapshot &airtime = telemetry.airtime();
    for(const std::uint32_t value : airtime.bars_airtime_us) fingerprint.add(value);
    for(const bool value : airtime.bar_crc_invalid) fingerprint.add(value);
    fingerprint.add(airtime.utilization_percent);
    fingerprint.add(airtime.peak_one_minute_percent);
    fingerprint.add(airtime.noise_floor_dbm);
    fingerprint.add(airtime.generation);

    const ProtocolMixSnapshot &mix = telemetry.protocolMix();
    for(const std::uint16_t value : mix.packets_last_minute) fingerprint.add(value);
    for(const std::uint16_t value : mix.crc_failures_last_minute) fingerprint.add(value);
    for(const std::uint16_t value : mix.malformed_by_protocol_last_minute) fingerprint.add(value);
    for(const std::uint16_t value : mix.nonmalformed_crc_failures_last_minute) {
        fingerprint.add(value);
    }
    for(const std::uint8_t value : mix.share_percent) fingerprint.add(value);
    for(const std::uint8_t value : mix.crc_valid_percent) fingerprint.add(value);
    for(const std::int16_t value : mix.mean_snr_db_x10) fingerprint.add(value);
    for(const std::int16_t value : mix.nonmalformed_mean_snr_db_x10) fingerprint.add(value);
    fingerprint.add(mix.total_last_minute);
    fingerprint.add(mix.decoded_last_minute);
    fingerprint.add(mix.opaque_last_minute);
    fingerprint.add(mix.raw_last_minute);
    fingerprint.add(mix.malformed_last_minute);
    fingerprint.add(mix.generation);

    const RfTimelineSnapshot &timeline = telemetry.timeline();
    fingerprint.add(timeline.newest_bucket);
    fingerprint.add(timeline.generation);
    for(const RfTimelineBucket &bucket : timeline.buckets) {
        fingerprint.add(bucket.timestamp_seconds_of_day);
        fingerprint.add(bucket.packets_per_second);
        fingerprint.add(bucket.crc_failures);
        fingerprint.add(bucket.snr_sum_db_x10);
        fingerprint.add(bucket.snr_sample_count);
        fingerprint.add(bucket.airtime_us);
        fingerprint.add(bucket.median_snr_db_x10);
        fingerprint.add(static_cast<std::uint8_t>(bucket.markers));
        fingerprint.add(bucket.has_packets);
    }
    for(std::size_t age = 0U; age < kTimelineBucketCount; ++age) {
        for(std::size_t protocol = 0U; protocol < kProtocolCount; ++protocol) {
            const RfTimelineProtocolBucket bucket = telemetry.timelineProtocolBucket(
                static_cast<SimulatedProtocol>(protocol), age);
            fingerprint.add(bucket.frames);
            fingerprint.add(bucket.malformed_frames);
            fingerprint.add(bucket.crc_failures);
            fingerprint.add(bucket.snr_sum_db_x10);
            fingerprint.add(bucket.snr_sample_count);
        }
    }

    const EventsSnapshot &events = telemetry.events();
    fingerprint.add(events.newest_row);
    fingerprint.add(events.size);
    fingerprint.add(events.generation);
    for(const EventSample &event : events.rows) {
        fingerprint.add(event.sequence);
        fingerprint.add(event.timestamp_seconds_of_day);
        fingerprint.add(static_cast<std::uint8_t>(event.kind));
        fingerprint.add(static_cast<std::uint8_t>(event.severity));
        fingerprint.add(event.value);
        fingerprint.add(event.node);
    }
    return fingerprint.value();
}

std::uint64_t receivedStateFingerprint(const LiveTelemetry &telemetry)
{
    Fingerprint fingerprint{};

    const TrafficSnapshot &traffic = telemetry.traffic();
    fingerprint.add(traffic.newest_row);
    fingerprint.add(traffic.size);
    fingerprint.add(traffic.generation);
    fingerprint.add(traffic.packets_per_minute);
    for(const TrafficSample &sample : traffic.rows) {
        fingerprint.add(sample.sequence);
        fingerprint.add(sample.timestamp_seconds_of_day);
        fingerprint.add(static_cast<std::uint8_t>(sample.protocol));
        fingerprint.add(sample.source_node);
        fingerprint.add(sample.destination_node);
        fingerprint.add(sample.port);
        fingerprint.add(sample.hops);
        fingerprint.add(sample.snr_db_x10);
        fingerprint.add(sample.rssi_dbm_x10);
        fingerprint.add(sample.center_frequency_hz);
        fingerprint.add(sample.bandwidth_hz);
        fingerprint.add(sample.spreading_factor);
        fingerprint.add(sample.coding_rate_denominator);
        fingerprint.add(sample.preamble_symbols);
        fingerprint.add(sample.sync_word);
        fingerprint.add(sample.profile_id);
        fingerprint.add(sample.frequency_error_hz);
        fingerprint.add(sample.has_frequency_error);
        fingerprint.add(sample.airtime_us);
        fingerprint.add(sample.captured_bytes);
        fingerprint.add(sample.payload_offset);
        fingerprint.add(sample.payload_bytes);
        for(const std::uint8_t byte : sample.bytes) fingerprint.add(byte);
        fingerprint.add(static_cast<std::uint8_t>(sample.decode_outcome));
        fingerprint.add(sample.crc_valid);
    }

    const NodesSnapshot &nodes = telemetry.nodes();
    fingerprint.add(nodes.generation);
    for(const NodeSnapshot &node : nodes.nodes) {
        fingerprint.add(node.newest_sample);
        fingerprint.add(node.history_size);
        fingerprint.add(node.history_generation);
        fingerprint.add(node.id);
        fingerprint.add(static_cast<std::uint8_t>(node.protocol));
        fingerprint.add(node.frame_count);
        fingerprint.add(node.crc_errors);
        fingerprint.add(node.last_seen_seconds);
        fingerprint.add(node.latest_snr_db_x10);
        fingerprint.add(node.mean_snr_db_x10);
        fingerprint.add(node.latest_rssi_dbm_x10);
        fingerprint.add(node.battery_percent);
        fingerprint.add(node.active);
        for(const std::int16_t snr : node.snr_history_db_x10) fingerprint.add(snr);
        for(const std::int16_t rssi : node.rssi_history_dbm_x10) fingerprint.add(rssi);
    }

    const ProtocolMixSnapshot &mix = telemetry.protocolMix();
    for(const std::uint16_t value : mix.packets_last_minute) fingerprint.add(value);
    for(const std::uint16_t value : mix.crc_failures_last_minute) fingerprint.add(value);
    for(const std::uint8_t value : mix.share_percent) fingerprint.add(value);
    for(const std::uint8_t value : mix.crc_valid_percent) fingerprint.add(value);
    for(const std::int16_t value : mix.mean_snr_db_x10) fingerprint.add(value);
    fingerprint.add(mix.total_last_minute);
    fingerprint.add(mix.decoded_last_minute);
    fingerprint.add(mix.opaque_last_minute);
    fingerprint.add(mix.raw_last_minute);
    fingerprint.add(mix.malformed_last_minute);
    fingerprint.add(mix.generation);

    const RfTimelineSnapshot &timeline = telemetry.timeline();
    fingerprint.add(timeline.newest_bucket);
    fingerprint.add(timeline.generation);
    for(const RfTimelineBucket &bucket : timeline.buckets) {
        fingerprint.add(bucket.timestamp_seconds_of_day);
        fingerprint.add(bucket.packets_per_second);
        fingerprint.add(bucket.crc_failures);
        fingerprint.add(bucket.snr_sum_db_x10);
        fingerprint.add(bucket.snr_sample_count);
        fingerprint.add(bucket.airtime_us);
        fingerprint.add(bucket.median_snr_db_x10);
        fingerprint.add(static_cast<std::uint8_t>(bucket.markers));
        fingerprint.add(bucket.has_packets);
    }
    for(std::size_t age = 0U; age < kTimelineBucketCount; ++age) {
        for(std::size_t protocol = 0U; protocol < kProtocolCount; ++protocol) {
            const RfTimelineProtocolBucket bucket = telemetry.timelineProtocolBucket(
                static_cast<SimulatedProtocol>(protocol), age);
            fingerprint.add(bucket.frames);
            fingerprint.add(bucket.crc_failures);
            fingerprint.add(bucket.snr_sum_db_x10);
            fingerprint.add(bucket.snr_sample_count);
        }
    }
    return fingerprint.value();
}

void assertProtocolMixIsConsistent(const ProtocolMixSnapshot &mix)
{
    std::uint32_t total = 0U;
    std::uint32_t percent = 0U;
    std::uint32_t malformed = 0U;
    std::uint32_t exclusive_nonmalformed = 0U;
    for(std::size_t protocol = 0U; protocol < kProtocolCount; ++protocol) {
        total += mix.packets_last_minute[protocol];
        percent += mix.share_percent[protocol];
        malformed += mix.malformed_by_protocol_last_minute[protocol];
        assert(mix.malformed_by_protocol_last_minute[protocol] <=
               mix.packets_last_minute[protocol]);
        exclusive_nonmalformed += mix.packets_last_minute[protocol] -
                                  mix.malformed_by_protocol_last_minute[protocol];
        assert(mix.crc_failures_last_minute[protocol] <=
               mix.packets_last_minute[protocol]);
        assert(mix.nonmalformed_crc_failures_last_minute[protocol] <=
               mix.packets_last_minute[protocol] -
                   mix.malformed_by_protocol_last_minute[protocol]);
        assert(mix.crc_valid_percent[protocol] <= 100U);
        if(mix.packets_last_minute[protocol] > 0U) {
            assert(mix.mean_snr_db_x10[protocol] >= -220);
            assert(mix.mean_snr_db_x10[protocol] <= 20);
        }
    }
    assert(total == mix.total_last_minute);
    assert(static_cast<std::uint32_t>(mix.decoded_last_minute) +
               mix.opaque_last_minute + mix.raw_last_minute +
               mix.malformed_last_minute == total);
    assert(malformed == mix.malformed_last_minute);
    assert(exclusive_nonmalformed + mix.malformed_last_minute == total);
    assert((total == 0U && percent == 0U) || (total > 0U && percent == 100U));
}

void assertTimelineProtocolBucketsAreConsistent(const LiveTelemetry &telemetry)
{
    std::array<std::uint32_t, kProtocolCount> frames_by_protocol{};
    std::array<std::uint32_t, kProtocolCount> crc_by_protocol{};
    std::array<std::int64_t, kProtocolCount> snr_by_protocol{};

    for(std::size_t age = 0U; age < kTimelineBucketCount; ++age) {
        const RfTimelineBucket *aggregate = telemetry.timeline().newest(age);
        assert(aggregate != nullptr);
        std::uint32_t frames = 0U;
        std::uint32_t crc_failures = 0U;
        std::int64_t snr_sum = 0;
        std::uint32_t snr_samples = 0U;
        for(std::size_t protocol = 0U; protocol < kProtocolCount; ++protocol) {
            const RfTimelineProtocolBucket bucket = telemetry.timelineProtocolBucket(
                static_cast<SimulatedProtocol>(protocol), age);
            assert(bucket.crc_failures <= bucket.frames);
            assert(bucket.malformed_frames <= bucket.frames);
            assert(bucket.snr_sample_count == bucket.frames);
            if(bucket.frames == 0U) {
                assert(!bucket.hasMeanSnr());
                assert(bucket.meanSnrDbX10() == 0);
                assert(bucket.snr_sum_db_x10 == 0);
            } else {
                assert(bucket.hasMeanSnr());
                assert(bucket.meanSnrDbX10() >= -220);
                assert(bucket.meanSnrDbX10() <= 20);
            }
            frames += bucket.frames;
            crc_failures += bucket.crc_failures;
            snr_sum += bucket.snr_sum_db_x10;
            snr_samples += bucket.snr_sample_count;
            frames_by_protocol[protocol] += bucket.frames;
            crc_by_protocol[protocol] += bucket.crc_failures;
            snr_by_protocol[protocol] += bucket.snr_sum_db_x10;
        }
        assert(frames == aggregate->packets_per_second);
        assert(crc_failures == aggregate->crc_failures);
        assert(snr_sum == aggregate->snr_sum_db_x10);
        assert(snr_samples == aggregate->snr_sample_count);
    }

    const ProtocolMixSnapshot &mix = telemetry.protocolMix();
    for(std::size_t protocol = 0U; protocol < kProtocolCount; ++protocol) {
        assert(frames_by_protocol[protocol] == mix.packets_last_minute[protocol]);
        assert(crc_by_protocol[protocol] == mix.crc_failures_last_minute[protocol]);
        if(frames_by_protocol[protocol] > 0U) {
            assert(static_cast<std::int16_t>(
                       snr_by_protocol[protocol] / frames_by_protocol[protocol]) ==
                   mix.mean_snr_db_x10[protocol]);
        }
    }

    const RfTimelineProtocolBucket invalid_protocol = telemetry.timelineProtocolBucket(
        SimulatedProtocol::Count, 0U);
    const RfTimelineProtocolBucket invalid_age = telemetry.timelineProtocolBucket(
        SimulatedProtocol::Meshtastic, kTimelineBucketCount);
    assert(invalid_protocol.frames == 0U && invalid_protocol.snr_sample_count == 0U);
    assert(invalid_age.frames == 0U && invalid_age.snr_sample_count == 0U);
}

void assertCapturedProfile(const TrafficSample &sample,
                           const SimulatedRfProfile &profile)
{
    assert(sample.center_frequency_hz == profile.center_frequency_hz);
    assert(sample.bandwidth_hz == profile.bandwidth_hz);
    assert(sample.spreading_factor == profile.spreading_factor);
    assert(sample.coding_rate_denominator == profile.coding_rate_denominator);
    assert(sample.preamble_symbols > 0U);
    assert(sample.sync_word == profile.sync_word);
    assert(sample.profile_id == profile.profile_id);
    if(sample.has_frequency_error) {
        assert(sample.frequency_error_hz >= -2500 && sample.frequency_error_hz <= 2500);
    } else {
        assert(sample.frequency_error_hz == 0);
    }
    assert(sample.airtime_us >= 1000U);
    assert(sample.airtime_us <= 5000000U);
    assert(sample.captured_bytes <= kSimulatedCapturedByteCapacity);
}

std::uint32_t readLittleEndian32(const TrafficSample &sample, std::size_t offset)
{
    return static_cast<std::uint32_t>(sample.byteAt(offset)) |
           (static_cast<std::uint32_t>(sample.byteAt(offset + 1U)) << 8U) |
           (static_cast<std::uint32_t>(sample.byteAt(offset + 2U)) << 16U) |
           (static_cast<std::uint32_t>(sample.byteAt(offset + 3U)) << 24U);
}

void assertCapturedBytesMatchModel(const TrafficSample &sample,
                                   const NodesSnapshot &nodes)
{
    assert(sample.captured_bytes <= sample.bytes.size());
    assert(sample.byteAt(sample.captured_bytes) == 0U);
    for(std::size_t offset = sample.captured_bytes; offset < sample.bytes.size(); ++offset) {
        assert(sample.bytes[offset] == 0U);
    }
    if(sample.decode_outcome == SimulatedDecodeOutcome::Raw ||
       sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
        return;
    }

    if(sample.protocol == SimulatedProtocol::Meshtastic) {
        assert(sample.source_node < kNodeCount);
        assert(readLittleEndian32(sample, 4U) == nodes.nodes[sample.source_node].id);
        const std::uint32_t destination = sample.destination_node == kNoNode
            ? 0xffffffffU : nodes.nodes[sample.destination_node].id;
        assert(readLittleEndian32(sample, 0U) == destination);
        assert((sample.byteAt(12U) & 0x07U) == 0U);
        assert((sample.byteAt(12U) >> 5U) == sample.hops);
        assert(sample.payload_offset == 16U);
        return;
    }

    if(sample.protocol == SimulatedProtocol::MeshCore) {
        const std::uint8_t header = sample.byteAt(0U);
        assert(((header >> 2U) & 0x0fU) == sample.port);
        assert((header >> 6U) == 0U);
        const std::uint8_t route = header & 0x03U;
        assert(route == 1U || route == 2U);
        const std::uint8_t encoded_path = sample.byteAt(1U);
        const std::uint8_t path_count = encoded_path & 0x3fU;
        const std::uint8_t path_size = static_cast<std::uint8_t>(
            (encoded_path >> 6U) + 1U);
        assert(path_size <= 3U);
        assert(sample.payload_offset == 2U + path_count * path_size);
        if(sample.decode_outcome == SimulatedDecodeOutcome::Decoded) {
            assert(sample.port == 3U);
            assert(sample.payload_bytes >= 4U);
        }
        return;
    }

    assert(sample.protocol == SimulatedProtocol::Reticulum);
    assert(sample.byteAt(0U) == 0U);
    const bool header_two = (sample.byteAt(1U) & 0x40U) != 0U;
    assert((sample.byteAt(1U) & 0x0cU) == 0x08U);
    assert((sample.byteAt(1U) & 0x03U) == 0U);
    assert(sample.payload_offset == (header_two ? 36U : 20U));
    assert(sample.byteAt(sample.payload_offset - 1U) == 0U);
}

void assertRealDecoderMatchesSample(const TrafficSample &sample,
                                    const NodesSnapshot &nodes)
{
#if defined(LILYSHARK_LIVE_TELEMETRY_DECODER_CROSSCHECK)
    lilyshark::RawFrame frame{};
    assert(frame.assignPayload(sample.bytes.data(), sample.captured_bytes));
    lilyshark::RadioProfile profile{};
    lilyshark::DecodedPacket decoded{};
    lilyshark::DecodeResult result = lilyshark::DecodeResult::NoMatch;
    if(sample.protocol == SimulatedProtocol::Meshtastic) {
        profile.protocol_hint = lilyshark::ProtocolId::Meshtastic;
        lilyshark::MeshtasticDecoder decoder{};
        result = decoder.decode(frame, profile, decoded);
    } else if(sample.protocol == SimulatedProtocol::MeshCore) {
        profile.protocol_hint = lilyshark::ProtocolId::MeshCore;
        lilyshark::MeshCoreDecoder decoder{};
        result = decoder.decode(frame, profile, decoded);
    } else if(sample.protocol == SimulatedProtocol::Reticulum) {
        profile.protocol_hint = lilyshark::ProtocolId::Reticulum;
        lilyshark::ReticulumDecoder decoder{};
        result = decoder.decode(frame, profile, decoded);
    } else {
        assert(sample.decode_outcome == SimulatedDecodeOutcome::Raw);
        return;
    }

    if(sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
        assert(result == lilyshark::DecodeResult::Malformed);
        assert(decoded.state == lilyshark::DecodeState::Malformed);
        return;
    }
    if(sample.decode_outcome == SimulatedDecodeOutcome::Raw) return;

    assert(result == lilyshark::DecodeResult::Matched);
    assert(decoded.payload_offset == sample.payload_offset);
    assert(decoded.payload_length == sample.payload_bytes);
    if(sample.protocol == SimulatedProtocol::Meshtastic) {
        assert(decoded.state == lilyshark::DecodeState::HeaderOnly);
        assert(decoded.source == nodes.nodes[sample.source_node].id);
        const std::uint32_t destination = sample.destination_node == kNoNode
            ? 0xffffffffU : nodes.nodes[sample.destination_node].id;
        assert(decoded.destination == destination);
        assert(decoded.hop_start - decoded.hop_limit == sample.hops);
    } else if(sample.protocol == SimulatedProtocol::MeshCore) {
        const lilyshark::DecodeState expected =
            sample.decode_outcome == SimulatedDecodeOutcome::Decoded
                ? lilyshark::DecodeState::PayloadDecoded
                : lilyshark::DecodeState::HeaderOnly;
        assert(decoded.state == expected);
        assert(static_cast<std::uint8_t>(lilyshark::MeshCoreDecoder::payloadType(decoded)) ==
               sample.port);
        assert(!decoded.hasField(lilyshark::FieldSource));
        assert(!decoded.hasField(lilyshark::FieldDestination));
    } else {
        assert(decoded.state == lilyshark::DecodeState::HeaderOnly);
        assert(lilyshark::ReticulumDecoder::packetType(decoded) ==
               lilyshark::ReticulumPacketType::Data);
        assert(!decoded.hasField(lilyshark::FieldSource));
        assert(!decoded.hasField(lilyshark::FieldDestination));
    }
#else
    (void)sample;
    (void)nodes;
#endif
}

void assertPayloadLayoutIsProtocolTruthful(const TrafficSample &sample)
{
    if(sample.decode_outcome == SimulatedDecodeOutcome::Raw ||
       sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
        assert(sample.payload_offset == 0U);
        assert(sample.payload_bytes == 0U);
        return;
    }

    assert(sample.payload_offset < sample.captured_bytes);
    assert(sample.payload_bytes == sample.captured_bytes - sample.payload_offset);
    switch(sample.protocol) {
        case SimulatedProtocol::Meshtastic:
            assert(sample.payload_offset == 16U);
            break;
        case SimulatedProtocol::MeshCore:
            assert(sample.payload_offset >= 2U && sample.payload_offset <= 15U);
            break;
        case SimulatedProtocol::Reticulum:
            assert(sample.payload_offset == 20U || sample.payload_offset == 36U);
            break;
        case SimulatedProtocol::Unknown:
        case SimulatedProtocol::Count:
        default:
            assert(false);
    }
}

TrafficSample advanceToNextTrafficSample(LiveTelemetry &telemetry)
{
    const std::uint64_t generation = telemetry.traffic().generation;
    for(std::size_t tick = 0U;
        tick < 64U && telemetry.traffic().generation == generation; ++tick) {
        telemetry.advance(kLiveTelemetryStepMs);
    }
    assert(telemetry.traffic().generation == generation + 1U);
    const TrafficSample *sample = telemetry.traffic().newest(0U);
    assert(sample != nullptr);
    return *sample;
}

const TrafficSample *findTrafficSequence(const TrafficSnapshot &traffic,
                                         std::uint64_t sequence)
{
    for(std::size_t age = 0U; age < traffic.size; ++age) {
        const TrafficSample *sample = traffic.newest(age);
        if(sample != nullptr && sample->sequence == sequence) return sample;
    }
    return nullptr;
}

void testCapturedRfProfileIsImmutableAndOutcomesMatchImplementedDecoders()
{
    LiveTelemetry telemetry{0x2468ace0U};
    const SimulatedRfProfile meshcore = {
        SimulatedProtocol::MeshCore, 910525000U, 62500U, 7U, 5U, 0x1424U, 2U,
    };
    telemetry.setActiveRfProfile(meshcore);
    assert(telemetry.activeProtocol() == SimulatedProtocol::MeshCore);
    assert(telemetry.activeRfProfile().center_frequency_hz == 910525000U);

    const TrafficSample retained = advanceToNextTrafficSample(telemetry);
    assertCapturedProfile(retained, meshcore);

    const SimulatedRfProfile reticulum = {
        SimulatedProtocol::Reticulum, 867200000U, 125000U, 8U, 6U, 0x1424U, 4U,
    };
    telemetry.setActiveRfProfile(reticulum);
    const TrafficSample *still_retained = findTrafficSequence(
        telemetry.traffic(), retained.sequence);
    assert(still_retained != nullptr);
    assertCapturedProfile(*still_retained, meshcore);
    assert(still_retained->airtime_us == retained.airtime_us);
    assert(still_retained->bytes == retained.bytes);

    const TrafficSample reticulum_sample = advanceToNextTrafficSample(telemetry);
    assertCapturedProfile(reticulum_sample, reticulum);
    still_retained = findTrafficSequence(telemetry.traffic(), retained.sequence);
    assert(still_retained != nullptr);
    assertCapturedProfile(*still_retained, meshcore);

    const std::array<SimulatedRfProfile, 3U> profiles = {{
        {SimulatedProtocol::Meshtastic, 906875000U, 250000U, 11U, 5U, 0x002bU, 1U},
        meshcore,
        reticulum,
    }};
    bool saw_meshcore_ack = false;
    for(const SimulatedRfProfile &profile : profiles) {
        telemetry.setActiveRfProfile(profile);
        const std::size_t sample_count = profile.protocol == SimulatedProtocol::MeshCore
            ? 80U : 24U;
        for(std::size_t index = 0U; index < sample_count; ++index) {
            const TrafficSample sample = advanceToNextTrafficSample(telemetry);
            assertCapturedProfile(sample, profile);
            assertPayloadLayoutIsProtocolTruthful(sample);
            assertCapturedBytesMatchModel(sample, telemetry.nodes());
            assertRealDecoderMatchesSample(sample, telemetry.nodes());
            if(sample.decode_outcome == SimulatedDecodeOutcome::Raw) {
                assert(profile.protocol == SimulatedProtocol::Unknown);
                assert(sample.protocol == SimulatedProtocol::Unknown);
                assert(sample.source_node == kNoNode);
                assert(sample.port == 0U);
                continue;
            }
            if(sample.decode_outcome == SimulatedDecodeOutcome::Malformed) {
                assert(sample.protocol != SimulatedProtocol::Unknown);
                assert(sample.source_node == kNoNode);
                assert(sample.port == 0U);
                continue;
            }

            assert(sample.protocol == profile.protocol);
            if(sample.protocol == SimulatedProtocol::Meshtastic) {
                assert(sample.source_node < kNodeCount);
                assert(telemetry.nodes().nodes[sample.source_node].protocol == sample.protocol);
            } else {
                assert(sample.source_node == kNoNode);
                assert(sample.destination_node == kNoNode);
                assert(sample.hops == 0U);
            }
            if(sample.protocol == SimulatedProtocol::MeshCore) {
                assert(sample.decode_outcome == SimulatedDecodeOutcome::Decoded ||
                       sample.decode_outcome == SimulatedDecodeOutcome::Opaque);
                if(sample.decode_outcome == SimulatedDecodeOutcome::Decoded) {
                    saw_meshcore_ack = true;
                    assert(sample.port == 3U);
                } else {
                    assert(sample.port == 9U || sample.port == 10U ||
                           sample.port == 11U || sample.port == 15U);
                }
            } else {
                assert(sample.decode_outcome == SimulatedDecodeOutcome::Opaque);
                assert(sample.port == 0U);
            }
        }
    }
    assert(saw_meshcore_ack);

    const SimulatedRfProfile unknown = {
        SimulatedProtocol::Unknown, 915000000U, 125000U, 9U, 5U, 0x0012U, 0U,
    };
    telemetry.setActiveRfProfile(unknown);
    for(std::size_t index = 0U; index < 12U; ++index) {
        const TrafficSample sample = advanceToNextTrafficSample(telemetry);
        assertCapturedProfile(sample, unknown);
        assert(sample.protocol == SimulatedProtocol::Unknown);
        assert(sample.decode_outcome == SimulatedDecodeOutcome::Raw);
        assertPayloadLayoutIsProtocolTruthful(sample);
        assertCapturedBytesMatchModel(sample, telemetry.nodes());
        assertRealDecoderMatchesSample(sample, telemetry.nodes());
    }

    telemetry.setActiveProtocol(SimulatedProtocol::Count);
    assert(telemetry.activeProtocol() == SimulatedProtocol::Unknown);
}

void testNodeAccountingUsesOnlyStructurallyUsableFrames()
{
    LiveTelemetry telemetry{0x53a9c711U};
    struct ExpectedNode {
        std::uint16_t frames = 0U;
        std::uint16_t crc_errors = 0U;
        std::int64_t snr_sum = 0;
        std::int16_t latest_snr = 0;
        std::int16_t latest_rssi = 0;
    };
    std::array<ExpectedNode, kNodeCount> expected{};

    const TrafficSnapshot &initial_traffic = telemetry.traffic();
    for(std::size_t remaining = initial_traffic.size; remaining > 0U; --remaining) {
        const TrafficSample *sample = initial_traffic.newest(remaining - 1U);
        assert(sample != nullptr);
        if(sample->source_node == kNoNode || sample->source_node >= kNodeCount ||
           sample->decode_outcome == SimulatedDecodeOutcome::Raw ||
           sample->decode_outcome == SimulatedDecodeOutcome::Malformed) {
            continue;
        }
        const NodeSnapshot &node = telemetry.nodes().nodes[sample->source_node];
        assert(node.protocol == sample->protocol);
        ExpectedNode &value = expected[sample->source_node];
        if(sample->crc_valid) {
            ++value.frames;
            value.snr_sum += sample->snr_db_x10;
            value.latest_snr = sample->snr_db_x10;
            value.latest_rssi = sample->rssi_dbm_x10;
        } else if(value.frames != 0U) {
            ++value.crc_errors;
        }
    }

    std::uint32_t total_node_frames = 0U;
    for(std::size_t index = 0U; index < kNodeCount; ++index) {
        const NodeSnapshot &node = telemetry.nodes().nodes[index];
        assert(node.id != 0U);
        for(std::size_t other = index + 1U; other < kNodeCount; ++other) {
            assert(node.id != telemetry.nodes().nodes[other].id);
        }
        assert(node.protocol != SimulatedProtocol::Unknown);
        assert(node.frame_count == expected[index].frames);
        assert(node.crc_errors == expected[index].crc_errors);
        assert(node.history_size == expected[index].frames);
        assert(node.rssi(kNodeHistoryCapacity) == 0);
        total_node_frames += node.frame_count;
        if(node.frame_count == 0U) continue;
        assert(node.latest_snr_db_x10 == expected[index].latest_snr);
        assert(node.mean_snr_db_x10 == expected[index].snr_sum / expected[index].frames);
        assert(node.latest_rssi_dbm_x10 == expected[index].latest_rssi);
        assert(node.snr(0U) == node.latest_snr_db_x10);
        assert(node.rssi(0U) == node.latest_rssi_dbm_x10);
    }
    assert(total_node_frames > 0U);

    bool saw_valid_update = false;
    bool saw_crc_error = false;
    bool saw_ignored_frame = false;
    for(std::size_t sample_index = 0U;
        sample_index < 300U && !(saw_valid_update && saw_crc_error && saw_ignored_frame);
        ++sample_index) {
        const TrafficSample sample = advanceToNextTrafficSample(telemetry);
        const bool structurally_usable = sample.source_node != kNoNode &&
            sample.source_node < kNodeCount &&
            sample.decode_outcome != SimulatedDecodeOutcome::Raw &&
            sample.decode_outcome != SimulatedDecodeOutcome::Malformed;
        if(!structurally_usable) {
            saw_ignored_frame = true;
        } else {
            ExpectedNode &value = expected[sample.source_node];
            if(sample.crc_valid) {
                saw_valid_update = true;
                ++value.frames;
                value.snr_sum += sample.snr_db_x10;
                value.latest_snr = sample.snr_db_x10;
                value.latest_rssi = sample.rssi_dbm_x10;
            } else if(value.frames != 0U) {
                saw_crc_error = true;
                ++value.crc_errors;
            }
        }

        for(std::size_t index = 0U; index < kNodeCount; ++index) {
            const NodeSnapshot &node = telemetry.nodes().nodes[index];
            assert(node.frame_count == expected[index].frames);
            assert(node.crc_errors == expected[index].crc_errors);
            assert(node.history_size ==
                   (expected[index].frames < kNodeHistoryCapacity
                        ? expected[index].frames : kNodeHistoryCapacity));
            if(node.frame_count == 0U) continue;
            assert(node.mean_snr_db_x10 == expected[index].snr_sum / expected[index].frames);
            assert(node.latest_snr_db_x10 == expected[index].latest_snr);
            assert(node.latest_rssi_dbm_x10 == expected[index].latest_rssi);
        }
    }
    assert(saw_valid_update);
    assert(saw_crc_error);
    assert(saw_ignored_frame);
}

void testInitialSnapshotsAreRenderReadyAndBounded()
{
    static_assert(sizeof(LiveTelemetry) < 24U * 1024U,
                  "simulator telemetry must remain a small fixed-size model");
    LiveTelemetry telemetry{};

    const SpectrumSnapshot &spectrum = telemetry.spectrum();
    assert(spectrum.row_generation == kSpectrumHistoryRowCount);
    assert(spectrum.peak_intensity > 100U);
    assert(spectrum.noise_floor_dbm >= -119 && spectrum.noise_floor_dbm <= -104);
    assert(spectrum.busiest_frequency_khz >= 902000U);
    assert(spectrum.busiest_frequency_khz <= 928000U);
    assert(spectrum.quietest_frequency_khz >= 902000U);
    assert(spectrum.quietest_frequency_khz <= 928000U);
    assert(spectrum.intensity(0U, 0U) ==
           spectrum.rows[spectrum.newest_row][0U]);
    assert(spectrum.intensity(kSpectrumHistoryRowCount, 0U) == 0U);
    assert(spectrum.intensity(0U, kSpectrumColumnCount) == 0U);

    const TrafficSnapshot &traffic = telemetry.traffic();
    assert(traffic.size == kTrafficHistoryCapacity);
    assert(traffic.generation == kTrafficHistoryCapacity);
    assert(traffic.packets_per_minute == kTrafficHistoryCapacity);
    assert(traffic.newest(0U) != nullptr);
    assert(traffic.newest(0U)->sequence == traffic.generation);
    assert(traffic.newest(kTrafficHistoryCapacity) == nullptr);
    bool has_opaque = false;
    bool has_raw = false;
    bool has_malformed = false;
    bool has_crc_valid_malformed = false;
    for(std::size_t age = 0U; age < traffic.size; ++age) {
        const TrafficSample *sample = traffic.newest(age);
        assert(sample != nullptr);
        assert(sample->center_frequency_hz > 0U);
        assert(sample->bandwidth_hz > 0U);
        assert(sample->spreading_factor >= 7U && sample->spreading_factor <= 12U);
        assert(sample->coding_rate_denominator >= 5U &&
               sample->coding_rate_denominator <= 8U);
        assert(sample->rssi_dbm_x10 >= -1250 && sample->rssi_dbm_x10 <= -650);
        assert(sample->airtime_us >= 1000U && sample->airtime_us <= 5000000U);
        assertPayloadLayoutIsProtocolTruthful(*sample);
        assertCapturedBytesMatchModel(*sample, telemetry.nodes());
        assertRealDecoderMatchesSample(*sample, telemetry.nodes());
        has_opaque = has_opaque ||
            sample->decode_outcome == SimulatedDecodeOutcome::Opaque;
        has_raw = has_raw || sample->decode_outcome == SimulatedDecodeOutcome::Raw;
        has_malformed = has_malformed ||
            sample->decode_outcome == SimulatedDecodeOutcome::Malformed;
        has_crc_valid_malformed = has_crc_valid_malformed ||
            (sample->decode_outcome == SimulatedDecodeOutcome::Malformed && sample->crc_valid);
    }
    assert(has_opaque);
    assert(has_raw);
    assert(has_malformed);
    assert(has_crc_valid_malformed);

    const NodesSnapshot &nodes = telemetry.nodes();
    for(const NodeSnapshot &node : nodes.nodes) {
        assert(node.id != 0U);
        assert(node.protocol == SimulatedProtocol::Meshtastic);
        assert(node.battery_percent <= 100U);
        assert(node.latest_snr_db_x10 >= -220);
        assert(node.latest_snr_db_x10 <= 20);
        assert(node.mean_snr_db_x10 >= -220);
        assert(node.mean_snr_db_x10 <= 20);
        assert(node.snr(0U) == node.latest_snr_db_x10);
        assert(node.rssi(0U) == node.latest_rssi_dbm_x10);
        assert(node.snr(kNodeHistoryCapacity) == 0);
        assert(node.rssi(kNodeHistoryCapacity) == 0);
        assert(node.history_size == node.frame_count);
        if(node.frame_count == 0U) {
            assert(node.latest_snr_db_x10 == 0);
            assert(node.mean_snr_db_x10 == 0);
            assert(node.latest_rssi_dbm_x10 == 0);
            assert(node.last_seen_seconds == 0U);
            assert(!node.active);
        } else {
            assert(node.latest_rssi_dbm_x10 >= -1250);
            assert(node.latest_rssi_dbm_x10 <= -650);
        }
        for(std::size_t age = 0U; age < node.history_size; ++age) {
            assert(node.rssi(age) >= -1250 && node.rssi(age) <= -650);
        }
    }

    const AirtimeSnapshot &airtime = telemetry.airtime();
    for(const std::uint32_t bar : airtime.bars_airtime_us) {
        assert(bar <= 5000000U);
    }
    assert(airtime.utilization_percent <= 100U);
    assert(airtime.peak_one_minute_percent <= 100U);

    assertProtocolMixIsConsistent(telemetry.protocolMix());
    assert(telemetry.protocolMix().opaque_last_minute > 0U);
    assert(telemetry.protocolMix().raw_last_minute > 0U);
    assert(telemetry.protocolMix().malformed_last_minute > 0U);
    assert(telemetry.events().size == 5U);
    assert(telemetry.events().newest(0U) != nullptr);
    assert(telemetry.events().newest(5U) == nullptr);

    const RfTimelineSnapshot &timeline = telemetry.timeline();
    assert(timeline.newest(0U) != nullptr);
    assert(timeline.newest(0U)->timestamp_seconds_of_day == telemetry.clockSecondsOfDay());
    assert(timeline.newest(kTimelineBucketCount) == nullptr);
    std::uint32_t timeline_packets = 0U;
    bool has_event_marker = false;
    for(const RfTimelineBucket &bucket : timeline.buckets) {
        timeline_packets += bucket.packets_per_second;
        assert(bucket.crc_failures <= bucket.packets_per_second);
        if(bucket.has_packets) assert(bucket.airtime_us > 0U);
        if(bucket.has_packets) {
            assert(bucket.snr_sample_count == bucket.packets_per_second);
            assert(bucket.median_snr_db_x10 >= -220);
            assert(bucket.median_snr_db_x10 <= 20);
        }
        has_event_marker = has_event_marker || bucket.markers != TimelineMarker::None;
    }
    assert(timeline_packets == kTrafficHistoryCapacity);
    assert(has_event_marker);
    assertTimelineProtocolBucketsAreConsistent(telemetry);
}

void testSameSeedAndElapsedTimeProduceIdenticalEvolution()
{
    LiveTelemetry combined{0x12345678U};
    LiveTelemetry fragmented{0x12345678U};
    const std::uint64_t initial_fingerprint = publicStateFingerprint(combined);
    assert(initial_fingerprint == publicStateFingerprint(fragmented));

    const TelemetryChange combined_changes = combined.advance(990U);
    TelemetryChange fragmented_changes = TelemetryChange::None;
    for(std::size_t index = 0U; index < 60U; ++index) {
        fragmented_changes |= fragmented.advance(index % 2U == 0U ? 11U : 22U);
    }
    assert(combined.tick() == 30U);
    assert(fragmented.tick() == combined.tick());
    assert(publicStateFingerprint(combined) == publicStateFingerprint(fragmented));
    assert(static_cast<std::uint16_t>(combined_changes) ==
           static_cast<std::uint16_t>(fragmented_changes));

    combined.advance(660U);
    for(std::size_t index = 0U; index < 20U; ++index) fragmented.advance(33U);
    assert(publicStateFingerprint(combined) == publicStateFingerprint(fragmented));

    combined.reset(0x12345678U);
    assert(publicStateFingerprint(combined) == initial_fingerprint);
}

void testSeedsDivergeAndSnapshotsEvolveAtBoundedCadences()
{
    LiveTelemetry first{1U};
    LiveTelemetry second{2U};
    assert(first.spectrum().rows != second.spectrum().rows);
    assert(publicStateFingerprint(first) != publicStateFingerprint(second));

    const std::uint64_t spectrum_generation = first.spectrum().row_generation;
    const auto first_spectrum_row = first.spectrum().rows[first.spectrum().newest_row];
    const std::uint64_t node_generation = first.nodes().generation;
    const std::uint64_t airtime_generation = first.airtime().generation;
    const std::uint64_t timeline_generation = first.timeline().generation;
    const std::uint64_t traffic_generation = first.traffic().generation;

    assert(first.advance(32U) == TelemetryChange::None);
    assert(first.advance(1U) == TelemetryChange::None);
    const TelemetryChange second_tick = first.advance(33U);
    assert(changed(second_tick, TelemetryChange::Spectrum));
    assert(first.spectrum().row_generation == spectrum_generation + 1U);
    assert(first.spectrum().rows[first.spectrum().newest_row] != first_spectrum_row);

    first.advance(4U * kLiveTelemetryStepMs);
    assert(first.airtime().generation > airtime_generation);
    first.advance(2U * kLiveTelemetryStepMs);
    assert(first.nodes().generation > node_generation);
    first.advance(23U * kLiveTelemetryStepMs);
    assert(first.timeline().generation > timeline_generation);

    for(std::size_t iteration = 0U;
        iteration < 50U && first.traffic().generation == traffic_generation; ++iteration) {
        first.advance(kLiveTelemetryStepMs);
    }
    assert(first.traffic().generation > traffic_generation);
    assert(first.protocolMix().total_last_minute == first.traffic().packets_per_minute);
    assertProtocolMixIsConsistent(first.protocolMix());

    LiveTelemetry catch_up{};
    catch_up.advance(std::numeric_limits<std::uint32_t>::max());
    assert(catch_up.tick() == kLiveTelemetryMaximumCatchUpMs / kLiveTelemetryStepMs);
}

void testSurveyTrafficEventsAndTimelineRemainLiveAndBounded()
{
    LiveTelemetry telemetry{0xcafebabeU};
    assert(telemetry.setSurveyRunning(true) == TelemetryChange::Survey);
    assert(telemetry.survey().running);
    assert(telemetry.setSurveyRunning(true) == TelemetryChange::None);

    const std::uint64_t event_generation = telemetry.events().generation;
    const std::uint64_t timeline_generation = telemetry.timeline().generation;
    for(std::size_t second = 0U; second < 10U; ++second) telemetry.advance(1000U);
    const SurveySnapshot &survey = telemetry.survey();
    assert(survey.running);
    assert(survey.elapsed_ms >= 9000U && survey.elapsed_ms <= 10000U);
    assert(survey.frames > 0U);
    assert(survey.nodes_heard > 0U && survey.nodes_heard <= kNodeCount);
    assert(survey.best_snr_db_x10 >= -220 && survey.best_snr_db_x10 <= 20);
    assert(telemetry.events().generation > event_generation);
    assert(telemetry.timeline().generation > timeline_generation);

    bool has_recent_marker = false;
    bool has_recent_packets = false;
    for(std::size_t age = 0U; age < 10U; ++age) {
        const RfTimelineBucket *bucket = telemetry.timeline().newest(age);
        assert(bucket != nullptr);
        has_recent_marker = has_recent_marker || bucket->markers != TimelineMarker::None;
        has_recent_packets = has_recent_packets || bucket->packets_per_second > 0U;
    }
    assert(has_recent_marker);
    assert(has_recent_packets);

    for(std::size_t second = 0U; second < 55U; ++second) telemetry.advance(1000U);
    assert(!telemetry.survey().running);
    assert(telemetry.survey().complete);
    assert(telemetry.survey().elapsed_ms == 60000U);
    assert(telemetry.events().size <= kEventHistoryCapacity);
    assert(telemetry.traffic().size == kTrafficHistoryCapacity);

    for(const auto &row : telemetry.spectrum().rows) {
        for(const std::uint8_t intensity : row) {
            assert(intensity <= std::numeric_limits<std::uint8_t>::max());
        }
    }
    for(const std::uint32_t bar : telemetry.airtime().bars_airtime_us) {
        assert(bar <= 5000000U);
    }
    assertProtocolMixIsConsistent(telemetry.protocolMix());
    assertTimelineProtocolBucketsAreConsistent(telemetry);

    assert(telemetry.setSurveyRunning(false) == TelemetryChange::None);
    assert(telemetry.setSurveyRunning(true) == TelemetryChange::Survey);
    assert(telemetry.survey().elapsed_ms == 0U);
    assert(telemetry.survey().frames == 0U);
    assert(!telemetry.survey().complete);
}

void testCancellingSurveyDiscardsPartialResultsOnly()
{
    LiveTelemetry telemetry{0x81f0273aU};
    assert(telemetry.setSurveyRunning(true) == TelemetryChange::Survey);
    for(std::size_t second = 0U; second < 6U; ++second) telemetry.advance(1000U);
    assert(telemetry.survey().running);
    assert(telemetry.survey().elapsed_ms > 0U);
    assert(telemetry.survey().frames > 0U);

    const std::uint64_t traffic_generation = telemetry.traffic().generation;
    const std::uint64_t event_generation = telemetry.events().generation;
    const std::uint64_t survey_generation = telemetry.survey().generation;
    assert(telemetry.setSurveyRunning(false) == TelemetryChange::Survey);
    assert(!telemetry.survey().running);
    assert(!telemetry.survey().complete);
    assert(telemetry.survey().elapsed_ms == 0U);
    assert(telemetry.survey().frames == 0U);
    assert(telemetry.survey().crc_invalid_frames == 0U);
    assert(telemetry.survey().nodes_heard == 0U);
    assert(telemetry.survey().best_snr_db_x10 == 0);
    assert(telemetry.survey().generation == survey_generation + 1U);
    assert(telemetry.traffic().generation == traffic_generation);
    assert(telemetry.events().generation == event_generation);
    assert(telemetry.setSurveyRunning(false) == TelemetryChange::None);

    assert(telemetry.setSurveyRunning(true) == TelemetryChange::Survey);
    assert(telemetry.survey().running);
    assert(telemetry.survey().elapsed_ms == 0U);
    assert(telemetry.survey().frames == 0U);
}

void testCapturePauseFreezesReceivedTelemetryAndResumes()
{
    LiveTelemetry telemetry{0x13579bdfU};
    assert(telemetry.setSurveyRunning(true) == TelemetryChange::Survey);
    const std::uint64_t received_fingerprint = receivedStateFingerprint(telemetry);
    const std::uint64_t spectrum_generation = telemetry.spectrum().row_generation;
    const std::uint32_t elapsed_ms = telemetry.elapsedMilliseconds();
    const std::uint32_t survey_elapsed_ms = telemetry.survey().elapsed_ms;
    const std::uint64_t survey_generation = telemetry.survey().generation;

    telemetry.setCapturePaused(true);
    assert(telemetry.capturePaused());
    TelemetryChange paused_changes = TelemetryChange::None;
    for(std::size_t second = 0U; second < 10U; ++second) {
        paused_changes |= telemetry.advance(1000U);
    }

    assert(telemetry.elapsedMilliseconds() > elapsed_ms);
    assert(telemetry.spectrum().row_generation > spectrum_generation);
    assert(changed(paused_changes, TelemetryChange::Spectrum));
    assert(!changed(paused_changes, TelemetryChange::Traffic));
    assert(!changed(paused_changes, TelemetryChange::Nodes));
    assert(!changed(paused_changes, TelemetryChange::ProtocolMix));
    assert(!changed(paused_changes, TelemetryChange::Timeline));
    assert(!changed(paused_changes, TelemetryChange::Survey));
    assert(telemetry.survey().running);
    assert(telemetry.survey().elapsed_ms == survey_elapsed_ms);
    assert(telemetry.survey().generation == survey_generation);
    assert(receivedStateFingerprint(telemetry) == received_fingerprint);

    const std::uint64_t traffic_generation = telemetry.traffic().generation;
    const std::uint64_t node_generation = telemetry.nodes().generation;
    const std::uint64_t protocol_generation = telemetry.protocolMix().generation;
    const std::uint64_t timeline_generation = telemetry.timeline().generation;
    telemetry.setCapturePaused(false);
    assert(!telemetry.capturePaused());

    TelemetryChange resumed_changes = TelemetryChange::None;
    for(std::size_t tick = 0U; tick < 50U; ++tick) {
        resumed_changes |= telemetry.advance(kLiveTelemetryStepMs);
    }
    assert(telemetry.traffic().generation > traffic_generation);
    assert(telemetry.nodes().generation > node_generation);
    assert(telemetry.protocolMix().generation > protocol_generation);
    assert(telemetry.timeline().generation > timeline_generation);
    assert(changed(resumed_changes, TelemetryChange::Traffic));
    assert(changed(resumed_changes, TelemetryChange::Nodes));
    assert(changed(resumed_changes, TelemetryChange::ProtocolMix));
    assert(changed(resumed_changes, TelemetryChange::Timeline));
    assert(telemetry.survey().elapsed_ms > survey_elapsed_ms);
    assert(telemetry.survey().generation > survey_generation);
    assert(receivedStateFingerprint(telemetry) != received_fingerprint);

    telemetry.setCapturePaused(true);
    telemetry.reset(0x13579bdfU);
    assert(!telemetry.capturePaused());
}

} // namespace

int main()
{
    testInitialSnapshotsAreRenderReadyAndBounded();
    testSameSeedAndElapsedTimeProduceIdenticalEvolution();
    testSeedsDivergeAndSnapshotsEvolveAtBoundedCadences();
    testSurveyTrafficEventsAndTimelineRemainLiveAndBounded();
    testCancellingSurveyDiscardsPartialResultsOnly();
    testCapturePauseFreezesReceivedTelemetryAndResumes();
    testCapturedRfProfileIsImmutableAndOutcomesMatchImplementedDecoders();
    testNodeAccountingUsesOnlyStructurallyUsableFrames();
    std::puts("live telemetry tests passed");
    return 0;
}
