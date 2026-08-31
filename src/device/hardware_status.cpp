#include "lilyshark/device/hardware_status.h"

#if defined(LILYSHARK_DEVICE)

#include "lilyshark/tdeck.h"

#include <cstdio>
#include <cstring>

namespace lilyshark {
namespace {

#if LILYSHARK_HAS_TINYGPSPLUS
// Proleptic-Gregorian civil date to unix seconds (days-from-civil, Hinnant).
// GPS reports UTC, and unix time ignores leap seconds by definition, so no
// leap-second table is needed. Callers guard the year range.
std::uint64_t unixFromUtc(std::uint16_t year, std::uint8_t month, std::uint8_t day,
                          std::uint8_t hour, std::uint8_t minute, std::uint8_t second) noexcept
{
    const std::int64_t shifted_year = static_cast<std::int64_t>(year) - (month <= 2U ? 1 : 0);
    const std::int64_t era = shifted_year / 400;
    const std::int64_t year_of_era = shifted_year - era * 400;
    const std::int64_t day_of_year =
        (153 * (static_cast<std::int64_t>(month) + (month > 2U ? -3 : 9)) + 2) / 5 + day - 1;
    const std::int64_t day_of_era =
        year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    const std::int64_t days_since_epoch = era * 146097 + day_of_era - 719468;
    return static_cast<std::uint64_t>(days_since_epoch) * 86400ULL +
           static_cast<std::uint64_t>(hour) * 3600ULL +
           static_cast<std::uint64_t>(minute) * 60ULL + second;
}
#endif

} // namespace

TDeckHardwareStatus::TDeckHardwareStatus(HardwareSerial &gps_serial) noexcept
    : gps_serial_(gps_serial)
{
    snapshot_.gps.parser_available = LILYSHARK_HAS_TINYGPSPLUS != 0;
}

void TDeckHardwareStatus::begin(bool enable_gps) noexcept
{
    analogReadResolution(12);
    analogSetPinAttenuation(tdeck::battery_adc_pin, ADC_11db);

    // Reconfiguration starts a new GPS session. Drain before ending the UART
    // so bytes and parser state from a previous session cannot restore a stale
    // fix when GPS is enabled again.
    while (gps_serial_.available() > 0) {
        (void)gps_serial_.read();
    }
    gps_serial_.end();
#if LILYSHARK_HAS_TINYGPSPLUS
    gps_parser_ = TinyGPSPlus{};
#endif
    last_valid_sentence_ms_ = 0;
    last_passed_checksum_count_ = 0;
    gps_receiver_seen_ = false;
    gps_configured_after_detect_ = false;

    gps_enabled_ = enable_gps;
    snapshot_.gps = GpsStatus{};
    snapshot_.gps.parser_available = LILYSHARK_HAS_TINYGPSPLUS != 0;
    snapshot_.gps.state = gps_enabled_ ? GpsState::Absent : GpsState::Disabled;
    if (gps_enabled_) {
        gps_baud_index_ = 0;
        gps_baud_started_ms_ = millis();
        startGpsUart();
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

void TDeckHardwareStatus::startGpsUart() noexcept
{
    gps_serial_.setRxBufferSize(1024);
    gps_serial_.begin(gps_baud_candidates_[gps_baud_index_], SERIAL_8N1, tdeck::gps_rx_pin,
                      tdeck::gps_tx_pin);
    configureGpsReceiver();
}

void TDeckHardwareStatus::configureGpsReceiver() noexcept
{
    // LILYGO T-Deck GPSShield / T-Deck Plus bring-up. A listener-only UART
    // reports SEARCH forever when the module is still emitting TXT/GSV after
    // another firmware disabled GGA/RMC or left GNSS in a single-constellation
    // mode. These $PCAS commands are ignored by a u-blox M10Q; the UBX-CFG-MSG
    // frames are ignored by an L76K.
    static constexpr char kPcas04[] = "$PCAS04,5*1C\r\n";
    static constexpr char kPcas03[] = "$PCAS03,1,1,1,1,1,1,1,1,1,1,,,0,0*02\r\n";
    static constexpr char kPcas11[] = "$PCAS11,3*1E\r\n";
    gps_serial_.write(reinterpret_cast<const std::uint8_t *>(kPcas04), sizeof(kPcas04) - 1U);
    gps_serial_.write(reinterpret_cast<const std::uint8_t *>(kPcas03), sizeof(kPcas03) - 1U);
    gps_serial_.write(reinterpret_cast<const std::uint8_t *>(kPcas11), sizeof(kPcas11) - 1U);

    const auto write_ubx = [this](std::uint8_t msg_class, std::uint8_t msg_id,
                                  const std::uint8_t *payload, std::uint16_t payload_len) {
        std::uint8_t frame[16];
        if (payload_len + 8U > sizeof(frame)) {
            return;
        }
        frame[0] = 0xB5;
        frame[1] = 0x62;
        frame[2] = msg_class;
        frame[3] = msg_id;
        frame[4] = static_cast<std::uint8_t>(payload_len & 0xFFU);
        frame[5] = static_cast<std::uint8_t>((payload_len >> 8) & 0xFFU);
        if (payload_len > 0U) {
            std::memcpy(frame + 6, payload, payload_len);
        }
        std::uint8_t ck_a = 0;
        std::uint8_t ck_b = 0;
        for (std::uint16_t index = 2; index < static_cast<std::uint16_t>(6U + payload_len); ++index) {
            ck_a = static_cast<std::uint8_t>(ck_a + frame[index]);
            ck_b = static_cast<std::uint8_t>(ck_b + ck_a);
        }
        frame[6U + payload_len] = ck_a;
        frame[7U + payload_len] = ck_b;
        gps_serial_.write(frame, static_cast<std::size_t>(8U + payload_len));
    };

    // NMEA GGA / RMC on UART1 only. Do not send CFG-CFG — that wipes the
    // almanac and forces another cold start.
    const std::uint8_t gga_uart1[] = {0xF0, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00};
    const std::uint8_t rmc_uart1[] = {0xF0, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00};
    write_ubx(0x06, 0x01, gga_uart1, sizeof(gga_uart1));
    write_ubx(0x06, 0x01, rmc_uart1, sizeof(rmc_uart1));
}

void TDeckHardwareStatus::pollGps(std::uint32_t now_ms) noexcept
{
    if (!gps_enabled_) {
        snapshot_.gps.state = GpsState::Disabled;
        snapshot_.gps.receiver_detected = false;
        snapshot_.gps.position_valid = false;
        snapshot_.gps.time_valid = false;
        snapshot_.gps.unix_time_seconds = 0;
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
        if (!gps_configured_after_detect_) {
            configureGpsReceiver();
            gps_configured_after_detect_ = true;
        }
    }

    // No valid sentence yet: after a probe window, try the next baud. A wrong
    // rate turns real NMEA into bytes that never pass a checksum, so silence
    // here means "wrong speed" at least as often as "no module".
    if (!gps_receiver_seen_ &&
        static_cast<std::uint32_t>(now_ms - gps_baud_started_ms_) >= gps_baud_probe_window_ms_) {
        gps_baud_index_ = static_cast<std::uint8_t>(
            (gps_baud_index_ + 1U) %
            (sizeof(gps_baud_candidates_) / sizeof(gps_baud_candidates_[0])));
        gps_serial_.end();
        startGpsUart();
        gps_baud_started_ms_ = now_ms;
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

    // The wall clock rides RMC independently of the position fix, but a stale
    // or unset receiver clock (year before 2020: cold start, or week-number
    // rollover garbage) must never anchor witness keys.
    const bool time_is_fresh = receiver_active && gps_parser_.date.isValid() &&
                               gps_parser_.time.isValid() &&
                               gps_parser_.time.age() <= gps_fix_stale_ms_ &&
                               gps_parser_.date.year() >= 2020U;
    if (time_is_fresh) {
        const std::uint64_t sentence_unix =
            unixFromUtc(static_cast<std::uint16_t>(gps_parser_.date.year()),
                        static_cast<std::uint8_t>(gps_parser_.date.month()),
                        static_cast<std::uint8_t>(gps_parser_.date.day()),
                        static_cast<std::uint8_t>(gps_parser_.time.hour()),
                        static_cast<std::uint8_t>(gps_parser_.time.minute()),
                        static_cast<std::uint8_t>(gps_parser_.time.second()));
        snapshot_.gps.unix_time_seconds =
            static_cast<std::uint32_t>(sentence_unix + gps_parser_.time.age() / 1000U);
        snapshot_.gps.time_valid = true;
    } else {
        snapshot_.gps.time_valid = false;
        snapshot_.gps.unix_time_seconds = 0;
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
    snapshot_.gps.time_valid = false;
    snapshot_.gps.unix_time_seconds = 0;
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
