#include <unity.h>

#include <Arduino.h>
#include <RadioLib.h>
#include <Wire.h>
#include <lvgl.h>

#include "device_shell_fake.h"
#include "lilyshark/core/app_settings.h"
#include "lilyshark/core/profile_settings.h"
#include "lilyshark/protocols/meshtastic_encode.h"
#include "lilyshark/protocols/meshtastic_payload.h"
#include "lilyshark/device/tdeck_display_init.h"
#include "lilyshark/tdeck.h"
#include "theme.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <functional>
#include <memory>
#include <string>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>

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

std::size_t traceOccurrenceCount(const std::string &operation)
{
    std::size_t count = 0U;
    for(const std::string &entry : state().trace) {
        if(entry == operation) ++count;
    }
    return count;
}

bool seedAppSettings(const lilyshark::AppSettings &settings)
{
    state().saved_app_settings.resize(lilyshark::kAppSettingsV1Size);
    return lilyshark::encodeAppSettingsV1(settings, state().saved_app_settings.data(),
                                          state().saved_app_settings.size());
}

bool seedCompletedAppSettings()
{
    lilyshark::AppSettings settings = lilyshark::defaultAppSettings();
    settings.onboarding_version = lilyshark::kAppSettingsOnboardingVersion;
    settings.onboarding_complete = true;
    return seedAppSettings(settings);
}

