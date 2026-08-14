#include "lilyshark/protocols/reticulum_decoder.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace {

constexpr std::uint8_t kRNodeSplitMask = 0x01;
constexpr std::uint8_t kIfacMask = 0x80;
constexpr std::uint8_t kHeaderTypeMask = 0x40;
constexpr std::uint8_t kContextFlagMask = 0x20;
constexpr std::uint8_t kTransportMask = 0x10;
constexpr std::uint8_t kDestinationTypeMask = 0x0c;
constexpr std::uint8_t kDestinationTypeShift = 2;
constexpr std::uint8_t kPacketTypeMask = 0x03;
constexpr std::uint8_t kResourceContext = 0x01;
constexpr std::uint8_t kResourceProofContext = 0x05;
constexpr std::uint8_t kCacheRequestContext = 0x08;
constexpr std::uint8_t kKeepaliveContext = 0xfa;
constexpr std::uint8_t kMaximumHopsExclusive = 128;

std::uint32_t readNetworkPrefix32(const std::uint8_t *bytes) noexcept
{
    return (static_cast<std::uint32_t>(bytes[0]) << 24U) | (static_cast<std::uint32_t>(bytes[1]) << 16U) |
           (static_cast<std::uint32_t>(bytes[2]) << 8U) | static_cast<std::uint32_t>(bytes[3]);
}

DecodeResult malformed(DecodedPacket &output) noexcept
{
    output.state = DecodeState::Malformed;
    return DecodeResult::Malformed;
}

bool payloadIsClear(std::uint8_t packet_type, std::uint8_t destination_type, std::uint8_t context) noexcept
{
    if (packet_type == static_cast<std::uint8_t>(ReticulumPacketType::Announce) ||
        packet_type == static_cast<std::uint8_t>(ReticulumPacketType::LinkRequest) ||
        destination_type == static_cast<std::uint8_t>(ReticulumDestinationType::Plain)) {
        return true;
    }
    if (packet_type == static_cast<std::uint8_t>(ReticulumPacketType::Proof) &&
        (context == kResourceProofContext ||
         destination_type == static_cast<std::uint8_t>(ReticulumDestinationType::Link))) {
        return true;
    }
    return context == kResourceContext || context == kCacheRequestContext || context == kKeepaliveContext;
}

} // namespace

DecodeResult ReticulumDecoder::decode(const RawFrame &frame, const RadioProfile &profile,
                                      DecodedPacket &output) const noexcept
{
    if (profile.protocol_hint != ProtocolId::Reticulum) {
        return DecodeResult::NoMatch;
    }

    output = makeUnknownPacket(frame);
    output.protocol = ProtocolId::Reticulum;
    if (frame.captured_length < kRNodeShimLength + 1) {
        return malformed(output);
    }

    const std::uint8_t shim = frame.bytes[0];
    output.protocol_flags = static_cast<std::uint32_t>(shim) << 16U;
    output.payload_offset = static_cast<std::uint16_t>(kRNodeShimLength);
    output.payload_length = static_cast<std::uint16_t>(frame.captured_length - kRNodeShimLength);
    output.present_fields = FieldPayload;
    output.state = DecodeState::HeaderOnly;
    output.kind = PacketKind::Data;

    if ((shim & kRNodeSplitMask) != 0) {
        if (frame.wasTruncated()) {
            return malformed(output);
        }
        return DecodeResult::Matched;
    }

    const std::uint8_t flags = frame.bytes[1];
    output.protocol_flags |= flags;
    if ((flags & kIfacMask) != 0) {
        // IFAC masks the header and payload. Only its marker bit is safe to
        // interpret without the interface key. The smallest legal protected
        // frame adds at least one IFAC byte to a HEADER_1 packet.
        const std::size_t minimum_protected_length =
            kRNodeShimLength + kHeaderOneLength + kMinimumIfacBytes;
        if (frame.captured_length < minimum_protected_length || frame.wasTruncated()) {
            return malformed(output);
        }
        output.kind = PacketKind::EncryptedPayload;
        output.attributes |= AttributeEncrypted;
        return DecodeResult::Matched;
    }

    const bool header_two = (flags & kHeaderTypeMask) != 0;
    const std::size_t logical_header_length = header_two ? kHeaderTwoLength : kHeaderOneLength;
    const std::size_t physical_header_length = kRNodeShimLength + logical_header_length;
    if (frame.captured_length < physical_header_length) {
        return malformed(output);
    }

    const std::uint8_t hops = frame.bytes[2];
    if (hops >= kMaximumHopsExclusive) {
        return malformed(output);
    }

    const std::size_t transport_offset = 3;
    const std::size_t destination_offset = header_two ? transport_offset + 16 : transport_offset;
    const std::size_t context_offset = destination_offset + 16;
    const std::uint8_t context_value = frame.bytes[context_offset];
    const std::uint8_t packet_type = flags & kPacketTypeMask;
    const std::uint8_t destination_type = (flags & kDestinationTypeMask) >> kDestinationTypeShift;

    output.protocol_flags |= static_cast<std::uint32_t>(context_value) << 8U;
    output.protocol_flags |= static_cast<std::uint32_t>(logical_header_length) << 24U;
    output.hop_limit = hops;
    output.destination = readNetworkPrefix32(&frame.bytes[destination_offset]);
    if (header_two) {
        output.source = readNetworkPrefix32(&frame.bytes[transport_offset]);
    }
    output.payload_offset = static_cast<std::uint16_t>(physical_header_length);
    output.payload_length = static_cast<std::uint16_t>(frame.captured_length - physical_header_length);

    if (packet_type == static_cast<std::uint8_t>(ReticulumPacketType::Announce)) {
        output.kind = PacketKind::Advertisement;
    } else if (packet_type == static_cast<std::uint8_t>(ReticulumPacketType::LinkRequest) ||
               packet_type == static_cast<std::uint8_t>(ReticulumPacketType::Proof)) {
        output.kind = PacketKind::Control;
    }

    if (!payloadIsClear(packet_type, destination_type, context_value)) {
        output.kind = PacketKind::EncryptedPayload;
        output.attributes |= AttributeEncrypted;
    }

    if (frame.wasTruncated()) {
        return malformed(output);
    }
    return DecodeResult::Matched;
}

