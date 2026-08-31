#pragma once

#include "lilyshark/device/battery_model.h"

#include <cstdint>

#if defined(LILYSHARK_DEVICE)

#include <Arduino.h>

#if __has_include(<TinyGPS++.h>)
#include <TinyGPS++.h>
#define LILYSHARK_HAS_TINYGPSPLUS 1
#else
#define LILYSHARK_HAS_TINYGPSPLUS 0
#endif

#endif

namespace lilyshark {

enum class GpsState : std::uint8_t {
    Disabled,
    Absent,
    Searching,
    Fix,
};

struct GpsStatus {
    GpsState state = GpsState::Absent;
    bool parser_available = false;
    bool receiver_detected = false;
    bool position_valid = false;
    // GPS-derived UTC wall clock — the witness sidecar's anchor source. Valid
    // only while fresh date+time sentences arrive; unix_time_seconds is the
    // unix time as of the most recent poll() call.
    bool time_valid = false;
    std::uint32_t unix_time_seconds = 0;
    double latitude_degrees = 0.0;
    double longitude_degrees = 0.0;
    float altitude_meters = 0.0F;
    float hdop = 0.0F;
    std::uint8_t satellites = 0;
    std::uint32_t last_sentence_age_ms = UINT32_MAX;
};

struct HardwareStatusSnapshot {
    BatteryEstimate battery{};
    GpsStatus gps{};
    std::uint32_t updated_at_ms = 0;
    char battery_label[16] = "BAT --";
    char gps_label[16] = "GPS N/A";
};

#if defined(LILYSHARK_DEVICE)

// Samples the T-Deck battery divider and, when enabled, probes an optional
// external NMEA GPS on Serial1. The original T-Deck has no onboard GPS, so a
// silent serial port remains explicitly Absent rather than claiming a lock.
class TDeckHardwareStatus
{
  public:
    explicit TDeckHardwareStatus(HardwareSerial &gps_serial = Serial1) noexcept;

    void begin(bool enable_gps = true) noexcept;
    void poll() noexcept;

    const HardwareStatusSnapshot &snapshot() const noexcept { return snapshot_; }
    bool gpsEnabled() const noexcept { return gps_enabled_; }

  private:
    static constexpr std::uint32_t battery_sample_period_ms_ = 2000;
    static constexpr std::uint32_t gps_receiver_timeout_ms_ = 15000;
    static constexpr std::uint32_t gps_fix_stale_ms_ = 10000;
    static constexpr std::uint8_t battery_window_size_ = 8;

    void sampleBattery(std::uint32_t now_ms) noexcept;
    void pollGps(std::uint32_t now_ms) noexcept;
    void refreshLabels() noexcept;
    void startGpsUart() noexcept;
    void configureGpsReceiver() noexcept;

    HardwareSerial &gps_serial_;
#if LILYSHARK_HAS_TINYGPSPLUS
    TinyGPSPlus gps_parser_{};
#endif
    HardwareStatusSnapshot snapshot_{};
    std::uint32_t battery_samples_[battery_window_size_]{};
    std::uint32_t last_battery_sample_ms_ = 0;
    std::uint32_t last_valid_sentence_ms_ = 0;
    std::uint32_t last_passed_checksum_count_ = 0;
    // Receivers ship at different default bauds (the T-Deck Plus's u-blox
    // M10Q talks 38400; L76K units talk 9600), so a fixed rate reads garbage
    // on half the hardware and reports "no receiver" for a module that is
    // right there. Until a valid sentence arrives, the poll walks this list.
    static constexpr std::uint32_t gps_baud_candidates_[4] = {9600, 38400, 115200, 4800};
    static constexpr std::uint32_t gps_baud_probe_window_ms_ = 2500;
    std::uint32_t gps_baud_started_ms_ = 0;
    std::uint8_t gps_baud_index_ = 0;
    std::uint8_t battery_sample_count_ = 0;
    std::uint8_t battery_sample_index_ = 0;
    bool gps_enabled_ = false;
    bool gps_receiver_seen_ = false;
    bool gps_configured_after_detect_ = false;
};

#endif

} // namespace lilyshark
