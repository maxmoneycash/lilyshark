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
    /// The card itself, modelled rather than switched.
    ///
    /// These used to be three "make this call fail" booleans, which is why the
    /// firmware could not tell a full card from a pulled one: every fault
    /// reached the code as the same false, so no test could ask for a
    /// different message. The deck now diagnoses a failed write by asking the
    /// card two more questions -- how much room is left, and is the directory
    /// still readable -- so the fake has to be able to answer them
    /// differently. A full card answers both; a pulled card answers neither.
    std::uint64_t sd_total_bytes = 64ULL * 1024ULL * 1024ULL;
    std::uint64_t sd_used_bytes = 0;
    /// f_getfree failing. Both SD.totalBytes() and SD.usedBytes() return 0 in
    /// that case on real hardware -- the reading is ABSENT, not zero, and the
    /// firmware must not read it as a full card.
    bool sd_free_space_query_fails = false;
    /// Mounted and answering, and refusing writes: a read-only mount or a bad
    /// block.
    bool sd_write_refused = false;
    /// Pulled from the slot. Writes fail, and so does every follow-up read.
    bool sd_removed = false;
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
    /// Every other record in the preferences namespace -- the chat archive,
    /// the channel key store -- under its own key. A real NVS namespace keys
    /// records independently, and folding them into one buffer would let
    /// saving a channel key destroy the saved radio profile.
    std::map<std::string, std::vector<std::uint8_t>> saved_records{};
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
