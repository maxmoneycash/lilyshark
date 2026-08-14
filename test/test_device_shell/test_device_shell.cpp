#include <unity.h>

#include <RadioLib.h>
#include <Wire.h>
#include <lvgl.h>

#include "device_shell_fake.h"
#include "lilyshark/device/tdeck_display_init.h"
#include "lilyshark/tdeck.h"

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <sys/wait.h>
#include <unistd.h>

#if LV_MEM_SIZE != 98304U
#error "device-shell test must use the same 98,304-byte LVGL heap as T-Deck firmware"
#endif

void setup();
void loop();

namespace {

using device_shell_fake::state;

bool require(bool condition, const char *message)
{
    if(condition) return true;
    std::fprintf(stderr, "device-shell assertion failed: %s\n", message);
    std::fflush(stderr);
    return false;
}

std::size_t occurrenceCount(const std::string &text, const std::string &needle)
{
    std::size_t count = 0;
    std::size_t offset = 0;
    while((offset = text.find(needle, offset)) != std::string::npos) {
        ++count;
        offset += needle.size();
    }
    return count;
}

bool serialMilestonesInOrder(const char *radio_marker)
{
    constexpr const char *markers[] = {
        "Lilyshark starting\n",
        "Lilyshark display: ready\n",
        "Lilyshark touch:",
        "Lilyshark SD capture:",
        "Lilyshark native capture:",
        "Lilyshark radio:",
        "Lilyshark UI ready\n",
    };
    std::size_t offset = 0;
    for(const char *marker : markers) {
        const std::size_t found = state().serial_log.find(marker, offset);
        if(found == std::string::npos) return false;
        offset = found + std::strlen(marker);
    }
    return occurrenceCount(state().serial_log, "Lilyshark starting\n") == 1U &&
           occurrenceCount(state().serial_log, "Lilyshark UI ready\n") == 1U &&
           state().serial_log.find(radio_marker) != std::string::npos;
}

bool traceBefore(const std::string &first, const std::string &second)
{
    const std::size_t first_index = device_shell_fake::trace_index(first);
    const std::size_t second_index = device_shell_fake::trace_index(second);
    return first_index < second_index && second_index < state().trace.size();
}

bool hasLabel(lv_obj_t *object, const char *text)
{
    if(object == nullptr) return false;
    if(lv_obj_check_type(object, &lv_label_class) &&
       std::strcmp(lv_label_get_text(object), text) == 0) return true;
    const std::uint32_t children = lv_obj_get_child_count(object);
    for(std::uint32_t index = 0; index < children; ++index) {
        if(hasLabel(lv_obj_get_child(object, static_cast<std::int32_t>(index)), text)) return true;
    }
    return false;
}

std::shared_ptr<device_shell_fake::FileData> fileWithSuffix(const char *suffix)
{
    const std::size_t suffix_length = std::strlen(suffix);
    for(const auto &entry : state().files) {
        if(entry.first.size() >= suffix_length &&
           entry.first.compare(entry.first.size() - suffix_length, suffix_length, suffix) == 0) {
            return entry.second;
        }
    }
    return {};
}

void timerCallback(lv_timer_t *)
{
    ++state().lv_timer_callbacks;
}

void sendKeyboard(std::uint8_t key)
{
    state().keyboard_bytes.push_back(key);
    device_shell_fake::advance_ms(25);
    loop();
}

bool healthyScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();

    setup();

    if(!require(serialMilestonesInOrder("(listening, error 0)"),
                "healthy startup milestones are missing or out of order")) return false;
    if(!require(state().serial_log.find("Lilyshark touch: ready (0x5D)") != std::string::npos,
                "touch did not initialize at its primary address")) return false;
    if(!require(state().serial_log.find("Lilyshark SD capture: recording /lilyshark/capture-0001.pcap") !=
                    std::string::npos,
                "PCAP writer did not start")) return false;
    if(!require(state().serial_log.find("Lilyshark native capture: recording /lilyshark/capture-0001.lscap") !=
                    std::string::npos,
                "native writer did not start")) return false;

