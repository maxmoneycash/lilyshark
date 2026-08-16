#include "lilyshark/core/decoder_registry.h"
#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshtastic_decoder.h"
#include "lilyshark/protocols/reticulum_decoder.h"
#include "lilyshark/shelby/shelby_pointer.h"
#include "lilyshark/shelby/shelby_pointer_decoder.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;

ShelbyPointer makePointer() noexcept
{
    ShelbyPointer pointer{};
    for (std::size_t index = 0; index < ShelbyPointer::kCommitmentSize; ++index) {
        pointer.commitment[index] = static_cast<std::uint8_t>(0x20U + index);
    }
    for (std::size_t index = 0; index < ShelbyPointer::kOwnerSize; ++index) {
        pointer.owner[index] = static_cast<std::uint8_t>(0x80U + index);
    }
    pointer.flags = ShelbyPointer::kFlagEncrypted | ShelbyPointer::kFlagCapture;
    pointer.size_bytes = 4096;
    pointer.expires_at_unix = 1900000000U;
    pointer.chunk_index = 0;
    pointer.chunk_count = 1;
    return pointer;
}

RawFrame makeMeshtasticFrameWithPointer()
{
    std::array<std::uint8_t, MeshtasticDecoder::kOuterHeaderLength +
                                 ShelbyPointer::kEncodedSize>
        bytes{};
    // Valid Meshtastic outer header: broadcast destination, non-zero source
    // and packet ID, hop limit 3, channel hash 0x2a, hop start 5.
    const std::uint8_t header[MeshtasticDecoder::kOuterHeaderLength] = {
        0xff, 0xff, 0xff, 0xff, 0x78, 0x56, 0x34, 0x12,
        0xde, 0xc0, 0xad, 0x0b, 0xa3, 0x2a, 0x56, 0x78,
    };
    for (std::size_t index = 0; index < MeshtasticDecoder::kOuterHeaderLength; ++index) {
        bytes[index] = header[index];
    }
    assert(encodeShelbyPointer(makePointer(),
                               bytes.data() + MeshtasticDecoder::kOuterHeaderLength,
                               ShelbyPointer::kEncodedSize) == ShelbyPointerResult::Ok);

    RawFrame frame{};
    assert(frame.assignPayload(bytes.data(), bytes.size()));
    return frame;
}

RawFrame makeMeshCoreFrameWithPointer()
{
    std::array<std::uint8_t, 2 + ShelbyPointer::kEncodedSize> bytes{};
    bytes[0] = 0x3d; // v1 flood RAW_CUSTOM packet
    bytes[1] = 0x00; // empty path
    assert(encodeShelbyPointer(makePointer(), bytes.data() + 2,
                               ShelbyPointer::kEncodedSize) == ShelbyPointerResult::Ok);

    RawFrame frame{};
    assert(frame.assignPayload(bytes.data(), bytes.size()));
    return frame;
}

RawFrame makeReticulumFrameWithPointer()
{
    constexpr std::size_t header_length =
        ReticulumDecoder::kRNodeShimLength + ReticulumDecoder::kHeaderOneLength;
    std::array<std::uint8_t, header_length + ShelbyPointer::kEncodedSize> bytes{};
    bytes[0] = 0xa0; // complete RNode frame
    bytes[1] = 0x08; // clear HEADER_1 PLAIN/DATA packet
    bytes[2] = 2;    // observed hops
    for (std::size_t index = 0; index < 16; ++index) {
        bytes[3 + index] = static_cast<std::uint8_t>(index);
    }
    bytes[19] = 0x00; // context
    assert(encodeShelbyPointer(makePointer(), bytes.data() + header_length,
                               ShelbyPointer::kEncodedSize) == ShelbyPointerResult::Ok);

    RawFrame frame{};
    assert(frame.assignPayload(bytes.data(), bytes.size()));
    return frame;
}

