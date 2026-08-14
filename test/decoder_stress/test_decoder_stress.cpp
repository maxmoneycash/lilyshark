#include "lilyshark/core/decoder_registry.h"
#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshtastic_decoder.h"
#include "lilyshark/protocols/reticulum_decoder.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;

constexpr std::uint32_t kKnownFields =
    FieldSource | FieldDestination | FieldPacketId | FieldChannel | FieldHopLimit | FieldHopStart |
    FieldNextHop | FieldRelayNode | FieldPayload;
constexpr std::uint16_t kKnownAttributes =
    AttributeBroadcast | AttributeAcknowledgementRequested | AttributeViaMqtt | AttributeEncrypted |
    AttributeTruncated;

class DeterministicRandom
{
  public:
    explicit DeterministicRandom(std::uint32_t seed) noexcept : state_(seed) {}

    std::uint32_t next() noexcept
    {
        std::uint32_t value = (state_ += 0x9e3779b9U);
        value = (value ^ (value >> 16U)) * 0x21f0aaadU;
        value = (value ^ (value >> 15U)) * 0x735a2d97U;
        return value ^ (value >> 15U);
    }

  private:
    std::uint32_t state_;
};

RawFrame makeFrame(DeterministicRandom &random, std::size_t iteration) noexcept
{
    RawFrame frame{};
    const std::size_t captured_length =
        iteration < kMaxFrameBytes + 1U ? iteration : random.next() % (kMaxFrameBytes + 1U);

    for (std::size_t index = 0; index < kMaxFrameBytes; ++index) {
        frame.bytes[index] = static_cast<std::uint8_t>(random.next());
    }

    frame.captured_length = static_cast<std::uint16_t>(captured_length);
    frame.original_length = frame.captured_length;
    if ((iteration % 3U) == 0U) {
        frame.original_length = static_cast<std::uint16_t>(captured_length + 1U + (random.next() % 512U));
    }
    return frame;
}

RadioProfile profileFor(ProtocolId protocol) noexcept
{
    RadioProfile profile{};
    profile.protocol_hint = protocol;
    return profile;
}

void assertPayloadRange(const RawFrame &frame, const DecodedPacket &packet)
{
    const std::size_t offset = packet.payload_offset;
    const std::size_t length = packet.payload_length;
    const std::size_t captured = frame.captured_length;
    assert(offset <= captured);
    assert(length <= captured - offset);
    assert(packet.hasField(FieldPayload));
}

void assertKnownValues(const RawFrame &frame, DecodeResult result, const DecodedPacket &packet)
{
    assert(static_cast<std::uint8_t>(result) <= static_cast<std::uint8_t>(DecodeResult::Malformed));
    assert(static_cast<std::uint8_t>(packet.protocol) <= static_cast<std::uint8_t>(ProtocolId::Custom));
    assert(static_cast<std::uint8_t>(packet.state) <= static_cast<std::uint8_t>(DecodeState::Malformed));
    assert(static_cast<std::uint8_t>(packet.kind) <= static_cast<std::uint8_t>(PacketKind::Advertisement));
    assert((packet.present_fields & ~kKnownFields) == 0U);
    assert((packet.attributes & static_cast<std::uint16_t>(~kKnownAttributes)) == 0U);
    assertPayloadRange(frame, packet);
    assert(packet.hasAttribute(AttributeTruncated) == frame.wasTruncated());

    switch (result) {
    case DecodeResult::NoMatch:
        assert(packet.protocol == ProtocolId::Unknown);
        assert(packet.state == DecodeState::Unknown);
        assert(packet.kind == PacketKind::Unknown);
        break;
    case DecodeResult::Matched:
        assert(packet.state == DecodeState::HeaderOnly || packet.state == DecodeState::PayloadDecoded);
        break;
    case DecodeResult::Malformed:
        assert(packet.state == DecodeState::Malformed);
        break;
    }
}

void assertProfileGating(const PacketDecoder &decoder, ProtocolId expected, const RawFrame &frame)
{
    constexpr ProtocolId hints[] = {
        ProtocolId::Unknown,
        ProtocolId::Meshtastic,
        ProtocolId::MeshCore,
        ProtocolId::Reticulum,
        ProtocolId::Custom,
    };

    DecoderRegistry registry{};
    assert(registry.add(decoder));
    for (ProtocolId hint : hints) {
        if (hint == expected) {
            continue;
        }
        DecodedPacket packet{};
        const DecodeResult result = registry.decode(frame, profileFor(hint), packet);
        assert(result == DecodeResult::NoMatch);
        assertKnownValues(frame, result, packet);
        assert(packet.payload_offset == 0);
        assert(packet.payload_length == frame.captured_length);
    }
}

DecodedPacket decodeExpected(const PacketDecoder &decoder, ProtocolId expected, const RawFrame &frame,
                             DecodeResult &result)
{
    DecoderRegistry registry{};
    assert(registry.add(decoder));
    DecodedPacket packet{};
    result = registry.decode(frame, profileFor(expected), packet);
    assert(result != DecodeResult::NoMatch);
    assert(packet.protocol == expected);
    assertKnownValues(frame, result, packet);
    return packet;
}