    const std::string power_high = "digital." +
        std::to_string(lilyshark::tdeck::power_enable_pin) + ".high";
    const std::string sd_high = "digital." + std::to_string(lilyshark::tdeck::sd_cs_pin) + ".high";
    const std::string radio_high = "digital." +
        std::to_string(lilyshark::tdeck::radio_cs_pin) + ".high";
    const std::string display_high = "digital." +
        std::to_string(lilyshark::tdeck::display_cs_pin) + ".high";
    const std::string backlight_low = "digital." +
        std::to_string(lilyshark::tdeck::backlight_pin) + ".low";
    const std::string backlight_high = "digital." +
        std::to_string(lilyshark::tdeck::backlight_pin) + ".high";
    constexpr const char *spi_begin = "spi.begin.40.38.41";

    if(!require(traceBefore(power_high, spi_begin) && traceBefore(sd_high, spi_begin) &&
                    traceBefore(radio_high, spi_begin) && traceBefore(display_high, spi_begin),
                "power and shared SPI chip selects were not safe before SPI begin")) return false;
    if(!require(traceBefore(backlight_low, "display.begin"),
                "backlight was not held low before display initialization")) return false;
    if(!require(!state().display_commands.empty() &&
                    state().display_commands.front() ==
                        lilyshark::kTDeckDisplaySoftwareResetCommand,
                "display software reset was not the first explicit command")) return false;
    if(!require(state().display_commands.back() == 0x29U,
                "vendor display sequence did not finish with DISPON")) return false;
    if(!require(traceBefore("display.command.1", "display.rotation.1") &&
                    traceBefore("display.command.41", "display.rotation.1"),
                "software reset and vendor sequence did not precede rotation")) return false;
    if(!require(traceBefore("display.fill.0", backlight_high) &&
                    traceBefore("display.fill.0", "keyboard.brightness.96"),
                "display was illuminated or keyboard brightness set before black fill")) return false;

    auto pcap = fileWithSuffix(".pcap");
    auto native_capture = fileWithSuffix(".lscap");
    if(!require(pcap != nullptr && pcap->bytes.size() == 24U,
                "PCAP global header is missing")) return false;
    if(!require(native_capture != nullptr && native_capture->bytes.size() == 24U,
                "native capture header is missing")) return false;

    lv_mem_monitor_t memory{};
    lv_mem_monitor(&memory);
    if(!require(memory.total_size <= LV_MEM_SIZE && memory.free_size > 2048U,
                "initial live screen exhausted the device-sized LVGL heap")) return false;

    lv_timer_create(timerCallback, 1U, nullptr);
    device_shell_fake::advance_ms(5);
    loop();
    if(!require(state().lv_timer_callbacks != 0U && state().display_flushes != 0U,
                "loop did not service LVGL timers and display flushes")) return false;

    constexpr const char *screen_titles[] = {
        "TRAFFIC", "SPECTRUM", "NODES", "NODE DETAIL", "PACKET DETAIL",
        "MAP", "SURVEY", "EVENTS", "AIRTIME",
    };
    for(std::size_t index = 0; index < 9U; ++index) {
        sendKeyboard(static_cast<std::uint8_t>('1' + index));
        if(!hasLabel(lv_screen_active(), screen_titles[index])) {
            std::fprintf(stderr, "device-shell screen %zu (%s) was not built; serial log:\n%s",
                         index + 1U, screen_titles[index], state().serial_log.c_str());
            return require(false,
                           "keyboard navigation did not build the requested live device screen");
        }
        lv_mem_monitor(&memory);
        if(!require(memory.total_size <= LV_MEM_SIZE && memory.free_size > 1024U,
                    "a live device screen exhausted the device-sized LVGL heap")) return false;
    }

    sendKeyboard('1');
    const std::uint64_t empty_traffic_hash = device_shell_fake::framebuffer_hash();
    const std::size_t flushes_before_frame = state().display_flushes;
    const std::size_t pcap_before_frame = pcap->bytes.size();
    const std::size_t native_before_frame = native_capture->bytes.size();

