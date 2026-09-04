#pragma once

/// The protobuf conversation a Meshtastic phone app holds over BLE.
///
/// After connecting, the app writes ToRadio{want_config_id: nonce} and then
/// reads FromRadio until it sees config_complete_id echo that nonce. What it
/// reads in between -- node number, names, node list, channel, radio config --
/// is everything it will ever display about this device, so an incomplete
/// dump is not a smaller feature set, it is an app stuck on "configuring".
///
/// Field numbers below are taken from meshtastic/protobufs master
/// (mesh.proto, config.proto, channel.proto), fetched 2026-09-01, not from
/// memory: memory said T_DECK was 61 and the protobufs say 50.
///
/// Everything here is pure encode/parse over caller buffers -- no heap, no
/// globals -- so it runs identically on the deck and in host tests.

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// One row of the node list handed to the phone. `label` is whatever the
/// deck knows the node as -- a claimed short name or the hex fallback.
/// Meshtastic's own limit on a channel name.
inline constexpr std::size_t kApiChannelNameCapacity = 12U;

struct ApiNodeEntry {
    std::uint32_t num = 0;
    char label[12]{};
    bool is_self = false;
    bool has_snr = false;
    std::int16_t snr_x10 = 0;
    /// Coordinates in Meshtastic's own unit, 1e-7 degrees. Only written to
    /// the phone when has_position is set -- zero is the equator, not absent.
    bool has_position = false;
    std::int32_t latitude_i = 0;
    std::int32_t longitude_i = 0;
};

/// A message the phone wrote to ToRadio, reduced to what the deck acts on.
struct ApiToRadio {
    enum class Kind : std::uint8_t {
        /// Parsed fine but nothing we act on (heartbeat, unknown ports).
        None,
        /// Begin the config dump, echoing `want_config_id` at the end.
        WantConfig,
        /// The app is leaving; nothing to do, but named so callers can log it.
        Disconnect,
        /// A text message to put on the air.
        Text,
        /// The phone told us where IT is. The deck's own GPS is a patch
        /// antenna indoors and a phone's is not, so this is usually the
        /// better fix -- and it is what Meshtastic's own app already sends.
        Position,
    } kind = Kind::None;
    std::uint32_t want_config_id = 0;
    std::uint32_t to_node = 0xffffffffU;
    /// Which channel the phone chose, as an index into the config dump's
    /// channel list. 0 is the primary -- the default-PSK channel every
    /// Meshtastic radio shares -- and higher indices are this deck's own
    /// stored keys, in slot order.
    ///
    /// The phone picks a channel by INDEX and never holds the key: the deck
    /// has it, and the deck does the sealing. That is deliberately unlike
    /// stock Meshtastic, where the app carries the PSK. A key that never
    /// leaves the radio cannot leak from a phone.
    std::uint32_t channel = 0;
    /// The id the phone stamped on its own packet. The app shows "Sending..."
    /// until a Routing result names this id, so it must survive the parse.
    std::uint32_t packet_id = 0;
    bool want_ack = false;
    /// Meshtastic texts are at most 237 bytes on the wire; NUL-terminated.
    char text[238]{};
    /// Set only for Kind::Position, in Meshtastic's 1e-7 degree units.
    /// 0,0 never arrives here: the parser rejects it as "no fix" rather than
    /// placing an unfixed phone in the Gulf of Guinea.
    std::int32_t latitude_i = 0;
    std::int32_t longitude_i = 0;
};

/// Parse one ToRadio protobuf. Returns false only for malformed bytes; a
/// well-formed message the deck does not act on parses true with Kind::None.
bool parseApiToRadio(const std::uint8_t *bytes, std::size_t length,
                     ApiToRadio &out) noexcept;

