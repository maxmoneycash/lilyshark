#pragma once

#include "lilyshark/core/protocol.h"
#include "lilyshark/core/raw_frame.h"

#include <cstdint>

namespace lilyshark {

enum class DecodeState : std::uint8_t {
    Unknown = 0,
    HeaderOnly,
    PayloadDecoded,
    Malformed,
};

enum class PacketKind : std::uint8_t {
    Unknown = 0,
    EncryptedPayload,
    Data,
    Control,
    Advertisement,
    // The payload bytes are present, but the active decoder cannot prove
    // whether they are cleartext, encrypted, or otherwise encoded.
    OpaquePayload,
};

enum DecodedField : std::uint32_t {
    FieldNone = 0,
    FieldSource = 1U << 0,
    FieldDestination = 1U << 1,
    FieldPacketId = 1U << 2,
    // Protocol-specific channel value. For Meshtastic this is the one-byte
    // channel hash/hint, not a radio-slot or channel-number index.
    FieldChannel = 1U << 3,
    FieldHopLimit = 1U << 4,
    FieldHopStart = 1U << 5,
    FieldNextHop = 1U << 6,
    FieldRelayNode = 1U << 7,
    FieldPayload = 1U << 8,
};

enum PacketAttribute : std::uint16_t {
    AttributeNone = 0,
    AttributeBroadcast = 1U << 0,
    AttributeAcknowledgementRequested = 1U << 1,
    AttributeViaMqtt = 1U << 2,
    AttributeEncrypted = 1U << 3,
    AttributeTruncated = 1U << 4,
    // The captured frame contains a complete, valid Shelby pointer. This is
    // secondary application metadata: the packet's protocol remains the
    // enclosing Meshtastic, MeshCore, Reticulum, or custom protocol.
    AttributeShelbyPointer = 1U << 5,
    // The payload was readable under a protocol's published default key —
    // no secret was needed and none was broken. Worth stating outright,
    // because it is the difference between traffic that merely looks
    // protected and traffic that is.
    AttributeDefaultKeyReadable = 1U << 6,
    // The payload was readable under a channel key the operator stored on the
    // device, named by `channel_key_slot`. Mutually exclusive with
    // AttributeDefaultKeyReadable, which is always tried first: this one
    // claims only that whoever runs the analyzer knew the channel's secret.
    AttributeStoredKeyReadable = 1U << 7,
};

struct DecodedPacket {
    ProtocolId protocol = ProtocolId::Unknown;
    DecodeState state = DecodeState::Unknown;
    PacketKind kind = PacketKind::Unknown;
    std::uint32_t present_fields = FieldNone;
    std::uint16_t attributes = AttributeNone;
    std::uint32_t source = 0;
    std::uint32_t destination = 0;
    std::uint32_t packet_id = 0;
    std::uint32_t protocol_flags = 0;
    std::uint16_t payload_offset = 0;
    std::uint16_t payload_length = 0;
    std::uint16_t channel = 0;
    // Application port inside a readable payload (Meshtastic portnum). Only
    // meaningful with AttributeDefaultKeyReadable; the text itself is not
    // kept here — it is read back from the stored frame on demand, so a
    // 64-frame buffer does not carry 64 message bodies.
    std::uint16_t application_port = 0;
    // Index of the stored channel key that read this payload, meaningful only
    // with AttributeStoredKeyReadable. An index, never key material: this
    // struct is copied into the frame store and shown on screen, so nothing
    // that could reconstruct a key is allowed to live here.
    std::uint8_t channel_key_slot = 0;
    std::uint8_t hop_limit = 0;
    std::uint8_t hop_start = 0;
    std::uint8_t next_hop = 0;
    std::uint8_t relay_node = 0;

    bool hasField(DecodedField field) const noexcept
    {
        return (present_fields & static_cast<std::uint32_t>(field)) != 0;
    }

    bool hasAttribute(PacketAttribute attribute) const noexcept
    {
        return (attributes & static_cast<std::uint16_t>(attribute)) != 0;
    }
};

inline DecodedPacket makeUnknownPacket(const RawFrame &frame) noexcept
{
    DecodedPacket packet{};
    packet.present_fields = FieldPayload;
    packet.payload_length = frame.captured_length;
    if (frame.wasTruncated()) {
        packet.attributes = AttributeTruncated;
    }
    return packet;
}

} // namespace lilyshark