void nestedPointerEnrichesWithoutReplacingMeshtasticDecode()
{
    MeshtasticDecoder meshtastic{};
    ShelbyPointerDecoder shelby{};
    DecoderRegistry registry{};
    assert(registry.add(meshtastic));
    assert(registry.add(shelby));

    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Meshtastic;
    DecodedPacket decoded{};
    const DecodeResult result =
        registry.decode(makeMeshtasticFrameWithPointer(), profile, decoded);

    assert(result == DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::Meshtastic);
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(decoded.kind == PacketKind::OpaquePayload);
    assert(decoded.destination == 0xffffffffU);
    assert(decoded.source == 0x12345678U);
    assert(decoded.packet_id == 0x0badc0deU);
    assert(decoded.channel == 0x2aU);
    assert(decoded.hop_limit == 3U);
    assert(decoded.hop_start == 5U);
    assert(decoded.payload_offset == MeshtasticDecoder::kOuterHeaderLength);
    assert(decoded.payload_length == ShelbyPointer::kEncodedSize);
    assert(decoded.hasAttribute(AttributeBroadcast));
    assert(decoded.hasAttribute(AttributeShelbyPointer));
    // The pointer describes an encrypted blob, but the Meshtastic payload is
    // still opaque; secondary attributes other than the marker do not leak.
    assert(!decoded.hasAttribute(AttributeEncrypted));
}

void pointerRemainsAStandaloneCustomDecodeWithoutAnOuterMatch()
{
    ShelbyPointerDecoder shelby{};
    DecoderRegistry registry{};
    assert(registry.add(shelby));

    RadioProfile profile{};
    DecodedPacket decoded{};
    assert(registry.decode(makeMeshtasticFrameWithPointer(), profile, decoded) ==
           DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::Custom);
    assert(decoded.state == DecodeState::PayloadDecoded);
    assert(decoded.payload_offset == MeshtasticDecoder::kOuterHeaderLength);
    assert(decoded.payload_length == ShelbyPointer::kEncodedSize);
    assert(decoded.hasAttribute(AttributeShelbyPointer));
    assert(decoded.hasAttribute(AttributeEncrypted));
}

void nestedPointerEnrichesMeshCoreAndReticulum()
{
    ShelbyPointerDecoder shelby{};

    MeshCoreDecoder meshcore{};
    DecoderRegistry meshcore_registry{};
    assert(meshcore_registry.add(meshcore));
    assert(meshcore_registry.add(shelby));
    RadioProfile meshcore_profile{};
    meshcore_profile.protocol_hint = ProtocolId::MeshCore;
    DecodedPacket decoded{};
    assert(meshcore_registry.decode(makeMeshCoreFrameWithPointer(), meshcore_profile,
                                    decoded) == DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::MeshCore);
    assert(decoded.kind == PacketKind::Data);
    assert(decoded.payload_offset == 2);
    assert(decoded.payload_length == ShelbyPointer::kEncodedSize);
    assert(decoded.hasAttribute(AttributeShelbyPointer));
    assert(!decoded.hasAttribute(AttributeEncrypted));

    ReticulumDecoder reticulum{};
    DecoderRegistry reticulum_registry{};
    assert(reticulum_registry.add(reticulum));
    assert(reticulum_registry.add(shelby));
    RadioProfile reticulum_profile{};
    reticulum_profile.protocol_hint = ProtocolId::Reticulum;
    assert(reticulum_registry.decode(makeReticulumFrameWithPointer(), reticulum_profile,
                                     decoded) == DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::Reticulum);
    assert(decoded.kind == PacketKind::Data);
    assert(decoded.payload_offset == ReticulumDecoder::kRNodeShimLength +
                                         ReticulumDecoder::kHeaderOneLength);
    assert(decoded.payload_length == ShelbyPointer::kEncodedSize);
    assert(decoded.hasAttribute(AttributeShelbyPointer));
    assert(!decoded.hasAttribute(AttributeEncrypted));
}

} // namespace

int main()
{
    nestedPointerEnrichesWithoutReplacingMeshtasticDecode();
    nestedPointerEnrichesMeshCoreAndReticulum();
    pointerRemainsAStandaloneCustomDecodeWithoutAnOuterMatch();
    std::puts("shelby registry enrichment tests passed");
    return 0;
}