/// Encode message `index` of the config dump into `out`; returns the number
/// of bytes written, or 0 once the sequence is finished. The sequence is:
/// my_info, metadata, one node_info per entry, the primary channel, the LoRa
/// config, then config_complete_id echoing `config_id`. Pure function of its
/// arguments, so the caller can retry an index when its queue is full.
///
/// `firmware_version` is what the phone displays and gates features on; the
/// nodes array must put the deck itself first with is_self set.
/// One channel the deck can seal on, as the phone should see it.
///
/// Carries the NAME and not the key. The phone selects a channel by its index
/// in this list and the deck does the sealing, so a key never leaves the
/// radio. Stock Meshtastic puts the PSK in this message; we do not, because
/// the phone gains nothing from holding one and a phone is a much easier
/// thing to lose than a deck.
struct ApiChannelEntry {
    char name[kApiChannelNameCapacity]{};
    /// True for index 0, the shared default-PSK channel every Meshtastic
    /// radio listens on. False for this deck's own stored keys.
    bool is_default = false;
};

std::size_t encodeApiConfigMessage(std::size_t index, std::uint32_t config_id,
                                   const char *firmware_version,
                                   const ApiNodeEntry *nodes, std::size_t node_count,
                                   const ApiChannelEntry *channels,
                                   std::size_t channel_count,
                                   std::uint8_t *out, std::size_t capacity) noexcept;

/// What the deck can say about its own health, as Meshtastic's DeviceMetrics.
///
/// A phone in a pocket cannot see the radio in a bag, and "is it about to die"
/// is the question an operator asks most often about hardware they cannot
/// look at. Every field is optional because a deck running from USB has no
/// battery reading to give, and inventing 100% would be worse than silence.
struct ApiDeviceMetrics {
    bool has_battery = false;
    /// 0-100. Meshtastic reserves values above 100 for "plugged in"; this
    /// sends 101 for that, which is what its own firmware does.
    std::uint32_t battery_level = 0;
    bool has_voltage = false;
    float voltage = 0.0f;
    bool has_uptime = false;
    std::uint32_t uptime_seconds = 0;
};

/// Encode FromRadio{packet} carrying this deck's own telemetry, addressed to
/// the phone. Returns bytes written, or 0 if nothing is known worth sending.
std::size_t encodeApiDeviceTelemetry(std::uint32_t packet_id,
                                     const ApiDeviceMetrics &metrics,
                                     std::uint8_t *out,
                                     std::size_t capacity) noexcept;

/// Encode one FromRadio{node_info} on its own, for the node that just
/// appeared. The config dump tells the phone who was here at connect time;
/// this is how it learns about everyone who arrives afterwards.
std::size_t encodeApiNodeInfo(const ApiNodeEntry &node, std::uint8_t *out,
                              std::size_t capacity) noexcept;

/// Encode the Routing result the app waits for after writing a packet: an
/// empty error (0) marks its message sent, anything else marks it failed.
/// Without this the app shows "Sending..." forever, because that is the
/// contract -- the radio, not the phone, decides when a message has left.
std::size_t encodeApiRoutingAck(std::uint32_t local_node,
                                std::uint32_t acked_packet_id,
                                std::uint8_t error_reason,
                                std::uint8_t *out, std::size_t capacity) noexcept;

/// Encode FromRadio{packet} carrying a position heard on the mesh, so the
/// phone's map places the node. Coordinates in 1e-7 degrees.
std::size_t encodeApiPositionPacket(std::uint32_t from_node, std::uint32_t packet_id,
                                    std::int32_t latitude_i, std::int32_t longitude_i,
                                    std::int16_t rssi_x10, std::int16_t snr_x10,
                                    std::uint8_t *out, std::size_t capacity) noexcept;

/// Encode FromRadio{packet} carrying a text heard on the mesh, so the phone
/// shows it in the right conversation. `to_node` distinguishes broadcast from
/// a DM; rssi/snr ride along the way stock firmware reports them.
std::size_t encodeApiTextPacket(std::uint32_t from_node, std::uint32_t to_node,
                                std::uint32_t packet_id, const char *text,
                                std::int16_t rssi_x10, std::int16_t snr_x10,
                                std::uint8_t *out, std::size_t capacity) noexcept;

} // namespace lilyshark
