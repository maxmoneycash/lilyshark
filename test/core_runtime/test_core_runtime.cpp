#include "lilyshark/core/capture_runtime.h"
#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshtastic_decoder.h"
#include "lilyshark/protocols/reticulum_decoder.h"

#include <cassert>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;

class NeverDecoder final : public PacketDecoder
{
  public:
    ProtocolId protocol() const noexcept override { return ProtocolId::Custom; }

    DecodeResult decode(const RawFrame &, const RadioProfile &, DecodedPacket &) const noexcept override
    {
        return DecodeResult::NoMatch;
    }
};

RawFrame makeFrame(std::uint8_t marker)
{
    RawFrame frame{};
    const std::uint8_t bytes[] = {marker};
    assert(frame.assignPayload(bytes, sizeof(bytes)));
    frame.rf.timestamp_us = marker;
    return frame;
}

void testRawFrameMetadataAndTruncation()
{
    std::uint8_t bytes[kMaxFrameBytes + 1]{};
    bytes[0] = 0x42;
    bytes[kMaxFrameBytes - 1] = 0x24;

    RawFrame frame{};
    frame.rf.center_frequency_hz = 915000000;
    frame.rf.bandwidth_hz = 250000;
    frame.rf.present_fields = RfFieldFrequency | RfFieldBandwidth | RfFieldSpreadingFactor | RfFieldCodingRate |
                              RfFieldRssi | RfFieldSnr | RfFieldRadioStatus;
    frame.rf.spreading_factor = 10;
    frame.rf.coding_rate_denominator = 6;
    frame.rf.rssi_dbm_x10 = -987;
    frame.rf.snr_db_x10 = -72;
    frame.rf.crc = CrcStatus::Invalid;

    assert(!frame.assignPayload(bytes, sizeof(bytes)));
    assert(frame.captured_length == kMaxFrameBytes);
    assert(frame.original_length == kMaxFrameBytes + 1);
    assert(frame.wasTruncated());
    assert(frame.bytes[0] == 0x42);
    assert(frame.bytes[kMaxFrameBytes - 1] == 0x24);
    assert(frame.rf.center_frequency_hz == 915000000);
    assert(frame.rf.hasField(RfFieldRssi));
    assert(!frame.rf.hasField(RfFieldTxPower));
    assert(frame.rf.crc == CrcStatus::Invalid);
}

void testFrameStoreWrapsInChronologicalOrder()
{
    FrameStore<2> store{};
    DecodedPacket decoded{};
    assert(store.push(makeFrame(1), decoded) == 1);
    assert(store.push(makeFrame(2), decoded) == 2);
    assert(store.push(makeFrame(3), decoded) == 3);

    assert(store.size() == 2);
    assert(store.totalSeen() == 3);
    assert(store.droppedCount() == 1);
    assert(store.at(0)->raw.bytes[0] == 2);
    assert(store.at(1)->raw.bytes[0] == 3);
    assert(store.newest()->sequence == 3);
    assert(store.newest(1)->sequence == 2);
    assert(store.newest(2) == nullptr);
}

RawFrame makeMeshtasticFrame()
{
    // to=0xffffffff, from=0x12345678, id=0x0badc0de,
    // hop_limit=3, want_ack, via_mqtt, hop_start=5.
    const std::uint8_t bytes[] = {
        0xff, 0xff, 0xff, 0xff, 0x78, 0x56, 0x34, 0x12,
        0xde, 0xc0, 0xad, 0x0b, 0xbb, 0x2a, 0x56, 0x78,
        0xaa, 0xbb, 0xcc,
    };
    RawFrame frame{};
    assert(frame.assignPayload(bytes, sizeof(bytes)));
    return frame;
}

void testUnknownFallbackDoesNotGuessProtocol()
{
    MeshtasticDecoder meshtastic{};
    DecoderRegistry registry{};
    assert(registry.add(meshtastic));

    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Unknown;
    DecodedPacket decoded{};
    const DecodeResult result = registry.decode(makeMeshtasticFrame(), profile, decoded);

    assert(result == DecodeResult::NoMatch);
    assert(decoded.protocol == ProtocolId::Unknown);
    assert(decoded.state == DecodeState::Unknown);
    assert(decoded.hasField(FieldPayload));
    assert(decoded.payload_offset == 0);
    assert(decoded.payload_length == 19);
}

