#include "lilyshark/protocols/meshcore_decoder.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace {

constexpr std::uint8_t kRouteMask = 0x03;
constexpr std::uint8_t kPayloadTypeMask = 0x0f;
constexpr std::uint8_t kPayloadTypeShift = 2;
constexpr std::uint8_t kVersionMask = 0x03;
constexpr std::uint8_t kVersionShift = 6;
constexpr std::uint8_t kPathCountMask = 0x3f;
constexpr std::uint8_t kPathSizeShift = 6;

std::uint16_t readLittleEndian16(const std::uint8_t *bytes) noexcept
{
    return static_cast<std::uint16_t>(bytes[0]) | (static_cast<std::uint16_t>(bytes[1]) << 8U);
}

std::uint32_t readLittleEndian32(const std::uint8_t *bytes) noexcept
{
    return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8U) |
           (static_cast<std::uint32_t>(bytes[2]) << 16U) | (static_cast<std::uint32_t>(bytes[3]) << 24U);
}

bool routeHasTransportCodes(std::uint8_t route) noexcept
{
    return route == static_cast<std::uint8_t>(MeshCoreRouteType::TransportFlood) ||
           route == static_cast<std::uint8_t>(MeshCoreRouteType::TransportDirect);
}

bool isDirectEncryptedType(std::uint8_t type) noexcept
{
    return type == static_cast<std::uint8_t>(MeshCorePayloadType::Request) ||
           type == static_cast<std::uint8_t>(MeshCorePayloadType::Response) ||
           type == static_cast<std::uint8_t>(MeshCorePayloadType::TextMessage) ||
           type == static_cast<std::uint8_t>(MeshCorePayloadType::ReturnedPath);
}

DecodeResult malformed(DecodedPacket &output) noexcept
{
    output.state = DecodeState::Malformed;
    return DecodeResult::Malformed;
}

} // namespace

DecodeResult MeshCoreDecoder::decode(const RawFrame &frame, const RadioProfile &profile,
                                     DecodedPacket &output) const noexcept
{
    if (profile.protocol_hint != ProtocolId::MeshCore) {
        return DecodeResult::NoMatch;
    }

    output = makeUnknownPacket(frame);
    output.protocol = ProtocolId::MeshCore;
    if (frame.captured_length < 1) {
        return malformed(output);
    }

    const std::uint8_t header = frame.bytes[0];
    const std::uint8_t route = header & kRouteMask;
    const std::uint8_t type = (header >> kPayloadTypeShift) & kPayloadTypeMask;
    const std::uint8_t version = (header >> kVersionShift) & kVersionMask;
    output.protocol_flags = header;

    // Only payload version 1 (encoded as zero) has a published layout. A
    // future-version frame is a protocol match, but parsing it as v1 would be
    // a false claim.
    if (version != 0) {
        if (frame.wasTruncated()) {
            return malformed(output);
        }
        output.state = DecodeState::HeaderOnly;
        return DecodeResult::Matched;
    }

    std::size_t cursor = 1;
    if (routeHasTransportCodes(route)) {
        if (frame.captured_length - cursor < 4) {
            return malformed(output);
        }
        output.source = readLittleEndian16(&frame.bytes[cursor]);
        output.destination = readLittleEndian16(&frame.bytes[cursor + 2]);
        cursor += 4;
    }

    if (cursor >= frame.captured_length) {
        return malformed(output);
    }

    const std::uint8_t encoded_path_length = frame.bytes[cursor++];
    output.protocol_flags |= static_cast<std::uint32_t>(encoded_path_length) << 8U;
    const std::size_t path_hash_count = encoded_path_length & kPathCountMask;
    const std::size_t path_hash_size = (encoded_path_length >> kPathSizeShift) + 1U;
    const std::size_t path_bytes = path_hash_count * path_hash_size;
    output.hop_limit = static_cast<std::uint8_t>(path_hash_count);
    output.hop_start = static_cast<std::uint8_t>(path_hash_size);

    if (path_hash_size == 4 || path_bytes > kMaxPathBytes || path_bytes > frame.captured_length - cursor) {
        return malformed(output);
    }
    cursor += path_bytes;

    if (cursor >= frame.captured_length) {
        return malformed(output);
    }

    const std::size_t payload_length = frame.captured_length - cursor;
    if (payload_length > kMaxPayloadBytes) {
        return malformed(output);
    }
    output.payload_offset = static_cast<std::uint16_t>(cursor);
    output.payload_length = static_cast<std::uint16_t>(payload_length);
    output.present_fields = FieldPayload;
    output.state = DecodeState::HeaderOnly;
    output.kind = PacketKind::Data;

    if (type == static_cast<std::uint8_t>(MeshCorePayloadType::Acknowledgement)) {
        if (payload_length < 4) {
            return malformed(output);
        }
        output.packet_id = readLittleEndian32(&frame.bytes[cursor]);
        output.kind = PacketKind::Control;
        output.state = DecodeState::PayloadDecoded;
    } else if (type == static_cast<std::uint8_t>(MeshCorePayloadType::Advertisement)) {
        if (payload_length < kAdvertMinimumPayloadBytes) {
            return malformed(output);
        }
        output.kind = PacketKind::Advertisement;
    } else if (type == static_cast<std::uint8_t>(MeshCorePayloadType::Trace)) {
        // TRACE v1 begins with tag[4], auth[4], and flags[1]. Treat shorter
        // frames as malformed instead of presenting them as valid control data.
        if (payload_length < 9) {
            return malformed(output);
        }
        output.kind = PacketKind::Control;
    } else if (type == static_cast<std::uint8_t>(MeshCorePayloadType::Control)) {
        output.kind = PacketKind::Control;
    } else if (type >= 12U && type <= 14U) {
        // Values 12..14 are reserved in the published v1 wire format.
        output.kind = PacketKind::Unknown;
    } else if (isDirectEncryptedType(type)) {
        if (payload_length < 20 || ((payload_length - 4) % 16) != 0) {
            return malformed(output);
        }
        output.kind = PacketKind::EncryptedPayload;
        output.attributes |= AttributeEncrypted;
    } else if (type == static_cast<std::uint8_t>(MeshCorePayloadType::GroupText) ||
               type == static_cast<std::uint8_t>(MeshCorePayloadType::GroupData)) {
        if (payload_length < 19 || ((payload_length - 3) % 16) != 0) {
            return malformed(output);
        }
        output.channel = frame.bytes[cursor];
        output.present_fields |= FieldChannel;
        output.kind = PacketKind::EncryptedPayload;
        output.attributes |= AttributeEncrypted;
    } else if (type == static_cast<std::uint8_t>(MeshCorePayloadType::AnonymousRequest)) {
        if (payload_length < 51 || ((payload_length - 35) % 16) != 0) {
            return malformed(output);
        }
        output.kind = PacketKind::EncryptedPayload;
        output.attributes |= AttributeEncrypted;
    }

    if (frame.wasTruncated()) {
        return malformed(output);
    }
    return DecodeResult::Matched;
}

