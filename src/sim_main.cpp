#include <array>
#include <cstdint>
#include <cstdlib>
#include <cstdio>

#include <SDL.h>
#include <lvgl.h>
#include <src/drivers/sdl/lv_sdl_keyboard.h>
#include <src/drivers/sdl/lv_sdl_mouse.h>
#include <src/drivers/sdl/lv_sdl_window.h>

#include "theme.h"

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
static uint8_t spectrum_buffer[LV_CANVAS_BUF_SIZE(306, 145, 16, LV_DRAW_BUF_STRIDE_ALIGN)];
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

void build_traffic(lv_obj_t * parent)
{
    add_status_bar(parent, "TRAFFIC", "BAT 100%", "GPS 3D", "18 pkt/min");
    constexpr lv_coord_t first_y = 28;
    constexpr lv_coord_t row_height = 14;

    for(size_t index = 0; index < packets.size(); ++index) {
        const lv_coord_t y = first_y + static_cast<lv_coord_t>(index) * row_height;
        const bool selected = index == 5;
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
}

void build_nodes(lv_obj_t * parent)
{
    add_status_bar(parent, "NODES", "BAT 100%", "GPS LOCK", "18 pkt/min");
    put_label(parent, "NODE", 8, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "LAST", 112, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "BAT", 163, 27, theme::text(), &font_mono_semibold_12);
    put_label(parent, "SNR  1h", 210, 27, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 6, 43, 308);

    for(size_t index = 0; index < nodes.size(); ++index) {
        const lv_coord_t y = 46 + static_cast<lv_coord_t>(index) * 22;
        const bool selected = index == 2;
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
    add_status_bar(parent, "NODE DETAIL", "BAT 100%", "GPS LOCK", "12 nodes");
    put_label(parent, "Hilltop7", 8, 25, theme::text(), &font_condensed_bold_28);
    put_label(parent, "LAST SEEN  00:01:30", 9, 54, theme::text_muted(), &font_mono_10);
    put_label(parent, "100%", 275, 31, theme::lime(), &font_mono_semibold_12);
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
    add_status_bar(parent, "PACKET DETAIL", "BAT 100%", "GPS LOCK", "14:02:11");
    theme::rect(parent, 0, 22, 38, 201, theme::surface());
    theme::rule_line(parent, 37, 22, 1, 201);
    constexpr std::array<const char *, 5> nav = {{"TRF", "SPC", "NOD", "MAP", "CFG"}};
    for(size_t index = 0; index < nav.size(); ++index) {
        const lv_coord_t y = 29 + static_cast<lv_coord_t>(index) * 37;
        if(index == 0) theme::rect(parent, 0, y - 4, 37, 31, theme::rule());
        put_label(parent, nav[index], 8, y + 4, index == 0 ? theme::lime() : theme::text(), &font_mono_10);
    }

    put_label(parent, "Yosemite-Base  >  ^all", 49, 31, theme::text(), &font_mono_semibold_12);
    put_label(parent, "PORT  POSITION", 49, 58, theme::amber(), &font_mono_10);
    put_label(parent, "HOPS  3    SNR  -7.2 dB", 49, 75, theme::text(), &font_mono_10);
    put_label(parent, "RSSI  -89 dBm", 49, 91, theme::text(), &font_mono_10);
    theme::rule_line(parent, 47, 109, 266);
    put_label(parent, "ROUTE", 49, 116, theme::text_muted(), &font_mono_10);
    put_label(parent, "Yosemite > Relay3 > Hilltop7 > You", 49, 131, theme::text(), &font_condensed_12);
    put_label(parent, "PAYLOAD", 49, 153, theme::cyan(), &font_mono_10);
    put_label(parent, "37.7749 N, 122.4194 W  ALT 15m", 49, 168, theme::cyan(), &font_mono_10);
    theme::rule_line(parent, 47, 187, 266);
    put_label(parent, "52 45 4C 41 59 3A 20 7B 22 6C 61 74 22 3A", 49, 194, theme::text(), &font_mono_10);
    put_label(parent, "33 37 2E 37 37 34 39 2C 22 6C 6F 6E 22 3A", 49, 207, theme::text_muted(), &font_mono_10);
}

void build_map(lv_obj_t * parent)
{
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
    add_status_bar(parent, "SURVEY", "BAT 100%", "GPS LOCK", "RX ONLY");
    put_label(parent, "CAPTURING", 44, 47, theme::amber(), &font_condensed_bold_28);
    put_label(parent, "42s / 60s", 241, 88, theme::lime(), &font_mono_semibold_12);

    lv_obj_t * progress = theme::rect(parent, 9, 84, 221, 23, theme::background());
    lv_obj_set_style_border_width(progress, 1, 0);
    lv_obj_set_style_border_color(progress, theme::text_muted(), 0);
    theme::rect(progress, 3, 3, 152, 17, theme::lime());

    put_label(parent, "NODES HEARD", 10, 121, theme::text_muted(), &font_condensed_12);
    put_label(parent, "7", 120, 116, theme::text(), &font_condensed_bold_16);
    put_label(parent, "BEST SNR", 10, 143, theme::text_muted(), &font_condensed_12);
    put_label(parent, "-6.2 dB", 120, 139, theme::text(), &font_mono_semibold_12);
    put_label(parent, "NOISE", 10, 165, theme::text_muted(), &font_condensed_12);
    put_label(parent, "-97 dBm", 120, 161, theme::text(), &font_mono_semibold_12);
    theme::rule_line(parent, 0, 190, 320);
    put_label(parent, "ENTER  START 60s SURVEY", 51, 199, theme::cyan(), &font_mono_semibold_12);
}

void build_events(lv_obj_t * parent)
{
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

void handle_key(lv_event_t * event)
{
    const uint32_t key = lv_event_get_key(event);
    int next = static_cast<int>(current_screen);
    if(key == LV_KEY_RIGHT || key == LV_KEY_DOWN || key == LV_KEY_NEXT) ++next;
    else if(key == LV_KEY_LEFT || key == LV_KEY_UP || key == LV_KEY_PREV) --next;
    else if(key >= '1' && key <= '9') next = static_cast<int>(key - '1');
    else return;

    constexpr int count = static_cast<int>(Screen::count);
    next = (next % count + count) % count;
    current_screen = static_cast<Screen>(next);
    build_current_screen();
    std::fprintf(stderr, "Lilyshark view: %s\n", screen_names[static_cast<size_t>(current_screen)]);
}

} // namespace

int main(int argc, char ** argv)
{
    if(argc > 1) {
        const int requested = std::atoi(argv[1]);
        if(requested >= 1 && requested <= static_cast<int>(Screen::count)) {
            current_screen = static_cast<Screen>(requested - 1);
        }
    }

    lv_init();

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

    while(true) {
        lv_timer_handler();
        SDL_Delay(5);
    }
}