void testDecoderRegistryHasFixedCapacity()
{
    DecoderRegistry registry{};
    NeverDecoder decoders[DecoderRegistry::kCapacity + 1]{};
    for (std::size_t index = 0; index < DecoderRegistry::kCapacity; ++index) {
        assert(registry.add(decoders[index]));
    }
    assert(!registry.add(decoders[DecoderRegistry::kCapacity]));
    assert(registry.size() == DecoderRegistry::kCapacity);
}

void testMeshtasticOuterHeader()
{
    MeshtasticDecoder meshtastic{};
    DecoderRegistry registry{};
    assert(registry.add(meshtastic));
    assert(registry.add(meshtastic));
    assert(registry.size() == 1);

    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Meshtastic;
    DecodedPacket decoded{};
    const DecodeResult result = registry.decode(makeMeshtasticFrame(), profile, decoded);

    assert(result == DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::Meshtastic);
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(decoded.kind == PacketKind::OpaquePayload);
    assert(decoded.destination == 0xffffffffU);
    assert(decoded.source == 0x12345678U);
    assert(decoded.packet_id == 0x0badc0deU);
    assert(decoded.protocol_flags == 0xbb);
    assert(decoded.channel == 0x2a);
    assert(decoded.hop_limit == 3);
    assert(decoded.hop_start == 5);
    assert(decoded.next_hop == 0x56);
    assert(decoded.relay_node == 0x78);
    assert(decoded.payload_offset == MeshtasticDecoder::kOuterHeaderLength);
    assert(decoded.payload_length == 3);
    assert(decoded.hasAttribute(AttributeBroadcast));
    assert(decoded.hasAttribute(AttributeAcknowledgementRequested));
    assert(decoded.hasAttribute(AttributeViaMqtt));
    assert(!decoded.hasAttribute(AttributeEncrypted));
}

void testMeshtasticMalformedFramesRemainInspectable()
{
    MeshtasticDecoder meshtastic{};
    DecoderRegistry registry{};
    assert(registry.add(meshtastic));
    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Meshtastic;

    RawFrame short_frame{};
    const std::uint8_t short_bytes[] = {1, 2, 3};
    assert(short_frame.assignPayload(short_bytes, sizeof(short_bytes)));
    DecodedPacket decoded{};
    assert(registry.decode(short_frame, profile, decoded) == DecodeResult::Malformed);
    assert(decoded.protocol == ProtocolId::Meshtastic);
    assert(decoded.state == DecodeState::Malformed);
    assert(decoded.payload_length == 3);

    RawFrame zero_sender = makeMeshtasticFrame();
    zero_sender.bytes[4] = 0;
    zero_sender.bytes[5] = 0;
    zero_sender.bytes[6] = 0;
    zero_sender.bytes[7] = 0;
    assert(registry.decode(zero_sender, profile, decoded) == DecodeResult::Malformed);
    assert(decoded.source == 0);
    assert(decoded.packet_id == 0x0badc0deU);
}

void testMeshCoreAckAndTransportEnvelope()
{
    MeshCoreDecoder meshcore{};
    DecoderRegistry registry{};
    assert(registry.add(meshcore));
    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::MeshCore;

    // Derived from the v1 format: flood ACK, empty path, LE checksum.
    const std::uint8_t ack_bytes[] = {0x0d, 0x00, 0x78, 0x56, 0x34, 0x12};
    RawFrame ack{};
    assert(ack.assignPayload(ack_bytes, sizeof(ack_bytes)));
    DecodedPacket decoded{};
    assert(registry.decode(ack, profile, decoded) == DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::MeshCore);
    assert(decoded.state == DecodeState::PayloadDecoded);
    assert(decoded.kind == PacketKind::Control);
    assert(MeshCoreDecoder::routeType(decoded) == MeshCoreRouteType::Flood);
    assert(MeshCoreDecoder::payloadType(decoded) == MeshCorePayloadType::Acknowledgement);
    assert(MeshCoreDecoder::payloadVersion(decoded) == 0);
    assert(MeshCoreDecoder::pathHashCount(decoded) == 0);
    assert(MeshCoreDecoder::pathHashSize(decoded) == 1);
    assert(MeshCoreDecoder::acknowledgementChecksum(decoded) == 0x12345678U);
    assert(decoded.payload_offset == 2);
    assert(decoded.payload_length == 4);
    assert(!decoded.hasField(FieldPacketId));

    // Transport-direct control packet with two two-byte path hashes.
    const std::uint8_t transport_bytes[] = {
        0x2f, 0x34, 0x12, 0xcd, 0xab, 0x42, 0xaa, 0xbb, 0xcc, 0xdd, 0x80,
    };
    RawFrame transport{};
    assert(transport.assignPayload(transport_bytes, sizeof(transport_bytes)));
    assert(registry.decode(transport, profile, decoded) == DecodeResult::Matched);
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(decoded.kind == PacketKind::Control);
    assert(MeshCoreDecoder::routeType(decoded) == MeshCoreRouteType::TransportDirect);
    assert(MeshCoreDecoder::payloadType(decoded) == MeshCorePayloadType::Control);
    assert(MeshCoreDecoder::hasTransportCodes(decoded));
    assert(MeshCoreDecoder::transportCodeOne(decoded) == 0x1234);
    assert(MeshCoreDecoder::transportCodeTwo(decoded) == 0xabcd);
    assert(MeshCoreDecoder::encodedPathLength(decoded) == 0x42);
    assert(MeshCoreDecoder::pathHashCount(decoded) == 2);
    assert(MeshCoreDecoder::pathHashSize(decoded) == 2);
    assert(decoded.payload_offset == 10);
    assert(decoded.payload_length == 1);
    assert(!decoded.hasField(FieldSource));
    assert(!decoded.hasField(FieldDestination));
}

