// The LSK TX meshcore path, proven end to end on the host: the frame the
// device transmits is built by encodeMeshCoreRawText and must come back out
// of the repository's own MeshCore decoder with every structural field
// intact — v1 RAW_CUSTOM flood, empty path, and the boot-announce node
// identity leading the payload.

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>

#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshcore_encode.h"

using namespace lilyshark;

namespace {

RadioProfile meshCoreProfile()
{
    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::MeshCore;
    return profile;
}

void testIdentityDerivesFromBootAnnounceNodeNumber()
{
    // One identity store: the same node number the boot announce transmits.
    assert(kLilysharkMeshCoreNodeId == kLilysharkMeshtasticNodeNum);
    assert(kLilysharkMeshCoreNodeId == 0x4c534b01U);
    // The analyzer webapp keys MeshCore contacts by the node number's top
    // byte; the firmware's one-byte source hash must agree with it.
    assert(meshCoreSourceHash(kLilysharkMeshCoreNodeId) == 0x4c);
}

void testEncodedTextRoundTripsThroughOwnDecoder()
{
    const char *text = "radio check from the ridge";
    std::uint8_t frame_bytes[kMaxFrameBytes]{};
    const std::size_t n =
        encodeMeshCoreRawText(kLilysharkMeshCoreNodeId, text, frame_bytes, sizeof(frame_bytes));
    const std::size_t text_length = std::strlen(text);
    assert(n == kMeshCoreRawTextEnvelopeBytes + kMeshCoreRawTextIdBytes + text_length);

    RawFrame frame{};
    assert(frame.assignPayload(frame_bytes, n));
    MeshCoreDecoder decoder{};
    DecodedPacket decoded{};
    assert(decoder.decode(frame, meshCoreProfile(), decoded) == DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::MeshCore);
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(decoded.kind == PacketKind::Data);
    assert(!decoded.hasAttribute(AttributeEncrypted));
    assert(MeshCoreDecoder::routeType(decoded) == MeshCoreRouteType::Flood);
    assert(MeshCoreDecoder::payloadType(decoded) == MeshCorePayloadType::RawCustom);
    assert(MeshCoreDecoder::payloadVersion(decoded) == 0);
    assert(MeshCoreDecoder::pathHashCount(decoded) == 0);
    assert(MeshCoreDecoder::pathHashSize(decoded) == 1);
    assert(!MeshCoreDecoder::hasTransportCodes(decoded));
    assert(decoded.hasField(FieldPayload));
    assert(decoded.payload_offset == kMeshCoreRawTextEnvelopeBytes);
    assert(decoded.payload_length == kMeshCoreRawTextIdBytes + text_length);

    // The payload the decoder hands back starts with the little-endian node
    // id and ends with the untouched text bytes.
    const std::uint8_t *payload = frame.bytes + decoded.payload_offset;
    assert(payload[0] == 0x01);
    assert(payload[1] == 0x4b);
    assert(payload[2] == 0x53);
    assert(payload[3] == 0x4c);
    assert(std::memcmp(payload + kMeshCoreRawTextIdBytes, text, text_length) == 0);
}

void testLongestAllowedTextStillDecodes()
{
    char text[kMeshCoreMaxRawTextBytes + 1]{};
    std::memset(text, 'a', kMeshCoreMaxRawTextBytes);
    std::uint8_t frame_bytes[kMaxFrameBytes]{};
    const std::size_t n =
        encodeMeshCoreRawText(kLilysharkMeshCoreNodeId, text, frame_bytes, sizeof(frame_bytes));
    assert(n == kMeshCoreRawTextEnvelopeBytes + kMeshCoreRawTextIdBytes + kMeshCoreMaxRawTextBytes);

    RawFrame frame{};
    assert(frame.assignPayload(frame_bytes, n));
    MeshCoreDecoder decoder{};
    DecodedPacket decoded{};
    assert(decoder.decode(frame, meshCoreProfile(), decoded) == DecodeResult::Matched);
    assert(decoded.payload_length == MeshCoreDecoder::kMaxPayloadBytes);
    assert(MeshCoreDecoder::payloadType(decoded) == MeshCorePayloadType::RawCustom);
}

void testOversizedEmptyAndInvalidInputsAreRefused()
{
    std::uint8_t out[kMaxFrameBytes]{};

    // One byte past the decoder's payload cap must be refused, not truncated.
    char long_text[kMeshCoreMaxRawTextBytes + 2]{};
    std::memset(long_text, 'b', kMeshCoreMaxRawTextBytes + 1);
    assert(encodeMeshCoreRawText(kLilysharkMeshCoreNodeId, long_text, out, sizeof(out)) == 0);

    assert(encodeMeshCoreRawText(kLilysharkMeshCoreNodeId, "", out, sizeof(out)) == 0);
    assert(encodeMeshCoreRawText(kLilysharkMeshCoreNodeId, nullptr, out, sizeof(out)) == 0);
    assert(encodeMeshCoreRawText(0, "hello", out, sizeof(out)) == 0);
    assert(encodeMeshCoreRawText(kLilysharkMeshCoreNodeId, "hello", nullptr, sizeof(out)) == 0);

    // A buffer one byte short of the frame must be refused whole.
    const char *text = "hi";
    const std::size_t needed =
        kMeshCoreRawTextEnvelopeBytes + kMeshCoreRawTextIdBytes + std::strlen(text);
    assert(encodeMeshCoreRawText(kLilysharkMeshCoreNodeId, text, out, needed - 1) == 0);
    assert(encodeMeshCoreRawText(kLilysharkMeshCoreNodeId, text, out, needed) == needed);
}

void testFrameIsNotClaimedUnderOtherProfiles()
{
    // The TX handler refuses to send unless the active profile is MeshCore;
    // this is why — the decoder only claims the frame under a MeshCore hint.
    std::uint8_t frame_bytes[kMaxFrameBytes]{};
    const std::size_t n =
        encodeMeshCoreRawText(kLilysharkMeshCoreNodeId, "hi", frame_bytes, sizeof(frame_bytes));
    assert(n > 0);
    RawFrame frame{};
    assert(frame.assignPayload(frame_bytes, n));
    RadioProfile meshtastic{};
    meshtastic.protocol_hint = ProtocolId::Meshtastic;
    MeshCoreDecoder decoder{};
    DecodedPacket decoded{};
    assert(decoder.decode(frame, meshtastic, decoded) == DecodeResult::NoMatch);
}

} // namespace

int main()
{
    testIdentityDerivesFromBootAnnounceNodeNumber();
    testEncodedTextRoundTripsThroughOwnDecoder();
    testLongestAllowedTextStillDecodes();
    testOversizedEmptyAndInvalidInputsAreRefused();
    testFrameIsNotClaimedUnderOtherProfiles();
    std::printf("meshcore tx tests passed\n");
    return 0;
}
