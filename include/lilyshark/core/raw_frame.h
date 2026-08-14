#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace lilyshark {

constexpr std::size_t kMaxFrameBytes = 255;

enum class Modulation : std::uint8_t {
    Unknown = 0,
    LoRa,
    Fsk,
};

enum class FrameDirection : std::uint8_t {
    Unknown = 0,
    Receive,
    Transmit,
};

enum class CrcStatus : std::uint8_t {
    Unknown = 0,
    NotPresent,
    Valid,
    Invalid,
};

enum RfField : std::uint32_t {
    RfFieldNone = 0,
    RfFieldTimestamp = 1U << 0,
    RfFieldFrequency = 1U << 1,
    RfFieldBandwidth = 1U << 2,
    RfFieldAirtime = 1U << 3,
    RfFieldFrequencyError = 1U << 4,
    RfFieldRssi = 1U << 5,
    RfFieldSnr = 1U << 6,
    RfFieldTxPower = 1U << 7,
    RfFieldPreamble = 1U << 8,
    RfFieldSyncWord = 1U << 9,
    RfFieldProfile = 1U << 10,
    RfFieldSpreadingFactor = 1U << 11,
    RfFieldCodingRate = 1U << 12,
    RfFieldChannel = 1U << 13,
    RfFieldRadioStatus = 1U << 14,
    RfFieldBitRate = 1U << 15,
    RfFieldFrequencyDeviation = 1U << 16,
};

// Integer units keep captures stable across desktop and embedded targets.
// RSSI and SNR use tenths of a decibel so the radio task never needs strings.
struct RfMetadata {
    // Monotonic microseconds since device boot. This is not Unix wall time.
    std::uint64_t timestamp_us = 0;
    std::uint32_t present_fields = RfFieldNone;
    std::uint32_t center_frequency_hz = 0;
    std::uint32_t bandwidth_hz = 0;
    std::uint32_t bit_rate_bps = 0;
    std::uint32_t frequency_deviation_hz = 0;
    std::uint32_t airtime_us = 0;
    std::int32_t frequency_error_hz = 0;
    std::int16_t rssi_dbm_x10 = 0;
    std::int16_t snr_db_x10 = 0;
    std::uint16_t preamble_symbols = 0;
    std::uint16_t sync_word = 0;
    std::uint16_t profile_id = 0;
    std::int16_t radio_status = 0;
    std::int8_t tx_power_dbm = 0;
    std::uint8_t spreading_factor = 0;
    std::uint8_t coding_rate_denominator = 0;
    std::uint8_t channel_index = 0;
    std::uint8_t radio_index = 0;
    Modulation modulation = Modulation::Unknown;
    FrameDirection direction = FrameDirection::Unknown;
    CrcStatus crc = CrcStatus::Unknown;
    bool implicit_header = false;
    bool inverted_iq = false;

    bool hasField(RfField field) const noexcept
    {
        return (present_fields & static_cast<std::uint32_t>(field)) != 0;
    }
};

struct RawFrame {
    RfMetadata rf{};
    std::uint16_t captured_length = 0;
    std::uint16_t original_length = 0;
    std::uint8_t bytes[kMaxFrameBytes]{};

    bool assignPayload(const std::uint8_t *data, std::size_t length) noexcept
    {
        constexpr std::size_t kMaxReportedLength = 0xffffU;
        original_length = static_cast<std::uint16_t>(length > kMaxReportedLength ? kMaxReportedLength : length);

        if (data == nullptr) {
            captured_length = 0;
            return length == 0;
        }

        const std::size_t copy_length = length > kMaxFrameBytes ? kMaxFrameBytes : length;
        if (copy_length != 0) {
            std::memcpy(bytes, data, copy_length);
        }
        captured_length = static_cast<std::uint16_t>(copy_length);
        return copy_length == length;
    }

    bool wasTruncated() const noexcept { return original_length > captured_length; }
};

} // namespace lilyshark