void testMeshCoreProtectedAndMalformedFrames()
{
    MeshCoreDecoder meshcore{};
    DecoderRegistry registry{};
    assert(registry.add(meshcore));
    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::MeshCore;
    DecodedPacket decoded{};

    // Flood group-text packet: channel hash, two-byte MAC, one AES block.
    std::uint8_t group_bytes[21]{};
    group_bytes[0] = 0x15;
    group_bytes[1] = 0x00;
    group_bytes[2] = 0x42;
    group_bytes[3] = 0xaa;
    group_bytes[4] = 0xbb;
    RawFrame group{};
    assert(group.assignPayload(group_bytes, sizeof(group_bytes)));
    assert(registry.decode(group, profile, decoded) == DecodeResult::Matched);
    assert(decoded.kind == PacketKind::EncryptedPayload);
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(decoded.hasAttribute(AttributeEncrypted));
    assert(decoded.hasField(FieldChannel));
    assert(decoded.channel == 0x42);

    const std::uint8_t short_ack_bytes[] = {0x0d, 0x00, 1, 2, 3};
    RawFrame short_ack{};
    assert(short_ack.assignPayload(short_ack_bytes, sizeof(short_ack_bytes)));
    assert(registry.decode(short_ack, profile, decoded) == DecodeResult::Malformed);
    assert(decoded.state == DecodeState::Malformed);

    const std::uint8_t short_trace_bytes[] = {0x25, 0x00, 0xaa};
    RawFrame short_trace{};
    assert(short_trace.assignPayload(short_trace_bytes, sizeof(short_trace_bytes)));
    assert(registry.decode(short_trace, profile, decoded) == DecodeResult::Malformed);
    assert(decoded.state == DecodeState::Malformed);

    const std::uint8_t trace_bytes[] = {
        0x25, 0x00,
        0x01, 0x02, 0x03, 0x04, // tag
        0x05, 0x06, 0x07, 0x08, // auth
        0x09,                   // flags
    };
    RawFrame trace{};
    assert(trace.assignPayload(trace_bytes, sizeof(trace_bytes)));
    assert(registry.decode(trace, profile, decoded) == DecodeResult::Matched);
    assert(decoded.kind == PacketKind::Control);
    assert(MeshCoreDecoder::payloadType(decoded) == MeshCorePayloadType::Trace);

    const std::uint8_t reserved_bytes[] = {0x31, 0x00, 0xaa};
    RawFrame reserved{};
    assert(reserved.assignPayload(reserved_bytes, sizeof(reserved_bytes)));
    assert(registry.decode(reserved, profile, decoded) == DecodeResult::Matched);
    assert(decoded.kind == PacketKind::Unknown);
    assert(static_cast<std::uint8_t>(MeshCoreDecoder::payloadType(decoded)) == 12U);

    const std::uint8_t invalid_path_bytes[] = {0x01, 0xc1, 0xaa};
    RawFrame invalid_path{};
    assert(invalid_path.assignPayload(invalid_path_bytes, sizeof(invalid_path_bytes)));
    assert(registry.decode(invalid_path, profile, decoded) == DecodeResult::Malformed);

    const std::uint8_t truncated_transport_bytes[] = {0x00, 0x34, 0x12};
    RawFrame truncated_transport{};
    assert(truncated_transport.assignPayload(truncated_transport_bytes, sizeof(truncated_transport_bytes)));
    assert(registry.decode(truncated_transport, profile, decoded) == DecodeResult::Malformed);

    // Future payload versions are recognized but not interpreted as v1.
    const std::uint8_t future_bytes[] = {0x4d};
    RawFrame future{};
    assert(future.assignPayload(future_bytes, sizeof(future_bytes)));
    assert(registry.decode(future, profile, decoded) == DecodeResult::Matched);
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(MeshCoreDecoder::payloadVersion(decoded) == 1);
    assert(decoded.payload_offset == 0);

    RadioProfile wrong_profile{};
    wrong_profile.protocol_hint = ProtocolId::Reticulum;
    assert(registry.decode(group, wrong_profile, decoded) == DecodeResult::NoMatch);
}

