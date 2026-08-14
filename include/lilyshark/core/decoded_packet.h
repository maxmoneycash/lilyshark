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
};

enum DecodedField : std::uint32_t {
    FieldNone = 0,
    FieldSource = 1U << 0,
    FieldDestination = 1U << 1,
    FieldPacketId = 1U << 2,
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
