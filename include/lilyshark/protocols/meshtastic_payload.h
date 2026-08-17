#pragma once

// Reading a Meshtastic payload that was sent under the public default key.
//
// Meshtastic ships every radio with the same well-known channel key, and the
// default LongFast channel uses it. Traffic on that channel is therefore
// readable by anyone within earshot — which is a fact worth showing plainly
// rather than a protection worth defeating. Nothing here attacks a cipher: it
// applies a published key, and gives up the moment the result fails to parse.
//
// A channel with a real PSK stays opaque, exactly as it should.

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// The published default channel key, shipped in every Meshtastic device
/// (Channels.h `defaultpsk`; the shorthand "AQ==" selects index 1, which is
/// this key unmodified).
inline constexpr std::uint8_t kMeshtasticDefaultPsk[16] = {
    0xd4, 0xf1, 0xbb, 0x3a, 0x20, 0x29, 0x07, 0x59,
    0xf0, 0xbc, 0xff, 0xab, 0xcf, 0x4e, 0x69, 0x01,
};

/// Meshtastic port numbers this build names. The rest decode fine and are
/// reported numerically — an analyzer should not hide a port it cannot name.
enum class MeshtasticPort : std::uint16_t {
    Unknown = 0,
    TextMessage = 1,
    Position = 3,
    NodeInfo = 4,
    Routing = 5,
    Telemetry = 67,
    Traceroute = 70,
    Neighborinfo = 71,
};

inline constexpr std::size_t kMeshtasticMaxTextBytes = 200;

struct MeshtasticPayload {
    /// True only when the decrypted bytes parsed as a well-formed message.
    bool readable = false;
    std::uint16_t portnum = 0;
    /// Length of the application payload inside the message.
    std::uint16_t payload_length = 0;
    /// Present only for a text message whose bytes are printable.
    bool has_text = false;
    std::uint16_t text_length = 0;
    char text[kMeshtasticMaxTextBytes + 1]{};
};

/// Short label for a port number, or "PORT n" when this build has no name.
const char *meshtasticPortLabel(std::uint16_t portnum) noexcept;

/// Try to read `length` ciphertext bytes taken from immediately after the
/// 16-byte outer header.
///
/// The nonce is rebuilt the way the firmware does — packet id as a 64-bit
/// little-endian value, then the sender's node number — so the caller passes
/// the two header fields rather than a nonce. Returns false, leaving `out`
/// untouched, whenever the plaintext does not parse: a wrong key produces
/// noise, and noise must never be presented as a message.
bool readMeshtasticPayload(const std::uint8_t *ciphertext,
                           std::size_t length,
                           std::uint32_t from_node,
                           std::uint32_t packet_id,
                           MeshtasticPayload &out) noexcept;

} // namespace lilyshark