std::size_t pixelCount(const std::array<std::uint16_t, 320U * 240U> &frame,
                       std::uint16_t first, std::uint16_t second)
{
    std::size_t count = 0U;
    for(const std::uint16_t pixel : frame) {
        if(pixel == first || pixel == second) ++count;
    }
    return count;
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

const char *labelWithPrefix(lv_obj_t *object, const char *prefix)
{
    if(object == nullptr) return nullptr;
    if(lv_obj_check_type(object, &lv_label_class)) {
        const char *text = lv_label_get_text(object);
        if(text != nullptr && std::strncmp(text, prefix, std::strlen(prefix)) == 0) return text;
    }
    const std::uint32_t children = lv_obj_get_child_count(object);
    for(std::uint32_t index = 0; index < children; ++index) {
        const char *text = labelWithPrefix(
            lv_obj_get_child(object, static_cast<std::int32_t>(index)), prefix);
        if(text != nullptr) return text;
    }
    return nullptr;
}

std::size_t labelCount(lv_obj_t *object, const char *text)
{
    if(object == nullptr) return 0U;
    std::size_t count = 0U;
    if(lv_obj_check_type(object, &lv_label_class) &&
       std::strcmp(lv_label_get_text(object), text) == 0) ++count;
    const std::uint32_t children = lv_obj_get_child_count(object);
    for(std::uint32_t index = 0; index < children; ++index) {
        count += labelCount(lv_obj_get_child(object, static_cast<std::int32_t>(index)), text);
    }
    return count;
}

std::size_t visibleRuntimeEventRows(lv_obj_t *object)
{
    constexpr const char *event_types[] = {
        "SYSTEM", "RADIO", "PROFILE", "CAPTURE", "STORAGE",
        "SPECTRUM", "SCREENSHOT", "SURVEY", "HARDWARE",
    };
    std::size_t count = 0U;
    for(const char *event_type : event_types) count += labelCount(object, event_type);
    return count;
}

bool loadSavedAppSettings(lilyshark::AppSettings &settings)
{
    return state().saved_app_settings.size() == lilyshark::kAppSettingsV1Size &&
           lilyshark::decodeAppSettings(state().saved_app_settings.data(),
                                        state().saved_app_settings.size(), settings) ==
               lilyshark::AppSettingsDecodeResult::LoadedV1;
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

std::shared_ptr<device_shell_fake::FileData> fileAtPath(const char *path)
{
    const auto entry = state().files.find(path);
    return entry == state().files.end() ? std::shared_ptr<device_shell_fake::FileData>{}
                                        : entry->second;
}

bool hasPcapHeader(const std::shared_ptr<device_shell_fake::FileData> &file)
{
    constexpr std::array<std::uint8_t, 24> expected = {{
        0xd4, 0xc3, 0xb2, 0xa1, 0x02, 0x00, 0x04, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x0e, 0x01, 0x00, 0x00, 0x0e, 0x01, 0x00, 0x00,
    }};
    // Starts with, not equals. A capture that has since recorded frames is
    // still a capture with a correct header, and the device beacons its own
    // position at boot, so the file is rarely header-only by the time anything
    // looks at it.
    return file != nullptr && file->bytes.size() >= expected.size() &&
           std::memcmp(file->bytes.data(), expected.data(), expected.size()) == 0;
}

bool hasLilysharkCaptureHeader(const std::shared_ptr<device_shell_fake::FileData> &file)
{
    constexpr std::array<std::uint8_t, 24> expected = {{
        'L', 'S', 'C', 'P', 0x01, 0x00, 0x01, 0x00,
        0x18, 0x00, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00,
    }};
    // Starts with, not equals. A capture that has since recorded frames is
    // still a capture with a correct header, and the device beacons its own
    // position at boot, so the file is rarely header-only by the time anything
    // looks at it.
    return file != nullptr && file->bytes.size() >= expected.size() &&
           std::memcmp(file->bytes.data(), expected.data(), expected.size()) == 0;
}

bool lilysharkRecordHasSyntheticFlag(
    const std::shared_ptr<device_shell_fake::FileData> &file,
    std::size_t record_offset = 24U)
{
    constexpr std::size_t metadata_flags_offset = 76U;
    constexpr std::uint8_t synthetic_flag = 1U << 2U;
    return file != nullptr && file->bytes.size() > record_offset + metadata_flags_offset &&
           file->bytes[record_offset] == 'L' && file->bytes[record_offset + 1U] == 'S' &&
           file->bytes[record_offset + 2U] == 'F' && file->bytes[record_offset + 3U] == 'R' &&
           (file->bytes[record_offset + metadata_flags_offset] & synthetic_flag) != 0U;
}

std::size_t radioOperationCount(radiolib_fake::Operation expected)
{
    std::size_t count = 0U;
    for(const radiolib_fake::Operation operation : radiolib_fake::state().operations) {
        if(operation == expected) ++count;
    }
    return count;
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

using ScanHistogram = std::array<std::uint16_t, RADIOLIB_SX126X_SPECTRAL_SCAN_RES_SIZE>;

/// One SX1262 spectral-scan reading: `floor_count` samples in the bin the
/// noise sits in, and optionally `signal_count` samples in a stronger bin.
/// Lower bin indices are stronger; bin 32 is the catch-all at -139 dBm.
ScanHistogram scanHistogram(std::size_t floor_bin, std::uint16_t floor_count,
                            std::size_t signal_bin, std::uint16_t signal_count)
{
    ScanHistogram counts{};
    counts[floor_bin] = floor_count;
    if(signal_count != 0U) counts[signal_bin] = static_cast<std::uint16_t>(
        counts[signal_bin] + signal_count);
    return counts;
}

/// "SCANNING 4/11  36%  906.750 MHZ" -> "906.750". The screen's own progress
/// line is where the expected peak frequency comes from, so the assertion
/// cannot be satisfied by a display that agrees with a constant copied out of
/// the profile table into the test.
std::string scanningFrequencyText(const char *scanning)
{
    if(scanning == nullptr) return {};
    const std::string text = scanning;
    const std::size_t unit = text.rfind(" MHZ");
    if(unit == std::string::npos || unit == 0U) return {};
    const std::size_t start = text.rfind(' ', unit - 1U);
    if(start == std::string::npos) return {};
    return text.substr(start + 1U, unit - start - 1U);
}

/// Run one whole sweep through the RadioLib fake, feeding `loud` at the point
/// with index `loud_point` and `quiet` everywhere else. `loud_frequency` comes
/// back holding the frequency the deck reported itself to be scanning while
/// `loud` was in the air.
///
/// The fake answers every frequency from one histogram, and spectralScanStart
/// re-arms its "not finished yet" status, so the loud reading has to be swapped
/// in and the scan declared finished on each pass around the real loop.
bool driveFakeSweep(std::size_t loud_point, const ScanHistogram &loud,
                    const ScanHistogram &quiet, std::string &loud_frequency)
{
    auto &radio = radiolib_fake::state();
    loud_frequency.clear();
    // "SCANNING 3/11 ..." is the deck saying three points are done and the
    // fourth -- index three, the loud one -- is the frequency it is on now.
    char in_flight[32]{};
    std::snprintf(in_flight, sizeof(in_flight), "SCANNING %zu/", loud_point);
    for(std::size_t iteration = 0U; iteration < 600U; ++iteration) {
        const char *scanning = labelWithPrefix(lv_screen_active(), "SCANNING ");
        if(scanning != nullptr &&
           std::strncmp(scanning, in_flight, std::strlen(in_flight)) == 0) {
            const std::string reported = scanningFrequencyText(scanning);
            if(!reported.empty()) loud_frequency = reported;
        }
        const std::size_t started = radioOperationCount(radiolib_fake::Operation::ScanStart);
        radio.scan_counts = started == loud_point + 1U ? loud : quiet;
        radio.scan_status_result = RADIOLIB_ERR_NONE;
        device_shell_fake::advance_ms(10);
        loop();
        if(hasLabel(lv_screen_active(), "COMPLETE")) return true;
    }
    return false;
}

bool healthyScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();
    if(!require(seedCompletedAppSettings(),
                "completed app settings could not be encoded")) return false;

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
    if(!require(hasLabel(lv_screen_active(), "HOME"),
                "returning-user startup did not open Home")) return false;

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
    if(!require(traceBefore("display.fill.0", "display.flush") &&
                    traceBefore("display.flush", backlight_high) &&
                    traceBefore("display.fill.0", "keyboard.brightness.96"),
                "the splash did not flush between the black fill and first backlight")) return false;
    const std::uint16_t pink = lv_color_to_u16(lilyshark::theme::pink());
    const std::uint16_t swapped_pink = static_cast<std::uint16_t>((pink << 8U) | (pink >> 8U));
    if(!require(state().first_backlight_frame_captured &&
                    pixelCount(state().first_backlight_framebuffer, pink, swapped_pink) > 64U,
                "the first visible framebuffer did not contain the antialiased pink logo")) {
        return false;
    }

    auto pcap = fileWithSuffix(".pcap");
    auto native_capture = fileWithSuffix(".lscap");
    if(!require(hasPcapHeader(pcap),
                "PCAP global header is missing or malformed")) return false;
    if(!require(hasLilysharkCaptureHeader(native_capture),
                "native capture header is missing or malformed")) return false;

    lv_mem_monitor_t memory{};
    lv_mem_monitor(&memory);
    if(!require(memory.total_size <= LV_MEM_SIZE && memory.free_size > 2048U,
                "initial live screen exhausted the device-sized LVGL heap")) return false;

    lv_timer_create(timerCallback, 1U, nullptr);
    device_shell_fake::advance_ms(5);
    loop();
    if(!require(state().lv_timer_callbacks != 0U && state().display_flushes != 0U,
                "loop did not service LVGL timers and display flushes")) return false;

    constexpr const char *primary_titles[] = {
        "RADIO", "SPECTRUM", "NODES", "MAP", "SURVEY", "AIRTIME", "EVENTS",
    };
    for(std::size_t index = 0; index < 7U; ++index) {
        sendKeyboard(static_cast<std::uint8_t>('1' + index));
        if(labelWithPrefix(lv_screen_active(), primary_titles[index]) == nullptr) {
            std::fprintf(stderr, "device-shell screen %zu (%s) was not built; serial log:\n%s",
                         index + 1U, primary_titles[index], state().serial_log.c_str());
            return require(false,
                           "keyboard navigation did not build the requested live device screen");
        }
        lv_mem_monitor(&memory);
        if(!require(memory.total_size <= LV_MEM_SIZE && memory.free_size > 1024U,
                    "a live device screen exhausted the device-sized LVGL heap")) return false;
    }

    sendKeyboard('8');
    if(!require(hasLabel(lv_screen_active(), "SETTINGS"),
                "8 did not open Settings")) return false;
    sendKeyboard('M');
    if(!require(hasLabel(lv_screen_active(), "HOME"),
                "M did not return the shell to Home")) return false;

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
    radio.packet.resize(95U);
    for(std::size_t index = 19U; index < radio.packet.size(); ++index) {
        radio.packet[index] = static_cast<std::uint8_t>(index);
    }
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

    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "PACKET"),
                "Enter did not open Packet Detail for the injected frame")) return false;
    // The old "LEFT / RIGHT  SECTION" hint was removed when the back strips
    // were pruned, so the tab strip itself stands for "opened on PKT".
    if(!require(labelWithPrefix(lv_screen_active(), "FRAME #") != nullptr &&
                    labelWithPrefix(lv_screen_active(), "PAYLOAD OFFSET ") != nullptr &&
                    hasLabel(lv_screen_active(), "PKT") &&
                    hasLabel(lv_screen_active(), "RAW"),
                "Packet Detail did not open on the PKT summary tab")) return false;

    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    // CENTER is its own label with the frequency beside it, and airtime is
    // reported as "AIR <ms>  ERR <hz>" rather than a field called AIRTIME.
    if(!require(hasLabel(lv_screen_active(), "CENTER") &&
                    labelWithPrefix(lv_screen_active(), "AIR ") != nullptr,
                "Packet Detail did not render the RF metadata tab")) return false;

    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    // STATE and KIND are their own labels with values beside them; the decoded
    // field mask and payload extent are one line each, "FIELDS <mask> ATTR
    // <attr>" and "PAY <len> @ <offset>  FLAGS <flags>".
    if(!require(hasLabel(lv_screen_active(), "STATE") &&
                    hasLabel(lv_screen_active(), "KIND") &&
                    labelWithPrefix(lv_screen_active(), "FIELDS ") != nullptr &&
                    labelWithPrefix(lv_screen_active(), "PAY ") != nullptr,
                "Packet Detail did not render the decoder tab")) return false;

    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "0-39/95") &&
                    hasLabel(lv_screen_active(), "UP/DOWN  PAGE 1/3") &&
                    hasLabel(lv_screen_active(), "FF FF FF FF 78 56 34 12 DE C0 "),
                "Packet Detail did not render the first HEX page")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_UP));
    if(!require(hasLabel(lv_screen_active(), "0-39/95") &&
                    hasLabel(lv_screen_active(), "UP/DOWN  PAGE 1/3"),
                "Packet Detail moved above its first page")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    if(!require(hasLabel(lv_screen_active(), "40-79/95") &&
                    hasLabel(lv_screen_active(), "UP/DOWN  PAGE 2/3") &&
                    hasLabel(lv_screen_active(), "28 29 2A 2B 2C 2D 2E 2F 30 31 "),
                "Packet Detail did not render the second 40-byte page")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    if(!require(hasLabel(lv_screen_active(), "80-94/95") &&
                    hasLabel(lv_screen_active(), "UP/DOWN  PAGE 3/3") &&
                    hasLabel(lv_screen_active(), "50 51 52 53 54 55 56 57 58 59 "),
                "Packet Detail did not render the final partial page")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    if(!require(hasLabel(lv_screen_active(), "80-94/95") &&
                    hasLabel(lv_screen_active(), "UP/DOWN  PAGE 3/3"),
                "Packet Detail moved beyond its final page")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_UP));
    if(!require(hasLabel(lv_screen_active(), "40-79/95") &&
                    hasLabel(lv_screen_active(), "UP/DOWN  PAGE 2/3"),
                "Packet Detail did not page upward from the final page")) return false;

    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    // WRITER and STATE are their own labels now, and the capture extent reads
    // "CAP 95  ORIG 95  COMPLETE" rather than spelling both words out.
    if(!require(hasLabel(lv_screen_active(), "WRITER") &&
                    hasLabel(lv_screen_active(), "STATE") &&
                    labelWithPrefix(lv_screen_active(), "CAP 95  ORIG 95") != nullptr &&
                    labelWithPrefix(lv_screen_active(), "FNV32 ") != nullptr,
                "Packet Detail did not render the RAW capture-provenance tab")) return false;
    sendKeyboard(0x08U);
    if(!require(hasLabel(lv_screen_active(), "RADIO"),
                "Back did not return Packet Detail to Traffic")) return false;

    sendKeyboard('9');
    if(!require(hasLabel(lv_screen_active(), "PROTOCOLS") &&
                    hasLabel(lv_screen_active(), "MESHTASTIC") &&
                    hasLabel(lv_screen_active(), "MESHCORE") &&
                    hasLabel(lv_screen_active(), "RETICULUM"),
                "9 did not open the protocol health tool")) return false;
    sendKeyboard('\r');
    // The title is PROTO, and the screen leads with the protocol name over its
    // frame count, share and activity plot rather than a keyboard hint strip.
    if(!require(hasLabel(lv_screen_active(), "PROTO") &&
                    hasLabel(lv_screen_active(), "MESHTASTIC") &&
                    hasLabel(lv_screen_active(), "FRAMES") &&
                    hasLabel(lv_screen_active(), "ACTIVITY / 60S"),
                "Protocols Enter did not open Protocol Detail")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "MESHCORE"),
                "Protocol Detail did not move to the next protocol class")) return false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "RADIO *"),
                "Protocol Detail Enter did not apply a Traffic filter")) return false;

    sendKeyboard('X');
    // The screen is titled FILTER and states its scope in one line; the
    // applied predicate shows as the PROTOCOL row's value with ACTIVE beside
    // it, rather than a separate FILTER ACTIVE banner.
    if(!require(hasLabel(lv_screen_active(), "FILTER") &&
                    hasLabel(lv_screen_active(), "PROTOCOL") &&
                    hasLabel(lv_screen_active(), "MESHCORE") &&
                    hasLabel(lv_screen_active(), "ACTIVE") &&
                    hasLabel(lv_screen_active(), "CAPTURE FILES STAY COMPLETE."),
                "Traffic filter did not expose the applied protocol predicate")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "RETICULUM") &&
                    hasLabel(lv_screen_active(), "MALFORMED") &&
                    hasLabel(lv_screen_active(), "VALID"),
                "Traffic filter predicates did not respond to navigation")) return false;
    sendKeyboard('R');
    // Three predicates back to ANY is the whole of what reset means; the
    // separate "SHOWING ALL FRAMES" line no longer exists, and the match
    // counter says the same thing in numbers.
    if(!require(labelCount(lv_screen_active(), "ANY") == 3U &&
                    labelWithPrefix(lv_screen_active(), "MATCH  ") != nullptr,
                "Traffic filter reset did not restore all predicates")) return false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "RADIO") &&
                    !hasLabel(lv_screen_active(), "RADIO *"),
                "Traffic filter apply did not return to unfiltered Traffic")) return false;

    // Keep only structurally decoded header rows, then inject a newer raw frame. The
    // highlighted filtered row and Enter detail must remain on the newest
    // matching frame rather than indexing the unfiltered store by mistake.
    sendKeyboard('X');
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "RADIO *") &&
                    hasLabel(lv_screen_active(), "12345678"),
                "header filter did not retain the decoded Meshtastic frame")) return false;

    radio.packet = {0x01U, 0x02U, 0x03U, 0x04U};
    radio.packet_length = radio.packet.size();
    radio.irq_flags = RADIOLIB_SX126X_IRQ_HEADER_VALID;
    radio.triggerDio1();
    device_shell_fake::advance_ms(250U);
    loop();
    sendKeyboard('\r');
    const char *filtered_frame = labelWithPrefix(lv_screen_active(), "FRAME #");
    if(!require(hasLabel(lv_screen_active(), "PACKET") &&
                    filtered_frame != nullptr &&
                    std::strstr(filtered_frame, "CAPTURED 95 / ORIGINAL 95") != nullptr,
                "filtered Enter opened the newer nonmatching raw frame")) return false;
    sendKeyboard(0x08U);
    sendKeyboard('X');
    sendKeyboard('R');
    sendKeyboard('\r');

    sendKeyboard('3');
    if(!require(hasLabel(lv_screen_active(), "NODES") &&
                    hasLabel(lv_screen_active(), "12345678"),
                "the injected source did not reach the Nodes route")) return false;
    sendKeyboard('\r');
    // The old CHAT C button became MESSAGE when keyboard shortcuts were taken
    // off button faces; MAP sits beside it.
    if(!require(hasLabel(lv_screen_active(), "NODE") &&
                    hasLabel(lv_screen_active(), "MESSAGE") &&
                    hasLabel(lv_screen_active(), "MAP"),
                "Enter did not open Node Detail for the injected source")) return false;
    sendKeyboard(0x08U);
    if(!require(hasLabel(lv_screen_active(), "NODES"),
                "Back did not return Node Detail to Nodes")) return false;

    sendKeyboard('M');
    if(!require(hasLabel(lv_screen_active(), "HOME"),
                "M did not open Home from an analyzer route")) return false;
    sendKeyboard('M');
    if(!require(hasLabel(lv_screen_active(), "NODES"),
                "M did not restore the analyzer route beneath Home")) return false;

    sendKeyboard('8');
    if(!require(hasLabel(lv_screen_active(), "SETTINGS"),
                "8 did not reopen Settings from the analyzer")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard('\r');
    // The route is titled CAPTURE, and its state shows as the CAPTURE MODE
    // row's value rather than an ENTER hint in a strip.
    if(!require(hasLabel(lv_screen_active(), "CAPTURE") &&
                    hasLabel(lv_screen_active(), "CAPTURE MODE") &&
                    hasLabel(lv_screen_active(), "MICROSD") &&
                    hasLabel(lv_screen_active(), "RECORDING"),
                "Settings did not open the active Capture & Storage controls")) return false;

    const std::size_t pcap_flushes_before_stop = pcap->flush_calls;
    const std::size_t native_flushes_before_stop = native_capture->flush_calls;
    if(!require(pcap->is_open && native_capture->is_open,
                "capture files were not open before the operator stop")) return false;
    sendKeyboard('\r');
    // Stopping shows as the CAPTURE MODE value, not an ENTER hint. The file
    // handles are checked immediately below, which is the substantive part.
    if(!require(hasLabel(lv_screen_active(), "OFF") &&
                    hasLabel(lv_screen_active(), "CAPTURE MODE"),
                "operator stop did not update Capture & Storage")) return false;
    if(!require(!pcap->is_open && !native_capture->is_open &&
                    pcap->close_calls == 1U && native_capture->close_calls == 1U &&
                    pcap->flush_calls == pcap_flushes_before_stop + 1U &&
                    native_capture->flush_calls == native_flushes_before_stop + 1U,
                "operator stop did not flush and close both capture writers")) return false;

    lilyshark::AppSettings persisted{};
    if(!require(loadSavedAppSettings(persisted) && !persisted.capture_enabled,
                "operator stop did not persist the disabled capture preference")) return false;

    const std::size_t files_before_restart = state().files.size();
    sendKeyboard('\r');
    auto restarted_pcap = fileAtPath("/lilyshark/capture-0002.pcap");
    auto restarted_native = fileAtPath("/lilyshark/capture-0002.lscap");
    if(!require(hasLabel(lv_screen_active(), "RECORDING") &&
                    hasLabel(lv_screen_active(), "CAPTURE MODE"),
                "operator restart did not update Capture & Storage")) return false;
    if(!require(state().files.size() == files_before_restart + 2U &&
                    restarted_pcap != nullptr && restarted_native != nullptr &&
                    restarted_pcap->is_open && restarted_native->is_open,
                "operator restart did not open a new PCAP and LSCAP session")) return false;
    if(!require(hasPcapHeader(restarted_pcap) &&
                    hasLilysharkCaptureHeader(restarted_native),
                "restarted capture files do not contain valid format headers")) return false;
    if(!require(loadSavedAppSettings(persisted) && persisted.capture_enabled,
                "operator restart did not persist the enabled capture preference")) return false;

    sendKeyboard(0x08U);
    if(!require(hasLabel(lv_screen_active(), "SETTINGS"),
                "Back did not return Capture & Storage to Settings")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard('\r');
    // Titled DISPLAY; the rows lost their qualifiers -- OPTIONAL GPS is GPS,
    // STARTUP VIEW is STARTUP -- and HOME is still the default startup value.
    if(!require(hasLabel(lv_screen_active(), "DISPLAY") &&
                    hasLabel(lv_screen_active(), "GPS") &&
                    hasLabel(lv_screen_active(), "STARTUP") &&
                    hasLabel(lv_screen_active(), "HOME"),
                "Settings did not open Display & Input with default preferences")) return false;

    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "OFF") &&
                    loadSavedAppSettings(persisted) && !persisted.gps_enabled,
                "optional GPS toggle was not reflected and persisted")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "LAST VIEW") &&
                    loadSavedAppSettings(persisted) && persisted.resume_last_view,
                "startup-view toggle was not reflected and persisted")) return false;

    sendKeyboard('7');
    lv_obj_t *events_screen = lv_screen_active();
    // kEventsVisible is five; the feed lost a row when the header gained one.
    if(!require(hasLabel(events_screen, "EVENTS") &&
                    visibleRuntimeEventRows(events_screen) == 5U,
                "Events did not render the five-row bounded runtime feed")) return false;
    if(!require(!hasLabel(events_screen, "NEW NODE") &&
                    !hasLabel(events_screen, "MOBILE-4 APPEARED  SNR -12.1") &&
                    !hasLabel(events_screen, "HIGH UTIL") &&
                    !hasLabel(events_screen, "NODE LOST"),
                "Events still rendered the obsolete simulator snapshot rows")) return false;

    const char *top_range = labelWithPrefix(events_screen, "1-5 / ");
    unsigned event_count = 0U;
    if(!require(top_range != nullptr && std::sscanf(top_range, "1-5 / %u", &event_count) == 1 &&
                    event_count > 5U,
                "Events did not expose a scrollable feed longer than five rows")) return false;

    bool saw_first_frame = false;
    bool saw_capture_stop = false;
    bool saw_capture_restart = false;
    bool saw_gps_disable = false;
    bool saw_startup_preference = false;
    const auto observe_expected_events = [&]() {
        lv_obj_t *screen = lv_screen_active();
        // The first frame the device sees is now its own position beacon at
        // boot, so the RF values in this event belong to that transmit rather
        // than to the frame injected below. What the assertion is for is that
        // a first-frame event is recorded and reaches the feed; the injected
        // frame's own RSSI and SNR are checked on Traffic and Packet Detail.
        saw_first_frame = saw_first_frame ||
            labelWithPrefix(screen, "FIRST ") != nullptr;
        saw_capture_stop = saw_capture_stop ||
            hasLabel(screen, "CAPTURE STOPPED BY OPERATOR");
        saw_capture_restart = saw_capture_restart ||
            hasLabel(screen, "NEW LSCAP AND PCAP SESSION STARTED");
        saw_gps_disable = saw_gps_disable ||
            hasLabel(screen, "OPTIONAL GPS POLLING DISABLED");
        saw_startup_preference = saw_startup_preference ||
            hasLabel(screen, "STARTUP WILL RESUME THE LAST LIVE VIEW");
    };
    observe_expected_events();
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_UP));
    if(!require(labelWithPrefix(lv_screen_active(), "1-5 / ") != nullptr,
                "Events moved above the newest row")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    if(!require(labelWithPrefix(lv_screen_active(), "2-6 / ") != nullptr,
                "Events did not scroll down by one row")) return false;
    observe_expected_events();

    for(unsigned offset = 1U; offset < event_count - 5U; ++offset) {
        sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
        observe_expected_events();
    }
    char oldest_range[24]{};
    std::snprintf(oldest_range, sizeof(oldest_range), "%u-%u / %u",
                  event_count - 4U, event_count, event_count);
    if(!require(hasLabel(lv_screen_active(), oldest_range) &&
                    visibleRuntimeEventRows(lv_screen_active()) == 5U,
                "Events did not reach the oldest five-row window")) return false;
    if(!(saw_first_frame && saw_capture_stop && saw_capture_restart &&
         saw_gps_disable && saw_startup_preference)) {
        std::fprintf(stderr,
                     "event-action visibility: frame=%d stop=%d restart=%d gps=%d startup=%d\n",
                     saw_first_frame, saw_capture_stop, saw_capture_restart,
                     saw_gps_disable, saw_startup_preference);
        return require(false,
                       "Events pagination did not expose the actual frame and settings actions");
    }
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    if(!require(hasLabel(lv_screen_active(), oldest_range),
                "Events moved beyond the oldest row")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_UP));
    char previous_range[24]{};
    std::snprintf(previous_range, sizeof(previous_range), "%u-%u / %u",
                  event_count - 5U, event_count - 1U, event_count);
    if(!require(hasLabel(lv_screen_active(), previous_range),
                "Events did not scroll upward from the oldest window")) return false;
    for(unsigned offset = 1U; offset < event_count - 4U; ++offset) {
        sendKeyboard(static_cast<std::uint8_t>(LV_KEY_UP));
    }
    if(!require(labelWithPrefix(lv_screen_active(), "1-5 / ") != nullptr,
                "Events did not return to the newest five-row window")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    if(!require(labelWithPrefix(lv_screen_active(), "2-6 / ") != nullptr,
                "Events did not leave the newest window before the reopen check")) return false;
    sendKeyboard('8');
    sendKeyboard('7');
    if(!require(labelWithPrefix(lv_screen_active(), "1-5 / ") != nullptr,
                "reopening Events did not return to the newest incident")) return false;
    char event_position[24]{};
    sendKeyboard('\r');
    std::snprintf(event_position, sizeof(event_position), "EVENT 1 OF %u", event_count);
    // The detail view has no title bar of its own: it leads with the position
    // line and pages with UP and DOWN. "EVENT DETAIL" survives only as the
    // name of a render-test frame.
    if(!require(hasLabel(lv_screen_active(), event_position) &&
                    hasLabel(lv_screen_active(), "UP") &&
                    hasLabel(lv_screen_active(), "DOWN"),
                "Events Enter did not expose the complete selected message")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    std::snprintf(event_position, sizeof(event_position), "EVENT 2 OF %u", event_count);
    if(!require(hasLabel(lv_screen_active(), event_position),
                "Event Detail did not move to the next incident")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_UP));
    sendKeyboard(0x08U);
    if(!require(labelWithPrefix(lv_screen_active(), "1-5 / ") != nullptr,
                "Event Detail Back did not restore the newest Events window")) return false;

    // Keys that more than one handler answers to, checked on the device build
    // because both of the shadows found here lived behind LILYSHARK_DEVICE and
    // the simulator therefore could not see either.
    //
    // Chat claimed C and returned before the coding-rate handler further down,
    // so tuning stopped working the day chat shipped. Moving coding rate to R
    // then put it in front of the Traffic Filter reset, which answers to R as
    // well. Neither failed anywhere; both were silent.
    sendKeyboard('1');
    if(!require(hasLabel(lv_screen_active(), "RADIO"),
                "1 did not open the live traffic view")) return false;
    sendKeyboard('X');
    if(!require(hasLabel(lv_screen_active(), "FILTER"),
                "X did not open Traffic Filter")) return false;
    sendKeyboard('R');
    if(!require(hasLabel(lv_screen_active(), "FILTER"),
                "R on Traffic Filter tuned the radio instead of resetting the filter")) return false;

    sendKeyboard('C');
    // The bottom nav shows CHAT on every screen, so assert on something only
    // the chat screen draws. That vagueness is exactly how an earlier version
    // of this block "passed" while every later keystroke was being typed into
    // the message draft.
    if(!require(hasLabel(lv_screen_active(), "TYPE A MESSAGE"),
                "C did not open Chat")) return false;
    sendKeyboard(0x08U);
    if(!require(hasLabel(lv_screen_active(), "LAST RX"),
                "backspace with an empty draft did not leave Chat for Home")) return false;

    // A frame relayed over the internet enters through LSK INJ and must be
    // treated as heard -- nodes, traffic, captures with honest provenance --
    // and never as this device's own air.
    {
        // The operator stop/restart earlier in this scenario rotated the
        // session to capture-0002; the 0001 handles are closed history.
        auto inj_pcap = fileAtPath("/lilyshark/capture-0002.pcap");
        auto inj_native = fileAtPath("/lilyshark/capture-0002.lscap");
        if(!require(inj_pcap != nullptr && inj_native != nullptr,
                    "the rotated capture session is missing before injection")) return false;
        const std::size_t pcap_before_inj = inj_pcap->bytes.size();
        const std::size_t native_before_inj = inj_native->bytes.size();
        // A Meshtastic outer header: broadcast dest, source !11223344.
        std::string inj = "LSK INJ ffffffff44332211";
        for(int filler = 0; filler < 24; ++filler) inj += "5a";
        Serial.pushInput(inj);
        loop();
        if(!require(state().serial_log.find("LSK OK {\"kind\":\"inj\"}") != std::string::npos,
                    "the injected frame was not acknowledged")) return false;
        if(!require(inj_pcap->bytes.size() == pcap_before_inj,
                    "a net-relayed frame leaked into the OTA-only PCAP")) return false;
        if(!require(inj_native->bytes.size() > native_before_inj,
                    "a net-relayed frame was not kept in the native capture")) return false;
        // The record's metadata flags live at offset 76 of the v1 record
        // header (docs/lilyshark-capture-format.md); bit 3 is net-relayed.
        if(!require(inj_native->bytes.size() >= native_before_inj + 77U &&
                        (inj_native->bytes[native_before_inj + 76U] & 0x08U) != 0U,
                    "the native record did not carry the net-relayed flag")) return false;
        // Byte 22 of a v1 record is the metadata flags; bit 3 is net-relayed.
        // Rather than hardcode the offset, scan the appended bytes for the
        // frame body and check its record's flag through the reader-side
        // helper below.
        sendKeyboard('3');
        if(!require(hasLabel(lv_screen_active(), "CALL") &&
                        hasLabel(lv_screen_active(), "11223344"),
                    "the net-relayed source did not reach the Nodes list")) return false;
        // ...and it must be visible there as something that never crossed
        // this radio. An operator seeing a bridged message rendered exactly
        // like an over-the-air one is the failure this guards: it looks like
        // the instrument is inventing traffic.
        if(!require(hasLabel(lv_screen_active(), "NET"),
                    "a node heard only over the bridge was not marked NET")) return false;
        sendKeyboard('M');
        if(!require(hasLabel(lv_screen_active(), "LAST RX"),
                    "M did not return to Home after the injection checks")) return false;
    }

    // Delivery confirmation, both directions, over the real serial and radio
    // paths. In the field "did it arrive" is the entire question a sender
    // has; this proves the want-ack bit leaves on the wire, a peer's Routing
    // acknowledgement flips the chat line to DELIVERED, and an incoming
    // want-ack message is confirmed the way official firmware would.
    {
        const std::size_t sent_before = radiolib_fake::state().transmitted.size();
        Serial.pushInput("LSK TX meshtastic dm 778899aa checking in");
        loop();
        auto &sent = radiolib_fake::state().transmitted;
        if(!require(sent.size() == sent_before + 1U,
                    "the direct message did not reach the radio")) return false;
        const std::vector<std::uint8_t> &dm = sent.back();
        if(!require(dm.size() > 16U && (dm[12] & 0x08U) != 0U,
                    "the direct message did not request an acknowledgement")) return false;
        const std::uint32_t dm_id = static_cast<std::uint32_t>(dm[8]) |
                                    (static_cast<std::uint32_t>(dm[9]) << 8U) |
                                    (static_cast<std::uint32_t>(dm[10]) << 16U) |
                                    (static_cast<std::uint32_t>(dm[11]) << 24U);

        // The peer's radio answers with a Routing acknowledgement.
        lilyshark::MeshtasticEncodeRequest ack{};
        ack.from_node = 0x778899aaU;
        ack.to_node = 0x33445566U;  // this build's mesh identity, per the serial log
        ack.packet_id = 900001U;
        ack.port = lilyshark::MeshtasticPort::Routing;
        ack.request_id = dm_id;
        std::uint8_t ack_frame[256]{};
        const std::size_t ack_len =
            lilyshark::encodeMeshtasticFrame(ack, ack_frame, sizeof(ack_frame));
        if(!require(ack_len > 16U, "the test could not encode the peer ack")) return false;
        radio.packet.assign(ack_frame, ack_frame + ack_len);
        radio.packet_length = radio.packet.size();
        radio.irq_flags = RADIOLIB_SX126X_IRQ_HEADER_VALID;
        radio.triggerDio1();
        device_shell_fake::advance_ms(250U);
        loop();

        sendKeyboard('C');
        if(!require(hasLabel(lv_screen_active(), "TYPE A MESSAGE"),
                    "C did not open Chat for the delivery check")) return false;
        // The DM conversation lives on its own tab; cycle to it.
        bool saw_delivered = hasLabel(lv_screen_active(), "YOU  DELIVERED");
        for(int hop = 0; hop < 4 && !saw_delivered; ++hop) {
            sendKeyboard('\t');
            saw_delivered = hasLabel(lv_screen_active(), "YOU  DELIVERED");
        }
        if(!require(saw_delivered,
                    "the peer acknowledgement did not mark the message DELIVERED")) return false;
        sendKeyboard(0x08U);
        if(!require(hasLabel(lv_screen_active(), "LAST RX"),
                    "backspace did not leave Chat after the delivery check")) return false;

        // Inbound: a want-ack message to us must be confirmed on the air.
        lilyshark::MeshtasticEncodeRequest incoming{};
        incoming.from_node = 0x778899aaU;
        incoming.to_node = 0x33445566U;
        incoming.packet_id = 900002U;
        incoming.port = lilyshark::MeshtasticPort::TextMessage;
        incoming.text = "are you there";
        incoming.want_ack = true;
        std::uint8_t in_frame[256]{};
        const std::size_t in_len =
            lilyshark::encodeMeshtasticFrame(incoming, in_frame, sizeof(in_frame));
        if(!require(in_len > 16U, "the test could not encode the incoming DM")) return false;
        const std::size_t sent_before_ack = sent.size();
        radio.packet.assign(in_frame, in_frame + in_len);
        radio.packet_length = radio.packet.size();
        radio.irq_flags = RADIOLIB_SX126X_IRQ_HEADER_VALID;
        radio.triggerDio1();
        device_shell_fake::advance_ms(250U);
        loop();
        if(!require(sent.size() == sent_before_ack + 1U,
                    "the want-ack message was not acknowledged on the air")) return false;
        const std::vector<std::uint8_t> &our_ack = sent.back();
        const std::uint32_t ack_dest = static_cast<std::uint32_t>(our_ack[0]) |
                                       (static_cast<std::uint32_t>(our_ack[1]) << 8U) |
                                       (static_cast<std::uint32_t>(our_ack[2]) << 16U) |
                                       (static_cast<std::uint32_t>(our_ack[3]) << 24U);
        const std::uint32_t ack_src_id = static_cast<std::uint32_t>(our_ack[8]) |
                                         (static_cast<std::uint32_t>(our_ack[9]) << 8U) |
                                         (static_cast<std::uint32_t>(our_ack[10]) << 16U) |
                                         (static_cast<std::uint32_t>(our_ack[11]) << 24U);
        lilyshark::MeshtasticPayload confirmed{};
        if(!require(ack_dest == 0x778899aaU &&
                        lilyshark::readMeshtasticPayload(our_ack.data() + 16,
                                                         our_ack.size() - 16U, 0x33445566U,
                                                         ack_src_id, confirmed) &&
                        confirmed.portnum ==
                            static_cast<std::uint16_t>(lilyshark::MeshtasticPort::Routing) &&
                        confirmed.has_request_id && confirmed.request_id == 900002U,
                    "our acknowledgement did not name the confirmed packet")) return false;
    }

    return true;
}