void stressMeshtastic(const MeshtasticDecoder &decoder, const RawFrame &frame)
{
    DecodeResult result = DecodeResult::NoMatch;
    const DecodedPacket packet = decodeExpected(decoder, ProtocolId::Meshtastic, frame, result);

    assert(packet.hop_limit <= 7U);
    assert(packet.hop_start <= 7U);
    if (result == DecodeResult::Matched) {
        assert(frame.captured_length >= MeshtasticDecoder::kOuterHeaderLength);
        assert(packet.source != 0U);
        assert(packet.state == DecodeState::HeaderOnly);
        assert(packet.kind == PacketKind::EncryptedPayload);
        assert(packet.hasAttribute(AttributeEncrypted));
        assert(packet.payload_offset == MeshtasticDecoder::kOuterHeaderLength);
        assert(packet.payload_length == frame.captured_length - MeshtasticDecoder::kOuterHeaderLength);
    }
}

void stressMeshCore(const MeshCoreDecoder &decoder, const RawFrame &frame)
{
    DecodeResult result = DecodeResult::NoMatch;
    const DecodedPacket packet = decodeExpected(decoder, ProtocolId::MeshCore, frame, result);

    assert(static_cast<std::uint8_t>(MeshCoreDecoder::routeType(packet)) <= 3U);
    assert(static_cast<std::uint8_t>(MeshCoreDecoder::payloadType(packet)) <= 15U);
    assert(MeshCoreDecoder::payloadVersion(packet) <= 3U);
    assert(MeshCoreDecoder::pathHashCount(packet) <= 63U);
    assert(MeshCoreDecoder::pathHashSize(packet) >= 1U);
    assert(MeshCoreDecoder::pathHashSize(packet) <= 4U);
    assert(!packet.hasField(FieldSource));
    assert(!packet.hasField(FieldDestination));
    assert(!packet.hasField(FieldPacketId));
    assert(!packet.hasField(FieldHopLimit));
    assert(!packet.hasField(FieldHopStart));

    if (result == DecodeResult::Matched && MeshCoreDecoder::payloadVersion(packet) == 0U) {
        assert(MeshCoreDecoder::pathHashSize(packet) <= 3U);
        assert(packet.payload_offset >= 2U);
        assert(packet.payload_length <= MeshCoreDecoder::kMaxPayloadBytes);
    }
    if (packet.hasAttribute(AttributeEncrypted)) {
        assert(packet.kind == PacketKind::EncryptedPayload);
    }
    if (frame.wasTruncated()) {
        assert(result == DecodeResult::Malformed);
    }
}

void stressReticulum(const ReticulumDecoder &decoder, const RawFrame &frame)
{
    DecodeResult result = DecodeResult::NoMatch;
    const DecodedPacket packet = decodeExpected(decoder, ProtocolId::Reticulum, frame, result);

    assert(static_cast<std::uint8_t>(ReticulumDecoder::headerType(packet)) <= 1U);
    assert(static_cast<std::uint8_t>(ReticulumDecoder::packetType(packet)) <= 3U);
    assert(static_cast<std::uint8_t>(ReticulumDecoder::destinationType(packet)) <= 3U);
    assert(!packet.hasField(FieldSource));
    assert(!packet.hasField(FieldDestination));

    if (result == DecodeResult::Matched && !ReticulumDecoder::isRNodeSplitFrame(packet) &&
        !ReticulumDecoder::isIfacProtected(packet)) {
        const std::uint8_t header_length = ReticulumDecoder::headerLength(packet);
        assert(header_length == ReticulumDecoder::kHeaderOneLength ||
               header_length == ReticulumDecoder::kHeaderTwoLength);
        assert(packet.payload_offset == ReticulumDecoder::kRNodeShimLength + header_length);
        assert(ReticulumDecoder::observedHops(packet) < 128U);
    }
    if (packet.hasAttribute(AttributeEncrypted)) {
        assert(packet.kind == PacketKind::EncryptedPayload);
    }
    if (frame.wasTruncated()) {
        assert(result == DecodeResult::Malformed);
    }
}

} // namespace

int main()
{
    constexpr std::size_t kIterations = 16384;
    DeterministicRandom random{0x4c53484bU};
    MeshtasticDecoder meshtastic{};
    MeshCoreDecoder meshcore{};
    ReticulumDecoder reticulum{};

    for (std::size_t iteration = 0; iteration < kIterations; ++iteration) {
        const RawFrame frame = makeFrame(random, iteration);
        assertProfileGating(meshtastic, ProtocolId::Meshtastic, frame);
        assertProfileGating(meshcore, ProtocolId::MeshCore, frame);
        assertProfileGating(reticulum, ProtocolId::Reticulum, frame);
        stressMeshtastic(meshtastic, frame);
        stressMeshCore(meshcore, frame);
        stressReticulum(reticulum, frame);
    }

    std::puts("decoder stress tests passed");
    return 0;
}
