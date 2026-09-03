#pragma once

// Reading a Meshtastic payload under the public default key, then under the
// keys the operator entered on the device.
//
// Meshtastic ships every radio with the same well-known channel key, and the
// default LongFast channel uses it. Traffic on that channel is therefore
// readable by anyone within earshot — which is a fact worth showing plainly
// rather than a protection worth defeating. Nothing here attacks a cipher: it
// applies a published key, and gives up the moment the result fails to parse.
//
// After the default key, each stored channel key is tried in the order the
// operator listed them, mirroring webapp/src/lib/dissect/meshtastic.ts. The
// distinction matters and is preserved all the way to the screen: success
// under the default key proves the traffic was never private, while success
// under a stored key proves only that the operator knew the channel's secret.
//
// A channel with a real PSK that the operator has not entered stays opaque,
// exactly as it should.

#include "lilyshark/core/channel_key_provider.h"

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
    bool has_position = false;
    double latitude_degrees = 0.0;
    double longitude_degrees = 0.0;
    /// Telemetry a node reports about itself (port 67). Each flag says the
    /// field was actually present -- a peer that reports voltage but not
    /// battery percent is common, and showing 0% for it would be a lie.
    bool has_telemetry = false;
    bool has_battery_level = false;
    /// 0-100. Meshtastic sends values above 100 to mean externally powered.
    std::uint8_t battery_level = 0;
    bool has_voltage = false;
    float voltage = 0.0F;
    bool has_channel_utilization = false;
    float channel_utilization = 0.0F;
    bool has_air_util_tx = false;
    float air_util_tx = 0.0F;
    bool has_uptime = false;
    std::uint32_t uptime_seconds = 0;
    bool has_temperature = false;
    float temperature_c = 0.0F;
    bool has_relative_humidity = false;
    float relative_humidity = 0.0F;

    /// A Routing acknowledgement names the packet it confirms here.
    bool has_request_id = false;
    std::uint32_t request_id = 0;
    bool has_names = false;
    /// The sender's Curve25519 public key, when its NodeInfo carried one.
    /// This is what makes a private reply possible: without it, a direct
    /// message to this node can only go out under the channel key everybody
    /// already has.
    bool has_public_key = false;
    std::uint8_t public_key[32]{};
    char long_name[40]{};
    char short_name[8]{};
};

/// Which key read a payload. Never the key itself: `slot` is an index into the
/// operator's key list, so nothing downstream — a capture record, a screen, a
/// log line — can learn key material from a decode result.
enum class MeshtasticKeySource : std::uint8_t {
    /// Nothing read it. The payload stays opaque.
    None = 0,
    /// The published default channel key. The traffic was never private.
    DefaultKey,
    /// A key the operator stored on the device, identified by `slot`.
    StoredKey,
};

struct MeshtasticKeyState {
    MeshtasticKeySource source = MeshtasticKeySource::None;
    /// Provider index of the key that worked. Meaningful only when `source`
    /// is StoredKey.
    std::uint8_t slot = 0;
};

/// Short label for a port number, or "PORT n" when this build has no name.
const char *meshtasticPortLabel(std::uint16_t portnum) noexcept;

/// Parse an already-decrypted Data message — the same strict parse the
/// default-key path uses, for a payload that arrived under another lock.
bool parseMeshtasticData(const std::uint8_t *plain, std::size_t length,
                         MeshtasticPayload &out) noexcept;

/// Try to read `length` ciphertext bytes taken from immediately after the
/// 16-byte outer header, under the published default key only.
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

/// The same read, extended with the operator's stored channel keys.
///
/// The published default key is tried first — so passing a null or empty
/// provider is byte-for-byte the keyless behaviour above — and then each
/// stored key in the provider's order. The first plaintext that parses as a
/// Data message wins and `key_state` names the key that produced it. Failure
/// leaves both outputs untouched and the payload opaque: failing closed to
/// ciphertext is the honest result for a key nobody has.
bool readMeshtasticPayloadWithKeys(const std::uint8_t *ciphertext,
                                   std::size_t length,
                                   std::uint32_t from_node,
                                   std::uint32_t packet_id,
                                   const ChannelKeyProvider *keys,
                                   MeshtasticPayload &out,
                                   MeshtasticKeyState &key_state) noexcept;

} // namespace lilyshark
