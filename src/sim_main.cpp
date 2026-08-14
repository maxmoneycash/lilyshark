#include <array>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cstring>

#if defined(LILYSHARK_DEVICE)
#include <Arduino.h>
#include <Preferences.h>
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
#endif

#include "theme.h"
#if defined(LILYSHARK_DEVICE)
#include "lilyshark/core/builtin_profiles.h"
#include "lilyshark/core/capture_runtime.h"
#include "lilyshark/core/profile_settings.h"
#include "lilyshark/core/profile_tuning.h"
#include "lilyshark/core/survey_accumulator.h"
#include "lilyshark/device/hardware_status.h"
#include "lilyshark/device/radio_service.h"
#include "lilyshark/device/screenshot.h"
#include "lilyshark/device/touch.h"
#include "lilyshark/device/tdeck_sd_sink.h"
#include "lilyshark/export/lilyshark_capture.h"
#include "lilyshark/export/pcap_loratap.h"
#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshtastic_decoder.h"
#include "lilyshark/protocols/reticulum_decoder.h"
#include "lilyshark/tdeck.h"
#include "lilyshark/ui/packet_presentation.h"
#endif

namespace {

using namespace lilyshark;

enum class Screen : uint8_t {
    traffic,
    spectrum,
    nodes,
    node_detail,
    packet_detail,
    map,
    survey,
    events,
    utilization,
    count,
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
    "TRAFFIC", "SPECTRUM", "NODES", "NODE DETAIL", "PACKET DETAIL",
    "MAP", "SURVEY", "EVENTS", "UTILIZATION",
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

Screen current_screen = Screen::traffic;
lv_obj_t * root = nullptr;
#if defined(LILYSHARK_DEVICE)
static uint8_t * spectrum_buffer = nullptr;
CaptureRuntime<64> capture_runtime{};
MeshtasticDecoder meshtastic_decoder{};
MeshCoreDecoder meshcore_decoder{};
ReticulumDecoder reticulum_decoder{};
TDeckRadioService radio_service{};
TDeckHardwareStatus hardware_status{};
TDeckTouch touch_service{};
TDeckSdByteSink pcap_sink{};
PcapLoraTapWriter pcap_writer{pcap_sink};
TDeckSdByteSink native_capture_sink{};
LilysharkCaptureWriter native_capture_writer{native_capture_sink};
std::size_t active_profile_index = 0;
bool live_data_dirty = false;
bool sd_mounted = false;
bool screenshot_attempted = false;
bool pcap_recording = false;
bool native_capture_recording = false;
bool survey_running = false;
bool survey_has_result = false;
SurveyAccumulator survey_accumulator{};
std::uint32_t last_ui_refresh_ms = 0;
std::uint32_t last_hardware_ui_refresh_ms = 0;
std::uint32_t last_dynamic_ui_refresh_ms = 0;
std::uint32_t last_capture_flush_ms = 0;
std::uint32_t last_screenshot_gap_ms = 0;
std::uint32_t survey_started_ms = 0;
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
#else
static uint8_t spectrum_buffer[LV_CANVAS_BUF_SIZE(306, 145, 16, LV_DRAW_BUF_STRIDE_ALIGN)];
#endif

// The static preview path is compiled for both targets even though device views
// return after drawing live data. Keep its state available to both builds while
// only the simulator mutates it.
std::size_t simulator_traffic_selection = 5;
std::size_t simulator_packet_detail_selection = 5;
std::size_t simulator_node_selection = 2;
bool simulator_spectrum_scanning = false;
bool simulator_survey_running = false;

const char *simulator_survey_footer() noexcept
{
    return simulator_survey_running ? "SURVEY RUNNING" : "ENTER  START 60s SURVEY";
}
static std::array<std::array<lv_point_precise_t, 160>, 16> trace_buffers;
size_t trace_buffer_index = 0;

lv_obj_t * put_label(lv_obj_t * parent, const char * value, lv_coord_t x, lv_coord_t y,
                     lv_color_t color = theme::text(), const lv_font_t * font = &font_condensed_12)
{
    lv_obj_t * object = theme::label(parent, value, color, font);
    lv_obj_set_pos(object, x, y);
    return object;
}

void add_status_bar(lv_obj_t * parent, const char * title, const char * left_value = "BAT 100%",
                    const char * middle_value = "GPS LOCK", const char * right_value = "18 pkt/min")
{
#if defined(LILYSHARK_DEVICE)
    left_value = live_battery_label;
    middle_value = live_gps_label;
    right_value = live_radio_label;
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
    put_label(bar, middle_value, 88, 4, theme::text(), &font_mono_semibold_12);

    if(title_left >= 245) {
        theme::rule_line(bar, 164, 3, 1, 15, theme::rule());
        put_label(bar, right_value, 174, 4, theme::text(), &font_mono_semibold_12);
    }
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
    if(store.empty()) {
        traffic_selected_sequence = 0;
        return 0;
    }

    std::size_t selected_offset = 0;
    if(traffic_selected_sequence != 0 &&
       find_live_frame(traffic_selected_sequence, &selected_offset) != nullptr) {
        return selected_offset;
    }

    const FrameRecord *oldest = store.at(0);
    const bool selection_expired = traffic_selected_sequence != 0 && oldest != nullptr &&
                                   traffic_selected_sequence < oldest->sequence;
    selected_offset = selection_expired ? store.size() - 1 : 0;
    const FrameRecord *fallback = store.newest(selected_offset);
    traffic_selected_sequence = fallback == nullptr ? 0 : fallback->sequence;
    return selected_offset;
}

bool move_traffic_selection(int direction) noexcept
{
    const auto &store = capture_runtime.frames();
    if(store.empty()) return false;

    std::size_t selected_offset = resolve_traffic_selection();
    if(direction > 0) {
        selected_offset = (selected_offset + 1) % store.size();
    } else if(direction < 0) {
        selected_offset = selected_offset == 0 ? store.size() - 1 : selected_offset - 1;
    } else {
        return false;
    }
    const FrameRecord *selected = store.newest(selected_offset);
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
    const FrameRecord *record = store.newest(resolve_traffic_selection());
    if(record == nullptr) return false;
    packet_detail_sequence = record->sequence;
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

SpectrumSweepRequest spectrum_request_for_profile(const RadioProfile &profile) noexcept
{
    SpectrumSweepRequest request{};
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

void build_traffic(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    add_status_bar(parent, "TRAFFIC");
    constexpr lv_coord_t first_y = 28;
    constexpr lv_coord_t row_height = 14;
    const auto &store = capture_runtime.frames();

    if(store.empty()) {
        put_label(parent, "LISTENING FOR FRAMES", 8, 48, theme::lime(), &font_condensed_bold_16);
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

    const std::size_t selected_offset = resolve_traffic_selection();
    const std::size_t maximum_visible = store.size() < 15 ? store.size() : 15;
    const std::size_t first_offset = selected_offset < maximum_visible
        ? 0 : selected_offset - maximum_visible + 1;
    const std::size_t visible = (store.size() - first_offset) < maximum_visible
        ? store.size() - first_offset : maximum_visible;
    for(std::size_t index = 0; index < visible; ++index) {
        const std::size_t offset = first_offset + index;
        const FrameRecord *record = store.newest(offset);
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
        put_label(parent, source, 59, y, row_color, &font_mono_10);
        put_label(parent, ">", 122, y, row_color, &font_mono_10);
        put_label(parent, destination, 133, y, row_color, &font_mono_10);
        put_label(parent, packetKindLabel(record->decoded), 198, y, row_color, &font_mono_10);
        put_label(parent, hops, 250, y, row_color, &font_mono_10);
        put_label(parent, snr, 274, y, row_color, &font_mono_10);
    }
#else
    add_status_bar(parent, "TRAFFIC", "BAT 100%", "GPS 3D", "18 pkt/min");
    constexpr lv_coord_t first_y = 28;
    constexpr lv_coord_t row_height = 14;

    for(size_t index = 0; index < packets.size(); ++index) {
        const lv_coord_t y = first_y + static_cast<lv_coord_t>(index) * row_height;
        const bool selected = index == simulator_traffic_selection;
        const bool healthy = index == 0 || index >= 9;
        if(selected) theme::rect(parent, 4, y - 1, 312, row_height, theme::focus());

        const lv_color_t row_color = selected ? theme::text() : (healthy ? theme::lime() : theme::text());
        put_label(parent, packets[index].time, 7, y, row_color, &font_mono_10);
        put_label(parent, packets[index].source, 60, y, row_color, &font_mono_10);
        put_label(parent, ">", 132, y, row_color, &font_mono_10);
        put_label(parent, packets[index].destination, 143, y, row_color, &font_mono_10);
        put_label(parent, packets[index].port, 205, y, row_color, &font_mono_10);
        put_label(parent, packets[index].hops, 255, y, row_color, &font_mono_10);
        put_label(parent, packets[index].snr, 278, y, row_color, &font_mono_10);
    }
#endif
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
#endif
    add_status_bar(parent, "NODES", "BAT 100%", "GPS LOCK", "18 pkt/min");
    put_label(parent, "NODE", 8, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "LAST", 112, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "BAT", 163, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "SNR  1h", 210, 27, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 6, 43, 308);

    for(size_t index = 0; index < nodes.size(); ++index) {
        const lv_coord_t y = 46 + static_cast<lv_coord_t>(index) * 22;
        const bool selected = index == simulator_node_selection;
        if(selected) theme::rect(parent, 4, y - 2, 312, 21, theme::surface_selected());
        const lv_color_t value_color = selected ? theme::background() : theme::text();
        put_label(parent, nodes[index].name, 8, y, value_color, &font_condensed_bold_16);
        put_label(parent, nodes[index].seen, 112, y + 2, value_color, &font_mono_10);
        put_label(parent, nodes[index].battery, 163, y + 2, value_color, &font_mono_10);
        draw_pixel_line(parent, 211, y + 2, 98, 14, nodes[index].spark_seed,
                        selected ? theme::lime() : theme::lime());
        theme::rule_line(parent, 6, y + 19, 308, 1, theme::grid());
    }
}

void build_spectrum(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, "SPECTRUM");
    const SpectrumSweepStatus &status = radio_service.spectrumStatus();
    const SpectrumSweepResult &result = radio_service.spectrumResult();
    const SpectrumSweepRequest planned_request = spectrum_request_for_profile(radio_service.activeProfile());
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
        put_label(parent, "FULL-BAND SPECTRAL SCAN", 42, 58, theme::text(), &font_condensed_bold_16);
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
        put_label(parent, "ENTER  START EXPERIMENTAL SCAN", 39, 207,
                  theme::cyan(), &font_mono_semibold_12);
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
    if(result.point_count > 0) {
        for(lv_coord_t px = 0; px < width; ++px) {
            std::size_t point = static_cast<std::size_t>(px) * result.point_count /
                                static_cast<std::size_t>(width);
            if(point >= result.point_count) point = result.point_count - 1;
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
        put_label(parent, "PARTIAL RESULT  /  ENTER RESCAN", 49, 204,
                  theme::cyan(), &font_mono_10);
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
        put_label(parent, "RELATIVE POWER  /  ENTER RESCAN", 54, 204,
                  theme::cyan(), &font_mono_10);
    }
    return;
    }
#endif
    add_status_bar(parent, "SPECTRUM", "BAT 100%", "GPS LOCK", "24 pkt/min");
    constexpr lv_coord_t x = 7;
    constexpr lv_coord_t y = 30;
    constexpr lv_coord_t width = 306;
    constexpr lv_coord_t height = 145;
    lv_obj_t * canvas = lv_canvas_create(parent);
    theme::reset(canvas);
    lv_canvas_set_buffer(canvas, spectrum_buffer, width, height, LV_COLOR_FORMAT_RGB565);
    lv_canvas_fill_bg(canvas, theme::heat_deep(), LV_OPA_COVER);
    lv_obj_set_pos(canvas, x, y);

    for(lv_coord_t py = 0; py < height; ++py) {
        const int time = height - 1 - py;
        for(lv_coord_t px = 0; px < width; ++px) {
            uint32_t hash = static_cast<uint32_t>((px + 31) * 374761393u) ^
                            static_cast<uint32_t>((py + 17) * 668265263u);
            hash ^= hash >> 13;

            const int ridge = 116 + static_cast<int>((hash >> 28) & 0x0Fu) - 8;
            const int distance = py > ridge ? py - ridge : ridge - py;
            int energy = 0;
            if(distance < 5) energy += 178 - distance * 24;
            else if(py > 111) energy += (py - 111) * 5;
            if(py < 10 && ((px + time) % 17) < 14) energy += 88;
            if((px % 23) < 2 && py > 24) energy += 35 + ((hash >> 8) & 0x3Fu);
            if((hash & 0xFFu) > 237u) energy += 62;

            lv_color_t color = theme::heat_deep();
            if(energy > 190) color = theme::heat_peak();
            else if(energy > 135) color = theme::heat_hot();
            else if(energy > 88) color = theme::heat_bright();
            else if(energy > 48) color = theme::heat_mid();
            else if(energy > 16) color = theme::heat_cold();
            lv_canvas_set_px(canvas, px, py, color, LV_OPA_COVER);
        }
    }
    lv_obj_invalidate(canvas);

    add_grid(parent, x, y, width, height, 24, 16);
    theme::rule_line(parent, x, y, width);
    theme::rule_line(parent, x, y + height, width);

    theme::rule_line(parent, 159, y, 1, height, theme::cyan());
    for(lv_coord_t tick = y + 7; tick < y + height; tick += 10) theme::rule_line(parent, 153, tick, 13, 1, theme::cyan());

    if(simulator_spectrum_scanning) {
        theme::rect(parent, 0, 181, 320, 42, theme::background());
        theme::rule_line(parent, 7, 182, 306);
        put_label(parent, "SCANNING 42/130  32%  915.000 MHz", 21, 188,
                  theme::amber(), &font_mono_semibold_12);
        put_label(parent, "RX PAUSED - ENTER CANCEL", 82, 207,
                  theme::text_muted(), &font_mono_10);
        return;
    }

    theme::rule_line(parent, 7, 182, 306);
    put_label(parent, "NOISE FLOOR", 16, 186, theme::text_muted(), &font_condensed_12);
    put_label(parent, "-98 dBm", 23, 199, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 107, 183, 1, 32);
    put_label(parent, "BUSIEST", 132, 186, theme::text_muted(), &font_condensed_12);
    put_label(parent, "914.2", 137, 199, theme::amber(), &font_mono_semibold_12);
    theme::rule_line(parent, 211, 183, 1, 32);
    put_label(parent, "QUIETEST", 242, 186, theme::text_muted(), &font_condensed_12);
    put_label(parent, "908.1", 251, 199, theme::cyan(), &font_mono_semibold_12);
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
#endif
    add_status_bar(parent, "NODE DETAIL", "BAT 100%", "GPS LOCK", "12 nodes");
    const NodeRow &selected_node = nodes[simulator_node_selection];
    put_label(parent, selected_node.name, 8, 25, theme::text(), &font_condensed_bold_28);
    char node_line[40]{};
    std::snprintf(node_line, sizeof(node_line), "LAST SEEN  %s", selected_node.seen);
    put_label(parent, node_line, 9, 54, theme::text_muted(), &font_mono_10);
    put_label(parent, selected_node.battery, 275, 31, theme::lime(), &font_mono_semibold_12);
    theme::rule_line(parent, 6, 68, 308);

    struct Plot { const char * name; lv_coord_t y; uint8_t seed; bool bars; };
    constexpr std::array<Plot, 3> plots = {{{"SNR", 77, 5, false}, {"RSSI", 123, 13, true}, {"HOP COUNT", 169, 21, false}}};
    for(const Plot & plot : plots) {
        put_label(parent, plot.name, 8, plot.y, theme::text(), &font_mono_10);
        const lv_coord_t plot_y = plot.y + 11;
        add_grid(parent, 39, plot_y, 273, 27, 45, 13);
        draw_pixel_line(parent, 39, plot_y + 2, 272, 23, plot.seed, theme::lime(), plot.bars);
        theme::rule_line(parent, 39, plot_y + 27, 273, 1, theme::text_muted());
    }
    put_label(parent, "LAST POSITION  40.7128 N, 74.0060 W", 8, 219, theme::text_muted(), &font_mono_10);
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

    theme::rect(parent, 0, 22, 38, 201, theme::surface());
    theme::rule_line(parent, 37, 22, 1, 201);
    constexpr std::array<const char *, 5> nav = {{"TRF", "SPC", "NOD", "MAP", "CFG"}};
    for(std::size_t index = 0; index < nav.size(); ++index) {
        const lv_coord_t y = 29 + static_cast<lv_coord_t>(index) * 37;
        if(index == 0) theme::rect(parent, 0, y - 4, 37, 31, theme::rule());
        put_label(parent, nav[index], 8, y + 4, index == 0 ? theme::lime() : theme::text(), &font_mono_10);
    }

    char source[12]{};
    char destination[12]{};
    char line[72]{};
    format_node(source, sizeof(source), record->decoded, FieldSource);
    format_node(destination, sizeof(destination), record->decoded, FieldDestination);
    std::snprintf(line, sizeof(line), "%s  >  %s", source, destination);
    put_label(parent, line, 49, 29, theme::text(), &font_mono_semibold_12);
    std::snprintf(line, sizeof(line), "%s  %s  %s  %u B", protocolName(record->decoded.protocol),
                  packetKindLabel(record->decoded), decodeStateLabel(record->decoded.state),
                  record->raw.captured_length);
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

    if(record->decoded.protocol == ProtocolId::MeshCore) {
        std::snprintf(line, sizeof(line), "ROUTE %u  TYPE %s  PATH %ux%u",
                      static_cast<unsigned>(MeshCoreDecoder::routeType(record->decoded)),
                      packetKindLabel(record->decoded),
                      static_cast<unsigned>(MeshCoreDecoder::pathHashCount(record->decoded)),
                      static_cast<unsigned>(MeshCoreDecoder::pathHashSize(record->decoded)));
    } else if(record->decoded.protocol == ProtocolId::Reticulum) {
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
    put_label(parent, line, 49, 111, theme::cyan(), &font_mono_10);
    put_label(parent, "RAW FRAME", 49, 136, theme::text_muted(), &font_mono_10);

    for(std::size_t row = 0; row < 4; ++row) {
        char hex[48]{};
        std::size_t cursor = 0;
        for(std::size_t column = 0; column < 10; ++column) {
            const std::size_t offset = row * 10 + column;
            if(offset >= record->raw.captured_length || cursor + 4 >= sizeof(hex)) break;
            cursor += static_cast<std::size_t>(std::snprintf(hex + cursor, sizeof(hex) - cursor,
                                                              "%02X ", record->raw.bytes[offset]));
        }
        put_label(parent, hex, 49, 151 + static_cast<lv_coord_t>(row) * 14,
                  row == 0 ? theme::text() : theme::text_muted(), &font_mono_10);
    }
    return;
    }
#endif
    const PacketRow &selected_packet = packets[simulator_packet_detail_selection];
    add_status_bar(parent, "PACKET DETAIL", "BAT 100%", "GPS LOCK", selected_packet.time);
    theme::rect(parent, 0, 22, 38, 201, theme::surface());
    theme::rule_line(parent, 37, 22, 1, 201);
    constexpr std::array<const char *, 5> nav = {{"TRF", "SPC", "NOD", "MAP", "CFG"}};
    for(size_t index = 0; index < nav.size(); ++index) {
        const lv_coord_t y = 29 + static_cast<lv_coord_t>(index) * 37;
        if(index == 0) theme::rect(parent, 0, y - 4, 37, 31, theme::rule());
        put_label(parent, nav[index], 8, y + 4, index == 0 ? theme::lime() : theme::text(), &font_mono_10);
    }

    char detail_line[72]{};
    std::snprintf(detail_line, sizeof(detail_line), "%s  >  %s",
                  selected_packet.source, selected_packet.destination);
    put_label(parent, detail_line, 49, 31, theme::text(), &font_mono_semibold_12);
    std::snprintf(detail_line, sizeof(detail_line), "PORT  %s", selected_packet.port);
    put_label(parent, detail_line, 49, 58, theme::amber(), &font_mono_10);
    std::snprintf(detail_line, sizeof(detail_line), "HOPS  %s    SNR  %s dB",
                  selected_packet.hops, selected_packet.snr);
    put_label(parent, detail_line, 49, 75, theme::text(), &font_mono_10);
    put_label(parent, "RSSI  -89 dBm", 49, 91, theme::text(), &font_mono_10);
    theme::rule_line(parent, 47, 109, 266);
    put_label(parent, "ROUTE", 49, 116, theme::text_muted(), &font_mono_10);
    std::snprintf(detail_line, sizeof(detail_line), "%s > Relay3 > Hilltop7 > You",
                  selected_packet.source);
    put_label(parent, detail_line, 49, 131, theme::text(), &font_condensed_12);
    put_label(parent, "PAYLOAD", 49, 153, theme::cyan(), &font_mono_10);
    const char *payload_preview = std::strcmp(selected_packet.port, "POS") == 0
        ? "37.7749 N, 122.4194 W  ALT 15m"
        : (std::strcmp(selected_packet.port, "TEXT") == 0
               ? "TEXT PAYLOAD PREVIEW"
               : (std::strcmp(selected_packet.port, "TELE") == 0
                      ? "TELEMETRY PAYLOAD PREVIEW"
                      : "ROUTING PAYLOAD PREVIEW"));
    put_label(parent, payload_preview, 49, 168, theme::cyan(), &font_mono_10);
    theme::rule_line(parent, 47, 187, 266);
    put_label(parent, "52 45 4C 41 59 3A 20 7B 22 6C 61 74 22 3A", 49, 194, theme::text(), &font_mono_10);
    put_label(parent, "33 37 2E 37 37 34 39 2C 22 6C 6F 6E 22 3A", 49, 207, theme::text_muted(), &font_mono_10);
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
    } else {
        put_label(parent, "NO GPS RECEIVER", 98, 42, theme::text_muted(), &font_mono_semibold_12);
    }
    put_label(parent, "REMOTE POSITIONS REQUIRE A DECODED POSITION FRAME", 20, 204,
              theme::text_muted(), &font_mono_10);
    return;
    }
#endif
    add_status_bar(parent, "MAP", "BAT 100%", "GPS LOCK", "12 nodes");
    add_grid(parent, 0, 22, 320, 201, 20, 20);
    theme::rule_line(parent, 160, 23, 1, 199, theme::text_muted());
    theme::rule_line(parent, 0, 123, 320, 1, theme::text_muted());

    constexpr lv_coord_t cx = 160;
    constexpr lv_coord_t cy = 123;
    for(lv_coord_t radius = 28; radius <= 84; radius += 28) {
        lv_obj_t * circle = lv_obj_create(parent);
        theme::reset(circle);
        lv_obj_set_pos(circle, cx - radius, cy - radius);
        lv_obj_set_size(circle, radius * 2, radius * 2);
        lv_obj_set_style_radius(circle, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_border_width(circle, 1, 0);
        lv_obj_set_style_border_color(circle, radius == 84 ? theme::text() : theme::rule(), 0);
        lv_obj_set_style_bg_opa(circle, LV_OPA_TRANSP, 0);
    }
    theme::rule_line(parent, cx - 32, cy, 64, 2, theme::lime());
    theme::rule_line(parent, cx, cy - 32, 2, 64, theme::lime());

    struct NodeMark { lv_coord_t x; lv_coord_t y; const char * label; lv_color_t (*color)(); };
    constexpr std::array<NodeMark, 4> marks = {{{54, 55, "N1", theme::lime}, {270, 84, "N2", theme::amber},
                                                {252, 164, "N3", theme::text}, {38, 167, "N4", theme::text_muted}}};
    for(const NodeMark & mark : marks) {
        lv_obj_t * dot = theme::rect(parent, mark.x, mark.y, 10, 10, mark.color());
        lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
        put_label(parent, mark.label, mark.x - 1, mark.y + 13, mark.color(), &font_mono_semibold_12);
    }
}

void build_survey(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, "SURVEY");
    const std::uint32_t elapsed_ms = survey_running
        ? (millis() - survey_started_ms)
        : (survey_has_result ? 60000U : 0U);
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
    put_label(parent, survey_running ? "SURVEY RUNNING" : "ENTER  START 60s SURVEY", 54, 216,
              survey_running ? theme::text_muted() : theme::cyan(), &font_mono_semibold_12);
    return;
    }
#endif
    add_status_bar(parent, "SURVEY", "BAT 100%", "GPS LOCK", "915.0 MHz");
    put_label(parent, simulator_survey_running ? "CAPTURING" : "READY",
              simulator_survey_running ? 44 : 118, 47,
              simulator_survey_running ? theme::amber() : theme::lime(),
              &font_condensed_bold_28);
    put_label(parent, simulator_survey_running ? "42s / 60s" : "0s / 60s", 241, 88,
              theme::lime(), &font_mono_semibold_12);

