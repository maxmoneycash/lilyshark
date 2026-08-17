#pragma once

#include "lilyshark/protocols/meshtastic_payload.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Stable node number this firmware uses on Meshtastic LongFast until a
/// user-set identity exists. Non-zero so official radios do not drop it.
inline constexpr std::uint32_t kLilysharkMeshtasticNodeNum = 0x4c534b01U;

inline constexpr char kMeshtasticDefaultChannelName[] = "LongFast";

/// XOR hash Meshtastic puts in the outer header channel byte.
std::uint8_t meshtasticChannelHash(const char *name, const std::uint8_t *psk,
                                   std::size_t psk_length) noexcept;

struct MeshtasticEncodeRequest {
    std::uint32_t from_node = kLilysharkMeshtasticNodeNum;
    std::uint32_t to_node = 0xffffffffU;
    std::uint32_t packet_id = 1;
    std::uint8_t hop_limit = 3;
    MeshtasticPort port = MeshtasticPort::TextMessage;
    const char *text = nullptr;
    double latitude_degrees = 0.0;
    double longitude_degrees = 0.0;
    const char *long_name = "Lilyshark";
    const char *short_name = "LSK";
};

/// Build a native 16-byte header plus default-PSK ciphertext. Returns 0 if
/// the buffer is too small or the request is empty.
std::size_t encodeMeshtasticFrame(const MeshtasticEncodeRequest &request,
                                  std::uint8_t *out, std::size_t out_size) noexcept;

} // namespace lilyshark