bool recoverableFailureScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    state().touch_present = false;
    state().keyboard_present = false;
    state().sd_present = false;
    state().psram_available = false;
    auto &radio = radiolib_fake::state();
    radio.reset();
    radio.begin_results = {-707, RADIOLIB_ERR_NONE};
    if(!require(seedCompletedAppSettings(),
                "completed recovery settings could not be encoded")) return false;

    setup();

    if(!require(serialMilestonesInOrder("(failed, error -707)"),
                "recoverable startup milestones are missing or out of order")) return false;
    if(!require(state().serial_log.find("Lilyshark touch: not found (0x00)") != std::string::npos,
                "missing touch was not reported")) return false;
    if(!require(state().serial_log.find("Lilyshark keyboard: not found") != std::string::npos,
                "missing keyboard was not reported")) return false;
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
    if(!require(hasLabel(lv_screen_active(), "HOME"),
                "returning-user recovery startup did not open Home")) return false;

    device_shell_fake::advance_ms(1000);
    loop();
    // Receive must be restarted after the retry; how many times depends on
    // whether a position beacon went out in the same window, which is not what
    // this assertion is about.
    if(!require(radio.begin_calls == 2U && radio.start_receive_calls >= 1U,
                "radio did not recover through the real loop retry path")) return false;

    state().keyboard_present = true;
    device_shell_fake::advance_ms(2000);
    loop();
    if(!require(traceOccurrenceCount("keyboard.brightness.96") >= 3U,
                "keyboard reconnect probe did not restore input")) return false;

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

