#include "lilyshark/device/hardware_status.h"

#if defined(LILYSHARK_DEVICE)

#include "lilyshark/tdeck.h"

#include <cstdio>

namespace lilyshark {

TDeckHardwareStatus::TDeckHardwareStatus(HardwareSerial &gps_serial) noexcept
    : gps_serial_(gps_serial)
{
    snapshot_.gps.parser_available = LILYSHARK_HAS_TINYGPSPLUS != 0;
}

void TDeckHardwareStatus::begin(bool enable_gps) noexcept
{
    analogReadResolution(12);
    analogSetPinAttenuation(tdeck::battery_adc_pin, ADC_11db);

    gps_enabled_ = enable_gps;
    snapshot_.gps.state = gps_enabled_ ? GpsState::Absent : GpsState::Disabled;
    if (gps_enabled_) {
        gps_serial_.begin(tdeck::gps_baud, SERIAL_8N1, tdeck::gps_rx_pin, tdeck::gps_tx_pin);
    }

    const std::uint32_t now_ms = millis();
    sampleBattery(now_ms);
    pollGps(now_ms);
    snapshot_.updated_at_ms = now_ms;
    refreshLabels();
}

void TDeckHardwareStatus::sampleBattery(std::uint32_t now_ms) noexcept
{
    const std::uint32_t sample_mv = analogReadMilliVolts(tdeck::battery_adc_pin);
    battery_samples_[battery_sample_index_] = sample_mv;
    battery_sample_index_ = static_cast<std::uint8_t>((battery_sample_index_ + 1U) % battery_window_size_);
    if (battery_sample_count_ < battery_window_size_) {
        ++battery_sample_count_;
    }

    std::uint32_t sum_mv = 0;
    for (std::uint8_t index = 0; index < battery_sample_count_; ++index) {
        sum_mv += battery_samples_[index];
    }
    const std::uint32_t average_mv = battery_sample_count_ == 0 ? 0 : sum_mv / battery_sample_count_;
    snapshot_.battery = estimateBattery(average_mv, tdeck::battery_divider_multiplier);
    last_battery_sample_ms_ = now_ms;
}

void TDeckHardwareStatus::pollGps(std::uint32_t now_ms) noexcept
{
    if (!gps_enabled_) {
        snapshot_.gps.state = GpsState::Disabled;
        snapshot_.gps.receiver_detected = false;
        snapshot_.gps.position_valid = false;
        snapshot_.gps.last_sentence_age_ms = UINT32_MAX;
        return;
    }

#if LILYSHARK_HAS_TINYGPSPLUS
    // Bound work per UI tick even if the UART receive buffer has accumulated.
    std::uint16_t consumed = 0;
    while (gps_serial_.available() > 0 && consumed < 256U) {
        gps_parser_.encode(static_cast<char>(gps_serial_.read()));
        ++consumed;
    }

    const std::uint32_t passed_checksums = gps_parser_.passedChecksum();
    if (passed_checksums != last_passed_checksum_count_) {
        last_passed_checksum_count_ = passed_checksums;
        last_valid_sentence_ms_ = now_ms;
        gps_receiver_seen_ = true;
    }

    const bool receiver_active = gps_receiver_seen_ &&
                                 static_cast<std::uint32_t>(now_ms - last_valid_sentence_ms_) <=
                                     gps_receiver_timeout_ms_;
    snapshot_.gps.receiver_detected = receiver_active;
    snapshot_.gps.last_sentence_age_ms = gps_receiver_seen_
                                             ? static_cast<std::uint32_t>(now_ms - last_valid_sentence_ms_)
                                             : UINT32_MAX;

    const bool fix_is_fresh = receiver_active && gps_parser_.location.isValid() &&
                              gps_parser_.location.age() <= gps_fix_stale_ms_;
    snapshot_.gps.position_valid = fix_is_fresh;
    if (!receiver_active) {
        snapshot_.gps.state = GpsState::Absent;
    } else if (!fix_is_fresh) {
        snapshot_.gps.state = GpsState::Searching;
    } else {
        snapshot_.gps.state = GpsState::Fix;
        snapshot_.gps.latitude_degrees = gps_parser_.location.lat();
        snapshot_.gps.longitude_degrees = gps_parser_.location.lng();
        if (gps_parser_.altitude.isValid()) {
            snapshot_.gps.altitude_meters = static_cast<float>(gps_parser_.altitude.meters());
        }
    }

    if (receiver_active) {
        snapshot_.gps.satellites = gps_parser_.satellites.isValid()
                                       ? static_cast<std::uint8_t>(gps_parser_.satellites.value() > 255U
                                                                       ? 255U
                                                                       : gps_parser_.satellites.value())
                                       : 0;
        snapshot_.gps.hdop = gps_parser_.hdop.isValid() ? static_cast<float>(gps_parser_.hdop.hdop()) : 0.0F;
    } else {
        snapshot_.gps.satellites = 0;
        snapshot_.gps.hdop = 0.0F;
    }
#else
    snapshot_.gps.state = GpsState::Absent;
    snapshot_.gps.receiver_detected = false;
    snapshot_.gps.position_valid = false;
    snapshot_.gps.last_sentence_age_ms = UINT32_MAX;
#endif
}

void TDeckHardwareStatus::refreshLabels() noexcept
{
    if (snapshot_.battery.present) {
        std::snprintf(snapshot_.battery_label, sizeof(snapshot_.battery_label), "BAT %u%%",
                      static_cast<unsigned>(snapshot_.battery.approximate_percent));
    } else {
        std::snprintf(snapshot_.battery_label, sizeof(snapshot_.battery_label), "BAT --");
    }

    switch (snapshot_.gps.state) {
    case GpsState::Disabled:
        std::snprintf(snapshot_.gps_label, sizeof(snapshot_.gps_label), "GPS OFF");
        break;
    case GpsState::Absent:
        std::snprintf(snapshot_.gps_label, sizeof(snapshot_.gps_label), "GPS N/A");
        break;
    case GpsState::Searching:
        std::snprintf(snapshot_.gps_label, sizeof(snapshot_.gps_label), "GPS SEARCH");
        break;
    case GpsState::Fix:
        if (snapshot_.gps.satellites > 0) {
            std::snprintf(snapshot_.gps_label, sizeof(snapshot_.gps_label), "GPS FIX %u",
                          static_cast<unsigned>(snapshot_.gps.satellites));
        } else {
            std::snprintf(snapshot_.gps_label, sizeof(snapshot_.gps_label), "GPS FIX");
        }
        break;
    }
}

void TDeckHardwareStatus::poll() noexcept
{
    const std::uint32_t now_ms = millis();
    if (static_cast<std::uint32_t>(now_ms - last_battery_sample_ms_) >= battery_sample_period_ms_) {
        sampleBattery(now_ms);
    }
    pollGps(now_ms);
    snapshot_.updated_at_ms = now_ms;
    refreshLabels();
}

} // namespace lilyshark

#endif
