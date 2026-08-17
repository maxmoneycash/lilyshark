#include "lilyshark/protocols/meshtastic_decoder.h"

#include "lilyshark/protocols/meshtastic_payload.h"

#include <cstdint>

namespace lilyshark {
namespace {

constexpr std::uint8_t kHopLimitMask = 0x07;
constexpr std::uint8_t kWantAckMask = 0x08;
constexpr std::uint8_t kViaMqttMask = 0x10;
constexpr std::uint8_t kHopStartMask = 0xe0;
constexpr std::uint8_t kHopStartShift = 5;

std::uint32_t readLittleEndian32(const std::uint8_t *bytes) noexcept
{
    return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8U) |
           (static_cast<std::uint32_t>(bytes[2]) << 16U) | (static_cast<std::uint32_t>(bytes[3]) << 24U);
}

} // namespace

DecodeResult MeshtasticDecoder::decode(const RawFrame &frame, const RadioProfile &profile,
                                       DecodedPacket &output) const noexcept
{
    // Meshtastic's outer header has no magic bytes. Restrict decoding to an
    // explicitly identified profile so unrelated LoRa traffic stays Unknown.
    if (profile.protocol_hint != ProtocolId::Meshtastic) {
        return DecodeResult::NoMatch;
    }

    output = makeUnknownPacket(frame);
    output.protocol = ProtocolId::Meshtastic;

    if (frame.captured_length < kOuterHeaderLength) {
        output.state = DecodeState::Malformed;
        return DecodeResult::Malformed;
    }

    // Verified against meshtastic/firmware commit
    // 34680833b88b37bbcffca0b31dffe45f29e9d35c, RadioInterface.h and
    // RadioInterface.cpp: to[0..3], from[4..7], id[8..11], flags[12],
    // channel_hash[13], next_hop[14], relay_node[15]. The firmware transmits this
    // native 16-byte structure from its little-endian targets.
    output.destination = readLittleEndian32(&frame.bytes[0]);
    output.source = readLittleEndian32(&frame.bytes[4]);
    output.packet_id = readLittleEndian32(&frame.bytes[8]);
    const std::uint8_t flags = frame.bytes[12];
    output.protocol_flags = flags;
    output.channel = frame.bytes[13];
    output.hop_limit = flags & kHopLimitMask;
    output.hop_start = (flags & kHopStartMask) >> kHopStartShift;
    output.payload_offset = static_cast<std::uint16_t>(kOuterHeaderLength);
    output.payload_length = static_cast<std::uint16_t>(frame.captured_length - kOuterHeaderLength);
    output.present_fields = FieldSource | FieldDestination | FieldPacketId | FieldChannel | FieldHopLimit |
                            FieldHopStart | FieldPayload;
    // The outer header does not prove whether the protobuf bytes are encrypted:
    // Meshtastic channels with an empty/zero PSK can send them in cleartext.
    // Keep the bytes inspectable without making an encryption claim.
    output.attributes = AttributeNone;
    output.kind = PacketKind::OpaquePayload;
    output.state = DecodeState::HeaderOnly;

    if (output.hop_start != 0) {
        output.next_hop = frame.bytes[14];
        output.relay_node = frame.bytes[15];
        output.present_fields |= FieldNextHop | FieldRelayNode;
    }
    if (output.destination == 0xffffffffU) {
        output.attributes |= AttributeBroadcast;
    }
    if ((flags & kWantAckMask) != 0) {
        output.attributes |= AttributeAcknowledgementRequested;
    }
    if ((flags & kViaMqttMask) != 0) {
        output.attributes |= AttributeViaMqtt;
    }
    if (frame.wasTruncated()) {
        output.attributes |= AttributeTruncated;
    }

    // Official firmware rejects a zero sender as an altered packet. Preserve
    // the parsed fields for diagnostics while reporting the frame as malformed.
    if (output.source == 0) {
        output.state = DecodeState::Malformed;
        return DecodeResult::Malformed;
    }

    // Default-channel traffic is readable with a key every radio ships with,
    // so try it. Success means the payload was never private; failure leaves
    // the packet opaque, which is the honest outcome for a real PSK.
    if (output.payload_length > 0) {
        MeshtasticPayload payload{};
        if (readMeshtasticPayload(&frame.bytes[output.payload_offset], output.payload_length,
                                  output.source, output.packet_id, payload)) {
            output.application_port = payload.portnum;
            output.attributes |= AttributeDefaultKeyReadable;
            output.kind = PacketKind::Data;
            output.state = DecodeState::PayloadDecoded;
        }
    }

    return DecodeResult::Matched;
}

} // namespace lilyshark