bool freshOnboardingScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();

    setup();

    if(!require(hasLabel(lv_screen_active(), "FIRST RUN") &&
                    hasLabel(lv_screen_active(), "1 / 6"),
                "fresh settings did not open onboarding welcome")) return false;
    sendKeyboard('1');
    if(!require(hasLabel(lv_screen_active(), "FIRST RUN"),
                "direct analyzer shortcuts escaped onboarding")) return false;

    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "CAPABILITIES") &&
                    hasLabel(lv_screen_active(), "2 / 6") &&
                    hasLabel(lv_screen_active(), "PACKETS") &&
                    hasLabel(lv_screen_active(), "CAPTURE"),
                "onboarding did not advance to capability overview")) return false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "NETWORK") &&
                    hasLabel(lv_screen_active(), "3 / 6"),
                "onboarding did not advance to network selection")) return false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "PROFILE") &&
                    hasLabel(lv_screen_active(), "4 / 6"),
                "onboarding did not advance to profile review")) return false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "CONTROLS") &&
                    hasLabel(lv_screen_active(), "5 / 6") &&
                    hasLabel(lv_screen_active(), "TRACKBALL"),
                "onboarding did not advance to field controls")) return false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "CHECK") &&
                    hasLabel(lv_screen_active(), "6 / 6"),
                "onboarding did not advance after applying the profile")) return false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "HOME"),
                "completed onboarding did not open Home")) return false;

    lilyshark::AppSettings saved{};
    if(!require(state().saved_app_settings.size() == lilyshark::kAppSettingsV1Size &&
                    lilyshark::decodeAppSettings(state().saved_app_settings.data(),
                                                 state().saved_app_settings.size(), saved) ==
                        lilyshark::AppSettingsDecodeResult::LoadedV1 &&
                    saved.onboarding_complete &&
                    saved.onboarding_version == lilyshark::kAppSettingsOnboardingVersion,
                "completed onboarding did not persist valid app settings")) return false;
    return true;
}