std::uint8_t ReticulumDecoder::rnsFlags(const DecodedPacket &packet) noexcept
{
    return static_cast<std::uint8_t>(packet.protocol_flags & 0xffU);
}

std::uint8_t ReticulumDecoder::context(const DecodedPacket &packet) noexcept
{
    return static_cast<std::uint8_t>((packet.protocol_flags >> 8U) & 0xffU);
}

std::uint8_t ReticulumDecoder::rnodeShim(const DecodedPacket &packet) noexcept
{
    return static_cast<std::uint8_t>((packet.protocol_flags >> 16U) & 0xffU);
}

std::uint8_t ReticulumDecoder::headerLength(const DecodedPacket &packet) noexcept
{
    return static_cast<std::uint8_t>((packet.protocol_flags >> 24U) & 0xffU);
}

bool ReticulumDecoder::isRNodeSplitFrame(const DecodedPacket &packet) noexcept
{
    return (rnodeShim(packet) & kRNodeSplitMask) != 0;
}

bool ReticulumDecoder::isIfacProtected(const DecodedPacket &packet) noexcept
{
    return (rnsFlags(packet) & kIfacMask) != 0;
}

ReticulumHeaderType ReticulumDecoder::headerType(const DecodedPacket &packet) noexcept
{
    return (rnsFlags(packet) & kHeaderTypeMask) != 0 ? ReticulumHeaderType::HeaderTwo
                                                     : ReticulumHeaderType::HeaderOne;
}

bool ReticulumDecoder::contextFlag(const DecodedPacket &packet) noexcept
{
    return (rnsFlags(packet) & kContextFlagMask) != 0;
}

ReticulumPacketType ReticulumDecoder::packetType(const DecodedPacket &packet) noexcept
{
    return static_cast<ReticulumPacketType>(rnsFlags(packet) & kPacketTypeMask);
}

ReticulumDestinationType ReticulumDecoder::destinationType(const DecodedPacket &packet) noexcept
{
    return static_cast<ReticulumDestinationType>((rnsFlags(packet) & kDestinationTypeMask) >> kDestinationTypeShift);
}

bool ReticulumDecoder::isTransportPacket(const DecodedPacket &packet) noexcept
{
    return (rnsFlags(packet) & kTransportMask) != 0;
}

std::uint8_t ReticulumDecoder::observedHops(const DecodedPacket &packet) noexcept
{
    return packet.hop_limit;
}

std::uint32_t ReticulumDecoder::destinationHashPrefix(const DecodedPacket &packet) noexcept
{
    return packet.destination;
}

std::uint32_t ReticulumDecoder::transportIdPrefix(const DecodedPacket &packet) noexcept
{
    return packet.source;
}

} // namespace lilyshark
