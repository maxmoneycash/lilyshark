#include "lilyshark/protocols/reticulum_decoder.h"

#include <cstddef>
#include <cstdint>
#include <cstring>

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

std::size_t announceFixedLength(bool has_ratchet) noexcept
{
    return kReticulumAnnounceMinimumBytes + (has_ratchet ? kReticulumAnnounceRatchetBytes : 0);
}

/// True when a payload of this length can hold every fixed announce field the
/// header promises. Announces are only issued by SINGLE destinations; any
/// other destination type is a flag inconsistency, not an announce.
bool announceArithmeticHolds(std::size_t payload_length, std::uint8_t destination_type,
                             bool has_ratchet) noexcept
{
    return destination_type == static_cast<std::uint8_t>(ReticulumDestinationType::Single) &&
           payload_length >= announceFixedLength(has_ratchet);
}

void writeHexLower(const std::uint8_t *bytes, std::size_t length, char *out) noexcept
{
    static const char digits[] = "0123456789abcdef";
    for (std::size_t index = 0; index < length; ++index) {
        out[index * 2] = digits[bytes[index] >> 4U];
        out[index * 2 + 1] = digits[bytes[index] & 0x0fU];
    }
    out[length * 2] = '\0';
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
        // Semantic tier: when the payload provably holds the fixed announce
        // fields (public key, name hash, random hash, promised ratchet,
        // signature), the packet is more than a bare header. The full field
        // layout is read back on demand via readReticulumAnnounce.
        if (announceArithmeticHolds(output.payload_length, destination_type,
                                    (flags & kContextFlagMask) != 0)) {
            output.state = DecodeState::PayloadDecoded;
        }
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

bool readReticulumAnnounce(const RawFrame &frame, const DecodedPacket &packet,
                           ReticulumAnnounce &out) noexcept
{
    out = ReticulumAnnounce{};

    if (packet.protocol != ProtocolId::Reticulum || packet.state == DecodeState::Malformed) {
        return false;
    }
    if (ReticulumDecoder::isRNodeSplitFrame(packet) || ReticulumDecoder::isIfacProtected(packet)) {
        return false;
    }
    if (ReticulumDecoder::packetType(packet) != ReticulumPacketType::Announce) {
        return false;
    }

    // Re-derive the header geometry and refuse anything that does not match
    // the frame actually handed in — this function may be called against a
    // stored frame long after decode, and must never read past it.
    const bool header_two = ReticulumDecoder::headerType(packet) == ReticulumHeaderType::HeaderTwo;
    const std::size_t header_length = ReticulumDecoder::headerLength(packet);
    if (header_length !=
        (header_two ? ReticulumDecoder::kHeaderTwoLength : ReticulumDecoder::kHeaderOneLength)) {
        return false;
    }
    const std::size_t payload_offset = packet.payload_offset;
    const std::size_t payload_length = packet.payload_length;
    if (payload_offset != ReticulumDecoder::kRNodeShimLength + header_length ||
        payload_offset > frame.captured_length ||
        payload_length > frame.captured_length - payload_offset) {
        return false;
    }

    const bool has_ratchet = ReticulumDecoder::contextFlag(packet);
    const std::uint8_t destination_type =
        static_cast<std::uint8_t>(ReticulumDecoder::destinationType(packet));
    if (!announceArithmeticHolds(payload_length, destination_type, has_ratchet)) {
        return false;
    }
    const std::size_t app_data_length = payload_length - announceFixedLength(has_ratchet);
    if (app_data_length > kReticulumAnnounceMaxAppDataBytes) {
        return false;
    }

    out.header_type = header_two ? ReticulumHeaderType::HeaderTwo : ReticulumHeaderType::HeaderOne;
    out.hops = packet.hop_limit;

    // Addressing: shim, flags, hops, then one or two 16-byte hashes.
    const std::size_t address_offset = ReticulumDecoder::kRNodeShimLength + 2;
    const std::size_t destination_offset =
        header_two ? address_offset + kReticulumHashBytes : address_offset;
    std::memcpy(out.destination_hash, &frame.bytes[destination_offset], kReticulumHashBytes);
    writeHexLower(out.destination_hash, kReticulumHashBytes, out.destination_hash_hex);
    out.destination_hash_range = {static_cast<std::uint16_t>(destination_offset),
                                  static_cast<std::uint16_t>(kReticulumHashBytes)};
    if (header_two) {
        out.has_transport_id = true;
        std::memcpy(out.transport_id, &frame.bytes[address_offset], kReticulumHashBytes);
        out.transport_id_range = {static_cast<std::uint16_t>(address_offset),
                                  static_cast<std::uint16_t>(kReticulumHashBytes)};
    }

    // Payload fields, laid out back to back from the payload start.
    std::size_t cursor = payload_offset;
    out.has_public_key = true;
    out.public_key_range = {static_cast<std::uint16_t>(cursor),
                            static_cast<std::uint16_t>(kReticulumAnnouncePublicKeyBytes)};
    cursor += kReticulumAnnouncePublicKeyBytes;

    std::memcpy(out.name_hash, &frame.bytes[cursor], kReticulumAnnounceNameHashBytes);
    out.name_hash_range = {static_cast<std::uint16_t>(cursor),
                           static_cast<std::uint16_t>(kReticulumAnnounceNameHashBytes)};
    cursor += kReticulumAnnounceNameHashBytes;

    std::memcpy(out.random_hash, &frame.bytes[cursor], kReticulumAnnounceRandomHashBytes);
    out.random_hash_range = {static_cast<std::uint16_t>(cursor),
                             static_cast<std::uint16_t>(kReticulumAnnounceRandomHashBytes)};
    cursor += kReticulumAnnounceRandomHashBytes;

    if (has_ratchet) {
        out.has_ratchet = true;
        out.ratchet_range = {static_cast<std::uint16_t>(cursor),
                             static_cast<std::uint16_t>(kReticulumAnnounceRatchetBytes)};
        cursor += kReticulumAnnounceRatchetBytes;
    }

    out.has_signature = true;
    out.signature_range = {static_cast<std::uint16_t>(cursor),
                           static_cast<std::uint16_t>(kReticulumAnnounceSignatureBytes)};
    cursor += kReticulumAnnounceSignatureBytes;

    if (app_data_length > 0) {
        out.has_app_data = true;
        out.app_data_length = static_cast<std::uint16_t>(app_data_length);
        std::memcpy(out.app_data, &frame.bytes[cursor], app_data_length);
        out.app_data_range = {static_cast<std::uint16_t>(cursor),
                              static_cast<std::uint16_t>(app_data_length)};
    }

    out.valid = true;
    return true;
}

} // namespace lilyshark