std::uint8_t MeshCoreDecoder::wireHeader(const DecodedPacket &packet) noexcept
{
    return static_cast<std::uint8_t>(packet.protocol_flags & 0xffU);
}

MeshCoreRouteType MeshCoreDecoder::routeType(const DecodedPacket &packet) noexcept
{
    return static_cast<MeshCoreRouteType>(wireHeader(packet) & kRouteMask);
}

MeshCorePayloadType MeshCoreDecoder::payloadType(const DecodedPacket &packet) noexcept
{
    return static_cast<MeshCorePayloadType>((wireHeader(packet) >> kPayloadTypeShift) & kPayloadTypeMask);
}

std::uint8_t MeshCoreDecoder::payloadVersion(const DecodedPacket &packet) noexcept
{
    return (wireHeader(packet) >> kVersionShift) & kVersionMask;
}

std::uint8_t MeshCoreDecoder::encodedPathLength(const DecodedPacket &packet) noexcept
{
    return static_cast<std::uint8_t>((packet.protocol_flags >> 8U) & 0xffU);
}

std::uint8_t MeshCoreDecoder::pathHashCount(const DecodedPacket &packet) noexcept
{
    return encodedPathLength(packet) & kPathCountMask;
}

std::uint8_t MeshCoreDecoder::pathHashSize(const DecodedPacket &packet) noexcept
{
    return static_cast<std::uint8_t>((encodedPathLength(packet) >> kPathSizeShift) + 1U);
}

bool MeshCoreDecoder::hasTransportCodes(const DecodedPacket &packet) noexcept
{
    return routeHasTransportCodes(static_cast<std::uint8_t>(routeType(packet)));
}

std::uint16_t MeshCoreDecoder::transportCodeOne(const DecodedPacket &packet) noexcept
{
    return static_cast<std::uint16_t>(packet.source);
}

std::uint16_t MeshCoreDecoder::transportCodeTwo(const DecodedPacket &packet) noexcept
{
    return static_cast<std::uint16_t>(packet.destination);
}

std::uint32_t MeshCoreDecoder::acknowledgementChecksum(const DecodedPacket &packet) noexcept
{
    return packet.packet_id;
}

} // namespace lilyshark
