#pragma once

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kAppSettingsV1Size = 16U;
inline constexpr std::uint8_t kAppSettingsSchemaVersion = 1U;
inline constexpr std::uint8_t kAppSettingsOnboardingVersion = 1U;
inline constexpr std::uint8_t kAppSettingsMaximumDisplayBrightness = 16U;
inline constexpr std::uint8_t kAppSettingsMaximumPrimaryDiagnosticIndex = 8U;

struct AppSettings {
    std::uint8_t onboarding_version = 0U;
    bool onboarding_complete = false;
    // Full brightness out of the box: the 2.8" panel is dim enough at 12/16
    // that first-boot text read as washed out on hardware. Users who want a
    // dimmer panel turn it down; nobody should have to hunt for a setting to
    // make the first screen readable.
    std::uint8_t display_brightness = 16U;
    std::uint8_t keyboard_brightness = 96U;
    bool capture_enabled = true;
    bool gps_enabled = true;
    bool resume_last_view = false;
    std::uint8_t last_primary_diagnostic_index = 0U;
    bool spectrum_warning_acknowledged = false;
    /// Simulate mode: synthesise mesh traffic on the device instead of waiting
    /// for a radio. Off by default, and always announced in the UI while on —
    /// a capture made in simulate mode must never look like one off the air.
    bool simulate_mode = false;
};

enum class AppSettingsDecodeResult : std::uint8_t {
    Invalid = 0,
    LoadedV1,
};

[[nodiscard]] AppSettings defaultAppSettings() noexcept;
[[nodiscard]] bool isValidAppSettings(const AppSettings &settings) noexcept;

// Encodes the complete version 1 settings record. The output is unchanged when
// the destination or settings are invalid.
[[nodiscard]] bool encodeAppSettingsV1(const AppSettings &settings,
                                       std::uint8_t *bytes,
                                       std::size_t size) noexcept;

// Decodes only the exact version 1 record. Magic, flags, reserved bytes,
// settings ranges, and CRC-32 must all be valid. The output is unchanged on
// failure.
[[nodiscard]] AppSettingsDecodeResult decodeAppSettings(
    const std::uint8_t *bytes, std::size_t size, AppSettings &settings) noexcept;

} // namespace lilyshark