    auto &radio = radiolib_fake::state();
    radio.packet = {
        0xff, 0xff, 0xff, 0xff, 0x78, 0x56, 0x34, 0x12,
        0xde, 0xc0, 0xad, 0x0b, 0xbb, 0x2a, 0x56, 0x78,
        0xaa, 0xbb, 0xcc,
    };
    radio.packet_length = radio.packet.size();
    radio.irq_flags = RADIOLIB_SX126X_IRQ_HEADER_VALID;
    radio.triggerDio1();
    device_shell_fake::advance_ms(250);
    loop();

    if(!require(radio.start_receive_calls >= 2U,
                "radio was not rearmed after the injected frame")) return false;
    if(!require(pcap->bytes.size() > pcap_before_frame &&
                    native_capture->bytes.size() > native_before_frame,
                "actual radio callback did not append both capture formats")) return false;
    if(!require(hasLabel(lv_screen_active(), "12345678"),
                "Meshtastic frame did not reach decoder, store, and live Traffic UI")) return false;
    if(!require(state().display_flushes > flushes_before_frame &&
                    device_shell_fake::framebuffer_hash() != empty_traffic_hash,
                "captured frame did not redraw the live Traffic screen")) return false;

    return true;
}

bool recoverableFailureScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    state().touch_present = false;
    state().sd_present = false;
    state().psram_available = false;
    auto &radio = radiolib_fake::state();
    radio.reset();
    radio.begin_results = {-707, RADIOLIB_ERR_NONE};

    setup();

    if(!require(serialMilestonesInOrder("(failed, error -707)"),
                "recoverable startup milestones are missing or out of order")) return false;
    if(!require(state().serial_log.find("Lilyshark touch: not found (0x00)") != std::string::npos,
                "missing touch was not reported")) return false;
    if(!require(state().serial_log.find("Spectrum unavailable: PSRAM allocation failed") !=
                    std::string::npos,
                "missing PSRAM was not reported")) return false;
    if(!require(state().serial_log.find("Lilyshark SD capture: unavailable (no card)") !=
                    std::string::npos &&
                    state().serial_log.find("Lilyshark native capture: unavailable") !=
                        std::string::npos,
                "missing SD was not reported for both capture formats")) return false;
    if(!require(state().files.empty(), "capture files were opened without an SD card")) return false;
    if(!require(radio.begin_calls == 1U, "initial radio failure count is wrong")) return false;

    device_shell_fake::advance_ms(1000);
    loop();
    if(!require(radio.begin_calls == 2U && radio.start_receive_calls == 1U,
                "radio did not recover through the real loop retry path")) return false;

    sendKeyboard('2');
    if(!require(hasLabel(lv_screen_active(), "SPECTRUM BUFFER UNAVAILABLE"),
                "Spectrum screen did not fall back safely without PSRAM")) return false;

    lv_timer_create(timerCallback, 1U, nullptr);
    for(std::size_t iteration = 0; iteration < 100U; ++iteration) {
        device_shell_fake::advance_ms(5);
        loop();
    }
    if(!require(state().lv_timer_callbacks != 0U,
                "recoverable failure loop stopped servicing LVGL")) return false;
    return true;
}

using Scenario = bool (*)();

int runIsolated(Scenario scenario)
{
    const pid_t child = fork();
    if(child == 0) {
        const bool passed = scenario();
        std::fflush(nullptr);
        _exit(passed ? 0 : 1);
    }
    if(child < 0) return -1;
    int status_code = 0;
    if(waitpid(child, &status_code, 0) != child) return -1;
    if(!WIFEXITED(status_code)) return 128 + WTERMSIG(status_code);
    return WEXITSTATUS(status_code);
}

void testDeviceShellEntryPath()
{
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(healthyScenario),
                                  "healthy device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(recoverableFailureScenario),
                                  "recoverable device-shell scenario failed");
}

} // namespace

void setUp() {}
void tearDown() {}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(testDeviceShellEntryPath);
    return UNITY_END();
}