void testReticulumRNodeHeaderOneAndTwo()
{
    ReticulumDecoder reticulum{};
    DecoderRegistry registry{};
    assert(registry.add(reticulum));
    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Reticulum;

    // RNode shim + clear HEADER_1 PLAIN/DATA packet with payload "hi".
    const std::uint8_t header_one_bytes[] = {
        0xa0, 0x08, 0x02,
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x00, 0x68, 0x69,
    };
    RawFrame header_one{};
    assert(header_one.assignPayload(header_one_bytes, sizeof(header_one_bytes)));
    DecodedPacket decoded{};
    assert(registry.decode(header_one, profile, decoded) == DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::Reticulum);
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(decoded.kind == PacketKind::Data);
    assert(ReticulumDecoder::rnodeShim(decoded) == 0xa0);
    assert(!ReticulumDecoder::isRNodeSplitFrame(decoded));
    assert(!ReticulumDecoder::isIfacProtected(decoded));
    assert(ReticulumDecoder::headerType(decoded) == ReticulumHeaderType::HeaderOne);
    assert(ReticulumDecoder::destinationType(decoded) == ReticulumDestinationType::Plain);
    assert(ReticulumDecoder::packetType(decoded) == ReticulumPacketType::Data);
    assert(ReticulumDecoder::observedHops(decoded) == 2);
    assert(ReticulumDecoder::destinationHashPrefix(decoded) == 0x00010203U);
    assert(!decoded.hasField(FieldDestination));
    assert(ReticulumDecoder::context(decoded) == 0);
    assert(ReticulumDecoder::headerLength(decoded) == ReticulumDecoder::kHeaderOneLength);
    assert(decoded.payload_offset == 20);
    assert(decoded.payload_length == 2);
    assert(!decoded.hasAttribute(AttributeEncrypted));

    std::uint8_t header_two_bytes[39]{};
    header_two_bytes[0] = 0xb0;
    header_two_bytes[1] = 0x50; // HEADER_2, transport, SINGLE, DATA
    header_two_bytes[2] = 3;
    for (std::uint8_t index = 0; index < 16; ++index) {
        header_two_bytes[3 + index] = static_cast<std::uint8_t>(0x10 + index);
        header_two_bytes[19 + index] = static_cast<std::uint8_t>(0x20 + index);
    }
    header_two_bytes[35] = 0x09;
    header_two_bytes[36] = 1;
    header_two_bytes[37] = 2;
    header_two_bytes[38] = 3;
    RawFrame header_two{};
    assert(header_two.assignPayload(header_two_bytes, sizeof(header_two_bytes)));
    assert(registry.decode(header_two, profile, decoded) == DecodeResult::Matched);
    assert(ReticulumDecoder::headerType(decoded) == ReticulumHeaderType::HeaderTwo);
    assert(ReticulumDecoder::isTransportPacket(decoded));
    assert(ReticulumDecoder::destinationType(decoded) == ReticulumDestinationType::Single);
    assert(ReticulumDecoder::transportIdPrefix(decoded) == 0x10111213U);
    assert(ReticulumDecoder::destinationHashPrefix(decoded) == 0x20212223U);
    assert(ReticulumDecoder::context(decoded) == 0x09);
    assert(ReticulumDecoder::headerLength(decoded) == ReticulumDecoder::kHeaderTwoLength);
    assert(decoded.payload_offset == 36);
    assert(decoded.payload_length == 3);
    assert(decoded.kind == PacketKind::EncryptedPayload);
    assert(decoded.hasAttribute(AttributeEncrypted));
    assert(!decoded.hasField(FieldSource));
    assert(!decoded.hasField(FieldDestination));
}

