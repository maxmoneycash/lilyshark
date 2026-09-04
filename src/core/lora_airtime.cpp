#include "lilyshark/core/lora_airtime.h"

namespace lilyshark {

namespace {

/// The SX1262 supports SF5..SF12. Anything else is a caller bug or an
/// uninitialised profile, and shifting by it would be undefined behaviour
/// rather than a wrong answer.
constexpr std::uint8_t kMinimumSpreadingFactor = 5;
constexpr std::uint8_t kMaximumSpreadingFactor = 12;

/// One symbol, in microseconds. RadioLib scales the numerator by ten and the
/// bandwidth by ten so the ratio stays in integer range for SF12 at 7.8 kHz;
/// the tenfold on both sides cancels. Kept in that exact shape because the
/// truncation to integer microseconds here is what the rest of the formula is
/// built on, and rounding it differently moves every airtime by a symbol.
std::uint32_t symbolLengthUs(std::uint8_t spreading_factor, std::uint32_t bandwidth_hz) noexcept
{
    const float bandwidth_khz = static_cast<float>(bandwidth_hz) / 1000.0F;
    return static_cast<std::uint32_t>(
        static_cast<float>(static_cast<std::uint32_t>(1000 * 10) << spreading_factor) /
        (bandwidth_khz * 10.0F));
}

} // namespace

bool loraLowDataRateOptimized(std::uint8_t spreading_factor, std::uint32_t bandwidth_hz) noexcept
{
    if (bandwidth_hz == 0U || spreading_factor < kMinimumSpreadingFactor ||
        spreading_factor > kMaximumSpreadingFactor) {
        return false;
    }
    // A symbol at or above 16 ms is the threshold RadioLib's callers use, and
    // it is the one the receive path has always used here.
    const float symbol_length_ms = static_cast<float>(std::uint32_t{1} << spreading_factor) /
                                   (static_cast<float>(bandwidth_hz) / 1000.0F);
    return symbol_length_ms >= 16.0F;
}

std::uint32_t loraTimeOnAirUs(std::uint8_t spreading_factor, std::uint32_t bandwidth_hz,
                              std::uint8_t coding_rate_denominator,
                              std::uint16_t preamble_symbols, bool implicit_header,
                              bool crc_enabled, std::size_t payload_bytes) noexcept
{
    if (bandwidth_hz == 0U || coding_rate_denominator == 0U ||
        spreading_factor < kMinimumSpreadingFactor ||
        spreading_factor > kMaximumSpreadingFactor) {
        return 0U;
    }

    const std::uint32_t symbol_length_us = symbolLengthUs(spreading_factor, bandwidth_hz);
    if (symbol_length_us == 0U) {
        return 0U;
    }

    // Constants carrying a quarter are held times four, as RadioLib does, so
    // the whole computation stays in integers.
    std::uint8_t sf_coeff1_x4 = 17; // 4.25 * 4
    std::uint8_t sf_coeff2 = 8;
    if (spreading_factor == 5 || spreading_factor == 6) {
        sf_coeff1_x4 = 25; // 6.25 * 4
        sf_coeff2 = 0;
    }

    std::uint8_t sf_divisor = static_cast<std::uint8_t>(4 * spreading_factor);
    if (loraLowDataRateOptimized(spreading_factor, bandwidth_hz)) {
        sf_divisor = static_cast<std::uint8_t>(4 * (spreading_factor - 2));
    }

    constexpr std::int32_t kBitsPerCrc = 16;
    const std::int32_t header_symbols = implicit_header ? 0 : 20;

    // RadioLib accumulates this in an int16_t, which it would overflow past
    // roughly 4 kB of payload. LoRa tops out at 255 bytes, so a wider
    // accumulator gives the same answer for everything a radio can carry and
    // cannot trap on the way there.
    std::int32_t bit_count = 8 * static_cast<std::int32_t>(payload_bytes) +
                             (crc_enabled ? kBitsPerCrc : 0) -
                             4 * static_cast<std::int32_t>(spreading_factor) +
                             static_cast<std::int32_t>(sf_coeff2) + header_symbols;
    if (bit_count < 0) {
        bit_count = 0;
    }

    // Adding divisor-1 before the division is the integer ceiling.
    const std::uint16_t coded_symbols = static_cast<std::uint16_t>(
        (static_cast<std::uint32_t>(bit_count) + (sf_divisor - 1U)) / sf_divisor);

    // A preamble may be 65k symbols, so the quarter-symbol accumulator has to
    // be 32-bit even though every other term here is small.
    const std::uint32_t symbols_x4 =
        (static_cast<std::uint32_t>(preamble_symbols) + 8U) * 4U + sf_coeff1_x4 +
        static_cast<std::uint32_t>(coded_symbols) * coding_rate_denominator * 4U;

    return (symbol_length_us * symbols_x4) / 4U;
}

} // namespace lilyshark
