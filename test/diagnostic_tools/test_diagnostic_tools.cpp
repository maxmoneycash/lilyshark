#include "lilyshark/core/diagnostic_tools.h"
#include "lilyshark/device/radio_service.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <type_traits>

namespace {

using namespace lilyshark;

FrameRecord makeRecord(ProtocolId protocol, DecodeState decode,
                       CrcStatus crc, std::uint8_t marker)
{
    FrameRecord record{};
    record.decoded.protocol = protocol;
    record.decoded.state = decode;
    record.raw.rf.crc = crc;
    record.raw.assignPayload(&marker, 1U);
    return record;
}

void testTrafficPredicatesAreExactAndComposable()
{
    static_assert(std::is_trivially_copyable_v<TrafficFilter>);
    static_assert(sizeof(TrafficFilter) == 3U);

    const FrameRecord decoded_meshtastic = makeRecord(
        ProtocolId::Meshtastic, DecodeState::PayloadDecoded,
        CrcStatus::Valid, 1U);
    TrafficFilter filter{};
    assert(!filter.active());
    assert(filter.matches(decoded_meshtastic));

    filter.protocol = TrafficProtocolPredicate::Meshtastic;
    filter.decode = TrafficDecodePredicate::PayloadDecoded;
    filter.crc = TrafficCrcPredicate::Valid;
    assert(filter.active());
    assert(filter.matches(decoded_meshtastic));

    FrameRecord candidate = decoded_meshtastic;
    candidate.decoded.protocol = ProtocolId::MeshCore;
    assert(!filter.matches(candidate));
    candidate = decoded_meshtastic;
    candidate.decoded.state = DecodeState::HeaderOnly;
    assert(!filter.matches(candidate));
    candidate = decoded_meshtastic;
    candidate.raw.rf.crc = CrcStatus::NotPresent;
    assert(!filter.matches(candidate));

    filter.protocol = TrafficProtocolPredicate::Custom;
    filter.decode = TrafficDecodePredicate::HeaderOnly;
    filter.crc = TrafficCrcPredicate::NotPresent;
    assert(filter.matches(makeRecord(ProtocolId::Custom,
                                     DecodeState::HeaderOnly,
                                     CrcStatus::NotPresent, 2U)));

    filter.protocol = TrafficProtocolPredicate::Unknown;
    filter.decode = TrafficDecodePredicate::Raw;
    filter.crc = TrafficCrcPredicate::Unknown;
    assert(filter.matches(makeRecord(ProtocolId::Unknown,
                                     DecodeState::Unknown,
                                     CrcStatus::Unknown, 3U)));
    filter.protocol = TrafficProtocolPredicate::Any;
    filter.decode = TrafficDecodePredicate::NonMalformed;
    filter.crc = TrafficCrcPredicate::Any;
    assert(filter.matches(decoded_meshtastic));
    assert(filter.matches(makeRecord(ProtocolId::Unknown,
                                     DecodeState::Unknown,
                                     CrcStatus::Unknown, 4U)));
    assert(!filter.matches(makeRecord(ProtocolId::MeshCore,
                                      DecodeState::Malformed,
                                      CrcStatus::Invalid, 5U)));
    // Invalid enum values do not silently broaden a filter.
    filter.protocol = static_cast<TrafficProtocolPredicate>(0xffU);
    assert(!filter.matches(decoded_meshtastic));
}

void testTrafficPredicateLabelsAndCycling()
{
    assert(std::strcmp(trafficProtocolPredicateLabel(
                           TrafficProtocolPredicate::Meshtastic),
                       "MESHTASTIC") == 0);
    assert(std::strcmp(trafficProtocolPredicateLabel(
                           TrafficProtocolPredicate::Custom),
                       "CUSTOM / APP") == 0);
    assert(std::strcmp(trafficDecodePredicateLabel(
                           TrafficDecodePredicate::HeaderOnly),
                       "HEADER") == 0);
    assert(std::strcmp(trafficDecodePredicateLabel(
                           TrafficDecodePredicate::NonMalformed),
                       "STRUCTURAL OK") == 0);
    assert(std::strcmp(trafficCrcPredicateLabel(
                           TrafficCrcPredicate::NotPresent),
                       "NOT PRESENT") == 0);

    TrafficProtocolPredicate protocol = TrafficProtocolPredicate::Any;
    for(std::uint8_t index = 0U;
        index < static_cast<std::uint8_t>(TrafficProtocolPredicate::Count);
        ++index) {
        protocol = nextTrafficProtocolPredicate(protocol);
    }
    assert(protocol == TrafficProtocolPredicate::Any);
    assert(previousTrafficProtocolPredicate(TrafficProtocolPredicate::Any) ==
           TrafficProtocolPredicate::Unknown);

    TrafficDecodePredicate decode = TrafficDecodePredicate::Any;
    for(std::uint8_t index = 0U;
        index < static_cast<std::uint8_t>(TrafficDecodePredicate::Count);
        ++index) {
        decode = nextTrafficDecodePredicate(decode);
    }
    assert(decode == TrafficDecodePredicate::Any);
    assert(previousTrafficDecodePredicate(TrafficDecodePredicate::Any) ==
           TrafficDecodePredicate::Malformed);

    TrafficCrcPredicate crc = TrafficCrcPredicate::Any;
    for(std::uint8_t index = 0U;
        index < static_cast<std::uint8_t>(TrafficCrcPredicate::Count);
        ++index) {
        crc = nextTrafficCrcPredicate(crc);
    }
    assert(crc == TrafficCrcPredicate::Any);
    assert(previousTrafficCrcPredicate(TrafficCrcPredicate::Any) ==
           TrafficCrcPredicate::Unknown);

    assert(nextTrafficProtocolPredicate(
               static_cast<TrafficProtocolPredicate>(0xffU)) ==
           TrafficProtocolPredicate::Any);
    assert(previousTrafficDecodePredicate(
               static_cast<TrafficDecodePredicate>(0xffU)) ==
           TrafficDecodePredicate::Any);
    assert(nextTrafficCrcPredicate(
               static_cast<TrafficCrcPredicate>(0xffU)) ==
           TrafficCrcPredicate::Any);
}

void testFilteredFrameStoreViewsPreserveNewestOrder()
{
    FrameStore<4U> store{};
    store.push(makeRecord(ProtocolId::Meshtastic,
                          DecodeState::PayloadDecoded,
                          CrcStatus::Valid, 1U).raw,
               makeRecord(ProtocolId::Meshtastic,
                          DecodeState::PayloadDecoded,
                          CrcStatus::Valid, 1U).decoded);

    const FrameRecord meshcore_bad = makeRecord(
        ProtocolId::MeshCore, DecodeState::Malformed,
        CrcStatus::Invalid, 2U);
    store.push(meshcore_bad.raw, meshcore_bad.decoded);
    const FrameRecord meshcore_good = makeRecord(
        ProtocolId::MeshCore, DecodeState::HeaderOnly,
        CrcStatus::Valid, 3U);
    store.push(meshcore_good.raw, meshcore_good.decoded);
    const FrameRecord reticulum = makeRecord(
        ProtocolId::Reticulum, DecodeState::HeaderOnly,
        CrcStatus::Valid, 4U);
    store.push(reticulum.raw, reticulum.decoded);
    const FrameRecord meshcore_newest = makeRecord(
        ProtocolId::MeshCore, DecodeState::PayloadDecoded,
        CrcStatus::Valid, 5U);
    store.push(meshcore_newest.raw, meshcore_newest.decoded);

    TrafficFilter filter{};
    filter.protocol = TrafficProtocolPredicate::MeshCore;
    const TrafficFilterSnapshot snapshot = trafficFilterSnapshot(store, filter);
    assert(snapshot.retained_frames == 4U);
    assert(snapshot.matching_frames == 3U);
    assert(snapshot.total_frames_seen == 5U);
    assert(snapshot.ram_overwrites == 1U);
    assert(snapshot.filter_active);

    const FrameRecord *newest = newestMatchingFrame(store, filter, 0U);
    const FrameRecord *middle = newestMatchingFrame(store, filter, 1U);
    const FrameRecord *oldest = newestMatchingFrame(store, filter, 2U);
    assert(newest != nullptr && newest->raw.bytes[0] == 5U);
    assert(middle != nullptr && middle->raw.bytes[0] == 3U);
    assert(oldest != nullptr && oldest->raw.bytes[0] == 2U);
    assert(newestMatchingFrame(store, filter, 3U) == nullptr);

    filter.crc = TrafficCrcPredicate::Invalid;
    assert(trafficFilterSnapshot(store, filter).matching_frames == 1U);
    assert(newestMatchingFrame(store, filter)->raw.bytes[0] == 2U);
}

void testCaptureHealthSeparatesRingAndWriterTruth()
{
    static_assert(std::is_trivially_copyable_v<CaptureHealthSnapshot>);
    static_assert(sizeof(CaptureHealthSnapshot) < 80U);

    FrameStore<2U> store{};
    const FrameRecord first = makeRecord(
        ProtocolId::Meshtastic, DecodeState::HeaderOnly,
        CrcStatus::Valid, 1U);
    store.push(first.raw, first.decoded);
    store.push(first.raw, first.decoded);
    store.push(first.raw, first.decoded);

    CaptureHealthInput input{};
    CaptureHealthSnapshot snapshot = makeCaptureHealthSnapshot(store, input);
    assert(snapshot.state == CaptureHealthState::Off);
    assert(snapshot.retained_frames == 2U);
    assert(snapshot.buffer_capacity == 2U);
    assert(snapshot.total_frames_seen == 3U);
    assert(snapshot.ram_overwrites == 1U);
    assert(snapshot.buffer_fill_percent_x10 == 1000U);

    input.native_stream = CaptureStreamHealth::Recording;
    snapshot = makeCaptureHealthSnapshot(store, input);
    assert(snapshot.state == CaptureHealthState::Recording);
    input.native_stream = CaptureStreamHealth::Disabled;

    input.capture_requested = true;
    snapshot = makeCaptureHealthSnapshot(store, input);
    assert(snapshot.state == CaptureHealthState::Unavailable);

    input.storage_available = true;
    input.native_stream = CaptureStreamHealth::Starting;
    snapshot = makeCaptureHealthSnapshot(store, input);
    assert(snapshot.state == CaptureHealthState::Starting);

    input.native_stream = CaptureStreamHealth::Recording;
    input.pcap_stream = CaptureStreamHealth::Unsupported;
    snapshot = makeCaptureHealthSnapshot(store, input);
    // Native capture remains complete when LoRaTap cannot represent a PHY.
    assert(snapshot.state == CaptureHealthState::Recording);

    input.pcap_stream = CaptureStreamHealth::Fault;
    snapshot = makeCaptureHealthSnapshot(store, input);
    assert(snapshot.state == CaptureHealthState::Degraded);

    input.native_stream = CaptureStreamHealth::Fault;
    snapshot = makeCaptureHealthSnapshot(store, input);
    assert(snapshot.state == CaptureHealthState::Fault);

    input.native_stream = static_cast<CaptureStreamHealth>(0xffU);
    input.pcap_stream = CaptureStreamHealth::Disabled;
    snapshot = makeCaptureHealthSnapshot(store, input);
    assert(snapshot.state == CaptureHealthState::Fault);
    assert(std::strcmp(captureStreamHealthLabel(input.native_stream),
                       "UNKNOWN") == 0);

    snapshot = makeCaptureHealthSnapshot(
        input, std::numeric_limits<std::size_t>::max(),
        std::numeric_limits<std::size_t>::max(), 0U, 0U);
    assert(snapshot.buffer_fill_percent_x10 == 1000U);
    snapshot = makeCaptureHealthSnapshot(
        input, std::numeric_limits<std::size_t>::max() - 1U,
        std::numeric_limits<std::size_t>::max(), 0U, 0U);
    assert(snapshot.buffer_fill_percent_x10 == 999U);
    snapshot = makeCaptureHealthSnapshot(input, 0U, 0U, 0U, 0U);
    assert(snapshot.buffer_fill_percent_x10 == 0U);
}

void testRxHealthUsesCumulativeRadioCountersWithoutInventingRate()
{
    static_assert(std::is_trivially_copyable_v<RxHealthSnapshot>);
    static_assert(sizeof(RxHealthSnapshot) < 48U);

    RadioStatus status{};
    RxHealthSnapshot snapshot = makeRxHealthSnapshot(status, 5000U);
    assert(snapshot.state == RxHealthState::Offline);
    assert(!snapshot.has_last_frame);
    assert(snapshot.crc_error_percent_x10 == 0U);

    status.initialized = true;
    snapshot = makeRxHealthSnapshot(status, 5000U);
    assert(snapshot.state == RxHealthState::Recovering);

    status.receiving = true;
    status.received_frames = 40U;
    status.crc_errors = 5U;
    status.receive_errors = 10U;
    status.profile_switch_failures = 2U;
    status.last_frame_ms = 4500U;
    status.last_error = -7;
    status.last_profile_error = -8;
    snapshot = makeRxHealthSnapshot(status, 5000U);
    assert(snapshot.state == RxHealthState::Listening);
    assert(snapshot.has_last_frame);
    assert(snapshot.last_frame_age_ms == 500U);
    assert(snapshot.crc_error_percent_x10 == 125U);
    assert(snapshot.receive_error_percent_x10 == 200U);
    assert(snapshot.profile_switch_failures == 2U);
    assert(snapshot.last_error == -7);
    assert(snapshot.last_profile_error == -8);

    // Unsigned subtraction intentionally handles millis() rollover.
    status.last_frame_ms = std::numeric_limits<std::uint32_t>::max() - 99U;
    snapshot = makeRxHealthSnapshot(status, 100U);
    assert(snapshot.last_frame_age_ms == 200U);

    status.received_frames = std::numeric_limits<std::uint32_t>::max();
    status.crc_errors = std::numeric_limits<std::uint32_t>::max();
    status.receive_errors = std::numeric_limits<std::uint32_t>::max();
    snapshot = makeRxHealthSnapshot(status, 100U);
    assert(snapshot.crc_error_percent_x10 == 1000U);
    assert(snapshot.receive_error_percent_x10 == 500U);
}

void testFormattingIsBoundedAndUiReady()
{
    char value[96]{};
    assert(formatDiagnosticCount(value, sizeof(value),
                                 std::numeric_limits<std::uint64_t>::max()));
    assert(std::strcmp(value, "18446744073709551615") == 0);

    assert(formatDiagnosticPercentX10(value, sizeof(value), 125U));
    assert(std::strcmp(value, "12.5%") == 0);
    assert(formatDiagnosticAge(value, sizeof(value), false, 0U));
    assert(std::strcmp(value, "NO FRAME") == 0);
    assert(formatDiagnosticAge(value, sizeof(value), true, 999U));
    assert(std::strcmp(value, "<1s") == 0);
    assert(formatDiagnosticAge(value, sizeof(value), true, 59000U));
    assert(std::strcmp(value, "59s") == 0);
    assert(formatDiagnosticAge(value, sizeof(value), true, 125000U));
    assert(std::strcmp(value, "2m 05s") == 0);
    assert(formatDiagnosticAge(value, sizeof(value), true, 14700000U));
    assert(std::strcmp(value, "4h 05m") == 0);

    TrafficFilter filter{};
    filter.protocol = TrafficProtocolPredicate::Reticulum;
    filter.decode = TrafficDecodePredicate::HeaderOnly;
    filter.crc = TrafficCrcPredicate::Valid;
    assert(formatTrafficFilterSummary(value, sizeof(value), filter));
    assert(std::strcmp(value, "RETICULUM / HEADER / VALID") == 0);

    CaptureHealthSnapshot capture{};
    capture.retained_frames = 32U;
    capture.buffer_capacity = 64U;
    capture.buffer_fill_percent_x10 = 500U;
    assert(formatCaptureBufferUse(value, sizeof(value), capture));
    assert(std::strcmp(value, "32 / 64  50.0%") == 0);

    char tiny[2] = {'x', 'x'};
    assert(!formatDiagnosticCount(tiny, sizeof(tiny), 12345U));
    assert(tiny[1] == '\0');
    assert(!formatTrafficFilterSummary(tiny, sizeof(tiny), filter));
    assert(tiny[1] == '\0');
    assert(!formatDiagnosticAge(nullptr, 10U, true, 0U));
    assert(!formatDiagnosticAge(value, 0U, true, 0U));
}

} // namespace

int main()
{
    testTrafficPredicatesAreExactAndComposable();
    testTrafficPredicateLabelsAndCycling();
    testFilteredFrameStoreViewsPreserveNewestOrder();
    testCaptureHealthSeparatesRingAndWriterTruth();
    testRxHealthUsesCumulativeRadioCountersWithoutInventingRate();
    testFormattingIsBoundedAndUiReady();
    std::puts("diagnostic tools tests passed");
    return 0;
}
