#include <array>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cstring>

#if defined(LILYSHARK_DEVICE)
#include <Arduino.h>
#include <Preferences.h>
#include <SD.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <Wire.h>
#include <esp_timer.h>
#else
#include <SDL.h>
#endif
#include <lvgl.h>
#if !defined(LILYSHARK_DEVICE)
#include <src/drivers/sdl/lv_sdl_keyboard.h>
#include <src/drivers/sdl/lv_sdl_mouse.h>
#include <src/drivers/sdl/lv_sdl_window.h>
#include "lilyshark/simulator/live_telemetry.h"
#endif

#include "theme.h"
#include "lilyshark/core/app_settings.h"
#include "lilyshark/core/builtin_profiles.h"
#include "lilyshark/core/diagnostic_tools.h"
#include "lilyshark/core/spectrum.h"
#include "lilyshark/ui/app_shell.h"
#include "lilyshark/ui/assets/lilyshark_wordmark_a8.h"
#if !defined(LILYSHARK_DEVICE)
#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshtastic_decoder.h"
#include "lilyshark/protocols/reticulum_decoder.h"
#include "lilyshark/ui/packet_presentation.h"
#endif
#if defined(LILYSHARK_DEVICE)
#include "lilyshark/core/monotonic_time.h"
#include "lilyshark/core/capture_runtime.h"
#include "lilyshark/device/simulate_source.h"
#include "lilyshark/core/profile_settings.h"
#include "lilyshark/core/profile_tuning.h"
#include "lilyshark/core/rolling_diagnostics.h"
#include "lilyshark/core/runtime_event_history.h"
#include "lilyshark/core/survey_accumulator.h"
#include "lilyshark/device/hardware_status.h"
#include "lilyshark/device/radio_service.h"
#include "lilyshark/device/screenshot.h"
#include "lilyshark/device/tdeck_display_init.h"
#include "lilyshark/device/touch.h"
#include "lilyshark/device/tdeck_sd_sink.h"
#include "lilyshark/export/lilyshark_capture.h"
#include "lilyshark/export/pcap_loratap.h"
#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshtastic_decoder.h"
#include "lilyshark/protocols/reticulum_decoder.h"
#include "lilyshark/shelby/shelby_pointer_decoder.h"
#include "lilyshark/tdeck.h"
#include "lilyshark/ui/packet_presentation.h"
#endif

namespace {

using namespace lilyshark;

enum class Screen : uint8_t {
    traffic,
    traffic_filter,
    protocols,
    protocol_detail,
    spectrum,
    nodes,
    node_detail,
    packet_detail,
    map,
    survey,
    utilization,
    timeline,
    events,
    count,
};

enum class SpectrumScanMode : std::uint8_t {
    FastNarrow = 0U,
    DeepBand,
};

struct PacketRow {
    const char * time;
    const char * source;
    const char * destination;
    const char * port;
    const char * hops;
    const char * snr;
};

struct NodeRow {
    const char * name;
    const char * seen;
    const char * battery;
    uint8_t spark_seed;
};

struct Point {
    lv_coord_t x;
    lv_coord_t y;
};

constexpr std::array<const char *, static_cast<size_t>(Screen::count)> screen_names = {
    "TRAFFIC", "TRAFFIC FILTER", "PROTOCOLS", "PROTOCOL DETAIL", "SPECTRUM", "NODES", "NODE DETAIL", "PACKET DETAIL",
    "MAP", "SURVEY", "UTILIZATION", "TIMELINE", "EVENTS",
};

constexpr std::array<PacketRow, 15> packets = {{
    {"14:02:11", "Yosemite",  "^all",   "POS",   "3", "-7.2"},
    {"14:02:09", "Hilltop7",  "Node42", "TEXT",  "1", "-11.4"},
    {"14:02:07", "Relay-3",   "^all",   "TELE",  "2", "-9.1"},
    {"14:02:05", "Node42",    "^all",   "ROUTE", "1", "-14.0"},
    {"14:02:05", "Node42",    "^all",   "ROUTE", "1", "-14.0"},
    {"14:02:03", "Tracker-9", "^all",   "POS",   "1", "-14.0"},
    {"14:02:01", "Relay-3",   "^all",   "HUKE",  "2", "-12.0"},
    {"14:01:59", "Mearnes-7", "^all",   "ROUTE", "1", "-14.4"},
    {"14:01:57", "Node42",    "^all",   "ROUTE", "1", "-14.0"},
    {"14:01:55", "Tracker-9", "^all",   "POS",   "1", "-14.0"},
    {"14:01:53", "Hilltop7",  "Node42", "TEXT",  "1", "-14.0"},
    {"14:01:51", "Node42",    "^all",   "ROUTE", "2", "-14.0"},
    {"14:01:49", "Tracker-9", "^all",   "POS",   "1", "-5.2"},
    {"14:01:47", "Relay-3",   "^all",   "TELE",  "2", "-8.6"},
    {"14:01:45", "Yosemite",  "Node42", "ROUTE", "1", "-10.1"},
}};

constexpr std::array<NodeRow, 8> nodes = {{
    {"Yosemite",  "12s", "85%",  3},
    {"Hilltop7",  "1m",  "100%", 7},
    {"Relay3",    "4m",  "78%",  11},
    {"BaseCamp",  "7m",  "92%",  17},
    {"Mobile-4",  "12m", "61%",  23},
    {"Tracker-9", "15m", "55%",  29},
    {"Node42",    "18m", "67%",  31},
    {"RidgeLink", "22m", "48%",  37},
}};

constexpr char firmware_version[] = "v0.1.0-alpha.7";
Screen current_screen = Screen::traffic;
AppShell app_shell{};
AppSettings app_settings = defaultAppSettings();
std::size_t onboarding_network_selection = 0;
std::size_t onboarding_profile_selection = 0;
std::size_t display_input_selection = 0;
bool onboarding_complete = false;
bool onboarding_save_failed = false;
bool reset_save_failed = false;
bool display_settings_save_failed = false;
bool capture_settings_save_failed = false;
bool startup_services_complete = false;
bool reset_confirmation_yes = false;
std::size_t spectrum_confirmation_selection = 1U;
SpectrumScanMode spectrum_scan_mode = SpectrumScanMode::FastNarrow;
char shell_notice[64]{};
lv_obj_t * root = nullptr;
#if defined(LILYSHARK_DEVICE)
static uint8_t * spectrum_buffer = nullptr;
CaptureRuntime<64> capture_runtime{};
MeshtasticDecoder meshtastic_decoder{};
MeshCoreDecoder meshcore_decoder{};
ReticulumDecoder reticulum_decoder{};
ShelbyPointerDecoder shelby_pointer_decoder{};
TDeckRadioService radio_service{};
TDeckHardwareStatus hardware_status{};
// Simulate mode exercises the real decoder and analyzer path. Its frames carry
// explicit provenance in native captures, stay out of LoRaTap PCAP, and cannot
// mix with live SX1262 traffic because receive is paused while the mode is on.
lilyshark::device::SimulateSource simulate_source{};
TDeckTouch touch_service{};
TDeckSdByteSink pcap_sink{};
PcapLoraTapWriter pcap_writer{pcap_sink};
TDeckSdByteSink native_capture_sink{};
LilysharkCaptureWriter native_capture_writer{native_capture_sink};
std::size_t active_profile_index = 0;
bool live_data_dirty = false;
bool sd_mounted = false;
bool sd_io_error = false;
bool keyboard_ready = false;
bool screenshot_attempted = false;
bool pcap_recording = false;
bool native_capture_recording = false;
bool survey_running = false;
bool survey_has_result = false;
SurveyAccumulator survey_accumulator{};
RollingDiagnosticAccumulator rolling_diagnostics{};
RuntimeEventHistory runtime_event_history{};
bool first_frame_event_recorded = false;
// Defined with the ingest path below; the packet inspector renders with them.
void format_unix_date(std::uint32_t unix_seconds, char *out, std::size_t capacity) noexcept;
bool decode_frame_shelby_pointer(const FrameRecord &record, ShelbyPointer &out) noexcept;

// Web-analyzer USB link: lilyshark.com handshakes over the CDC serial with
// "LSK HELLO"; while linked, the device loop streams newline-delimited
// telemetry lines the analyzer renders live. Plain text on purpose — a human
// with a serial monitor reads the same protocol the web app does.
bool analyzer_link_active = false;
std::uint32_t analyzer_link_last_telemetry_ms = 0;
char analyzer_link_line[96]{};
std::size_t analyzer_link_line_length = 0;

bool observed_radio_initialized = false;
bool observed_radio_receiving = false;
bool pcap_bandwidth_warning_recorded = false;
bool pcap_synthetic_warning_recorded = false;
std::uint32_t last_ui_refresh_ms = 0;
std::uint32_t last_hardware_ui_refresh_ms = 0;
std::uint32_t last_dynamic_ui_refresh_ms = 0;
std::uint32_t last_capture_flush_ms = 0;
std::uint32_t last_screenshot_gap_ms = 0;
std::uint32_t survey_elapsed_ms = 0;
std::uint32_t survey_last_accounted_ms = 0;
SpectrumSweepState observed_spectrum_state = SpectrumSweepState::Idle;
std::uint16_t observed_spectrum_points = 0;
std::uint64_t traffic_selected_sequence = 0;
std::uint64_t packet_detail_sequence = 0;
ProtocolId node_selected_protocol = ProtocolId::Unknown;
std::uint32_t node_selected_id = 0;
bool node_selection_valid = false;
ProtocolId node_detail_protocol = ProtocolId::Unknown;
std::uint32_t node_detail_id = 0;
bool node_detail_selection_valid = false;
PcapWriteResult last_pcap_result = PcapWriteResult::NotStarted;
LilysharkCaptureWriteResult last_native_capture_result = LilysharkCaptureWriteResult::NotStarted;
ScreenshotWriteResult last_screenshot_result = ScreenshotWriteResult::StorageError;
char pcap_path[48]{};
char native_capture_path[48]{};
char screenshot_path[48]{};
char live_battery_label[16] = "BAT --";
char live_gps_label[16] = "GPS --";
char live_radio_label[16] = "RX INIT";
Preferences profile_preferences{};
bool profile_preferences_ready = false;
const char *protocol_abbreviation(ProtocolId protocol) noexcept;

bool touch_input_ready() noexcept
{
    return touch_service.status() == TouchStatus::Ready;
}
#else
static uint8_t spectrum_buffer[LV_CANVAS_BUF_SIZE(306, 145, 16, LV_DRAW_BUF_STRIDE_ALIGN)];
lilyshark::simulator::LiveTelemetry simulator_live_telemetry{};
#endif

// The static preview path is compiled for both targets even though device views
// return after drawing live data. Keep its state available to both builds while
// only the simulator mutates it.
std::size_t simulator_traffic_selection = 5;
std::uint64_t simulator_traffic_selected_sequence = 0U;
std::size_t simulator_packet_detail_selection = 5;
std::size_t simulator_node_selection = 2;
std::uint32_t simulator_node_selected_id = 0U;
bool simulator_node_selection_valid = false;
std::uint32_t simulator_node_detail_id = 0U;
bool simulator_node_detail_selection_valid = false;
std::size_t simulator_active_profile_index = 0;
std::size_t packet_detail_byte_offset = 0;
std::size_t packet_detail_tab = 0;
std::size_t events_scroll_offset = 0;
std::size_t protocols_selection = 0;
std::size_t timeline_filter_selection = 0;
TrafficFilter traffic_filter{};
std::size_t traffic_filter_selection = 0U;
bool event_detail_open = false;
bool simulator_spectrum_scanning = false;
bool simulator_survey_running = false;
#if !defined(LILYSHARK_DEVICE)
std::uint32_t simulator_spectrum_started_ms = 0U;
std::uint16_t simulator_spectrum_partial_points = 0U;
bool simulator_spectrum_cancelled = false;
simulator::TrafficSample simulator_packet_detail_sample{};
bool simulator_packet_detail_sample_valid = false;
#endif

const char *simulator_survey_footer() noexcept
{
    if(simulator_spectrum_scanning) return "SPECTRUM SCANNING";
    return simulator_survey_running ? "ENTER  CANCEL SURVEY" : "ENTER  START 60s SURVEY";
}
static std::array<std::array<lv_point_precise_t, 160>, 16> trace_buffers;
size_t trace_buffer_index = 0;
void add_status_bar(lv_obj_t *parent, const char *title, const char *left_value,
                    const char *middle_value, const char *right_value);

#if !defined(LILYSHARK_DEVICE)
const char *simulator_protocol_label(simulator::SimulatedProtocol protocol) noexcept
{
    switch(protocol) {
        case simulator::SimulatedProtocol::Meshtastic: return "MESHT";
        case simulator::SimulatedProtocol::MeshCore: return "MCORE";
        case simulator::SimulatedProtocol::Reticulum: return "RNS";
        case simulator::SimulatedProtocol::Unknown:
        case simulator::SimulatedProtocol::Count:
        default: return "UNKNOWN";
    }
}

simulator::SimulatedProtocol simulator_protocol_for_profile(
    const RadioProfile &profile) noexcept
{
    switch(profile.protocol_hint) {
        case ProtocolId::Meshtastic: return simulator::SimulatedProtocol::Meshtastic;
        case ProtocolId::MeshCore: return simulator::SimulatedProtocol::MeshCore;
        case ProtocolId::Reticulum: return simulator::SimulatedProtocol::Reticulum;
        case ProtocolId::Custom:
        case ProtocolId::Unknown:
        default: return simulator::SimulatedProtocol::Unknown;
    }
}

simulator::SimulatedRfProfile simulator_rf_profile_for_profile(
    const RadioProfile &profile) noexcept
{
    simulator::SimulatedRfProfile simulated{};
    simulated.protocol = simulator_protocol_for_profile(profile);
    simulated.center_frequency_hz = profile.center_frequency_hz;
    simulated.bandwidth_hz = profile.bandwidth_hz;
    simulated.spreading_factor = profile.spreading_factor;
    simulated.coding_rate_denominator = profile.coding_rate_denominator;
    simulated.sync_word = profile.sync_word;
    simulated.profile_id = static_cast<std::uint8_t>(profile.id);
    return simulated;
}

const char *simulator_packet_kind_label(
    const simulator::TrafficSample &sample) noexcept
{
    if(sample.decode_outcome == simulator::SimulatedDecodeOutcome::Raw) return "RAW";
    if(sample.decode_outcome == simulator::SimulatedDecodeOutcome::Malformed) return "BAD";
    if(sample.protocol == simulator::SimulatedProtocol::MeshCore) {
        switch(sample.port) {
            case 0U: return "REQ";
            case 1U: return "RESP";
            case 2U: return "TEXT";
            case 3U: return "ACK";
            case 4U: return "ADV";
            case 5U: return "GTXT";
            case 6U: return "GDATA";
            case 7U: return "ANON";
            case 8U: return "PATH";
            case 9U: return "TRACE";
            case 10U: return "MULTI";
            case 11U: return "CTRL";
            case 15U: return "RAW";
            default: return "RSVD";
        }
    }
    if(sample.protocol == simulator::SimulatedProtocol::Meshtastic) return "OPAQUE";
    if(sample.protocol == simulator::SimulatedProtocol::Reticulum) return "DATA";
    return "RAW";
}

bool decode_simulator_packet(const simulator::TrafficSample &sample,
                             DecodedPacket &decoded) noexcept
{
    RawFrame frame{};
    if(!frame.assignPayload(sample.bytes.data(), sample.captured_bytes)) return false;
    RadioProfile profile{};
    switch(sample.protocol) {
        case simulator::SimulatedProtocol::Meshtastic: {
            profile.protocol_hint = ProtocolId::Meshtastic;
            MeshtasticDecoder decoder{};
            return decoder.decode(frame, profile, decoded) != DecodeResult::NoMatch;
        }
        case simulator::SimulatedProtocol::MeshCore: {
            profile.protocol_hint = ProtocolId::MeshCore;
            MeshCoreDecoder decoder{};
            return decoder.decode(frame, profile, decoded) != DecodeResult::NoMatch;
        }
        case simulator::SimulatedProtocol::Reticulum: {
            profile.protocol_hint = ProtocolId::Reticulum;
            ReticulumDecoder decoder{};
            return decoder.decode(frame, profile, decoded) != DecodeResult::NoMatch;
        }
        case simulator::SimulatedProtocol::Unknown:
        case simulator::SimulatedProtocol::Count:
        default:
            decoded = makeUnknownPacket(frame);
            return false;
    }
}

const char *simulator_node_name(std::uint8_t node) noexcept
{
    return node == simulator::kNoNode ? "^all" : nodes[node % nodes.size()].name;
}

void format_simulator_node_id(char *output, std::size_t capacity,
                              std::uint8_t node, bool broadcast) noexcept
{
    if(node == simulator::kNoNode) {
        std::snprintf(output, capacity, "%s", broadcast ? "ALL" : "--");
        return;
    }
    const simulator::NodeSnapshot &snapshot =
        simulator_live_telemetry.nodes().nodes[node % simulator::kNodeCount];
    std::snprintf(output, capacity, "%08lX", static_cast<unsigned long>(snapshot.id));
}

std::size_t simulator_established_node_count() noexcept
{
    std::size_t count = 0U;
    for(const simulator::NodeSnapshot &node : simulator_live_telemetry.nodes().nodes) {
        if(node.frame_count != 0U) ++count;
    }
    return count;
}

const simulator::NodeSnapshot *simulator_established_node(
    std::size_t offset, std::size_t *raw_index = nullptr) noexcept
{
    std::size_t visible = 0U;
    const simulator::NodesSnapshot &snapshot = simulator_live_telemetry.nodes();
    for(std::size_t index = 0U; index < snapshot.nodes.size(); ++index) {
        if(snapshot.nodes[index].frame_count == 0U) continue;
        if(visible == offset) {
            if(raw_index != nullptr) *raw_index = index;
            return &snapshot.nodes[index];
        }
        ++visible;
    }
    return nullptr;
}

const simulator::NodeSnapshot *simulator_established_node_by_id(
    std::uint32_t id) noexcept
{
    for(const simulator::NodeSnapshot &node : simulator_live_telemetry.nodes().nodes) {
        if(node.frame_count != 0U && node.id == id) return &node;
    }
    return nullptr;
}

std::size_t resolve_simulator_node_selection() noexcept
{
    const std::size_t count = simulator_established_node_count();
    if(count == 0U) {
        simulator_node_selection = 0U;
        simulator_node_selected_id = 0U;
        simulator_node_selection_valid = false;
        return 0U;
    }
    if(simulator_node_selection_valid) {
        for(std::size_t offset = 0U; offset < count; ++offset) {
            const simulator::NodeSnapshot *node = simulator_established_node(offset);
            if(node != nullptr && node->id == simulator_node_selected_id) {
                simulator_node_selection = offset;
                return offset;
            }
        }
    }
    if(simulator_node_selection >= count) simulator_node_selection = count - 1U;
    const simulator::NodeSnapshot *node = simulator_established_node(simulator_node_selection);
    simulator_node_selected_id = node == nullptr ? 0U : node->id;
    simulator_node_selection_valid = node != nullptr;
    return simulator_node_selection;
}

bool simulator_sample_matches_filter(const simulator::TrafficSample &sample) noexcept
{
    bool protocol_matches = false;
    switch(traffic_filter.protocol) {
        case TrafficProtocolPredicate::Any: protocol_matches = true; break;
        case TrafficProtocolPredicate::Meshtastic:
            protocol_matches = sample.protocol == simulator::SimulatedProtocol::Meshtastic; break;
        case TrafficProtocolPredicate::MeshCore:
            protocol_matches = sample.protocol == simulator::SimulatedProtocol::MeshCore; break;
        case TrafficProtocolPredicate::Reticulum:
            protocol_matches = sample.protocol == simulator::SimulatedProtocol::Reticulum; break;
        case TrafficProtocolPredicate::Unknown:
            protocol_matches = sample.protocol == simulator::SimulatedProtocol::Unknown; break;
        case TrafficProtocolPredicate::Custom:
        case TrafficProtocolPredicate::Count:
        default: protocol_matches = false; break;
    }
    if(!protocol_matches) return false;

    bool decode_matches = false;
    switch(traffic_filter.decode) {
        case TrafficDecodePredicate::Any: decode_matches = true; break;
        case TrafficDecodePredicate::PayloadDecoded:
            decode_matches = sample.decode_outcome == simulator::SimulatedDecodeOutcome::Decoded; break;
        case TrafficDecodePredicate::HeaderOnly:
            decode_matches = sample.decode_outcome == simulator::SimulatedDecodeOutcome::Opaque; break;
        case TrafficDecodePredicate::Raw:
            decode_matches = sample.decode_outcome == simulator::SimulatedDecodeOutcome::Raw; break;
        case TrafficDecodePredicate::NonMalformed:
            decode_matches = sample.decode_outcome !=
                simulator::SimulatedDecodeOutcome::Malformed; break;
        case TrafficDecodePredicate::Malformed:
            decode_matches = sample.decode_outcome == simulator::SimulatedDecodeOutcome::Malformed; break;
        case TrafficDecodePredicate::Count:
        default: decode_matches = false; break;
    }
    if(!decode_matches) return false;

    switch(traffic_filter.crc) {
        case TrafficCrcPredicate::Any: return true;
        case TrafficCrcPredicate::Valid: return sample.crc_valid;
        case TrafficCrcPredicate::Invalid: return !sample.crc_valid;
        case TrafficCrcPredicate::NotPresent:
        case TrafficCrcPredicate::Unknown:
        case TrafficCrcPredicate::Count:
        default: return false;
    }
}

const simulator::TrafficSample *simulator_matching_sample(std::size_t matching_offset) noexcept
{
    const simulator::TrafficSnapshot &traffic = simulator_live_telemetry.traffic();
    std::size_t seen = 0U;
    for(std::size_t offset = 0U; offset < traffic.size; ++offset) {
        const simulator::TrafficSample *sample = traffic.newest(offset);
        if(sample == nullptr || !simulator_sample_matches_filter(*sample)) continue;
        if(seen == matching_offset) return sample;
        ++seen;
    }
    return nullptr;
}

std::size_t simulator_matching_sample_count() noexcept
{
    const simulator::TrafficSnapshot &traffic = simulator_live_telemetry.traffic();
    std::size_t count = 0U;
    for(std::size_t offset = 0U; offset < traffic.size; ++offset) {
        const simulator::TrafficSample *sample = traffic.newest(offset);
        if(sample != nullptr && simulator_sample_matches_filter(*sample)) ++count;
    }
    return count;
}

void focus_simulator_packet_with_minimum_bytes(std::size_t minimum_bytes) noexcept
{
    const std::size_t count = simulator_matching_sample_count();
    for(std::size_t offset = 0U; offset < count; ++offset) {
        const simulator::TrafficSample *sample = simulator_matching_sample(offset);
        if(sample == nullptr || sample->captured_bytes < minimum_bytes) continue;
        simulator_traffic_selection = offset;
        simulator_traffic_selected_sequence = sample->sequence;
        return;
    }
    simulator_traffic_selection = 0U;
    const simulator::TrafficSample *sample = simulator_matching_sample(0U);
    simulator_traffic_selected_sequence = sample == nullptr ? 0U : sample->sequence;
}

void focus_simulator_inspector_packet() noexcept
{
    const std::size_t count = simulator_matching_sample_count();
    for(std::size_t offset = 0U; offset < count; ++offset) {
        const simulator::TrafficSample *sample = simulator_matching_sample(offset);
        if(sample == nullptr || sample->captured_bytes < 81U ||
           sample->protocol != simulator::SimulatedProtocol::Meshtastic ||
           sample->decode_outcome != simulator::SimulatedDecodeOutcome::Opaque) {
            continue;
        }
        simulator_traffic_selection = offset;
        simulator_traffic_selected_sequence = sample->sequence;
        return;
    }
    focus_simulator_packet_with_minimum_bytes(81U);
}

std::size_t resolve_simulator_traffic_selection() noexcept
{
    const std::size_t matching_count = simulator_matching_sample_count();
    if(matching_count == 0U) {
        simulator_traffic_selection = 0U;
        simulator_traffic_selected_sequence = 0U;
        return 0U;
    }

    if(simulator_traffic_selected_sequence != 0U) {
        for(std::size_t offset = 0U; offset < matching_count; ++offset) {
            const simulator::TrafficSample *sample = simulator_matching_sample(offset);
            if(sample != nullptr && sample->sequence == simulator_traffic_selected_sequence) {
                simulator_traffic_selection = offset;
                return offset;
            }
        }
    }

    if(simulator_traffic_selection >= matching_count) {
        simulator_traffic_selection = matching_count - 1U;
    }
    const simulator::TrafficSample *fallback =
        simulator_matching_sample(simulator_traffic_selection);
    simulator_traffic_selected_sequence = fallback == nullptr ? 0U : fallback->sequence;
    return simulator_traffic_selection;
}

bool move_simulator_traffic_selection(int direction) noexcept
{
    const std::size_t matching_count = simulator_matching_sample_count();
    if(matching_count == 0U || direction == 0) return false;
    std::size_t selected_offset = resolve_simulator_traffic_selection();
    if(direction > 0) {
        selected_offset = (selected_offset + 1U) % matching_count;
    } else {
        selected_offset = selected_offset == 0U ? matching_count - 1U
                                                 : selected_offset - 1U;
    }
    const simulator::TrafficSample *selected = simulator_matching_sample(selected_offset);
    if(selected == nullptr) return false;
    simulator_traffic_selection = selected_offset;
    simulator_traffic_selected_sequence = selected->sequence;
    return true;
}

bool select_simulator_packet_for_detail() noexcept
{
    const std::size_t matching_count = simulator_matching_sample_count();
    if(matching_count == 0U) {
        simulator_packet_detail_sample_valid = false;
        return false;
    }
    const std::size_t selected_offset = resolve_simulator_traffic_selection();
    const simulator::TrafficSample *sample = simulator_matching_sample(selected_offset);
    if(sample == nullptr) {
        simulator_packet_detail_sample_valid = false;
        return false;
    }
    simulator_packet_detail_sample = *sample;
    simulator_packet_detail_selection = selected_offset;
    simulator_packet_detail_sample_valid = true;
    packet_detail_byte_offset = 0U;
    return true;
}

void format_simulator_clock(char *output, std::size_t capacity,
                            std::uint32_t seconds_of_day) noexcept
{
    const std::uint32_t hours = (seconds_of_day / 3600U) % 24U;
    const std::uint32_t minutes = (seconds_of_day / 60U) % 60U;
    const std::uint32_t seconds = seconds_of_day % 60U;
    std::snprintf(output, capacity, "%02lu:%02lu:%02lu",
                  static_cast<unsigned long>(hours), static_cast<unsigned long>(minutes),
                  static_cast<unsigned long>(seconds));
}

void format_simulator_age(char *output, std::size_t capacity,
                          std::uint32_t seconds) noexcept
{
    if(seconds < 60U) {
        std::snprintf(output, capacity, "%lus", static_cast<unsigned long>(seconds));
    } else if(seconds < 3600U) {
        std::snprintf(output, capacity, "%lum", static_cast<unsigned long>(seconds / 60U));
    } else {
        std::snprintf(output, capacity, "%luh", static_cast<unsigned long>(seconds / 3600U));
    }
}

void add_simulator_live_status_bar(lv_obj_t *parent, const char *title,
                                   const char *middle = nullptr)
{
    char packet_rate[20]{};
    std::snprintf(packet_rate, sizeof(packet_rate), "%u pkt/min",
                  static_cast<unsigned>(simulator_live_telemetry.traffic().packets_per_minute));
    const char *gps = app_settings.gps_enabled ? "GPS 3D" : "GPS OFF";
    add_status_bar(parent, title, "BAT 87%", middle == nullptr ? gps : middle, packet_rate);
}

void draw_simulator_node_history(lv_obj_t *parent,
                                 const simulator::NodeSnapshot &node,
                                 lv_coord_t x, lv_coord_t y,
                                 lv_coord_t width, lv_coord_t height,
                                 lv_color_t color, bool rssi = false) noexcept
{
    if(trace_buffer_index >= trace_buffers.size()) return;
    auto &points = trace_buffers[trace_buffer_index++];
    const std::size_t sample_count = node.history_size < simulator::kNodeHistoryCapacity
        ? node.history_size : simulator::kNodeHistoryCapacity;
    if(sample_count == 0U) return;
    const auto sample_value = [&](std::size_t age) noexcept {
        return rssi ? node.rssi(age) : node.snr(age);
    };
    std::int16_t low = sample_value(0U);
    std::int16_t high = low;
    for(std::size_t age = 1U; age < sample_count; ++age) {
        const std::int16_t value = sample_value(age);
        if(value < low) low = value;
        if(value > high) high = value;
    }
    if(high == low) ++high;
    for(std::size_t index = 0U; index < sample_count; ++index) {
        const std::size_t age = sample_count - 1U - index;
        const std::int16_t value = sample_value(age);
        points[index].x = sample_count == 1U ? 0 : static_cast<lv_coord_t>(
            (index * static_cast<std::size_t>(width - 1)) / (sample_count - 1U));
        points[index].y = static_cast<lv_coord_t>(
            (static_cast<std::int32_t>(high - value) * (height - 2)) / (high - low) + 1);
    }
    lv_obj_t *line = lv_line_create(parent);
    theme::reset(line);
    lv_line_set_points(line, points.data(), static_cast<std::uint32_t>(sample_count));
    lv_obj_set_pos(line, x, y);
    lv_obj_set_size(line, width, height);
    lv_obj_set_style_line_color(line, color, 0);
    lv_obj_set_style_line_width(line, 1, 0);
}
#endif

lv_obj_t * put_label(lv_obj_t * parent, const char * value, lv_coord_t x, lv_coord_t y,
                     lv_color_t color = theme::text(), const lv_font_t * font = &font_condensed_12)
{
    lv_obj_t * object = theme::label(parent, value, color, font);
    lv_obj_set_pos(object, x, y);
    return object;
}

lv_obj_t * put_clipped_label(lv_obj_t * parent, const char * value, lv_coord_t x,
                             lv_coord_t y, lv_coord_t width,
                             lv_color_t color = theme::text(),
                             const lv_font_t * font = &font_condensed_12)
{
    lv_obj_t * object = put_label(parent, value, x, y, color, font);
    lv_obj_set_width(object, width);
    lv_obj_set_height(object, font->line_height);
    lv_label_set_long_mode(object, LV_LABEL_LONG_CLIP);
    return object;
}

void add_status_bar(lv_obj_t * parent, const char * title, const char * left_value = "BAT 100%",
                    const char * middle_value = "GPS LOCK", const char * right_value = "18 pkt/min")
{
    lv_color_t middle_color = theme::text();
    lv_color_t right_color = theme::text();
#if defined(LILYSHARK_DEVICE)
    left_value = live_battery_label;
    if(app_settings.simulate_mode) {
        middle_value = "SIM MODE";
        middle_color = theme::amber();
    } else {
        middle_value = live_gps_label;
    }
    // The web analyzer is attached to this device right now; say so where the
    // user is already looking, not only in the event log.
    if(analyzer_link_active) {
        right_value = "USB LINKED";
        right_color = theme::cyan();
    } else {
        right_value = live_radio_label;
    }
#endif
    lv_obj_t * bar = theme::rect(parent, 0, 0, theme::screen_width, theme::status_height, theme::surface());
    theme::rule_line(bar, 0, theme::status_height - 1, theme::screen_width);

    lv_obj_t * title_label = theme::label(bar, title, theme::text(), &font_condensed_bold_16);
    lv_obj_align(title_label, LV_ALIGN_TOP_RIGHT, -7, 2);
    lv_obj_update_layout(title_label);
    const lv_coord_t title_width = lv_obj_get_width(title_label);
    const lv_coord_t title_left = theme::screen_width - 7 - title_width;

    put_label(bar, left_value, 8, 4, theme::text(), &font_mono_semibold_12);
    theme::rule_line(bar, 78, 3, 1, 15, theme::rule());
    put_label(bar, middle_value, 88, 4, middle_color, &font_mono_semibold_12);

    if(title_left >= 245) {
        theme::rule_line(bar, 164, 3, 1, 15, theme::rule());
        put_label(bar, right_value, 174, 4, right_color, &font_mono_semibold_12);
    }
}

lv_obj_t * put_centered_label(lv_obj_t * parent, const char * value, lv_coord_t y,
                              lv_color_t color = theme::text(),
                              const lv_font_t * font = &font_condensed_12)
{
    lv_obj_t * object = theme::label(parent, value, color, font);
    lv_obj_set_width(object, theme::screen_width);
    lv_obj_set_style_text_align(object, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_pos(object, 0, y);
    return object;
}

void add_shell_header(lv_obj_t * parent, const char * title, const char * step = nullptr)
{
    lv_obj_t * bar = theme::rect(parent, 0, 0, theme::screen_width, theme::status_height,
                                 theme::surface());
    theme::rule_line(bar, 0, theme::status_height - 1, theme::screen_width);
    put_label(bar, title, 7, 3, theme::text(), &font_condensed_bold_16);
    if(step != nullptr) {
        lv_obj_t * label = theme::label(bar, step, theme::pink(), &font_mono_semibold_12);
        lv_obj_align(label, LV_ALIGN_TOP_RIGHT, -7, 4);
    }
}

void add_action_strip(lv_obj_t * parent, const char * left, const char * right,
                      lv_color_t right_color = theme::cyan())
{
    theme::rect(parent, 0, 204, theme::screen_width, 36, theme::surface());
    theme::rule_line(parent, 0, 204, theme::screen_width);
    put_label(parent, left, 8, 216, theme::text_muted(), &font_mono_10);
    lv_obj_t * right_label = theme::label(parent, right, right_color, &font_mono_semibold_12);
    lv_obj_align(right_label, LV_ALIGN_BOTTOM_RIGHT, -8, -9);
}

void add_shell_list_row(lv_obj_t * parent, lv_coord_t y, lv_coord_t height,
                        const char * label, const char * value, bool selected,
                        lv_color_t value_color = theme::text_muted())
{
    if(selected) {
        theme::rect(parent, 0, y, theme::screen_width, height, theme::surface_selected());
        theme::rect(parent, 0, y, 3, height, theme::pink());
    }
    put_label(parent, label, 9, y + 8,
              selected ? theme::background() : theme::text(), &font_mono_semibold_12);
    if(value != nullptr && value[0] != '\0') {
        lv_obj_t * value_label = theme::label(parent, value,
            selected ? theme::background() : value_color, &font_mono_10);
        lv_obj_align_to(value_label, parent, LV_ALIGN_TOP_RIGHT, -8, y + 9);
    }
    theme::rule_line(parent, 6, y + height - 1, 308, 1, theme::grid());
}

lv_obj_t * add_wordmark(lv_obj_t * parent, lv_coord_t x, lv_coord_t y,
                        std::uint32_t scale = LV_SCALE_NONE)
{
    lv_obj_t * logo = lv_image_create(parent);
    lv_image_set_src(logo, &lilyshark_wordmark_a8);
    lv_obj_set_style_image_recolor(logo, theme::pink(), 0);
    lv_obj_set_style_image_recolor_opa(logo, LV_OPA_COVER, 0);
    if(scale != LV_SCALE_NONE) lv_image_set_scale(logo, scale);
    lv_obj_set_pos(logo, x, y);
    return logo;
}

lv_obj_t * add_scaled_wordmark(lv_obj_t * parent, lv_coord_t left, lv_coord_t top,
                               lv_coord_t visual_width)
{
    const std::uint32_t scale = static_cast<std::uint32_t>(visual_width) * LV_SCALE_NONE /
                                LILYSHARK_WORDMARK_A8_WIDTH;
    const lv_coord_t visual_height = static_cast<lv_coord_t>(
        (LILYSHARK_WORDMARK_A8_HEIGHT * scale) / LV_SCALE_NONE);
    const lv_coord_t object_x = left -
        (static_cast<lv_coord_t>(LILYSHARK_WORDMARK_A8_WIDTH) - visual_width) / 2;
    const lv_coord_t object_y = top -
        (static_cast<lv_coord_t>(LILYSHARK_WORDMARK_A8_HEIGHT) - visual_height) / 2;
    return add_wordmark(parent, object_x, object_y, scale);
}

void draw_pixel_line(lv_obj_t * parent, lv_coord_t x, lv_coord_t y, lv_coord_t width,
                     lv_coord_t height, uint8_t seed, lv_color_t color, bool bars = false)
{
    if(width < 2 || height < 2) return;

    if(trace_buffer_index >= trace_buffers.size()) return;
    auto & points = trace_buffers[trace_buffer_index++];
    const lv_coord_t step = width > 150 ? 2 : 3;
    size_t point_count = 0;
    for(lv_coord_t px = 0; px < width && point_count < points.size(); px += step) {
        const uint32_t hash = static_cast<uint32_t>((px + seed * 17) * 1103515245u + seed * 12345u);
        const lv_coord_t jitter = static_cast<lv_coord_t>((hash >> 27) % static_cast<uint32_t>(height - 2));
        points[point_count++] = {px, static_cast<lv_coord_t>(1 + jitter)};
    }

    lv_obj_t * line = lv_line_create(parent);
    theme::reset(line);
    lv_line_set_points(line, points.data(), static_cast<uint32_t>(point_count));
    lv_obj_set_pos(line, x, y);
    lv_obj_set_size(line, width, height);
    lv_obj_set_style_line_color(line, color, 0);
    lv_obj_set_style_line_width(line, bars ? 1 : 1, 0);
    lv_obj_set_style_line_rounded(line, false, 0);

    if(bars) {
        for(size_t index = 0; index < point_count; index += 4) {
            const lv_coord_t bar_x = x + static_cast<lv_coord_t>(points[index].x);
            const lv_coord_t bar_y = y + static_cast<lv_coord_t>(points[index].y);
            theme::rect(parent, bar_x, bar_y, 1, y + height - bar_y, color);
        }
    }
}

void add_grid(lv_obj_t * parent, lv_coord_t x, lv_coord_t y, lv_coord_t width, lv_coord_t height,
              lv_coord_t x_step, lv_coord_t y_step)
{
    for(lv_coord_t px = x; px <= x + width; px += x_step) theme::rule_line(parent, px, y, 1, height, theme::grid());
    for(lv_coord_t py = y; py <= y + height; py += y_step) theme::rule_line(parent, x, py, width, 1, theme::grid());
}

#if defined(LILYSHARK_DEVICE)
void format_node(char *output, std::size_t capacity, const DecodedPacket &packet,
                 DecodedField field) noexcept
{
    if(!packet.hasField(field)) {
        std::snprintf(output, capacity, "--");
        return;
    }
    const std::uint32_t value = field == FieldSource ? packet.source : packet.destination;
    if(value == 0xffffffffU) std::snprintf(output, capacity, "ALL");
    else std::snprintf(output, capacity, "%08lX", static_cast<unsigned long>(value));
}

void format_capture_time(char *output, std::size_t capacity, std::uint64_t timestamp_us) noexcept
{
    const std::uint64_t seconds = timestamp_us / 1000000ULL;
    const std::uint64_t tenths = (timestamp_us / 100000ULL) % 10ULL;
    std::snprintf(output, capacity, "%02llu:%02llu.%llu",
                  static_cast<unsigned long long>((seconds / 60ULL) % 100ULL),
                  static_cast<unsigned long long>(seconds % 60ULL),
                  static_cast<unsigned long long>(tenths));
}

struct LiveNodeSummary {
    ProtocolId protocol = ProtocolId::Unknown;
    std::uint32_t id = 0;
    std::uint64_t last_seen_us = 0;
    std::int32_t snr_sum_x10 = 0;
    std::int16_t latest_snr_x10 = 0;
    std::int16_t latest_rssi_x10 = 0;
    std::uint16_t frames = 0;
    std::uint16_t crc_errors = 0;
};

std::size_t collect_live_nodes(std::array<LiveNodeSummary, 8> &summaries) noexcept
{
    std::size_t count = 0;
    const auto &store = capture_runtime.frames();

    // Preserve the newest-node policy while allowing the selected identities
    // to be replayed chronologically below. CRC-invalid records never create
    // an identity.
    for(std::size_t offset = 0; offset < store.size(); ++offset) {
        const FrameRecord *record = store.newest(offset);
        if(record == nullptr || !contributesToNodeSummary(*record)) continue;

        std::size_t index = 0;
        for(; index < count; ++index) {
            if(summaries[index].protocol == record->decoded.protocol &&
               summaries[index].id == record->decoded.source) break;
        }
        if(index == count) {
            if(count == summaries.size()) continue;
            summaries[index].protocol = record->decoded.protocol;
            summaries[index].id = record->decoded.source;
            ++count;
        }
    }

    for(std::size_t offset = 0; offset < store.size(); ++offset) {
        const FrameRecord *record = store.at(offset);
        if(record == nullptr) continue;

        std::size_t index = 0;
        for(; index < count; ++index) {
            if(summaries[index].protocol == record->decoded.protocol &&
               summaries[index].id == record->decoded.source) break;
        }
        if(index == count) continue;

        LiveNodeSummary &summary = summaries[index];
        if(contributesToNodeSummary(*record)) {
            summary.last_seen_us = record->raw.rf.timestamp_us;
            summary.latest_snr_x10 = record->raw.rf.snr_db_x10;
            summary.latest_rssi_x10 = record->raw.rf.rssi_dbm_x10;
            summary.snr_sum_x10 += record->raw.rf.snr_db_x10;
            if(summary.frames != UINT16_MAX) ++summary.frames;
        } else if(contributesToExistingNodeCrcErrors(*record, summary.frames != 0U,
                                                     summary.protocol, summary.id)) {
            summary.crc_errors = incrementedNodeCrcErrorCount(summary.crc_errors);
        }
    }
    return count;
}

const FrameRecord *find_live_frame(std::uint64_t sequence,
                                   std::size_t *offset_from_newest = nullptr) noexcept
{
    const auto &store = capture_runtime.frames();
    for(std::size_t offset = 0; offset < store.size(); ++offset) {
        const FrameRecord *record = store.newest(offset);
        if(record != nullptr && record->sequence == sequence) {
            if(offset_from_newest != nullptr) *offset_from_newest = offset;
            return record;
        }
    }
    return nullptr;
}

std::size_t resolve_traffic_selection() noexcept
{
    const auto &store = capture_runtime.frames();
    const TrafficFilterSnapshot filtered = trafficFilterSnapshot(store, traffic_filter);
    if(filtered.matching_frames == 0U) {
        traffic_selected_sequence = 0;
        return 0;
    }

    if(traffic_selected_sequence != 0U) {
        for(std::size_t offset = 0U; offset < filtered.matching_frames; ++offset) {
            const FrameRecord *candidate = newestMatchingFrame(store, traffic_filter, offset);
            if(candidate != nullptr && candidate->sequence == traffic_selected_sequence) {
                return offset;
            }
        }
    }

    const std::size_t selected_offset = traffic_selected_sequence == 0U
        ? 0U : filtered.matching_frames - 1U;
    const FrameRecord *fallback = newestMatchingFrame(store, traffic_filter, selected_offset);
    traffic_selected_sequence = fallback == nullptr ? 0 : fallback->sequence;
    return selected_offset;
}

bool move_traffic_selection(int direction) noexcept
{
    const auto &store = capture_runtime.frames();
    const TrafficFilterSnapshot filtered = trafficFilterSnapshot(store, traffic_filter);
    if(filtered.matching_frames == 0U) return false;

    std::size_t selected_offset = resolve_traffic_selection();
    if(direction > 0) {
        selected_offset = (selected_offset + 1U) % filtered.matching_frames;
    } else if(direction < 0) {
        selected_offset = selected_offset == 0U ? filtered.matching_frames - 1U
                                                 : selected_offset - 1U;
    } else {
        return false;
    }
    const FrameRecord *selected = newestMatchingFrame(store, traffic_filter, selected_offset);
    if(selected == nullptr) return false;
    traffic_selected_sequence = selected->sequence;
    return true;
}

bool live_node_matches(const LiveNodeSummary &node, ProtocolId protocol,
                       std::uint32_t id) noexcept
{
    return node.protocol == protocol && node.id == id;
}

std::size_t resolve_node_selection(const std::array<LiveNodeSummary, 8> &live_nodes,
                                   std::size_t count) noexcept
{
    if(count == 0) {
        node_selection_valid = false;
        return 0;
    }
    if(node_selection_valid) {
        for(std::size_t index = 0; index < count; ++index) {
            if(live_node_matches(live_nodes[index], node_selected_protocol, node_selected_id)) {
                return index;
            }
        }
    }
    node_selected_protocol = live_nodes[0].protocol;
    node_selected_id = live_nodes[0].id;
    node_selection_valid = true;
    return 0;
}

bool move_node_selection(int direction) noexcept
{
    std::array<LiveNodeSummary, 8> live_nodes{};
    const std::size_t count = collect_live_nodes(live_nodes);
    if(count == 0) return false;

    std::size_t selected_index = resolve_node_selection(live_nodes, count);
    if(direction > 0) {
        selected_index = (selected_index + 1) % count;
    } else if(direction < 0) {
        selected_index = selected_index == 0 ? count - 1 : selected_index - 1;
    } else {
        return false;
    }
    node_selected_protocol = live_nodes[selected_index].protocol;
    node_selected_id = live_nodes[selected_index].id;
    node_selection_valid = true;
    return true;
}

bool select_current_frame_for_detail() noexcept
{
    const auto &store = capture_runtime.frames();
    if(store.empty()) return false;
    const FrameRecord *record = newestMatchingFrame(
        store, traffic_filter, resolve_traffic_selection());
    if(record == nullptr) return false;
    packet_detail_sequence = record->sequence;
    packet_detail_byte_offset = 0U;
    return true;
}

bool select_current_node_for_detail() noexcept
{
    std::array<LiveNodeSummary, 8> live_nodes{};
    const std::size_t count = collect_live_nodes(live_nodes);
    if(count == 0) return false;
    const LiveNodeSummary &node = live_nodes[resolve_node_selection(live_nodes, count)];
    node_detail_protocol = node.protocol;
    node_detail_id = node.id;
    node_detail_selection_valid = true;
    return true;
}

void format_age(char *output, std::size_t capacity, std::uint64_t timestamp_us) noexcept
{
    const std::uint64_t now_us = static_cast<std::uint64_t>(esp_timer_get_time());
    const std::uint64_t age_seconds = now_us > timestamp_us ? (now_us - timestamp_us) / 1000000ULL : 0;
    if(age_seconds < 60) {
        std::snprintf(output, capacity, "%llus", static_cast<unsigned long long>(age_seconds));
    } else if(age_seconds < 3600) {
        std::snprintf(output, capacity, "%llum", static_cast<unsigned long long>(age_seconds / 60ULL));
    } else {
        std::snprintf(output, capacity, "%lluh", static_cast<unsigned long long>(age_seconds / 3600ULL));
    }
}

void draw_live_node_history(lv_obj_t *parent, const LiveNodeSummary &node, lv_coord_t x,
                            lv_coord_t y, lv_coord_t width, lv_coord_t height,
                            bool use_rssi = false,
                            lv_color_t color = theme::lime()) noexcept
{
    if(trace_buffer_index >= trace_buffers.size()) return;
    auto &points = trace_buffers[trace_buffer_index++];
    std::array<std::int16_t, 64> samples{};
    std::size_t sample_count = 0;
    const auto &store = capture_runtime.frames();
    for(std::size_t index = 0; index < store.size() && sample_count < samples.size(); ++index) {
        const FrameRecord *record = store.at(index);
        if(record != nullptr && record->decoded.hasField(FieldSource) &&
           record->decoded.protocol == node.protocol && record->decoded.source == node.id) {
            samples[sample_count++] = use_rssi ? record->raw.rf.rssi_dbm_x10 : record->raw.rf.snr_db_x10;
        }
    }
    if(sample_count == 0) return;

    std::int16_t low = samples[0];
    std::int16_t high = samples[0];
    for(std::size_t index = 1; index < sample_count; ++index) {
        if(samples[index] < low) low = samples[index];
        if(samples[index] > high) high = samples[index];
    }
    if(high == low) ++high;
    for(std::size_t index = 0; index < sample_count; ++index) {
        points[index].x = sample_count == 1 ? 0 :
            static_cast<lv_coord_t>((index * static_cast<std::size_t>(width - 1)) / (sample_count - 1));
        points[index].y = static_cast<lv_coord_t>((static_cast<std::int32_t>(high - samples[index]) *
                                                  (height - 2)) / (high - low) + 1);
    }
    lv_obj_t *line = lv_line_create(parent);
    theme::reset(line);
    lv_line_set_points(line, points.data(), static_cast<std::uint32_t>(sample_count));
    lv_obj_set_pos(line, x, y);
    lv_obj_set_size(line, width, height);
    lv_obj_set_style_line_color(line, color, 0);
    lv_obj_set_style_line_width(line, 1, 0);
}

#endif

const char *spectrum_scan_mode_label() noexcept
{
    return spectrum_scan_mode == SpectrumScanMode::FastNarrow ? "FAST NARROW" : "DEEP BAND";
}

SpectrumSweepRequest spectrum_request_for_profile(const RadioProfile &profile,
                                                   SpectrumScanMode mode) noexcept
{
    SpectrumSweepRequest request{};
    if(mode == SpectrumScanMode::FastNarrow) {
        request.samples_per_frequency = 64U;
        std::uint32_t step_hz = profile.bandwidth_hz / 4U;
        if(step_hz < 25000U) step_hz = 25000U;
        const std::uint32_t radius_hz = step_hz * 5U;
        request.start_frequency_hz = profile.center_frequency_hz > radius_hz
            ? profile.center_frequency_hz - radius_hz : profile.center_frequency_hz;
        request.end_frequency_hz = profile.center_frequency_hz + radius_hz;
        if(request.end_frequency_hz > 960000000U) request.end_frequency_hz = 960000000U;
        request.step_hz = step_hz;
        return request;
    }
    request.samples_per_frequency = 512;
    if(profile.center_frequency_hz >= 902000000U && profile.center_frequency_hz <= 928000000U) {
        request.start_frequency_hz = 902000000U;
        request.end_frequency_hz = 928000000U;
        request.step_hz = 200000U;
    } else if(profile.center_frequency_hz >= 863000000U && profile.center_frequency_hz <= 870000000U) {
        request.start_frequency_hz = 863000000U;
        request.end_frequency_hz = 870000000U;
        request.step_hz = 100000U;
    } else {
        constexpr std::uint32_t radius_hz = 3000000U;
        request.start_frequency_hz = profile.center_frequency_hz > radius_hz
            ? profile.center_frequency_hz - radius_hz : profile.center_frequency_hz;
        request.end_frequency_hz = profile.center_frequency_hz < 957000000U
            ? profile.center_frequency_hz + radius_hz : 960000000U;
        request.step_hz = 100000U;
    }
    return request;
}

std::uint16_t spectrum_request_point_count(const SpectrumSweepRequest &request) noexcept
{
    if(request.step_hz == 0U || request.end_frequency_hz < request.start_frequency_hz) return 0U;
    const std::uint32_t points =
        ((request.end_frequency_hz - request.start_frequency_hz) / request.step_hz) + 1U;
    return static_cast<std::uint16_t>(points > 160U ? 160U : points);
}

#if !defined(LILYSHARK_DEVICE)
SpectrumSweepRequest simulator_spectrum_request() noexcept
{
    const std::size_t count = builtinProfileCount();
    if(count == 0U) return SpectrumSweepRequest{};
    const RadioProfile &profile = builtinProfiles()[simulator_active_profile_index % count];
    return spectrum_request_for_profile(profile, spectrum_scan_mode);
}

std::uint16_t simulator_spectrum_total_points() noexcept
{
    return spectrum_request_point_count(simulator_spectrum_request());
}

std::uint32_t simulator_spectrum_duration_ms() noexcept
{
    return static_cast<std::uint32_t>(simulator_spectrum_total_points()) * 50U;
}

std::uint32_t simulator_spectrum_metric_frequency_hz(
    const SpectrumSweepRequest &request, std::uint32_t telemetry_frequency_khz) noexcept
{
    // LiveTelemetry supplies a deterministic activity pattern over its canonical
    // 902-928 MHz canvas. Reproject that relative position into the request the
    // selected radio profile actually scans so EU and custom profiles never show
    // fabricated US-band frequencies.
    constexpr std::uint32_t source_start_khz = 902000U;
    constexpr std::uint32_t source_span_khz = 26000U;
    const std::uint32_t bounded_khz = telemetry_frequency_khz < source_start_khz
        ? source_start_khz
        : (telemetry_frequency_khz > source_start_khz + source_span_khz
               ? source_start_khz + source_span_khz : telemetry_frequency_khz);
    const std::uint64_t request_span = request.end_frequency_hz >= request.start_frequency_hz
        ? static_cast<std::uint64_t>(request.end_frequency_hz - request.start_frequency_hz) : 0U;
    return request.start_frequency_hz + static_cast<std::uint32_t>(
        (request_span * (bounded_khz - source_start_khz)) / source_span_khz);
}
#endif

#if defined(LILYSHARK_DEVICE)
const char *spectrum_failure_label(SpectrumSweepFailure failure) noexcept
{
    switch(failure) {
        case SpectrumSweepFailure::InvalidRequest: return "INVALID REQUEST";
        case SpectrumSweepFailure::RadioUnavailable: return "RADIO UNAVAILABLE";
        case SpectrumSweepFailure::StandbyFailed: return "STANDBY";
        case SpectrumSweepFailure::FskInitializationFailed: return "FSK INIT";
        case SpectrumSweepFailure::PatchUploadFailed: return "PATCH UPLOAD";
        case SpectrumSweepFailure::ScanConfigurationFailed: return "SCAN CONFIG";
        case SpectrumSweepFailure::FrequencySetFailed: return "FREQUENCY";
        case SpectrumSweepFailure::ScanStartFailed: return "SCAN START";
        case SpectrumSweepFailure::ScanReadFailed: return "SCAN READ";
        case SpectrumSweepFailure::Timeout: return "TIMEOUT";
        case SpectrumSweepFailure::Cancelled: return "CANCELLED";
        case SpectrumSweepFailure::RestoreFailed: return "RX RESTORE";
        case SpectrumSweepFailure::None: default: return "UNKNOWN";
    }
}
#endif

void build_protocols(lv_obj_t *parent);
void build_timeline(lv_obj_t *parent);
#if !defined(LILYSHARK_DEVICE)
void advance_simulator_live_data(std::uint32_t elapsed_ms) noexcept;
void reset_simulator_demo() noexcept;
#endif

void build_traffic(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    add_status_bar(parent, traffic_filter.active() ? "TRAFFIC *" : "TRAFFIC");
    constexpr lv_coord_t first_y = 28;
    constexpr lv_coord_t row_height = 14;
    const auto &store = capture_runtime.frames();

    if(store.empty()) {
        put_label(parent, app_settings.simulate_mode ? "GENERATING SYNTHETIC FRAMES" :
                                                       "LISTENING FOR FRAMES",
                  8, 48, app_settings.simulate_mode ? theme::amber() : theme::lime(),
                  &font_condensed_bold_16);
        const RadioProfile &profile = radio_service.activeProfile();
        char line[64]{};
        std::snprintf(line, sizeof(line), "%s", profile.name);
        put_label(parent, line, 8, 78, theme::cyan(), &font_mono_semibold_12);
        std::snprintf(line, sizeof(line), "%.3f MHz  BW %.1f kHz",
                      static_cast<double>(profile.center_frequency_hz) / 1000000.0,
                      static_cast<double>(profile.bandwidth_hz) / 1000.0);
        put_label(parent, line, 8, 98, theme::text(), &font_mono_10);
        std::snprintf(line, sizeof(line), "SF%u  CR 4/%u  SYNC 0x%04X",
                      profile.spreading_factor, profile.coding_rate_denominator, profile.sync_word);
        put_label(parent, line, 8, 114, theme::text(), &font_mono_10);
        put_label(parent, "P PRESET   -/+ FREQUENCY", 8, 188, theme::text_muted(), &font_mono_10);
        put_label(parent, "B BANDWIDTH   F SF   C CR", 8, 204, theme::text_muted(), &font_mono_10);
        return;
    }

    const TrafficFilterSnapshot filtered = trafficFilterSnapshot(store, traffic_filter);
    if(filtered.matching_frames == 0U) {
        put_centered_label(parent, "NO FRAMES MATCH THIS FILTER", 82,
                           theme::amber(), &font_condensed_bold_16);
        char summary[64]{};
        (void)formatTrafficFilterSummary(summary, sizeof(summary), traffic_filter);
        put_centered_label(parent, summary, 108, theme::text_muted(), &font_mono_10);
        put_centered_label(parent, "X  CHANGE FILTER", 204, theme::cyan(), &font_mono_10);
        return;
    }
    const std::size_t selected_offset = resolve_traffic_selection();
    const std::size_t maximum_visible = filtered.matching_frames < 15U
        ? filtered.matching_frames : 15U;
    const std::size_t first_offset = selected_offset < maximum_visible
        ? 0 : selected_offset - maximum_visible + 1;
    const std::size_t visible = (filtered.matching_frames - first_offset) < maximum_visible
        ? filtered.matching_frames - first_offset : maximum_visible;
    for(std::size_t index = 0; index < visible; ++index) {
        const std::size_t offset = first_offset + index;
        const FrameRecord *record = newestMatchingFrame(store, traffic_filter, offset);
        if(record == nullptr) continue;
        const lv_coord_t y = first_y + static_cast<lv_coord_t>(index) * row_height;
        const bool selected = offset == selected_offset;
        if(selected) theme::rect(parent, 4, y - 1, 312, row_height, theme::focus());

        const bool malformed = record->decoded.state == DecodeState::Malformed;
        const lv_color_t row_color = selected ? theme::text() :
            ((record->raw.rf.crc == CrcStatus::Invalid || malformed)
                 ? theme::fault() : theme::lime());
        char time[12]{};
        char source[12]{};
        char destination[12]{};
        char hops[5]{};
        char snr[10]{};
        format_capture_time(time, sizeof(time), record->raw.rf.timestamp_us);
        format_node(source, sizeof(source), record->decoded, FieldSource);
        format_node(destination, sizeof(destination), record->decoded, FieldDestination);
        if(record->decoded.hasField(FieldHopStart) && record->decoded.hasField(FieldHopLimit) &&
           record->decoded.hop_start >= record->decoded.hop_limit) {
            std::snprintf(hops, sizeof(hops), "%u", record->decoded.hop_start - record->decoded.hop_limit);
        } else {
            std::snprintf(hops, sizeof(hops), "-");
        }
        std::snprintf(snr, sizeof(snr), "%+.1f", static_cast<double>(record->raw.rf.snr_db_x10) / 10.0);

        put_label(parent, time, 5, y, row_color, &font_mono_10);
        if(record->raw.rf.origin == FrameOrigin::Synthetic) {
            put_label(parent, "S", 50, y,
                      selected ? theme::text() : theme::pink(), &font_mono_10);
        }
        put_label(parent, source, 59, y, row_color, &font_mono_10);
        put_label(parent, ">", 122, y, row_color, &font_mono_10);
        put_label(parent, destination, 133, y, row_color, &font_mono_10);
        put_label(parent, packetKindLabel(record->decoded), 198, y, row_color, &font_mono_10);
        put_label(parent, hops, 250, y, row_color, &font_mono_10);
        put_label(parent, snr, 274, y, row_color, &font_mono_10);
    }
#else
    add_simulator_live_status_bar(parent, traffic_filter.active() ? "TRAFFIC *" : "TRAFFIC");
    constexpr lv_coord_t first_y = 28;
    constexpr lv_coord_t row_height = 14;
    const std::size_t matching_count = simulator_matching_sample_count();
    if(matching_count == 0U) {
        put_label(parent, traffic_filter.active() ? "NO SIMULATED FRAMES MATCH" :
                                                   "WAITING FOR SIMULATED FRAMES", 52, 92,
                  theme::text_muted(), &font_mono_10);
        if(traffic_filter.active()) {
            put_centered_label(parent, "X  CHANGE FILTER", 204, theme::cyan(), &font_mono_10);
        }
        return;
    }
    const std::size_t selected_offset = resolve_simulator_traffic_selection();
    const std::size_t maximum_visible = matching_count < 15U ? matching_count : 15U;
    const std::size_t first_offset = selected_offset < maximum_visible
        ? 0U : selected_offset - maximum_visible + 1U;
    const std::size_t visible = (matching_count - first_offset) < maximum_visible
        ? matching_count - first_offset : maximum_visible;
    for(std::size_t index = 0U; index < visible; ++index) {
        const std::size_t offset = first_offset + index;
        const simulator::TrafficSample *sample = simulator_matching_sample(offset);
        if(sample == nullptr) continue;
        const lv_coord_t y = first_y + static_cast<lv_coord_t>(index) * row_height;
        const bool selected = offset == selected_offset;
        if(selected) theme::rect(parent, 4, y - 1, 312, row_height, theme::focus());

        const bool malformed =
            sample->decode_outcome == simulator::SimulatedDecodeOutcome::Malformed;
        const lv_color_t row_color = selected ? theme::text() :
            ((!sample->crc_valid || malformed) ? theme::fault() :
             (sample->protocol == simulator::SimulatedProtocol::Unknown
                  ? theme::text_muted() : theme::lime()));
        char time[12]{};
        char source[12]{};
        char destination[12]{};
        char hops[5]{};
        char snr[10]{};
        const bool has_decoded_route =
            sample->source_node != simulator::kNoNode &&
            sample->decode_outcome != simulator::SimulatedDecodeOutcome::Raw &&
            sample->decode_outcome != simulator::SimulatedDecodeOutcome::Malformed;
        format_simulator_clock(time, sizeof(time), sample->timestamp_seconds_of_day);
        format_simulator_node_id(source, sizeof(source), sample->source_node, false);
        format_simulator_node_id(destination, sizeof(destination), sample->destination_node,
                                 has_decoded_route);
        if(has_decoded_route) {
            std::snprintf(hops, sizeof(hops), "%u", static_cast<unsigned>(sample->hops));
        } else {
            std::snprintf(hops, sizeof(hops), "-");
        }
        std::snprintf(snr, sizeof(snr), "%+.1f",
                      static_cast<double>(sample->snr_db_x10) / 10.0);
        put_label(parent, time, 7, y, row_color, &font_mono_10);
        put_clipped_label(parent, has_decoded_route ? source : "--", 60, y, 68,
                          row_color, &font_mono_10);
        put_label(parent, ">", 132, y, row_color, &font_mono_10);
        put_clipped_label(parent, has_decoded_route ? destination : "--", 143, y, 58,
                          row_color, &font_mono_10);
        const char *kind = simulator_packet_kind_label(*sample);
        put_label(parent, kind, 205, y, row_color, &font_mono_10);
        put_label(parent, hops, 255, y, row_color, &font_mono_10);
        put_label(parent, snr, 278, y, row_color, &font_mono_10);
    }
#endif
}

void build_traffic_filter(lv_obj_t *parent)
{
#if defined(LILYSHARK_DEVICE)
    add_status_bar(parent, "TRAFFIC FILTER");
    const TrafficFilterSnapshot snapshot = trafficFilterSnapshot(
        capture_runtime.frames(), traffic_filter);
    const std::size_t retained = snapshot.retained_frames;
    const std::size_t matching = snapshot.matching_frames;
#else
    add_simulator_live_status_bar(parent, "TRAFFIC FILTER");
    const std::size_t retained = simulator_live_telemetry.traffic().size;
    const std::size_t matching = simulator_matching_sample_count();
#endif
    char line[64]{};
    std::snprintf(line, sizeof(line), "%u OF %u RETAINED FRAMES MATCH",
                  static_cast<unsigned>(matching), static_cast<unsigned>(retained));
    put_label(parent, line, 8, 29, matching == 0U ? theme::amber() : theme::lime(),
              &font_mono_semibold_12);
    put_label(parent, "Filter the bounded inspection list. Capture files stay complete.",
              8, 47, theme::text_muted(), &font_mono_10);

    struct FilterRow { const char *label; const char *value; };
    const std::array<FilterRow, 3> rows = {{
        {"PROTOCOL", trafficProtocolPredicateLabel(traffic_filter.protocol)},
        {"DECODE", trafficDecodePredicateLabel(traffic_filter.decode)},
        {"CRC", trafficCrcPredicateLabel(traffic_filter.crc)},
    }};
    for(std::size_t index = 0U; index < rows.size(); ++index) {
        add_shell_list_row(parent, 73 + static_cast<lv_coord_t>(index) * 38, 38,
                           rows[index].label, rows[index].value,
                           traffic_filter_selection == index, theme::cyan());
    }
    put_label(parent, traffic_filter.active() ? "FILTER ACTIVE" : "SHOWING ALL FRAMES",
              8, 194, traffic_filter.active() ? theme::pink() : theme::text_muted(),
              &font_mono_semibold_12);
    add_action_strip(parent, "BACK  KEEP", "LEFT/RIGHT  CHANGE   ENTER APPLY");
}

void build_nodes(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, "NODES");
    put_label(parent, "SOURCE", 8, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "PROTO", 88, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "LAST", 146, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "SNR", 192, 27, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 6, 43, 308);

    std::array<LiveNodeSummary, 8> live_nodes{};
    const std::size_t count = collect_live_nodes(live_nodes);
    if(count == 0) {
        put_label(parent, "NO NODE IDENTITIES YET", 58, 84, theme::text_muted(), &font_condensed_bold_16);
        put_label(parent, "Raw frames still appear in TRAFFIC", 62, 108, theme::text_muted(), &font_mono_10);
        return;
    }

    const std::size_t selected_index = resolve_node_selection(live_nodes, count);
    for(std::size_t index = 0; index < count; ++index) {
        const lv_coord_t y = 48 + static_cast<lv_coord_t>(index) * 22;
        const bool selected = index == selected_index;
        if(selected) theme::rect(parent, 4, y - 2, 312, 20, theme::surface_selected());
        const lv_color_t value_color = selected ? theme::background() : theme::text();
        char id[12]{};
        char age[10]{};
        char snr[10]{};
        std::snprintf(id, sizeof(id), "%08lX", static_cast<unsigned long>(live_nodes[index].id));
        format_age(age, sizeof(age), live_nodes[index].last_seen_us);
        std::snprintf(snr, sizeof(snr), "%+.1f",
                      static_cast<double>(live_nodes[index].latest_snr_x10) / 10.0);
        put_label(parent, id, 8, y, value_color, &font_mono_10);
        put_label(parent, protocolName(live_nodes[index].protocol), 88, y,
                  selected ? theme::background() : theme::cyan(), &font_mono_10);
        put_label(parent, age, 146, y,
                  selected ? theme::background() : theme::text_muted(), &font_mono_10);
        put_label(parent, snr, 190, y,
                  selected ? theme::background() : theme::lime(), &font_mono_10);
        draw_live_node_history(parent, live_nodes[index], 240, y, 70, 14, false,
                               selected ? theme::background() : theme::lime());
        theme::rule_line(parent, 6, y + 18, 308, 1, theme::grid());
    }
    return;
    }
#else
    add_simulator_live_status_bar(parent, "NODES");
    put_label(parent, "SOURCE", 8, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "PROTO", 88, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "LAST", 146, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "SNR", 192, 27, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 6, 43, 308);

    const std::size_t count = simulator_established_node_count();
    if(count == 0U) {
        put_label(parent, "NO NODE IDENTITIES YET", 58, 84,
                  theme::text_muted(), &font_condensed_bold_16);
        put_label(parent, "Raw frames still appear in TRAFFIC", 62, 108,
                  theme::text_muted(), &font_mono_10);
        return;
    }
    const std::size_t selected_index = resolve_simulator_node_selection();
    for(std::size_t index = 0U; index < count; ++index) {
        const simulator::NodeSnapshot *node_pointer = simulator_established_node(index);
        if(node_pointer == nullptr) continue;
        const simulator::NodeSnapshot &node = *node_pointer;
        const lv_coord_t y = 48 + static_cast<lv_coord_t>(index) * 22;
        const bool selected = index == selected_index;
        if(selected) theme::rect(parent, 4, y - 2, 312, 20, theme::surface_selected());
        const lv_color_t value_color = selected ? theme::background() : theme::text();
        char id[12]{};
        char age[10]{};
        char snr[10]{};
        std::snprintf(id, sizeof(id), "%08lX", static_cast<unsigned long>(node.id));
        format_simulator_age(age, sizeof(age), node.last_seen_seconds);
        std::snprintf(snr, sizeof(snr), "%+.1f",
                      static_cast<double>(node.latest_snr_db_x10) / 10.0);
        put_label(parent, id, 8, y, value_color, &font_mono_10);
        put_label(parent, simulator_protocol_label(node.protocol), 88, y,
                  selected ? theme::background() : theme::cyan(), &font_mono_10);
        put_label(parent, age, 146, y,
                  selected ? theme::background() : theme::text_muted(), &font_mono_10);
        put_label(parent, snr, 190, y,
                  selected ? theme::background() : theme::lime(), &font_mono_10);
        draw_simulator_node_history(parent, node, 240, y, 70, 14,
                                    selected ? theme::background() :
                                    (node.active ? theme::lime() : theme::text_muted()));
        theme::rule_line(parent, 6, y + 18, 308, 1, theme::grid());
    }
#endif
}

void build_spectrum(lv_obj_t * parent)
{
    char spectrum_title[32]{};
    std::snprintf(spectrum_title, sizeof(spectrum_title), "SPECTRUM / %s",
                  spectrum_scan_mode_label());
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, spectrum_title);
    if(app_settings.simulate_mode) {
        put_centered_label(parent, "LIVE RF SPECTRUM PAUSED", 68,
                           theme::amber(), &font_condensed_bold_16);
        put_centered_label(parent, "Simulate mode generates packet traffic only.", 101,
                           theme::text(), &font_mono_10);
        put_centered_label(parent, "Turn it off for an SX1262 spectral sweep.", 119,
                           theme::text_muted(), &font_mono_10);
        theme::rule_line(parent, 0, 198, 320);
        put_centered_label(parent, "SIMULATED / NOT AN RF MEASUREMENT", 207,
                           theme::amber(), &font_mono_semibold_12);
        return;
    }
    const SpectrumSweepStatus &status = radio_service.spectrumStatus();
    const SpectrumSweepResult &result = radio_service.spectrumResult();
    const SpectrumSweepRequest planned_request = spectrum_request_for_profile(
        radio_service.activeProfile(), spectrum_scan_mode);
    constexpr lv_coord_t x = 7;
    constexpr lv_coord_t y = 30;
    constexpr lv_coord_t width = 306;
    constexpr lv_coord_t height = 145;

    if(spectrum_buffer == nullptr) {
        put_label(parent, "SPECTRUM BUFFER UNAVAILABLE", 39, 82,
                  theme::fault(), &font_condensed_bold_16);
        put_label(parent, "Packet capture remains available", 69, 108,
                  theme::text_muted(), &font_mono_10);
        return;
    }

    if(status.state == SpectrumSweepState::Idle && result.point_count == 0) {
        char title[48]{};
        std::snprintf(title, sizeof(title), "%s SPECTRAL SWEEP", spectrum_scan_mode_label());
        put_centered_label(parent, title, 58, theme::text(), &font_condensed_bold_16);
        char plan[72]{};
        std::snprintf(plan, sizeof(plan), "%.1f - %.1f MHz  /  %lu kHz steps",
                      static_cast<double>(planned_request.start_frequency_hz) / 1000000.0,
                      static_cast<double>(planned_request.end_frequency_hz) / 1000000.0,
                      static_cast<unsigned long>(planned_request.step_hz / 1000U));
        put_label(parent, plan, 36, 88, theme::cyan(), &font_mono_10);
        put_label(parent, "Packet receive pauses while the SX1262 scans", 28, 113,
                  theme::amber(), &font_mono_10);
        put_label(parent, "The radio profile is restored before RX resumes", 25, 130,
                  theme::text_muted(), &font_mono_10);
        theme::rule_line(parent, 0, 198, 320);
        const char *action = survey_running ? "SURVEY ACTIVE - SCAN UNAVAILABLE" :
                                             "UP/DOWN MODE    ENTER START";
        put_centered_label(parent, action, 207,
                           survey_running ? theme::amber() : theme::cyan(),
                           &font_mono_semibold_12);
        return;
    }

    lv_obj_t *canvas = lv_canvas_create(parent);
    theme::reset(canvas);
    lv_canvas_set_buffer(canvas, spectrum_buffer, width, height, LV_COLOR_FORMAT_RGB565);
    lv_canvas_fill_bg(canvas, theme::heat_deep(), LV_OPA_COVER);
    lv_obj_set_pos(canvas, x, y);

    std::uint16_t maximum_count = 1;
    for(std::size_t point = 0; point < result.point_count; ++point) {
        for(std::size_t bin = 0; bin < kSpectrumPowerBinCount; ++bin) {
            if(result.points[point].counts[bin] > maximum_count) {
                maximum_count = result.points[point].counts[bin];
            }
        }
    }
    const std::uint16_t planned_point_count = status.points_total != 0U
        ? status.points_total : spectrum_request_point_count(planned_request);
    if(result.point_count > 0 && planned_point_count > 0U) {
        for(lv_coord_t px = 0; px < width; ++px) {
            const std::size_t point = static_cast<std::size_t>(px) * planned_point_count /
                                static_cast<std::size_t>(width);
            // A cancelled/in-progress scan is a partial result. Keep every
            // unvisited frequency column blank instead of stretching the points
            // collected so far across the full requested range.
            if(point >= result.point_count) continue;
            for(lv_coord_t py = 0; py < height; ++py) {
                std::size_t bin = static_cast<std::size_t>(py) * kSpectrumPowerBinCount /
                                  static_cast<std::size_t>(height);
                if(bin >= kSpectrumPowerBinCount) bin = kSpectrumPowerBinCount - 1;
                const std::uint16_t count = result.points[point].counts[bin];
                // Preserve the scan's full histogram instead of making rare
                // power buckets disappear behind the dominant noise-floor
                // bucket. Every observed bucket gets a cold pixel; repeated
                // samples then increase intensity linearly.
                const std::uint32_t scaled = count == 0 ? 0U :
                    20U + (static_cast<std::uint32_t>(count) * 235U) / maximum_count;
                lv_color_t color = theme::heat_deep();
                if(scaled > 210U) color = theme::heat_peak();
                else if(scaled > 160U) color = theme::heat_hot();
                else if(scaled > 110U) color = theme::heat_bright();
                else if(scaled > 62U) color = theme::heat_mid();
                else if(scaled > 12U) color = theme::heat_cold();
                lv_canvas_set_px(canvas, px, py, color, LV_OPA_COVER);
            }
        }
    }
    lv_obj_invalidate(canvas);
    add_grid(parent, x, y, width, height, 47, 29);
    theme::rule_line(parent, x, y, width);
    theme::rule_line(parent, x, y + height, width);
    put_label(parent, "-11", x + 3, y + 2, theme::text_muted(), &font_mono_10);
    put_label(parent, "-139", x + 3, y + height - 13, theme::text_muted(), &font_mono_10);

    char line[72]{};
    if(status.active()) {
        const std::uint32_t percent = status.points_total == 0 ? 0 :
            (static_cast<std::uint32_t>(status.points_completed) * 100U) / status.points_total;
        std::snprintf(line, sizeof(line), "SCANNING %u/%u  %lu%%  %.3f MHz",
                      status.points_completed, status.points_total,
                      static_cast<unsigned long>(percent),
                      static_cast<double>(status.current_frequency_hz) / 1000000.0);
        put_label(parent, line, 10, 182, theme::amber(), &font_mono_semibold_12);
        put_label(parent, "RX PAUSED - ENTER CANCEL", 82, 204, theme::text_muted(), &font_mono_10);
    } else if(status.state == SpectrumSweepState::Failed) {
        const std::int16_t error = status.failure == SpectrumSweepFailure::RestoreFailed
            ? status.restore_error : status.radio_error;
        const bool receive_recovered = status.failure == SpectrumSweepFailure::RestoreFailed &&
                                       radio_service.status().receiving;
        std::snprintf(line, sizeof(line), "FAIL %s  RADIO %d  RX %s",
                      spectrum_failure_label(status.failure), error,
                      status.restoration_succeeded ? "OK" :
                      (receive_recovered ? "RECOVERED" : "FAILED"));
        put_label(parent, line, 10, 182, theme::fault(), &font_mono_10);
        put_label(parent, "ENTER RETRY", 117, 204, theme::cyan(), &font_mono_semibold_12);
    } else if(status.state == SpectrumSweepState::Cancelled) {
        std::snprintf(line, sizeof(line), "SCAN CANCELLED  %u/%u BINS  RX OK",
                      status.points_completed, status.points_total);
        put_label(parent, line, 10, 182, theme::amber(), &font_mono_10);
        put_centered_label(parent,
                           survey_running ? "SURVEY ACTIVE - RESCAN UNAVAILABLE" :
                                            "PARTIAL RESULT  /  ENTER RESCAN",
                           204, survey_running ? theme::amber() : theme::cyan(),
                           &font_mono_10);
    } else {
        std::uint32_t busiest_score = 0;
        std::uint32_t quietest_score = UINT32_MAX;
        std::uint32_t busiest_hz = 0;
        std::uint32_t quietest_hz = 0;
        for(std::size_t point = 0; point < result.point_count; ++point) {
            const SpectrumBinSummary summary = summarizeSpectrumBins(result.points[point].counts);
            if(summary.above_floor_samples >= busiest_score) {
                busiest_score = summary.above_floor_samples;
                busiest_hz = result.points[point].frequency_hz;
            }
            if(summary.above_floor_samples < quietest_score) {
                quietest_score = summary.above_floor_samples;
                quietest_hz = result.points[point].frequency_hz;
            }
        }
        std::snprintf(line, sizeof(line), "BUSY %.3f    QUIET %.3f    %u BINS",
                      static_cast<double>(busiest_hz) / 1000000.0,
                      static_cast<double>(quietest_hz) / 1000000.0,
                      result.point_count);
        put_label(parent, line, 10, 182, theme::text(), &font_mono_10);
        put_centered_label(parent,
                           survey_running ? "SURVEY ACTIVE - RESCAN UNAVAILABLE" :
                                            "RELATIVE POWER  /  ENTER RESCAN",
                           204, survey_running ? theme::amber() : theme::cyan(),
                           &font_mono_10);
    }
    return;
    }
#else
    add_simulator_live_status_bar(parent, spectrum_title);
    constexpr lv_coord_t x = 7;
    constexpr lv_coord_t y = 30;
    constexpr lv_coord_t width = 306;
    constexpr lv_coord_t height = 145;
    lv_obj_t * canvas = lv_canvas_create(parent);
    theme::reset(canvas);
    lv_canvas_set_buffer(canvas, spectrum_buffer, width, height, LV_COLOR_FORMAT_RGB565);
    lv_canvas_fill_bg(canvas, theme::heat_deep(), LV_OPA_COVER);
    lv_obj_set_pos(canvas, x, y);

    const simulator::SpectrumSnapshot &spectrum = simulator_live_telemetry.spectrum();
    const SpectrumSweepRequest request = simulator_spectrum_request();
    const std::uint16_t total_points = simulator_spectrum_total_points();
    const std::uint32_t elapsed = simulator_live_telemetry.elapsedMilliseconds() -
                                  simulator_spectrum_started_ms;
    const std::uint16_t completed = simulator_spectrum_scanning
        ? static_cast<std::uint16_t>((elapsed / 50U) > total_points
                                        ? total_points : elapsed / 50U)
        : simulator_spectrum_partial_points;
    const lv_coord_t revealed_width = static_cast<lv_coord_t>(
        total_points == 0U ? 0U :
        (static_cast<std::uint32_t>(completed) * width) / total_points);
    using SimulatedSpectrumHistogram =
        std::array<std::array<std::uint16_t, kSpectrumPowerBinCount>,
                   simulator::kSpectrumColumnCount>;
    static SimulatedSpectrumHistogram histogram{};
    for(auto &column : histogram) column.fill(0U);
    std::uint16_t maximum_count = 1U;
    for(std::size_t column = 0U; column < simulator::kSpectrumColumnCount; ++column) {
        for(std::size_t age = 0U; age < simulator::kSpectrumHistoryRowCount; ++age) {
            const std::uint8_t intensity = spectrum.intensity(age, column);
            // Convert the recent time series into the same frequency-by-power
            // histogram the SX1262 returns on-device. A quiet sample clusters
            // near the simulated floor; stronger carriers move upward toward
            // the -11 dBm end of the 33 RadioLib power bins.
            const std::int32_t power_dbm = static_cast<std::int32_t>(
                spectrum.noise_floor_dbm - 6 +
                (static_cast<std::uint32_t>(intensity) * 88U) / 255U);
            std::int32_t power_bin = (-11 - power_dbm) / 4;
            if(power_bin < 0) power_bin = 0;
            if(power_bin >= static_cast<std::int32_t>(kSpectrumPowerBinCount)) {
                power_bin = static_cast<std::int32_t>(kSpectrumPowerBinCount - 1U);
            }
            std::uint16_t &count = histogram[column][static_cast<std::size_t>(power_bin)];
            if(count != UINT16_MAX) ++count;
            if(count > maximum_count) maximum_count = count;
        }
    }
    for(lv_coord_t px = 0; px < revealed_width; ++px) {
        const std::size_t column = static_cast<std::size_t>(px) *
                                   simulator::kSpectrumColumnCount /
                                   static_cast<std::size_t>(width);
        for(lv_coord_t py = 0; py < height; ++py) {
            std::size_t bin = static_cast<std::size_t>(py) * kSpectrumPowerBinCount /
                              static_cast<std::size_t>(height);
            if(bin >= kSpectrumPowerBinCount) bin = kSpectrumPowerBinCount - 1U;
            const std::uint16_t count = histogram[column][bin];
            const std::uint32_t scaled = count == 0U ? 0U :
                20U + (static_cast<std::uint32_t>(count) * 235U) / maximum_count;
            lv_color_t color = theme::heat_deep();
            if(scaled > 210U) color = theme::heat_peak();
            else if(scaled > 160U) color = theme::heat_hot();
            else if(scaled > 110U) color = theme::heat_bright();
            else if(scaled > 62U) color = theme::heat_mid();
            else if(scaled > 12U) color = theme::heat_cold();
            lv_canvas_set_px(canvas, px, py, color, LV_OPA_COVER);
        }
    }
    lv_obj_invalidate(canvas);

    add_grid(parent, x, y, width, height, 24, 16);
    theme::rule_line(parent, x, y, width);
    theme::rule_line(parent, x, y + height, width);

    char range_label[20]{};
    std::snprintf(range_label, sizeof(range_label), "%.3f",
                  static_cast<double>(request.start_frequency_hz) / 1000000.0);
    put_label(parent, "-11", x + 3, y + 2, theme::text_muted(), &font_mono_10);
    put_label(parent, "-139", x + 3, y + height - 14, theme::text_muted(), &font_mono_10);
    put_label(parent, range_label, x + 31, y + height - 14,
              theme::text_muted(), &font_mono_10);
    std::snprintf(range_label, sizeof(range_label), "%.3f",
                  static_cast<double>(request.end_frequency_hz) / 1000000.0);
    put_label(parent, range_label, x + width - 50, y + height - 14,
              theme::text_muted(), &font_mono_10);

    if(simulator_spectrum_scanning) {
        const lv_coord_t cursor = x + static_cast<lv_coord_t>(
            total_points == 0U ? 0U :
            (static_cast<std::uint32_t>(completed) * width) / total_points);
        theme::rule_line(parent, cursor, y, 1, height, theme::cyan());
        for(lv_coord_t tick = y + 7; tick < y + height; tick += 10) {
            theme::rule_line(parent, cursor - 5, tick, 11, 1, theme::cyan());
        }
    }

    if(simulator_spectrum_scanning) {
        theme::rect(parent, 0, 181, 320, 42, theme::background());
        theme::rule_line(parent, 7, 182, 306);
        char scan_line[64]{};
        const std::uint32_t percent = total_points == 0U ? 0U :
            (static_cast<std::uint32_t>(completed) * 100U) / total_points;
        const std::uint16_t current_point = total_points == 0U ? 0U
            : (completed < total_points ? completed : total_points - 1U);
        const std::uint32_t frequency_hz = request.start_frequency_hz +
            static_cast<std::uint32_t>(current_point) * request.step_hz;
        std::snprintf(scan_line, sizeof(scan_line), "SCANNING %u/%u  %lu%%  %.3f MHz",
                      static_cast<unsigned>(completed), static_cast<unsigned>(total_points),
                      static_cast<unsigned long>(percent),
                      static_cast<double>(frequency_hz) / 1000000.0);
        put_label(parent, scan_line, 21, 188, theme::amber(), &font_mono_semibold_12);
        put_label(parent, "RX PAUSED - ENTER CANCEL", 82, 207,
                  theme::text_muted(), &font_mono_10);
        return;
    }

    theme::rule_line(parent, 7, 182, 306);
    if(simulator_spectrum_cancelled) {
        char cancelled[56]{};
        std::snprintf(cancelled, sizeof(cancelled), "CANCELLED  %u/%u BINS  PARTIAL RESULT",
                      static_cast<unsigned>(completed), static_cast<unsigned>(total_points));
        put_label(parent, cancelled, 22, 188, theme::amber(), &font_mono_semibold_12);
        put_centered_label(parent,
                           simulator_survey_running ? "SURVEY ACTIVE - RESCAN UNAVAILABLE" :
                                                      "RX RESUMED - ENTER RESCAN",
                           207, simulator_survey_running ? theme::amber() : theme::cyan(),
                           &font_mono_10);
        return;
    }
    if(completed == 0U) {
        put_centered_label(parent, "NO SWEEP CAPTURED", 184,
                           theme::text_muted(), &font_mono_semibold_12);
        char mode_line[56]{};
        std::snprintf(mode_line, sizeof(mode_line), "%s  /  %u BINS",
                      spectrum_scan_mode_label(), static_cast<unsigned>(total_points));
        put_centered_label(parent, mode_line, 199, theme::text_muted(), &font_mono_10);
        put_centered_label(parent,
                           simulator_survey_running ? "SURVEY ACTIVE - SCAN UNAVAILABLE" :
                                                      "UP/DOWN MODE  ENTER START",
                           215, simulator_survey_running ? theme::amber() : theme::cyan(),
                           &font_mono_10);
        return;
    }
    char metric[20]{};
    put_label(parent, "NOISE FLOOR", 16, 186, theme::text_muted(), &font_condensed_12);
    std::snprintf(metric, sizeof(metric), "%d dBm", spectrum.noise_floor_dbm);
    put_label(parent, metric, 23, 199, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 107, 183, 1, 32);
    put_label(parent, "BUSIEST", 132, 186, theme::text_muted(), &font_condensed_12);
    const std::uint32_t busiest_frequency_hz = simulator_spectrum_metric_frequency_hz(
        request, spectrum.busiest_frequency_khz);
    std::snprintf(metric, sizeof(metric), "%.3f",
                  static_cast<double>(busiest_frequency_hz) / 1000000.0);
    put_label(parent, metric, 130, 199, theme::amber(), &font_mono_semibold_12);
    theme::rule_line(parent, 211, 183, 1, 32);
    put_label(parent, "QUIETEST", 242, 186, theme::text_muted(), &font_condensed_12);
    const std::uint32_t quietest_frequency_hz = simulator_spectrum_metric_frequency_hz(
        request, spectrum.quietest_frequency_khz);
    std::snprintf(metric, sizeof(metric), "%.3f",
                  static_cast<double>(quietest_frequency_hz) / 1000000.0);
    put_label(parent, metric, 235, 199, theme::cyan(), &font_mono_semibold_12);
    if(simulator_survey_running) {
        put_centered_label(parent, "SURVEY ACTIVE - RESCAN UNAVAILABLE", 216,
                           theme::amber(), &font_mono_10);
    }
#endif
}

void build_node_detail(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, "NODE DETAIL");
    std::array<LiveNodeSummary, 8> live_nodes{};
    const std::size_t count = collect_live_nodes(live_nodes);
    if(count == 0) {
        put_label(parent, "NO NODE SELECTED", 77, 87, theme::text_muted(), &font_condensed_bold_16);
        put_label(parent, "Capture a decoded source first", 75, 111, theme::text_muted(), &font_mono_10);
        return;
    }

    if(!node_detail_selection_valid) {
        const LiveNodeSummary &selected = live_nodes[resolve_node_selection(live_nodes, count)];
        node_detail_protocol = selected.protocol;
        node_detail_id = selected.id;
        node_detail_selection_valid = true;
    }
    const LiveNodeSummary *selected_node = nullptr;
    for(std::size_t index = 0; index < count; ++index) {
        if(live_node_matches(live_nodes[index], node_detail_protocol, node_detail_id)) {
            selected_node = &live_nodes[index];
            break;
        }
    }
    if(selected_node == nullptr) {
        put_label(parent, "SELECTED NODE EXPIRED", 59, 84, theme::fault(), &font_condensed_bold_16);
        put_label(parent, "Its frames left the capture buffer", 63, 108,
                  theme::text_muted(), &font_mono_10);
        put_label(parent, "BACK  RETURN TO NODES", 85, 204, theme::cyan(), &font_mono_10);
        return;
    }

    const LiveNodeSummary &node = *selected_node;
    char line[72]{};
    char age[12]{};
    format_age(age, sizeof(age), node.last_seen_us);
    std::snprintf(line, sizeof(line), "%08lX", static_cast<unsigned long>(node.id));
    put_label(parent, line, 8, 25, theme::text(), &font_condensed_bold_28);
    std::snprintf(line, sizeof(line), "%s  LAST %s  %u FRAMES", protocolName(node.protocol), age,
                  static_cast<unsigned>(node.frames));
    put_label(parent, line, 9, 55, theme::text_muted(), &font_mono_10);
    theme::rule_line(parent, 6, 70, 308);

    put_label(parent, "SNR HISTORY", 8, 78, theme::text(), &font_mono_10);
    add_grid(parent, 8, 92, 304, 40, 50, 20);
    draw_live_node_history(parent, node, 8, 93, 304, 38);
    std::snprintf(line, sizeof(line), "LATEST %+.1f dB  AVERAGE %+.1f dB",
                  static_cast<double>(node.latest_snr_x10) / 10.0,
                  node.frames == 0 ? 0.0 : static_cast<double>(node.snr_sum_x10) /
                      (10.0 * static_cast<double>(node.frames)));
    put_label(parent, line, 9, 135, theme::lime(), &font_mono_10);

    put_label(parent, "RSSI HISTORY", 8, 155, theme::text(), &font_mono_10);
    add_grid(parent, 8, 169, 304, 34, 50, 17);
    draw_live_node_history(parent, node, 8, 170, 304, 32, true);
    std::snprintf(line, sizeof(line), "LATEST %.1f dBm  CRC ERRORS %u",
                  static_cast<double>(node.latest_rssi_x10) / 10.0,
                  static_cast<unsigned>(node.crc_errors));
    put_label(parent, line, 9, 207,
              node.crc_errors == 0 ? theme::cyan() : theme::fault(), &font_mono_10);
    return;
    }
#else
    add_simulator_live_status_bar(parent, "NODE DETAIL");
    const simulator::NodeSnapshot *selected_node = simulator_node_detail_selection_valid
        ? simulator_established_node_by_id(simulator_node_detail_id) : nullptr;
    if(selected_node == nullptr) {
        put_label(parent, "NO NODE SELECTED", 77, 87,
                  theme::text_muted(), &font_condensed_bold_16);
        put_label(parent, "Wait for a frame with a stable source", 57, 111,
                  theme::text_muted(), &font_mono_10);
        return;
    }
    const simulator::NodeSnapshot &live_node = *selected_node;
    char node_line[72]{};
    char age[10]{};
    format_simulator_age(age, sizeof(age), live_node.last_seen_seconds);
    std::snprintf(node_line, sizeof(node_line), "%08lX",
                  static_cast<unsigned long>(live_node.id));
    put_label(parent, node_line, 8, 25, theme::text(), &font_condensed_bold_28);
    std::snprintf(node_line, sizeof(node_line), "%s  LAST %s  %u FRAMES",
                  simulator_protocol_label(live_node.protocol), age,
                  static_cast<unsigned>(live_node.frame_count));
    put_label(parent, node_line, 9, 55, theme::text_muted(), &font_mono_10);
    theme::rule_line(parent, 6, 70, 308);

    put_label(parent, "SNR HISTORY", 8, 78, theme::text(), &font_mono_10);
    add_grid(parent, 8, 92, 304, 40, 50, 20);
    draw_simulator_node_history(parent, live_node, 8, 93, 304, 38, theme::lime());
    std::snprintf(node_line, sizeof(node_line), "LATEST %+.1f dB  AVERAGE %+.1f dB",
                  static_cast<double>(live_node.latest_snr_db_x10) / 10.0,
                  static_cast<double>(live_node.mean_snr_db_x10) / 10.0);
    put_label(parent, node_line, 9, 135, theme::lime(), &font_mono_10);

    put_label(parent, "RSSI HISTORY", 8, 155, theme::text(), &font_mono_10);
    add_grid(parent, 8, 169, 304, 34, 50, 17);
    draw_simulator_node_history(parent, live_node, 8, 170, 304, 32,
                                theme::cyan(), true);
    std::snprintf(node_line, sizeof(node_line), "LATEST %.1f dBm  CRC ERRORS %u",
                  static_cast<double>(live_node.latest_rssi_dbm_x10) / 10.0,
                  static_cast<unsigned>(live_node.crc_errors));
    put_label(parent, node_line, 9, 207,
              live_node.crc_errors == 0U ? theme::cyan() : theme::fault(), &font_mono_10);
#endif
}

constexpr std::array<const char *, 5> packet_detail_tabs = {{"PKT", "RF", "DEC", "HEX", "RAW"}};

void add_packet_detail_tabs(lv_obj_t *parent)
{
    theme::rect(parent, 0, 22, 38, 201, theme::surface());
    theme::rule_line(parent, 37, 22, 1, 201);
    for(std::size_t index = 0; index < packet_detail_tabs.size(); ++index) {
        const lv_coord_t y = 29 + static_cast<lv_coord_t>(index) * 37;
        if(index == packet_detail_tab) {
            theme::rect(parent, 1, y - 2, 35, 25, theme::surface_selected());
            theme::rect(parent, 1, y - 2, 3, 25, theme::pink());
        }
        put_label(parent, packet_detail_tabs[index], 8, y + 4,
                  index == packet_detail_tab ? theme::background() : theme::text_muted(),
                  &font_mono_10);
    }
}

std::uint32_t packet_fingerprint(const std::uint8_t *bytes, std::size_t length) noexcept
{
    std::uint32_t hash = 2166136261U;
    for(std::size_t index = 0; index < length; ++index) {
        hash ^= bytes[index];
        hash *= 16777619U;
    }
    return hash;
}

void build_packet_detail(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, "PACKET DETAIL");
    if(packet_detail_sequence == 0) select_current_frame_for_detail();
    const FrameRecord *record = find_live_frame(packet_detail_sequence);
    if(record == nullptr) {
        if(capture_runtime.frames().empty()) {
            put_label(parent, "NO CAPTURED FRAME", 48, 86,
                      theme::text_muted(), &font_condensed_bold_16);
            put_label(parent, "Open TRAFFIC and wait for radio activity", 35, 112,
                      theme::text_muted(), &font_mono_10);
        } else {
            put_label(parent, "SELECTED FRAME EXPIRED", 48, 86,
                      theme::fault(), &font_condensed_bold_16);
            put_label(parent, "It left the 64-frame capture buffer", 47, 112,
                      theme::text_muted(), &font_mono_10);
            put_label(parent, "BACK  RETURN TO TRAFFIC", 78, 204,
                      theme::cyan(), &font_mono_10);
        }
        return;
    }

    add_packet_detail_tabs(parent);

    char source[12]{};
    char destination[12]{};
    char line[72]{};
    format_node(source, sizeof(source), record->decoded, FieldSource);
    format_node(destination, sizeof(destination), record->decoded, FieldDestination);
    std::snprintf(line, sizeof(line), "%s  >  %s", source, destination);
    put_label(parent, line, 49, 29, theme::text(), &font_mono_semibold_12);
    std::snprintf(line, sizeof(line), "%s  %s  %s  %u B%s", protocolName(record->decoded.protocol),
                  packetKindLabel(record->decoded), decodeStateLabel(record->decoded.state),
                  record->raw.captured_length,
                  record->raw.rf.origin == FrameOrigin::Synthetic ? "  SIM" : "");
    put_label(parent, line, 49, 50,
              record->decoded.state == DecodeState::Malformed ? theme::fault() : theme::amber(),
              &font_mono_10);
    if(record->raw.rf.hasField(RfFieldCodingRate)) {
        std::snprintf(line, sizeof(line), "SF%u  BW %.1fk  CR4/%u  0x%04X",
                      record->raw.rf.spreading_factor,
                      static_cast<double>(record->raw.rf.bandwidth_hz) / 1000.0,
                      record->raw.rf.coding_rate_denominator, record->raw.rf.sync_word);
    } else {
        std::snprintf(line, sizeof(line), "SF%u  BW %.1fk  CR --  0x%04X",
                      record->raw.rf.spreading_factor,
                      static_cast<double>(record->raw.rf.bandwidth_hz) / 1000.0,
                      record->raw.rf.sync_word);
    }
    put_label(parent, line, 49, 67, theme::text(), &font_mono_10);
    std::snprintf(line, sizeof(line), "RSSI %.1f  SNR %+.1f dB  CRC %s",
                  static_cast<double>(record->raw.rf.rssi_dbm_x10) / 10.0,
                  static_cast<double>(record->raw.rf.snr_db_x10) / 10.0,
                  record->raw.rf.crc == CrcStatus::Valid ? "OK" :
                  (record->raw.rf.crc == CrcStatus::Invalid ? "BAD" : "--"));
    put_label(parent, line, 49, 84,
              record->raw.rf.crc == CrcStatus::Invalid ? theme::fault() : theme::lime(), &font_mono_10);
    theme::rule_line(parent, 47, 103, 266);

    auto format_protocol_detail = [&]() {
        const bool malformed_without_safe_fields =
            record->decoded.state == DecodeState::Malformed &&
            (record->decoded.present_fields & ~static_cast<std::uint32_t>(FieldPayload)) == 0U;
        if(malformed_without_safe_fields) {
            std::snprintf(line, sizeof(line), "STRUCTURE INVALID / NO SAFE HEADER FACTS");
        } else if(record->decoded.protocol == ProtocolId::MeshCore &&
                  record->decoded.state != DecodeState::Malformed) {
            std::snprintf(line, sizeof(line), "ROUTE %u  TYPE %s  PATH %ux%u",
                          static_cast<unsigned>(MeshCoreDecoder::routeType(record->decoded)),
                          packetKindLabel(record->decoded),
                          static_cast<unsigned>(MeshCoreDecoder::pathHashCount(record->decoded)),
                          static_cast<unsigned>(MeshCoreDecoder::pathHashSize(record->decoded)));
        } else if(record->decoded.protocol == ProtocolId::Reticulum &&
                  record->decoded.state != DecodeState::Malformed) {
            if(ReticulumDecoder::isIfacProtected(record->decoded)) {
                std::snprintf(line, sizeof(line), "IFAC MARKED / UNVERIFIED  HEADER OPAQUE");
            } else if(ReticulumDecoder::isRNodeSplitFrame(record->decoded)) {
                std::snprintf(line, sizeof(line), "RNODE SPLIT FRAME  REASSEMBLY PENDING");
            } else {
                std::snprintf(line, sizeof(line), "H%u  HOPS %u  DEST PREFIX %08lX",
                              ReticulumDecoder::headerType(record->decoded) == ReticulumHeaderType::HeaderTwo ? 2U : 1U,
                              static_cast<unsigned>(ReticulumDecoder::observedHops(record->decoded)),
                              static_cast<unsigned long>(ReticulumDecoder::destinationHashPrefix(record->decoded)));
            }
        } else if(record->decoded.hasField(FieldPacketId)) {
            std::snprintf(line, sizeof(line), "ID %08lX  CH HASH %02X  HOPS %u/%u",
                          static_cast<unsigned long>(record->decoded.packet_id),
                          static_cast<unsigned>(record->decoded.channel),
                          record->decoded.hop_limit, record->decoded.hop_start);
        } else {
            std::snprintf(line, sizeof(line), "FLAGS 0x%08lX  OFFSET %u",
                          static_cast<unsigned long>(record->decoded.protocol_flags),
                          record->decoded.payload_offset);
        }
    };

    if(packet_detail_tab == 0U) {
        format_protocol_detail();
        put_label(parent, line, 49, 114, theme::cyan(), &font_mono_10);
        std::snprintf(line, sizeof(line), "FRAME #%llu   CAPTURED %u / ORIGINAL %u",
                      static_cast<unsigned long long>(record->sequence),
                      record->raw.captured_length, record->raw.original_length);
        put_label(parent, line, 49, 139, theme::text(), &font_mono_10);
        std::snprintf(line, sizeof(line), "PAYLOAD OFFSET %u   LENGTH %u",
                      record->decoded.payload_offset, record->decoded.payload_length);
        put_label(parent, line, 49, 158, theme::text(), &font_mono_10);
        std::snprintf(line, sizeof(line), "MONOTONIC %llu us",
                      static_cast<unsigned long long>(record->raw.rf.timestamp_us));
        put_label(parent, line, 49, 177, theme::text_muted(), &font_mono_10);
    } else if(packet_detail_tab == 1U) {
        std::snprintf(line, sizeof(line), "CENTER  %.3f MHz",
                      static_cast<double>(record->raw.rf.center_frequency_hz) / 1000000.0);
        put_label(parent, line, 49, 112, theme::cyan(), &font_mono_semibold_12);
        std::snprintf(line, sizeof(line), "BW %.1f kHz   SF%u   PREAMBLE %u",
                      static_cast<double>(record->raw.rf.bandwidth_hz) / 1000.0,
                      record->raw.rf.spreading_factor, record->raw.rf.preamble_symbols);
        put_label(parent, line, 49, 135, theme::text(), &font_mono_10);
        char coding_rate[8]{};
        if(record->raw.rf.hasField(RfFieldCodingRate)) {
            std::snprintf(coding_rate, sizeof(coding_rate), "4/%u",
                          record->raw.rf.coding_rate_denominator);
        } else {
            std::snprintf(coding_rate, sizeof(coding_rate), "--");
        }
        std::snprintf(line, sizeof(line), "CR %s   SYNC 0x%04X   PROFILE %u",
                      coding_rate, record->raw.rf.sync_word, record->raw.rf.profile_id);
        put_label(parent, line, 49, 153, theme::text(), &font_mono_10);
        char airtime[16]{};
        char frequency_error[20]{};
        if(record->raw.rf.hasField(RfFieldAirtime)) {
            std::snprintf(airtime, sizeof(airtime), "%.2f ms",
                          static_cast<double>(record->raw.rf.airtime_us) / 1000.0);
        } else {
            std::snprintf(airtime, sizeof(airtime), "--");
        }
        if(record->raw.rf.hasField(RfFieldFrequencyError)) {
            std::snprintf(frequency_error, sizeof(frequency_error), "%ld Hz",
                          static_cast<long>(record->raw.rf.frequency_error_hz));
        } else {
            std::snprintf(frequency_error, sizeof(frequency_error), "--");
        }
        std::snprintf(line, sizeof(line), "AIRTIME %s   FREQ ERR %s",
                      airtime, frequency_error);
        put_label(parent, line, 49, 171, theme::text(), &font_mono_10);
        put_label(parent, "Explicit values remain blank when radio metadata is unavailable.",
                  49, 194, theme::text_muted(), &font_mono_10);
    } else if(packet_detail_tab == 2U) {
        std::snprintf(line, sizeof(line), "STATE  %s", decodeStateLabel(record->decoded.state));
        put_label(parent, line, 49, 112,
                  record->decoded.state == DecodeState::Malformed ? theme::fault() : theme::lime(),
                  &font_mono_semibold_12);
        std::snprintf(line, sizeof(line), "KIND   %s", packetKindLabel(record->decoded));
        put_label(parent, line, 49, 134, theme::text(), &font_mono_10);
        // A pointer frame gives its diagnostics rows to the pointer itself:
        // the same commitment the web analyzer resolves, decoded from the raw
        // bytes on the device, is the story this tab exists to tell.
        ShelbyPointer shelby_pointer{};
        if(decode_frame_shelby_pointer(*record, shelby_pointer)) {
            std::snprintf(line, sizeof(line), "SHELBY POINTER  %s  CHUNK %u/%u",
                          shelby_pointer.isCapture() ? "CAPTURE" : "BLOB",
                          static_cast<unsigned>(shelby_pointer.chunk_index) + 1U,
                          static_cast<unsigned>(shelby_pointer.chunk_count));
            put_label(parent, line, 49, 153, theme::cyan(), &font_mono_semibold_12);
            std::snprintf(line, sizeof(line), "COMMIT 0x%02x%02x%02x%02x..%02x%02x%02x%02x",
                          shelby_pointer.commitment[0], shelby_pointer.commitment[1],
                          shelby_pointer.commitment[2], shelby_pointer.commitment[3],
                          shelby_pointer.commitment[28], shelby_pointer.commitment[29],
                          shelby_pointer.commitment[30], shelby_pointer.commitment[31]);
            put_label(parent, line, 49, 174, theme::text(), &font_mono_10);
            char expiry[16]{};
            format_unix_date(shelby_pointer.expires_at_unix, expiry, sizeof(expiry));
            std::snprintf(line, sizeof(line), "%lu B ON SHELBYNET  EXPIRES %s",
                          static_cast<unsigned long>(shelby_pointer.size_bytes), expiry);
            put_label(parent, line, 49, 193, theme::lime(), &font_mono_10);
        } else {
            std::snprintf(line, sizeof(line), "FIELDS 0x%08lX   ATTR 0x%04X",
                          static_cast<unsigned long>(record->decoded.present_fields),
                          record->decoded.attributes);
            put_label(parent, line, 49, 153, theme::text(), &font_mono_10);
            std::snprintf(line, sizeof(line), "PAYLOAD %u @ %u   FLAGS 0x%08lX",
                          record->decoded.payload_length, record->decoded.payload_offset,
                          static_cast<unsigned long>(record->decoded.protocol_flags));
            put_label(parent, line, 49, 172, theme::text(), &font_mono_10);
            format_protocol_detail();
            put_label(parent, line, 49, 193, theme::cyan(), &font_mono_10);
        }
    } else if(packet_detail_tab == 3U) {
        constexpr std::size_t bytes_per_page = 40U;
        const std::size_t byte_count = record->raw.captured_length;
        const std::size_t page_count = byte_count == 0U ? 1U :
                                       (byte_count + bytes_per_page - 1U) / bytes_per_page;
        if(packet_detail_byte_offset >= byte_count && byte_count != 0U) {
            packet_detail_byte_offset = (page_count - 1U) * bytes_per_page;
        }
        const std::size_t page_index = packet_detail_byte_offset / bytes_per_page;
        const std::size_t last_byte = byte_count == 0U ? 0U :
                                      ((packet_detail_byte_offset + bytes_per_page) < byte_count
                                           ? packet_detail_byte_offset + bytes_per_page : byte_count);
        std::snprintf(line, sizeof(line), "RAW BYTES %u-%u / %u",
                      byte_count == 0U ? 0U : static_cast<unsigned>(packet_detail_byte_offset),
                      byte_count == 0U ? 0U : static_cast<unsigned>(last_byte - 1U),
                      static_cast<unsigned>(byte_count));
        put_label(parent, line, 49, 114, theme::text_muted(), &font_mono_10);
        for(std::size_t row = 0; row < 4; ++row) {
            char hex[48]{};
            std::size_t cursor = 0;
            for(std::size_t column = 0; column < 10; ++column) {
                const std::size_t offset = packet_detail_byte_offset + row * 10U + column;
                if(offset >= record->raw.captured_length || cursor + 4 >= sizeof(hex)) break;
                cursor += static_cast<std::size_t>(std::snprintf(
                    hex + cursor, sizeof(hex) - cursor, "%02X ", record->raw.bytes[offset]));
            }
            put_label(parent, hex, 49, 133 + static_cast<lv_coord_t>(row) * 16,
                      row == 0 ? theme::text() : theme::text_muted(), &font_mono_10);
        }
        std::snprintf(line, sizeof(line), "UP / DOWN  PAGE %u OF %u",
                      static_cast<unsigned>(page_index + 1U), static_cast<unsigned>(page_count));
        put_label(parent, line, 49, 202, theme::cyan(), &font_mono_10);
    } else {
        const std::uint32_t fingerprint = packet_fingerprint(record->raw.bytes,
                                                              record->raw.captured_length);
        put_label(parent, "CURRENT WRITER STATE", 49, 112, theme::pink(),
                  &font_mono_semibold_12);
        std::snprintf(line, sizeof(line), "FRAME #%llu   RADIO %u   STATUS %d",
                      static_cast<unsigned long long>(record->sequence),
                      record->raw.rf.radio_index, record->raw.rf.radio_status);
        put_label(parent, line, 49, 136, theme::text(), &font_mono_10);
        std::snprintf(line, sizeof(line), "CAPTURED %u   ORIGINAL %u   %s",
                      record->raw.captured_length, record->raw.original_length,
                      record->raw.wasTruncated() ? "TRUNCATED" : "COMPLETE");
        put_label(parent, line, 49, 155,
                  record->raw.wasTruncated() ? theme::amber() : theme::lime(), &font_mono_10);
        const char *origin = record->raw.rf.origin == FrameOrigin::Synthetic ? "SYNTHETIC" :
                             (record->raw.rf.origin == FrameOrigin::Radio ? "RADIO" : "UNKNOWN");
        std::snprintf(line, sizeof(line), "ORIGIN %s%s", origin,
                      record->raw.rf.origin == FrameOrigin::Synthetic ? " / NOT OTA" : "");
        put_label(parent, line, 49, 174, theme::text(), &font_mono_10);
        if(record->raw.rf.origin == FrameOrigin::Synthetic) {
            std::snprintf(line, sizeof(line), "FNV32 %08lX   LSCAP %s  PCAP SKIP",
                          static_cast<unsigned long>(fingerprint),
                          native_capture_recording ? "SIM" : "OFF");
        } else {
            std::snprintf(line, sizeof(line), "FNV32 %08lX   LSCAP %s  PCAP %s",
                          static_cast<unsigned long>(fingerprint),
                          native_capture_recording ? "ON" : "OFF",
                          pcap_recording ? "ON" : "OFF");
        }
        put_label(parent, line, 49, 193, theme::cyan(), &font_mono_10);
    }
    put_label(parent, "LEFT / RIGHT  SECTION", 83, 216, theme::cyan(), &font_mono_10);
    return;
    }
#else
    if(!simulator_packet_detail_sample_valid) (void)select_simulator_packet_for_detail();
    const simulator::TrafficSample &selected_packet = simulator_packet_detail_sample;
    DecodedPacket simulated_decoded{};
    const bool simulator_decoder_attributed =
        decode_simulator_packet(selected_packet, simulated_decoded);
    const bool has_structural_decode =
        simulator_decoder_attributed && simulated_decoded.state != DecodeState::Malformed;
    const bool has_source_identity =
        has_structural_decode &&
        selected_packet.source_node != simulator::kNoNode &&
        selected_packet.source_node < simulator::kNodeCount;
    char packet_time[12]{};
    format_simulator_clock(packet_time, sizeof(packet_time),
                           selected_packet.timestamp_seconds_of_day);
    add_status_bar(parent, "PACKET DETAIL", "BAT 87%",
                   app_settings.gps_enabled ? "GPS 3D" : "GPS OFF", packet_time);
    add_packet_detail_tabs(parent);

    char detail_line[72]{};
    char source_id[12]{};
    char destination_id[12]{};
    format_simulator_node_id(source_id, sizeof(source_id), selected_packet.source_node, false);
    format_simulator_node_id(destination_id, sizeof(destination_id),
                             selected_packet.destination_node, has_source_identity);
    std::snprintf(detail_line, sizeof(detail_line), "%s  >  %s",
                  has_source_identity ? source_id : "--",
                  has_source_identity ? destination_id : "--");
    put_label(parent, detail_line, 49, 29, theme::text(), &font_mono_semibold_12);
    const char *packet_kind = simulator_packet_kind_label(selected_packet);
    std::snprintf(detail_line, sizeof(detail_line), "%s  %s  %s  %u B",
                  simulator_protocol_label(selected_packet.protocol),
                  packet_kind, decodeStateLabel(simulated_decoded.state),
                  static_cast<unsigned>(selected_packet.captured_bytes));
    put_label(parent, detail_line, 49, 50,
              simulated_decoded.state == DecodeState::Malformed
                  ? theme::fault() : theme::amber(), &font_mono_10);
    std::snprintf(detail_line, sizeof(detail_line), "SF%u  BW %.1fk  CR4/%u  0x%04X",
                  selected_packet.spreading_factor,
                  static_cast<double>(selected_packet.bandwidth_hz) / 1000.0,
                  selected_packet.coding_rate_denominator, selected_packet.sync_word);
    put_label(parent, detail_line, 49, 67, theme::text(), &font_mono_10);
    std::snprintf(detail_line, sizeof(detail_line), "RSSI %.1f  SNR %+.1f dB  CRC %s",
                  static_cast<double>(selected_packet.rssi_dbm_x10) / 10.0,
                  static_cast<double>(selected_packet.snr_db_x10) / 10.0,
                  selected_packet.crc_valid ? "OK" : "BAD");
    put_label(parent, detail_line, 49, 84,
              selected_packet.crc_valid ? theme::lime() : theme::fault(), &font_mono_10);
    theme::rule_line(parent, 47, 103, 266);
    constexpr std::size_t bytes_per_page = 40U;
    const std::size_t byte_count = selected_packet.captured_bytes;
    const std::size_t page_count = (byte_count + bytes_per_page - 1U) / bytes_per_page;
    auto simulated_byte = [&](std::size_t offset) {
        return selected_packet.byteAt(offset);
    };
    auto format_simulated_protocol_detail = [&]() {
        if(!simulator_decoder_attributed) {
            std::snprintf(detail_line, sizeof(detail_line), "UNCLASSIFIED / RAW BYTES ONLY");
        } else if(simulated_decoded.state == DecodeState::Malformed &&
                  (simulated_decoded.present_fields &
                   ~static_cast<std::uint32_t>(FieldPayload)) == 0U) {
            std::snprintf(detail_line, sizeof(detail_line), "STRUCTURE INVALID / NO SAFE HEADER FACTS");
        } else if(simulated_decoded.protocol == ProtocolId::MeshCore &&
                  simulated_decoded.state != DecodeState::Malformed) {
            std::snprintf(detail_line, sizeof(detail_line), "ROUTE %u  TYPE %s  PATH %ux%u",
                          static_cast<unsigned>(MeshCoreDecoder::routeType(simulated_decoded)),
                          packetKindLabel(simulated_decoded),
                          static_cast<unsigned>(MeshCoreDecoder::pathHashCount(simulated_decoded)),
                          static_cast<unsigned>(MeshCoreDecoder::pathHashSize(simulated_decoded)));
        } else if(simulated_decoded.protocol == ProtocolId::Reticulum &&
                  simulated_decoded.state != DecodeState::Malformed) {
            std::snprintf(detail_line, sizeof(detail_line), "H%u  HOPS %u  DEST PREFIX %08lX",
                          ReticulumDecoder::headerType(simulated_decoded) ==
                              ReticulumHeaderType::HeaderTwo ? 2U : 1U,
                          static_cast<unsigned>(ReticulumDecoder::observedHops(simulated_decoded)),
                          static_cast<unsigned long>(
                              ReticulumDecoder::destinationHashPrefix(simulated_decoded)));
        } else if(simulated_decoded.hasField(FieldPacketId)) {
            std::snprintf(detail_line, sizeof(detail_line), "ID %08lX  CH %02X  HOPS %u/%u",
                          static_cast<unsigned long>(simulated_decoded.packet_id),
                          static_cast<unsigned>(simulated_decoded.channel),
                          simulated_decoded.hop_limit, simulated_decoded.hop_start);
        } else {
            std::snprintf(detail_line, sizeof(detail_line), "FLAGS 0x%08lX  OFFSET %u",
                          static_cast<unsigned long>(simulated_decoded.protocol_flags),
                          simulated_decoded.payload_offset);
        }
    };
    if(packet_detail_tab == 0U) {
        format_simulated_protocol_detail();
        put_label(parent, detail_line, 49, 116, theme::cyan(), &font_mono_10);
        std::snprintf(detail_line, sizeof(detail_line), "FRAME #%llu   CAPTURED %u / ORIGINAL %u",
                      static_cast<unsigned long long>(selected_packet.sequence),
                      static_cast<unsigned>(selected_packet.captured_bytes),
                      static_cast<unsigned>(selected_packet.captured_bytes));
        put_label(parent, detail_line, 49, 139, theme::text(), &font_mono_10);
        if(has_structural_decode) {
            std::snprintf(detail_line, sizeof(detail_line), "PAYLOAD OFFSET %u   LENGTH %u",
                          static_cast<unsigned>(selected_packet.payload_offset),
                          static_cast<unsigned>(selected_packet.payload_bytes));
        } else {
            std::snprintf(detail_line, sizeof(detail_line), "PAYLOAD --   RAW CAPTURE %u B",
                          static_cast<unsigned>(selected_packet.captured_bytes));
        }
        put_label(parent, detail_line, 49, 158, theme::text(), &font_mono_10);
        std::snprintf(detail_line, sizeof(detail_line), "CAPTURE TIME %s", packet_time);
        put_label(parent, detail_line, 49, 181, theme::text_muted(), &font_mono_10);
    } else if(packet_detail_tab == 1U) {
        std::snprintf(detail_line, sizeof(detail_line), "CENTER  %.3f MHz",
                      static_cast<double>(selected_packet.center_frequency_hz) / 1000000.0);
        put_label(parent, detail_line, 49, 112, theme::cyan(), &font_mono_semibold_12);
        std::snprintf(detail_line, sizeof(detail_line), "BW %.1f kHz   SF%u   PREAMBLE %u",
                      static_cast<double>(selected_packet.bandwidth_hz) / 1000.0,
                      selected_packet.spreading_factor,
                      selected_packet.preamble_symbols);
        put_label(parent, detail_line, 49, 135, theme::text(), &font_mono_10);
        std::snprintf(detail_line, sizeof(detail_line), "CR 4/%u   SYNC 0x%04X   PROFILE %u",
                      selected_packet.coding_rate_denominator,
                      selected_packet.sync_word, selected_packet.profile_id);
        put_label(parent, detail_line, 49, 153, theme::text(), &font_mono_10);
        char frequency_error[20]{};
        if(selected_packet.has_frequency_error) {
            std::snprintf(frequency_error, sizeof(frequency_error), "%ld Hz",
                          static_cast<long>(selected_packet.frequency_error_hz));
        } else {
            std::snprintf(frequency_error, sizeof(frequency_error), "--");
        }
        std::snprintf(detail_line, sizeof(detail_line), "AIRTIME %.2f ms   FREQ ERR %s",
                      static_cast<double>(selected_packet.airtime_us) / 1000.0,
                      frequency_error);
        put_label(parent, detail_line, 49, 171, theme::text(), &font_mono_10);
        put_label(parent, "Capture-time RF values stay with this frame.", 49, 194,
                  theme::text_muted(), &font_mono_10);
    } else if(packet_detail_tab == 2U) {
        std::snprintf(detail_line, sizeof(detail_line), "STATE  %s",
                      decodeStateLabel(simulated_decoded.state));
        put_label(parent, detail_line, 49, 112,
                  simulated_decoded.state == DecodeState::Malformed
                      ? theme::fault() : theme::lime(), &font_mono_semibold_12);
        std::snprintf(detail_line, sizeof(detail_line), "KIND   %s",
                      packetKindLabel(simulated_decoded));
        put_label(parent, detail_line, 49, 134, theme::text(), &font_mono_10);
        std::snprintf(detail_line, sizeof(detail_line), "FIELDS 0x%08lX   ATTR 0x%04X",
                      static_cast<unsigned long>(simulated_decoded.present_fields),
                      simulated_decoded.attributes);
        put_label(parent, detail_line, 49, 153, theme::text(), &font_mono_10);
        std::snprintf(detail_line, sizeof(detail_line), "PAYLOAD %u @ %u   FLAGS 0x%08lX",
                      simulated_decoded.payload_length, simulated_decoded.payload_offset,
                      static_cast<unsigned long>(simulated_decoded.protocol_flags));
        put_label(parent, detail_line, 49, 172, theme::text(), &font_mono_10);
        format_simulated_protocol_detail();
        put_label(parent, detail_line, 49, 193, theme::cyan(), &font_mono_10);
    } else if(packet_detail_tab == 3U) {
        if(packet_detail_byte_offset >= byte_count) {
            packet_detail_byte_offset = (page_count - 1U) * bytes_per_page;
        }
        const std::size_t page_index = packet_detail_byte_offset / bytes_per_page;
        const std::size_t last_byte = (packet_detail_byte_offset + bytes_per_page) < byte_count
            ? packet_detail_byte_offset + bytes_per_page : byte_count;
        std::snprintf(detail_line, sizeof(detail_line), "RAW BYTES %u-%u / %u",
                      static_cast<unsigned>(packet_detail_byte_offset),
                      static_cast<unsigned>(last_byte - 1U), static_cast<unsigned>(byte_count));
        put_label(parent, detail_line, 49, 114, theme::text_muted(), &font_mono_10);
        for(std::size_t row = 0; row < 4U; ++row) {
            char hex[48]{};
            std::size_t cursor = 0U;
            for(std::size_t column = 0; column < 10U; ++column) {
                const std::size_t offset = packet_detail_byte_offset + row * 10U + column;
                if(offset >= byte_count || cursor + 4U >= sizeof(hex)) break;
                cursor += static_cast<std::size_t>(std::snprintf(
                    hex + cursor, sizeof(hex) - cursor, "%02X ", simulated_byte(offset)));
            }
            put_label(parent, hex, 49, 133 + static_cast<lv_coord_t>(row) * 16,
                      row == 0U ? theme::text() : theme::text_muted(), &font_mono_10);
        }
        std::snprintf(detail_line, sizeof(detail_line), "UP / DOWN  PAGE %u OF %u",
                      static_cast<unsigned>(page_index + 1U), static_cast<unsigned>(page_count));
        put_label(parent, detail_line, 49, 202, theme::cyan(), &font_mono_10);
    } else {
        std::uint32_t fingerprint = 2166136261U;
        for(std::size_t offset = 0U; offset < byte_count; ++offset) {
            fingerprint ^= simulated_byte(offset);
            fingerprint *= 16777619U;
        }
        put_label(parent, "CURRENT WRITER STATE", 49, 114, theme::pink(),
                  &font_mono_semibold_12);
        std::snprintf(detail_line, sizeof(detail_line), "FRAME #%llu   RADIO 0   RX",
                      static_cast<unsigned long long>(selected_packet.sequence));
        put_label(parent, detail_line, 49, 139, theme::text(), &font_mono_10);
        std::snprintf(detail_line, sizeof(detail_line),
                      "CAPTURED %u   ORIGINAL %u   COMPLETE",
                      static_cast<unsigned>(selected_packet.captured_bytes),
                      static_cast<unsigned>(selected_packet.captured_bytes));
        put_label(parent, detail_line, 49, 158, theme::lime(), &font_mono_10);
        std::snprintf(detail_line, sizeof(detail_line), "FNV32 %08lX",
                      static_cast<unsigned long>(fingerprint));
        put_label(parent, detail_line, 49, 177, theme::text(), &font_mono_10);
        put_label(parent,
                  app_settings.capture_enabled
                      ? "NOW  LSCAP RECORDING   PCAP RECORDING"
                      : "NOW  LSCAP OFF         PCAP OFF",
                  49, 198, app_settings.capture_enabled ? theme::cyan() : theme::amber(),
                  &font_mono_10);
    }
    put_label(parent, "LEFT / RIGHT  SECTION", 83, 216, theme::cyan(), &font_mono_10);
#endif
}

void build_map(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, "MAP");
    add_grid(parent, 0, 22, 320, 201, 20, 20);
    constexpr lv_coord_t cx = 160;
    constexpr lv_coord_t cy = 122;
    theme::rule_line(parent, cx - 28, cy, 56, 2, theme::lime());
    theme::rule_line(parent, cx, cy - 28, 2, 56, theme::lime());

    const GpsStatus &gps = hardware_status.snapshot().gps;
    if(gps.state == GpsState::Fix && gps.position_valid) {
        char line[72]{};
        std::snprintf(line, sizeof(line), "LOCAL FIX  %.5f, %.5f", gps.latitude_degrees,
                      gps.longitude_degrees);
        put_label(parent, line, 52, 29, theme::lime(), &font_mono_semibold_12);
        std::snprintf(line, sizeof(line), "ALT %.0f m  SAT %u  HDOP %.1f",
                      static_cast<double>(gps.altitude_meters), static_cast<unsigned>(gps.satellites),
                      static_cast<double>(gps.hdop));
        put_label(parent, line, 82, 47, theme::cyan(), &font_mono_10);
    } else if(gps.state == GpsState::Searching) {
        put_label(parent, "GPS RECEIVER FOUND - WAITING FOR FIX", 38, 42,
                  theme::amber(), &font_mono_10);
    } else if(gps.state == GpsState::Disabled) {
        put_label(parent, "OPTIONAL GPS IS OFF", 88, 42,
                  theme::text_muted(), &font_mono_semibold_12);
    } else {
        put_label(parent, "NO GPS RECEIVER", 98, 42, theme::text_muted(), &font_mono_semibold_12);
    }
    put_label(parent, "REMOTE POSITIONS REQUIRE A DECODED POSITION FRAME", 20, 204,
              theme::text_muted(), &font_mono_10);
    return;
    }
#else
    add_simulator_live_status_bar(parent, "MAP");
    add_grid(parent, 0, 22, 320, 201, 20, 20);
    if(!app_settings.gps_enabled) {
        put_label(parent, "OPTIONAL GPS IS OFF", 88, 42,
                  theme::text_muted(), &font_mono_semibold_12);
        put_label(parent, "ENABLE IT IN DISPLAY & INPUT", 68, 68,
                  theme::cyan(), &font_mono_10);
        put_label(parent, "REMOTE POSITIONS NEED DECODED POSITION FRAMES", 27, 204,
                  theme::text_muted(), &font_mono_10);
        return;
    }
    put_label(parent, "SIMULATED LOCAL GPS", 8, 27, theme::amber(), &font_mono_semibold_12);
    const std::uint32_t phase = static_cast<std::uint32_t>(simulator_live_telemetry.tick() / 4U);
    constexpr std::array<Point, 16> track = {{
        {128, 145}, {134, 140}, {140, 136}, {147, 132},
        {154, 127}, {161, 121}, {169, 116}, {177, 111},
        {185, 108}, {193, 105}, {200, 101}, {207, 96},
        {214, 91}, {220, 85}, {226, 79}, {231, 72},
    }};
    const std::size_t newest = phase % track.size();
    const Point &fix = track[newest];
    const std::size_t sweep_points = track.size();
    if(trace_buffer_index < trace_buffers.size()) {
        auto &points = trace_buffers[trace_buffer_index++];
        for(std::size_t index = 0U; index < sweep_points; ++index) {
            const Point &sample = track[(newest + index + 1U) % track.size()];
            points[index].x = sample.x;
            points[index].y = sample.y;
        }
        lv_obj_t *line = lv_line_create(parent);
        theme::reset(line);
        lv_line_set_points(line, points.data(), sweep_points);
        lv_obj_set_pos(line, 0, 0);
        lv_obj_set_style_line_color(line, theme::cyan(), 0);
        lv_obj_set_style_line_width(line, 1, 0);
    }
    theme::rule_line(parent, fix.x - 12, fix.y, 24, 2, theme::lime());
    theme::rule_line(parent, fix.x, fix.y - 12, 2, 24, theme::lime());
    char gps_line[64]{};
    std::snprintf(gps_line, sizeof(gps_line), "LOCAL FIX  37.774%u, -122.419%u",
                  static_cast<unsigned>(phase % 10U),
                  static_cast<unsigned>((phase * 3U) % 10U));
    put_label(parent, gps_line, 58, 47, theme::lime(), &font_mono_semibold_12);
    std::snprintf(gps_line, sizeof(gps_line), "ALT 18 m   SAT %u   HDOP 0.%u",
                  static_cast<unsigned>(9U + (phase % 4U)),
                  static_cast<unsigned>(7U + (phase % 3U)));
    put_label(parent, gps_line, 76, 64, theme::cyan(), &font_mono_10);
    put_label(parent, "REMOTE POSITIONS NEED DECODED POSITION FRAMES", 27, 204,
              theme::text_muted(), &font_mono_10);
#endif
}

void build_survey(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, "SURVEY");
    const std::uint32_t elapsed_ms = survey_running
        ? survey_elapsed_ms : (survey_has_result ? 60000U : 0U);
    const std::uint32_t bounded_ms = elapsed_ms > 60000U ? 60000U : elapsed_ms;
    const SurveySnapshot &survey = survey_accumulator.snapshot();

    put_label(parent, survey_running ? "CAPTURING" : (survey_has_result ? "SURVEY COMPLETE" : "READY"),
              survey_running ? 44 : 23, 47,
              survey_running ? theme::amber() : theme::lime(), &font_condensed_bold_28);
    char line[64]{};
    std::snprintf(line, sizeof(line), "%lus / 60s", static_cast<unsigned long>(bounded_ms / 1000U));
    put_label(parent, line, 241, 88, theme::lime(), &font_mono_semibold_12);

    lv_obj_t *progress = theme::rect(parent, 9, 84, 221, 23, theme::background());
    lv_obj_set_style_border_width(progress, 1, 0);
    lv_obj_set_style_border_color(progress, theme::text_muted(), 0);
    const lv_coord_t fill = static_cast<lv_coord_t>((bounded_ms * 215ULL) / 60000ULL);
    if(fill > 0) theme::rect(progress, 3, 3, fill, 17, theme::lime());

    std::snprintf(line, sizeof(line), "FRAMES          %llu",
                  static_cast<unsigned long long>(survey.total_frames));
    put_label(parent, line, 10, 121, theme::text(), &font_mono_semibold_12);
    std::snprintf(line, sizeof(line), "SOURCES         %u%s",
                  static_cast<unsigned>(survey.unique_sources),
                  survey.unique_sources_overflowed ? "+" : "");
    put_label(parent, line, 10, 143, theme::text(), &font_mono_semibold_12);
    if(!survey.has_best_snr) std::snprintf(line, sizeof(line), "BEST SNR        --");
    else std::snprintf(line, sizeof(line), "BEST SNR        %+.1f dB",
                       static_cast<double>(survey.best_snr_db_x10) / 10.0);
    put_label(parent, line, 10, 165, theme::text(), &font_mono_semibold_12);
    std::snprintf(line, sizeof(line), "CRC ERRORS      %llu",
                  static_cast<unsigned long long>(survey.crc_invalid_frames));
    put_label(parent, line, 10, 187,
              survey.crc_invalid_frames == 0 ? theme::cyan() : theme::fault(), &font_mono_10);
    theme::rule_line(parent, 0, 211, 320);
    const bool spectrum_active = radio_service.spectrumStatus().active();
    const bool receive_paused = survey_running && !radio_service.status().receiving;
    const char *footer = spectrum_active ? "SPECTRUM SCANNING" :
        (receive_paused ? "RX PAUSED - ENTER CANCEL" :
         (survey_running ? "ENTER  CANCEL SURVEY" : "ENTER  START 60s SURVEY"));
    put_label(parent, footer, spectrum_active ? 94 :
              (receive_paused ? 68 : (survey_running ? 66 : 54)), 216,
              spectrum_active ? theme::amber() :
                  (survey_running ? theme::amber() : theme::cyan()),
              &font_mono_semibold_12);
    return;
    }
#else
    add_simulator_live_status_bar(parent, "SURVEY");
    const simulator::SurveySnapshot &survey = simulator_live_telemetry.survey();
    const char *state = survey.running ? "CAPTURING" : (survey.complete ? "COMPLETE" : "READY");
    put_label(parent, state, survey.running ? 44 : (survey.complete ? 84 : 118), 47,
              survey.running ? theme::amber() : theme::lime(),
              &font_condensed_bold_28);
    char value[40]{};
    std::snprintf(value, sizeof(value), "%lus / 60s",
                  static_cast<unsigned long>(survey.elapsed_ms / 1000U));
    put_label(parent, value, 241, 88, theme::lime(), &font_mono_semibold_12);

    lv_obj_t * progress = theme::rect(parent, 9, 84, 221, 23, theme::background());
    lv_obj_set_style_border_width(progress, 1, 0);
    lv_obj_set_style_border_color(progress, theme::text_muted(), 0);
    const lv_coord_t fill = static_cast<lv_coord_t>(
        (static_cast<std::uint64_t>(survey.elapsed_ms) * 215ULL) / 60000ULL);
    if(fill > 0) theme::rect(progress, 3, 3, fill, 17, theme::lime());

    std::snprintf(value, sizeof(value), "FRAMES          %lu",
                  static_cast<unsigned long>(survey.frames));
    put_label(parent, value, 10, 121, theme::text(), &font_mono_semibold_12);
    std::snprintf(value, sizeof(value), "SOURCES         %u",
                  static_cast<unsigned>(survey.nodes_heard));
    put_label(parent, value, 10, 143, theme::text(), &font_mono_semibold_12);
    if(survey.frames == 0U) std::snprintf(value, sizeof(value), "BEST SNR        --");
    else std::snprintf(value, sizeof(value), "BEST SNR        %+.1f dB",
                       static_cast<double>(survey.best_snr_db_x10) / 10.0);
    put_label(parent, value, 10, 165, theme::text(), &font_mono_semibold_12);
    std::snprintf(value, sizeof(value), "CRC ERRORS      %lu",
                  static_cast<unsigned long>(survey.crc_invalid_frames));
    put_label(parent, value, 10, 187,
              survey.crc_invalid_frames == 0U ? theme::cyan() : theme::fault(),
              &font_mono_10);
    theme::rule_line(parent, 0, 211, 320);
    const char *footer = simulator_survey_footer();
    put_label(parent, footer, simulator_spectrum_scanning ? 94 : (survey.running ? 66 : 54), 216,
              simulator_spectrum_scanning ? theme::amber() :
                  (survey.running ? theme::amber() : theme::cyan()),
              &font_mono_semibold_12);
#endif
}

#if defined(LILYSHARK_DEVICE)
const char *runtime_event_type_label(RuntimeEventType type) noexcept
{
    switch(type) {
        case RuntimeEventType::System: return "SYSTEM";
        case RuntimeEventType::Radio: return "RADIO";
        case RuntimeEventType::Profile: return "PROFILE";
        case RuntimeEventType::Capture: return "CAPTURE";
        case RuntimeEventType::Storage: return "STORAGE";
        case RuntimeEventType::Spectrum: return "SPECTRUM";
        case RuntimeEventType::Screenshot: return "SCREENSHOT";
        case RuntimeEventType::Survey: return "SURVEY";
        case RuntimeEventType::Hardware: return "HARDWARE";
        case RuntimeEventType::Count: default: return "EVENT";
    }
}

lv_color_t runtime_event_color(RuntimeEventSeverity severity) noexcept
{
    switch(severity) {
        case RuntimeEventSeverity::Success: return theme::lime();
        case RuntimeEventSeverity::Warning: return theme::amber();
        case RuntimeEventSeverity::Error: return theme::fault();
        case RuntimeEventSeverity::Info:
        case RuntimeEventSeverity::Count:
        default: return theme::cyan();
    }
}

void record_runtime_event(RuntimeEventSeverity severity, RuntimeEventType type,
                          const char *message) noexcept
{
    DiagnosticObservation marker{};
    marker.timestamp_ms = static_cast<std::uint32_t>(esp_timer_get_time() / 1000ULL);
    marker.has_frame = false;
    marker.event_marker_count = 1U;
    (void)rolling_diagnostics.ingest(marker);
    const RuntimeEventAppendResult result = runtime_event_history.append(
        static_cast<std::uint64_t>(esp_timer_get_time()), severity, type, message);
    if(result != RuntimeEventAppendResult::Invalid &&
       app_shell.route() == ShellRoute::Analyzer && current_screen == Screen::events &&
       (events_scroll_offset > 0U || event_detail_open)) {
        constexpr std::size_t maximum_visible = 6U;
        const std::size_t maximum_offset = event_detail_open
            ? (runtime_event_history.empty() ? 0U : runtime_event_history.size() - 1U)
            : (runtime_event_history.size() > maximum_visible
                ? runtime_event_history.size() - maximum_visible : 0U);
        events_scroll_offset = events_scroll_offset < maximum_offset
            ? events_scroll_offset + 1U : maximum_offset;
    }
    live_data_dirty = true;
}
#endif

#if !defined(LILYSHARK_DEVICE)
const char *simulator_event_kind_label(simulator::SimulatedEventKind kind) noexcept
{
    switch(kind) {
        case simulator::SimulatedEventKind::NodeAppeared: return "NEW NODE";
        case simulator::SimulatedEventKind::HighUtilization: return "HIGH UTIL";
        case simulator::SimulatedEventKind::NodeSilent: return "NODE LOST";
        case simulator::SimulatedEventKind::Interference: return "STRONG INT";
        case simulator::SimulatedEventKind::TrafficBurst: return "RF BURST";
        case simulator::SimulatedEventKind::CaptureReady: return "CAPTURE";
        case simulator::SimulatedEventKind::SurveyComplete: return "SURVEY";
        default: return "EVENT";
    }
}

lv_color_t simulator_event_color(simulator::SimulatedEventSeverity severity) noexcept
{
    switch(severity) {
        case simulator::SimulatedEventSeverity::Success: return theme::lime();
        case simulator::SimulatedEventSeverity::Warning: return theme::amber();
        case simulator::SimulatedEventSeverity::Error: return theme::fault();
        case simulator::SimulatedEventSeverity::Info:
        default: return theme::cyan();
    }
}

void format_simulator_event_message(char *output, std::size_t capacity,
                                    const simulator::EventSample &event) noexcept
{
    switch(event.kind) {
        case simulator::SimulatedEventKind::NodeAppeared:
            std::snprintf(output, capacity, "%s appeared with SNR %+.1f dB",
                          simulator_node_name(event.node), static_cast<double>(event.value) / 10.0);
            break;
        case simulator::SimulatedEventKind::HighUtilization:
            std::snprintf(output, capacity, "Channel utilization reached %ld%%",
                          static_cast<long>(event.value));
            break;
        case simulator::SimulatedEventKind::NodeSilent:
            std::snprintf(output, capacity, "%s silent for %ld minutes",
                          simulator_node_name(event.node), static_cast<long>(event.value));
            break;
        case simulator::SimulatedEventKind::Interference:
            std::snprintf(output, capacity, "Interference spike near %.3f MHz",
                          static_cast<double>(event.value) / 1000.0);
            break;
        case simulator::SimulatedEventKind::TrafficBurst:
            std::snprintf(output, capacity, "Traffic burst reached %ld packets/min",
                          static_cast<long>(event.value));
            break;
        case simulator::SimulatedEventKind::SurveyComplete:
            std::snprintf(output, capacity, "60-second survey captured %ld frames",
                          static_cast<long>(event.value));
            break;
        case simulator::SimulatedEventKind::CaptureReady:
        default:
            std::snprintf(output, capacity, "Native capture and PCAP writers are ready");
            break;
    }
}
#endif

void build_event_detail(lv_obj_t *parent)
{
    add_status_bar(parent, "EVENT DETAIL");
    const char *time = "--:--";
    const char *kind = "EVENT";
    const char *message = "Event is no longer available.";
    lv_color_t color = theme::text_muted();
    char position[20]{};
#if !defined(LILYSHARK_DEVICE)
    char simulator_time[16]{};
    char simulator_message[112]{};
#endif
#if defined(LILYSHARK_DEVICE)
    const RuntimeEvent *event = runtime_event_history.newest(events_scroll_offset);
    if(event != nullptr) {
        const std::uint64_t uptime_seconds = event->timestamp_us / 1000000ULL;
        static char event_time[16]{};
        std::snprintf(event_time, sizeof(event_time), "%02llu:%02llu:%02llu",
                      static_cast<unsigned long long>((uptime_seconds / 3600ULL) % 100ULL),
                      static_cast<unsigned long long>((uptime_seconds / 60ULL) % 60ULL),
                      static_cast<unsigned long long>(uptime_seconds % 60ULL));
        time = event_time;
        kind = runtime_event_type_label(event->type);
        message = event->message;
        color = runtime_event_color(event->severity);
    }
    std::snprintf(position, sizeof(position), "EVENT %u OF %u",
                  static_cast<unsigned>(events_scroll_offset + 1U),
                  static_cast<unsigned>(runtime_event_history.size()));
#else
    const simulator::EventsSnapshot &events = simulator_live_telemetry.events();
    if(events.size == 0U) events_scroll_offset = 0U;
    else if(events_scroll_offset >= events.size) events_scroll_offset = events.size - 1U;
    const simulator::EventSample *event = events.newest(events_scroll_offset);
    if(event != nullptr) {
        format_simulator_clock(simulator_time, sizeof(simulator_time),
                               event->timestamp_seconds_of_day);
        format_simulator_event_message(simulator_message, sizeof(simulator_message), *event);
        time = simulator_time;
        kind = simulator_event_kind_label(event->kind);
        message = simulator_message;
        color = simulator_event_color(event->severity);
    }
    std::snprintf(position, sizeof(position), "EVENT %u OF %u",
                  static_cast<unsigned>(events_scroll_offset + 1U),
                  static_cast<unsigned>(events.size));
#endif

    put_label(parent, position, 8, 31, theme::pink(), &font_mono_10);
    put_label(parent, time, 8, 55, color, &font_mono_semibold_12);
    put_label(parent, kind, 92, 55, color, &font_condensed_bold_16);
    theme::rule_line(parent, 6, 76, 308, 1, theme::grid());
    lv_obj_t *detail = theme::label(parent, message, theme::text(), &font_mono_semibold_12);
    lv_obj_set_pos(detail, 8, 87);
    lv_obj_set_size(detail, 304, 82);
    lv_label_set_long_mode(detail, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_line_space(detail, 3, 0);
    put_label(parent, "UP / DOWN  OTHER EVENT", 8, 181, theme::text_muted(), &font_mono_10);
    add_action_strip(parent, "BACK", "FULL EVENT MESSAGE", theme::cyan());
}

void build_events(lv_obj_t * parent)
{
    if(event_detail_open) {
        build_event_detail(parent);
        return;
    }
#if defined(LILYSHARK_DEVICE)
    {
    if(runtime_event_history.empty()) {
        add_status_bar(parent, "EVENTS");
        put_centered_label(parent, "NO EVENTS YET", 91, theme::text_muted(),
                           &font_condensed_bold_16);
        put_centered_label(parent, "Hardware and analyzer actions appear here.", 116,
                           theme::text_muted(), &font_mono_10);
        return;
    }

    constexpr std::size_t maximum_visible = 6U;
    const std::size_t maximum_offset = runtime_event_history.size() > maximum_visible
        ? runtime_event_history.size() - maximum_visible : 0U;
    if(events_scroll_offset > maximum_offset) events_scroll_offset = maximum_offset;
    const std::size_t remaining = runtime_event_history.size() - events_scroll_offset;
    const std::size_t visible = remaining < maximum_visible ? remaining : maximum_visible;
    add_status_bar(parent, "EVENTS");
    char range[12]{};
    std::snprintf(range, sizeof(range), "%u-%u/%u",
                  static_cast<unsigned>(events_scroll_offset + 1U),
                  static_cast<unsigned>(events_scroll_offset + visible),
                  static_cast<unsigned>(runtime_event_history.size()));
    lv_obj_t *range_label = theme::label(parent, range, theme::pink(), &font_mono_10);
    lv_obj_align(range_label, LV_ALIGN_TOP_RIGHT, -7, 28);
    for(std::size_t index = 0; index < visible; ++index) {
        const RuntimeEvent *event = runtime_event_history.newest(events_scroll_offset + index);
        if(event == nullptr) continue;
        const std::uint64_t uptime_seconds = event->timestamp_us / 1000000ULL;
        char time[12]{};
        std::snprintf(time, sizeof(time), "%02llu:%02llu",
                      static_cast<unsigned long long>((uptime_seconds / 3600ULL) % 100ULL),
                      static_cast<unsigned long long>((uptime_seconds / 60ULL) % 60ULL));
        const lv_color_t color = runtime_event_color(event->severity);
        const lv_coord_t y = 29 + static_cast<lv_coord_t>(index) * 32;
        if(index == 0U) {
            theme::rect(parent, 0, y - 2, 320, 30, theme::surface_selected());
            theme::rect(parent, 0, y - 2, 3, 30, theme::pink());
        }
        const lv_color_t row_color = index == 0U ? theme::background() : color;
        put_label(parent, time, 7, y, row_color, &font_mono_10);
        put_label(parent, runtime_event_type_label(event->type), 57, y, row_color,
                  &font_mono_semibold_12);
        put_clipped_label(parent, event->message, 7, y + 15, 296,
                          index == 0U ? theme::background() : theme::text(), &font_mono_10);
        if(index == 0U) put_label(parent, ">", 306, y + 14,
                                  theme::background(), &font_mono_10);
        theme::rule_line(parent, 6, y + 28, 308, 1, theme::grid());
    }
    put_label(parent, "UP / DOWN  SCROLL    ENTER  DETAIL", 7, 224,
              theme::text_muted(), &font_mono_10);
    return;
    }
#else
    add_simulator_live_status_bar(parent, "EVENTS");
    const simulator::EventsSnapshot &events = simulator_live_telemetry.events();
    constexpr std::size_t maximum_visible = 6U;
    const std::size_t maximum_offset = events.size > maximum_visible
        ? events.size - maximum_visible : 0U;
    if(events_scroll_offset > maximum_offset) events_scroll_offset = maximum_offset;
    const std::size_t remaining = events.size - events_scroll_offset;
    const std::size_t visible = remaining < maximum_visible ? remaining : maximum_visible;
    char range[16]{};
    std::snprintf(range, sizeof(range), "%u-%u/%u",
                  static_cast<unsigned>(events_scroll_offset + 1U),
                  static_cast<unsigned>(events_scroll_offset + visible),
                  static_cast<unsigned>(events.size));
    lv_obj_t *range_label = theme::label(parent, range, theme::pink(), &font_mono_10);
    lv_obj_align(range_label, LV_ALIGN_TOP_RIGHT, -7, 28);
    for(std::size_t index = 0U; index < visible; ++index) {
        const simulator::EventSample *event = events.newest(events_scroll_offset + index);
        if(event == nullptr) continue;
        const lv_coord_t y = 29 + static_cast<lv_coord_t>(index) * 32;
        const bool selected = index == 0U;
        if(selected) {
            theme::rect(parent, 0, y - 2, 320, 30, theme::surface_selected());
            theme::rect(parent, 0, y - 2, 3, 30, theme::pink());
        }
        const lv_color_t row_color = selected ? theme::background() :
                                                simulator_event_color(event->severity);
        char time[16]{};
        char detail[112]{};
        format_simulator_clock(time, sizeof(time), event->timestamp_seconds_of_day);
        format_simulator_event_message(detail, sizeof(detail), *event);
        put_label(parent, time, 7, y, row_color, &font_mono_10);
        put_label(parent, simulator_event_kind_label(event->kind), 61, y,
                  row_color, &font_mono_semibold_12);
        put_clipped_label(parent, detail, 7, y + 15, 296,
                          selected ? theme::background() : theme::text(), &font_mono_10);
        if(selected) put_label(parent, ">", 306, y + 14,
                               theme::background(), &font_mono_10);
        theme::rule_line(parent, 6, y + 28, 308, 1, theme::grid());
    }
    put_label(parent, "UP / DOWN  SCROLL    ENTER  DETAIL", 7, 224,
              theme::text_muted(), &font_mono_10);
#endif
}

void build_utilization(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, "AIRTIME");
    const auto &store = capture_runtime.frames();
    if(store.empty()) {
        put_label(parent, "NO AIRTIME SAMPLES", 70, 82, theme::text_muted(), &font_condensed_bold_16);
        put_label(parent, "Waiting for received LoRa frames", 69, 108, theme::text_muted(), &font_mono_10);
        return;
    }

    const std::uint64_t now_us = static_cast<std::uint64_t>(esp_timer_get_time());
    const std::uint64_t window_start_us = now_us > 60000000ULL ? now_us - 60000000ULL : 0;
    std::uint64_t airtime_us = 0;
    std::uint32_t frame_count = 0;
    std::uint32_t airtime_sample_count = 0;
    std::uint32_t crc_errors = 0;
    std::uint64_t first_timestamp = now_us;
    for(std::size_t index = 0; index < store.size(); ++index) {
        const FrameRecord *record = store.at(index);
        if(record == nullptr || record->raw.rf.timestamp_us < window_start_us) continue;
        if(record->raw.rf.timestamp_us < first_timestamp) first_timestamp = record->raw.rf.timestamp_us;
        if(record->raw.rf.hasField(RfFieldAirtime)) {
            airtime_us += record->raw.rf.airtime_us;
            ++airtime_sample_count;
        }
        if(record->raw.rf.crc == CrcStatus::Invalid) ++crc_errors;
        ++frame_count;
    }
    std::uint64_t observed_us = now_us > first_timestamp ? now_us - first_timestamp : 1000000ULL;
    if(observed_us < 1000000ULL) observed_us = 1000000ULL;
    std::uint32_t utilization = static_cast<std::uint32_t>((airtime_us * 100ULL) / observed_us);
    if(utilization > 100U) utilization = 100U;
    const std::uint32_t packets_per_minute = static_cast<std::uint32_t>(
        (static_cast<std::uint64_t>(frame_count) * 60000000ULL) / observed_us);
    const std::uint32_t crc_percent = frame_count == 0 ? 0 : (crc_errors * 100U) / frame_count;
    const bool airtime_complete = airtime_sample_count == frame_count;
    const bool airtime_available = frame_count == 0 || airtime_sample_count != 0;

    lv_obj_t *gauge = lv_arc_create(parent);
    lv_obj_set_pos(gauge, 10, 31);
    lv_obj_set_size(gauge, 140, 140);
    lv_arc_set_rotation(gauge, 135);
    lv_arc_set_bg_angles(gauge, 0, 270);
    lv_arc_set_value(gauge, static_cast<std::int32_t>(utilization));
    lv_obj_remove_style(gauge, nullptr, LV_PART_KNOB);
    lv_obj_clear_flag(gauge, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(gauge, 7, LV_PART_MAIN);
    lv_obj_set_style_arc_color(gauge, theme::rule(), LV_PART_MAIN);
    lv_obj_set_style_arc_width(gauge, 7, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(gauge, !airtime_complete ? theme::amber() :
                                      (utilization > 60 ? theme::fault() :
                                       (utilization > 25 ? theme::amber() : theme::lime())),
                               LV_PART_INDICATOR);

    char line[48]{};
    if(airtime_available) {
        std::snprintf(line, sizeof(line), "%lu%%", static_cast<unsigned long>(utilization));
    } else {
        std::snprintf(line, sizeof(line), "--");
    }
    put_label(parent, line, 39, 64, theme::text(), &font_condensed_bold_28);
    if(airtime_complete) {
        put_label(parent, "OBSERVED", 39, 96, theme::text_muted(), &font_mono_10);
        put_label(parent, "AIRTIME", 45, 108, theme::text_muted(), &font_mono_10);
    } else {
        put_label(parent, "PARTIAL", 45, 96, theme::amber(), &font_mono_10);
        std::snprintf(line, sizeof(line), "%lu/%lu TIMED",
                      static_cast<unsigned long>(airtime_sample_count),
                      static_cast<unsigned long>(frame_count));
        put_label(parent, line, 30, 108, theme::amber(), &font_mono_10);
    }
    theme::rule_line(parent, 173, 31, 1, 121);
    put_label(parent, "PACKETS / MIN", 187, 45, theme::text_muted(), &font_condensed_12);
    std::snprintf(line, sizeof(line), "%lu", static_cast<unsigned long>(packets_per_minute));
    put_label(parent, line, 187, 61, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 185, 83, 122);
    put_label(parent, "CRC ERROR RATE", 187, 94, theme::text_muted(), &font_condensed_12);
    std::snprintf(line, sizeof(line), "%lu%%", static_cast<unsigned long>(crc_percent));
    put_label(parent, line, 187, 110, crc_percent == 0 ? theme::cyan() : theme::fault(),
              &font_mono_semibold_12);

    put_label(parent, "RECENT PACKET AIRTIME", 8, 166, theme::text_muted(), &font_mono_10);
    std::uint32_t maximum_airtime = 1;
    const std::size_t visible = store.size() < 22 ? store.size() : 22;
    for(std::size_t index = 0; index < visible; ++index) {
        const FrameRecord *record = store.newest(index);
        if(record != nullptr && record->raw.rf.hasField(RfFieldAirtime) &&
           record->raw.rf.airtime_us > maximum_airtime) {
            maximum_airtime = record->raw.rf.airtime_us;
        }
    }
    for(std::size_t index = 0; index < visible; ++index) {
        const FrameRecord *record = store.newest(visible - 1 - index);
        if(record == nullptr || !record->raw.rf.hasField(RfFieldAirtime)) continue;
        const lv_coord_t bar_height = static_cast<lv_coord_t>(4U +
            (static_cast<std::uint64_t>(record->raw.rf.airtime_us) * 34ULL) / maximum_airtime);
        const lv_color_t color = record->raw.rf.crc == CrcStatus::Invalid ? theme::fault() : theme::lime();
        theme::rect(parent, 42 + static_cast<lv_coord_t>(index) * 12, 211 - bar_height, 8, bar_height, color);
    }
    theme::rule_line(parent, 39, 212, 270);
    put_label(parent, "OLDEST", 39, 216, theme::text_muted(), &font_mono_10);
    put_label(parent, "NEWEST", 268, 216, theme::text_muted(), &font_mono_10);
    return;
    }
#else
    add_simulator_live_status_bar(parent, "AIRTIME");
    const simulator::AirtimeSnapshot &airtime = simulator_live_telemetry.airtime();
    const simulator::ProtocolMixSnapshot &mix = simulator_live_telemetry.protocolMix();
    std::uint32_t crc_failures = 0U;
    for(const std::uint16_t count : mix.crc_failures_last_minute) {
        crc_failures += count;
    }
    const std::uint32_t crc_percent = mix.total_last_minute == 0U ? 0U :
        (crc_failures * 100U) / mix.total_last_minute;
    lv_obj_t * gauge = lv_arc_create(parent);
    lv_obj_set_pos(gauge, 10, 31);
    lv_obj_set_size(gauge, 140, 140);
    lv_arc_set_rotation(gauge, 135);
    lv_arc_set_bg_angles(gauge, 0, 270);
    lv_arc_set_value(gauge, airtime.utilization_percent);
    lv_obj_remove_style(gauge, nullptr, LV_PART_KNOB);
    lv_obj_clear_flag(gauge, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(gauge, 7, LV_PART_MAIN);
    lv_obj_set_style_arc_color(gauge, theme::rule(), LV_PART_MAIN);
    lv_obj_set_style_arc_width(gauge, 7, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(gauge,
        airtime.utilization_percent > 60U ? theme::fault() :
        (airtime.utilization_percent > 35U ? theme::amber() : theme::lime()),
        LV_PART_INDICATOR);

    char metric[24]{};
    std::snprintf(metric, sizeof(metric), "%u%%",
                  static_cast<unsigned>(airtime.utilization_percent));
    put_label(parent, metric, 39, 64, theme::text(), &font_condensed_bold_28);
    put_label(parent, "OBSERVED", 39, 96, theme::text_muted(), &font_mono_10);
    put_label(parent, "AIRTIME", 45, 108, theme::text_muted(), &font_mono_10);
    theme::rule_line(parent, 173, 31, 1, 121);
    put_label(parent, "PACKETS / MIN", 187, 45, theme::text_muted(), &font_condensed_12);
    std::snprintf(metric, sizeof(metric), "%u",
                  static_cast<unsigned>(simulator_live_telemetry.traffic().packets_per_minute));
    put_label(parent, metric, 187, 61, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 185, 83, 122);
    put_label(parent, "CRC ERROR RATE", 187, 94, theme::text_muted(), &font_condensed_12);
    std::snprintf(metric, sizeof(metric), "%u%%", static_cast<unsigned>(crc_percent));
    put_label(parent, metric, 187, 110,
              crc_percent == 0U ? theme::cyan() : theme::fault(), &font_mono_semibold_12);

    put_label(parent, "RECENT PACKET AIRTIME", 8, 166, theme::text_muted(), &font_mono_10);
    std::uint32_t maximum_airtime = 1U;
    for(const std::uint32_t value : airtime.bars_airtime_us) {
        maximum_airtime = std::max(maximum_airtime, value);
    }

    for(std::size_t index = 0U; index < simulator::kAirtimeBarCount; ++index) {
        const lv_coord_t height = static_cast<lv_coord_t>(
            4U + (static_cast<std::uint64_t>(airtime.bars_airtime_us[index]) * 34ULL) /
                     maximum_airtime);
        const lv_color_t color = airtime.bar_crc_invalid[index]
            ? theme::fault() : theme::lime();
        theme::rect(parent, 42 + index * 12, 211 - height, 8, height, color);
    }
    theme::rule_line(parent, 39, 212, 270);
    put_label(parent, "OLDEST", 39, 216, theme::text_muted(), &font_mono_10);
    put_label(parent, "NEWEST", 268, 216, theme::text_muted(), &font_mono_10);
#endif
}

constexpr std::array<const char *, 6> protocol_health_labels = {{
    "MESHTASTIC", "MESHCORE", "RETICULUM", "CUSTOM / APP", "UNKNOWN / RAW", "MALFORMED",
}};

struct ProtocolHealthSnapshot {
    std::array<std::uint32_t, 6> rows{};
    std::array<std::uint32_t, 6> crc_bad_by_row{};
    std::array<std::int16_t, 6> mean_snr_db_x10{};
    std::array<bool, 6> health_metrics_available{};
    std::uint32_t total = 0U;
    std::uint32_t decoded = 0U;
    std::uint32_t crc_bad = 0U;
};

ProtocolHealthSnapshot current_protocol_health() noexcept
{
    ProtocolHealthSnapshot snapshot{};
#if defined(LILYSHARK_DEVICE)
    const DiagnosticCounters &counters = rolling_diagnostics.snapshot().counters;
    const DiagnosticProtocolMetrics meshtastic = counters.protocolMetrics(ProtocolId::Meshtastic);
    const DiagnosticProtocolMetrics meshcore = counters.protocolMetrics(ProtocolId::MeshCore);
    const DiagnosticProtocolMetrics reticulum = counters.protocolMetrics(ProtocolId::Reticulum);
    const DiagnosticProtocolMetrics unknown = counters.protocolMetrics(ProtocolId::Unknown);
    const DiagnosticProtocolMetrics custom = counters.protocolMetrics(ProtocolId::Custom);
    snapshot.rows[0] = static_cast<std::uint32_t>(meshtastic.frames - meshtastic.malformed_frames);
    snapshot.rows[1] = static_cast<std::uint32_t>(meshcore.frames - meshcore.malformed_frames);
    snapshot.rows[2] = static_cast<std::uint32_t>(reticulum.frames - reticulum.malformed_frames);
    snapshot.rows[3] = static_cast<std::uint32_t>(custom.frames - custom.malformed_frames);
    snapshot.rows[4] = static_cast<std::uint32_t>(unknown.frames - unknown.malformed_frames);
    snapshot.rows[5] = static_cast<std::uint32_t>(counters.malformed_frames);
    const std::array<DiagnosticProtocolMetrics, 5> metrics = {{
        meshtastic, meshcore, reticulum, custom, unknown,
    }};
    for(std::size_t index = 0U; index < metrics.size(); ++index) {
        snapshot.crc_bad_by_row[index] = static_cast<std::uint32_t>(
            metrics[index].nonmalformed_crc_invalid_frames);
        snapshot.mean_snr_db_x10[index] = metrics[index].nonmalformedMeanSnrDbX10();
        snapshot.health_metrics_available[index] = snapshot.rows[index] != 0U &&
            metrics[index].hasNonmalformedMeanSnr();
    }
    snapshot.total = static_cast<std::uint32_t>(counters.total_frames);
    snapshot.decoded = snapshot.rows[0] + snapshot.rows[1] + snapshot.rows[2] + snapshot.rows[3];
    snapshot.crc_bad = static_cast<std::uint32_t>(counters.crc_invalid_frames);
#else
    const simulator::ProtocolMixSnapshot &mix = simulator_live_telemetry.protocolMix();
    const auto nonmalformed = [&](simulator::SimulatedProtocol protocol) noexcept {
        const std::size_t index = static_cast<std::size_t>(protocol);
        return static_cast<std::uint32_t>(mix.packets_last_minute[index] -
                                          mix.malformed_by_protocol_last_minute[index]);
    };
    snapshot.rows = {{
        nonmalformed(simulator::SimulatedProtocol::Meshtastic),
        nonmalformed(simulator::SimulatedProtocol::MeshCore),
        nonmalformed(simulator::SimulatedProtocol::Reticulum),
        0U,
        nonmalformed(simulator::SimulatedProtocol::Unknown),
        mix.malformed_last_minute,
    }};
    snapshot.total = mix.total_last_minute;
    // "DECODED" means a protocol decoder classified the frame without a
    // structural error. Header-only/opaque protected bodies still count, just
    // as they do on the device; UNKNOWN/RAW and MALFORMED do not.
    snapshot.decoded = snapshot.rows[0] + snapshot.rows[1] + snapshot.rows[2] +
                       snapshot.rows[3];
    for(const std::uint16_t failures : mix.crc_failures_last_minute) {
        snapshot.crc_bad += failures;
    }
    const auto copy_health = [&](std::size_t row,
                                 simulator::SimulatedProtocol protocol) noexcept {
        const std::size_t index = static_cast<std::size_t>(protocol);
        snapshot.crc_bad_by_row[row] =
            mix.nonmalformed_crc_failures_last_minute[index];
        snapshot.mean_snr_db_x10[row] = mix.nonmalformed_mean_snr_db_x10[index];
        snapshot.health_metrics_available[row] = snapshot.rows[row] != 0U;
    };
    copy_health(0U, simulator::SimulatedProtocol::Meshtastic);
    copy_health(1U, simulator::SimulatedProtocol::MeshCore);
    copy_health(2U, simulator::SimulatedProtocol::Reticulum);
    copy_health(4U, simulator::SimulatedProtocol::Unknown);
#endif
    return snapshot;
}

void build_protocols(lv_obj_t *parent)
{
#if defined(LILYSHARK_DEVICE)
    add_status_bar(parent, "PROTOCOLS", "BAT 100%", "GPS LOCK", "60 SEC");
#else
    add_simulator_live_status_bar(parent, "PROTOCOLS");
#endif
    const ProtocolHealthSnapshot snapshot = current_protocol_health();
    char line[64]{};
    std::snprintf(line, sizeof(line), "%lu FRAMES / 60s",
                  static_cast<unsigned long>(snapshot.total));
    put_label(parent, line, 8, 27, theme::text(), &font_mono_semibold_12);
    const std::uint32_t decoded_percent = snapshot.total == 0U ? 0U :
        (snapshot.decoded * 100U) / snapshot.total;
    std::snprintf(line, sizeof(line), "DECODED %lu%%   CRC BAD %lu",
                  static_cast<unsigned long>(decoded_percent),
                  static_cast<unsigned long>(snapshot.crc_bad));
    put_label(parent, line, 164, 27,
              snapshot.crc_bad == 0U ? theme::cyan() : theme::amber(), &font_mono_10);
    theme::rule_line(parent, 6, 47, 308);

    const std::array<lv_color_t, 6> colors = {{
        theme::lime(), theme::cyan(), theme::pink(), theme::amber(),
        theme::text_muted(), theme::fault(),
    }};
    std::uint32_t largest = 1U;
    for(const std::uint32_t count : snapshot.rows) if(count > largest) largest = count;
    for(std::size_t index = 0; index < protocol_health_labels.size(); ++index) {
        const lv_coord_t y = 51 + static_cast<lv_coord_t>(index) * 26;
        const bool selected = index == protocols_selection;
        if(selected) {
            theme::rect(parent, 3, y - 1, 314, 24, theme::surface_selected());
            theme::rect(parent, 3, y - 1, 3, 24, theme::pink());
        }
        const lv_color_t text_color = selected ? theme::background() : theme::text();
        put_label(parent, protocol_health_labels[index], 9, y + 2, text_color, &font_mono_10);
        theme::rect(parent, 113, y + 4, 102, 10,
                    selected ? theme::rule() : theme::surface());
        const lv_coord_t fill = static_cast<lv_coord_t>(
            (static_cast<std::uint64_t>(snapshot.rows[index]) * 98ULL) / largest);
        if(fill > 0) theme::rect(parent, 115, y + 6, fill, 6,
                                 selected ? theme::background() : colors[index]);
        const std::uint32_t percent = snapshot.total == 0U ? 0U :
            (snapshot.rows[index] * 100U) / snapshot.total;
        std::snprintf(line, sizeof(line), "%3lu  %2lu%%",
                      static_cast<unsigned long>(snapshot.rows[index]),
                      static_cast<unsigned long>(percent));
        put_label(parent, line, 230, y + 2, text_color, &font_mono_10);
        theme::rule_line(parent, 6, y + 23, 308, 1, theme::grid());
    }
    put_label(parent, "UP / DOWN  SELECT   ENTER  DETAIL", 47, 216, theme::cyan(), &font_mono_10);
}

void protocol_detail_activity(std::array<std::uint16_t, 30> &activity) noexcept
{
    const std::size_t selected = protocols_selection % protocol_health_labels.size();
#if defined(LILYSHARK_DEVICE)
    for(std::size_t index = 0U; index < activity.size(); ++index) {
        const std::size_t older_age = (activity.size() - 1U - index) * 2U + 1U;
        std::uint64_t count = 0U;
        for(std::size_t pair = 0U; pair < 2U; ++pair) {
            const DiagnosticBucket *bucket = rolling_diagnostics.newest(older_age - pair);
            if(bucket == nullptr) continue;
            if(selected == 5U) {
                count += bucket->counters.malformed_frames;
                continue;
            }
            const ProtocolId protocol = selected == 0U ? ProtocolId::Meshtastic :
                (selected == 1U ? ProtocolId::MeshCore :
                 (selected == 2U ? ProtocolId::Reticulum :
                  (selected == 3U ? ProtocolId::Custom : ProtocolId::Unknown)));
            const DiagnosticProtocolMetrics metrics = bucket->protocolMetrics(protocol);
            count += metrics.frames - metrics.malformed_frames;
        }
        activity[index] = static_cast<std::uint16_t>(count > 0xffffU ? 0xffffU : count);
    }
#else
    if(selected == 3U) return;
    for(std::size_t index = 0U; index < activity.size(); ++index) {
        const std::size_t older_age = (activity.size() - 1U - index) * 2U + 1U;
        std::uint32_t count = 0U;
        for(std::size_t pair = 0U; pair < 2U; ++pair) {
            if(selected == 5U) {
                count += simulator_live_telemetry.timelineOutcomeFrames(
                    simulator::SimulatedDecodeOutcome::Malformed, older_age - pair);
            } else {
                const simulator::SimulatedProtocol protocol = selected == 0U
                    ? simulator::SimulatedProtocol::Meshtastic
                    : (selected == 1U ? simulator::SimulatedProtocol::MeshCore
                       : (selected == 2U ? simulator::SimulatedProtocol::Reticulum
                          : simulator::SimulatedProtocol::Unknown));
                const simulator::RfTimelineProtocolBucket bucket =
                    simulator_live_telemetry.timelineProtocolBucket(protocol, older_age - pair);
                count += bucket.frames - bucket.malformed_frames;
            }
        }
        activity[index] = static_cast<std::uint16_t>(count);
    }
#endif
}

void build_protocol_detail(lv_obj_t *parent)
{
#if defined(LILYSHARK_DEVICE)
    add_status_bar(parent, "PROTOCOL DETAIL", "BAT 100%", "GPS LOCK", "60 SEC");
#else
    add_simulator_live_status_bar(parent, "PROTOCOL DETAIL");
#endif
    const ProtocolHealthSnapshot snapshot = current_protocol_health();
    const std::size_t selected = protocols_selection % protocol_health_labels.size();
    const std::uint32_t frames = snapshot.rows[selected];
    const std::uint32_t share = snapshot.total == 0U ? 0U :
        (frames * 100U) / snapshot.total;
    const std::uint32_t bad = snapshot.crc_bad_by_row[selected];
    const bool health_available = snapshot.health_metrics_available[selected];
    const std::uint32_t valid = frames == 0U ? 0U :
        ((frames > bad ? frames - bad : 0U) * 100U) / frames;
    char line[64]{};
    put_label(parent, protocol_health_labels[selected], 8, 29, theme::pink(),
              &font_condensed_bold_16);
    std::snprintf(line, sizeof(line), "%lu FRAMES   %lu%% SHARE",
                  static_cast<unsigned long>(frames), static_cast<unsigned long>(share));
    put_label(parent, line, 8, 51, theme::text(), &font_mono_semibold_12);
    if(health_available) {
        std::snprintf(line, sizeof(line), "CRC VALID %lu%%", static_cast<unsigned long>(valid));
    } else {
        std::snprintf(line, sizeof(line), "CRC VALID --");
    }
    put_label(parent, line, 176, 51,
              !health_available ? theme::text_muted() :
              (valid < 90U ? theme::fault() : theme::lime()),
              &font_mono_semibold_12);
    if(health_available) {
        std::snprintf(line, sizeof(line), "MEAN SNR %+.1f dB",
                      static_cast<double>(snapshot.mean_snr_db_x10[selected]) / 10.0);
    } else {
        std::snprintf(line, sizeof(line), "MEAN SNR --");
    }
    put_label(parent, line, 8, 71, theme::cyan(), &font_mono_10);
    put_label(parent, "ACTIVITY / 60 SEC", 8, 92, theme::text_muted(), &font_mono_10);
    add_grid(parent, 7, 107, 306, 68, 50, 22);
    std::array<std::uint16_t, 30> activity{};
    protocol_detail_activity(activity);
    std::uint16_t maximum = 1U;
    for(const std::uint16_t count : activity) if(count > maximum) maximum = count;
    for(std::size_t index = 0U; index < activity.size(); ++index) {
        const lv_coord_t height = static_cast<lv_coord_t>(
            (static_cast<std::uint32_t>(activity[index]) * 56U) / maximum);
        if(height > 0) {
            theme::rect(parent, 12 + static_cast<lv_coord_t>(index) * 10,
                        169 - height, 6, height,
                        selected == 5U ? theme::fault() : theme::lime());
        }
    }
    put_label(parent, "-60s", 8, 177, theme::text_muted(), &font_mono_10);
    put_label(parent, "NOW", 288, 177, theme::text_muted(), &font_mono_10);
    constexpr std::array<const char *, 6> explanations = {{
        "Meshtastic headers, routes, hops, and channel hints.",
        "MeshCore transport, path shape, and protected bodies.",
        "Reticulum headers, contexts, hops, and IFAC markers.",
        "Application decoders such as Lilyshark capture pointers.",
        "Frames preserved as raw bytes without a matching decoder.",
        "Frames that failed structural or integrity validation.",
    }};
    put_clipped_label(parent, explanations[selected], 8, 198, 304,
                      selected == 5U ? theme::fault() : theme::text_muted(), &font_mono_10);
    theme::rule_line(parent, 0, 219, 320);
    put_label(parent, "LEFT/RIGHT CLASS  ENTER FILTER", 8, 224, theme::cyan(), &font_mono_10);
    put_label(parent, "BACK", 286, 224, theme::text_muted(), &font_mono_10);
}

struct TimelineBucketView {
    std::uint16_t frames = 0U;
    std::uint16_t crc_bad = 0U;
    std::int32_t snr_sum_x10 = 0;
    std::uint16_t snr_samples = 0U;
    bool event_marker = false;
};

bool timeline_protocol_matches(ProtocolId protocol) noexcept
{
    switch(timeline_filter_selection) {
        case 1U: return protocol == ProtocolId::Meshtastic;
        case 2U: return protocol == ProtocolId::MeshCore;
        case 3U: return protocol == ProtocolId::Reticulum;
        case 4U: return protocol == ProtocolId::Unknown || protocol == ProtocolId::Custom;
        default: return true;
    }
}

void current_timeline(std::array<TimelineBucketView, 30> &buckets) noexcept
{
#if defined(LILYSHARK_DEVICE)
    for(std::size_t index = 0U; index < buckets.size(); ++index) {
        const std::size_t older_age = (buckets.size() - 1U - index) * 2U + 1U;
        for(std::size_t pair = 0U; pair < 2U; ++pair) {
            const DiagnosticBucket *source = rolling_diagnostics.newest(older_age - pair);
            if(source == nullptr) continue;
            std::uint64_t frames = source->counters.total_frames;
            std::uint64_t crc_bad = source->counters.crc_invalid_frames;
            std::int64_t snr_sum = source->counters.snr_sum_db_x10;
            std::uint64_t snr_samples = source->counters.snr_sample_count;
            if(timeline_filter_selection != 0U) {
                DiagnosticProtocolMetrics metrics{};
                if(timeline_filter_selection == 1U) {
                    metrics = source->protocolMetrics(ProtocolId::Meshtastic);
                } else if(timeline_filter_selection == 2U) {
                    metrics = source->protocolMetrics(ProtocolId::MeshCore);
                } else if(timeline_filter_selection == 3U) {
                    metrics = source->protocolMetrics(ProtocolId::Reticulum);
                } else {
                    const DiagnosticProtocolMetrics unknown =
                        source->protocolMetrics(ProtocolId::Unknown);
                    const DiagnosticProtocolMetrics custom =
                        source->protocolMetrics(ProtocolId::Custom);
                    metrics.frames = unknown.frames + custom.frames;
                    metrics.crc_invalid_frames = unknown.crc_invalid_frames +
                                                 custom.crc_invalid_frames;
                    metrics.snr_sum_db_x10 = unknown.snr_sum_db_x10 + custom.snr_sum_db_x10;
                    metrics.snr_sample_count = unknown.snr_sample_count +
                                               custom.snr_sample_count;
                }
                frames = metrics.frames;
                crc_bad = metrics.crc_invalid_frames;
                snr_sum = metrics.snr_sum_db_x10;
                snr_samples = metrics.snr_sample_count;
            }
            buckets[index].frames = static_cast<std::uint16_t>(
                buckets[index].frames + frames);
            buckets[index].crc_bad = static_cast<std::uint16_t>(
                buckets[index].crc_bad + crc_bad);
            buckets[index].snr_sum_x10 += static_cast<std::int32_t>(snr_sum);
            buckets[index].snr_samples = static_cast<std::uint16_t>(
                buckets[index].snr_samples + snr_samples);
            buckets[index].event_marker = buckets[index].event_marker ||
                                           source->counters.event_marker_count != 0U;
        }
    }
#else
    const simulator::RfTimelineSnapshot &timeline = simulator_live_telemetry.timeline();
    for(std::size_t index = 0U; index < buckets.size(); ++index) {
        const std::size_t older_age = (buckets.size() - 1U - index) * 2U + 1U;
        for(std::size_t pair = 0U; pair < 2U; ++pair) {
            const std::size_t age = older_age - pair;
            const simulator::RfTimelineBucket *sample = timeline.newest(age);
            if(sample == nullptr) continue;
            if(timeline_filter_selection == 0U) {
                buckets[index].frames = static_cast<std::uint16_t>(
                    buckets[index].frames + sample->packets_per_second);
                buckets[index].crc_bad = static_cast<std::uint16_t>(
                    buckets[index].crc_bad + sample->crc_failures);
                buckets[index].snr_sum_x10 += sample->snr_sum_db_x10;
                buckets[index].snr_samples = static_cast<std::uint16_t>(
                    buckets[index].snr_samples + sample->snr_sample_count);
            } else {
                const simulator::SimulatedProtocol protocol =
                    timeline_filter_selection == 1U ? simulator::SimulatedProtocol::Meshtastic :
                    (timeline_filter_selection == 2U ? simulator::SimulatedProtocol::MeshCore :
                     (timeline_filter_selection == 3U ? simulator::SimulatedProtocol::Reticulum :
                                                       simulator::SimulatedProtocol::Unknown));
                const simulator::RfTimelineProtocolBucket filtered =
                    simulator_live_telemetry.timelineProtocolBucket(protocol, age);
                buckets[index].frames = static_cast<std::uint16_t>(
                    buckets[index].frames + filtered.frames);
                buckets[index].crc_bad = static_cast<std::uint16_t>(
                    buckets[index].crc_bad + filtered.crc_failures);
                buckets[index].snr_sum_x10 += filtered.snr_sum_db_x10;
                buckets[index].snr_samples = static_cast<std::uint16_t>(
                    buckets[index].snr_samples + filtered.snr_sample_count);
            }
            buckets[index].event_marker = buckets[index].event_marker ||
                sample->markers != simulator::TimelineMarker::None;
        }
    }
#endif
}

void build_timeline(lv_obj_t *parent)
{
#if defined(LILYSHARK_DEVICE)
    add_status_bar(parent, "TIMELINE", "BAT 100%", "GPS LOCK", "60 SEC");
#else
    add_simulator_live_status_bar(parent, "TIMELINE");
#endif
    constexpr std::array<const char *, 5> filters = {{
        "ALL TRAFFIC", "MESHTASTIC", "MESHCORE", "RETICULUM", "RAW / UNKNOWN",
    }};
    put_label(parent, "FILTER", 8, 27, theme::text_muted(), &font_mono_10);
    put_label(parent, filters[timeline_filter_selection % filters.size()], 52, 27,
              theme::cyan(), &font_mono_semibold_12);
    put_label(parent, "60s", 288, 27, theme::text_muted(), &font_mono_10);
    theme::rule_line(parent, 6, 43, 308);

    std::array<TimelineBucketView, 30> buckets{};
    current_timeline(buckets);
    constexpr lv_coord_t chart_x = 8;
    constexpr lv_coord_t chart_width = 304;
    add_grid(parent, chart_x, 45, chart_width, 127, 50, 42);
    put_label(parent, "PKT", 10, 47, theme::cyan(), &font_mono_10);
    put_label(parent, "SNR", 10, 89, theme::lime(), &font_mono_10);
    put_label(parent, "CRC", 10, 131, theme::fault(), &font_mono_10);
    theme::rule_line(parent, chart_x, 84, chart_width, 1, theme::grid());
    theme::rule_line(parent, chart_x, 126, chart_width, 1, theme::grid());
    theme::rule_line(parent, chart_x, 172, chart_width, 1, theme::rule());

    std::uint16_t max_frames = 1U;
    std::uint32_t total_frames = 0U;
    std::uint32_t total_crc = 0U;
    std::int64_t total_snr = 0;
    std::uint32_t total_snr_samples = 0U;
    for(const TimelineBucketView &bucket : buckets) {
        if(bucket.frames > max_frames) max_frames = bucket.frames;
        total_frames += bucket.frames;
        total_crc += bucket.crc_bad;
        total_snr += bucket.snr_sum_x10;
        total_snr_samples += bucket.snr_samples;
    }
    if(trace_buffer_index < trace_buffers.size()) {
        auto &points = trace_buffers[trace_buffer_index++];
        std::size_t point_count = 0U;
        for(std::size_t index = 0; index < buckets.size(); ++index) {
            const lv_coord_t x = 17 + static_cast<lv_coord_t>(index) * 10;
            const lv_coord_t packet_height = static_cast<lv_coord_t>(
                (static_cast<std::uint32_t>(buckets[index].frames) * 30U) / max_frames);
            if(packet_height > 0) {
                theme::rect(parent, x, 80 - packet_height, 6, packet_height, theme::cyan());
            }
            if(buckets[index].crc_bad > 0U) {
                const lv_coord_t crc_height = static_cast<lv_coord_t>(
                    3U + (buckets[index].crc_bad > 4U ? 20U : buckets[index].crc_bad * 5U));
                theme::rect(parent, x, 168 - crc_height, 6, crc_height, theme::fault());
            }
            if(buckets[index].event_marker) {
                theme::rect(parent, x + 1, 47, 3, 7, theme::amber());
            }
            if(buckets[index].snr_samples > 0U && point_count < points.size()) {
                const std::int32_t mean = buckets[index].snr_sum_x10 /
                                          static_cast<std::int32_t>(buckets[index].snr_samples);
                std::int32_t normalized = mean + 200;
                if(normalized < 0) normalized = 0;
                if(normalized > 200) normalized = 200;
                points[point_count++] = {
                    static_cast<lv_coord_t>(x - chart_x),
                    static_cast<lv_coord_t>(38 - (normalized * 32) / 200),
                };
            }
        }
        if(point_count > 1U) {
            lv_obj_t *snr_line = lv_line_create(parent);
            theme::reset(snr_line);
            lv_line_set_points(snr_line, points.data(), static_cast<std::uint32_t>(point_count));
            lv_obj_set_pos(snr_line, chart_x, 87);
            lv_obj_set_size(snr_line, chart_width, 39);
            lv_obj_set_style_line_color(snr_line, theme::lime(), 0);
            lv_obj_set_style_line_width(snr_line, 1, 0);
        }
    }

    char line[40]{};
    std::snprintf(line, sizeof(line), "RATE %lu/m", static_cast<unsigned long>(total_frames));
    put_label(parent, line, 10, 184, theme::text(), &font_mono_semibold_12);
    const double mean_snr = total_snr_samples == 0U ? 0.0 :
        static_cast<double>(total_snr) / (10.0 * static_cast<double>(total_snr_samples));
    std::snprintf(line, sizeof(line), "MEAN %+.1f dB", mean_snr);
    put_label(parent, line, 111, 184, theme::lime(), &font_mono_semibold_12);
    const std::uint32_t crc_percent = total_frames == 0U ? 0U :
        (total_crc * 100U) / total_frames;
    std::snprintf(line, sizeof(line), "CRC %lu%%", static_cast<unsigned long>(crc_percent));
    put_label(parent, line, 241, 184, crc_percent == 0U ? theme::cyan() : theme::fault(),
              &font_mono_semibold_12);
    put_label(parent, "-60s", 8, 204, theme::text_muted(), &font_mono_10);
    put_label(parent, "NOW", 286, 204, theme::text_muted(), &font_mono_10);
    theme::rule_line(parent, 0, 219, 320);
    put_label(parent, "UP / DOWN  FILTER", 91, 224, theme::cyan(), &font_mono_10);
}

const RadioProfile &shell_active_profile() noexcept
{
#if defined(LILYSHARK_DEVICE)
    return radio_service.activeProfile();
#else
    const std::size_t count = builtinProfileCount();
    return builtinProfiles()[count == 0U ? 0U : simulator_active_profile_index % count];
#endif
}

bool capture_session_active() noexcept
{
#if defined(LILYSHARK_DEVICE)
    return native_capture_recording || pcap_recording;
#else
    return app_settings.capture_enabled;
#endif
}

bool capture_data_recording() noexcept
{
#if defined(LILYSHARK_DEVICE)
    if(app_settings.simulate_mode) return native_capture_recording;
    const bool compatible_pcap = pcap_recording &&
                                 last_pcap_result != PcapWriteResult::InvalidBandwidth;
    return native_capture_recording || compatible_pcap;
#else
    return app_settings.capture_enabled;
#endif
}

const char *capture_summary_value() noexcept
{
#if defined(LILYSHARK_DEVICE)
    if(app_settings.simulate_mode) {
        if(native_capture_recording) return "SIM LSCAP";
        return app_settings.capture_enabled ? "SIM RETRY" : "OFF";
    }
    const bool compatible_pcap = pcap_recording &&
                                 last_pcap_result != PcapWriteResult::InvalidBandwidth;
    if(native_capture_recording && compatible_pcap) return "LSCAP + PCAP";
    if(native_capture_recording) return "LSCAP ONLY";
    if(compatible_pcap) return "PCAP ONLY";
    if(pcap_recording) return "PCAP LIMIT";
    return app_settings.capture_enabled ? "RETRY NEEDED" : "OFF";
#else
    return app_settings.capture_enabled ? "RECORDING" : "OFF";
#endif
}

lv_color_t capture_summary_color() noexcept
{
#if defined(LILYSHARK_DEVICE)
    if(app_settings.simulate_mode) {
        return native_capture_recording ? theme::lime() :
               (app_settings.capture_enabled ? theme::amber() : theme::text_muted());
    }
    const bool compatible_pcap = pcap_recording &&
                                 last_pcap_result != PcapWriteResult::InvalidBandwidth;
    if(native_capture_recording && compatible_pcap) return theme::lime();
    if(native_capture_recording || compatible_pcap || pcap_recording ||
       app_settings.capture_enabled) {
        return theme::amber();
    }
    return theme::text_muted();
#else
    return app_settings.capture_enabled ? theme::lime() : theme::text_muted();
#endif
}

const char *shell_protocol_name(ProtocolId protocol) noexcept
{
    switch(protocol) {
        case ProtocolId::Meshtastic: return "MESHTASTIC";
        case ProtocolId::MeshCore: return "MESHCORE";
        case ProtocolId::Reticulum: return "RETICULUM / RNODE";
        case ProtocolId::Custom: return "OTHER LORA";
        case ProtocolId::Unknown: default: return "RAW LORA";
    }
}

std::size_t onboarding_profile_count() noexcept
{
    switch(onboarding_network_selection) {
        case 0: return 1;
        case 1: return 2;
        case 2: return 2;
        default: return builtinProfileCount();
    }
}

std::size_t onboarding_profile_index(std::size_t selection) noexcept
{
    constexpr std::array<std::size_t, 1> meshtastic = {{0}};
    constexpr std::array<std::size_t, 2> meshcore = {{1, 2}};
    constexpr std::array<std::size_t, 2> reticulum = {{4, 3}};
    switch(onboarding_network_selection) {
        case 0: return meshtastic[selection % meshtastic.size()];
        case 1: return meshcore[selection % meshcore.size()];
        case 2: return reticulum[selection % reticulum.size()];
        default: {
            const std::size_t count = builtinProfileCount();
            return count == 0U ? 0U : selection % count;
        }
    }
}

void build_splash(lv_obj_t * parent)
{
    add_wordmark(parent, 28, 42);
    put_centered_label(parent, "LORA FIELD DIAGNOSTICS", 176, theme::text(),
                       &font_condensed_bold_16);
    put_centered_label(parent, startup_services_complete ? "READY" : "STARTING HARDWARE",
                       201, startup_services_complete ? theme::lime() : theme::text_muted(),
                       &font_mono_10);
    put_centered_label(parent, firmware_version, 220, theme::text_muted(), &font_mono_10);
}

void build_onboarding_welcome(lv_obj_t * parent)
{
    add_shell_header(parent, "FIRST RUN", "1 / 6");
    add_scaled_wordmark(parent, 70, 29, 180);
    put_centered_label(parent, "LORA FIELD DIAGNOSTICS", 122, theme::text(),
                       &font_condensed_bold_16);
    put_centered_label(parent, "Inspect packets, spectrum, nodes, routes,", 151,
                       theme::text_muted(), &font_mono_10);
    put_centered_label(parent, "airtime, and capture files on one T-Deck.", 166,
                       theme::text_muted(), &font_mono_10);
    add_action_strip(parent, "?  CONTROLS", "ENTER  CONTINUE");
}

void build_onboarding_capabilities(lv_obj_t * parent)
{
    add_shell_header(parent, "WHAT LILYSHARK DOES", "2 / 6");
    put_label(parent, "A FIELD INSTRUMENT, NOT ANOTHER CHAT CLIENT", 8, 28,
              theme::text_muted(), &font_mono_10);
    struct CapabilityRow {
        const char *label;
        const char *value;
        lv_color_t color;
    };
    const std::array<CapabilityRow, 4> rows = {{
        {"PACKETS", "PROTOCOL / ROUTE / RAW BYTES", theme::lime()},
        {"RADIO", "SPECTRUM / SNR / AIRTIME", theme::cyan()},
        {"NETWORK", "NODES / HEALTH / TIMELINE", theme::pink()},
        {"CAPTURE", "LSCAP / WIRESHARK PCAP", theme::amber()},
    }};
    for(std::size_t index = 0; index < rows.size(); ++index) {
        const lv_coord_t y = 48 + static_cast<lv_coord_t>(index) * 36;
        theme::rect(parent, 6, y, 308, 31, theme::surface());
        theme::rect(parent, 6, y, 3, 31, rows[index].color);
        put_label(parent, rows[index].label, 15, y + 5, rows[index].color,
                  &font_mono_semibold_12);
        put_label(parent, rows[index].value, 91, y + 7, theme::text(), &font_mono_10);
    }
    put_centered_label(parent, "One T-Deck is enough to inspect nearby traffic.", 194,
                       theme::text_muted(), &font_mono_10);
    add_action_strip(parent, "BACK", "ENTER  CONTINUE");
}

void build_onboarding_network(lv_obj_t * parent)
{
    add_shell_header(parent, "CHOOSE NETWORK", "3 / 6");
    put_label(parent, "WHAT WILL YOU INSPECT FIRST?", 8, 30, theme::text_muted(),
              &font_mono_10);
    constexpr std::array<const char *, 4> choices = {{
        "MESHTASTIC", "MESHCORE", "RETICULUM / RNODE", "BROWSE ALL PRESETS",
    }};
    for(std::size_t index = 0; index < choices.size(); ++index) {
        add_shell_list_row(parent, 48 + static_cast<lv_coord_t>(index) * 36, 36,
                           choices[index], index < 3 ? "DECODER READY" : "",
                           index == onboarding_network_selection,
                           index < 3 ? theme::lime() : theme::text_muted());
    }
    add_action_strip(parent, "BACK", "ENTER  SELECT");
}

void build_onboarding_profile(lv_obj_t * parent)
{
    add_shell_header(parent, "RADIO PROFILE", "4 / 6");
    const std::size_t count = onboarding_profile_count();
    const std::size_t profile_index = onboarding_profile_index(onboarding_profile_selection);
    const RadioProfile &profile = builtinProfiles()[profile_index];
    char line[64]{};
    put_centered_label(parent, shell_protocol_name(profile.protocol_hint), 33,
                       theme::pink(), &font_mono_10);
    put_centered_label(parent, profile.name, 53, theme::text(), &font_condensed_bold_16);
    std::snprintf(line, sizeof(line), "%.3f MHz   BW %.1f kHz",
                  static_cast<double>(profile.center_frequency_hz) / 1000000.0,
                  static_cast<double>(profile.bandwidth_hz) / 1000.0);
    put_centered_label(parent, line, 83, theme::cyan(), &font_mono_semibold_12);
    std::snprintf(line, sizeof(line), "SF%u   CR 4/%u   SYNC 0x%04X",
                  profile.spreading_factor, profile.coding_rate_denominator,
                  profile.sync_word);
    put_centered_label(parent, line, 105, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 24, 132, 272);
    std::snprintf(line, sizeof(line), "PRESET %lu OF %lu   UP / DOWN TO CHOOSE",
                  static_cast<unsigned long>(onboarding_profile_selection + 1U),
                  static_cast<unsigned long>(count));
    put_centered_label(parent, line, 146, theme::text_muted(), &font_mono_10);
    const bool profile_failed = std::strstr(shell_notice, "FAILED") != nullptr;
    if(profile_failed) {
        put_centered_label(parent, shell_notice, 169, theme::fault(), &font_mono_10);
        put_centered_label(parent, "Choose again or press Enter to retry.", 184,
                           theme::text_muted(), &font_mono_10);
    } else {
        put_centered_label(parent, "Match this profile to the nearby network", 169,
                           theme::text_muted(), &font_mono_10);
        put_centered_label(parent, "and the radio rules where you operate.", 184,
                           theme::text_muted(), &font_mono_10);
    }
    add_action_strip(parent, "BACK", profile_failed ? "ENTER  RETRY" : "ENTER  APPLY",
                     profile_failed ? theme::fault() : theme::cyan());
}

void build_onboarding_controls(lv_obj_t * parent)
{
    add_shell_header(parent, "FIELD CONTROLS", "5 / 6");
    put_centered_label(parent, "TRACKBALL", 31, theme::pink(), &font_mono_semibold_12);
    constexpr std::array<std::array<const char *, 2>, 4> rows = {{
        {{"LEFT / RIGHT", "CHANGE LIVE VIEW"}},
        {{"UP / DOWN", "SELECT / SCROLL"}},
        {{"PRESS", "OPEN / RUN TOOL"}},
        {{"BACKSPACE", "BACK / CANCEL"}},
    }};
    for(std::size_t index = 0; index < rows.size(); ++index) {
        const lv_coord_t y = 51 + static_cast<lv_coord_t>(index) * 25;
        put_label(parent, rows[index][0], 14, y, theme::text(), &font_mono_10);
        lv_obj_t *value = theme::label(parent, rows[index][1], theme::cyan(), &font_mono_10);
        lv_obj_align_to(value, parent, LV_ALIGN_TOP_RIGHT, -14, y);
        theme::rule_line(parent, 10, y + 19, 300, 1, theme::grid());
    }
    put_label(parent, "M", 16, 158, theme::lime(), &font_mono_semibold_12);
    put_label(parent, "HOME", 38, 159, theme::text_muted(), &font_mono_10);
    put_label(parent, "P", 91, 158, theme::lime(), &font_mono_semibold_12);
    put_label(parent, "PROFILE", 113, 159, theme::text_muted(), &font_mono_10);
    put_label(parent, "S", 185, 158, theme::lime(), &font_mono_semibold_12);
#if defined(LILYSHARK_DEVICE)
    put_label(parent, "SCREENSHOT", 207, 159, theme::text_muted(), &font_mono_10);
#else
    put_label(parent, "DEVICE SHOT", 207, 159, theme::text_muted(), &font_mono_10);
#endif
    put_centered_label(parent, "Capture continues while you inspect the UI.", 187,
                       theme::text_muted(), &font_mono_10);
    add_action_strip(parent, "BACK", "ENTER  DEVICE CHECK");
}

void build_onboarding_readiness(lv_obj_t * parent)
{
    add_shell_header(parent, "DEVICE CHECK", "6 / 6");
    const RadioProfile &profile = shell_active_profile();
    struct StatusRow { const char *label; const char *value; lv_color_t color; };
#if defined(LILYSHARK_DEVICE)
    const RadioStatus &radio = radio_service.status();
    const HardwareStatusSnapshot &hardware = hardware_status.snapshot();
    const bool touch_ready = touch_input_ready();
    const char *input_state = keyboard_ready
        ? (touch_ready ? "KB / BALL / TOUCH" : "KB / BALL")
        : (touch_ready ? "BALL / TOUCH" : "BALL ONLY");
    const char *sd_state = sd_io_error ? "I/O ERROR" : (sd_mounted ? "READY" : "NO CARD");
    const char *gps_state = hardware.gps.state == GpsState::Fix ? "FIX" :
                            (hardware.gps.state == GpsState::Searching ? "SEARCHING" : "OPTIONAL / N/A");
    const char *radio_state = app_settings.simulate_mode ? "SIMULATED" :
                              (radio.receiving ? "LISTENING" :
                               (radio.initialized ? "RECOVERING" : "OFFLINE"));
    const char *capture_state = capture_summary_value();
    const std::array<StatusRow, 6> rows = {{
        {"PROFILE", profile.name, theme::cyan()},
        {"INPUT", input_state, keyboard_ready ? theme::lime() : theme::amber()},
        {"MICROSD", sd_state, sd_mounted && !sd_io_error ? theme::lime() : theme::amber()},
        {"GPS", gps_state, hardware.gps.state == GpsState::Fix ? theme::lime() : theme::text_muted()},
        {"RADIO", radio_state, app_settings.simulate_mode ? theme::amber() :
                                (radio.receiving ? theme::lime() : theme::fault())},
        {"CAPTURE", capture_state, capture_summary_color()},
    }};
#else
    const std::array<StatusRow, 6> rows = {{
        {"PROFILE", profile.name, theme::cyan()},
        {"INPUT", "KB / BALL / TOUCH", theme::lime()},
        {"MICROSD", "READY", theme::lime()},
        {"GPS", app_settings.gps_enabled ? "SIMULATED FIX" : "OFF",
         app_settings.gps_enabled ? theme::lime() : theme::text_muted()},
        {"RADIO", "LISTENING", theme::lime()},
        {"CAPTURE", "RECORDING", theme::lime()},
    }};
#endif
    for(std::size_t index = 0; index < rows.size(); ++index) {
        const lv_coord_t y = 28 + static_cast<lv_coord_t>(index) * 27;
        put_label(parent, rows[index].label, 8, y, theme::text_muted(), &font_mono_10);
        lv_obj_t * value = theme::label(parent, rows[index].value, rows[index].color,
                                        &font_mono_semibold_12);
        lv_obj_align_to(value, parent, LV_ALIGN_TOP_RIGHT, -8, y);
        theme::rule_line(parent, 6, y + 21, 308, 1, theme::grid());
    }
    put_centered_label(parent,
                       onboarding_save_failed
                           ? "SETTINGS SAVE FAILED - ENTER TO RETRY"
                           : "Optional hardware can stay unavailable.",
                       190, onboarding_save_failed ? theme::fault() : theme::text_muted(),
                       &font_mono_10);
    add_action_strip(parent, "BACK",
                     onboarding_save_failed ? "ENTER  RETRY SAVE"
                                            : "ENTER  START LILYSHARK",
                     onboarding_save_failed ? theme::fault() : theme::cyan());
}

void build_home(lv_obj_t * parent)
{
    add_status_bar(parent, "HOME", "BAT 100%",
                   app_settings.gps_enabled ? "GPS SIM" : "GPS OFF", "CAP REC");
    add_scaled_wordmark(parent, 8, 27, 94);
    const RadioProfile &profile = shell_active_profile();
    char line[48]{};
#if defined(LILYSHARK_DEVICE)
    put_label(parent, app_settings.simulate_mode ? "SIMULATED TRAFFIC" :
                  (radio_service.status().receiving ? "LISTENING" : "RADIO OFFLINE"), 112, 29,
              app_settings.simulate_mode ? theme::amber() :
                  (radio_service.status().receiving ? theme::lime() : theme::fault()),
              &font_mono_semibold_12);
#else
    put_label(parent, "LISTENING", 112, 29, theme::lime(), &font_mono_semibold_12);
#endif
    put_label(parent, profile.name, 112, 46, theme::text(), &font_mono_10);
    std::snprintf(line, sizeof(line), "%.3f MHz  BW %.1fk",
                  static_cast<double>(profile.center_frequency_hz) / 1000000.0,
                  static_cast<double>(profile.bandwidth_hz) / 1000.0);
    put_label(parent, line, 112, 60, theme::text_muted(), &font_mono_10);
    theme::rule_line(parent, 0, 78, 320);

    constexpr std::array<const char *, 10> labels = {{
        "1  TRAFFIC", "2  SPECTRUM", "3  NODES", "4  MAP",
        "5  SURVEY", "6  AIRTIME", "7  EVENTS", "8  SETTINGS",
        "9  PROTOCOLS", "T  TIMELINE",
    }};
    const std::size_t selected = static_cast<std::size_t>(app_shell.homeSelection());
    for(std::size_t index = 0; index < labels.size(); ++index) {
        const lv_coord_t column = static_cast<lv_coord_t>(index % 2U);
        const lv_coord_t row = static_cast<lv_coord_t>(index / 2U);
        const lv_coord_t x = column * 160;
        const lv_coord_t y = 79 + row * 32;
        const bool focused = index == selected;
        if(focused) {
            theme::rect(parent, x, y, 160, 32, theme::surface_selected());
            theme::rect(parent, x, y, 3, 32, theme::pink());
        }
        put_label(parent, labels[index], x + 9, y + 9,
                  focused ? theme::background() : theme::text(), &font_mono_semibold_12);
        theme::rule_line(parent, x, y + 31, 160, 1, theme::grid());
        if(column == 0) theme::rule_line(parent, 159, y, 1, 32, theme::grid());
    }
}

void build_radio_profiles(lv_obj_t * parent)
{
    add_shell_header(parent, "RADIO PROFILE");
    const std::size_t selected = app_shell.profileSelection();
    const std::size_t count = builtinProfileCount();
    const RadioProfile &active = shell_active_profile();
    for(std::size_t index = 0; index < count; ++index) {
        const RadioProfile &profile = builtinProfiles()[index];
        char value[42]{};
        std::snprintf(value, sizeof(value), "%.3f / %.1fk / SF%u",
                      static_cast<double>(profile.center_frequency_hz) / 1000000.0,
                      static_cast<double>(profile.bandwidth_hz) / 1000.0,
                      profile.spreading_factor);
        const bool is_active = profile.id == active.id;
        char label[32]{};
        std::snprintf(label, sizeof(label), "%c %s", is_active ? '*' : ' ', profile.name);
        add_shell_list_row(parent, 24 + static_cast<lv_coord_t>(index) * 34, 34,
                           label, value, index == selected,
                           is_active ? theme::lime() : theme::text_muted());
    }
    const bool profile_failed = std::strstr(shell_notice, "FAILED") != nullptr;
    add_action_strip(parent, "BACK",
                     shell_notice[0] != '\0' ? shell_notice : "ENTER  APPLY PROFILE",
                     profile_failed ? theme::fault() :
                     (shell_notice[0] != '\0' ? theme::lime() : theme::cyan()));
}

void build_settings(lv_obj_t * parent)
{
    add_shell_header(parent, "SETTINGS");
    constexpr std::array<const char *, 7> labels = {{
        "RADIO PROFILE", "CAPTURE & STORAGE", "DEVICE STATUS", "DISPLAY & INPUT",
        "HELP", "ABOUT LILYSHARK", "RUN SETUP AGAIN",
    }};
    const std::size_t selected = static_cast<std::size_t>(app_shell.settingsSelection());
    for(std::size_t index = 0; index < labels.size(); ++index) {
        const char *value = "ENTER";
        if(index == 0) value = shell_active_profile().name;
#if defined(LILYSHARK_DEVICE)
        else if(index == 1) value = capture_summary_value();
        else if(index == 2) value = app_settings.simulate_mode ? "SIM" :
                                    (radio_service.status().receiving ? "READY" : "CHECK");
#else
        else if(index == 1) value = capture_summary_value();
        else if(index == 2) value = "READY";
#endif
        add_shell_list_row(parent, 23 + static_cast<lv_coord_t>(index) * 25, 25,
                           labels[index], value, index == selected,
                           index == 6 ? theme::amber() : theme::text_muted());
    }
    add_action_strip(parent, "BACK", "ENTER  OPEN");
}

void build_storage(lv_obj_t * parent)
{
    add_shell_header(parent, "CAPTURE & STORAGE");
#if defined(LILYSHARK_DEVICE)
    const char *sd_value = sd_io_error ? "I/O ERROR" : (sd_mounted ? "READY" : "NO CARD");
    const char *native_value = app_settings.simulate_mode
        ? (native_capture_recording ? "SIM RECORDING" : "OFF")
        : (native_capture_recording ? "RECORDING" : "OFF");
    const bool pcap_limit = last_pcap_result == PcapWriteResult::InvalidBandwidth;
    const char *pcap_value = app_settings.simulate_mode
        ? (pcap_recording ? "SKIPS SIM" : "OFF") :
                             (pcap_limit ? "UNSUPPORTED BW" :
                              (pcap_recording ? "RECORDING" : "OFF"));
    const lv_color_t native_color = native_capture_recording ? theme::lime() : theme::amber();
#else
    const char *sd_value = "READY";
    const char *native_value = app_settings.capture_enabled ? "RECORDING" : "OFF";
    const char *pcap_value = app_settings.capture_enabled ? "RECORDING" : "OFF";
    const lv_color_t native_color = app_settings.capture_enabled
        ? theme::lime() : theme::amber();
#endif
    const bool capture_active = capture_data_recording();
    const bool capture_open = capture_session_active();
#if defined(LILYSHARK_DEVICE)
    const bool capture_action_active = app_settings.simulate_mode
        ? native_capture_recording : capture_open;
    const char *mode_value = app_settings.simulate_mode
        ? (native_capture_recording ? "SYNTHETIC" :
           (app_settings.capture_enabled ? "RETRY NEEDED" : "OFF")) :
                             (capture_active ? "RECORDING" :
                             (capture_open ? "NOT RECORDING" :
                              (app_settings.capture_enabled ? "RETRY NEEDED" : "OFF")));
#else
    const bool capture_action_active = capture_open;
    const char *mode_value = capture_active ? "RECORDING" :
                             (capture_open ? "NOT RECORDING" :
                              (app_settings.capture_enabled ? "RETRY NEEDED" : "OFF"));
#endif
    struct Row { const char *label; const char *value; lv_color_t color; bool selected; };
    const std::array<Row, 4> rows = {{
        {"CAPTURE MODE", mode_value,
         capture_active ? theme::lime() :
         (app_settings.capture_enabled ? theme::amber() : theme::text_muted()), true},
        {"MICROSD", sd_value, std::strcmp(sd_value, "READY") == 0 ? theme::lime() : theme::amber()},
        {"LILYSHARK CAPTURE", native_value, native_color, false},
        {"WIRESHARK PCAP", pcap_value,
         std::strcmp(pcap_value, "RECORDING") == 0 ? theme::lime() : theme::amber(), false},
    }};
    for(std::size_t index = 0; index < rows.size(); ++index) {
        add_shell_list_row(parent, 24 + static_cast<lv_coord_t>(index) * 30, 30,
                           rows[index].label, rows[index].value, rows[index].selected,
                           rows[index].color);
    }
#if defined(LILYSHARK_DEVICE)
    put_label(parent, "LSCAP", 8, 148, theme::text_muted(), &font_mono_10);
    put_label(parent, native_capture_recording && native_capture_path[0]
                  ? native_capture_path : "No active Lilyshark capture file",
              51, 148, theme::text(), &font_mono_10);
    put_label(parent, "PCAP", 8, 164, theme::text_muted(), &font_mono_10);
    put_label(parent, app_settings.simulate_mode
                  ? (pcap_recording ? "Header only - synthetic frames excluded"
                                    : "No active Wireshark capture file")
                  : (pcap_recording && pcap_path[0]
                         ? pcap_path : "No active Wireshark capture file"),
              51, 164, theme::text(), &font_mono_10);
#else
    put_label(parent, app_settings.capture_enabled
                          ? "LSCAP  /lilyshark/capture-0001.lscap" : "LSCAP  No active file",
              8, 148, theme::text(), &font_mono_10);
    put_label(parent, app_settings.capture_enabled
                          ? "PCAP   /lilyshark/capture-0001.pcap" : "PCAP   No active file",
              8, 164, theme::text(), &font_mono_10);
#endif
    const char *capture_note = "LSCAP keeps full RF metadata at every bandwidth.";
    if(app_settings.simulate_mode) {
#if defined(LILYSHARK_DEVICE)
        capture_note = native_capture_recording
            ? "LSCAP marks simulation; PCAP remains OTA-only."
            : (app_settings.capture_enabled
                   ? "LSCAP unavailable; PCAP cannot store simulation."
                   : "Capture is off; analysis stays in memory.");
#else
        capture_note = app_settings.capture_enabled
            ? "LSCAP marks simulation; PCAP remains OTA-only."
            : "Capture is off; analysis stays in memory.";
#endif
    }
    put_label(parent, capture_note, 8, 183,
              theme::text_muted(), &font_mono_10);
    const char *capture_action = capture_action_active ? "ENTER  STOP CAPTURE" :
                                  (app_settings.capture_enabled ? "ENTER  RETRY CAPTURE"
                                                                : "ENTER  START CAPTURE");
#if defined(LILYSHARK_DEVICE)
    constexpr const char *screenshot_action = "S  SCREENSHOT";
#else
    constexpr const char *screenshot_action = "S  DEVICE SHOT";
#endif
    add_action_strip(parent, screenshot_action,
                     capture_settings_save_failed ? "SAVE FAILED - ENTER RETRY" : capture_action,
                     capture_settings_save_failed ? theme::fault() :
                     (capture_open ? theme::amber() : theme::cyan()));
}

void build_device_status(lv_obj_t * parent)
{
    add_shell_header(parent, "DEVICE STATUS");
    struct Row { const char *label; const char *value; lv_color_t color; };
#if defined(LILYSHARK_DEVICE)
    const HardwareStatusSnapshot &hardware = hardware_status.snapshot();
    const RadioStatus &radio = radio_service.status();
    char uptime[24]{};
    std::snprintf(uptime, sizeof(uptime), "%lu s", static_cast<unsigned long>(millis() / 1000U));
    const bool touch_ready = touch_input_ready();
    const char *input_state = keyboard_ready
        ? (touch_ready ? "KB / BALL / TOUCH" : "KB / BALL")
        : (touch_ready ? "BALL / TOUCH" : "BALL ONLY");
    const std::array<Row, 7> rows = {{
        {"SX1262", app_settings.simulate_mode ? "PAUSED / SIM" :
                    (radio.receiving ? "LISTENING" :
                     (radio.initialized ? "RECOVERING" : "OFFLINE")),
         app_settings.simulate_mode ? theme::amber() :
             (radio.receiving ? theme::lime() : theme::fault())},
        {"MICROSD", sd_io_error ? "I/O ERROR" : (sd_mounted ? "READY" : "NOT FOUND"),
         sd_mounted && !sd_io_error ? theme::lime() : theme::amber()},
        {"PSRAM SPECTRUM", spectrum_buffer != nullptr ? "READY" : "UNAVAILABLE",
         spectrum_buffer != nullptr ? theme::lime() : theme::amber()},
        {"INPUT", input_state, keyboard_ready ? theme::lime() : theme::amber()},
        {"GPS", hardware.gps_label, hardware.gps.state == GpsState::Fix ? theme::lime() : theme::text_muted()},
        {"BATTERY", hardware.battery_label, theme::text()},
        {"UPTIME", uptime, theme::text()},
    }};
#else
    const std::array<Row, 7> rows = {{
        {"SX1262", "LISTENING", theme::lime()}, {"MICROSD", "READY", theme::lime()},
        {"PSRAM SPECTRUM", "READY", theme::lime()}, {"TOUCH", "READY", theme::lime()},
        {"GPS", app_settings.gps_enabled ? "SIMULATED FIX" : "GPS OFF",
         app_settings.gps_enabled ? theme::lime() : theme::text_muted()},
        {"BATTERY", "BAT 100%", theme::text()},
        {"UPTIME", "142 s", theme::text()},
    }};
#endif
    for(std::size_t index = 0; index < rows.size(); ++index) {
        add_shell_list_row(parent, 23 + static_cast<lv_coord_t>(index) * 25, 25,
                           rows[index].label, rows[index].value, false, rows[index].color);
    }
#if defined(LILYSHARK_DEVICE)
    add_action_strip(parent, "BACK",
                     app_settings.simulate_mode ? "SIM MODE / RADIO PAUSED" :
                     (radio_service.status().receiving ? "STATUS UPDATES LIVE"
                                                       : "ENTER  RETRY RADIO"),
                     app_settings.simulate_mode ? theme::amber() :
                     (radio_service.status().receiving ? theme::text_muted() : theme::amber()));
#else
    add_action_strip(parent, "BACK", "STATUS UPDATES LIVE", theme::text_muted());
#endif
}

void build_display_input(lv_obj_t * parent)
{
    add_shell_header(parent, "DISPLAY & INPUT");
    char display_value[16]{};
    char keyboard_value[16]{};
    std::snprintf(display_value, sizeof(display_value), "%u / 16", app_settings.display_brightness);
    std::snprintf(keyboard_value, sizeof(keyboard_value), "%u / 255", app_settings.keyboard_brightness);
#if defined(LILYSHARK_DEVICE)
    const bool touch_ready = touch_input_ready();
    const char *touch_value = touch_ready ? "READY" :
                              (touch_service.present() ? "I2C ERROR" : "NOT FOUND");
    const char *input_value = keyboard_ready
        ? (touch_ready ? "KB / BALL / TOUCH" : "KB / BALL")
        : (touch_ready ? "BALL / TOUCH" : "BALL ONLY");
#else
    const char *touch_value = "READY";
    const char *input_value = "KB / BALL / TOUCH";
#endif
    add_shell_list_row(parent, 27, 28, "DISPLAY BRIGHTNESS", display_value,
                       display_input_selection == 0, theme::cyan());
    add_shell_list_row(parent, 55, 28, "KEYBOARD LIGHT", keyboard_value,
                       display_input_selection == 1, theme::cyan());
    add_shell_list_row(parent, 83, 28, "OPTIONAL GPS",
                       app_settings.gps_enabled ? "ENABLED" : "OFF",
                       display_input_selection == 2,
                       app_settings.gps_enabled ? theme::lime() : theme::text_muted());
    add_shell_list_row(parent, 111, 28, "STARTUP VIEW",
                       app_settings.resume_last_view ? "LAST LIVE VIEW" : "HOME",
                       display_input_selection == 3, theme::cyan());
    add_shell_list_row(parent, 139, 28, "SIMULATE MODE",
                       app_settings.simulate_mode ? "ON - SYNTHETIC" : "OFF",
                       display_input_selection == 4,
                       app_settings.simulate_mode ? theme::amber() : theme::text_muted());
    add_shell_list_row(parent, 167, 28, "INPUTS",
                       input_value,
                       false,
                       std::strcmp(touch_value, "READY") == 0 &&
                           std::strstr(input_value, "KB") != nullptr
                           ? theme::lime() : theme::amber());
    add_action_strip(parent, "BACK",
                     display_settings_save_failed ? "SAVE FAILED - VALUE RESTORED"
                                                  : "ARROWS  SELECT / ADJUST",
                     display_settings_save_failed ? theme::fault() : theme::cyan());
}

void build_help(lv_obj_t * parent)
{
    add_shell_header(parent, "CONTROLS", "HELP");
#if defined(LILYSHARK_DEVICE)
    constexpr const char *screenshot_help = "SCREENSHOT";
#else
    constexpr const char *screenshot_help = "DEVICE SCREENSHOT";
#endif
    constexpr std::array<std::array<const char *, 2>, 9> rows = {{
        {{"BALL LEFT / RIGHT", "CHANGE VIEW"}},
        {{"BALL UP / DOWN", "SELECT / SCROLL"}},
        {{"BALL PRESS", "OPEN / RUN"}},
        {{"BACKSPACE", "BACK"}},
        {{"M OR 0", "HOME"}},
        {{"P", "RADIO PROFILES"}},
        {{"S", screenshot_help}},
        {{"?", "HELP"}},
        {{"1-7 / 9 / T", "OPEN LIVE VIEW"}},
    }};
    for(std::size_t index = 0; index < rows.size(); ++index) {
        const lv_coord_t y = 28 + static_cast<lv_coord_t>(index) * 19;
        put_label(parent, rows[index][0], 8, y, theme::text(), &font_mono_10);
        lv_obj_t * value = theme::label(parent, rows[index][1], theme::cyan(), &font_mono_10);
        lv_obj_align_to(value, parent, LV_ALIGN_TOP_RIGHT, -8, y);
    }
    add_action_strip(parent, "BACK", "RIGHT  ABOUT");
}

void build_about(lv_obj_t * parent)
{
    add_shell_header(parent, "ABOUT", "LILYSHARK");
    add_scaled_wordmark(parent, 82, 31, 156);
    put_centered_label(parent, "LORA FIELD DIAGNOSTICS FOR T-DECK", 101,
                       theme::text(), &font_condensed_bold_16);
    put_label(parent, "FIRMWARE", 34, 132, theme::text_muted(), &font_mono_10);
    put_label(parent, firmware_version, 112, 132, theme::text(), &font_mono_10);
    put_label(parent, "PROTOCOLS", 34, 150, theme::text_muted(), &font_mono_10);
    put_label(parent, "MESHTASTIC / MESHCORE / RETICULUM", 112, 150,
              theme::cyan(), &font_mono_10);
    put_label(parent, "LICENSE", 34, 168, theme::text_muted(), &font_mono_10);
    put_label(parent, "GPL-3.0", 112, 168, theme::text(), &font_mono_10);
    put_centered_label(parent, "github.com/maxmoneycash/lilyshark", 188,
                       theme::pink(), &font_mono_10);
    add_action_strip(parent, "BACK", "LEFT  CONTROLS");
}

void build_spectrum_confirmation(lv_obj_t * parent)
{
    add_shell_header(parent, "SPECTRUM SCAN", "FIRST USE");
    put_centered_label(parent, "PACKET CAPTURE PAUSES DURING A SCAN", 43,
                       theme::amber(), &font_condensed_bold_16);
    put_centered_label(parent, "The SX1262 changes radio mode while sweeping.", 76,
                       theme::text(), &font_mono_10);
    put_centered_label(parent, "Lilyshark restores your active profile and RX", 92,
                       theme::text_muted(), &font_mono_10);
    put_centered_label(parent, "before reporting completion, cancel, or failure.", 108,
                       theme::text_muted(), &font_mono_10);
    constexpr std::array<std::array<const char *, 2>, 3> choices = {{
        {{"CANCEL", "KEEP RECEIVING"}},
        {{"FAST NARROW", "11 BINS / ACTIVE CHANNEL"}},
        {{"DEEP BAND", "REGIONAL / HIGH DETAIL"}},
    }};
    for(std::size_t index = 0; index < choices.size(); ++index) {
        add_shell_list_row(parent, 119 + static_cast<lv_coord_t>(index) * 27, 27,
                           choices[index][0], choices[index][1],
                           spectrum_confirmation_selection == index,
                           index == 0U ? theme::text_muted() : theme::amber());
    }
    add_action_strip(parent, "BACK  CANCEL", "ENTER  CONFIRM",
                     spectrum_confirmation_selection == 0U ? theme::cyan() : theme::amber());
}

void build_reset_confirmation(lv_obj_t * parent)
{
    add_shell_header(parent, "RESET SETUP");
    put_centered_label(parent, "RUN FIRST-TIME SETUP AGAIN?", 47,
                       theme::amber(), &font_condensed_bold_16);
    put_centered_label(parent, "Saved radio profile and capture files remain.", 82,
                       theme::text(), &font_mono_10);
    put_centered_label(parent,
                       reset_save_failed ? "SETTINGS SAVE FAILED - NOTHING WAS RESET"
                                         : "Display and input preferences reset.",
                       99, reset_save_failed ? theme::fault() : theme::text_muted(),
                       &font_mono_10);
    constexpr std::array<const char *, 2> choices = {{"NO  KEEP SETTINGS", "YES  RUN SETUP"}};
    for(std::size_t index = 0; index < choices.size(); ++index) {
        add_shell_list_row(parent, 126 + static_cast<lv_coord_t>(index) * 35, 35,
                           choices[index], "", reset_confirmation_yes == (index == 1),
                           index == 1 ? theme::fault() : theme::text());
    }
    add_action_strip(parent, "BACK  CANCEL",
                     reset_save_failed ? "ENTER  RETRY" : "ENTER  CONFIRM",
                     reset_confirmation_yes ? theme::fault() : theme::cyan());
}

void build_shell_screen(lv_obj_t * parent)
{
    switch(app_shell.route()) {
        case ShellRoute::Splash: build_splash(parent); break;
        case ShellRoute::OnboardingWelcome: build_onboarding_welcome(parent); break;
        case ShellRoute::OnboardingCapabilities: build_onboarding_capabilities(parent); break;
        case ShellRoute::OnboardingNetwork: build_onboarding_network(parent); break;
        case ShellRoute::OnboardingProfile: build_onboarding_profile(parent); break;
        case ShellRoute::OnboardingControls: build_onboarding_controls(parent); break;
        case ShellRoute::OnboardingReadiness: build_onboarding_readiness(parent); break;
        case ShellRoute::Home: build_home(parent); break;
        case ShellRoute::RadioProfiles: build_radio_profiles(parent); break;
        case ShellRoute::Settings: build_settings(parent); break;
        case ShellRoute::Storage: build_storage(parent); break;
        case ShellRoute::DeviceStatus: build_device_status(parent); break;
        case ShellRoute::DisplayInput: build_display_input(parent); break;
        case ShellRoute::Help: build_help(parent); break;
        case ShellRoute::About: build_about(parent); break;
        case ShellRoute::SpectrumConfirmation: build_spectrum_confirmation(parent); break;
        case ShellRoute::ResetConfirmation: build_reset_confirmation(parent); break;
        case ShellRoute::Analyzer:
        case ShellRoute::Count: break;
    }
}

void build_current_screen()
{
    root = lv_screen_active();
    lv_obj_clean(root);
    theme::style_screen(root);
    lv_obj_add_flag(root, LV_OBJ_FLAG_CLICKABLE);
    trace_buffer_index = 0;

    if(app_shell.route() != ShellRoute::Analyzer) {
        build_shell_screen(root);
        return;
    }

    switch(current_screen) {
        case Screen::traffic: build_traffic(root); break;
        case Screen::traffic_filter: build_traffic_filter(root); break;
        case Screen::protocols: build_protocols(root); break;
        case Screen::protocol_detail: build_protocol_detail(root); break;
        case Screen::spectrum: build_spectrum(root); break;
        case Screen::nodes: build_nodes(root); break;
        case Screen::node_detail: build_node_detail(root); break;
        case Screen::packet_detail: build_packet_detail(root); break;
        case Screen::map: build_map(root); break;
        case Screen::survey: build_survey(root); break;
        case Screen::utilization: build_utilization(root); break;
        case Screen::timeline: build_timeline(root); break;
        case Screen::events: build_events(root); break;
        case Screen::count: break;
    }
}

#if defined(LILYSHARK_DEVICE)
void take_device_screenshot() noexcept;
void set_backlight(uint8_t value);
bool set_keyboard_brightness(uint8_t value);
bool start_capture_session() noexcept;
void stop_capture_session() noexcept;

const char *protocol_abbreviation(ProtocolId protocol) noexcept
{
    switch(protocol) {
        case ProtocolId::Meshtastic: return "MT";
        case ProtocolId::MeshCore: return "MC";
        case ProtocolId::Reticulum: return "RN";
        case ProtocolId::Custom: return "CU";
        case ProtocolId::Unknown: default: return "RF";
    }
}

bool update_live_radio_label() noexcept
{
    char next_label[sizeof(live_radio_label)]{};
    const RadioStatus &status = radio_service.status();
    if(app_settings.simulate_mode) {
        std::snprintf(next_label, sizeof(next_label), "SIM %lu",
                      static_cast<unsigned long>(simulate_source.emitted()));
    } else if(!status.initialized) {
        std::snprintf(next_label, sizeof(next_label), "RF ERR %d", status.last_error);
    } else if(!status.receiving) {
        std::snprintf(next_label, sizeof(next_label), "RX STOP %d", status.last_error);
    } else {
        std::snprintf(next_label, sizeof(next_label), "%s %lu",
                      protocol_abbreviation(radio_service.activeProfile().protocol_hint),
                      static_cast<unsigned long>(status.received_frames));
    }
    const bool changed = std::strcmp(live_radio_label, next_label) != 0;
    std::snprintf(live_radio_label, sizeof(live_radio_label), "%s", next_label);
    return changed;
}

/// Calendar date from a Unix timestamp (civil-from-days), for lease expiries.
/// The device has no timezone; UTC is the only honest rendering.
void format_unix_date(std::uint32_t unix_seconds, char *out, std::size_t capacity) noexcept
{
    const std::int64_t z = static_cast<std::int64_t>(unix_seconds / 86400U) + 719468;
    const std::int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const std::uint64_t doe = static_cast<std::uint64_t>(z - era * 146097);
    const std::uint64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const std::int64_t y = static_cast<std::int64_t>(yoe) + era * 400;
    const std::uint64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const std::uint64_t mp = (5 * doy + 2) / 153;
    const std::uint64_t d = doy - (153 * mp + 2) / 5 + 1;
    const std::uint64_t m = mp < 10 ? mp + 3 : mp - 9;
    std::snprintf(out, capacity, "%04lld-%02llu-%02llu",
                  static_cast<long long>(y + (m <= 2 ? 1 : 0)),
                  static_cast<unsigned long long>(m), static_cast<unsigned long long>(d));
}

/// Decode the Shelby pointer riding inside a stored frame, wherever the
/// enclosing protocol put it. False when the frame carries none.
bool decode_frame_shelby_pointer(const FrameRecord &record, ShelbyPointer &out) noexcept
{
    if(!record.decoded.hasAttribute(AttributeShelbyPointer)) return false;
    const std::size_t offset = findShelbyPointer(record.raw.bytes, record.raw.captured_length);
    if(offset >= record.raw.captured_length) return false;
    return decodeShelbyPointer(record.raw.bytes + offset, record.raw.captured_length - offset,
                               out) == ShelbyPointerResult::Ok;
}

void ingest_analyzer_frame(const RawFrame &frame, const RadioProfile &profile,
                           bool allow_capture) noexcept
{
    const bool synthetic = frame.rf.origin == FrameOrigin::Synthetic;
    const FrameRecord *previous_newest = newestMatchingFrame(
        capture_runtime.frames(), traffic_filter, 0U);
    const bool follow_newest = traffic_selected_sequence == 0 ||
                               (previous_newest != nullptr &&
                                traffic_selected_sequence == previous_newest->sequence);
    (void)capture_runtime.ingest(frame, profile);
    if(follow_newest) {
        const FrameRecord *newest_filtered = newestMatchingFrame(
            capture_runtime.frames(), traffic_filter, 0U);
        traffic_selected_sequence = newest_filtered == nullptr ? 0U
                                                                : newest_filtered->sequence;
    }
    const FrameRecord *stored = capture_runtime.frames().newest();
    if(stored != nullptr) (void)rolling_diagnostics.ingest(*stored);
    if(!first_frame_event_recorded) {
        char message[80]{};
        std::snprintf(message, sizeof(message), "First %s%s frame  RSSI %.1f  SNR %.1f",
                      synthetic ? "simulated " : "",
                      protocol_abbreviation(profile.protocol_hint),
                      static_cast<double>(frame.rf.rssi_dbm_x10) / 10.0,
                      static_cast<double>(frame.rf.snr_db_x10) / 10.0);
        record_runtime_event(synthetic ? RuntimeEventSeverity::Warning
                                       : RuntimeEventSeverity::Success,
                             synthetic ? RuntimeEventType::System : RuntimeEventType::Radio,
                             message);
        first_frame_event_recorded = true;
    }
    if(survey_running && stored != nullptr) survey_accumulator.ingest(*stored);
    // A pointer frame is the off-grid story arriving in real time; it earns a
    // line in the event log the moment it lands, not just a detail-tab entry
    // the user has to dig for.
    if(stored != nullptr) {
        ShelbyPointer pointer{};
        if(decode_frame_shelby_pointer(*stored, pointer)) {
            char message[kRuntimeEventMessageCapacity]{};
            std::snprintf(message, sizeof(message),
                          "Shelby pointer: %lu B blob, commit 0x%02x%02x..%02x%02x",
                          static_cast<unsigned long>(pointer.size_bytes),
                          pointer.commitment[0], pointer.commitment[1],
                          pointer.commitment[30], pointer.commitment[31]);
            record_runtime_event(RuntimeEventSeverity::Success, RuntimeEventType::Radio, message);
#if defined(LILYSHARK_DEVICE)
            // Full coordinates over the link: enough for the analyzer to
            // resolve the blob from the storage network on its own.
            if(analyzer_link_active) {
                char owner_hex[2U * ShelbyPointer::kOwnerSize + 1U]{};
                char commit_hex[2U * ShelbyPointer::kCommitmentSize + 1U]{};
                for(unsigned index = 0; index < ShelbyPointer::kOwnerSize; ++index) {
                    std::snprintf(owner_hex + index * 2U, 3U, "%02x", pointer.owner[index]);
                }
                for(unsigned index = 0; index < ShelbyPointer::kCommitmentSize; ++index) {
                    std::snprintf(commit_hex + index * 2U, 3U, "%02x", pointer.commitment[index]);
                }
                Serial.printf("LSK P {\"size\":%lu,\"expires\":%lu,\"owner\":\"0x%s\",\"commit\":\"0x%s\"}\n",
                              static_cast<unsigned long>(pointer.size_bytes),
                              static_cast<unsigned long>(pointer.expires_at_unix),
                              owner_hex, commit_hex);
            }
#endif
        }
    }
    if(allow_capture && native_capture_recording) {
        last_native_capture_result = stored != nullptr
            ? native_capture_writer.write(*stored)
            : LilysharkCaptureWriteResult::InvalidFrame;
        if(last_native_capture_result == LilysharkCaptureWriteResult::SinkError) {
            native_capture_recording = false;
            sd_io_error = true;
            native_capture_sink.close();
            record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Capture,
                                 "Native capture write failed; recording stopped");
        }
    }
    if(allow_capture && pcap_recording) {
        last_pcap_result = pcap_writer.write(frame);
        if(last_pcap_result == PcapWriteResult::SyntheticFrame &&
           !pcap_synthetic_warning_recorded) {
            record_runtime_event(native_capture_recording ? RuntimeEventSeverity::Info
                                                          : RuntimeEventSeverity::Error,
                                 RuntimeEventType::Capture,
                                 native_capture_recording
                                     ? "PCAP excludes simulated frames; marked LSCAP remains complete"
                                     : "PCAP excludes simulated frames; no native capture is active");
            pcap_synthetic_warning_recorded = true;
        } else if(last_pcap_result == PcapWriteResult::InvalidBandwidth &&
           !pcap_bandwidth_warning_recorded) {
            record_runtime_event(native_capture_recording ? RuntimeEventSeverity::Warning
                                                          : RuntimeEventSeverity::Error,
                                 RuntimeEventType::Capture,
                                 native_capture_recording
                                     ? "PCAP skipped this bandwidth; native LSCAP remains complete"
                                     : "PCAP skipped this bandwidth; no native capture is active");
            pcap_bandwidth_warning_recorded = true;
        } else if(last_pcap_result == PcapWriteResult::Ok) {
            pcap_bandwidth_warning_recorded = false;
            pcap_synthetic_warning_recorded = false;
        }
        if(last_pcap_result == PcapWriteResult::SinkError) {
            pcap_recording = false;
            sd_io_error = true;
            pcap_sink.close();
            record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Capture,
                                 "PCAP write failed; recording stopped");
        }
    }
    live_data_dirty = true;
    update_live_radio_label();
}

void on_radio_frame(const RawFrame &frame, const RadioProfile &profile, void *) noexcept
{
    if(app_settings.simulate_mode) return;
    ingest_analyzer_frame(frame, profile, true);
}

void reset_analysis_for_source_change() noexcept
{
    capture_runtime.frames().clear();
    rolling_diagnostics.reset();
    survey_accumulator.reset();
    survey_running = false;
    survey_has_result = false;
    survey_elapsed_ms = 0U;
    survey_last_accounted_ms = 0U;
    traffic_selected_sequence = 0U;
    packet_detail_sequence = 0U;
    packet_detail_byte_offset = 0U;
    packet_detail_tab = 0U;
    node_selection_valid = false;
    node_detail_selection_valid = false;
    first_frame_event_recorded = false;
    live_data_dirty = true;
}

void apply_simulate_mode_runtime(bool enabled) noexcept
{
    const RadioProfile profile = radio_service.activeProfile();
    simulate_source.reset();
    reset_analysis_for_source_change();
    if(capture_session_active()) stop_capture_session();

    bool radio_ready = radio_service.status().receiving;
    if(enabled) {
        radio_service.stop();
        radio_service.clearSpectrumResult();
        radio_ready = true;
    } else {
        radio_ready = radio_service.begin(profile, on_radio_frame, nullptr);
    }

    const bool capture_requested = app_settings.capture_enabled;
    const bool capture_ready = !capture_requested ||
        (start_capture_session() && (!enabled || native_capture_recording));
    const char *capture_event = !capture_requested
        ? (enabled ? "Simulate mode active; capture remains off"
                   : "Simulate mode off; capture remains off")
        : (enabled
               ? (capture_ready
                      ? "Synthetic LSCAP started; PCAP excludes simulated frames"
                      : "Simulate mode active, but synthetic LSCAP could not start")
               : (capture_ready
                      ? "Radio-only capture restored after Simulate mode"
                      : "Simulate mode off, but capture could not restart"));
    record_runtime_event(capture_ready ? RuntimeEventSeverity::Info
                                       : RuntimeEventSeverity::Error,
                         RuntimeEventType::Capture, capture_event);
    if(!enabled && !radio_ready) {
        record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Radio,
                             "Simulate mode off; SX1262 receive is recovering");
    }
    observed_radio_initialized = radio_service.status().initialized;
    observed_radio_receiving = radio_service.status().receiving;
    update_live_radio_label();
}

bool update_live_hardware_labels() noexcept
{
    const HardwareStatusSnapshot &status = hardware_status.snapshot();
    const bool changed = std::strcmp(live_battery_label, status.battery_label) != 0 ||
                         std::strcmp(live_gps_label, status.gps_label) != 0;
    std::snprintf(live_battery_label, sizeof(live_battery_label), "%s", status.battery_label);
    std::snprintf(live_gps_label, sizeof(live_gps_label), "%s", status.gps_label);
    return changed;
}

bool ensure_preferences_ready() noexcept
{
    if(profile_preferences_ready) return true;
    profile_preferences_ready = profile_preferences.begin("lilyshark", false);
    return profile_preferences_ready;
}

bool write_app_settings() noexcept
{
    if(!ensure_preferences_ready()) return false;
    std::uint8_t bytes[kAppSettingsV1Size]{};
    return encodeAppSettingsV1(app_settings, bytes, sizeof(bytes)) &&
           profile_preferences.putBytes("app", bytes, sizeof(bytes)) == sizeof(bytes);
}

bool load_app_settings() noexcept
{
    app_settings = defaultAppSettings();
    if(!ensure_preferences_ready()) return false;
    const std::size_t stored_size = profile_preferences.getBytesLength("app");
    if(stored_size != kAppSettingsV1Size) return false;
    std::uint8_t bytes[kAppSettingsV1Size]{};
    if(profile_preferences.getBytes("app", bytes, sizeof(bytes)) != sizeof(bytes)) return false;
    AppSettings candidate{};
    if(decodeAppSettings(bytes, sizeof(bytes), candidate) != AppSettingsDecodeResult::LoadedV1) {
        Serial.println("Lilyshark app settings invalid; first-run setup required");
        return false;
    }
    app_settings = candidate;
    return true;
}

bool write_saved_profile(const RadioProfile &profile) noexcept
{
    if(!ensure_preferences_ready()) return false;
    std::uint8_t bytes[kSavedProfileV2Size]{};
    return encodeSavedProfileV2(profile, bytes, sizeof(bytes)) &&
           profile_preferences.putBytes("profile", bytes, sizeof(bytes)) == sizeof(bytes);
}

bool load_saved_profile(RadioProfile &profile) noexcept
{
    if(!ensure_preferences_ready()) return false;

    const std::size_t stored_size = profile_preferences.getBytesLength("profile");
    if(stored_size != kSavedProfileV1Size && stored_size != kSavedProfileV2Size) {
        return false;
    }

    std::uint8_t bytes[kSavedProfileV2Size]{};
    if(profile_preferences.getBytes("profile", bytes, stored_size) != stored_size) return false;
    RadioProfile candidate{};
    const SavedProfileDecodeResult result = decodeSavedProfile(bytes, stored_size, candidate);
    if(result == SavedProfileDecodeResult::Invalid) return false;
    if(result == SavedProfileDecodeResult::MigratedV1 && !write_saved_profile(candidate)) {
        Serial.println("Lilyshark saved profile loaded but v2 migration was not saved");
    }

    for(std::size_t index = 0; index < builtinProfileCount(); ++index) {
        if(builtinProfiles()[index].id == candidate.id) {
            active_profile_index = index;
            break;
        }
    }
    profile = candidate;
    return true;
}

bool save_active_profile() noexcept
{
    return write_saved_profile(radio_service.activeProfile());
}

bool apply_builtin_profile(std::size_t candidate_index) noexcept
{
    const std::size_t count = builtinProfileCount();
    if(count == 0U) return false;
    candidate_index %= count;
    const RadioProfile &next = builtinProfiles()[candidate_index];
    if(app_settings.simulate_mode) {
        std::snprintf(shell_notice, sizeof(shell_notice), "TURN OFF SIM / PROFILE UNCHANGED");
        record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Profile,
                             "Radio profile changes require Simulate mode off");
        return false;
    }
    const bool ready = radio_service.setProfile(next);
    if(ready) {
        active_profile_index = candidate_index;
        const bool saved = save_active_profile();
        if(!saved) {
            std::snprintf(shell_notice, sizeof(shell_notice), "PROFILE ACTIVE / SAVE FAILED");
            Serial.println("Lilyshark profile settings were not saved");
        } else {
            std::snprintf(shell_notice, sizeof(shell_notice), "LISTENING / %s", next.name);
        }
        char message[80]{};
        if(saved) {
            std::snprintf(message, sizeof(message), "%s active at %.3f MHz", next.name,
                          static_cast<double>(next.center_frequency_hz) / 1000000.0);
        } else {
            std::snprintf(message, sizeof(message), "%s active, but preset was not saved",
                          next.name);
        }
        record_runtime_event(saved ? RuntimeEventSeverity::Success
                                   : RuntimeEventSeverity::Error,
                             RuntimeEventType::Profile, message);
    } else {
        std::snprintf(shell_notice, sizeof(shell_notice), "PROFILE FAILED / ERROR %d",
                      radio_service.status().last_profile_error);
        char message[80]{};
        std::snprintf(message, sizeof(message), "%s failed with radio error %d", next.name,
                      radio_service.status().last_profile_error);
        record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Profile, message);
    }
    update_live_radio_label();
    Serial.printf("Lilyshark profile: %s (%s, error %d)\n", next.name,
                  ready ? "listening" : "failed",
                  ready ? radio_service.status().last_error
                        : radio_service.status().last_profile_error);
    return ready;
}

void cycle_active_profile() noexcept
{
    const std::size_t count = builtinProfileCount();
    if(count == 0) return;
    const std::size_t candidate_index = (active_profile_index + 1) % count;
    apply_builtin_profile(candidate_index);
    build_current_screen();
}

void apply_tuned_profile(const RadioProfile &candidate, const char *action) noexcept
{
    if(app_settings.simulate_mode) {
        Serial.printf("Lilyshark profile tune blocked in Simulate mode: %s\n", action);
        record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Profile,
                             "Radio tuning requires Simulate mode off");
        return;
    }
    const RadioProfile &current = radio_service.activeProfile();
    if(candidate.center_frequency_hz == current.center_frequency_hz &&
       candidate.bandwidth_hz == current.bandwidth_hz &&
       candidate.spreading_factor == current.spreading_factor &&
       candidate.coding_rate_denominator == current.coding_rate_denominator &&
       candidate.preamble_symbols == current.preamble_symbols &&
       candidate.frequency_tuning_policy == current.frequency_tuning_policy &&
       candidate.frequency_slot == current.frequency_slot) {
        Serial.printf("Lilyshark profile tune ignored: %s\n", action);
        return;
    }
    if(!isSupportedTunedProfile(candidate)) {
        Serial.printf("Lilyshark profile tune rejected: %s would leave supported limits\n", action);
        return;
    }

    const bool ready = radio_service.setProfile(candidate);
    const bool saved = ready && save_active_profile();
    if(ready && !saved) {
        Serial.println("Lilyshark profile settings were not saved");
    }
    char event_message[80]{};
    const char *result = !ready ? "Tune failed" :
                         (saved ? "Tune applied" : "Tune active / save failed");
    std::snprintf(event_message, sizeof(event_message), "%s: %.3f MHz BW %.1f SF%u CR4/%u",
                  result, static_cast<double>(candidate.center_frequency_hz) / 1000000.0,
                  static_cast<double>(candidate.bandwidth_hz) / 1000.0,
                  candidate.spreading_factor, candidate.coding_rate_denominator);
    record_runtime_event(!ready ? RuntimeEventSeverity::Error :
                         (saved ? RuntimeEventSeverity::Success : RuntimeEventSeverity::Warning),
                         RuntimeEventType::Profile, event_message);
    update_live_radio_label();
    Serial.printf("Lilyshark profile %s: %.3f MHz, BW %.1f kHz, SF%u, CR 4/%u (%s, error %d)\n",
                  action,
                  static_cast<double>(candidate.center_frequency_hz) / 1000000.0,
                  static_cast<double>(candidate.bandwidth_hz) / 1000.0,
                  candidate.spreading_factor, candidate.coding_rate_denominator,
                  ready ? "listening" : "failed",
                  ready ? radio_service.status().last_error
                        : radio_service.status().last_profile_error);
    build_current_screen();
}

#endif

constexpr std::array<Screen, 9> primary_screens = {{
    Screen::traffic,
    Screen::spectrum,
    Screen::nodes,
    Screen::map,
    Screen::survey,
    Screen::utilization,
    Screen::events,
    Screen::protocols,
    Screen::timeline,
}};

void remember_primary_screen(Screen screen) noexcept
{
    for(std::size_t index = 0; index < primary_screens.size(); ++index) {
        if(primary_screens[index] != screen) continue;
        app_settings.last_primary_diagnostic_index = static_cast<std::uint8_t>(index);
#if defined(LILYSHARK_DEVICE)
        if(app_settings.resume_last_view && !write_app_settings()) {
            record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::System,
                                 "Last-view preference could not be saved");
        }
#endif
        return;
    }
}

Screen primary_context(Screen screen) noexcept
{
    if(screen == Screen::traffic_filter) return Screen::traffic;
    if(screen == Screen::packet_detail) return Screen::traffic;
    if(screen == Screen::node_detail) return Screen::nodes;
    if(screen == Screen::protocol_detail) return Screen::protocols;
    return screen;
}

void move_primary_screen(int direction) noexcept
{
    const Screen context = primary_context(current_screen);
    std::size_t current_index = 0;
    for(std::size_t index = 0; index < primary_screens.size(); ++index) {
        if(primary_screens[index] == context) {
            current_index = index;
            break;
        }
    }
    if((direction < 0 && context == primary_screens.front()) ||
       (direction > 0 && context == primary_screens.back())) {
        (void)app_shell.open(ShellRoute::Home);
        build_current_screen();
        return;
    }
    if(direction > 0) {
        current_index = (current_index + 1) % primary_screens.size();
    } else {
        current_index = current_index == 0 ? primary_screens.size() - 1 : current_index - 1;
    }
    current_screen = primary_screens[current_index];
    if(current_screen == Screen::events) {
        events_scroll_offset = 0U;
        event_detail_open = false;
    }
    remember_primary_screen(current_screen);
    build_current_screen();
#if defined(LILYSHARK_DEVICE)
    Serial.printf("Lilyshark view: %s\n", screen_names[static_cast<std::size_t>(current_screen)]);
#else
    std::fprintf(stderr, "Lilyshark view: %s\n",
                 screen_names[static_cast<std::size_t>(current_screen)]);
#endif
}

bool apply_shell_profile(std::size_t profile_index) noexcept
{
    const std::size_t count = builtinProfileCount();
    if(count == 0U) return false;
    profile_index %= count;
#if defined(LILYSHARK_DEVICE)
    return apply_builtin_profile(profile_index);
#else
    simulator_active_profile_index = profile_index;
    simulator_live_telemetry.setActiveRfProfile(
        simulator_rf_profile_for_profile(builtinProfiles()[profile_index]));
    std::snprintf(shell_notice, sizeof(shell_notice), "LISTENING / %s",
                  builtinProfiles()[profile_index].name);
    return true;
#endif
}

void open_home_item(HomeItem item) noexcept
{
    switch(item) {
        case HomeItem::Traffic: current_screen = Screen::traffic; app_shell.closeToAnalyzer(); break;
        case HomeItem::Spectrum: current_screen = Screen::spectrum; app_shell.closeToAnalyzer(); break;
        case HomeItem::Nodes: current_screen = Screen::nodes; app_shell.closeToAnalyzer(); break;
        case HomeItem::Map: current_screen = Screen::map; app_shell.closeToAnalyzer(); break;
        case HomeItem::Survey: current_screen = Screen::survey; app_shell.closeToAnalyzer(); break;
        case HomeItem::Utilization: current_screen = Screen::utilization; app_shell.closeToAnalyzer(); break;
        case HomeItem::Events:
            current_screen = Screen::events;
            events_scroll_offset = 0U;
            event_detail_open = false;
            app_shell.closeToAnalyzer();
            break;
        case HomeItem::Settings: (void)app_shell.open(ShellRoute::Settings); break;
        case HomeItem::Protocols:
            current_screen = Screen::protocols;
            app_shell.closeToAnalyzer();
            break;
        case HomeItem::Timeline:
            current_screen = Screen::timeline;
            app_shell.closeToAnalyzer();
            break;
        case HomeItem::Count: break;
    }
    if(app_shell.route() == ShellRoute::Analyzer) remember_primary_screen(current_screen);
    build_current_screen();
}

void finish_first_run() noexcept
{
    app_settings.onboarding_version = kAppSettingsOnboardingVersion;
    app_settings.onboarding_complete = true;
#if defined(LILYSHARK_DEVICE)
    if(!write_app_settings()) {
        Serial.println("Lilyshark onboarding state was not saved");
        record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::System,
                             "First-run settings could not be saved");
        onboarding_complete = false;
        onboarding_save_failed = true;
        build_current_screen();
        return;
    }
#endif
    onboarding_complete = true;
    onboarding_save_failed = false;
    (void)app_shell.advanceOnboarding();
    build_current_screen();
}

bool handle_shell_navigation_key(std::uint32_t key)
{
    const ShellRoute route = app_shell.route();
    if(route == ShellRoute::Analyzer) return false;

    if(key == LV_KEY_ESC || key == 0x08U) {
        if(isOnboardingRoute(route)) {
            if(app_shell.retreatOnboarding()) build_current_screen();
            return true;
        }
        if(route == ShellRoute::SpectrumConfirmation) spectrum_confirmation_selection = 0U;
        if(route == ShellRoute::ResetConfirmation) {
            reset_confirmation_yes = false;
            reset_save_failed = false;
        }
        if(route == ShellRoute::DisplayInput) display_settings_save_failed = false;
        if(route == ShellRoute::Storage) capture_settings_save_failed = false;
        if(app_shell.goBack()) {
            build_current_screen();
        } else if(route != ShellRoute::Splash) {
            app_shell.closeToAnalyzer();
            build_current_screen();
        }
        return true;
    }

    if(key == LV_KEY_ENTER || key == '\r') {
        switch(route) {
            case ShellRoute::Splash:
                if(startup_services_complete) {
                    app_shell.finishSplash(onboarding_complete);
                    build_current_screen();
                }
                break;
            case ShellRoute::OnboardingWelcome:
                (void)app_shell.advanceOnboarding();
                build_current_screen();
                break;
            case ShellRoute::OnboardingCapabilities:
                (void)app_shell.advanceOnboarding();
                build_current_screen();
                break;
            case ShellRoute::OnboardingNetwork:
                onboarding_profile_selection = 0;
                shell_notice[0] = '\0';
                (void)app_shell.advanceOnboarding();
                build_current_screen();
                break;
            case ShellRoute::OnboardingProfile: {
                const std::size_t profile_index =
                    onboarding_profile_index(onboarding_profile_selection);
                if(apply_shell_profile(profile_index) &&
                   std::strstr(shell_notice, "FAILED") == nullptr) {
                    onboarding_save_failed = false;
                    (void)app_shell.advanceOnboarding();
                }
                build_current_screen();
                break;
            }
            case ShellRoute::OnboardingControls:
                (void)app_shell.advanceOnboarding();
                build_current_screen();
                break;
            case ShellRoute::OnboardingReadiness:
                finish_first_run();
                break;
            case ShellRoute::Home:
                open_home_item(app_shell.homeSelection());
                break;
            case ShellRoute::RadioProfiles:
                apply_shell_profile(app_shell.profileSelection());
                build_current_screen();
                break;
            case ShellRoute::Settings:
            {
                const ShellRoute destination = routeForSettingsItem(app_shell.settingsSelection());
                if(destination == ShellRoute::RadioProfiles) {
#if defined(LILYSHARK_DEVICE)
                    app_shell.setProfileSelection(active_profile_index, builtinProfileCount());
#else
                    app_shell.setProfileSelection(simulator_active_profile_index,
                                                  builtinProfileCount());
#endif
                    shell_notice[0] = '\0';
                } else if(destination == ShellRoute::ResetConfirmation) {
                    reset_confirmation_yes = false;
                    reset_save_failed = false;
                } else if(destination == ShellRoute::DisplayInput) {
                    display_settings_save_failed = false;
                } else if(destination == ShellRoute::Storage) {
                    capture_settings_save_failed = false;
                }
                (void)app_shell.open(destination);
                build_current_screen();
                break;
            }
            case ShellRoute::DeviceStatus:
#if defined(LILYSHARK_DEVICE)
                if(!app_settings.simulate_mode && !radio_service.status().receiving) {
                    radio_service.setProfile(radio_service.activeProfile());
                    update_live_radio_label();
                }
#endif
                build_current_screen();
                break;
            case ShellRoute::SpectrumConfirmation: {
                if(spectrum_confirmation_selection == 0U) {
                    (void)app_shell.goBack();
                    build_current_screen();
                    break;
                }
                spectrum_scan_mode = spectrum_confirmation_selection == 1U
                    ? SpectrumScanMode::FastNarrow : SpectrumScanMode::DeepBand;
                app_settings.spectrum_warning_acknowledged = true;
#if defined(LILYSHARK_DEVICE)
                if(!write_app_settings()) {
                    app_settings.spectrum_warning_acknowledged = false;
                    record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::System,
                                         "Spectrum notice acknowledgement was not saved");
                }
#endif
                (void)app_shell.goBack();
                spectrum_confirmation_selection = spectrum_scan_mode == SpectrumScanMode::FastNarrow
                    ? 1U : 2U;
#if defined(LILYSHARK_DEVICE)
                if(app_settings.simulate_mode) {
                    record_runtime_event(RuntimeEventSeverity::Warning,
                                         RuntimeEventType::Spectrum,
                                         "Spectrum requires live RF; turn off Simulate mode");
                } else if(survey_running) {
                    record_runtime_event(RuntimeEventSeverity::Warning,
                                         RuntimeEventType::Spectrum,
                                         "Spectrum scan blocked while survey is running");
                } else if(spectrum_buffer != nullptr) {
                    const SpectrumSweepRequest request =
                        spectrum_request_for_profile(radio_service.activeProfile(),
                                                     spectrum_scan_mode);
                    if(radio_service.startSpectrumSweep(request)) {
                        record_runtime_event(RuntimeEventSeverity::Info,
                                             RuntimeEventType::Spectrum,
                                             "Spectrum scan started; packet receive paused");
                    } else {
                        record_runtime_event(RuntimeEventSeverity::Error,
                                             RuntimeEventType::Spectrum,
                                             "Spectrum scan could not start");
                    }
                }
#else
                if(!simulator_survey_running && !simulator_live_telemetry.survey().running) {
                    simulator_spectrum_scanning = true;
                    simulator_spectrum_started_ms = simulator_live_telemetry.elapsedMilliseconds();
                    simulator_spectrum_partial_points = 0U;
                    simulator_spectrum_cancelled = false;
                    simulator_live_telemetry.setCapturePaused(true);
                }
#endif
                build_current_screen();
                break;
            }
            case ShellRoute::ResetConfirmation:
                if(reset_confirmation_yes) {
                    const AppSettings previous = app_settings;
                    app_settings = defaultAppSettings();
#if defined(LILYSHARK_DEVICE)
                    if(!write_app_settings()) {
                        app_settings = previous;
                        reset_save_failed = true;
                        record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::System,
                                             "Setup reset was not saved; settings unchanged");
                        build_current_screen();
                        break;
                    }
#endif
                    onboarding_complete = false;
                    onboarding_save_failed = false;
                    reset_save_failed = false;
#if defined(LILYSHARK_DEVICE)
                    set_backlight(app_settings.display_brightness);
                    keyboard_ready = set_keyboard_brightness(app_settings.keyboard_brightness);
                    hardware_status.begin(app_settings.gps_enabled);
                    if(previous.simulate_mode) {
                        apply_simulate_mode_runtime(false);
                    } else if(!capture_session_active()) {
                        (void)start_capture_session();
                    }
                    record_runtime_event(RuntimeEventSeverity::Info, RuntimeEventType::System,
                                         "First-run setup preferences reset");
#endif
                    reset_confirmation_yes = false;
                    app_shell.beginOnboarding();
                } else {
                    (void)app_shell.goBack();
                }
                build_current_screen();
                break;
            case ShellRoute::Storage:
#if defined(LILYSHARK_DEVICE)
            {
                if(app_settings.simulate_mode && app_settings.capture_enabled &&
                   !native_capture_recording) {
                    stop_capture_session();
                    const bool restarted = start_capture_session();
                    capture_settings_save_failed = false;
                    record_runtime_event(restarted && native_capture_recording
                                             ? RuntimeEventSeverity::Success
                                             : RuntimeEventSeverity::Error,
                                         RuntimeEventType::Capture,
                                         restarted && native_capture_recording
                                             ? "Synthetic LSCAP capture restarted"
                                             : "Synthetic LSCAP capture could not restart");
                    build_current_screen();
                    break;
                }
                const AppSettings previous = app_settings;
                const bool was_active = app_settings.simulate_mode
                    ? native_capture_recording : capture_session_active();
                if(was_active) {
                    stop_capture_session();
                    app_settings.capture_enabled = false;
                } else {
                    app_settings.capture_enabled = true;
                    (void)start_capture_session();
                }
                if(!write_app_settings()) {
                    app_settings = previous;
                    bool runtime_restored = true;
                    if(previous.capture_enabled && !capture_session_active()) {
                        runtime_restored = start_capture_session();
                    } else if(!previous.capture_enabled && capture_session_active()) {
                        stop_capture_session();
                    }
                    capture_settings_save_failed = true;
                    record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::System,
                                         runtime_restored
                                             ? "Capture setting was not saved; prior state restored"
                                             : "Capture setting save and session restart both failed");
                } else {
                    capture_settings_save_failed = false;
                    if(was_active) {
                        record_runtime_event(RuntimeEventSeverity::Warning,
                                             RuntimeEventType::Capture,
                                             "Capture stopped by operator");
                    }
                }
            }
#else
                app_settings.capture_enabled = !app_settings.capture_enabled;
                capture_settings_save_failed = false;
#endif
                build_current_screen();
                break;
            case ShellRoute::DisplayInput:
            case ShellRoute::Help:
            case ShellRoute::About:
            case ShellRoute::Analyzer:
            case ShellRoute::Count:
                break;
        }
        return true;
    }

    if(key == LV_KEY_DOWN || key == LV_KEY_UP) {
        const bool next = key == LV_KEY_DOWN;
        switch(route) {
            case ShellRoute::OnboardingNetwork:
                onboarding_network_selection = next
                    ? (onboarding_network_selection + 1U) % 4U
                    : (onboarding_network_selection == 0U ? 3U : onboarding_network_selection - 1U);
                break;
            case ShellRoute::OnboardingProfile: {
                const std::size_t count = onboarding_profile_count();
                onboarding_profile_selection = next
                    ? (onboarding_profile_selection + 1U) % count
                    : (onboarding_profile_selection == 0U ? count - 1U
                                                          : onboarding_profile_selection - 1U);
                shell_notice[0] = '\0';
                break;
            }
            case ShellRoute::Home: {
                const std::size_t count = static_cast<std::size_t>(HomeItem::Count);
                const std::size_t current = static_cast<std::size_t>(app_shell.homeSelection());
                app_shell.setHomeSelection(next ? (current + 2U) % count
                                                : (current + count - 2U) % count);
                break;
            }
            case ShellRoute::RadioProfiles:
                app_shell.moveProfileSelection(next ? SelectionMove::Next : SelectionMove::Previous,
                                               builtinProfileCount());
                shell_notice[0] = '\0';
                break;
            case ShellRoute::Settings:
                app_shell.moveSettingsSelection(next ? SelectionMove::Next : SelectionMove::Previous);
                break;
            case ShellRoute::DisplayInput:
                display_input_selection = next
                    ? (display_input_selection + 1U) % 5U
                    : (display_input_selection + 4U) % 5U;
                break;
            case ShellRoute::SpectrumConfirmation:
                spectrum_confirmation_selection = next
                    ? (spectrum_confirmation_selection + 1U) % 3U
                    : (spectrum_confirmation_selection + 2U) % 3U;
                break;
            case ShellRoute::ResetConfirmation:
                reset_confirmation_yes = !reset_confirmation_yes;
                break;
            default:
                return true;
        }
        build_current_screen();
        return true;
    }

    if(key == LV_KEY_RIGHT || key == LV_KEY_NEXT || key == LV_KEY_LEFT || key == LV_KEY_PREV) {
        const bool next = key == LV_KEY_RIGHT || key == LV_KEY_NEXT;
        if(route == ShellRoute::Home) {
            app_shell.moveHomeSelection(next ? SelectionMove::Next : SelectionMove::Previous);
        } else if(route == ShellRoute::OnboardingProfile) {
            const std::size_t count = onboarding_profile_count();
            onboarding_profile_selection = next
                ? (onboarding_profile_selection + 1U) % count
                : (onboarding_profile_selection == 0U ? count - 1U
                                                      : onboarding_profile_selection - 1U);
            shell_notice[0] = '\0';
        } else if(route == ShellRoute::DisplayInput) {
#if defined(LILYSHARK_DEVICE)
            const AppSettings previous = app_settings;
#endif
            const int direction = next ? 1 : -1;
            if(display_input_selection == 0U) {
                int value = static_cast<int>(app_settings.display_brightness) + direction;
                if(value < 1) value = 16;
                if(value > 16) value = 1;
                app_settings.display_brightness = static_cast<std::uint8_t>(value);
#if defined(LILYSHARK_DEVICE)
                set_backlight(app_settings.display_brightness);
#endif
            } else if(display_input_selection == 1U) {
                int value = static_cast<int>(app_settings.keyboard_brightness) + direction * 16;
                if(value < 0) value = 255;
                if(value > 255) value = 0;
                app_settings.keyboard_brightness = static_cast<std::uint8_t>(value);
#if defined(LILYSHARK_DEVICE)
                keyboard_ready = set_keyboard_brightness(app_settings.keyboard_brightness);
#endif
            } else if(display_input_selection == 2U) {
                app_settings.gps_enabled = !app_settings.gps_enabled;
#if defined(LILYSHARK_DEVICE)
                hardware_status.begin(app_settings.gps_enabled);
                update_live_hardware_labels();
#endif
            } else if(display_input_selection == 3U) {
                app_settings.resume_last_view = !app_settings.resume_last_view;
            } else {
                app_settings.simulate_mode = !app_settings.simulate_mode;
            }
#if defined(LILYSHARK_DEVICE)
            if(!write_app_settings()) {
                app_settings = previous;
                if(display_input_selection == 0U) {
                    set_backlight(app_settings.display_brightness);
                } else if(display_input_selection == 1U) {
                    keyboard_ready = set_keyboard_brightness(app_settings.keyboard_brightness);
                } else if(display_input_selection == 2U) {
                    hardware_status.begin(app_settings.gps_enabled);
                    update_live_hardware_labels();
                }
                display_settings_save_failed = true;
                record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::System,
                                     "Display or input setting was not saved; value restored");
            } else {
                display_settings_save_failed = false;
                if(display_input_selection == 2U) {
                    record_runtime_event(RuntimeEventSeverity::Info, RuntimeEventType::Hardware,
                                         app_settings.gps_enabled ? "Optional GPS polling enabled"
                                                                  : "Optional GPS polling disabled");
                } else if(display_input_selection == 3U) {
                    record_runtime_event(RuntimeEventSeverity::Info, RuntimeEventType::System,
                                         app_settings.resume_last_view
                                             ? "Startup will resume the last live view"
                                             : "Startup will open Home");
                } else if(display_input_selection == 4U) {
                    apply_simulate_mode_runtime(app_settings.simulate_mode);
                    record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::System,
                                         app_settings.simulate_mode
                                             ? "Simulate mode ON - live RF ignored; frames are synthetic"
                                             : "Simulate mode off - showing radio traffic only");
                }
            }
#else
            display_settings_save_failed = false;
#endif
        } else if(route == ShellRoute::Help && next) {
            (void)app_shell.open(ShellRoute::About);
        } else if(route == ShellRoute::About && !next) {
            (void)app_shell.goBack();
        } else {
            return true;
        }
        build_current_screen();
        return true;
    }

    return true;
}

void handle_navigation_key(uint32_t key);

void handle_touch_tap(std::uint16_t x, std::uint16_t y)
{
    const ShellRoute route = app_shell.route();
    if(y < theme::status_height && route != ShellRoute::Splash &&
       !isOnboardingRoute(route)) {
        handle_navigation_key('M');
        return;
    }

    if(route != ShellRoute::Analyzer && route != ShellRoute::Home &&
       route != ShellRoute::Splash && y >= 204U) {
        if(x < 160U) {
            if(route == ShellRoute::OnboardingWelcome) {
                handle_navigation_key('?');
            } else if(route == ShellRoute::Storage) {
#if defined(LILYSHARK_DEVICE)
                handle_navigation_key('S');
#endif
            } else {
                handle_navigation_key(LV_KEY_ESC);
            }
        } else if(route == ShellRoute::Help) {
            handle_navigation_key(LV_KEY_RIGHT);
        } else if(route == ShellRoute::About) {
            handle_navigation_key(LV_KEY_LEFT);
        } else if(route != ShellRoute::DisplayInput) {
            handle_navigation_key(LV_KEY_ENTER);
        }
        return;
    }

    if(route == ShellRoute::Splash) {
        handle_navigation_key(LV_KEY_ENTER);
        return;
    }
    if(route == ShellRoute::Home && y >= 79U && y < 239U) {
        const std::size_t column = x >= 160U ? 1U : 0U;
        const std::size_t row = (y - 79U) / 32U;
        app_shell.setHomeSelection(row * 2U + column);
        handle_navigation_key(LV_KEY_ENTER);
        return;
    } else if(route == ShellRoute::OnboardingNetwork && y >= 48U && y < 192U) {
        onboarding_network_selection = (y - 48U) / 36U;
        handle_navigation_key(LV_KEY_ENTER);
        return;
    } else if(route == ShellRoute::RadioProfiles && y >= 24U && y < 194U) {
        app_shell.setProfileSelection((y - 24U) / 34U, builtinProfileCount());
        handle_navigation_key(LV_KEY_ENTER);
        return;
    } else if(route == ShellRoute::Settings && y >= 23U && y < 198U) {
        app_shell.setSettingsSelection((y - 23U) / 25U);
        handle_navigation_key(LV_KEY_ENTER);
        return;
    } else if(route == ShellRoute::DisplayInput && y >= 31U && y < 167U) {
        display_input_selection = (y - 31U) / 34U;
        build_current_screen();
        return;
    } else if(route == ShellRoute::SpectrumConfirmation && y >= 119U && y < 200U) {
        spectrum_confirmation_selection = (y - 119U) / 27U;
        handle_navigation_key(LV_KEY_ENTER);
        return;
    } else if(route == ShellRoute::ResetConfirmation && y >= 126U && y < 196U) {
        reset_confirmation_yes = ((y - 126U) / 35U) == 1U;
        handle_navigation_key(LV_KEY_ENTER);
        return;
    }

    if(route != ShellRoute::Analyzer) return;
    if(current_screen == Screen::traffic_filter && y >= 73U && y < 187U) {
        traffic_filter_selection = (y - 73U) / 38U;
        build_current_screen();
        return;
    }
    if(current_screen == Screen::traffic && y >= 28U && y < 238U) {
        const std::size_t row = (y - 28U) / 14U;
#if defined(LILYSHARK_DEVICE)
        const auto &store = capture_runtime.frames();
        if(store.empty()) return;
        const std::size_t selected_offset = resolve_traffic_selection();
        const TrafficFilterSnapshot filtered = trafficFilterSnapshot(store, traffic_filter);
        const std::size_t maximum_visible = filtered.matching_frames < 15U
            ? filtered.matching_frames : 15U;
        const std::size_t first_offset = selected_offset < maximum_visible
            ? 0U : selected_offset - maximum_visible + 1U;
        const std::size_t visible = (filtered.matching_frames - first_offset) < maximum_visible
            ? filtered.matching_frames - first_offset : maximum_visible;
        if(row >= visible) return;
        const FrameRecord *record = newestMatchingFrame(store, traffic_filter, first_offset + row);
        if(record == nullptr) return;
        traffic_selected_sequence = record->sequence;
#else
        const std::size_t matching_count = simulator_matching_sample_count();
        if(matching_count == 0U) return;
        const std::size_t selected_offset = resolve_simulator_traffic_selection();
        const std::size_t maximum_visible = matching_count < 15U ? matching_count : 15U;
        const std::size_t first_offset = selected_offset < maximum_visible
            ? 0U : selected_offset - maximum_visible + 1U;
        const std::size_t visible = (matching_count - first_offset) < maximum_visible
            ? matching_count - first_offset : maximum_visible;
        if(row >= visible) return;
        simulator_traffic_selection = first_offset + row;
        const simulator::TrafficSample *sample =
            simulator_matching_sample(simulator_traffic_selection);
        if(sample == nullptr) return;
        simulator_traffic_selected_sequence = sample->sequence;
#endif
        handle_navigation_key(LV_KEY_ENTER);
        return;
    }
    if(current_screen == Screen::nodes) {
#if defined(LILYSHARK_DEVICE)
        if(y < 46U || y >= 224U) return;
        const std::size_t row = (y - 46U) / 22U;
        std::array<LiveNodeSummary, 8> live_nodes{};
        const std::size_t count = collect_live_nodes(live_nodes);
        if(row >= count) return;
        node_selected_protocol = live_nodes[row].protocol;
        node_selected_id = live_nodes[row].id;
        node_selection_valid = true;
#else
        if(y < 46U || y >= 224U) return;
        const std::size_t row = (y - 46U) / 22U;
        if(row >= simulator_established_node_count()) return;
        simulator_node_selection = row;
        const simulator::NodeSnapshot *selected_node = simulator_established_node(row);
        simulator_node_selected_id = selected_node == nullptr ? 0U : selected_node->id;
        simulator_node_selection_valid = selected_node != nullptr;
#endif
        handle_navigation_key(LV_KEY_ENTER);
        return;
    }
    if(current_screen == Screen::events) {
        if(event_detail_open) {
            if(y >= 204U) handle_navigation_key(LV_KEY_ESC);
            return;
        }
#if defined(LILYSHARK_DEVICE)
        if(y < 27U || y >= 219U || runtime_event_history.empty()) return;
        const std::size_t row = (y - 27U) / 32U;
        const std::size_t candidate = events_scroll_offset + row;
        if(row >= 6U || candidate >= runtime_event_history.size()) return;
        events_scroll_offset = candidate;
#else
        if(y < 27U || y >= 219U) return;
        const simulator::EventsSnapshot &events = simulator_live_telemetry.events();
        const std::size_t row = (y - 27U) / 32U;
        const std::size_t candidate = events_scroll_offset + row;
        if(row >= 6U || candidate >= events.size) return;
        events_scroll_offset = candidate;
#endif
        event_detail_open = true;
        build_current_screen();
        return;
    }
    if(current_screen == Screen::packet_detail && x < 38U && y >= 27U && y < 214U) {
        const std::size_t row = (y - 27U) / 37U;
        if(row < packet_detail_tabs.size()) {
            packet_detail_tab = row;
            build_current_screen();
        }
        return;
    }
    if(current_screen == Screen::protocols && y >= 50U && y < 207U) {
        const std::size_t row = (y - 50U) / 26U;
        if(row < protocol_health_labels.size()) {
            protocols_selection = row;
            build_current_screen();
        }
        return;
    }
    if(current_screen == Screen::timeline && y >= 23U && y < 43U) {
        timeline_filter_selection = (timeline_filter_selection + 1U) % 5U;
        build_current_screen();
        return;
    }
    if((current_screen == Screen::spectrum || current_screen == Screen::survey) && y >= 176U) {
        handle_navigation_key(LV_KEY_ENTER);
    }
}

void handle_navigation_key(uint32_t key)
{
    const ShellRoute starting_route = app_shell.route();
    if(starting_route == ShellRoute::SpectrumConfirmation ||
       starting_route == ShellRoute::ResetConfirmation) {
        (void)handle_shell_navigation_key(key);
        return;
    }
    if(key >= '1' && key <= '8' && onboarding_complete &&
       !isOnboardingRoute(app_shell.route()) && app_shell.route() != ShellRoute::Splash) {
        constexpr std::array<Screen, 7> direct_views = {{
            Screen::traffic, Screen::spectrum, Screen::nodes, Screen::map,
            Screen::survey, Screen::utilization, Screen::events,
        }};
        if(key == '8') {
            app_shell.closeToAnalyzer();
            (void)app_shell.open(ShellRoute::Settings);
        } else {
            current_screen = direct_views[static_cast<std::size_t>(key - '1')];
            if(current_screen == Screen::events) {
                events_scroll_offset = 0U;
                event_detail_open = false;
            }
            app_shell.closeToAnalyzer();
            remember_primary_screen(current_screen);
        }
        build_current_screen();
        return;
    }
    if((key == '9' || key == 't' || key == 'T') && onboarding_complete &&
       !isOnboardingRoute(app_shell.route()) && app_shell.route() != ShellRoute::Splash) {
        current_screen = key == '9' ? Screen::protocols : Screen::timeline;
        app_shell.closeToAnalyzer();
        remember_primary_screen(current_screen);
        build_current_screen();
        return;
    }
    if(key == 'm' || key == 'M' || key == '0') {
        if(onboarding_complete && !isOnboardingRoute(app_shell.route()) &&
           app_shell.route() != ShellRoute::Splash) {
            if(app_shell.route() == ShellRoute::Home) {
                if(!app_shell.goBack()) app_shell.closeToAnalyzer();
            } else {
                event_detail_open = false;
                app_shell.closeToAnalyzer();
                (void)app_shell.open(ShellRoute::Home);
            }
            build_current_screen();
        }
        return;
    }
    if(key == '?') {
        if(app_shell.route() != ShellRoute::Splash) {
            (void)app_shell.open(ShellRoute::Help);
            build_current_screen();
        }
        return;
    }
    if(key == 'p' || key == 'P') {
        if(onboarding_complete && !isOnboardingRoute(app_shell.route()) &&
           app_shell.route() != ShellRoute::Splash) {
            shell_notice[0] = '\0';
#if defined(LILYSHARK_DEVICE)
            app_shell.setProfileSelection(active_profile_index, builtinProfileCount());
#else
            app_shell.setProfileSelection(simulator_active_profile_index, builtinProfileCount());
#endif
            (void)app_shell.open(ShellRoute::RadioProfiles);
            build_current_screen();
        }
        return;
    }
#if defined(LILYSHARK_DEVICE)
    if(key == 's' || key == 'S') {
        take_device_screenshot();
        return;
    }
#endif

    if(handle_shell_navigation_key(key)) return;

#if defined(LILYSHARK_DEVICE)
    if(key == '-' || key == '+') {
        apply_tuned_profile(stepProfileFrequency(radio_service.activeProfile(),
                                                 key == '+' ? 1 : -1),
                            key == '+' ? "frequency up" : "frequency down");
        return;
    }
    if(key == 'b' || key == 'B') {
        apply_tuned_profile(cycleProfileBandwidth(radio_service.activeProfile()), "bandwidth");
        return;
    }
    if(key == 'f' || key == 'F') {
        apply_tuned_profile(cycleProfileSpreadingFactor(radio_service.activeProfile()),
                            "spreading factor");
        return;
    }
    if(key == 'c' || key == 'C') {
        apply_tuned_profile(cycleProfileCodingRate(radio_service.activeProfile()), "coding rate");
        return;
    }
#endif

    if((key == 'x' || key == 'X') && current_screen == Screen::traffic) {
        traffic_filter_selection = 0U;
        current_screen = Screen::traffic_filter;
        build_current_screen();
        return;
    }
    if((key == 'r' || key == 'R') && current_screen == Screen::traffic_filter) {
        traffic_filter = TrafficFilter{};
#if defined(LILYSHARK_DEVICE)
        traffic_selected_sequence = 0U;
#endif
        simulator_traffic_selection = 0U;
        simulator_traffic_selected_sequence = 0U;
        build_current_screen();
        return;
    }

    if(key == LV_KEY_ENTER || key == '\r') {
        if(current_screen == Screen::events) {
#if defined(LILYSHARK_DEVICE)
            if(runtime_event_history.empty()) return;
#endif
            event_detail_open = true;
            build_current_screen();
            return;
        }
        if(current_screen == Screen::protocols) {
            current_screen = Screen::protocol_detail;
            build_current_screen();
            return;
        }
        if(current_screen == Screen::protocol_detail) {
            traffic_filter = TrafficFilter{};
            switch(protocols_selection % protocol_health_labels.size()) {
                case 0U: traffic_filter.protocol = TrafficProtocolPredicate::Meshtastic; break;
                case 1U: traffic_filter.protocol = TrafficProtocolPredicate::MeshCore; break;
                case 2U: traffic_filter.protocol = TrafficProtocolPredicate::Reticulum; break;
                case 3U: traffic_filter.protocol = TrafficProtocolPredicate::Custom; break;
                case 4U: traffic_filter.protocol = TrafficProtocolPredicate::Unknown; break;
                case 5U: traffic_filter.decode = TrafficDecodePredicate::Malformed; break;
                default: break;
            }
            if((protocols_selection % protocol_health_labels.size()) != 5U) {
                traffic_filter.decode = TrafficDecodePredicate::NonMalformed;
            }
#if defined(LILYSHARK_DEVICE)
            traffic_selected_sequence = 0U;
#endif
            simulator_traffic_selection = 0U;
            simulator_traffic_selected_sequence = 0U;
            current_screen = Screen::traffic;
            build_current_screen();
            return;
        }
        if(current_screen == Screen::traffic_filter) {
#if defined(LILYSHARK_DEVICE)
            traffic_selected_sequence = 0U;
#endif
            simulator_traffic_selection = 0U;
            simulator_traffic_selected_sequence = 0U;
            current_screen = Screen::traffic;
            build_current_screen();
            return;
        }
#if defined(LILYSHARK_DEVICE)
        if(current_screen == Screen::spectrum) {
            if(spectrum_buffer == nullptr) return;
            if(app_settings.simulate_mode) {
                record_runtime_event(RuntimeEventSeverity::Warning,
                                     RuntimeEventType::Spectrum,
                                     "Spectrum requires live RF; turn off Simulate mode");
            } else if(radio_service.spectrumStatus().active()) {
                radio_service.cancelSpectrumSweep();
                record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Spectrum,
                                     "Spectrum scan cancelled; restoring packet receive");
            } else if(survey_running) {
                record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Spectrum,
                                     "Spectrum scan blocked while survey is running");
            } else if(!app_settings.spectrum_warning_acknowledged) {
                spectrum_confirmation_selection = spectrum_scan_mode == SpectrumScanMode::FastNarrow
                    ? 1U : 2U;
                (void)app_shell.open(ShellRoute::SpectrumConfirmation);
            } else {
                const SpectrumSweepRequest request = spectrum_request_for_profile(
                    radio_service.activeProfile(), spectrum_scan_mode);
                if(radio_service.startSpectrumSweep(request)) {
                    record_runtime_event(RuntimeEventSeverity::Info, RuntimeEventType::Spectrum,
                                         "Spectrum scan started; packet receive paused");
                } else {
                    record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Spectrum,
                                         "Spectrum scan could not start");
                }
            }
            build_current_screen();
        } else if(current_screen == Screen::traffic && select_current_frame_for_detail()) {
            packet_detail_tab = 0U;
            packet_detail_byte_offset = 0U;
            current_screen = Screen::packet_detail;
            build_current_screen();
        } else if(current_screen == Screen::nodes && select_current_node_for_detail()) {
            current_screen = Screen::node_detail;
            build_current_screen();
        } else if(current_screen == Screen::survey) {
            if(survey_running) {
                survey_running = false;
                survey_has_result = false;
                survey_elapsed_ms = 0U;
                survey_accumulator.reset();
                record_runtime_event(RuntimeEventSeverity::Warning,
                                     RuntimeEventType::Survey,
                                     "Field survey cancelled by operator");
            } else if(radio_service.spectrumStatus().active()) {
                record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Survey,
                                     "Survey blocked while spectrum scan is running");
            } else if(!app_settings.simulate_mode && !radio_service.status().receiving) {
                record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Survey,
                                     "Survey unavailable while packet receive is offline");
            } else {
                survey_accumulator.reset();
                survey_running = true;
                survey_has_result = false;
                survey_elapsed_ms = 0U;
                survey_last_accounted_ms = millis();
                record_runtime_event(RuntimeEventSeverity::Info, RuntimeEventType::Survey,
                                     app_settings.simulate_mode
                                         ? "60-second simulated survey started"
                                         : "60-second field survey started");
            }
            build_current_screen();
        }
#else
        if(current_screen == Screen::spectrum) {
            if(simulator_spectrum_scanning) {
                const std::uint32_t elapsed = simulator_live_telemetry.elapsedMilliseconds() -
                                              simulator_spectrum_started_ms;
                const std::uint16_t total_points = simulator_spectrum_total_points();
                simulator_spectrum_partial_points = static_cast<std::uint16_t>(
                    (elapsed / 50U) > total_points ? total_points : elapsed / 50U);
                simulator_spectrum_scanning = false;
                simulator_spectrum_cancelled = true;
                simulator_live_telemetry.setCapturePaused(false);
            } else if(simulator_survey_running ||
                      simulator_live_telemetry.survey().running) {
                // A field survey measures received packets; the single SX1262
                // cannot simultaneously sweep and receive them.
            } else if(!app_settings.spectrum_warning_acknowledged) {
                spectrum_confirmation_selection = spectrum_scan_mode == SpectrumScanMode::FastNarrow
                    ? 1U : 2U;
                (void)app_shell.open(ShellRoute::SpectrumConfirmation);
            } else {
                simulator_spectrum_scanning = true;
                simulator_spectrum_started_ms = simulator_live_telemetry.elapsedMilliseconds();
                simulator_spectrum_partial_points = 0U;
                simulator_spectrum_cancelled = false;
                simulator_live_telemetry.setCapturePaused(true);
            }
            build_current_screen();
        } else if(current_screen == Screen::traffic) {
            if(select_simulator_packet_for_detail()) {
                packet_detail_tab = 0U;
                packet_detail_byte_offset = 0U;
                current_screen = Screen::packet_detail;
                build_current_screen();
            }
        } else if(current_screen == Screen::nodes) {
            (void)resolve_simulator_node_selection();
            const simulator::NodeSnapshot *selected_node =
                simulator_established_node(simulator_node_selection);
            if(selected_node != nullptr) {
                simulator_node_detail_id = selected_node->id;
                simulator_node_detail_selection_valid = true;
                current_screen = Screen::node_detail;
                build_current_screen();
            }
        } else if(current_screen == Screen::survey) {
            if(simulator_survey_running) {
                simulator_survey_running = false;
                (void)simulator_live_telemetry.setSurveyRunning(false);
            } else if(!simulator_spectrum_scanning) {
                simulator_survey_running = true;
                (void)simulator_live_telemetry.setSurveyRunning(true);
            }
            build_current_screen();
        }
#endif
        return;
    }
    if(key == LV_KEY_ESC || key == 0x08U) {
        if(current_screen == Screen::events && event_detail_open) {
            event_detail_open = false;
        } else if(current_screen == Screen::protocol_detail) current_screen = Screen::protocols;
        else if(current_screen == Screen::traffic_filter) current_screen = Screen::traffic;
        else if(current_screen == Screen::packet_detail) current_screen = Screen::traffic;
        else if(current_screen == Screen::node_detail) current_screen = Screen::nodes;
        else {
            (void)app_shell.open(ShellRoute::Home);
            build_current_screen();
            return;
        }
        build_current_screen();
        return;
    }
    if(key == LV_KEY_DOWN || key == LV_KEY_UP) {
        const int direction = key == LV_KEY_DOWN ? 1 : -1;
        bool moved = false;
        if(current_screen == Screen::traffic_filter) {
            traffic_filter_selection = direction > 0
                ? (traffic_filter_selection + 1U) % 3U
                : (traffic_filter_selection == 0U ? 2U : traffic_filter_selection - 1U);
            moved = true;
        } else if(current_screen == Screen::protocols) {
            protocols_selection = direction > 0
                ? (protocols_selection + 1U) % protocol_health_labels.size()
                : (protocols_selection == 0U ? protocol_health_labels.size() - 1U
                                              : protocols_selection - 1U);
            moved = true;
        } else if(current_screen == Screen::protocol_detail) {
            protocols_selection = direction > 0
                ? (protocols_selection + 1U) % protocol_health_labels.size()
                : (protocols_selection == 0U ? protocol_health_labels.size() - 1U
                                              : protocols_selection - 1U);
            moved = true;
        } else if(current_screen == Screen::timeline) {
            timeline_filter_selection = direction > 0
                ? (timeline_filter_selection + 1U) % 5U
                : (timeline_filter_selection == 0U ? 4U : timeline_filter_selection - 1U);
            moved = true;
        } else if(current_screen == Screen::spectrum) {
#if defined(LILYSHARK_DEVICE)
            const bool scan_active = radio_service.spectrumStatus().active();
#else
            const bool scan_active = simulator_spectrum_scanning;
#endif
            if(!scan_active) {
                spectrum_scan_mode = spectrum_scan_mode == SpectrumScanMode::FastNarrow
                    ? SpectrumScanMode::DeepBand : SpectrumScanMode::FastNarrow;
#if defined(LILYSHARK_DEVICE)
                radio_service.clearSpectrumResult();
#else
                simulator_spectrum_partial_points = 0U;
                simulator_spectrum_cancelled = false;
                simulator_spectrum_started_ms =
                    simulator_live_telemetry.elapsedMilliseconds();
#endif
                moved = true;
            }
        }
#if defined(LILYSHARK_DEVICE)
        else if(current_screen == Screen::traffic) moved = move_traffic_selection(direction);
        else if(current_screen == Screen::nodes) moved = move_node_selection(direction);
        else if(current_screen == Screen::packet_detail && packet_detail_tab == 3U) {
            const FrameRecord *record = find_live_frame(packet_detail_sequence);
            if(record != nullptr) {
                constexpr std::size_t bytes_per_page = 40U;
                const std::size_t page_count = record->raw.captured_length == 0U ? 1U :
                    (record->raw.captured_length + bytes_per_page - 1U) / bytes_per_page;
                const std::size_t current_page = packet_detail_byte_offset / bytes_per_page;
                const std::size_t next_page = direction > 0
                    ? (current_page + 1U < page_count ? current_page + 1U : current_page)
                    : (current_page == 0U ? 0U : current_page - 1U);
                if(next_page != current_page) {
                    packet_detail_byte_offset = next_page * bytes_per_page;
                    moved = true;
                }
            }
        } else if(current_screen == Screen::events) {
            constexpr std::size_t maximum_visible = 6U;
            const std::size_t maximum_offset = event_detail_open
                ? (runtime_event_history.empty() ? 0U : runtime_event_history.size() - 1U)
                : (runtime_event_history.size() > maximum_visible
                    ? runtime_event_history.size() - maximum_visible : 0U);
            const std::size_t next_offset = direction > 0
                ? (events_scroll_offset < maximum_offset ? events_scroll_offset + 1U
                                                         : events_scroll_offset)
                : (events_scroll_offset == 0U ? 0U : events_scroll_offset - 1U);
            if(next_offset != events_scroll_offset) {
                events_scroll_offset = next_offset;
                moved = true;
            }
        }
#else
        else if(current_screen == Screen::traffic) {
            moved = move_simulator_traffic_selection(direction);
        } else if(current_screen == Screen::nodes) {
            const std::size_t node_count = simulator_established_node_count();
            if(node_count == 0U) return;
            const std::size_t selected_index = resolve_simulator_node_selection();
            if(direction > 0) {
                simulator_node_selection = (selected_index + 1U) % node_count;
            } else {
                simulator_node_selection = selected_index == 0U
                    ? node_count - 1U : selected_index - 1U;
            }
            const simulator::NodeSnapshot *selected_node =
                simulator_established_node(simulator_node_selection);
            simulator_node_selected_id = selected_node == nullptr ? 0U : selected_node->id;
            simulator_node_selection_valid = selected_node != nullptr;
            moved = true;
        } else if(current_screen == Screen::packet_detail && packet_detail_tab == 3U) {
            constexpr std::size_t bytes_per_page = 40U;
            const std::size_t page_count = simulator_packet_detail_sample_valid
                ? (simulator_packet_detail_sample.captured_bytes + bytes_per_page - 1U) /
                    bytes_per_page
                : 1U;
            const std::size_t current_page = packet_detail_byte_offset / bytes_per_page;
            const std::size_t next_page = direction > 0
                ? (current_page + 1U < page_count ? current_page + 1U : current_page)
                : (current_page == 0U ? 0U : current_page - 1U);
            moved = next_page != current_page;
            packet_detail_byte_offset = next_page * bytes_per_page;
        } else if(current_screen == Screen::events) {
            const std::size_t event_count = simulator_live_telemetry.events().size;
            constexpr std::size_t maximum_visible = 6U;
            const std::size_t maximum_offset = event_detail_open
                ? (event_count == 0U ? 0U : event_count - 1U)
                : (event_count > maximum_visible ? event_count - maximum_visible : 0U);
            const std::size_t next_offset = direction > 0
                ? (events_scroll_offset < maximum_offset ? events_scroll_offset + 1U
                                                         : events_scroll_offset)
                : (events_scroll_offset == 0U ? 0U : events_scroll_offset - 1U);
            moved = next_offset != events_scroll_offset;
            events_scroll_offset = next_offset;
        }
#endif
        if(moved) build_current_screen();
        return;
    }
    if(current_screen == Screen::traffic_filter &&
       (key == LV_KEY_RIGHT || key == LV_KEY_NEXT ||
        key == LV_KEY_LEFT || key == LV_KEY_PREV)) {
        const bool next = key == LV_KEY_RIGHT || key == LV_KEY_NEXT;
        if(traffic_filter_selection == 0U) {
            traffic_filter.protocol = next
                ? nextTrafficProtocolPredicate(traffic_filter.protocol)
                : previousTrafficProtocolPredicate(traffic_filter.protocol);
        } else if(traffic_filter_selection == 1U) {
            traffic_filter.decode = next
                ? nextTrafficDecodePredicate(traffic_filter.decode)
                : previousTrafficDecodePredicate(traffic_filter.decode);
        } else {
            traffic_filter.crc = next
                ? nextTrafficCrcPredicate(traffic_filter.crc)
                : previousTrafficCrcPredicate(traffic_filter.crc);
        }
        build_current_screen();
        return;
    }
    if(current_screen == Screen::packet_detail &&
       (key == LV_KEY_RIGHT || key == LV_KEY_NEXT ||
        key == LV_KEY_LEFT || key == LV_KEY_PREV)) {
        const bool next = key == LV_KEY_RIGHT || key == LV_KEY_NEXT;
        packet_detail_tab = next
            ? (packet_detail_tab + 1U) % packet_detail_tabs.size()
            : (packet_detail_tab == 0U ? packet_detail_tabs.size() - 1U
                                        : packet_detail_tab - 1U);
        build_current_screen();
        return;
    }
    if(current_screen == Screen::protocol_detail &&
       (key == LV_KEY_RIGHT || key == LV_KEY_NEXT ||
        key == LV_KEY_LEFT || key == LV_KEY_PREV)) {
        const bool next = key == LV_KEY_RIGHT || key == LV_KEY_NEXT;
        protocols_selection = next
            ? (protocols_selection + 1U) % protocol_health_labels.size()
            : (protocols_selection == 0U ? protocol_health_labels.size() - 1U
                                          : protocols_selection - 1U);
        build_current_screen();
        return;
    }
    if(key == LV_KEY_RIGHT || key == LV_KEY_NEXT) {
        move_primary_screen(1);
        return;
    }
    if(key == LV_KEY_LEFT || key == LV_KEY_PREV) {
        move_primary_screen(-1);
        return;
    }

    return;
}

#if !defined(LILYSHARK_DEVICE)
bool expect_simulator_state(bool condition, const char *step) noexcept
{
    if(condition) return true;
    std::fprintf(stderr, "Simulator interaction failed: %s\n", step);
    return false;
}

bool run_simulator_interaction_test() noexcept
{
    app_shell = AppShell{};
    app_settings = defaultAppSettings();
    onboarding_complete = false;
    onboarding_save_failed = false;
    onboarding_network_selection = 0U;
    onboarding_profile_selection = 0U;
    display_input_selection = 0U;
    reset_confirmation_yes = false;
    shell_notice[0] = '\0';
    simulator_active_profile_index = 0U;
    current_screen = Screen::traffic;
    simulator_traffic_selection = 5;
    simulator_traffic_selected_sequence = 0U;
    simulator_packet_detail_selection = 5;
    simulator_packet_detail_sample_valid = false;
    simulator_node_selection = 2;
    simulator_node_selected_id = 0U;
    simulator_node_selection_valid = false;
    simulator_node_detail_id = 0U;
    simulator_node_detail_selection_valid = false;
    simulator_spectrum_scanning = false;
    simulator_survey_running = false;
    simulator_live_telemetry.reset();
    traffic_filter = TrafficFilter{};
    traffic_filter_selection = 0U;
    focus_simulator_inspector_packet();
    protocols_selection = 0U;
    timeline_filter_selection = 0U;
    build_current_screen();

    if(!expect_simulator_state(app_shell.route() == ShellRoute::Splash,
                               "a fresh launch must begin on the logo splash")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingWelcome,
                               "the splash must enter first-run setup")) return false;
    handle_navigation_key('?');
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Help,
                               "first-run Controls hint must open Help")) return false;
    handle_navigation_key('1');
    handle_navigation_key('M');
    handle_navigation_key('P');
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Help,
                               "Help must not bypass unfinished onboarding")) return false;
    handle_navigation_key(0x08U);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingWelcome,
                               "Help Back must restore first-run setup")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingCapabilities,
                               "setup must explain Lilyshark's diagnostic capabilities")) return false;
    handle_touch_tap(20U, 220U);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingWelcome,
                               "the onboarding BACK action must retreat instead of advancing")) {
        return false;
    }
    handle_navigation_key(LV_KEY_ENTER);
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingNetwork,
                               "capabilities must lead to the network choice")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(onboarding_network_selection == 1U,
                               "network selection must move to MeshCore")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingProfile,
                               "network choice must open profile selection")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(onboarding_profile_selection == 1U,
                               "profile selection must expose every matching preset")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingControls &&
                               simulator_active_profile_index == 2U,
                               "applying setup must teach the field controls")) return false;
    handle_navigation_key(0x08U);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingProfile,
                               "Back from controls must return to the profile step")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingReadiness,
                               "controls must lead to the hardware readiness check")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Home &&
                               onboarding_complete && app_settings.onboarding_complete,
                               "finishing setup must persist the completed state and open Home")) return false;

    handle_touch_tap(200U, 90U);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Analyzer &&
                               current_screen == Screen::spectrum,
                               "Home touch hit testing must open the selected diagnostic")) return false;
    handle_navigation_key('M');
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Home,
                               "M must return any diagnostic to Home")) return false;
    handle_navigation_key('8');
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Settings,
                               "8 must open Settings")) return false;
    handle_touch_tap(24U, 58U);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Storage,
                               "Settings touch hit testing must open Capture & Storage")) return false;
    const bool capture_was_enabled = app_settings.capture_enabled;
    handle_touch_tap(24U, 100U);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Storage &&
                               app_settings.capture_enabled == capture_was_enabled,
                               "tapping Storage information must not toggle capture")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_settings.capture_enabled != capture_was_enabled,
                               "Capture & Storage must expose an explicit recording toggle")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    handle_navigation_key(0x08U);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Settings,
                               "Back must return from a Settings detail")) return false;

    handle_navigation_key('P');
    if(!expect_simulator_state(app_shell.route() == ShellRoute::RadioProfiles &&
                               app_shell.profileSelection() == simulator_active_profile_index,
                               "P must open Radio Profiles focused on the active preset")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    const std::size_t chosen_profile = app_shell.profileSelection();
    handle_navigation_key(LV_KEY_ENTER);
    const RadioProfile &chosen_radio_profile = builtinProfiles()[chosen_profile];
    if(!expect_simulator_state(simulator_active_profile_index == chosen_profile &&
                               simulator_live_telemetry.activeProtocol() ==
                                   simulator_protocol_for_profile(chosen_radio_profile) &&
                               simulator_live_telemetry.activeRfProfile().center_frequency_hz ==
                                   chosen_radio_profile.center_frequency_hz &&
                               simulator_live_telemetry.activeRfProfile().bandwidth_hz ==
                                   chosen_radio_profile.bandwidth_hz &&
                               std::strstr(shell_notice, "LISTENING") != nullptr,
                               "applying a profile must update the active radio and telemetry context")) return false;
    handle_navigation_key(0x08U);

    app_shell.setSettingsSelection(static_cast<std::size_t>(SettingsItem::RadioProfiles));
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::RadioProfiles &&
                               app_shell.profileSelection() == simulator_active_profile_index,
                               "Settings must open Radio Profiles on the active preset")) return false;
    handle_navigation_key(0x08U);

    handle_navigation_key('?');
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Help,
                               "? must open Help")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::About,
                               "Help must link to About")) return false;
    handle_navigation_key(LV_KEY_LEFT);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Help,
                               "About must link back to Help")) return false;
    handle_navigation_key(0x08U);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Settings,
                               "Help Back must restore its caller")) return false;

    app_shell.setSettingsSelection(static_cast<std::size_t>(SettingsItem::DisplayInput));
    handle_navigation_key(LV_KEY_ENTER);
    const std::uint8_t original_display_brightness = app_settings.display_brightness;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::DisplayInput &&
                               app_settings.display_brightness != original_display_brightness,
                               "Display settings must adjust the selected brightness")) return false;
    const bool gps_was_enabled = app_settings.gps_enabled;
    handle_navigation_key(LV_KEY_DOWN);
    handle_navigation_key(LV_KEY_DOWN);
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(display_input_selection == 2U &&
                               app_settings.gps_enabled != gps_was_enabled,
                               "Display & Input must expose the optional GPS toggle")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(display_input_selection == 3U &&
                               app_settings.resume_last_view,
                               "Display & Input must expose startup-view behavior")) return false;
    handle_navigation_key(0x08U);

    app_shell.setSettingsSelection(static_cast<std::size_t>(SettingsItem::ResetSetup));
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::ResetConfirmation,
                               "Run Setup Again must require confirmation")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Settings && onboarding_complete,
                               "the safe reset default must preserve setup")) return false;
    app_shell.setSettingsSelection(static_cast<std::size_t>(SettingsItem::ResetSetup));
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(!reset_confirmation_yes,
                               "reopening Reset Setup must focus the safe NO choice")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::OnboardingWelcome &&
                               !onboarding_complete && !app_settings.onboarding_complete,
                               "confirmed reset must return to first-run setup")) return false;

    app_settings = defaultAppSettings();
    app_settings.onboarding_version = kAppSettingsOnboardingVersion;
    app_settings.onboarding_complete = true;
    onboarding_complete = true;
    app_shell.closeToAnalyzer();
    current_screen = Screen::traffic;
    build_current_screen();
    const std::size_t starting_traffic_selection = simulator_traffic_selection;
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(current_screen == Screen::traffic &&
                               simulator_traffic_selection == starting_traffic_selection + 1U,
                               "Down must move the Traffic focus")) return false;
    handle_navigation_key(LV_KEY_UP);
    if(!expect_simulator_state(simulator_traffic_selection == starting_traffic_selection,
                               "Up must move the Traffic focus")) return false;

    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(current_screen == Screen::packet_detail &&
                               simulator_packet_detail_sample_valid && packet_detail_tab == 0U,
                               "Enter must open the focused Packet Detail")) return false;
    DecodedPacket inspector_decoded{};
    if(!expect_simulator_state(
            decode_simulator_packet(simulator_packet_detail_sample, inspector_decoded) &&
            inspector_decoded.protocol == ProtocolId::Meshtastic &&
            inspector_decoded.state == DecodeState::HeaderOnly &&
            inspector_decoded.hasField(FieldSource) &&
            inspector_decoded.hasField(FieldPacketId) &&
            inspector_decoded.payload_offset == simulator_packet_detail_sample.payload_offset &&
            inspector_decoded.payload_length == simulator_packet_detail_sample.payload_bytes,
            "Packet Detail must use a real decoder-consistent structural frame")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(packet_detail_tab == 1U,
                               "Packet Detail must expose RF metadata")) return false;
    if(!expect_simulator_state(
            simulator_packet_detail_sample.preamble_symbols > 0U &&
            simulator_packet_detail_sample.sync_word == 0x002bU &&
            simulator_packet_detail_sample.profile_id == 1U &&
            simulator_packet_detail_sample.airtime_us > 0U,
            "Packet RF must retain capture-time preamble, sync, profile and airtime")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(packet_detail_tab == 2U,
                               "Packet Detail must expose decoder analysis")) return false;
    if(!expect_simulator_state(
            inspector_decoded.present_fields != FieldNone &&
            inspector_decoded.protocol_flags ==
                static_cast<std::uint32_t>(simulator_packet_detail_sample.byteAt(12U)),
            "Packet DEC must expose the real decoder fields and flags")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(packet_detail_tab == 3U,
                               "Packet Detail must expose a paged hex view")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(packet_detail_byte_offset == 40U,
                               "Packet Detail Down must show the second HEX page")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(packet_detail_byte_offset == 80U,
                               "Packet Detail must reach the bounded final HEX page")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(packet_detail_byte_offset == 80U,
                               "Packet Detail must not move beyond the final page")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(packet_detail_tab == 4U,
                               "Packet Detail must expose raw capture provenance")) return false;
    handle_navigation_key(0x08U);
    if(!expect_simulator_state(current_screen == Screen::traffic,
                               "Back must return from Packet Detail")) return false;

    for(std::size_t step = 0U;
        step < simulator::kTrafficHistoryCapacity && simulator_traffic_selection < 16U;
        ++step) {
        handle_navigation_key(LV_KEY_DOWN);
    }
    const std::uint64_t retained_selection = simulator_traffic_selected_sequence;
    if(!expect_simulator_state(simulator_traffic_selection == 16U &&
                               retained_selection != 0U,
                               "Traffic must scroll beyond its first fifteen retained rows")) {
        return false;
    }
    const std::uint64_t traffic_generation_before =
        simulator_live_telemetry.traffic().generation;
    for(std::size_t step = 0U; step < 4U; ++step) {
        advance_simulator_live_data(1000U);
    }
    if(!expect_simulator_state(
            simulator_live_telemetry.traffic().generation > traffic_generation_before &&
            simulator_traffic_selected_sequence == retained_selection &&
            resolve_simulator_traffic_selection() > 16U,
            "a live arrival must not change the selected retained packet")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(current_screen == Screen::packet_detail &&
                               simulator_packet_detail_sample.sequence == retained_selection,
                               "Packet Detail must bind to the stable retained selection")) return false;
    handle_navigation_key(0x08U);
    simulator_traffic_selection = 5U;
    const simulator::TrafficSample *reset_selection = simulator_matching_sample(5U);
    simulator_traffic_selected_sequence =
        reset_selection == nullptr ? 0U : reset_selection->sequence;
    build_current_screen();
    handle_touch_tap(20U, 129U);
    if(!expect_simulator_state(current_screen == Screen::packet_detail &&
                               simulator_packet_detail_selection == 7U,
                               "tapping a Traffic row must open the tapped packet")) return false;
    handle_navigation_key(0x08U);

    handle_navigation_key('9');
    if(!expect_simulator_state(current_screen == Screen::protocols,
                               "direct key 9 must open Protocols")) return false;
    {
        const ProtocolHealthSnapshot health = current_protocol_health();
        std::uint32_t partition_total = 0U;
        for(const std::uint32_t frames : health.rows) partition_total += frames;
        if(!expect_simulator_state(
                partition_total == health.total &&
                health.decoded == health.rows[0] + health.rows[1] + health.rows[2] +
                                  health.rows[3] &&
                (health.rows[4] == 0U || health.health_metrics_available[4]),
                                   "Protocol rows must be an exclusive partition")) return false;
    }
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(protocols_selection == 1U,
                               "Protocols Down must move the focused class")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(current_screen == Screen::protocol_detail,
                               "Protocols Enter must open class health detail")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(current_screen == Screen::traffic && traffic_filter.active() &&
                               traffic_filter.protocol == TrafficProtocolPredicate::MeshCore,
                               "Protocol Detail Enter must filter Traffic to its class")) return false;
    handle_navigation_key('X');
    if(!expect_simulator_state(current_screen == Screen::traffic_filter,
                               "Traffic must expose its filter tool")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(traffic_filter.protocol == TrafficProtocolPredicate::Reticulum,
                               "Traffic Filter must cycle protocol predicates")) return false;
    handle_navigation_key('R');
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(current_screen == Screen::traffic && !traffic_filter.active(),
                               "Traffic Filter reset must restore the complete inspection list")) return false;
    handle_navigation_key('T');
    if(!expect_simulator_state(current_screen == Screen::timeline,
                               "direct key T must open Timeline")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(timeline_filter_selection == 1U,
                               "Timeline Down must select a protocol filter")) return false;

    handle_navigation_key('2');
    if(!expect_simulator_state(current_screen == Screen::spectrum,
                               "direct key 2 must open Spectrum")) return false;
    {
        const SpectrumSweepRequest eu_request = spectrum_request_for_profile(
            builtinProfiles()[3U], SpectrumScanMode::DeepBand);
        const simulator::SpectrumSnapshot &spectrum = simulator_live_telemetry.spectrum();
        const std::uint32_t busy = simulator_spectrum_metric_frequency_hz(
            eu_request, spectrum.busiest_frequency_khz);
        const std::uint32_t quiet = simulator_spectrum_metric_frequency_hz(
            eu_request, spectrum.quietest_frequency_khz);
        if(!expect_simulator_state(busy >= eu_request.start_frequency_hz &&
                                   busy <= eu_request.end_frequency_hz &&
                                   quiet >= eu_request.start_frequency_hz &&
                                   quiet <= eu_request.end_frequency_hz,
                                   "Spectrum metrics must stay inside the active request")) return false;
    }
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::SpectrumConfirmation &&
                               !simulator_spectrum_scanning,
                               "the first scan must explain that packet capture pauses")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Analyzer &&
                               simulator_spectrum_scanning &&
                               app_settings.spectrum_warning_acknowledged,
                               "confirming the warning must start the simulated spectrum scan")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(!simulator_spectrum_scanning,
                               "Enter must cancel the simulated spectrum scan")) return false;

    handle_navigation_key('3');
    if(!expect_simulator_state(current_screen == Screen::nodes,
                               "direct key 3 must open Nodes")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(simulator_node_selection == 3,
                               "Down must move the Nodes focus")) return false;
    const std::uint32_t anchored_node_id = simulator_node_selected_id;
    for(std::size_t second = 0U; second < 12U; ++second) {
        advance_simulator_live_data(1000U);
    }
    (void)resolve_simulator_node_selection();
    const simulator::NodeSnapshot *anchored_node =
        simulator_established_node(simulator_node_selection);
    if(!expect_simulator_state(
            anchored_node_id != 0U && anchored_node != nullptr &&
            anchored_node->id == anchored_node_id,
            "Nodes focus must stay anchored to identity while new nodes arrive")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(current_screen == Screen::node_detail,
                               "Enter must open Node Detail")) return false;
    handle_navigation_key(0x08U);
    if(!expect_simulator_state(current_screen == Screen::nodes,
                               "Back must return from Node Detail")) return false;
    const std::size_t visible_node_count = simulator_established_node_count();
    const std::size_t tapped_node_row = visible_node_count > 5U
        ? 5U : (visible_node_count == 0U ? 0U : visible_node_count - 1U);
    const simulator::NodeSnapshot *tapped_node =
        simulator_established_node(tapped_node_row);
    handle_touch_tap(20U, static_cast<std::uint16_t>(48U + tapped_node_row * 22U));
    if(!expect_simulator_state(current_screen == Screen::node_detail &&
                               simulator_node_selection == tapped_node_row &&
                               tapped_node != nullptr &&
                               simulator_node_detail_id == tapped_node->id,
                               "tapping a Nodes row must open the tapped node")) return false;
    handle_navigation_key(0x08U);

    handle_navigation_key('5');
    if(!expect_simulator_state(current_screen == Screen::survey,
                               "direct key 5 must open Survey")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(simulator_survey_running &&
                               std::strcmp(simulator_survey_footer(),
                                           "ENTER  CANCEL SURVEY") == 0,
                               "Enter must start a consistent Survey state")) return false;

    const std::uint32_t survey_elapsed_before_conflict =
        simulator_live_telemetry.survey().elapsed_ms;
    handle_navigation_key('2');
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(!simulator_spectrum_scanning && simulator_survey_running &&
                               !simulator_live_telemetry.capturePaused(),
                               "Spectrum must not take the receiver from an active Survey")) return false;
    advance_simulator_live_data(1000U);
    if(!expect_simulator_state(simulator_live_telemetry.survey().elapsed_ms >
                                   survey_elapsed_before_conflict,
                               "Survey observation time must advance only while RX is available")) {
        return false;
    }
    handle_navigation_key('5');
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(!simulator_survey_running &&
                               !simulator_live_telemetry.survey().running &&
                               simulator_live_telemetry.survey().elapsed_ms == 0U,
                               "Enter must cancel and discard an incomplete Survey")) return false;

    handle_navigation_key('6');
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Analyzer &&
                               current_screen == Screen::events,
                               "Right from Airtime must preserve the legacy Events position")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(event_detail_open && events_scroll_offset == 0U,
                               "Events Enter must open the full selected message")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(event_detail_open && events_scroll_offset == 1U,
                               "Event Detail Down must move to the next complete event")) return false;
    handle_navigation_key(LV_KEY_ESC);
    if(!expect_simulator_state(!event_detail_open && current_screen == Screen::events,
                               "Event Detail Back must restore the Events list")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(current_screen == Screen::protocols,
                               "Right from Events must reach Protocols")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(current_screen == Screen::timeline,
                               "Right from Protocols must reach Timeline")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Home,
                               "Right from the last diagnostic must open Home")) return false;
    handle_navigation_key('1');
    handle_navigation_key(LV_KEY_LEFT);
    if(!expect_simulator_state(app_shell.route() == ShellRoute::Home,
                               "Left from the first diagnostic must open Home")) return false;

    std::fprintf(stderr, "Lilyshark simulator interaction test passed\n");
    return true;
}

constexpr std::size_t simulator_frame_pixel_count =
    static_cast<std::size_t>(theme::screen_width) *
    static_cast<std::size_t>(theme::screen_height);
alignas(4) std::array<std::uint16_t, simulator_frame_pixel_count> simulator_frame_buffer{};

void simulator_frame_flush(lv_display_t *display, const lv_area_t *, std::uint8_t *) noexcept
{
    lv_display_flush_ready(display);
}

std::uint64_t hash_simulator_frame() noexcept
{
    // Hash logical RGB565 values in a fixed byte order so the golden output is
    // independent of host endianness.
    std::uint64_t hash = 14695981039346656037ULL;
    for(const std::uint16_t pixel : simulator_frame_buffer) {
        hash ^= static_cast<std::uint8_t>(pixel >> 8U);
        hash *= 1099511628211ULL;
        hash ^= static_cast<std::uint8_t>(pixel & 0xffU);
        hash *= 1099511628211ULL;
    }
    return hash;
}

std::uint64_t hash_simulator_region(std::size_t x, std::size_t y,
                                    std::size_t width, std::size_t height) noexcept
{
    std::uint64_t hash = 14695981039346656037ULL;
    const std::size_t maximum_x = (x + width) < static_cast<std::size_t>(theme::screen_width)
        ? x + width : static_cast<std::size_t>(theme::screen_width);
    const std::size_t maximum_y = (y + height) < static_cast<std::size_t>(theme::screen_height)
        ? y + height : static_cast<std::size_t>(theme::screen_height);
    for(std::size_t row = y; row < maximum_y; ++row) {
        for(std::size_t column = x; column < maximum_x; ++column) {
            const std::uint16_t pixel = simulator_frame_buffer[
                row * static_cast<std::size_t>(theme::screen_width) + column];
            hash ^= static_cast<std::uint8_t>(pixel >> 8U);
            hash *= 1099511628211ULL;
            hash ^= static_cast<std::uint8_t>(pixel & 0xffU);
            hash *= 1099511628211ULL;
        }
    }
    return hash;
}

std::uint64_t hash_simulator_spectrum_canvas() noexcept
{
    // The scan cursor and status copy are drawn outside this buffer. Hashing
    // the canvas itself proves that measured-power cells changed, rather than
    // letting moving chrome satisfy the animation gate.
    std::uint64_t hash = 14695981039346656037ULL;
    for(const std::uint8_t value : spectrum_buffer) {
        hash ^= value;
        hash *= 1099511628211ULL;
    }
    return hash;
}

bool write_simulator_frame(const char *directory, const char *group,
                           std::size_t index) noexcept
{
    if(directory == nullptr || directory[0] == '\0') return false;
    char path[512]{};
    if(std::strcmp(group, "live") == 0) {
        std::snprintf(path, sizeof(path), "%s/%s-%03zu.ppm", directory, group, index + 1U);
    } else {
        std::snprintf(path, sizeof(path), "%s/%s-%02zu.ppm", directory, group, index + 1U);
    }
    std::FILE *file = std::fopen(path, "wb");
    if(file == nullptr) return false;
    std::fprintf(file, "P6\n%d %d\n255\n", theme::screen_width, theme::screen_height);
    bool wrote = true;
    for(const std::uint16_t pixel : simulator_frame_buffer) {
        const std::uint8_t red = static_cast<std::uint8_t>(((pixel >> 11U) & 0x1fU) * 255U / 31U);
        const std::uint8_t green = static_cast<std::uint8_t>(((pixel >> 5U) & 0x3fU) * 255U / 63U);
        const std::uint8_t blue = static_cast<std::uint8_t>((pixel & 0x1fU) * 255U / 31U);
        const std::uint8_t rgb[3] = {red, green, blue};
        wrote = std::fwrite(rgb, 1U, sizeof(rgb), file) == sizeof(rgb) && wrote;
    }
    return std::fclose(file) == 0 && wrote;
}

bool run_simulator_animation_test() noexcept
{
    constexpr std::array<Screen, 11> animated_screens = {{
        Screen::traffic, Screen::protocols, Screen::protocol_detail, Screen::spectrum, Screen::nodes,
        Screen::node_detail, Screen::map, Screen::survey, Screen::utilization,
        Screen::timeline, Screen::events,
    }};
    lv_display_t *display = lv_display_create(theme::screen_width, theme::screen_height);
    if(!expect_simulator_state(display != nullptr, "animation display allocation")) return false;
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(display, simulator_frame_buffer.data(), nullptr,
                           sizeof(simulator_frame_buffer), LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_flush_cb(display, simulator_frame_flush);

    bool passed = true;
    app_shell.closeToAnalyzer();
    for(const Screen screen : animated_screens) {
        simulator_live_telemetry.reset();
        simulator_node_detail_id = 0U;
        simulator_node_detail_selection_valid = false;
        if(screen == Screen::node_detail) {
            simulator_node_selection = 0U;
            const simulator::NodeSnapshot *node = simulator_established_node(0U);
            if(node != nullptr) {
                simulator_node_detail_id = node->id;
                simulator_node_detail_selection_valid = true;
            }
        }
        simulator_survey_running = screen == Screen::survey;
        if(simulator_survey_running) (void)simulator_live_telemetry.setSurveyRunning(true);
        simulator_spectrum_scanning = screen == Screen::spectrum;
        simulator_spectrum_cancelled = false;
        simulator_spectrum_partial_points = 0U;
        spectrum_scan_mode = SpectrumScanMode::FastNarrow;
        if(simulator_spectrum_scanning) {
            simulator_spectrum_started_ms = simulator_live_telemetry.elapsedMilliseconds();
            simulator_live_telemetry.setCapturePaused(true);
        }
        events_scroll_offset = 0U;
        event_detail_open = false;
        current_screen = screen;
        build_current_screen();
        lv_refr_now(display);
        const bool spectrum_plot = screen == Screen::spectrum;
        const std::uint64_t before = spectrum_plot
            ? hash_simulator_spectrum_canvas()
            : hash_simulator_region(0U, 22U, 320U, 201U);

        const std::uint32_t duration_ms = screen == Screen::events ? 8500U :
            (screen == Screen::node_detail ? 12000U : 2500U);
        std::uint32_t advanced_ms = 0U;
        while(advanced_ms < duration_ms) {
            const std::uint32_t step = (duration_ms - advanced_ms) < 100U
                ? duration_ms - advanced_ms : 100U;
            advance_simulator_live_data(step);
            advanced_ms += step;
        }
        build_current_screen();
        lv_refr_now(display);
        const std::uint64_t after = spectrum_plot
            ? hash_simulator_spectrum_canvas()
            : hash_simulator_region(0U, 22U, 320U, 201U);
        std::fprintf(stderr, "Lilyshark motion %s: %016llx -> %016llx\n",
                     screen_names[static_cast<std::size_t>(screen)],
                     static_cast<unsigned long long>(before),
                     static_cast<unsigned long long>(after));
        if(before == after) {
            std::fprintf(stderr, "Simulator animation failed: %s is frozen\n",
                         screen_names[static_cast<std::size_t>(screen)]);
            passed = false;
        }
    }
    if(passed) std::fprintf(stderr, "Lilyshark simulator animation test passed\n");
    return passed;
}

bool run_simulator_render_test() noexcept
{
    constexpr std::array<std::uint64_t, static_cast<std::size_t>(Screen::count)> expected_hashes = {{
        0xd24c0a54da145001ULL, 0xe4c631c7913abfe0ULL, 0xb54f63111bd5b9b7ULL,
        0x1ab0ca706df0973cULL, 0x01db2a9da8b5a379ULL, 0x6133d52b761acb3dULL,
        0x6ec8a40a03b83e3cULL, 0xcbd54598d8668ab2ULL, 0x6f0cd886d1892447ULL,
        0x2be5c3b77b22c471ULL, 0xcfaaaf3663d2576bULL, 0x10ea4452a28290ecULL,
        0x6bc33cc2d6da9b3dULL,
    }};
    constexpr std::array<ShellRoute, 17> shell_routes = {{
        ShellRoute::Splash,
        ShellRoute::OnboardingWelcome,
        ShellRoute::OnboardingCapabilities,
        ShellRoute::OnboardingNetwork,
        ShellRoute::OnboardingProfile,
        ShellRoute::OnboardingControls,
        ShellRoute::OnboardingReadiness,
        ShellRoute::Home,
        ShellRoute::RadioProfiles,
        ShellRoute::Settings,
        ShellRoute::Storage,
        ShellRoute::DeviceStatus,
        ShellRoute::DisplayInput,
        ShellRoute::Help,
        ShellRoute::About,
        ShellRoute::SpectrumConfirmation,
        ShellRoute::ResetConfirmation,
    }};
    constexpr std::array<const char *, shell_routes.size()> shell_names = {{
        "SPLASH", "SETUP WELCOME", "SETUP CAPABILITIES", "SETUP NETWORK", "SETUP PROFILE",
        "SETUP CONTROLS", "SETUP READY",
        "HOME", "RADIO PROFILE", "SETTINGS", "STORAGE", "DEVICE STATUS",
        "DISPLAY & INPUT", "HELP", "ABOUT", "SPECTRUM WARNING", "RESET SETUP",
    }};
    constexpr std::array<std::uint64_t, shell_routes.size()> shell_expected_hashes = {{
        0xc6a4407c26a02f13ULL, 0xb88919d01605e06eULL, 0xc2a85a4e18f789d3ULL,
        0xa5666f12ca08abf9ULL, 0x4e993a3aa6388940ULL, 0xe6c9d863553be97aULL,
        0xa5f0734975306c69ULL, 0xc8a60ee25e4a75bbULL, 0xb001f37939e2809aULL,
        0x58f4a35f10689fcfULL, 0x88d179e2188e4626ULL, 0xb7a95ab1033f7e3bULL,
        0xc36df0bfc6ae6cceULL, 0x410f758bfa6d57f7ULL, 0x56624c3700a45905ULL,
        0x5374881a952f5232ULL, 0x447e77256eefa3f2ULL,
    }};

    lv_display_t *display = lv_display_create(theme::screen_width, theme::screen_height);
    if(!expect_simulator_state(display != nullptr, "headless display allocation")) return false;
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(display, simulator_frame_buffer.data(), nullptr,
                           sizeof(simulator_frame_buffer), LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_flush_cb(display, simulator_frame_flush);

    std::array<std::uint64_t, static_cast<std::size_t>(Screen::count)> observed_hashes{};
    const char *render_directory = std::getenv("LILYSHARK_RENDER_DIR");
    const std::uint16_t background = lv_color_to_u16(theme::background());
    bool passed = true;
    simulator_live_telemetry.reset();
    traffic_filter = TrafficFilter{};
    focus_simulator_inspector_packet();
    simulator_packet_detail_sample_valid = false;
    (void)select_simulator_packet_for_detail();
    simulator_node_selection = 0U;
    simulator_node_selection_valid = false;
    (void)resolve_simulator_node_selection();
    const simulator::NodeSnapshot *render_node =
        simulator_established_node(simulator_node_selection);
    simulator_node_detail_id = render_node == nullptr ? 0U : render_node->id;
    simulator_node_detail_selection_valid = render_node != nullptr;
    app_shell.closeToAnalyzer();
    for(std::size_t index = 0; index < static_cast<std::size_t>(Screen::count); ++index) {
        current_screen = static_cast<Screen>(index);
        build_current_screen();
        lv_refr_now(display);
        write_simulator_frame(render_directory, "analyzer", index);

        const std::uint64_t hash = hash_simulator_frame();
        observed_hashes[index] = hash;
        std::size_t foreground_pixels = 0;
        for(const std::uint16_t pixel : simulator_frame_buffer) {
            if(pixel != background) ++foreground_pixels;
        }

        std::fprintf(stderr,
                     "Lilyshark render %s: fnv1a=%016llx foreground=%zu\n",
                     screen_names[index], static_cast<unsigned long long>(hash),
                     foreground_pixels);
        if(foreground_pixels < 1000U) {
            std::fprintf(stderr, "Simulator render failed: %s is nearly blank\n",
                         screen_names[index]);
            passed = false;
        }
        if(hash != expected_hashes[index]) {
            std::fprintf(stderr,
                         "Simulator render failed: %s expected %016llx\n",
                         screen_names[index],
                         static_cast<unsigned long long>(expected_hashes[index]));
            passed = false;
        }
    }

    for(std::size_t left = 0; left < observed_hashes.size(); ++left) {
        for(std::size_t right = left + 1; right < observed_hashes.size(); ++right) {
            if(observed_hashes[left] == observed_hashes[right]) {
                std::fprintf(stderr, "Simulator render failed: %s and %s are identical\n",
                             screen_names[left], screen_names[right]);
                passed = false;
            }
        }
    }
    std::array<std::uint64_t, shell_routes.size()> shell_observed_hashes{};
    for(std::size_t index = 0; index < shell_routes.size(); ++index) {
        (void)app_shell.replace(shell_routes[index]);
        build_current_screen();
        lv_refr_now(display);
        write_simulator_frame(render_directory, "shell", index);
        const std::uint64_t hash = hash_simulator_frame();
        shell_observed_hashes[index] = hash;
        std::size_t foreground_pixels = 0;
        for(const std::uint16_t pixel : simulator_frame_buffer) {
            if(pixel != background) ++foreground_pixels;
        }
        std::fprintf(stderr,
                     "Lilyshark render %s: fnv1a=%016llx foreground=%zu\n",
                     shell_names[index], static_cast<unsigned long long>(hash), foreground_pixels);
        if(foreground_pixels < 1000U) {
            std::fprintf(stderr, "Simulator render failed: %s is nearly blank\n",
                         shell_names[index]);
            passed = false;
        }
        if(hash != shell_expected_hashes[index]) {
            std::fprintf(stderr,
                         "Simulator render failed: %s expected %016llx\n",
                         shell_names[index],
                         static_cast<unsigned long long>(shell_expected_hashes[index]));
            passed = false;
        }
    }
    for(std::size_t left = 0; left < shell_observed_hashes.size(); ++left) {
        for(std::size_t right = left + 1; right < shell_observed_hashes.size(); ++right) {
            if(shell_observed_hashes[left] == shell_observed_hashes[right]) {
                std::fprintf(stderr, "Simulator render failed: %s and %s are identical\n",
                             shell_names[left], shell_names[right]);
                passed = false;
            }
        }
    }

    constexpr std::array<const char *, 8> interaction_names = {{
        "PACKET PKT", "PACKET RF", "PACKET DEC", "PACKET HEX",
        "PACKET RAW", "PACKET HEX PAGE 2", "PACKET HEX PAGE 3", "EVENT DETAIL",
    }};
    constexpr std::array<std::uint64_t, interaction_names.size()> interaction_expected_hashes = {{
        0xcbd54598d8668ab2ULL, 0xfdd5b84e4188f778ULL, 0x4dac0cbbcdf016f0ULL,
        0x2915b2b73668d214ULL, 0xf011cb3671063a53ULL, 0xc0473a755aff6445ULL,
        0xc88079704daf69a8ULL, 0x8bc456d3a7d88c94ULL,
    }};
    traffic_filter = TrafficFilter{};
    focus_simulator_inspector_packet();
    simulator_packet_detail_sample_valid = false;
    (void)select_simulator_packet_for_detail();
    for(std::size_t index = 0; index < interaction_names.size(); ++index) {
        app_shell.closeToAnalyzer();
        event_detail_open = index == interaction_names.size() - 1U;
        events_scroll_offset = 0U;
        if(event_detail_open) {
            current_screen = Screen::events;
        } else {
            current_screen = Screen::packet_detail;
            packet_detail_tab = index < 5U ? index : 3U;
            packet_detail_byte_offset = index < 5U ? 0U : (index - 4U) * 40U;
        }
        build_current_screen();
        lv_refr_now(display);
        write_simulator_frame(render_directory, "interaction", index);
        const std::uint64_t hash = hash_simulator_frame();
        std::size_t foreground_pixels = 0U;
        for(const std::uint16_t pixel : simulator_frame_buffer) {
            if(pixel != background) ++foreground_pixels;
        }
        std::fprintf(stderr,
                     "Lilyshark render %s: fnv1a=%016llx foreground=%zu\n",
                     interaction_names[index], static_cast<unsigned long long>(hash),
                     foreground_pixels);
        if(foreground_pixels < 1000U) {
            std::fprintf(stderr, "Simulator render failed: %s is nearly blank\n",
                         interaction_names[index]);
            passed = false;
        }
        if(hash != interaction_expected_hashes[index]) {
            std::fprintf(stderr,
                         "Simulator render failed: %s expected %016llx\n",
                         interaction_names[index],
                         static_cast<unsigned long long>(interaction_expected_hashes[index]));
            passed = false;
        }
    }
    event_detail_open = false;
    events_scroll_offset = 0U;
    packet_detail_byte_offset = 0U;
    packet_detail_tab = 0U;
    if(passed) std::fprintf(stderr, "Lilyshark simulator render test passed\n");
    return passed;
}

bool run_simulator_readme_frames(const char *directory) noexcept
{
    if(directory == nullptr || directory[0] == '\0') {
        std::fprintf(stderr, "--readme-frames requires an existing output directory\n");
        return false;
    }

    lv_display_t *display = lv_display_create(theme::screen_width, theme::screen_height);
    if(!expect_simulator_state(display != nullptr, "README display allocation")) return false;
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(display, simulator_frame_buffer.data(), nullptr,
                           sizeof(simulator_frame_buffer), LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_flush_cb(display, simulator_frame_flush);

    reset_simulator_demo();
    onboarding_complete = true;
    app_settings.onboarding_complete = true;
    app_shell.closeToAnalyzer();
    current_screen = Screen::traffic;

    // Fill the rolling windows before recording. Fixed 100 ms increments keep
    // this byte-identical across hosts and exercise the normal redraw path.
    for(std::size_t step = 0U; step < 120U; ++step) {
        advance_simulator_live_data(100U);
    }

    std::size_t frame_index = 0U;
    auto write_phase = [&](Screen screen, std::size_t frame_count) noexcept {
        current_screen = screen;
        for(std::size_t frame = 0U; frame < frame_count; ++frame) {
            advance_simulator_live_data(250U);
            build_current_screen();
            lv_refr_now(display);
            if(!write_simulator_frame(directory, "live", frame_index)) return false;
            ++frame_index;
        }
        return true;
    };

    // These phases are diagnostic motion, not decorative animation. The deep
    // sweep freezes packet-derived views exactly as the single SX1262 does on
    // hardware, then capture resumes for the remaining views.
    protocols_selection = 1U;
    if(!write_phase(Screen::traffic, 8U) ||
       !write_phase(Screen::protocols, 8U) ||
       !write_phase(Screen::protocol_detail, 8U)) return false;

    spectrum_scan_mode = SpectrumScanMode::DeepBand;
    simulator_spectrum_scanning = true;
    simulator_spectrum_cancelled = false;
    simulator_spectrum_partial_points = 0U;
    simulator_spectrum_started_ms = simulator_live_telemetry.elapsedMilliseconds();
    simulator_live_telemetry.setCapturePaused(true);
    if(!write_phase(Screen::spectrum, 28U)) return false;

    // The recording now moves to receive-derived views. End the sweep and
    // resume the one simulated receiver before starting their field survey.
    simulator_spectrum_scanning = false;
    simulator_spectrum_partial_points = simulator_spectrum_total_points();
    simulator_live_telemetry.setCapturePaused(false);

    simulator_survey_running = true;
    (void)simulator_live_telemetry.setSurveyRunning(true);
    if(!write_phase(Screen::nodes, 8U) ||
       !write_phase(Screen::survey, 8U) ||
       !write_phase(Screen::utilization, 8U) ||
       !write_phase(Screen::timeline, 8U) ||
       !write_phase(Screen::events, 34U)) return false;

    std::fprintf(stderr, "Lilyshark README live frames written: %zu\n", frame_index);
    return frame_index == 118U;
}

bool simulator_screen_from_name(const char *name, Screen &screen) noexcept
{
    struct NamedScreen {
        const char *name;
        Screen screen;
    };
    constexpr std::array<NamedScreen, static_cast<std::size_t>(Screen::count)> named = {{
        {"traffic", Screen::traffic},
        {"traffic-filter", Screen::traffic_filter},
        {"protocols", Screen::protocols},
        {"protocol-detail", Screen::protocol_detail},
        {"spectrum", Screen::spectrum},
        {"nodes", Screen::nodes},
        {"node-detail", Screen::node_detail},
        {"packet-detail", Screen::packet_detail},
        {"map", Screen::map},
        {"survey", Screen::survey},
        {"airtime", Screen::utilization},
        {"timeline", Screen::timeline},
        {"events", Screen::events},
    }};
    for(const NamedScreen &candidate : named) {
        if(std::strcmp(name, candidate.name) != 0) continue;
        screen = candidate.screen;
        return true;
    }
    return false;
}

struct SimulatorDemoStep {
    std::uint32_t key;
    std::uint32_t hold_ms;
    const char *label;
};

constexpr SimulatorDemoStep simulator_demo_steps[] = {
    {LV_KEY_ENTER, 2200U, "First-run welcome"},
    {LV_KEY_ENTER, 2400U, "What Lilyshark can diagnose"},
    {LV_KEY_ENTER, 2200U, "Choose a mesh network"},
    {LV_KEY_DOWN, 1000U, "Select MeshCore"},
    {LV_KEY_ENTER, 2200U, "Choose a radio profile"},
    {LV_KEY_RIGHT, 1000U, "Compare matching presets"},
    {LV_KEY_ENTER, 2400U, "Learn the field controls"},
    {LV_KEY_ENTER, 2400U, "Device readiness check"},
    {LV_KEY_ENTER, 2600U, "Home"},
    {'P', 2200U, "Radio profile picker"},
    {LV_KEY_UP, 1000U, "Select matching US profile"},
    {LV_KEY_ENTER, 1800U, "Apply the profile"},
    {'M', 1800U, "Back to Home"},
    {'8', 2400U, "Settings"},
    {LV_KEY_ENTER, 2200U, "Settings: Radio profiles"},
    {LV_KEY_ESC, 1200U, "Back to Settings"},
    {LV_KEY_DOWN, 700U, "Select Capture & Storage"},
    {LV_KEY_ENTER, 2400U, "Capture & Storage"},
    {LV_KEY_ENTER, 1500U, "Stop capture"},
    {LV_KEY_ENTER, 1800U, "Restart capture"},
    {LV_KEY_ESC, 1200U, "Back to Settings"},
    {LV_KEY_DOWN, 700U, "Select Device Status"},
    {LV_KEY_ENTER, 2400U, "Device Status"},
    {LV_KEY_ESC, 1200U, "Back to Settings"},
    {LV_KEY_DOWN, 700U, "Select Display & Input"},
    {LV_KEY_ENTER, 2200U, "Display & Input"},
    {LV_KEY_RIGHT, 900U, "Adjust display brightness"},
    {LV_KEY_DOWN, 600U, "Select keyboard light"},
    {LV_KEY_RIGHT, 900U, "Adjust keyboard light"},
    {LV_KEY_DOWN, 600U, "Select optional GPS"},
    {0U, 900U, "Keep optional GPS enabled"},
    {LV_KEY_DOWN, 600U, "Select startup view"},
    {LV_KEY_RIGHT, 1200U, "Resume the last analyzer view"},
    {LV_KEY_ESC, 1200U, "Back to Settings"},
    {LV_KEY_DOWN, 700U, "Select Help"},
    {LV_KEY_ENTER, 2400U, "Help"},
    {LV_KEY_RIGHT, 2400U, "About Lilyshark"},
    {LV_KEY_LEFT, 1400U, "Back to Help"},
    {LV_KEY_ESC, 1200U, "Back to Settings"},
    {LV_KEY_DOWN, 700U, "Select About"},
    {LV_KEY_ENTER, 2200U, "About Lilyshark"},
    {LV_KEY_ESC, 1200U, "Back to Settings"},
    {LV_KEY_DOWN, 700U, "Select Run Setup Again"},
    {LV_KEY_ENTER, 2200U, "Guarded setup reset"},
    {LV_KEY_ESC, 1500U, "Cancel reset"},
    {'M', 1800U, "Back to Home"},
    {'1', 2600U, "Live Traffic"},
    {LV_KEY_DOWN, 800U, "Select a packet"},
    {LV_KEY_ENTER, 2200U, "Packet inspector: summary"},
    {LV_KEY_RIGHT, 2000U, "Packet inspector: RF metadata"},
    {LV_KEY_RIGHT, 2000U, "Packet inspector: decoder analysis"},
    {LV_KEY_RIGHT, 1800U, "Packet inspector: hex bytes"},
    {LV_KEY_DOWN, 1800U, "Packet hex bytes: next page"},
    {LV_KEY_DOWN, 1800U, "Packet hex bytes: final page"},
    {LV_KEY_RIGHT, 2000U, "Packet inspector: current writer state"},
    {LV_KEY_ESC, 1200U, "Back to Traffic"},
    {'9', 3000U, "Protocol health: rolling decoder mix"},
    {LV_KEY_DOWN, 1800U, "Inspect MeshCore activity"},
    {LV_KEY_ENTER, 2600U, "MeshCore protocol health detail"},
    {LV_KEY_ENTER, 2200U, "Filter Traffic to MeshCore"},
    {'X', 2400U, "Traffic Filter tool"},
    {LV_KEY_RIGHT, 1600U, "Compare another protocol predicate"},
    {'R', 1200U, "Reset the Traffic filter"},
    {LV_KEY_ENTER, 1600U, "Return to the complete Traffic list"},
    {'2', 2600U, "Spectrum"},
    {LV_KEY_ENTER, 2200U, "Spectrum ownership warning"},
    {LV_KEY_DOWN, 900U, "Confirm spectrum scan"},
    {LV_KEY_ENTER, 2600U, "Spectrum scan running"},
    {LV_KEY_ENTER, 1400U, "Spectrum scan cancelled"},
    {LV_KEY_UP, 900U, "Switch to fast narrow scan"},
    {LV_KEY_ENTER, 900U, "Fast narrow scan running"},
    {0U, 1600U, "Fast narrow result complete"},
    {'3', 2400U, "Observed Nodes"},
    {LV_KEY_DOWN, 800U, "Select a node"},
    {LV_KEY_ENTER, 2400U, "Node Detail"},
    {LV_KEY_ESC, 1000U, "Back to Nodes"},
    {'4', 2600U, "Map"},
    {'5', 2200U, "Survey"},
    {LV_KEY_ENTER, 2600U, "Survey running"},
    {'6', 2600U, "Airtime"},
    {'T', 3200U, "RF Timeline: rate, SNR, CRC and events"},
    {LV_KEY_DOWN, 1800U, "Timeline filtered to Meshtastic"},
    {'7', 2800U, "Events"},
    {LV_KEY_ENTER, 2600U, "Full event message"},
    {LV_KEY_DOWN, 1800U, "Next event detail"},
    {LV_KEY_ESC, 1600U, "Back to Events"},
    {'M', 2600U, "Tour complete: Home"},
};
constexpr std::size_t simulator_demo_step_count =
    sizeof(simulator_demo_steps) / sizeof(simulator_demo_steps[0]);

void reset_simulator_demo() noexcept
{
    app_shell = AppShell{};
    app_settings = defaultAppSettings();
    onboarding_complete = false;
    onboarding_save_failed = false;
    onboarding_network_selection = 0U;
    onboarding_profile_selection = 0U;
    display_input_selection = 0U;
    reset_confirmation_yes = false;
    spectrum_confirmation_selection = 1U;
    spectrum_scan_mode = SpectrumScanMode::FastNarrow;
    shell_notice[0] = '\0';
    simulator_active_profile_index = 0U;
    simulator_traffic_selection = 5U;
    simulator_traffic_selected_sequence = 0U;
    simulator_packet_detail_selection = 5U;
    simulator_packet_detail_sample_valid = false;
    simulator_node_selection = 2U;
    simulator_node_selected_id = 0U;
    simulator_node_selection_valid = false;
    simulator_node_detail_id = 0U;
    simulator_node_detail_selection_valid = false;
    packet_detail_byte_offset = 0U;
    packet_detail_tab = 0U;
    events_scroll_offset = 0U;
    simulator_spectrum_scanning = false;
    simulator_spectrum_started_ms = 0U;
    simulator_spectrum_partial_points = 0U;
    simulator_spectrum_cancelled = false;
    simulator_survey_running = false;
    simulator_live_telemetry.reset();
    traffic_filter = TrafficFilter{};
    traffic_filter_selection = 0U;
    focus_simulator_inspector_packet();
    protocols_selection = 0U;
    timeline_filter_selection = 0U;
    current_screen = Screen::traffic;
    build_current_screen();
}

bool validate_simulator_demo_step(std::size_t index, bool after_hold) noexcept
{
    const ShellRoute route = app_shell.route();
    bool valid = true;
    switch(index) {
        case 0U: valid = route == ShellRoute::OnboardingWelcome; break;
        case 1U: valid = route == ShellRoute::OnboardingCapabilities; break;
        case 2U: case 3U: valid = route == ShellRoute::OnboardingNetwork; break;
        case 4U: case 5U: valid = route == ShellRoute::OnboardingProfile; break;
        case 6U: valid = route == ShellRoute::OnboardingControls; break;
        case 7U: valid = route == ShellRoute::OnboardingReadiness; break;
        case 8U: valid = route == ShellRoute::Home; break;
        case 9U: case 10U: case 11U:
            valid = route == ShellRoute::RadioProfiles;
            if(index == 11U) {
                valid = valid && simulator_active_profile_index == 1U &&
                    simulator_live_telemetry.activeProtocol() ==
                        simulator::SimulatedProtocol::MeshCore;
            }
            break;
        case 12U: valid = route == ShellRoute::Home; break;
        case 13U: case 15U: case 16U: case 20U: case 21U: case 23U: case 24U:
        case 33U: case 34U: case 38U: case 39U: case 41U: case 42U: case 44U:
            valid = route == ShellRoute::Settings; break;
        case 14U: valid = route == ShellRoute::RadioProfiles; break;
        case 17U: case 18U: case 19U: valid = route == ShellRoute::Storage; break;
        case 22U: valid = route == ShellRoute::DeviceStatus; break;
        case 25U: case 26U: case 27U: case 28U: case 29U: case 30U: case 31U: case 32U:
            valid = route == ShellRoute::DisplayInput;
            if(index == 30U) valid = valid && app_settings.gps_enabled;
            break;
        case 35U: case 37U: valid = route == ShellRoute::Help; break;
        case 36U: case 40U: valid = route == ShellRoute::About; break;
        case 43U: valid = route == ShellRoute::ResetConfirmation; break;
        case 45U: valid = route == ShellRoute::Home; break;
        case 46U: case 47U: case 55U: case 59U: case 63U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::traffic;
            if(index == 59U) valid = valid && traffic_filter.active();
            if(index == 63U) valid = valid && !traffic_filter.active();
            break;
        case 48U: case 49U: case 50U: case 51U: case 52U: case 53U: case 54U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::packet_detail &&
                    packet_detail_tab == (index < 52U ? index - 48U :
                                          (index < 54U ? 3U : 4U));
            break;
        case 56U: case 57U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::protocols; break;
        case 58U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::protocol_detail;
            break;
        case 60U: case 61U: case 62U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::traffic_filter;
            break;
        case 64U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::spectrum; break;
        case 65U: case 66U:
            valid = route == ShellRoute::SpectrumConfirmation; break;
        case 67U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::spectrum &&
                    simulator_spectrum_scanning &&
                    spectrum_scan_mode == SpectrumScanMode::DeepBand;
            break;
        case 68U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::spectrum &&
                    !simulator_spectrum_scanning && simulator_spectrum_cancelled;
            break;
        case 69U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::spectrum &&
                    spectrum_scan_mode == SpectrumScanMode::FastNarrow &&
                    !simulator_spectrum_cancelled && simulator_spectrum_partial_points == 0U;
            break;
        case 70U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::spectrum &&
                    spectrum_scan_mode == SpectrumScanMode::FastNarrow &&
                    (after_hold ? !simulator_spectrum_scanning : simulator_spectrum_scanning);
            break;
        case 71U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::spectrum &&
                    !simulator_spectrum_scanning && !simulator_spectrum_cancelled &&
                    simulator_spectrum_partial_points == simulator_spectrum_total_points();
            break;
        case 72U: case 73U: case 75U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::nodes; break;
        case 74U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::node_detail; break;
        case 76U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::map &&
                    app_settings.gps_enabled; break;
        case 77U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::survey; break;
        case 78U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::survey &&
                    simulator_survey_running && !simulator_spectrum_scanning; break;
        case 79U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::utilization; break;
        case 80U: case 81U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::timeline; break;
        case 82U: case 85U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::events &&
                    !event_detail_open; break;
        case 83U: case 84U:
            valid = route == ShellRoute::Analyzer && current_screen == Screen::events &&
                    event_detail_open; break;
        case 86U: valid = route == ShellRoute::Home; break;
        default: valid = false; break;
    }
    if(!valid) {
        std::fprintf(stderr, "UI tour state mismatch at %02zu/%02zu (%s, %s hold)\n",
                     index + 1U, simulator_demo_step_count,
                     simulator_demo_steps[index].label, after_hold ? "after" : "before");
    }
    return valid;
}

bool simulator_screen_changed(simulator::TelemetryChange changes, Screen screen) noexcept
{
    using simulator::TelemetryChange;
    switch(screen) {
        case Screen::traffic:
        case Screen::traffic_filter:
        case Screen::packet_detail:
            return simulator::changed(changes, TelemetryChange::Traffic);
        case Screen::protocols:
        case Screen::protocol_detail:
            return simulator::changed(changes, TelemetryChange::ProtocolMix);
        case Screen::spectrum:
            return simulator_spectrum_scanning &&
                   simulator::changed(changes, TelemetryChange::Spectrum);
        case Screen::nodes:
        case Screen::node_detail:
        case Screen::map:
            return simulator::changed(changes, TelemetryChange::Nodes);
        case Screen::survey:
            return simulator::changed(changes, TelemetryChange::Survey);
        case Screen::utilization:
            return simulator::changed(changes, TelemetryChange::Airtime);
        case Screen::timeline:
            return simulator::changed(changes, TelemetryChange::Timeline);
        case Screen::events:
            return simulator::changed(changes, TelemetryChange::Events);
        case Screen::count:
        default:
            return false;
    }
}

void advance_simulator_live_data(std::uint32_t elapsed_ms) noexcept
{
    bool force_redraw = false;
    const simulator::TrafficSample *previous_newest_traffic =
        simulator_matching_sample(0U);
    const bool follow_newest_traffic = simulator_traffic_selected_sequence == 0U ||
        (previous_newest_traffic != nullptr &&
         previous_newest_traffic->sequence == simulator_traffic_selected_sequence);
    const std::uint64_t previous_event_generation =
        simulator_live_telemetry.events().generation;
    simulator::TelemetryChange changes = simulator_live_telemetry.advance(elapsed_ms);
    if(simulator::changed(changes, simulator::TelemetryChange::Traffic)) {
        if(follow_newest_traffic) {
            const simulator::TrafficSample *newest = simulator_matching_sample(0U);
            simulator_traffic_selection = 0U;
            simulator_traffic_selected_sequence = newest == nullptr ? 0U : newest->sequence;
        } else {
            (void)resolve_simulator_traffic_selection();
        }
    }
    const simulator::EventsSnapshot &events = simulator_live_telemetry.events();
    if(events.generation != previous_event_generation &&
       (events_scroll_offset > 0U || event_detail_open)) {
        constexpr std::size_t maximum_visible = 6U;
        const std::size_t maximum_offset = event_detail_open
            ? (events.size == 0U ? 0U : events.size - 1U)
            : (events.size > maximum_visible ? events.size - maximum_visible : 0U);
        if(events_scroll_offset < maximum_offset) ++events_scroll_offset;
    }
    if(simulator_survey_running && !simulator_live_telemetry.survey().running) {
        simulator_survey_running = false;
        changes |= simulator::TelemetryChange::Survey;
    }
    if(simulator_spectrum_scanning) {
        const std::uint32_t elapsed = simulator_live_telemetry.elapsedMilliseconds() -
                                      simulator_spectrum_started_ms;
        if(elapsed >= simulator_spectrum_duration_ms()) {
            simulator_spectrum_scanning = false;
            simulator_spectrum_partial_points = simulator_spectrum_total_points();
            simulator_spectrum_cancelled = false;
            simulator_live_telemetry.setCapturePaused(false);
            changes |= simulator::TelemetryChange::Spectrum;
            force_redraw = true;
        }
    }
    if(app_shell.route() == ShellRoute::Analyzer &&
       (force_redraw || simulator_screen_changed(changes, current_screen))) {
        build_current_screen();
    }
}

void set_simulator_demo_title(lv_display_t *display, const char *label,
                              std::size_t step) noexcept
{
    char title[160]{};
    std::snprintf(title, sizeof(title), "Lilyshark UI Tour  %02zu/%02zu  -  %s",
                  step, simulator_demo_step_count, label);
    lv_sdl_window_set_title(display, title);
    std::fprintf(stderr, "UI tour %02zu/%02zu: %s\n",
                 step, simulator_demo_step_count, label);
}

bool simulator_signal_exists(const char *path) noexcept
{
    if(path == nullptr || path[0] == '\0') return false;
    std::FILE *file = std::fopen(path, "rb");
    if(file == nullptr) return false;
    std::fclose(file);
    return true;
}

bool write_simulator_signal(const char *path) noexcept
{
    if(path == nullptr || path[0] == '\0') return false;
    std::FILE *file = std::fopen(path, "wb");
    if(file == nullptr) return false;
    const bool closed = std::fclose(file) == 0;
    return closed;
}
#endif

void handle_key(lv_event_t * event)
{
    handle_navigation_key(lv_event_get_key(event));
}

#if !defined(LILYSHARK_DEVICE)
void handle_pointer_click(lv_event_t *)
{
    lv_indev_t *indev = lv_indev_active();
    if(indev == nullptr) return;
    lv_point_t point{};
    lv_indev_get_point(indev, &point);
    if(point.x < 0 || point.y < 0 || point.x >= theme::screen_width ||
       point.y >= theme::screen_height) return;
    handle_touch_tap(static_cast<std::uint16_t>(point.x),
                     static_cast<std::uint16_t>(point.y));
}
#endif

} // namespace

#if !defined(LILYSHARK_DEVICE)
int main(int argc, char ** argv)
{
    const bool soak_mode = argc > 1 && std::strcmp(argv[1], "--soak") == 0;
    const bool demo_mode = argc > 1 && std::strcmp(argv[1], "--demo") == 0;
    const bool interaction_test_mode =
        argc > 1 && std::strcmp(argv[1], "--interaction-test") == 0;
    const bool render_test_mode =
        argc > 1 && std::strcmp(argv[1], "--render-test") == 0;
    const bool animation_test_mode =
        argc > 1 && std::strcmp(argv[1], "--animation-test") == 0;
    const bool readme_frames_mode =
        argc > 1 && std::strcmp(argv[1], "--readme-frames") == 0;
    const bool named_screen_mode =
        argc > 1 && std::strcmp(argv[1], "--screen") == 0;
    if(readme_frames_mode && (argc != 3 || argv[2][0] == '\0')) {
        std::fprintf(stderr, "Usage: %s --readme-frames OUTPUT_DIRECTORY\n", argv[0]);
        return EXIT_FAILURE;
    }
    if(named_screen_mode) {
        if(argc != 3 || !simulator_screen_from_name(argv[2], current_screen)) {
            std::fprintf(stderr,
                         "Usage: %s --screen traffic|traffic-filter|protocols|protocol-detail|"
                         "spectrum|nodes|node-detail|packet-detail|map|survey|airtime|timeline|events\n",
                         argv[0]);
            return EXIT_FAILURE;
        }
        app_shell.closeToAnalyzer();
    } else if(argc > 1 && !soak_mode && !demo_mode && !interaction_test_mode &&
              !render_test_mode && !animation_test_mode && !readme_frames_mode) {
        const int requested = std::atoi(argv[1]);
        if(requested >= 1 && requested <= static_cast<int>(Screen::count)) {
            current_screen = static_cast<Screen>(requested - 1);
            app_shell.closeToAnalyzer();
        }
    }

    lv_init();
    startup_services_complete = true;

    if(render_test_mode) {
        return run_simulator_render_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    }
    if(animation_test_mode) {
        return run_simulator_animation_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    }
    if(readme_frames_mode) {
        return run_simulator_readme_frames(argv[2]) ? EXIT_SUCCESS : EXIT_FAILURE;
    }

    lv_display_t * display = lv_sdl_window_create(theme::screen_width, theme::screen_height);
    lv_sdl_window_set_title(display, "Lilyshark Simulator");
    lv_sdl_window_set_resizeable(display, false);
    constexpr int demo_window_zoom = 3;
    lv_sdl_window_set_zoom(display, demo_mode ? demo_window_zoom : 2);
    SDL_Window * simulator_window = nullptr;
    constexpr int demo_window_width = theme::screen_width * demo_window_zoom;
    constexpr int demo_window_height = theme::screen_height * demo_window_zoom;
    if(demo_mode) {
        auto *renderer = static_cast<SDL_Renderer *>(lv_sdl_window_get_renderer(display));
        simulator_window = renderer == nullptr ? nullptr : SDL_RenderGetWindow(renderer);
        if(simulator_window == nullptr) {
            const char *video_driver = SDL_GetCurrentVideoDriver();
            if(video_driver == nullptr || std::strcmp(video_driver, "dummy") != 0) {
                std::fprintf(stderr, "UI tour failed: SDL window is unavailable\n");
                return EXIT_FAILURE;
            }
        } else {
            SDL_SetWindowMinimumSize(simulator_window, demo_window_width, demo_window_height);
            SDL_SetWindowMaximumSize(simulator_window, demo_window_width, demo_window_height);
            SDL_SetWindowSize(simulator_window, demo_window_width, demo_window_height);
            SDL_SetWindowAlwaysOnTop(simulator_window, SDL_TRUE);
        }
        SDL_ShowCursor(SDL_DISABLE);
    }
    lv_sdl_mouse_create();

    lv_indev_t * keyboard = lv_sdl_keyboard_create();
    lv_group_t * group = lv_group_create();
    lv_indev_set_group(keyboard, group);

    lv_obj_t * screen = lv_screen_active();
    lv_obj_add_flag(screen, LV_OBJ_FLAG_CLICKABLE);
    lv_group_add_obj(group, screen);
    lv_group_focus_obj(screen);
    lv_obj_add_event_cb(screen, handle_key, LV_EVENT_KEY, nullptr);
    lv_obj_add_event_cb(screen, handle_pointer_click, LV_EVENT_CLICKED, nullptr);

    if(soak_mode) {
        app_shell.closeToAnalyzer();
        current_screen = Screen::traffic;
    }
    if(demo_mode) reset_simulator_demo();
    build_current_screen();
    if(interaction_test_mode) {
        return run_simulator_interaction_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    }

    constexpr std::uint64_t soak_screen_interval_ms = 300;
    constexpr std::array<ShellRoute, 17> soak_shell_routes = {{
        ShellRoute::Splash,
        ShellRoute::OnboardingWelcome,
        ShellRoute::OnboardingCapabilities,
        ShellRoute::OnboardingNetwork,
        ShellRoute::OnboardingProfile,
        ShellRoute::OnboardingControls,
        ShellRoute::OnboardingReadiness,
        ShellRoute::Home,
        ShellRoute::RadioProfiles,
        ShellRoute::Settings,
        ShellRoute::Storage,
        ShellRoute::DeviceStatus,
        ShellRoute::DisplayInput,
        ShellRoute::Help,
        ShellRoute::About,
        ShellRoute::SpectrumConfirmation,
        ShellRoute::ResetConfirmation,
    }};
    constexpr std::size_t soak_view_count =
        static_cast<std::size_t>(Screen::count) + soak_shell_routes.size();
    std::uint64_t next_soak_screen_ms = SDL_GetTicks64() + soak_screen_interval_ms;
    std::uint64_t soak_transitions = 0;
    std::size_t soak_view_index = 0U;
    std::size_t demo_step_index = 0U;
    std::uint64_t demo_lead_ms = 5000U;
    std::uint64_t demo_step_override_ms = 0U;
    const char *demo_start_file = std::getenv("LILYSHARK_DEMO_START_FILE");
    const char *demo_done_file = std::getenv("LILYSHARK_DEMO_DONE_FILE");
    bool demo_started = demo_start_file == nullptr || demo_start_file[0] == '\0';
    bool demo_completed = false;
    const bool demo_once = []() noexcept {
        const char *value = std::getenv("LILYSHARK_DEMO_ONCE");
        return value != nullptr && std::strcmp(value, "1") == 0;
    }();
    if(const char *value = std::getenv("LILYSHARK_DEMO_LEAD_MS")) {
        const unsigned long requested = std::strtoul(value, nullptr, 10);
        if(requested <= 60000UL) demo_lead_ms = requested;
    }
    if(const char *value = std::getenv("LILYSHARK_DEMO_STEP_MS")) {
        const unsigned long requested = std::strtoul(value, nullptr, 10);
        if(requested >= 1UL && requested <= 60000UL) demo_step_override_ms = requested;
    }
    std::uint64_t next_demo_step_ms = SDL_GetTicks64() + demo_lead_ms;
    if(demo_mode) {
        char title[112]{};
        if(demo_started) {
            std::snprintf(title, sizeof(title),
                          "Lilyshark UI Tour  -  starts in %.1f seconds",
                          static_cast<double>(demo_lead_ms) / 1000.0);
        } else {
            std::snprintf(title, sizeof(title),
                          "Lilyshark UI Tour  -  waiting for screen recording");
        }
        lv_sdl_window_set_title(display, title);
        if(demo_started) {
            std::fprintf(stderr, "UI tour ready: starts in %.1f seconds\n",
                         static_cast<double>(demo_lead_ms) / 1000.0);
        } else {
            std::fprintf(stderr, "UI tour ready: waiting for recording signal\n");
        }
    }
    std::uint64_t last_live_tick_ms = SDL_GetTicks64();
    while(true) {
        lv_timer_handler();
        if(simulator_window != nullptr) {
            int window_width = 0;
            int window_height = 0;
            SDL_GetWindowSize(simulator_window, &window_width, &window_height);
            if(window_width != demo_window_width || window_height != demo_window_height) {
                std::fprintf(stderr,
                             "UI tour failed: simulator window changed to %dx%d; expected %dx%d\n",
                             window_width, window_height, demo_window_width, demo_window_height);
                return EXIT_FAILURE;
            }
        }
        const std::uint64_t live_now_ms = SDL_GetTicks64();
        const std::uint64_t live_elapsed_ms = live_now_ms - last_live_tick_ms;
        if(live_elapsed_ms > 0U) {
            advance_simulator_live_data(static_cast<std::uint32_t>(
                live_elapsed_ms > UINT32_MAX ? UINT32_MAX : live_elapsed_ms));
            last_live_tick_ms = live_now_ms;
        }
        if(demo_mode && !demo_completed) {
            const std::uint64_t now_ms = SDL_GetTicks64();
            if(!demo_started && simulator_signal_exists(demo_start_file)) {
                demo_started = true;
                next_demo_step_ms = now_ms + demo_lead_ms;
                char title[112]{};
                std::snprintf(title, sizeof(title),
                              "Lilyshark UI Tour  -  starts in %.1f seconds",
                              static_cast<double>(demo_lead_ms) / 1000.0);
                lv_sdl_window_set_title(display, title);
                std::fprintf(stderr, "UI tour recording synchronized; starts in %.1f seconds\n",
                             static_cast<double>(demo_lead_ms) / 1000.0);
            } else if(demo_started && now_ms >= next_demo_step_ms) {
                if(demo_step_index > 0U) {
                    const SimulatorDemoStep &previous =
                        simulator_demo_steps[demo_step_index - 1U];
                    if(demo_step_override_ms != 0U) {
                        // A fast preflight shortens wall-clock holds only. Advance
                        // deterministic telemetry by the scripted hold so scan,
                        // survey, and live-data state remain identical to the
                        // recording-speed tour.
                        advance_simulator_live_data(previous.hold_ms);
                    }
                    if(!validate_simulator_demo_step(demo_step_index - 1U, true)) {
                        return EXIT_FAILURE;
                    }
                }
                if(demo_step_index == simulator_demo_step_count) {
                    const bool signalled = demo_done_file == nullptr || demo_done_file[0] == '\0' ||
                                           write_simulator_signal(demo_done_file);
                    if(!signalled) {
                        std::fprintf(stderr, "UI tour failed: could not write completion signal\n");
                        return EXIT_FAILURE;
                    }
                    if(demo_once && (demo_done_file == nullptr || demo_done_file[0] == '\0')) {
                        std::fprintf(stderr, "Lilyshark UI tour test passed\n");
                        return EXIT_SUCCESS;
                    }
                    if(demo_once) {
                        demo_completed = true;
                        lv_sdl_window_set_title(display, "Lilyshark UI Tour  -  complete");
                        std::fprintf(stderr, "Lilyshark UI tour complete; holding final frame\n");
                    } else {
                        reset_simulator_demo();
                        demo_step_index = 0U;
                        next_demo_step_ms = now_ms + demo_lead_ms;
                        lv_sdl_window_set_title(
                            display, "Lilyshark UI Tour  -  complete; replaying shortly");
                        std::fprintf(stderr, "UI tour complete; replaying shortly\n");
                    }
                } else {
                    const SimulatorDemoStep &step = simulator_demo_steps[demo_step_index];
                    handle_navigation_key(step.key);
                    if(!validate_simulator_demo_step(demo_step_index, false)) {
                        return EXIT_FAILURE;
                    }
                    set_simulator_demo_title(display, step.label, demo_step_index + 1U);
                    next_demo_step_ms = now_ms +
                        (demo_step_override_ms == 0U ? step.hold_ms : demo_step_override_ms);
                    ++demo_step_index;
                }
            }
        }
        if(soak_mode) {
            const std::uint64_t now_ms = SDL_GetTicks64();
            if(now_ms >= next_soak_screen_ms) {
                soak_view_index = (soak_view_index + 1U) % soak_view_count;
                if(soak_view_index < static_cast<std::size_t>(Screen::count)) {
                    app_shell.closeToAnalyzer();
                    current_screen = static_cast<Screen>(soak_view_index);
                } else {
                    (void)app_shell.replace(
                        soak_shell_routes[soak_view_index - static_cast<std::size_t>(Screen::count)]);
                }
                build_current_screen();
                ++soak_transitions;
                next_soak_screen_ms = now_ms + soak_screen_interval_ms;
                if(soak_view_index == 0U) {
                    if(lv_mem_test() != LV_RESULT_OK) {
                        std::fprintf(stderr, "fatal error: LVGL heap integrity check failed\n");
                        return EXIT_FAILURE;
                    }
                    lv_mem_monitor_t memory{};
                    lv_mem_monitor(&memory);
                    std::fprintf(stderr,
                                 "Lilyshark soak cycle %llu passed: used=%u%% frag=%u%% free=%zu max=%zu\n",
                                 static_cast<unsigned long long>(soak_transitions /
                                                                  static_cast<std::uint64_t>(soak_view_count)),
                                 static_cast<unsigned>(memory.used_pct),
                                 static_cast<unsigned>(memory.frag_pct), memory.free_size,
                                 memory.max_used);
                }
            }
        }
        SDL_Delay(5);
    }
}
#else

namespace {

constexpr uint8_t keyboard_brightness_command = 0x01;
constexpr size_t spectrum_buffer_size = LV_CANVAS_BUF_SIZE(306, 145, 16, LV_DRAW_BUF_STRIDE_ALIGN);

TFT_eSPI device_display;
alignas(4) std::uint8_t device_draw_buffer[theme::screen_width * 20 * sizeof(std::uint16_t)];
TouchPoint touch_last_point{};
TouchPoint touch_start_point{};
bool touch_was_pressed = false;
uint32_t touch_started_ms = 0;

struct TrackballKey {
    uint8_t pin;
    uint32_t key;
    uint32_t pending_bit;
    uint32_t last_event_ms;
};

std::array<TrackballKey, 5> trackball_keys = {{{tdeck::trackball_up_pin, LV_KEY_UP, 1U << 0U, 0},
                                                {tdeck::trackball_down_pin, LV_KEY_DOWN, 1U << 1U, 0},
                                                {tdeck::trackball_left_pin, LV_KEY_LEFT, 1U << 2U, 0},
                                                {tdeck::trackball_right_pin, LV_KEY_RIGHT, 1U << 3U, 0},
                                                {tdeck::trackball_press_pin, LV_KEY_ENTER, 1U << 4U, 0}}};
portMUX_TYPE trackball_isr_mux = portMUX_INITIALIZER_UNLOCKED;
volatile uint32_t trackball_pending_mask = 0;

void IRAM_ATTR latch_trackball_edge(uint32_t bit)
{
    portENTER_CRITICAL_ISR(&trackball_isr_mux);
    trackball_pending_mask |= bit;
    portEXIT_CRITICAL_ISR(&trackball_isr_mux);
}

void IRAM_ATTR on_trackball_up() { latch_trackball_edge(1U << 0U); }
void IRAM_ATTR on_trackball_down() { latch_trackball_edge(1U << 1U); }
void IRAM_ATTR on_trackball_left() { latch_trackball_edge(1U << 2U); }
void IRAM_ATTR on_trackball_right() { latch_trackball_edge(1U << 3U); }
void IRAM_ATTR on_trackball_press() { latch_trackball_edge(1U << 4U); }

void set_backlight(uint8_t value)
{
    static uint8_t level = 0;
    constexpr uint8_t steps = 16;
    value = value > steps ? steps : value;
    if(value == 0) {
        digitalWrite(tdeck::backlight_pin, LOW);
        delay(3);
        level = 0;
        return;
    }
    if(level == 0) {
        digitalWrite(tdeck::backlight_pin, HIGH);
        level = steps;
        delayMicroseconds(30);
    }
    const int from = steps - level;
    const int to = steps - value;
    const int pulses = (steps + to - from) % steps;
    for(int index = 0; index < pulses; ++index) {
        digitalWrite(tdeck::backlight_pin, LOW);
        digitalWrite(tdeck::backlight_pin, HIGH);
    }
    level = value;
}

uint32_t device_tick_ms()
{
    return millis();
}

void device_flush(lv_display_t * display, const lv_area_t * area, uint8_t * pixels)
{
    const uint32_t width = static_cast<uint32_t>(area->x2 - area->x1 + 1);
    const uint32_t height = static_cast<uint32_t>(area->y2 - area->y1 + 1);
    device_display.startWrite();
    device_display.setAddrWindow(area->x1, area->y1, width, height);
    device_display.pushColors(reinterpret_cast<uint16_t *>(pixels), width * height, true);
    device_display.endWrite();
    lv_display_flush_ready(display);
}

void device_touch_read(lv_indev_t *, lv_indev_data_t *data)
{
    data->point.x = static_cast<lv_coord_t>(touch_last_point.x);
    data->point.y = static_cast<lv_coord_t>(touch_last_point.y);
    data->state = touch_was_pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

void poll_touch()
{
    static uint32_t next_poll_ms = 0;
    if(!touch_service.present()) {
        touch_was_pressed = false;
        return;
    }

    const uint32_t now = millis();
    if(!monotonicDeadlineReached(now, next_poll_ms)) return;
    next_poll_ms = now + 16U;

    const bool was_pressed = touch_was_pressed;
    if(!touch_service.poll()) {
        touch_was_pressed = false;
        return;
    }
    const TouchPoint point = touch_service.point();
    touch_was_pressed = point.pressed;
    if(point.pressed) touch_last_point = point;

    if(!was_pressed && point.pressed) {
        touch_start_point = point;
        touch_started_ms = now;
        return;
    }
    if(was_pressed && !point.pressed) {
        const int delta_x = static_cast<int>(touch_last_point.x) -
                            static_cast<int>(touch_start_point.x);
        const int delta_y = static_cast<int>(touch_last_point.y) -
                            static_cast<int>(touch_start_point.y);
        const int abs_x = delta_x < 0 ? -delta_x : delta_x;
        const int abs_y = delta_y < 0 ? -delta_y : delta_y;
        if(abs_x >= 40 && abs_x > abs_y && touch_start_point.x <= 24U && delta_x > 0) {
            handle_navigation_key(LV_KEY_ESC);
        } else if(abs_x >= 40 && abs_x > abs_y) {
            handle_navigation_key(delta_x < 0 ? LV_KEY_RIGHT : LV_KEY_LEFT);
        } else if(abs_y >= 36) {
            handle_navigation_key(delta_y < 0 ? LV_KEY_DOWN : LV_KEY_UP);
        } else if(now - touch_started_ms <= 800U) {
            handle_touch_tap(touch_last_point.x, touch_last_point.y);
        }
    }
}

void stop_capture_session() noexcept
{
    bool flushed = true;
    if(pcap_recording) flushed = pcap_sink.flush() && flushed;
    if(native_capture_recording) flushed = native_capture_sink.flush() && flushed;
    pcap_sink.close();
    native_capture_sink.close();
    pcap_writer.reset();
    native_capture_writer.reset();
    pcap_recording = false;
    native_capture_recording = false;
    last_pcap_result = PcapWriteResult::NotStarted;
    last_native_capture_result = LilysharkCaptureWriteResult::NotStarted;
    pcap_bandwidth_warning_recorded = false;
    pcap_synthetic_warning_recorded = false;
    if(!flushed) {
        sd_io_error = true;
        record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Storage,
                             "Capture stopped, but final SD flush failed");
    }
}

bool start_capture_session() noexcept
{
    if(pcap_recording || native_capture_recording) return true;
    if(sd_io_error) {
        pcap_sink.close();
        native_capture_sink.close();
        SD.end();
        sd_mounted = false;
        sd_io_error = false;
    }
    if(!sd_mounted) sd_mounted = mountTDeckSd(SPI);
    if(!sd_mounted) {
        record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Storage,
                             "Capture requested, but no SD card was found");
        return false;
    }

    pcap_writer.reset();
    native_capture_writer.reset();
    pcap_bandwidth_warning_recorded = false;
    pcap_synthetic_warning_recorded = false;
    pcap_path[0] = '\0';
    native_capture_path[0] = '\0';
    if(pcap_sink.openNextCapture(pcap_path, sizeof(pcap_path))) {
        last_pcap_result = pcap_writer.begin();
        pcap_recording = last_pcap_result == PcapWriteResult::Ok;
        if(!pcap_recording) pcap_sink.close();
    }
    if(native_capture_sink.openNextCapture(native_capture_path, sizeof(native_capture_path),
                                           kLilysharkCaptureExtension)) {
        last_native_capture_result = native_capture_writer.begin();
        native_capture_recording =
            last_native_capture_result == LilysharkCaptureWriteResult::Ok;
        if(!native_capture_recording) native_capture_sink.close();
    }

    if(app_settings.simulate_mode) {
        if(native_capture_recording) {
            sd_io_error = false;
            record_runtime_event(RuntimeEventSeverity::Success, RuntimeEventType::Capture,
                                 pcap_recording
                                     ? "Synthetic LSCAP started; PCAP will skip simulated frames"
                                     : "Synthetic LSCAP session started");
        } else {
            record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Capture,
                                 pcap_recording
                                     ? "PCAP cannot store simulation; native LSCAP unavailable"
                                     : "Synthetic capture files could not be opened on SD");
        }
        return native_capture_recording;
    }

    if(native_capture_recording && pcap_recording) {
        sd_io_error = false;
        record_runtime_event(RuntimeEventSeverity::Success, RuntimeEventType::Capture,
                             "New LSCAP and PCAP session started");
    } else if(native_capture_recording) {
        sd_io_error = false;
        record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Capture,
                             "New LSCAP session started; PCAP unavailable");
    } else if(pcap_recording) {
        sd_io_error = false;
        record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Capture,
                             "PCAP started; native LSCAP unavailable");
    } else {
        sd_io_error = true;
        record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Capture,
                             "Capture files could not be opened on SD");
    }
    return native_capture_recording || pcap_recording;
}

void take_device_screenshot() noexcept
{
    const std::uint32_t started_ms = millis();
    screenshot_attempted = true;
    if(!sd_mounted) {
        screenshot_path[0] = '\0';
        last_screenshot_result = ScreenshotWriteResult::StorageError;
        Serial.println("Lilyshark screenshot: SD unavailable");
        record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Screenshot,
                             "Screenshot failed because no SD card is mounted");
        last_screenshot_gap_ms = millis() - started_ms;
        return;
    }

    // Flush pending LVGL invalidations before reading pixels back from ST7789.
    lv_refr_now(nullptr);
    last_screenshot_result = saveTDeckScreenshot(device_display, screenshot_path,
                                                  sizeof(screenshot_path));
    last_screenshot_gap_ms = millis() - started_ms;
    if(last_screenshot_result == ScreenshotWriteResult::Ok) {
        Serial.printf("Lilyshark screenshot: %s (%lu ms capture gap)\n", screenshot_path,
                      static_cast<unsigned long>(last_screenshot_gap_ms));
        char message[96]{};
        std::snprintf(message, sizeof(message), "%s saved; capture gap %lu ms", screenshot_path,
                      static_cast<unsigned long>(last_screenshot_gap_ms));
        record_runtime_event(RuntimeEventSeverity::Success, RuntimeEventType::Screenshot, message);
    } else {
        Serial.printf("Lilyshark screenshot failed: %u\n",
                      static_cast<unsigned>(last_screenshot_result));
        char message[72]{};
        std::snprintf(message, sizeof(message), "Screenshot failed with error %u",
                      static_cast<unsigned>(last_screenshot_result));
        record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Screenshot, message);
        if(last_screenshot_result == ScreenshotWriteResult::SinkError ||
           last_screenshot_result == ScreenshotWriteResult::StorageError) {
            sd_io_error = true;
        }
    }
    if(current_screen == Screen::events) build_current_screen();
}

void poll_trackball()
{
    const uint32_t now = millis();
    portENTER_CRITICAL(&trackball_isr_mux);
    const uint32_t pending = trackball_pending_mask;
    trackball_pending_mask = 0;
    portEXIT_CRITICAL(&trackball_isr_mux);

    for(TrackballKey & input : trackball_keys) {
        if((pending & input.pending_bit) != 0U && now - input.last_event_ms >= 60U) {
            input.last_event_ms = now;
            handle_navigation_key(input.key);
        }
    }
}

void poll_keyboard()
{
    static uint32_t next_read_ms = 0;
    static uint32_t next_probe_ms = 0;
    const uint32_t now = millis();
    if(!monotonicDeadlineReached(now, next_read_ms)) return;
    next_read_ms = now + 20;

    if(monotonicDeadlineReached(now, next_probe_ms)) {
        next_probe_ms = now + 2000U;
        const bool was_ready = keyboard_ready;
        keyboard_ready = set_keyboard_brightness(app_settings.keyboard_brightness);
        if(keyboard_ready != was_ready) {
            record_runtime_event(keyboard_ready ? RuntimeEventSeverity::Success
                                                : RuntimeEventSeverity::Warning,
                                 RuntimeEventType::Hardware,
                                 keyboard_ready ? "Keyboard reconnected and is ready"
                                                : "Keyboard stopped responding; trackball remains active");
            live_data_dirty = true;
        }
    }
    if(!keyboard_ready) return;

    const uint8_t received = Wire.requestFrom(tdeck::keyboard_address, static_cast<uint8_t>(1));
    if(received == 0) return;
    if(!Wire.available()) return;
    const uint8_t key = Wire.read();
    if(key != 0) handle_navigation_key(key);
}

bool set_keyboard_brightness(uint8_t value)
{
    Wire.beginTransmission(tdeck::keyboard_address);
    Wire.write(keyboard_brightness_command);
    Wire.write(value);
    return Wire.endTransmission() == 0U;
}

[[noreturn]] void halt_device_startup(const char *message)
{
    Serial.printf("Lilyshark fatal: %s\n", message);
    Serial.flush();
    while(true) {
        delay(1000);
    }
}

} // namespace

void setup()
{
    Serial.begin(115200);
    Serial.println("Lilyshark starting");
    runtime_event_history.clear();
    first_frame_event_recorded = false;
    record_runtime_event(RuntimeEventSeverity::Info, RuntimeEventType::System,
                         "Firmware boot started");

    pinMode(tdeck::power_enable_pin, OUTPUT);
    digitalWrite(tdeck::power_enable_pin, HIGH);
    pinMode(tdeck::sd_cs_pin, OUTPUT);
    pinMode(tdeck::radio_cs_pin, OUTPUT);
    pinMode(tdeck::display_cs_pin, OUTPUT);
    pinMode(tdeck::backlight_pin, OUTPUT);
    digitalWrite(tdeck::sd_cs_pin, HIGH);
    digitalWrite(tdeck::radio_cs_pin, HIGH);
    digitalWrite(tdeck::display_cs_pin, HIGH);
    digitalWrite(tdeck::backlight_pin, LOW);
    delay(500);

    pinMode(tdeck::spi_miso_pin, INPUT_PULLUP);
    SPI.begin(tdeck::spi_sck_pin, tdeck::spi_miso_pin, tdeck::spi_mosi_pin);
    device_display.begin();
    applyTDeckDisplayInit(device_display);
    device_display.setRotation(1);
    device_display.fillScreen(TFT_BLACK);

    const bool app_settings_loaded = load_app_settings();
    onboarding_complete = app_settings_loaded && app_settings.onboarding_complete;

    lv_init();
    lv_tick_set_cb(device_tick_ms);
    lv_display_t * display = lv_display_create(theme::screen_width, theme::screen_height);
    if(display == nullptr) halt_device_startup("LVGL display allocation failed");
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(display, device_draw_buffer, nullptr, sizeof(device_draw_buffer),
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(display, device_flush);

    build_current_screen();
    lv_refr_now(display);
    const std::uint32_t splash_started_ms = millis();
    set_backlight(app_settings.display_brightness == 0U ? 1U : app_settings.display_brightness);
    Serial.println("Lilyshark display: ready");
    record_runtime_event(RuntimeEventSeverity::Success, RuntimeEventType::Hardware,
                         "Display initialized; pink boot mark shown");

    Wire.begin(tdeck::i2c_sda_pin, tdeck::i2c_scl_pin, tdeck::i2c_frequency_hz);
    keyboard_ready = set_keyboard_brightness(app_settings.keyboard_brightness);
    const bool touch_ready = touch_service.begin(Wire);
    Serial.printf("Lilyshark keyboard: %s\n", keyboard_ready ? "ready" : "not found");
    Serial.printf("Lilyshark touch: %s (0x%02X)\n", touch_ready ? "ready" : "not found",
                  touch_service.address());
    record_runtime_event(keyboard_ready && touch_ready
                             ? RuntimeEventSeverity::Success : RuntimeEventSeverity::Warning,
                         RuntimeEventType::Hardware,
                         keyboard_ready && touch_ready
                             ? "Keyboard, trackball, and touch initialized"
                             : (!keyboard_ready && !touch_ready
                                 ? "Keyboard and touch unavailable; trackball remains active"
                                 : (!keyboard_ready
                                     ? "Keyboard unavailable; trackball and touch remain active"
                                     : "Touch unavailable; keyboard and trackball remain active")));
    hardware_status.begin(app_settings.gps_enabled);
    update_live_hardware_labels();
    for(TrackballKey & input : trackball_keys) {
        pinMode(input.pin, INPUT_PULLUP);
    }
    attachInterrupt(tdeck::trackball_up_pin, on_trackball_up, FALLING);
    attachInterrupt(tdeck::trackball_down_pin, on_trackball_down, FALLING);
    attachInterrupt(tdeck::trackball_left_pin, on_trackball_left, FALLING);
    attachInterrupt(tdeck::trackball_right_pin, on_trackball_right, FALLING);
    attachInterrupt(tdeck::trackball_press_pin, on_trackball_press, FALLING);

    spectrum_buffer = static_cast<uint8_t *>(ps_malloc(spectrum_buffer_size));
    if(spectrum_buffer == nullptr) {
        Serial.println("Spectrum unavailable: PSRAM allocation failed");
        record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Hardware,
                             "PSRAM unavailable; spectrum view disabled");
    }

    lv_indev_t *touch = lv_indev_create();
    if(touch == nullptr) halt_device_startup("LVGL touch input allocation failed");
    lv_indev_set_type(touch, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(touch, device_touch_read);

    sd_mounted = mountTDeckSd(SPI);
    if(app_settings.capture_enabled) (void)start_capture_session();
    Serial.printf("Lilyshark SD capture: %s%s%s\n", pcap_recording ? "recording " : "unavailable",
                  pcap_recording ? pcap_path : "", sd_mounted ? "" : " (no card)");
    Serial.printf("Lilyshark native capture: %s%s\n",
                  native_capture_recording ? "recording " : "unavailable",
                  native_capture_recording ? native_capture_path : "");
    if(!app_settings.capture_enabled) {
        record_runtime_event(RuntimeEventSeverity::Info, RuntimeEventType::Capture,
                             "Capture disabled in Settings; analysis remains in memory");
    }

    capture_runtime.addDecoder(meshtastic_decoder);
    capture_runtime.addDecoder(meshcore_decoder);
    capture_runtime.addDecoder(reticulum_decoder);
    // Registered last: it enriches recognized enclosing protocols with the
    // Shelby marker and claims standalone pointer frames itself.
    capture_runtime.addDecoder(shelby_pointer_decoder);
    RadioProfile initial_profile = builtinProfiles()[active_profile_index];
    bool restored_profile = load_saved_profile(initial_profile);
    bool fallback_profile_save_failed = false;
    bool radio_ready = radio_service.begin(initial_profile, on_radio_frame, nullptr);
    if(!radio_ready && restored_profile && !radio_service.status().initialized) {
        Serial.println("Lilyshark saved profile failed; retrying its built-in preset");
        restored_profile = false;
        initial_profile = builtinProfiles()[active_profile_index];
        radio_ready = radio_service.begin(initial_profile, on_radio_frame, nullptr);
        if(radio_ready && !save_active_profile()) {
            fallback_profile_save_failed = true;
            Serial.println("Lilyshark fallback profile settings were not saved");
        }
    }
    if(app_settings.simulate_mode) {
        radio_service.stop();
        radio_service.clearSpectrumResult();
        simulate_source.reset();
        reset_analysis_for_source_change();
    }
    update_live_radio_label();
    const char *radio_state = app_settings.simulate_mode ? "simulate mode / SX1262 paused" :
        (radio_ready ? "listening" :
         (radio_service.status().initialized ? "recovering" : "failed"));
    Serial.printf("Lilyshark radio: %s%s (%s, error %d)\n", initial_profile.name,
                  restored_profile ? " [saved settings]" : "",
                  radio_state, radio_service.status().last_error);
    observed_radio_initialized = radio_service.status().initialized;
    observed_radio_receiving = radio_service.status().receiving;
    char radio_event[88]{};
    if(app_settings.simulate_mode) {
        std::snprintf(radio_event, sizeof(radio_event),
                      "Simulate mode restored; SX1262 receive paused");
    } else if(fallback_profile_save_failed) {
        std::snprintf(radio_event, sizeof(radio_event), "%s: listening, fallback save failed",
                      initial_profile.name);
    } else {
        std::snprintf(radio_event, sizeof(radio_event), "%s: %s, error %d", initial_profile.name,
                      radio_state, radio_service.status().last_error);
    }
    record_runtime_event(app_settings.simulate_mode ? RuntimeEventSeverity::Warning :
                         (fallback_profile_save_failed ? RuntimeEventSeverity::Warning :
                         (radio_service.status().receiving ? RuntimeEventSeverity::Success
                                                           : RuntimeEventSeverity::Warning)),
                         RuntimeEventType::Radio, radio_event);

    startup_services_complete = true;
    build_current_screen();
    lv_refr_now(display);
    const std::uint32_t splash_elapsed_ms = millis() - splash_started_ms;
    if(splash_elapsed_ms < 650U) delay(650U - splash_elapsed_ms);
    app_shell.finishSplash(onboarding_complete);
    if(onboarding_complete && app_settings.resume_last_view) {
        const std::size_t index = app_settings.last_primary_diagnostic_index % primary_screens.size();
        current_screen = primary_screens[index];
        app_shell.closeToAnalyzer();
    }
    build_current_screen();
    lv_refr_now(display);
    Serial.println("Lilyshark UI ready");
    record_runtime_event(RuntimeEventSeverity::Success, RuntimeEventType::System,
                         !onboarding_complete ? "First-run setup ready" :
                         (app_settings.resume_last_view ? "Last live view ready" : "Home ready"));
}

void handle_analyzer_link_command(const char *line) noexcept
{
    if(std::strcmp(line, "LSK HELLO") == 0) {
        const bool first_link = !analyzer_link_active;
        analyzer_link_active = true;
        analyzer_link_last_telemetry_ms = 0;
        Serial.printf("LSK ID {\"app\":\"lilyshark\",\"fw\":\"%s\",\"board\":\"t-deck\"}\n",
                      firmware_version);
        if(first_link) {
            record_runtime_event(RuntimeEventSeverity::Success, RuntimeEventType::System,
                                 "Web analyzer linked over USB");
        }
    } else if(std::strcmp(line, "LSK BYE") == 0) {
        if(analyzer_link_active) {
            record_runtime_event(RuntimeEventSeverity::Info, RuntimeEventType::System,
                                 "Web analyzer link closed");
        }
        analyzer_link_active = false;
    }
}

void loop()
{
    poll_trackball();
    poll_keyboard();
    poll_touch();
    hardware_status.poll();
    if(!app_settings.simulate_mode) radio_service.poll();

    // Web-analyzer link: consume newline-delimited commands from USB CDC.
    while(Serial.available() > 0) {
        const char received = static_cast<char>(Serial.read());
        if(received == '\n' || received == '\r') {
            analyzer_link_line[analyzer_link_line_length] = '\0';
            if(analyzer_link_line_length > 0U) handle_analyzer_link_command(analyzer_link_line);
            analyzer_link_line_length = 0;
        } else if(analyzer_link_line_length + 1U < sizeof(analyzer_link_line)) {
            analyzer_link_line[analyzer_link_line_length++] = received;
        } else {
            analyzer_link_line_length = 0;
        }
    }

    const uint32_t now = millis();
    bool redraw = false;

    if(analyzer_link_active &&
       static_cast<std::uint32_t>(now - analyzer_link_last_telemetry_ms) >= 2000U) {
        analyzer_link_last_telemetry_ms = now;
        const HardwareStatusSnapshot &hardware = hardware_status.snapshot();
        const FrameRecord *newest = capture_runtime.frames().newest();
        const RadioProfile &link_profile = radio_service.activeProfile();
        Serial.printf(
            "LSK T {\"bat\":\"%s\",\"gps\":\"%s\",\"profile\":\"%s\",\"frames\":%lu,"
            "\"rssi_x10\":%d,\"snr_x10\":%d,\"sim\":%s}\n",
            hardware.battery_label, hardware.gps_label, link_profile.name,
            static_cast<unsigned long>(newest != nullptr ? newest->sequence : 0U),
            newest != nullptr ? static_cast<int>(newest->raw.rf.rssi_dbm_x10) : 0,
            newest != nullptr ? static_cast<int>(newest->raw.rf.snr_db_x10) : 0,
            app_settings.simulate_mode ? "true" : "false");
    }
    // Synthetic traffic exercises the real decoder, analyzer and native
    // capture path. The live radio is stopped, and PCAP explicitly excludes
    // synthetic frames because LoRaTap v0 has no provenance field.
    if(app_settings.simulate_mode && simulate_source.due(now)) {
        const RadioProfile &profile = radio_service.activeProfile();
        const RawFrame frame = simulate_source.next(now,
                                                    profile.center_frequency_hz,
                                                    profile.bandwidth_hz,
                                                    profile.spreading_factor,
                                                    profile.coding_rate_denominator,
                                                    profile.id);
        ingest_analyzer_frame(frame, profile, true);
        redraw = true;
    }

    const RadioStatus &radio_status = radio_service.status();
    if(radio_status.initialized != observed_radio_initialized ||
       radio_status.receiving != observed_radio_receiving) {
        char message[80]{};
        const char *state = radio_status.receiving ? "listening" :
                            (radio_status.initialized ? "recovering" : "offline");
        std::snprintf(message, sizeof(message), "SX1262 %s; error %d", state,
                      radio_status.last_error);
        record_runtime_event(radio_status.receiving ? RuntimeEventSeverity::Success
                                                    : RuntimeEventSeverity::Warning,
                             RuntimeEventType::Radio, message);
        observed_radio_initialized = radio_status.initialized;
        observed_radio_receiving = radio_status.receiving;
    }
    const SpectrumSweepStatus &spectrum_status = radio_service.spectrumStatus();
    if(spectrum_status.state != observed_spectrum_state ||
       spectrum_status.points_completed != observed_spectrum_points) {
        if(spectrum_status.state != observed_spectrum_state) {
            char message[88]{};
            if(spectrum_status.state == SpectrumSweepState::Complete) {
                std::snprintf(message, sizeof(message), "Scan complete with %u frequency points",
                              spectrum_status.points_completed);
                record_runtime_event(RuntimeEventSeverity::Success, RuntimeEventType::Spectrum,
                                     message);
            } else if(spectrum_status.state == SpectrumSweepState::Failed) {
                std::snprintf(message, sizeof(message), "Scan failed: cause %u, radio %d, restore %d",
                              static_cast<unsigned>(spectrum_status.failure),
                              spectrum_status.radio_error, spectrum_status.restore_error);
                record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Spectrum,
                                     message);
            } else if(spectrum_status.state == SpectrumSweepState::Cancelled) {
                std::snprintf(message, sizeof(message), "Scan cancelled after %u frequency points",
                              spectrum_status.points_completed);
                record_runtime_event(RuntimeEventSeverity::Warning, RuntimeEventType::Spectrum,
                                     message);
            }
        }
        observed_spectrum_state = spectrum_status.state;
        observed_spectrum_points = spectrum_status.points_completed;
        if(current_screen == Screen::spectrum) redraw = true;
    }
    if(survey_running) {
        const std::uint32_t since_last_accounting = now - survey_last_accounted_ms;
        survey_last_accounted_ms = now;
        // Count only time in which the receiver is genuinely listening. Radio
        // recovery and spectrum standby must not make a 60-second survey claim
        // observation time that never occurred.
        if((app_settings.simulate_mode || radio_status.receiving) &&
           !spectrum_status.active()) {
            const std::uint32_t remaining = 60000U - survey_elapsed_ms;
            survey_elapsed_ms += since_last_accounting < remaining
                ? since_last_accounting : remaining;
        }
        if(survey_elapsed_ms >= 60000U) {
            survey_running = false;
            survey_has_result = true;
            char message[88]{};
            const SurveySnapshot survey = survey_accumulator.snapshot();
            std::snprintf(message, sizeof(message), "Survey complete: %llu frames, %lu sources",
                          static_cast<unsigned long long>(survey.total_frames),
                          static_cast<unsigned long>(survey.unique_sources));
            record_runtime_event(RuntimeEventSeverity::Success, RuntimeEventType::Survey, message);
            redraw = true;
        }
    }
    if(now - last_hardware_ui_refresh_ms >= 1000U) {
        last_hardware_ui_refresh_ms = now;
        (void)rolling_diagnostics.advanceTo(now);
        const bool hardware_labels_changed = update_live_hardware_labels();
        const bool radio_label_changed = update_live_radio_label();
        redraw = hardware_labels_changed || radio_label_changed || redraw;
    }
    if(now - last_capture_flush_ms >= 5000U) {
        last_capture_flush_ms = now;
        if(pcap_recording && !pcap_sink.flush()) {
            pcap_recording = false;
            sd_io_error = true;
            last_pcap_result = PcapWriteResult::SinkError;
            pcap_sink.close();
            record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Storage,
                                 "PCAP flush failed; recording stopped");
            live_data_dirty = true;
        }
        if(native_capture_recording && !native_capture_sink.flush()) {
            native_capture_recording = false;
            sd_io_error = true;
            last_native_capture_result = LilysharkCaptureWriteResult::SinkError;
            native_capture_sink.close();
            record_runtime_event(RuntimeEventSeverity::Error, RuntimeEventType::Storage,
                                 "Native capture flush failed; recording stopped");
            live_data_dirty = true;
        }
    }
    if(live_data_dirty && now - last_ui_refresh_ms >= 250U) {
        live_data_dirty = false;
        last_ui_refresh_ms = now;
        if(current_screen != Screen::map) {
            redraw = true;
        }
    }
    const bool scan_active = app_shell.route() == ShellRoute::Analyzer &&
                             current_screen == Screen::spectrum &&
                             radio_service.spectrumStatus().active();
    const bool shell_time_driven = app_shell.route() == ShellRoute::Home ||
                                   app_shell.route() == ShellRoute::OnboardingReadiness ||
                                   app_shell.route() == ShellRoute::Storage ||
                                   app_shell.route() == ShellRoute::DeviceStatus;
    const bool time_driven_screen = shell_time_driven ||
                                    (app_shell.route() == ShellRoute::Analyzer &&
                                     (current_screen == Screen::survey ||
                                      current_screen == Screen::events ||
                                      current_screen == Screen::protocols ||
                                      current_screen == Screen::nodes ||
                                      current_screen == Screen::node_detail ||
                                      current_screen == Screen::map ||
                                      current_screen == Screen::utilization ||
                                      current_screen == Screen::timeline));
    const std::uint32_t dynamic_interval_ms = scan_active ? 150U : 1000U;
    if((scan_active || time_driven_screen) &&
       now - last_dynamic_ui_refresh_ms >= dynamic_interval_ms) {
        last_dynamic_ui_refresh_ms = now;
        redraw = true;
    }
    if(redraw) build_current_screen();

    lv_timer_handler();
    delay(5);
}

#endif