    lv_obj_t * progress = theme::rect(parent, 9, 84, 221, 23, theme::background());
    lv_obj_set_style_border_width(progress, 1, 0);
    lv_obj_set_style_border_color(progress, theme::text_muted(), 0);
    if(simulator_survey_running) theme::rect(progress, 3, 3, 152, 17, theme::lime());

    put_label(parent, "NODES HEARD", 10, 121, theme::text_muted(), &font_condensed_12);
    put_label(parent, simulator_survey_running ? "7" : "0", 120, 116,
              theme::text(), &font_condensed_bold_16);
    put_label(parent, "BEST SNR", 10, 143, theme::text_muted(), &font_condensed_12);
    put_label(parent, simulator_survey_running ? "-6.2 dB" : "--", 120, 139,
              theme::text(), &font_mono_semibold_12);
    put_label(parent, "NOISE", 10, 165, theme::text_muted(), &font_condensed_12);
    put_label(parent, simulator_survey_running ? "-97 dBm" : "--", 120, 161,
              theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 0, 190, 320);
    put_label(parent, simulator_survey_footer(),
              simulator_survey_running ? 104 : 51, 199,
              simulator_survey_running ? theme::text_muted() : theme::cyan(),
              &font_mono_semibold_12);
}

void build_events(lv_obj_t * parent)
{
#if defined(LILYSHARK_DEVICE)
    {
    add_status_bar(parent, "EVENTS");
    const RadioStatus &radio = radio_service.status();
    char time[12]{};
    const std::uint32_t uptime_seconds = millis() / 1000U;
    std::snprintf(time, sizeof(time), "%02lu:%02lu", static_cast<unsigned long>((uptime_seconds / 60U) % 100U),
                  static_cast<unsigned long>(uptime_seconds % 60U));

    struct LiveEvent { const char *kind; char detail[96]; lv_color_t color; };
    std::array<LiveEvent, 6> events{};
    if(screenshot_attempted) {
        if(last_screenshot_result == ScreenshotWriteResult::Ok) {
            std::snprintf(events[0].detail, sizeof(events[0].detail), "%s  capture gap %lums",
                          screenshot_path, static_cast<unsigned long>(last_screenshot_gap_ms));
        } else {
            std::snprintf(events[0].detail, sizeof(events[0].detail),
                          "Screenshot failed  capture gap %lums",
                          static_cast<unsigned long>(last_screenshot_gap_ms));
        }
        events[0].kind = last_screenshot_result == ScreenshotWriteResult::Ok
                             ? "SCREENSHOT" : "SHOT ERR";
        events[0].color = last_screenshot_result == ScreenshotWriteResult::Ok
                              ? theme::lime() : theme::fault();
    } else {
        std::snprintf(events[0].detail, sizeof(events[0].detail), "Firmware running for %lus",
                      static_cast<unsigned long>(uptime_seconds));
        events[0].kind = "BOOT";
        events[0].color = theme::lime();
    }

    std::snprintf(events[1].detail, sizeof(events[1].detail), "%s  error %d",
                  radio.receiving ? "SX1262 listening" : "SX1262 not receiving", radio.last_error);
    events[1].kind = radio.receiving ? "RADIO OK" : "RADIO ERR";
    events[1].color = radio.receiving ? theme::lime() : theme::fault();

    const RadioProfile &profile = radio_service.activeProfile();
    if(radio.last_profile_error != 0) {
        std::snprintf(events[2].detail, sizeof(events[2].detail),
                      "%s  rollback kept RX  last error %d", profile.name,
                      radio.last_profile_error);
        events[2].kind = "PROFILE WARN";
        events[2].color = theme::amber();
    } else {
        std::snprintf(events[2].detail, sizeof(events[2].detail),
                      "%s %.3f  B%.1f S%u C%u",
                      protocol_abbreviation(profile.protocol_hint),
                      static_cast<double>(profile.center_frequency_hz) / 1000000.0,
                      static_cast<double>(profile.bandwidth_hz) / 1000.0,
                      profile.spreading_factor, profile.coding_rate_denominator);
        events[2].kind = "PROFILE";
        events[2].color = theme::cyan();
    }

    std::snprintf(events[3].detail, sizeof(events[3].detail), "%s",
                  native_capture_recording ? native_capture_path : "No writable SD capture");
    events[3].kind = native_capture_recording ? "LSCAP REC" : "LSCAP OFF";
    events[3].color = native_capture_recording ? theme::lime() : theme::amber();

    const bool pcap_bw_unsupported = last_pcap_result == PcapWriteResult::InvalidBandwidth;
    std::snprintf(events[4].detail, sizeof(events[4].detail), "%s",
                  pcap_bw_unsupported ? "Active bandwidth cannot fit LoRaTap v0" :
                  (pcap_recording ? pcap_path : "PCAP unavailable"));
    events[4].kind = pcap_bw_unsupported ? "PCAP LIMIT" : (pcap_recording ? "PCAP REC" : "PCAP OFF");
    events[4].color = pcap_bw_unsupported ? theme::amber() :
                      (pcap_recording ? theme::lime() : theme::text_muted());

    std::snprintf(events[5].detail, sizeof(events[5].detail), "%lu frames  %lu bad CRC  %lu RX errors",
                  static_cast<unsigned long>(radio.received_frames),
                  static_cast<unsigned long>(radio.crc_errors),
                  static_cast<unsigned long>(radio.receive_errors));
    events[5].kind = "COUNTERS";
    events[5].color = radio.crc_errors == 0 && radio.receive_errors == 0 ? theme::cyan() : theme::amber();

    for(std::size_t index = 0; index < events.size(); ++index) {
        const lv_coord_t y = 29 + static_cast<lv_coord_t>(index) * 32;
        put_label(parent, index == 0 ? time : "", 7, y, events[index].color, &font_mono_10);
        put_label(parent, events[index].kind, index == 0 ? 57 : 7, y, events[index].color,
                  &font_mono_semibold_12);
        put_label(parent, events[index].detail, 7, y + 15, theme::text(), &font_mono_10);
        theme::rule_line(parent, 6, y + 28, 308, 1, theme::grid());
    }
    return;
    }
#endif
    add_status_bar(parent, "EVENTS", "BAT 100%", "GPS LOCK", "5 recent");
    struct Event { const char * time; const char * kind; const char * detail; lv_color_t (*color)(); };
    constexpr std::array<Event, 5> events = {{{"14:11", "NEW NODE", "Mobile-4 appeared  SNR -12.1", theme::lime},
                                               {"14:08", "HIGH UTIL", "Channel hit 67% for 40s", theme::amber},
                                               {"14:03", "NODE LOST", "Tracker-9 silent >15 min", theme::fault},
                                               {"13:58", "STRONG INT", "Interference spike on 914.8", theme::amber},
                                               {"13:51", "NEW NODE", "BaseCamp joined", theme::lime}}};
    for(size_t index = 0; index < events.size(); ++index) {
        const lv_coord_t y = 37 + static_cast<lv_coord_t>(index) * 32;
        put_label(parent, events[index].time, 8, y, events[index].color(), &font_mono_semibold_12);
        put_label(parent, events[index].kind, 55, y, events[index].color(), &font_mono_semibold_12);
        put_label(parent, events[index].detail, 8, y + 15, theme::text(), &font_mono_10);
        theme::rule_line(parent, 6, y + 27, 308, 1, theme::grid());
    }
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
#endif
    add_status_bar(parent, "UTILIZATION", "BAT 100%", "GPS LOCK", "19 pkt/min");
    lv_obj_t * gauge = lv_arc_create(parent);
    lv_obj_set_pos(gauge, 10, 31);
    lv_obj_set_size(gauge, 140, 140);
    lv_arc_set_rotation(gauge, 135);
    lv_arc_set_bg_angles(gauge, 0, 270);
    lv_arc_set_value(gauge, 41);
    lv_obj_remove_style(gauge, nullptr, LV_PART_KNOB);
    lv_obj_clear_flag(gauge, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(gauge, 7, LV_PART_MAIN);
    lv_obj_set_style_arc_color(gauge, theme::rule(), LV_PART_MAIN);
    lv_obj_set_style_arc_width(gauge, 7, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(gauge, theme::lime(), LV_PART_INDICATOR);

    put_label(parent, "41%", 39, 64, theme::text(), &font_condensed_bold_28);
    put_label(parent, "CHANNEL", 42, 96, theme::text_muted(), &font_mono_10);
    put_label(parent, "UTILIZATION", 29, 108, theme::text_muted(), &font_mono_10);
    theme::rule_line(parent, 173, 31, 1, 121);
    put_label(parent, "NOISE FLOOR", 187, 45, theme::text_muted(), &font_condensed_12);
    put_label(parent, "-115 dBm", 187, 61, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 185, 83, 122);
    put_label(parent, "PEAK 1m", 187, 94, theme::text_muted(), &font_condensed_12);
    put_label(parent, "78%", 187, 110, theme::amber(), &font_mono_semibold_12);

    put_label(parent, "60%", 8, 166, theme::text_muted(), &font_mono_10);
    put_label(parent, "20%", 8, 186, theme::text_muted(), &font_mono_10);
    put_label(parent, "0", 20, 204, theme::text_muted(), &font_mono_10);

    for(lv_coord_t index = 0; index < 22; ++index) {
        const lv_coord_t height = 9 + ((index * 13 + 7) % 28);
        const lv_color_t color = (index >= 8 && index <= 15) ? (index % 2 ? theme::fault() : theme::amber()) : theme::lime();
        theme::rect(parent, 42 + index * 12, 211 - height, 8, height, color);
    }
    theme::rule_line(parent, 39, 212, 270);
    put_label(parent, "902", 39, 216, theme::text_muted(), &font_mono_10);
    put_label(parent, "915", 166, 216, theme::text_muted(), &font_mono_10);
    put_label(parent, "928 MHz", 269, 216, theme::text_muted(), &font_mono_10);
}

void build_current_screen()
{
    root = lv_screen_active();
    lv_obj_clean(root);
    theme::style_screen(root);
    trace_buffer_index = 0;

    switch(current_screen) {
        case Screen::traffic: build_traffic(root); break;
        case Screen::spectrum: build_spectrum(root); break;
        case Screen::nodes: build_nodes(root); break;
        case Screen::node_detail: build_node_detail(root); break;
        case Screen::packet_detail: build_packet_detail(root); break;
        case Screen::map: build_map(root); break;
        case Screen::survey: build_survey(root); break;
        case Screen::events: build_events(root); break;
        case Screen::utilization: build_utilization(root); break;
        case Screen::count: break;
    }
}

#if defined(LILYSHARK_DEVICE)
void take_device_screenshot() noexcept;

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
    if(!status.initialized) {
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

void on_radio_frame(const RawFrame &frame, const RadioProfile &profile, void *) noexcept
{
    const FrameRecord *previous_newest = capture_runtime.frames().newest();
    const bool follow_newest = traffic_selected_sequence == 0 ||
                               (previous_newest != nullptr &&
                                traffic_selected_sequence == previous_newest->sequence);
    const IngestResult ingest = capture_runtime.ingest(frame, profile);
    if(follow_newest) traffic_selected_sequence = ingest.sequence;
    const FrameRecord *stored = capture_runtime.frames().newest();
    if(survey_running && stored != nullptr) survey_accumulator.ingest(*stored);
    if(native_capture_recording) {
        last_native_capture_result = stored != nullptr
            ? native_capture_writer.write(*stored)
            : LilysharkCaptureWriteResult::InvalidFrame;
        if(last_native_capture_result == LilysharkCaptureWriteResult::SinkError) {
            native_capture_recording = false;
            native_capture_sink.close();
        }
    }
    if(pcap_recording) {
        last_pcap_result = pcap_writer.write(frame);
        if(last_pcap_result == PcapWriteResult::SinkError) {
            pcap_recording = false;
            pcap_sink.close();
        }
    }
    live_data_dirty = true;
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

bool write_saved_profile(const RadioProfile &profile) noexcept
{
    if(!profile_preferences_ready) return false;
    std::uint8_t bytes[kSavedProfileV2Size]{};
    return encodeSavedProfileV2(profile, bytes, sizeof(bytes)) &&
           profile_preferences.putBytes("profile", bytes, sizeof(bytes)) == sizeof(bytes);
}

bool load_saved_profile(RadioProfile &profile) noexcept
{
    profile_preferences_ready = profile_preferences.begin("lilyshark", false);
    if(!profile_preferences_ready) return false;

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

void cycle_active_profile() noexcept
{
    const std::size_t count = builtinProfileCount();
    if(count == 0) return;
    const std::size_t candidate_index = (active_profile_index + 1) % count;
    const RadioProfile &next = builtinProfiles()[candidate_index];
    const bool ready = radio_service.setProfile(next);
    if(ready) {
        active_profile_index = candidate_index;
        if(!save_active_profile()) Serial.println("Lilyshark profile settings were not saved");
    }
    update_live_radio_label();
    Serial.printf("Lilyshark profile: %s (%s, error %d)\n", next.name,
                  ready ? "listening" : "failed",
                  ready ? radio_service.status().last_error
                        : radio_service.status().last_profile_error);
    build_current_screen();
}

void apply_tuned_profile(const RadioProfile &candidate, const char *action) noexcept
{
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
    if(ready && !save_active_profile()) {
        Serial.println("Lilyshark profile settings were not saved");
    }
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

constexpr std::array<Screen, 7> primary_screens = {{
    Screen::traffic,
    Screen::spectrum,
    Screen::nodes,
    Screen::map,
    Screen::survey,
    Screen::events,
    Screen::utilization,
}};

Screen primary_context(Screen screen) noexcept
{
    if(screen == Screen::packet_detail) return Screen::traffic;
    if(screen == Screen::node_detail) return Screen::nodes;
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
    if(direction > 0) {
        current_index = (current_index + 1) % primary_screens.size();
    } else {
        current_index = current_index == 0 ? primary_screens.size() - 1 : current_index - 1;
    }
    current_screen = primary_screens[current_index];
    build_current_screen();
#if defined(LILYSHARK_DEVICE)
    Serial.printf("Lilyshark view: %s\n", screen_names[static_cast<std::size_t>(current_screen)]);
#else
    std::fprintf(stderr, "Lilyshark view: %s\n",
                 screen_names[static_cast<std::size_t>(current_screen)]);
#endif
}

void handle_navigation_key(uint32_t key)
{
#if defined(LILYSHARK_DEVICE)
    if(key == 'p' || key == 'P') {
        cycle_active_profile();
        return;
    }
    if(key == 's' || key == 'S') {
        take_device_screenshot();
        return;
    }
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

    if(key == LV_KEY_ENTER || key == '\r') {
#if defined(LILYSHARK_DEVICE)
        if(current_screen == Screen::spectrum) {
            if(spectrum_buffer == nullptr) return;
            if(radio_service.spectrumStatus().active()) {
                radio_service.cancelSpectrumSweep();
            } else {
                const SpectrumSweepRequest request = spectrum_request_for_profile(radio_service.activeProfile());
                radio_service.startSpectrumSweep(request);
            }
            build_current_screen();
        } else if(current_screen == Screen::traffic && select_current_frame_for_detail()) {
            current_screen = Screen::packet_detail;
            build_current_screen();
        } else if(current_screen == Screen::nodes && select_current_node_for_detail()) {
            current_screen = Screen::node_detail;
            build_current_screen();
        } else if(current_screen == Screen::survey && !survey_running) {
            survey_accumulator.reset();
            survey_running = true;
            survey_has_result = false;
            survey_started_ms = millis();
            build_current_screen();
        }
#else
        if(current_screen == Screen::spectrum) {
            simulator_spectrum_scanning = !simulator_spectrum_scanning;
            build_current_screen();
        } else if(current_screen == Screen::traffic) {
            simulator_packet_detail_selection = simulator_traffic_selection;
            current_screen = Screen::packet_detail;
            build_current_screen();
        } else if(current_screen == Screen::nodes) {
            current_screen = Screen::node_detail;
            build_current_screen();
        } else if(current_screen == Screen::survey && !simulator_survey_running) {
            simulator_survey_running = true;
            build_current_screen();
        }
#endif
        return;
    }
    if(key == LV_KEY_ESC || key == 0x08U) {
        if(current_screen == Screen::packet_detail) current_screen = Screen::traffic;
        else if(current_screen == Screen::node_detail) current_screen = Screen::nodes;
        else return;
        build_current_screen();
        return;
    }
    if(key == LV_KEY_DOWN || key == LV_KEY_UP) {
        const int direction = key == LV_KEY_DOWN ? 1 : -1;
        bool moved = false;
#if defined(LILYSHARK_DEVICE)
        if(current_screen == Screen::traffic) moved = move_traffic_selection(direction);
        else if(current_screen == Screen::nodes) moved = move_node_selection(direction);
#else
        if(current_screen == Screen::traffic) {
            if(direction > 0) {
                simulator_traffic_selection =
                    (simulator_traffic_selection + 1) % packets.size();
            } else {
                simulator_traffic_selection = simulator_traffic_selection == 0
                    ? packets.size() - 1 : simulator_traffic_selection - 1;
            }
            moved = true;
        } else if(current_screen == Screen::nodes) {
            if(direction > 0) {
                simulator_node_selection = (simulator_node_selection + 1) % nodes.size();
            } else {
                simulator_node_selection = simulator_node_selection == 0
                    ? nodes.size() - 1 : simulator_node_selection - 1;
            }
            moved = true;
        }
#endif
        if(moved) build_current_screen();
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

    if(key < '1' || key > '9') return;
    const int next = static_cast<int>(key - '1');

#if defined(LILYSHARK_DEVICE)
    if(static_cast<Screen>(next) == Screen::packet_detail) select_current_frame_for_detail();
    else if(static_cast<Screen>(next) == Screen::node_detail) select_current_node_for_detail();
#else
    if(static_cast<Screen>(next) == Screen::packet_detail) {
        simulator_packet_detail_selection = simulator_traffic_selection;
    }
#endif
    current_screen = static_cast<Screen>(next);
    build_current_screen();
#if defined(LILYSHARK_DEVICE)
    Serial.printf("Lilyshark view: %s\n", screen_names[static_cast<size_t>(current_screen)]);
#else
    std::fprintf(stderr, "Lilyshark view: %s\n", screen_names[static_cast<size_t>(current_screen)]);
#endif
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
    current_screen = Screen::traffic;
    simulator_traffic_selection = 5;
    simulator_packet_detail_selection = 5;
    simulator_node_selection = 2;
    simulator_spectrum_scanning = false;
    simulator_survey_running = false;
    build_current_screen();

    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(current_screen == Screen::traffic &&
                               simulator_traffic_selection == 6,
                               "Down must move the Traffic focus")) return false;
    handle_navigation_key(LV_KEY_UP);
    if(!expect_simulator_state(simulator_traffic_selection == 5,
                               "Up must move the Traffic focus")) return false;

    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(current_screen == Screen::packet_detail &&
                               simulator_packet_detail_selection == simulator_traffic_selection &&
                               std::strcmp(packets[simulator_packet_detail_selection].source,
                                           packets[simulator_traffic_selection].source) == 0 &&
                               std::strcmp(packets[simulator_packet_detail_selection].port,
                                           packets[simulator_traffic_selection].port) == 0,
                               "Enter must open the focused Packet Detail")) return false;
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(current_screen == Screen::spectrum,
                               "Right from Packet Detail must use the Traffic context")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(simulator_spectrum_scanning,
                               "Enter must start the simulated spectrum scan")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(!simulator_spectrum_scanning,
                               "Enter must cancel the simulated spectrum scan")) return false;
    handle_navigation_key(LV_KEY_LEFT);
    handle_navigation_key(LV_KEY_ENTER);
    handle_navigation_key(0x08U);
    if(!expect_simulator_state(current_screen == Screen::traffic,
                               "Back must return from Packet Detail")) return false;

    handle_navigation_key(LV_KEY_DOWN);
    handle_navigation_key('5');
    if(!expect_simulator_state(current_screen == Screen::packet_detail &&
                               simulator_packet_detail_selection == simulator_traffic_selection,
                               "Numeric Packet Detail must bind the focused frame")) return false;
    handle_navigation_key(0x08U);

    handle_navigation_key(LV_KEY_RIGHT);
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(current_screen == Screen::nodes,
                               "Primary navigation must reach Nodes")) return false;
    handle_navigation_key(LV_KEY_DOWN);
    if(!expect_simulator_state(simulator_node_selection == 3,
                               "Down must move the Nodes focus")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(current_screen == Screen::node_detail,
                               "Enter must open Node Detail")) return false;
    handle_navigation_key(0x08U);
    if(!expect_simulator_state(current_screen == Screen::nodes,
                               "Back must return from Node Detail")) return false;

    handle_navigation_key(LV_KEY_RIGHT);
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(current_screen == Screen::survey,
                               "Primary navigation must skip detail views")) return false;
    handle_navigation_key(LV_KEY_ENTER);
    if(!expect_simulator_state(simulator_survey_running &&
                               std::strcmp(simulator_survey_footer(), "SURVEY RUNNING") == 0,
                               "Enter must start a consistent Survey state")) return false;

    handle_navigation_key(LV_KEY_RIGHT);
    handle_navigation_key(LV_KEY_RIGHT);
    handle_navigation_key(LV_KEY_RIGHT);
    if(!expect_simulator_state(current_screen == Screen::traffic,
                               "Primary navigation must wrap after Utilization")) return false;

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

bool run_simulator_render_test() noexcept
{
    constexpr std::array<std::uint64_t, static_cast<std::size_t>(Screen::count)> expected_hashes = {{
        0x5be023a703b40378ULL,
        0x21bdb9b2a5dac652ULL,
        0x52ca6055741ab80cULL,
        0xc10d6ea78f5d9e95ULL,
        0x3cbf2663619237aeULL,
        0x6bb9662debb8ed87ULL,
        0x50293e8705d75336ULL,
        0xba60c5cd5d026f64ULL,
        0x66e13c696b3242eaULL,
    }};

    lv_display_t *display = lv_display_create(theme::screen_width, theme::screen_height);
    if(!expect_simulator_state(display != nullptr, "headless display allocation")) return false;
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(display, simulator_frame_buffer.data(), nullptr,
                           sizeof(simulator_frame_buffer), LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_flush_cb(display, simulator_frame_flush);

    std::array<std::uint64_t, static_cast<std::size_t>(Screen::count)> observed_hashes{};
    const std::uint16_t background = lv_color_to_u16(theme::background());
    bool passed = true;
    for(std::size_t index = 0; index < static_cast<std::size_t>(Screen::count); ++index) {
        current_screen = static_cast<Screen>(index);
        build_current_screen();
        lv_refr_now(display);

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
    if(passed) std::fprintf(stderr, "Lilyshark simulator render test passed\n");
    return passed;
}
#endif

void handle_key(lv_event_t * event)
{
    handle_navigation_key(lv_event_get_key(event));
}

} // namespace

#if !defined(LILYSHARK_DEVICE)
int main(int argc, char ** argv)
{
    const bool soak_mode = argc > 1 && std::strcmp(argv[1], "--soak") == 0;
    const bool interaction_test_mode =
        argc > 1 && std::strcmp(argv[1], "--interaction-test") == 0;
    const bool render_test_mode =
        argc > 1 && std::strcmp(argv[1], "--render-test") == 0;
    if(argc > 1 && !soak_mode && !interaction_test_mode && !render_test_mode) {
        const int requested = std::atoi(argv[1]);
        if(requested >= 1 && requested <= static_cast<int>(Screen::count)) {
            current_screen = static_cast<Screen>(requested - 1);
        }
    }

    lv_init();

    if(render_test_mode) {
        return run_simulator_render_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    }

    lv_display_t * display = lv_sdl_window_create(theme::screen_width, theme::screen_height);
    lv_sdl_window_set_title(display, "Lilyshark Simulator");
    lv_sdl_window_set_resizeable(display, false);
    lv_sdl_window_set_zoom(display, 2);
    lv_sdl_mouse_create();

    lv_indev_t * keyboard = lv_sdl_keyboard_create();
    lv_group_t * group = lv_group_create();
    lv_indev_set_group(keyboard, group);

    lv_obj_t * screen = lv_screen_active();
    lv_obj_add_flag(screen, LV_OBJ_FLAG_CLICKABLE);
    lv_group_add_obj(group, screen);
    lv_group_focus_obj(screen);
    lv_obj_add_event_cb(screen, handle_key, LV_EVENT_KEY, nullptr);

    build_current_screen();
    if(interaction_test_mode) {
        return run_simulator_interaction_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    }

    constexpr std::uint64_t soak_screen_interval_ms = 1000;
    std::uint64_t next_soak_screen_ms = SDL_GetTicks64() + soak_screen_interval_ms;
    std::uint64_t soak_transitions = 0;
    while(true) {
        lv_timer_handler();
        if(soak_mode) {
            const std::uint64_t now_ms = SDL_GetTicks64();
            if(now_ms >= next_soak_screen_ms) {
                const int next = (static_cast<int>(current_screen) + 1) %
                                 static_cast<int>(Screen::count);
                current_screen = static_cast<Screen>(next);
                build_current_screen();
                ++soak_transitions;
                next_soak_screen_ms = now_ms + soak_screen_interval_ms;
                if(current_screen == Screen::traffic) {
                    if(lv_mem_test() != LV_RESULT_OK) {
                        std::fprintf(stderr, "fatal error: LVGL heap integrity check failed\n");
                        return EXIT_FAILURE;
                    }
                    lv_mem_monitor_t memory{};
                    lv_mem_monitor(&memory);
                    std::fprintf(stderr,
                                 "Lilyshark soak cycle %llu passed: used=%u%% frag=%u%% free=%zu max=%zu\n",
                                 static_cast<unsigned long long>(soak_transitions /
                                                                  static_cast<std::uint64_t>(Screen::count)),
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
    if(now < next_poll_ms) return;
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
        if(abs_x >= 40 && abs_x > abs_y) {
            handle_navigation_key(delta_x < 0 ? LV_KEY_RIGHT : LV_KEY_LEFT);
        } else if(abs_y >= 36) {
            handle_navigation_key(delta_y < 0 ? LV_KEY_DOWN : LV_KEY_UP);
        } else if(now - touch_started_ms <= 800U) {
            handle_navigation_key(LV_KEY_ENTER);
        }
    }
}

void take_device_screenshot() noexcept
{
    const std::uint32_t started_ms = millis();
    screenshot_attempted = true;
    if(!sd_mounted) {
        screenshot_path[0] = '\0';
        last_screenshot_result = ScreenshotWriteResult::StorageError;
        Serial.println("Lilyshark screenshot: SD unavailable");
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
    } else {
        Serial.printf("Lilyshark screenshot failed: %u\n",
                      static_cast<unsigned>(last_screenshot_result));
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
    const uint32_t now = millis();
    if(now < next_read_ms) return;
    next_read_ms = now + 20;

    const uint8_t received = Wire.requestFrom(tdeck::keyboard_address, static_cast<uint8_t>(1));
    if(received == 0 || !Wire.available()) return;
    const uint8_t key = Wire.read();
    if(key != 0) handle_navigation_key(key);
}

void set_keyboard_brightness(uint8_t value)
{
    Wire.beginTransmission(tdeck::keyboard_address);
    Wire.write(keyboard_brightness_command);
    Wire.write(value);
    Wire.endTransmission();
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

    pinMode(tdeck::power_enable_pin, OUTPUT);
    digitalWrite(tdeck::power_enable_pin, HIGH);
    pinMode(tdeck::sd_cs_pin, OUTPUT);
    pinMode(tdeck::radio_cs_pin, OUTPUT);
    pinMode(tdeck::display_cs_pin, OUTPUT);
    digitalWrite(tdeck::sd_cs_pin, HIGH);
    digitalWrite(tdeck::radio_cs_pin, HIGH);
    digitalWrite(tdeck::display_cs_pin, HIGH);
    delay(500);

    pinMode(tdeck::spi_miso_pin, INPUT_PULLUP);
    SPI.begin(tdeck::spi_sck_pin, tdeck::spi_miso_pin, tdeck::spi_mosi_pin);
    device_display.begin();
    device_display.setRotation(1);
    device_display.fillScreen(TFT_BLACK);
    pinMode(tdeck::backlight_pin, OUTPUT);
    set_backlight(12);
    Serial.println("Lilyshark display: ready");

    Wire.begin(tdeck::i2c_sda_pin, tdeck::i2c_scl_pin, tdeck::i2c_frequency_hz);
    set_keyboard_brightness(96);
    const bool touch_ready = touch_service.begin(Wire);
    Serial.printf("Lilyshark touch: %s (0x%02X)\n", touch_ready ? "ready" : "not found",
                  touch_service.address());
    hardware_status.begin(true);
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
    }

    lv_init();
    lv_tick_set_cb(device_tick_ms);
    lv_display_t * display = lv_display_create(theme::screen_width, theme::screen_height);
    if(display == nullptr) halt_device_startup("LVGL display allocation failed");
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(display, device_draw_buffer, nullptr, sizeof(device_draw_buffer), LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(display, device_flush);
    lv_indev_t *touch = lv_indev_create();
    if(touch == nullptr) halt_device_startup("LVGL touch input allocation failed");
    lv_indev_set_type(touch, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(touch, device_touch_read);

    sd_mounted = mountTDeckSd(SPI);
    if(sd_mounted && pcap_sink.openNextCapture(pcap_path, sizeof(pcap_path))) {
        last_pcap_result = pcap_writer.begin();
        pcap_recording = last_pcap_result == PcapWriteResult::Ok;
        if(!pcap_recording) pcap_sink.close();
    }
    if(sd_mounted && native_capture_sink.openNextCapture(native_capture_path, sizeof(native_capture_path),
                                                       kLilysharkCaptureExtension)) {
        last_native_capture_result = native_capture_writer.begin();
        native_capture_recording = last_native_capture_result == LilysharkCaptureWriteResult::Ok;
        if(!native_capture_recording) native_capture_sink.close();
    }
    Serial.printf("Lilyshark SD capture: %s%s%s\n", pcap_recording ? "recording " : "unavailable",
                  pcap_recording ? pcap_path : "", sd_mounted ? "" : " (no card)");
    Serial.printf("Lilyshark native capture: %s%s\n",
                  native_capture_recording ? "recording " : "unavailable",
                  native_capture_recording ? native_capture_path : "");

    capture_runtime.addDecoder(meshtastic_decoder);
    capture_runtime.addDecoder(meshcore_decoder);
    capture_runtime.addDecoder(reticulum_decoder);
    RadioProfile initial_profile = builtinProfiles()[active_profile_index];
    bool restored_profile = load_saved_profile(initial_profile);
    bool radio_ready = radio_service.begin(initial_profile, on_radio_frame, nullptr);
    if(!radio_ready && restored_profile && !radio_service.status().initialized) {
        Serial.println("Lilyshark saved profile failed; retrying its built-in preset");
        restored_profile = false;
        initial_profile = builtinProfiles()[active_profile_index];
        radio_ready = radio_service.begin(initial_profile, on_radio_frame, nullptr);
        if(radio_ready && !save_active_profile()) {
            Serial.println("Lilyshark fallback profile settings were not saved");
        }
    }
    update_live_radio_label();
    const char *radio_state = radio_ready ? "listening" :
        (radio_service.status().initialized ? "recovering" : "failed");
    Serial.printf("Lilyshark radio: %s%s (%s, error %d)\n", initial_profile.name,
                  restored_profile ? " [saved settings]" : "",
                  radio_state, radio_service.status().last_error);

    build_current_screen();
    Serial.println("Lilyshark UI ready");
}

void loop()
{
    poll_trackball();
    poll_keyboard();
    poll_touch();
    hardware_status.poll();
    radio_service.poll();

    const uint32_t now = millis();
    bool redraw = false;
    const SpectrumSweepStatus &spectrum_status = radio_service.spectrumStatus();
    if(spectrum_status.state != observed_spectrum_state ||
       spectrum_status.points_completed != observed_spectrum_points) {
        observed_spectrum_state = spectrum_status.state;
        observed_spectrum_points = spectrum_status.points_completed;
        if(current_screen == Screen::spectrum) redraw = true;
    }
    if(survey_running && now - survey_started_ms >= 60000U) {
        survey_running = false;
        survey_has_result = true;
        redraw = true;
    }
    if(now - last_hardware_ui_refresh_ms >= 1000U) {
        last_hardware_ui_refresh_ms = now;
        redraw = update_live_hardware_labels() || update_live_radio_label() || redraw;
    }
    if(now - last_capture_flush_ms >= 5000U) {
        last_capture_flush_ms = now;
        if(pcap_recording && !pcap_sink.flush()) {
            pcap_recording = false;
            last_pcap_result = PcapWriteResult::SinkError;
            pcap_sink.close();
            live_data_dirty = true;
        }
        if(native_capture_recording && !native_capture_sink.flush()) {
            native_capture_recording = false;
            last_native_capture_result = LilysharkCaptureWriteResult::SinkError;
            native_capture_sink.close();
            live_data_dirty = true;
        }
    }
    if(live_data_dirty && now - last_ui_refresh_ms >= 250U) {
        live_data_dirty = false;
        last_ui_refresh_ms = now;
        if(current_screen != Screen::spectrum && current_screen != Screen::map) {
            redraw = true;
        }
    }
    const bool scan_active = current_screen == Screen::spectrum &&
                             radio_service.spectrumStatus().active();
    const bool time_driven_screen = current_screen == Screen::survey ||
                                    current_screen == Screen::events ||
                                    current_screen == Screen::nodes ||
                                    current_screen == Screen::node_detail ||
                                    current_screen == Screen::map ||
                                    current_screen == Screen::utilization;
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
