#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

namespace device_shell_fake {

struct FileData {
    std::vector<std::uint8_t> bytes{};
    bool is_open = false;
    std::size_t flush_calls = 0;
    std::size_t close_calls = 0;
};

struct State {
    std::uint64_t now_us = 0;
    bool touch_present = true;
    bool keyboard_present = true;
    bool sd_present = true;
    bool psram_available = true;
    bool preferences_available = true;
    bool fail_app_settings_put = false;
    bool fail_profile_put = false;
    bool fail_file_open = false;
    bool fail_file_write = false;
    bool fail_file_flush = false;
    std::uint32_t battery_adc_mv = 2000;

    std::string serial_log{};
    std::vector<std::string> trace{};
    std::map<int, int> pin_levels{};
    std::array<void (*)(), 64> interrupt_handlers{};
    std::deque<std::uint8_t> keyboard_bytes{};
    std::map<std::string, std::shared_ptr<FileData>> files{};
    std::set<std::string> directories{};
    std::vector<std::uint8_t> saved_profile{};
    std::vector<std::uint8_t> saved_app_settings{};
    std::size_t app_settings_put_calls = 0;
    std::size_t profile_put_calls = 0;
    std::size_t sd_end_calls = 0;

    std::array<std::uint16_t, 320U * 240U> framebuffer{};
    std::array<std::uint16_t, 320U * 240U> first_backlight_framebuffer{};
    bool first_backlight_frame_captured = false;
    std::uint32_t display_window_x = 0;
    std::uint32_t display_window_y = 0;
    std::uint32_t display_window_width = 0;
    std::uint32_t display_window_height = 0;
    std::size_t display_flushes = 0;
    std::vector<std::uint8_t> display_commands{};
    std::vector<std::uint8_t> display_data{};
    std::size_t lv_timer_callbacks = 0;
};

inline State runtime{};

inline State &state() noexcept
{
    return runtime;
}

inline void reset() noexcept
{
    runtime = State{};
}

inline void record(const std::string &operation)
{
    state().trace.push_back(operation);
}

inline void advance_ms(std::uint32_t milliseconds) noexcept
{
    state().now_us += static_cast<std::uint64_t>(milliseconds) * 1000ULL;
}

inline std::size_t trace_index(const std::string &operation) noexcept
{
    for(std::size_t index = 0; index < state().trace.size(); ++index) {
        if(state().trace[index] == operation) return index;
    }
    return state().trace.size();
}

inline std::uint64_t framebuffer_hash() noexcept
{
    std::uint64_t hash = 1469598103934665603ULL;
    for(const std::uint16_t pixel : state().framebuffer) {
        hash ^= static_cast<std::uint8_t>(pixel >> 8U);
        hash *= 1099511628211ULL;
        hash ^= static_cast<std::uint8_t>(pixel);
        hash *= 1099511628211ULL;
    }
    return hash;
}

} // namespace device_shell_fake
