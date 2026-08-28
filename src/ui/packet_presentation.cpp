#include "lilyshark/ui/packet_presentation.h"

#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/reticulum_decoder.h"

#include <cstdint>
#include <limits>

namespace lilyshark {

const char *packetKindLabel(const DecodedPacket &packet) noexcept
{
    if (packet.state == DecodeState::Malformed) {
        return "BAD";
    }

    if (packet.protocol == ProtocolId::MeshCore) {
        if (MeshCoreDecoder::payloadVersion(packet) != 0U) {
            return "UNSUP";
        }

        const std::uint8_t payload_type =
            static_cast<std::uint8_t>(MeshCoreDecoder::payloadType(packet));
        if (payload_type >= 12U && payload_type <= 14U) {
            return "RSVD";
        }

        switch (MeshCoreDecoder::payloadType(packet)) {
        case MeshCorePayloadType::Request:
            return "REQ";
        case MeshCorePayloadType::Response:
            return "RESP";
        case MeshCorePayloadType::TextMessage:
            return "TEXT";
        case MeshCorePayloadType::Acknowledgement:
            return "ACK";
        case MeshCorePayloadType::Advertisement:
            return "ADV";
        case MeshCorePayloadType::GroupText:
            return "GTXT";
        case MeshCorePayloadType::GroupData:
            return "GDATA";
        case MeshCorePayloadType::AnonymousRequest:
            return "ANON";
        case MeshCorePayloadType::ReturnedPath:
            return "PATH";
        case MeshCorePayloadType::Trace:
            return "TRACE";
        case MeshCorePayloadType::Multipart:
            return "MULTI";
        case MeshCorePayloadType::Control:
            return "CTRL";
        case MeshCorePayloadType::RawCustom:
            return "RAW";
        }
    }

    if (packet.protocol == ProtocolId::Reticulum) {
        if (ReticulumDecoder::isRNodeSplitFrame(packet)) {
            return "SPLIT";
        }
        if (ReticulumDecoder::isIfacProtected(packet)) {
            return "IFAC";
        }

        switch (ReticulumDecoder::packetType(packet)) {
        case ReticulumPacketType::Announce:
            return "ANN";
        case ReticulumPacketType::LinkRequest:
            return "LINK";
        case ReticulumPacketType::Proof:
            return "PROOF";
        case ReticulumPacketType::Data:
            return "DATA";
        }
    }

    if (packet.protocol == ProtocolId::Meshtastic && packet.application_port != 0) {
        switch (packet.application_port) {
        case 1: return "TEXT";
        case 3: return "POS";
        case 4: return "NODE";
        case 5: return "ROUTE";
        case 67: return "TELE";
        case 70: return "TRACE";
        case 71: return "NBR";
        default: break;
        }
    }

    switch (packet.kind) {
    case PacketKind::EncryptedPayload:
        return "ENC";
    case PacketKind::Data:
        return "DATA";
    case PacketKind::Control:
        return "CTRL";
    case PacketKind::Advertisement:
        return "ADV";
    case PacketKind::OpaquePayload:
        return packet.protocol == ProtocolId::Meshtastic ? "ENC" : "OPAQUE";
    case PacketKind::Unknown:
    default:
        return "RAW";
    }
}

const char *decodeStateLabel(DecodeState state) noexcept
{
    switch (state) {
    case DecodeState::HeaderOnly:
        return "HEADER";
    case DecodeState::PayloadDecoded:
        return "DECODED";
    case DecodeState::Malformed:
        return "MALFORMED";
    case DecodeState::Unknown:
    default:
        return "RAW";
    }
}

bool contributesToNodeSummary(const FrameRecord &record) noexcept
{
    return record.raw.rf.crc != CrcStatus::Invalid &&
           record.decoded.state != DecodeState::Malformed &&
           record.decoded.hasField(FieldSource) && record.decoded.source != 0U;
}

bool contributesToExistingNodeCrcErrors(const FrameRecord &record, bool identity_established,
                                        ProtocolId protocol, std::uint32_t source) noexcept
{
    return identity_established && record.raw.rf.crc == CrcStatus::Invalid &&
           record.decoded.state != DecodeState::Malformed &&
           record.decoded.hasField(FieldSource) && record.decoded.source != 0U &&
           record.decoded.protocol == protocol && record.decoded.source == source;
}

std::uint16_t incrementedNodeCrcErrorCount(std::uint16_t current) noexcept
{
    return current == std::numeric_limits<std::uint16_t>::max()
               ? current
               : static_cast<std::uint16_t>(current + 1U);
}

} // namespace lilyshark
