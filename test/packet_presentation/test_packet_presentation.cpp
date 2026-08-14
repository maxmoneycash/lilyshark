#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshtastic_decoder.h"
#include "lilyshark/protocols/reticulum_decoder.h"
#include "lilyshark/ui/packet_presentation.h"

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>

namespace {

using namespace lilyshark;

void expectLabel(const DecodedPacket &packet, const char *expected)
{
    assert(std::strcmp(packetKindLabel(packet), expected) == 0);
}

RawFrame frameFrom(const std::uint8_t *bytes, std::size_t length)
{
    RawFrame frame{};
    assert(frame.assignPayload(bytes, length));
    return frame;
}

DecodedPacket decodeMeshtastic(std::uint8_t channel_hash)
{
    std::uint8_t bytes[17] = {
        0xff, 0xff, 0xff, 0xff,
        0x78, 0x56, 0x34, 0x12,
        0xde, 0xc0, 0xad, 0x0b,
        0x03, 0x00, 0x00, 0x00,
        0xaa,
    };
    bytes[13] = channel_hash;

    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Meshtastic;
    MeshtasticDecoder decoder{};
    DecodedPacket packet{};
    assert(decoder.decode(frameFrom(bytes, sizeof(bytes)), profile, packet) == DecodeResult::Matched);
    return packet;
}

void testMalformedStateWinsOverProtocolType()
{
    RadioProfile profile{};
    DecodedPacket packet{};

    profile.protocol_hint = ProtocolId::Meshtastic;
    MeshtasticDecoder meshtastic{};
    std::uint8_t meshtastic_bytes[16] = {
        0xff, 0xff, 0xff, 0xff,
        0x00, 0x00, 0x00, 0x00,
        0xde, 0xc0, 0xad, 0x0b,
        0x03, 0x2a, 0x00, 0x00,
    };
    RawFrame meshtastic_frame = frameFrom(meshtastic_bytes, sizeof(meshtastic_bytes));
    meshtastic_frame.rf.crc = CrcStatus::Valid;
    assert(meshtastic.decode(meshtastic_frame, profile, packet) == DecodeResult::Malformed);
    assert(packet.hasField(FieldSource));
    expectLabel(packet, "BAD");

    FrameRecord record{};
    record.raw = meshtastic_frame;
    record.decoded = packet;
    assert(!contributesToNodeSummary(record));

    profile.protocol_hint = ProtocolId::MeshCore;
    MeshCoreDecoder meshcore{};
    const std::uint8_t short_text[] = {0x09};
    assert(meshcore.decode(frameFrom(short_text, sizeof(short_text)), profile, packet) ==
           DecodeResult::Malformed);
    expectLabel(packet, "BAD");

    profile.protocol_hint = ProtocolId::Reticulum;
    ReticulumDecoder reticulum{};
    const std::uint8_t short_reticulum[] = {0xa0};
    assert(reticulum.decode(frameFrom(short_reticulum, sizeof(short_reticulum)), profile, packet) ==
           DecodeResult::Malformed);
    expectLabel(packet, "BAD");
}

void testMeshCoreSpecialAndProtocolLabels()
{
    DecodedPacket packet{};
    packet.protocol = ProtocolId::MeshCore;
    packet.state = DecodeState::HeaderOnly;

    packet.protocol_flags = 0x40;
    expectLabel(packet, "UNSUP");

    for (std::uint8_t type = 12; type <= 14; ++type) {
        packet.protocol_flags = static_cast<std::uint32_t>(type) << 2U;
        expectLabel(packet, "RSVD");
    }

    struct ExpectedLabel {
        MeshCorePayloadType type;
        const char *label;
    };
    constexpr ExpectedLabel labels[] = {
        {MeshCorePayloadType::Request, "REQ"},
        {MeshCorePayloadType::Response, "RESP"},
        {MeshCorePayloadType::TextMessage, "TEXT"},
        {MeshCorePayloadType::Acknowledgement, "ACK"},
        {MeshCorePayloadType::Advertisement, "ADV"},
        {MeshCorePayloadType::GroupText, "GTXT"},
        {MeshCorePayloadType::GroupData, "GDATA"},
        {MeshCorePayloadType::AnonymousRequest, "ANON"},
        {MeshCorePayloadType::ReturnedPath, "PATH"},
        {MeshCorePayloadType::Trace, "TRACE"},
        {MeshCorePayloadType::Multipart, "MULTI"},
        {MeshCorePayloadType::Control, "CTRL"},
        {MeshCorePayloadType::RawCustom, "RAW"},
    };
    for (const ExpectedLabel &expected : labels) {
        packet.protocol_flags = static_cast<std::uint32_t>(expected.type) << 2U;
        expectLabel(packet, expected.label);
    }
}

void testReticulumProtocolLabels()
{
    DecodedPacket packet{};
    packet.protocol = ProtocolId::Reticulum;
    packet.state = DecodeState::HeaderOnly;

    packet.protocol_flags = 0x00010000U;
    expectLabel(packet, "SPLIT");

    packet.protocol_flags = 0x00000080U;
    expectLabel(packet, "IFAC");

    packet.protocol_flags = static_cast<std::uint8_t>(ReticulumPacketType::Announce);
    expectLabel(packet, "ANN");
    packet.protocol_flags = static_cast<std::uint8_t>(ReticulumPacketType::LinkRequest);
    expectLabel(packet, "LINK");
    packet.protocol_flags = static_cast<std::uint8_t>(ReticulumPacketType::Proof);
    expectLabel(packet, "PROOF");
    packet.protocol_flags = static_cast<std::uint8_t>(ReticulumPacketType::Data);
    expectLabel(packet, "DATA");
}

void testGenericAndDecodeStateLabels()
{
    DecodedPacket packet{};
    packet.state = DecodeState::HeaderOnly;

    struct ExpectedKindLabel {
        PacketKind kind;
        const char *label;
    };
    constexpr ExpectedKindLabel labels[] = {
        {PacketKind::Unknown, "RAW"},
        {PacketKind::EncryptedPayload, "ENC"},
        {PacketKind::Data, "DATA"},
        {PacketKind::Control, "CTRL"},
        {PacketKind::Advertisement, "ADV"},
        {PacketKind::OpaquePayload, "OPAQUE"},
    };
    for (const ExpectedKindLabel &expected : labels) {
        packet.kind = expected.kind;
        expectLabel(packet, expected.label);
    }

    assert(std::strcmp(decodeStateLabel(DecodeState::Unknown), "RAW") == 0);
    assert(std::strcmp(decodeStateLabel(DecodeState::HeaderOnly), "HEADER") == 0);
    assert(std::strcmp(decodeStateLabel(DecodeState::PayloadDecoded), "DECODED") == 0);
    assert(std::strcmp(decodeStateLabel(DecodeState::Malformed), "MALFORMED") == 0);
}

void testMeshtasticOpaqueLabelDoesNotDependOnChannelHash()
{
    const DecodedPacket zero_hash = decodeMeshtastic(0x00);
    const DecodedPacket full_hash = decodeMeshtastic(0xff);

    assert(zero_hash.channel == 0x00);
    assert(full_hash.channel == 0xff);
    assert(zero_hash.kind == PacketKind::OpaquePayload);
    assert(full_hash.kind == PacketKind::OpaquePayload);
    assert(!zero_hash.hasAttribute(AttributeEncrypted));
    assert(!full_hash.hasAttribute(AttributeEncrypted));
    expectLabel(zero_hash, "OPAQUE");
    expectLabel(full_hash, "OPAQUE");
}

void testNodeSummaryAdmissionPolicy()
{
    FrameRecord record{};
    record.raw.rf.crc = CrcStatus::Valid;
    record.decoded.state = DecodeState::HeaderOnly;
    record.decoded.present_fields = FieldSource;
    record.decoded.source = 0x12345678U;
    assert(contributesToNodeSummary(record));

    record.raw.rf.crc = CrcStatus::Invalid;
    assert(!contributesToNodeSummary(record));

    record.raw.rf.crc = CrcStatus::Valid;
    record.decoded.state = DecodeState::Malformed;
    assert(!contributesToNodeSummary(record));

    record.decoded.state = DecodeState::HeaderOnly;
    record.decoded.present_fields = FieldNone;
    assert(!contributesToNodeSummary(record));

    record.decoded.present_fields = FieldSource;
    record.decoded.source = 0U;
    assert(!contributesToNodeSummary(record));

    record.raw.rf.crc = CrcStatus::NotPresent;
    record.decoded.source = 1U;
    assert(contributesToNodeSummary(record));
}

void testExistingNodeCrcErrorPolicy()
{
    FrameRecord record{};
    record.raw.rf.crc = CrcStatus::Invalid;
    record.decoded.protocol = ProtocolId::Meshtastic;
    record.decoded.state = DecodeState::HeaderOnly;
    record.decoded.present_fields = FieldSource;
    record.decoded.source = 0x12345678U;

    // A bad frame before the first valid identity cannot create or update a
    // node. The same frame can count only after that identity is established.
    assert(!contributesToNodeSummary(record));
    assert(!contributesToExistingNodeCrcErrors(record, false, ProtocolId::Meshtastic,
                                               0x12345678U));
    assert(contributesToExistingNodeCrcErrors(record, true, ProtocolId::Meshtastic,
                                              0x12345678U));
    assert(!contributesToExistingNodeCrcErrors(record, true, ProtocolId::MeshCore,
                                               0x12345678U));
    assert(!contributesToExistingNodeCrcErrors(record, true, ProtocolId::Meshtastic,
                                               0x87654321U));

    record.decoded.state = DecodeState::Malformed;
    assert(!contributesToExistingNodeCrcErrors(record, true, ProtocolId::Meshtastic,
                                               0x12345678U));
    record.decoded.state = DecodeState::HeaderOnly;
    record.decoded.present_fields = FieldNone;
    assert(!contributesToExistingNodeCrcErrors(record, true, ProtocolId::Meshtastic,
                                               0x12345678U));
    record.decoded.present_fields = FieldSource;
    record.raw.rf.crc = CrcStatus::Valid;
    assert(!contributesToExistingNodeCrcErrors(record, true, ProtocolId::Meshtastic,
                                               0x12345678U));

    assert(incrementedNodeCrcErrorCount(0U) == 1U);
    const std::uint16_t maximum = std::numeric_limits<std::uint16_t>::max();
    assert(incrementedNodeCrcErrorCount(static_cast<std::uint16_t>(maximum - 1U)) == maximum);
    assert(incrementedNodeCrcErrorCount(maximum) == maximum);
}

} // namespace

int main()
{
    testMalformedStateWinsOverProtocolType();
    testMeshCoreSpecialAndProtocolLabels();
    testReticulumProtocolLabels();
    testGenericAndDecodeStateLabels();
    testMeshtasticOpaqueLabelDoesNotDependOnChannelHash();
    testNodeSummaryAdmissionPolicy();
    testExistingNodeCrcErrorPolicy();
    std::puts("packet presentation tests passed");
    return 0;
}
