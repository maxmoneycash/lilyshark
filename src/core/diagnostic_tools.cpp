#include "lilyshark/core/diagnostic_tools.h"

#include "lilyshark/device/radio_service.h"

#include <cstdio>
#include <limits>

namespace lilyshark {
namespace {

template <typename Enum>
Enum nextPredicate(Enum value, std::uint8_t count) noexcept
{
    const std::uint8_t raw = static_cast<std::uint8_t>(value);
    if(raw >= count) return static_cast<Enum>(0U);
    return static_cast<Enum>((raw + 1U) % count);
}

template <typename Enum>
Enum previousPredicate(Enum value, std::uint8_t count) noexcept
{
    const std::uint8_t raw = static_cast<std::uint8_t>(value);
    if(raw >= count) return static_cast<Enum>(0U);
    return static_cast<Enum>(raw == 0U ? count - 1U : raw - 1U);
}

bool protocolMatches(TrafficProtocolPredicate predicate,
                     ProtocolId protocol) noexcept
{
    switch(predicate) {
    case TrafficProtocolPredicate::Any:
        return true;
    case TrafficProtocolPredicate::Meshtastic:
        return protocol == ProtocolId::Meshtastic;
    case TrafficProtocolPredicate::MeshCore:
        return protocol == ProtocolId::MeshCore;
    case TrafficProtocolPredicate::Reticulum:
        return protocol == ProtocolId::Reticulum;
    case TrafficProtocolPredicate::Custom:
        return protocol == ProtocolId::Custom;
    case TrafficProtocolPredicate::Unknown:
        return protocol == ProtocolId::Unknown;
    case TrafficProtocolPredicate::Count:
    default:
        return false;
    }
}

bool decodeMatches(TrafficDecodePredicate predicate,
                   DecodeState state) noexcept
{
    switch(predicate) {
    case TrafficDecodePredicate::Any:
        return true;
    case TrafficDecodePredicate::PayloadDecoded:
        return state == DecodeState::PayloadDecoded;
    case TrafficDecodePredicate::HeaderOnly:
        return state == DecodeState::HeaderOnly;
    case TrafficDecodePredicate::Raw:
        return state == DecodeState::Unknown;
    case TrafficDecodePredicate::NonMalformed:
        return state != DecodeState::Malformed;
    case TrafficDecodePredicate::Malformed:
        return state == DecodeState::Malformed;
    case TrafficDecodePredicate::Count:
    default:
        return false;
    }
}

bool crcMatches(TrafficCrcPredicate predicate, CrcStatus crc) noexcept
{
    switch(predicate) {
    case TrafficCrcPredicate::Any:
        return true;
    case TrafficCrcPredicate::Valid:
        return crc == CrcStatus::Valid;
    case TrafficCrcPredicate::Invalid:
        return crc == CrcStatus::Invalid;
    case TrafficCrcPredicate::NotPresent:
        return crc == CrcStatus::NotPresent;
    case TrafficCrcPredicate::Unknown:
        return crc == CrcStatus::Unknown;
    case TrafficCrcPredicate::Count:
    default:
        return false;
    }
}

bool validCaptureStreamHealth(CaptureStreamHealth state) noexcept
{
    switch(state) {
    case CaptureStreamHealth::Disabled:
    case CaptureStreamHealth::Starting:
    case CaptureStreamHealth::Recording:
    case CaptureStreamHealth::Unsupported:
    case CaptureStreamHealth::Fault:
        return true;
    default:
        return false;
    }
}

bool streamIs(CaptureStreamHealth actual,
              CaptureStreamHealth expected) noexcept
{
    return actual == expected;
}

std::uint16_t ratioPercentX10(std::uint64_t numerator,
                             std::uint64_t denominator) noexcept
{
    if(denominator == 0U || numerator == 0U) return 0U;
    if(numerator >= denominator) return 1000U;

    // All current inputs are 32-bit counters or tiny fixed ring capacities,
    // but keep this helper defined for the full uint64_t domain.
    if(numerator <= std::numeric_limits<std::uint64_t>::max() / 1000U) {
        return static_cast<std::uint16_t>((numerator * 1000U) / denominator);
    }

    // Avoid overflow for synthetic near-uint64 limits. Each iteration adds a
    // tenth of one percent without ever allowing the remainder to wrap.
    std::uint16_t result = 0U;
    std::uint64_t remainder = 0U;
    for(std::uint16_t step = 0U; step < 1000U; ++step) {
        if(remainder >= denominator - numerator) {
            remainder -= denominator - numerator;
            ++result;
        } else {
            remainder += numerator;
        }
    }
    return result;
}

bool completeSnprintf(int written, std::size_t capacity) noexcept
{
    return written >= 0 && static_cast<std::size_t>(written) < capacity;
}

} // namespace

bool TrafficFilter::active() const noexcept
{
    return protocol != TrafficProtocolPredicate::Any ||
           decode != TrafficDecodePredicate::Any ||
           crc != TrafficCrcPredicate::Any;
}

bool TrafficFilter::matches(const FrameRecord &record) const noexcept
{
    return protocolMatches(protocol, record.decoded.protocol) &&
           decodeMatches(decode, record.decoded.state) &&
           crcMatches(crc, record.raw.rf.crc);
}

const char *trafficProtocolPredicateLabel(
    TrafficProtocolPredicate predicate) noexcept
{
    switch(predicate) {
    case TrafficProtocolPredicate::Any:
        return "ANY";
    case TrafficProtocolPredicate::Meshtastic:
        return "MESHTASTIC";
    case TrafficProtocolPredicate::MeshCore:
        return "MESHCORE";
    case TrafficProtocolPredicate::Reticulum:
        return "RETICULUM";
    case TrafficProtocolPredicate::Custom:
        return "CUSTOM / APP";
    case TrafficProtocolPredicate::Unknown:
        return "UNKNOWN / RAW";
    case TrafficProtocolPredicate::Count:
    default:
        return "INVALID";
    }
}

const char *trafficDecodePredicateLabel(
    TrafficDecodePredicate predicate) noexcept
{
    switch(predicate) {
    case TrafficDecodePredicate::Any:
        return "ANY";
    case TrafficDecodePredicate::PayloadDecoded:
        return "PAYLOAD";
    case TrafficDecodePredicate::HeaderOnly:
        return "HEADER";
    case TrafficDecodePredicate::Raw:
        return "RAW";
    case TrafficDecodePredicate::NonMalformed:
        return "STRUCTURAL OK";
    case TrafficDecodePredicate::Malformed:
        return "MALFORMED";
    case TrafficDecodePredicate::Count:
    default:
        return "INVALID";
    }
}

const char *trafficCrcPredicateLabel(TrafficCrcPredicate predicate) noexcept
{
    switch(predicate) {
    case TrafficCrcPredicate::Any:
        return "ANY";
    case TrafficCrcPredicate::Valid:
        return "VALID";
    case TrafficCrcPredicate::Invalid:
        return "INVALID";
    case TrafficCrcPredicate::NotPresent:
        return "NOT PRESENT";
    case TrafficCrcPredicate::Unknown:
        return "UNKNOWN";
    case TrafficCrcPredicate::Count:
    default:
        return "INVALID FILTER";
    }
}

TrafficProtocolPredicate nextTrafficProtocolPredicate(
    TrafficProtocolPredicate predicate) noexcept
{
    return nextPredicate(
        predicate,
        static_cast<std::uint8_t>(TrafficProtocolPredicate::Count));
}

TrafficProtocolPredicate previousTrafficProtocolPredicate(
    TrafficProtocolPredicate predicate) noexcept
{
    return previousPredicate(
        predicate,
        static_cast<std::uint8_t>(TrafficProtocolPredicate::Count));
}

TrafficDecodePredicate nextTrafficDecodePredicate(
    TrafficDecodePredicate predicate) noexcept
{
    return nextPredicate(
        predicate, static_cast<std::uint8_t>(TrafficDecodePredicate::Count));
}

TrafficDecodePredicate previousTrafficDecodePredicate(
    TrafficDecodePredicate predicate) noexcept
{
    return previousPredicate(
        predicate, static_cast<std::uint8_t>(TrafficDecodePredicate::Count));
}

TrafficCrcPredicate nextTrafficCrcPredicate(
    TrafficCrcPredicate predicate) noexcept
{
    return nextPredicate(
        predicate, static_cast<std::uint8_t>(TrafficCrcPredicate::Count));
}

TrafficCrcPredicate previousTrafficCrcPredicate(
    TrafficCrcPredicate predicate) noexcept
{
    return previousPredicate(
        predicate, static_cast<std::uint8_t>(TrafficCrcPredicate::Count));
}

CaptureHealthSnapshot makeCaptureHealthSnapshot(
    const CaptureHealthInput &input, std::size_t retained_frames,
    std::size_t buffer_capacity, std::uint64_t total_frames_seen,
    std::uint64_t ram_overwrites) noexcept
{
    CaptureHealthSnapshot snapshot{};
    snapshot.native_stream = input.native_stream;
    snapshot.pcap_stream = input.pcap_stream;
    snapshot.retained_frames = retained_frames;
    snapshot.buffer_capacity = buffer_capacity;
    snapshot.total_frames_seen = total_frames_seen;
    snapshot.ram_overwrites = ram_overwrites;
    snapshot.capture_requested = input.capture_requested;
    snapshot.storage_available = input.storage_available;

    const std::uint64_t retained = retained_frames > buffer_capacity
                                       ? buffer_capacity
                                       : retained_frames;
    snapshot.buffer_fill_percent_x10 = ratioPercentX10(
        retained, buffer_capacity);

    const bool native_valid = validCaptureStreamHealth(input.native_stream);
    const bool pcap_valid = validCaptureStreamHealth(input.pcap_stream);
    const bool any_recording =
        streamIs(input.native_stream, CaptureStreamHealth::Recording) ||
        streamIs(input.pcap_stream, CaptureStreamHealth::Recording);
    const bool any_starting =
        streamIs(input.native_stream, CaptureStreamHealth::Starting) ||
        streamIs(input.pcap_stream, CaptureStreamHealth::Starting);
    const bool any_fault = !native_valid || !pcap_valid ||
        streamIs(input.native_stream, CaptureStreamHealth::Fault) ||
        streamIs(input.pcap_stream, CaptureStreamHealth::Fault);

    // Active writers are observable fact and take precedence over a stale or
    // failed preference flag. This keeps the health screen truthful while a
    // settings write or stop operation is still settling.
    if(any_recording) {
        snapshot.state = any_fault ? CaptureHealthState::Degraded
                                   : CaptureHealthState::Recording;
    } else if(!input.capture_requested) {
        snapshot.state = CaptureHealthState::Off;
    } else if(!input.storage_available) {
        snapshot.state = CaptureHealthState::Unavailable;
    } else if(any_starting) {
        snapshot.state = any_fault ? CaptureHealthState::Fault
                                   : CaptureHealthState::Starting;
    } else if(any_fault) {
        snapshot.state = CaptureHealthState::Fault;
    } else {
        snapshot.state = CaptureHealthState::Unavailable;
    }
    return snapshot;
}

const char *captureHealthStateLabel(CaptureHealthState state) noexcept
{
    switch(state) {
    case CaptureHealthState::Off:
        return "OFF";
    case CaptureHealthState::Starting:
        return "STARTING";
    case CaptureHealthState::Recording:
        return "RECORDING";
    case CaptureHealthState::Degraded:
        return "DEGRADED";
    case CaptureHealthState::Unavailable:
        return "UNAVAILABLE";
    case CaptureHealthState::Fault:
        return "FAULT";
    default:
        return "UNKNOWN";
    }
}

const char *captureStreamHealthLabel(CaptureStreamHealth state) noexcept
{
    switch(state) {
    case CaptureStreamHealth::Disabled:
        return "OFF";
    case CaptureStreamHealth::Starting:
        return "STARTING";
    case CaptureStreamHealth::Recording:
        return "RECORDING";
    case CaptureStreamHealth::Unsupported:
        return "UNSUPPORTED";
    case CaptureStreamHealth::Fault:
        return "FAULT";
    default:
        return "UNKNOWN";
    }
}

RxHealthSnapshot makeRxHealthSnapshot(const RadioStatus &status,
                                      std::uint32_t now_ms) noexcept
{
    RxHealthSnapshot snapshot{};
    snapshot.state = !status.initialized
                         ? RxHealthState::Offline
                         : (status.receiving ? RxHealthState::Listening
                                             : RxHealthState::Recovering);
    snapshot.received_frames = status.received_frames;
    snapshot.crc_errors = status.crc_errors;
    snapshot.receive_errors = status.receive_errors;
    snapshot.profile_switch_failures = status.profile_switch_failures;
    snapshot.last_error = status.last_error;
    snapshot.last_profile_error = status.last_profile_error;
    snapshot.has_last_frame = status.received_frames != 0U;
    if(snapshot.has_last_frame) {
        snapshot.last_frame_age_ms = now_ms - status.last_frame_ms;
    }
    snapshot.crc_error_percent_x10 = ratioPercentX10(
        status.crc_errors, status.received_frames);
    snapshot.receive_error_percent_x10 = ratioPercentX10(
        status.receive_errors,
        static_cast<std::uint64_t>(status.received_frames) +
            status.receive_errors);
    return snapshot;
}

const char *rxHealthStateLabel(RxHealthState state) noexcept
{
    switch(state) {
    case RxHealthState::Offline:
        return "OFFLINE";
    case RxHealthState::Recovering:
        return "RECOVERING";
    case RxHealthState::Listening:
        return "LISTENING";
    default:
        return "UNKNOWN";
    }
}

bool formatDiagnosticCount(char *destination, std::size_t capacity,
                           std::uint64_t value) noexcept
{
    if(destination == nullptr || capacity == 0U) return false;
    const int written = std::snprintf(
        destination, capacity, "%llu",
        static_cast<unsigned long long>(value));
    return completeSnprintf(written, capacity);
}

bool formatDiagnosticPercentX10(char *destination, std::size_t capacity,
                                std::uint16_t percent_x10) noexcept
{
    if(destination == nullptr || capacity == 0U) return false;
    const int written = std::snprintf(
        destination, capacity, "%u.%u%%",
        static_cast<unsigned>(percent_x10 / 10U),
        static_cast<unsigned>(percent_x10 % 10U));
    return completeSnprintf(written, capacity);
}

bool formatDiagnosticAge(char *destination, std::size_t capacity,
                         bool available, std::uint32_t age_ms) noexcept
{
    if(destination == nullptr || capacity == 0U) return false;

    int written = 0;
    if(!available) {
        written = std::snprintf(destination, capacity, "NO FRAME");
    } else if(age_ms < 1000U) {
        written = std::snprintf(destination, capacity, "<1s");
    } else if(age_ms < 60000U) {
        written = std::snprintf(destination, capacity, "%lus",
                                static_cast<unsigned long>(age_ms / 1000U));
    } else if(age_ms < 3600000U) {
        const std::uint32_t total_seconds = age_ms / 1000U;
        written = std::snprintf(
            destination, capacity, "%lum %02lus",
            static_cast<unsigned long>(total_seconds / 60U),
            static_cast<unsigned long>(total_seconds % 60U));
    } else {
        const std::uint32_t total_minutes = age_ms / 60000U;
        written = std::snprintf(
            destination, capacity, "%luh %02lum",
            static_cast<unsigned long>(total_minutes / 60U),
            static_cast<unsigned long>(total_minutes % 60U));
    }
    return completeSnprintf(written, capacity);
}

bool formatCaptureBufferUse(char *destination, std::size_t capacity,
                            const CaptureHealthSnapshot &snapshot) noexcept
{
    if(destination == nullptr || capacity == 0U) return false;
    const int written = std::snprintf(
        destination, capacity, "%llu / %llu  %u.%u%%",
        static_cast<unsigned long long>(snapshot.retained_frames),
        static_cast<unsigned long long>(snapshot.buffer_capacity),
        static_cast<unsigned>(snapshot.buffer_fill_percent_x10 / 10U),
        static_cast<unsigned>(snapshot.buffer_fill_percent_x10 % 10U));
    return completeSnprintf(written, capacity);
}

bool formatTrafficFilterSummary(char *destination, std::size_t capacity,
                                const TrafficFilter &filter) noexcept
{
    if(destination == nullptr || capacity == 0U) return false;
    const int written = std::snprintf(
        destination, capacity, "%s / %s / %s",
        trafficProtocolPredicateLabel(filter.protocol),
        trafficDecodePredicateLabel(filter.decode),
        trafficCrcPredicateLabel(filter.crc));
    return completeSnprintf(written, capacity);
}

} // namespace lilyshark