bool onboardingSaveFailureScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();

    setup();
    state().fail_app_settings_put = true;

    sendKeyboard('\r');
    sendKeyboard('\r');
    sendKeyboard('\r');
    sendKeyboard('\r');
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "CHECK") &&
                    hasLabel(lv_screen_active(), "6 / 6"),
                "save-failure scenario did not reach Device Check")) return false;

    sendKeyboard('\r');
    lilyshark::AppSettings saved{};
    if(!require(hasLabel(lv_screen_active(), "CHECK") &&
                    hasLabel(lv_screen_active(),
                             "SETTINGS SAVE FAILED - ENTER TO RETRY") &&
                    hasLabel(lv_screen_active(), "ENTER  RETRY SAVE") &&
                    !hasLabel(lv_screen_active(), "HOME"),
                "failed onboarding save did not remain on Device Check with retry UI")) {
        return false;
    }
    if(!require(state().app_settings_put_calls == 1U &&
                    !loadSavedAppSettings(saved) &&
                    state().serial_log.find("Lilyshark onboarding state was not saved") !=
                        std::string::npos,
                "failed onboarding save was not observable or was treated as persisted")) {
        return false;
    }

    state().fail_app_settings_put = false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "HOME") &&
                    !hasLabel(lv_screen_active(), "ENTER  RETRY SAVE"),
                "successful onboarding retry did not open Home")) return false;
    if(!require(state().app_settings_put_calls == 2U &&
                    loadSavedAppSettings(saved) && saved.onboarding_complete &&
                    saved.onboarding_version == lilyshark::kAppSettingsOnboardingVersion,
                "successful onboarding retry did not persist completed settings")) return false;
    return true;
}

bool onboardingProfileSaveFailureScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();

    setup();
    state().fail_profile_put = true;

    sendKeyboard('\r');
    sendKeyboard('\r');
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "PROFILE") &&
                    hasLabel(lv_screen_active(), "4 / 6"),
                "profile-save-failure scenario did not reach profile review")) return false;

    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "PROFILE") &&
                    hasLabel(lv_screen_active(), "4 / 6") &&
                    hasLabel(lv_screen_active(), "PROFILE ACTIVE / SAVE FAILED") &&
                    hasLabel(lv_screen_active(), "ENTER  RETRY") &&
                    !hasLabel(lv_screen_active(), "CHECK"),
                "failed profile save did not remain on profile review with retry UI")) {
        return false;
    }
    if(!require(state().profile_put_calls == 1U && state().saved_profile.empty() &&
                    state().serial_log.find("Lilyshark profile settings were not saved") !=
                        std::string::npos,
                "failed onboarding profile save was not observable or was treated as saved")) {
        return false;
    }

    state().fail_profile_put = false;
    sendKeyboard('\r');
    lilyshark::RadioProfile saved_profile{};
    if(!require(hasLabel(lv_screen_active(), "CONTROLS") &&
                    hasLabel(lv_screen_active(), "5 / 6") &&
                    !hasLabel(lv_screen_active(), "ENTER  RETRY"),
                "successful profile retry did not advance to field controls")) return false;
    if(!require(state().profile_put_calls == 2U &&
                    state().saved_profile.size() == lilyshark::kSavedProfileV2Size &&
                    lilyshark::decodeSavedProfile(state().saved_profile.data(),
                                                  state().saved_profile.size(), saved_profile) ==
                        lilyshark::SavedProfileDecodeResult::LoadedV2,
                "successful onboarding profile retry did not persist a valid profile")) {
        return false;
    }
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "CHECK") &&
                    hasLabel(lv_screen_active(), "6 / 6"),
                "profile retry flow did not continue to Device Check")) return false;
    return true;
}

bool resetSettingsSaveFailureScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();

    lilyshark::AppSettings original = lilyshark::defaultAppSettings();
    original.onboarding_version = lilyshark::kAppSettingsOnboardingVersion;
    original.onboarding_complete = true;
    original.display_brightness = 5U;
    original.keyboard_brightness = 48U;
    original.gps_enabled = false;
    original.resume_last_view = true;
    original.last_primary_diagnostic_index = 4U;
    original.spectrum_warning_acknowledged = true;
    if(!require(seedAppSettings(original),
                "custom reset settings could not be encoded")) return false;

    setup();
    sendKeyboard('8');
    for(std::size_t index = 0; index < 6U; ++index) {
        sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    }
    sendKeyboard('\r');
    // The header splits into RESET and SETUP as title and step.
    if(!require(hasLabel(lv_screen_active(), "RESET") &&
                    hasLabel(lv_screen_active(), "SETUP") &&
                    hasLabel(lv_screen_active(), "NO  KEEP SETTINGS"),
                "Settings did not open reset confirmation")) return false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));

    const std::vector<std::uint8_t> persisted_before = state().saved_app_settings;
    state().fail_app_settings_put = true;
    sendKeyboard('\r');
    lilyshark::AppSettings persisted{};
    if(!require(hasLabel(lv_screen_active(), "RESET") &&
                    hasLabel(lv_screen_active(),
                             "SETTINGS SAVE FAILED - NOTHING WAS RESET") &&
                    hasLabel(lv_screen_active(), "ENTER  RETRY") &&
                    !hasLabel(lv_screen_active(), "FIRST RUN"),
                "failed reset save did not stay in confirmation with retry UI")) {
        return false;
    }
    if(!require(state().app_settings_put_calls == 1U &&
                    state().saved_app_settings == persisted_before &&
                    loadSavedAppSettings(persisted) &&
                    persisted.display_brightness == original.display_brightness &&
                    persisted.keyboard_brightness == original.keyboard_brightness &&
                    persisted.gps_enabled == original.gps_enabled &&
                    persisted.resume_last_view == original.resume_last_view,
                "failed reset save changed persisted settings")) return false;

    state().fail_app_settings_put = false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "FIRST RUN") &&
                    hasLabel(lv_screen_active(), "1 / 6") &&
                    !hasLabel(lv_screen_active(), "RUN FIRST-TIME SETUP AGAIN?"),
                "successful reset retry did not return to first-run setup")) return false;
    if(!require(state().app_settings_put_calls == 2U && loadSavedAppSettings(persisted) &&
                    !persisted.onboarding_complete && persisted.onboarding_version == 0U &&
                    persisted.display_brightness == 16U &&
                    persisted.keyboard_brightness == 96U && persisted.gps_enabled &&
                    !persisted.resume_last_view,
                "successful reset retry did not persist default settings")) return false;
    return true;
}

