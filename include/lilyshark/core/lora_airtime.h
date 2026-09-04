#pragma once

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Time on air for one LoRa packet, in microseconds.
///
/// This is the SX1268 datasheet v1.1 section 6.1.4 formula, transcribed from
/// RadioLib's `SX126x::calculateTimeOnAir` including its integer rounding. The
/// transcription is deliberate and must stay exact: received frames used to
/// get their airtime from RadioLib and transmitted frames got none at all, so
/// the moment this deck started counting its own transmissions there were two
/// possible rulers for one number on one screen. A utilization percentage that
/// mixes two rulers is worse than no percentage, so there is now one ruler,
/// and it lives here where a host test can check it without a radio attached.
///
/// Returns 0 when an input makes the formula meaningless (no bandwidth, no
/// coding rate, spreading factor outside the SX1262's range). Callers must
/// treat 0 as "not computed" and leave `RfFieldAirtime` clear rather than
/// recording a zero: absent is not zero, and an airtime of zero on a frame
/// that plainly occupied the channel is a number an operator would act on.
std::uint32_t loraTimeOnAirUs(std::uint8_t spreading_factor, std::uint32_t bandwidth_hz,
                              std::uint8_t coding_rate_denominator,
                              std::uint16_t preamble_symbols, bool implicit_header,
                              bool crc_enabled, std::size_t payload_bytes) noexcept;

/// Whether the SX1262 applies low-data-rate optimization at this setting.
/// RadioLib's caller decides this from the symbol length, not from the profile,
/// and the threshold participates in the airtime above, so it is exposed for
/// tests rather than duplicated at each call site.
bool loraLowDataRateOptimized(std::uint8_t spreading_factor,
                              std::uint32_t bandwidth_hz) noexcept;

} // namespace lilyshark