void testReticulumProtectedSplitAndMalformedFrames()
{
    ReticulumDecoder reticulum{};
    DecoderRegistry registry{};
    assert(registry.add(reticulum));
    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Reticulum;
    DecodedPacket decoded{};

    std::uint8_t ifac_bytes[21]{};
    ifac_bytes[0] = 0xc0;
    ifac_bytes[1] = 0x80;
    RawFrame ifac{};
    assert(ifac.assignPayload(ifac_bytes, sizeof(ifac_bytes)));
    assert(registry.decode(ifac, profile, decoded) == DecodeResult::Matched);
    assert(ReticulumDecoder::isIfacProtected(decoded));
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(decoded.kind == PacketKind::EncryptedPayload);
    assert(decoded.hasAttribute(AttributeEncrypted));
    assert(decoded.payload_offset == 1);
    assert(decoded.payload_length == 20);
    assert(ReticulumDecoder::headerLength(decoded) == 0);

    const std::uint8_t split_bytes[] = {0xd1, 0x08, 0x02};
    RawFrame split{};
    assert(split.assignPayload(split_bytes, sizeof(split_bytes)));
    assert(registry.decode(split, profile, decoded) == DecodeResult::Matched);
    assert(ReticulumDecoder::isRNodeSplitFrame(decoded));
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(decoded.payload_offset == 1);
    assert(decoded.payload_length == 2);
    assert(ReticulumDecoder::headerLength(decoded) == 0);

    const std::uint8_t shim_only_bytes[] = {0xa0};
    RawFrame shim_only{};
    assert(shim_only.assignPayload(shim_only_bytes, sizeof(shim_only_bytes)));
    assert(registry.decode(shim_only, profile, decoded) == DecodeResult::Malformed);

    const std::uint8_t short_header_one_bytes[] = {0xa0, 0x08, 0x02};
    RawFrame short_header_one{};
    assert(short_header_one.assignPayload(short_header_one_bytes, sizeof(short_header_one_bytes)));
    assert(registry.decode(short_header_one, profile, decoded) == DecodeResult::Malformed);

    const std::uint8_t short_header_two_bytes[] = {0xa0, 0x40, 0x02};
    RawFrame short_header_two{};
    assert(short_header_two.assignPayload(short_header_two_bytes, sizeof(short_header_two_bytes)));
    assert(registry.decode(short_header_two, profile, decoded) == DecodeResult::Malformed);

    std::uint8_t excessive_hops_bytes[20]{};
    excessive_hops_bytes[0] = 0xa0;
    excessive_hops_bytes[1] = 0x08;
    excessive_hops_bytes[2] = 128;
    RawFrame excessive_hops{};
    assert(excessive_hops.assignPayload(excessive_hops_bytes, sizeof(excessive_hops_bytes)));
    assert(registry.decode(excessive_hops, profile, decoded) == DecodeResult::Malformed);

    const std::uint8_t short_ifac_bytes[] = {0xa0, 0x80, 0x00};
    RawFrame short_ifac{};
    assert(short_ifac.assignPayload(short_ifac_bytes, sizeof(short_ifac_bytes)));
    assert(registry.decode(short_ifac, profile, decoded) == DecodeResult::Malformed);

    RadioProfile wrong_profile{};
    wrong_profile.protocol_hint = ProtocolId::MeshCore;
    assert(registry.decode(ifac, wrong_profile, decoded) == DecodeResult::NoMatch);
}

void testCaptureRuntimeDecodesAndStores()
{
    CaptureRuntime<2> runtime{};
    MeshtasticDecoder meshtastic{};
    assert(runtime.addDecoder(meshtastic));

    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Meshtastic;
    const IngestResult result = runtime.ingest(makeMeshtasticFrame(), profile);

    assert(result.decode_result == DecodeResult::Matched);
    assert(result.sequence == 1);
    assert(runtime.frames().size() == 1);
    assert(runtime.frames().newest()->decoded.protocol == ProtocolId::Meshtastic);
}

} // namespace

int main()
{
    testRawFrameMetadataAndTruncation();
    testFrameStoreWrapsInChronologicalOrder();
    testUnknownFallbackDoesNotGuessProtocol();
    testDecoderRegistryHasFixedCapacity();
    testMeshtasticOuterHeader();
    testMeshtasticMalformedFramesRemainInspectable();
    testMeshCoreAckAndTransportEnvelope();
    testMeshCoreProtectedAndMalformedFrames();
    testReticulumRNodeHeaderOneAndTwo();
    testReticulumProtectedSplitAndMalformedFrames();
    testCaptureRuntimeDecodesAndStores();
    std::puts("core runtime tests passed");
    return 0;
}
