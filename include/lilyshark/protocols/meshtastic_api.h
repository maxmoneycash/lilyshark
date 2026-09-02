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
struct ApiNodeEntry {
    std::uint32_t num = 0;
    char label[12]{};
    bool is_self = false;
    bool has_snr = false;
    std::int16_t snr_x10 = 0;
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
    } kind = Kind::None;
    std::uint32_t want_config_id = 0;
    std::uint32_t to_node = 0xffffffffU;
    bool want_ack = false;
    /// Meshtastic texts are at most 237 bytes on the wire; NUL-terminated.
    char text[238]{};
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
std::size_t encodeApiConfigMessage(std::size_t index, std::uint32_t config_id,
                                   const char *firmware_version,
                                   const ApiNodeEntry *nodes, std::size_t node_count,
                                   std::uint8_t *out, std::size_t capacity) noexcept;

/// Encode one FromRadio{node_info} on its own, for the node that just
/// appeared. The config dump tells the phone who was here at connect time;
/// this is how it learns about everyone who arrives afterwards.
std::size_t encodeApiNodeInfo(const ApiNodeEntry &node, std::uint8_t *out,
                              std::size_t capacity) noexcept;

/// Encode FromRadio{packet} carrying a text heard on the mesh, so the phone
/// shows it in the right conversation. `to_node` distinguishes broadcast from
/// a DM; rssi/snr ride along the way stock firmware reports them.
std::size_t encodeApiTextPacket(std::uint32_t from_node, std::uint32_t to_node,
                                std::uint32_t packet_id, const char *text,
                                std::int16_t rssi_x10, std::int16_t snr_x10,
                                std::uint8_t *out, std::size_t capacity) noexcept;

} // namespace lilyshark