bool displayInputSaveFailureScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();
    // Seeded below the maximum on purpose. This scenario turns brightness up
    // and requires the failed save to put it back, which proves nothing if the
    // value starts at 16 of 16 and cannot move.
    {
        lilyshark::AppSettings settings = lilyshark::defaultAppSettings();
        settings.onboarding_version = lilyshark::kAppSettingsOnboardingVersion;
        settings.onboarding_complete = true;
        settings.display_brightness = 12U;
        if(!require(seedAppSettings(settings),
                    "completed display settings could not be encoded")) return false;
    }

    setup();
    sendKeyboard('8');
    for(std::size_t index = 0; index < 3U; ++index) {
        sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    }
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "DISPLAY") &&
                    hasLabel(lv_screen_active(), "12 / 16") &&
                    hasLabel(lv_screen_active(), "ENABLED") &&
                    hasLabel(lv_screen_active(), "HOME"),
                "Settings did not open Display & Input with prior values")) return false;

    const std::vector<std::uint8_t> persisted_before = state().saved_app_settings;
    state().fail_app_settings_put = true;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "12 / 16") &&
                    hasLabel(lv_screen_active(), "SAVE FAILED - VALUE RESTORED") &&
                    state().saved_app_settings == persisted_before,
                "display-brightness save failure did not visibly restore its prior value")) {
        return false;
    }

    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    const std::size_t gps_end_before = traceOccurrenceCount("gps.end");
    const std::size_t gps_begin_before = traceOccurrenceCount("gps.begin.9600");
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "ENABLED") &&
                    hasLabel(lv_screen_active(), "SAVE FAILED - VALUE RESTORED") &&
                    traceOccurrenceCount("gps.end") == gps_end_before + 2U &&
                    traceOccurrenceCount("gps.begin.9600") == gps_begin_before + 1U &&
                    state().saved_app_settings == persisted_before,
                "GPS save failure did not visibly and physically restore the prior state")) {
        return false;
    }

    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    lilyshark::AppSettings persisted{};
    if(!require(hasLabel(lv_screen_active(), "HOME") &&
                    hasLabel(lv_screen_active(), "SAVE FAILED - VALUE RESTORED") &&
                    state().app_settings_put_calls == 3U &&
                    state().saved_app_settings == persisted_before &&
                    loadSavedAppSettings(persisted) &&
                    persisted.display_brightness == 12U && persisted.gps_enabled &&
                    !persisted.resume_last_view,
                "startup-view save failure persisted or displayed a false value")) {
        return false;
    }
    return true;
}

bool persistedSimulateModeScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();

    lilyshark::AppSettings settings = lilyshark::defaultAppSettings();
    settings.onboarding_version = lilyshark::kAppSettingsOnboardingVersion;
    settings.onboarding_complete = true;
    settings.simulate_mode = true;
    settings.spectrum_warning_acknowledged = true;
    if(!require(seedAppSettings(settings),
                "simulate-mode app settings could not be encoded")) return false;

    setup();

    auto &radio = radiolib_fake::state();
    const std::size_t begin_calls_while_paused = radio.begin_calls;
    const std::size_t receive_calls_while_paused = radio.start_receive_calls;
    auto simulated_pcap = fileAtPath("/lilyshark/capture-0001.pcap");
    auto simulated_native = fileAtPath("/lilyshark/capture-0001.lscap");
    lilyshark::AppSettings persisted{};
    if(!require(serialMilestonesInOrder("(simulate mode / SX1262 paused, error 0)"),
                "persisted Simulate mode was not reported during startup")) return false;
    // Home shows SIM MODE in the status bar and SIMULATED where it would
    // otherwise say LISTENING; the old "SIMULATED TRAFFIC" and "SIM 0" strings
    // are gone.
    if(!require(hasLabel(lv_screen_active(), "HOME") &&
                    hasLabel(lv_screen_active(), "SIM MODE") &&
                    hasLabel(lv_screen_active(), "SIMULATED"),
                "persisted Simulate mode was not visible on Home")) return false;
    if(!require(loadSavedAppSettings(persisted) && persisted.simulate_mode,
                "persisted Simulate mode was not retained at boot")) return false;
    if(!require(radio.dio1_action == nullptr,
                "persisted Simulate mode did not leave SX1262 receive paused")) return false;
    if(!require(hasPcapHeader(simulated_pcap) &&
                    hasLilysharkCaptureHeader(simulated_native) &&
                    simulated_pcap->is_open && simulated_native->is_open,
                "persisted Simulate mode did not open clean capture headers")) return false;

    radio.packet = {0xffU, 0xffU, 0xffU, 0xffU, 0x78U, 0x56U, 0x34U, 0x12U};
    radio.packet_length = radio.packet.size();
    radio.irq_flags = RADIOLIB_SX126X_IRQ_HEADER_VALID;
    const std::size_t radio_operations_before_irq = radio.operations.size();
    const std::size_t simulated_pcap_before_irq = simulated_pcap->bytes.size();
    const std::size_t simulated_native_before_irq = simulated_native->bytes.size();
    radio.triggerDio1();
    device_shell_fake::advance_ms(100U);
    loop();
    if(!require(radio.operations.size() == radio_operations_before_irq &&
                    simulated_pcap->bytes.size() == simulated_pcap_before_irq &&
                    simulated_native->bytes.size() == simulated_native_before_irq,
                "a live radio IRQ entered the pipeline during Simulate mode")) return false;

    sendKeyboard('1');
    device_shell_fake::advance_ms(2400U);
    loop();
    if(!require(hasLabel(lv_screen_active(), "RADIO") &&
                    hasLabel(lv_screen_active(), "SIM MODE") &&
                    hasLabel(lv_screen_active(), "SIM 1") &&
                    !hasLabel(lv_screen_active(), "LISTENING FOR FRAMES"),
                "synthetic injection did not reach the live Traffic UI")) return false;
    if(!require(simulated_pcap->bytes.size() == 24U &&
                    simulated_native->bytes.size() > 24U &&
                    lilysharkRecordHasSyntheticFlag(simulated_native),
                "synthetic traffic was not marked in LSCAP or entered PCAP")) return false;

    const std::size_t simulated_native_after_frame = simulated_native->bytes.size();
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "PACKET"),
                "synthetic Traffic row did not open Packet Detail")) return false;
    for(std::size_t index = 0U; index < 4U; ++index) {
        sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    }
    if(!require(hasLabel(lv_screen_active(), "ORIGIN SYNTHETIC / NOT OTA"),
                "Packet Detail did not identify the frame as synthetic")) return false;
    sendKeyboard(0x08U);

    sendKeyboard('2');
    if(!require(hasLabel(lv_screen_active(), "SPECTRUM") &&
                    hasLabel(lv_screen_active(), "LIVE RF SPECTRUM PAUSED") &&
                    hasLabel(lv_screen_active(), "SIMULATED / NOT AN RF MEASUREMENT"),
                "Spectrum did not show its Simulate-mode block")) return false;
    const std::size_t fsk_before_blocked_scan =
        radioOperationCount(radiolib_fake::Operation::BeginFsk);
    const std::size_t scans_before_blocked_scan =
        radioOperationCount(radiolib_fake::Operation::ScanStart);
    sendKeyboard('\r');
    if(!require(radioOperationCount(radiolib_fake::Operation::BeginFsk) ==
                        fsk_before_blocked_scan &&
                    radioOperationCount(radiolib_fake::Operation::ScanStart) ==
                        scans_before_blocked_scan &&
                    hasLabel(lv_screen_active(), "LIVE RF SPECTRUM PAUSED"),
                "Spectrum started radio work during Simulate mode")) return false;

    sendKeyboard('8');
    for(std::size_t index = 0U; index < 3U; ++index) {
        sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    }
    sendKeyboard('\r');
    for(std::size_t index = 0U; index < 4U; ++index) {
        sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    }
    if(!require(hasLabel(lv_screen_active(), "DISPLAY") &&
                    hasLabel(lv_screen_active(), "SIMULATE") &&
                    hasLabel(lv_screen_active(), "SYNTHETIC"),
                "Display & Input did not show persisted Simulate mode")) return false;

    const std::vector<std::uint8_t> simulated_settings = state().saved_app_settings;
    const std::size_t files_before_failed_disable = state().files.size();
    state().fail_app_settings_put = true;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "SYNTHETIC") &&
                    hasLabel(lv_screen_active(), "SAVE FAILED - VALUE RESTORED") &&
                    state().saved_app_settings == simulated_settings &&
                    loadSavedAppSettings(persisted) && persisted.simulate_mode,
                "failed Simulate-mode save did not restore the visible and persisted value")) {
        return false;
    }
    if(!require(state().files.size() == files_before_failed_disable &&
                    simulated_pcap->is_open && simulated_native->is_open &&
                    simulated_native->bytes.size() == simulated_native_after_frame &&
                    radio.dio1_action == nullptr &&
                    radio.begin_calls == begin_calls_while_paused &&
                    radio.start_receive_calls == receive_calls_while_paused,
                "failed Simulate-mode save changed capture or radio runtime state")) return false;

    state().fail_app_settings_put = false;
    const std::size_t begin_calls_before_restore = radio.begin_calls;
    const std::size_t receive_calls_before_restore = radio.start_receive_calls;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    auto live_pcap = fileAtPath("/lilyshark/capture-0002.pcap");
    auto live_native = fileAtPath("/lilyshark/capture-0002.lscap");
    if(!require(hasLabel(lv_screen_active(), "OFF") &&
                    !hasLabel(lv_screen_active(), "SAVE FAILED - VALUE RESTORED") &&
                    loadSavedAppSettings(persisted) && !persisted.simulate_mode,
                "successful Simulate-mode disable was not shown and persisted")) return false;
    if(!require(!simulated_pcap->is_open && !simulated_native->is_open &&
                    simulated_pcap->flush_calls == 1U && simulated_native->flush_calls == 1U &&
                    simulated_pcap->close_calls == 1U && simulated_native->close_calls == 1U &&
                    state().files.size() == files_before_failed_disable + 2U &&
                    live_pcap != nullptr && live_native != nullptr &&
                    hasPcapHeader(live_pcap) && hasLilysharkCaptureHeader(live_native),
                "Simulate-mode disable did not rotate the capture session")) return false;
    // Receive is restored and the DIO1 handler re-attached; the exact count of
    // startReceive calls also depends on whether a beacon went out while the
    // session rotated, which this assertion is not about. The handler being
    // live is the part that matters -- a transmit used to clear it and leave
    // the radio permanently deaf.
    if(!require(radio.begin_calls == begin_calls_before_restore + 1U &&
                    radio.start_receive_calls >= receive_calls_before_restore + 1U &&
                    radio.dio1_action != nullptr,
                "Simulate-mode disable did not fully restore packet receive")) return false;

    const std::size_t live_pcap_header_size = live_pcap->bytes.size();
    const std::size_t live_native_header_size = live_native->bytes.size();
    radio.packet = {0x01U, 0x02U, 0x03U, 0x04U};
    radio.packet_length = radio.packet.size();
    radio.irq_flags = RADIOLIB_SX126X_IRQ_HEADER_VALID;
    radio.triggerDio1();
    device_shell_fake::advance_ms(250U);
    loop();
    if(!require(radio.start_receive_calls >= receive_calls_before_restore + 2U &&
                    live_pcap->bytes.size() > live_pcap_header_size &&
                    live_native->bytes.size() > live_native_header_size &&
                    !lilysharkRecordHasSyntheticFlag(live_native),
                "restored radio callback did not write an unmarked live frame")) return false;
    if(!require(simulated_pcap->bytes.size() == 24U &&
                    simulated_native->bytes.size() == simulated_native_after_frame,
                "live traffic was appended to the closed simulated capture session")) return false;

    sendKeyboard('M');
    if(!require(hasLabel(lv_screen_active(), "HOME") &&
                    hasLabel(lv_screen_active(), "LISTENING") &&
                    !hasLabel(lv_screen_active(), "SIM MODE"),
                "Home did not return to live receiver status after Simulate mode")) return false;
    return true;
}

bool captureDisabledSimulateModeScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();

    lilyshark::AppSettings settings = lilyshark::defaultAppSettings();
    settings.onboarding_version = lilyshark::kAppSettingsOnboardingVersion;
    settings.onboarding_complete = true;
    settings.capture_enabled = false;
    if(!require(seedAppSettings(settings),
                "capture-disabled app settings could not be encoded")) return false;

    setup();

    auto &radio = radiolib_fake::state();
    lilyshark::AppSettings persisted{};
    if(!require(state().files.empty() && radio.dio1_action != nullptr &&
                    loadSavedAppSettings(persisted) && !persisted.capture_enabled &&
                    !persisted.simulate_mode,
                "capture-disabled startup did not remain live and file-free")) return false;

    sendKeyboard('8');
    for(std::size_t index = 0U; index < 3U; ++index) {
        sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    }
    sendKeyboard('\r');
    for(std::size_t index = 0U; index < 4U; ++index) {
        sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    }
    if(!require(hasLabel(lv_screen_active(), "DISPLAY") &&
                    hasLabel(lv_screen_active(), "SIMULATE") &&
                    hasLabel(lv_screen_active(), "OFF"),
                "capture-disabled transition did not reach Simulate mode control")) return false;

    const std::vector<std::uint8_t> disabled_settings = state().saved_app_settings;
    const std::size_t begin_calls_before_failed_enable = radio.begin_calls;
    const std::size_t receive_calls_before_failed_enable = radio.start_receive_calls;
    state().fail_app_settings_put = true;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "OFF") &&
                    hasLabel(lv_screen_active(), "SAVE FAILED - VALUE RESTORED") &&
                    state().saved_app_settings == disabled_settings &&
                    loadSavedAppSettings(persisted) && !persisted.capture_enabled &&
                    !persisted.simulate_mode,
                "failed capture-disabled Simulate save did not restore settings")) return false;
    if(!require(state().files.empty() && radio.dio1_action != nullptr &&
                    radio.begin_calls == begin_calls_before_failed_enable &&
                    radio.start_receive_calls == receive_calls_before_failed_enable,
                "failed capture-disabled Simulate save changed runtime state")) return false;

    state().fail_app_settings_put = false;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "SYNTHETIC") &&
                    loadSavedAppSettings(persisted) && !persisted.capture_enabled &&
                    persisted.simulate_mode && state().files.empty() &&
                    radio.dio1_action == nullptr,
                "capture-disabled Simulate enable opened capture or left radio live")) return false;

    sendKeyboard('7');
    if(!require(hasLabel(lv_screen_active(), "SIMULATE MODE ACTIVE; CAPTURE REMAINS OFF") &&
                    !hasLabel(lv_screen_active(),
                              "SYNTHETIC LSCAP STARTED; PCAP EXCLUDES SIMULATED FRAMES"),
                "capture-disabled Simulate enable reported a false capture session")) return false;

    sendKeyboard('8');
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_UP));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_UP));
    sendKeyboard('\r');
    // The screen is titled CAPTURE and its file rows read "LSCAP  NO ACTIVE
    // FILE" / "PCAP   NO ACTIVE FILE"; the synthetic-header line must stay
    // absent, which is the point of this assertion.
    // Three OFFs: capture mode, the Lilyshark writer and the PCAP writer. The
    // synthetic-header line must stay absent, which is the point here.
    if(!require(hasLabel(lv_screen_active(), "CAPTURE") &&
                    labelCount(lv_screen_active(), "OFF") == 3U &&
                    hasLabel(lv_screen_active(), "NO ACTIVE LILYSHARK FILE") &&
                    hasLabel(lv_screen_active(), "NO ACTIVE WIRESHARK FILE") &&
                    hasLabel(lv_screen_active(),
                             "CAPTURE IS OFF; ANALYSIS STAYS IN MEMORY.") &&
                    !hasLabel(lv_screen_active(),
                              "HEADER ONLY - SYNTHETIC FRAMES EXCLUDED"),
                "capture-disabled Simulate storage UI implied an active session")) return false;

    sendKeyboard('8');
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard('\r');
    const std::size_t begin_calls_before_disable = radio.begin_calls;
    const std::size_t receive_calls_before_disable = radio.start_receive_calls;
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_RIGHT));
    if(!require(hasLabel(lv_screen_active(), "OFF") &&
                    loadSavedAppSettings(persisted) && !persisted.capture_enabled &&
                    !persisted.simulate_mode && state().files.empty(),
                "capture-disabled Simulate disable changed capture preference or files")) return false;
    if(!require(radio.dio1_action != nullptr &&
                    radio.begin_calls == begin_calls_before_disable + 1U &&
                    radio.start_receive_calls >= receive_calls_before_disable + 1U,
                "capture-disabled Simulate disable did not restore packet receive")) return false;

    sendKeyboard('7');
    if(!require(hasLabel(lv_screen_active(), "SIMULATE MODE OFF; CAPTURE REMAINS OFF") &&
                    !hasLabel(lv_screen_active(),
                              "RADIO-ONLY CAPTURE RESTORED AFTER SIMULATE MODE"),
                "capture-disabled Simulate disable reported a false capture session")) return false;
    return true;
}

bool capturePreferenceSaveFailureScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();
    if(!require(seedCompletedAppSettings(),
                "completed capture settings could not be encoded")) return false;

    setup();
    auto initial_pcap = fileAtPath("/lilyshark/capture-0001.pcap");
    auto initial_native = fileAtPath("/lilyshark/capture-0001.lscap");
    sendKeyboard('8');
    sendKeyboard(static_cast<std::uint8_t>(LV_KEY_DOWN));
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "CAPTURE") &&
                    initial_pcap != nullptr && initial_native != nullptr &&
                    initial_pcap->is_open && initial_native->is_open,
                "capture failure scenario did not start with an active session")) return false;

    const std::vector<std::uint8_t> enabled_settings = state().saved_app_settings;
    state().fail_app_settings_put = true;
    sendKeyboard('\r');
    auto restored_pcap = fileAtPath("/lilyshark/capture-0002.pcap");
    auto restored_native = fileAtPath("/lilyshark/capture-0002.lscap");
    lilyshark::AppSettings persisted{};
    if(!require(hasLabel(lv_screen_active(), "SAVE FAILED") &&
                    labelCount(lv_screen_active(), "RECORDING") == 3U &&
                    restored_pcap != nullptr && restored_native != nullptr &&
                    restored_pcap->is_open && restored_native->is_open,
                "capture preference failure did not report the restored recording state")) {
        return false;
    }
    if(!require(!initial_pcap->is_open && !initial_native->is_open &&
                    state().app_settings_put_calls == 1U &&
                    state().saved_app_settings == enabled_settings &&
                    loadSavedAppSettings(persisted) && persisted.capture_enabled,
                "capture preference failure changed storage or failed to restore runtime")) {
        return false;
    }
    sendKeyboard('7');
    if(!require(hasLabel(lv_screen_active(),
                         "CAPTURE SETTING WAS NOT SAVED; PRIOR STATE RESTORED"),
                "capture preference rollback was not reported in Events")) return false;

    state().fail_app_settings_put = false;
    sendKeyboard('8');
    sendKeyboard('\r');
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "CAPTURE") &&
                    labelCount(lv_screen_active(), "OFF") == 3U &&
                    loadSavedAppSettings(persisted) && !persisted.capture_enabled,
                "successful capture preference retry did not stop and persist capture")) {
        return false;
    }

    sendKeyboard('\r');
    auto active_pcap = fileAtPath("/lilyshark/capture-0003.pcap");
    auto active_native = fileAtPath("/lilyshark/capture-0003.lscap");
    if(!require(active_pcap != nullptr && active_native != nullptr &&
                    active_pcap->is_open && active_native->is_open &&
                    loadSavedAppSettings(persisted) && persisted.capture_enabled,
                "capture could not be restarted before restart-failure injection")) return false;

    const std::vector<std::uint8_t> enabled_before_restart_failure =
        state().saved_app_settings;
    state().fail_app_settings_put = true;
    state().fail_file_open = true;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "RETRY NEEDED") &&
                    hasLabel(lv_screen_active(), "SAVE FAILED") &&
                    labelCount(lv_screen_active(), "OFF") == 2U &&
                    !hasLabel(lv_screen_active(), "RECORDING") &&
                    !active_pcap->is_open && !active_native->is_open &&
                    fileAtPath("/lilyshark/capture-0004.pcap") == nullptr &&
                    fileAtPath("/lilyshark/capture-0004.lscap") == nullptr,
                "failed capture rollback did not report the actual stopped runtime")) {
        return false;
    }
    if(!require(state().saved_app_settings == enabled_before_restart_failure &&
                    loadSavedAppSettings(persisted) && persisted.capture_enabled,
                "failed capture rollback persisted a false disabled preference")) return false;
    sendKeyboard('7');
    if(!require(hasLabel(lv_screen_active(),
                         "CAPTURE SETTING SAVE AND SESSION RESTART BOTH FAILED"),
                "capture restart failure was not reported in Events")) return false;

    state().fail_app_settings_put = false;
    state().fail_file_open = false;
    sendKeyboard('8');
    sendKeyboard('\r');
    sendKeyboard('\r');
    auto retry_pcap = fileAtPath("/lilyshark/capture-0004.pcap");
    auto retry_native = fileAtPath("/lilyshark/capture-0004.lscap");
    if(!require(labelCount(lv_screen_active(), "RECORDING") == 3U &&
                    retry_pcap != nullptr && retry_native != nullptr &&
                    retry_pcap->is_open && retry_native->is_open &&
                    loadSavedAppSettings(persisted) && persisted.capture_enabled,
                "capture did not recover after the injected save and restart failures cleared")) {
        return false;
    }

    state().fail_file_flush = true;
    device_shell_fake::advance_ms(5100U);
    loop();
    if(!require(hasLabel(lv_screen_active(), "I/O ERROR") &&
                    hasLabel(lv_screen_active(), "RETRY NEEDED") &&
                    !retry_pcap->is_open && !retry_native->is_open,
                "runtime SD flush failure was not shown as a recoverable storage fault")) {
        return false;
    }

    state().fail_file_flush = false;
    const std::size_t end_calls_before_retry = state().sd_end_calls;
    sendKeyboard('\r');
    auto remounted_pcap = fileAtPath("/lilyshark/capture-0005.pcap");
    auto remounted_native = fileAtPath("/lilyshark/capture-0005.lscap");
    if(!require(state().sd_end_calls == end_calls_before_retry + 1U &&
                    labelCount(lv_screen_active(), "RECORDING") == 3U &&
                    hasLabel(lv_screen_active(), "READY") &&
                    remounted_pcap != nullptr && remounted_native != nullptr &&
                    remounted_pcap->is_open && remounted_native->is_open,
                "capture retry did not unmount, remount, and reopen storage after I/O failure")) {
        return false;
    }
    return true;
}

/// What the SPECTRUM screen says a sweep found, checked against what was fed
/// into the radio fake to be found.
///
/// The three facts under test are the ones the screen previously blurred: a
/// band nobody has swept, a band swept and heard quiet, and the loudest thing
/// in a band that had something in it -- named at the frequency the deck said
/// it was tuned to at the moment the strong reading arrived.
bool spectrumSweepReadoutScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();

    lilyshark::AppSettings settings = lilyshark::defaultAppSettings();
    settings.onboarding_version = lilyshark::kAppSettingsOnboardingVersion;
    settings.onboarding_complete = true;
    // The first-use notice is its own screen and its own scenario. Starting
    // past it keeps this one about what the sweep reports.
    settings.spectrum_warning_acknowledged = true;
    if(!require(seedAppSettings(settings),
                "spectrum app settings could not be encoded")) return false;

    setup();
    if(!require(hasLabel(lv_screen_active(), "HOME"),
                "spectrum scenario did not start at Home")) return false;

    sendKeyboard('2');
    if(!require(hasLabel(lv_screen_active(), "SPECTRUM") &&
                    hasLabel(lv_screen_active(), "NOT SWEPT YET"),
                "an unswept Spectrum screen did not say it was unswept")) return false;
    if(!require(labelWithPrefix(lv_screen_active(), "LOUDEST ") == nullptr &&
                    labelWithPrefix(lv_screen_active(), "SWEPT ") == nullptr &&
                    labelWithPrefix(lv_screen_active(), "FLOOR ") == nullptr,
                "an unswept Spectrum screen reported measurements it never made")) return false;

    // 50 samples at bin 26 (-115 dBm) is the noise floor; 14 at bin 7 is
    // -39 dBm, which is 76 dB above it and unmistakably a signal.
    constexpr std::size_t kFloorBin = 26U;
    constexpr std::size_t kSignalBin = 7U;
    constexpr std::size_t kSilentBin = RADIOLIB_SX126X_SPECTRAL_SCAN_RES_SIZE - 1U;
    constexpr std::size_t kLoudPoint = 3U;
    const ScanHistogram loud = scanHistogram(kFloorBin, 50U, kSignalBin, 14U);
    const ScanHistogram quiet = scanHistogram(kFloorBin, 64U, kSignalBin, 0U);
    const ScanHistogram silent = scanHistogram(kSilentBin, 64U, kSignalBin, 0U);

    sendKeyboard('\r');
    if(!require(radioOperationCount(radiolib_fake::Operation::ScanStart) != 0U ||
                    labelWithPrefix(lv_screen_active(), "SCANNING ") != nullptr,
                "the Spectrum screen did not start an SX1262 sweep")) return false;

    std::string loud_frequency;
    if(!require(driveFakeSweep(kLoudPoint, loud, quiet, loud_frequency),
                "the first sweep never reached its completed state")) return false;
    if(!require(!loud_frequency.empty(),
                "the deck never reported which frequency it was scanning")) return false;

    char expected[80]{};
    std::snprintf(expected, sizeof(expected), "LOUDEST %s MHZ  -39 DBM  76 DB OVER FLOOR",
                  loud_frequency.c_str());
    const char *loudest = labelWithPrefix(lv_screen_active(), "LOUDEST ");
    if(!require(loudest != nullptr && std::strcmp(loudest, expected) == 0,
                "the swept Spectrum screen did not name the strongest bin correctly")) {
        std::fprintf(stderr, "  expected: %s\n  reported: %s\n", expected,
                     loudest == nullptr ? "(no LOUDEST line)" : loudest);
        return false;
    }
    // 14 of 704 samples across the sweep sat above their own floor bin.
    if(!require(hasLabel(lv_screen_active(), "FLOOR -115 DBM  IN USE 1.9%"),
                "the swept Spectrum screen misreported the floor or the occupancy")) return false;
    if(!require(hasLabel(lv_screen_active(), "HOLD -39 DBM"),
                "the peak hold did not record the strongest bin of the sweep")) return false;

    // Second pass over the same band with nothing but the catch-all floor bin
    // in it: swept and heard nothing, which must not read as unswept, and must
    // not retract what the hold saw a moment ago.
    sendKeyboard('\r');
    std::string unused_frequency;
    if(!require(driveFakeSweep(SIZE_MAX, loud, silent, unused_frequency),
                "the silent sweep never reached its completed state")) return false;
    const char *swept = labelWithPrefix(lv_screen_active(), "SWEPT ");
    if(!require(swept != nullptr &&
                    std::string(swept).find(" BINS - NOTHING ABOVE THE -139 DBM FLOOR") !=
                        std::string::npos,
                "a sweep that heard nothing did not say so")) {
        std::fprintf(stderr, "  reported: %s\n", swept == nullptr ? "(no SWEPT line)" : swept);
        return false;
    }
    if(!require(labelWithPrefix(lv_screen_active(), "LOUDEST ") == nullptr &&
                    !hasLabel(lv_screen_active(), "NOT SWEPT YET"),
                "a silent sweep was reported as a peak or as never having run")) return false;
    if(!require(hasLabel(lv_screen_active(), "HOLD -39 DBM"),
                "the peak hold forgot the earlier signal after a quiet sweep")) return false;
    return true;
}

bool corruptSettingsScenario()
{
    device_shell_fake::reset();
    Wire.reset();
    radiolib_fake::state().reset();
    state().saved_app_settings.assign(lilyshark::kAppSettingsV1Size, 0xa5U);

    setup();

    if(!require(state().serial_log.find(
                    "Lilyshark app settings invalid; first-run setup required") !=
                    std::string::npos,
                "corrupt app settings were not reported")) return false;
    if(!require(hasLabel(lv_screen_active(), "FIRST RUN") &&
                    hasLabel(lv_screen_active(), "1 / 6"),
                "corrupt app settings did not fall back to onboarding")) return false;
    sendKeyboard('\r');
    if(!require(hasLabel(lv_screen_active(), "CAPABILITIES"),
                "corrupt-settings recovery left onboarding unusable")) return false;
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
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(freshOnboardingScenario),
                                  "fresh-onboarding device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(onboardingSaveFailureScenario),
                                  "onboarding-save-failure device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(onboardingProfileSaveFailureScenario),
                                  "onboarding-profile-save-failure device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(resetSettingsSaveFailureScenario),
                                  "reset-settings-save-failure device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(displayInputSaveFailureScenario),
                                  "display-input-save-failure device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(persistedSimulateModeScenario),
                                  "persisted-simulate-mode device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(captureDisabledSimulateModeScenario),
                                  "capture-disabled-simulate-mode device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(capturePreferenceSaveFailureScenario),
                                  "capture-preference-save-failure device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(spectrumSweepReadoutScenario),
                                  "spectrum-sweep-readout device-shell scenario failed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, runIsolated(corruptSettingsScenario),
                                  "corrupt-settings device-shell scenario failed");
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
