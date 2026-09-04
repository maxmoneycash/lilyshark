// The BLE protobuf conversation, checked against the wire format itself.
//
// The encode side is compared to byte vectors computed by hand from the
// protobuf encoding rules and the field numbers in meshtastic/protobufs, so
// a mistake shared between our writer and our reader cannot pass unnoticed.
// The parse side is fed hand-assembled ToRadio bytes for the same reason.

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>

#include "lilyshark/core/mesh_identity.h"
#include "lilyshark/protocols/meshtastic_api.h"

using namespace lilyshark;

namespace {

void testMyInfoExactBytes()
{
    setLocalMeshtasticNodeNum(1);
    std::uint8_t out[64]{};
    const std::size_t length = encodeApiConfigMessage(0, 0x42, "2.6.0", nullptr, 0,
                               nullptr, 0, out, sizeof(out));
    // FromRadio.my_info (field 3, len-delimited): tag 0x1a, length 6.
    // MyNodeInfo.my_node_num (field 1 varint) = 1: 0x08 0x01.
    // MyNodeInfo.min_app_version (field 11 varint) = 30200: 0x58 0xf8 0xeb 0x01.
    const std::uint8_t expected[] = {0x1a, 0x06, 0x08, 0x01, 0x58, 0xf8, 0xeb, 0x01};
    assert(length == sizeof(expected));
    assert(std::memcmp(out, expected, length) == 0);
}

void testConfigCompleteEchoesNonce()
{
    std::uint8_t out[16]{};
    // With no nodes the sequence is my_info, metadata, channel, lora, complete.
    const std::size_t length = encodeApiConfigMessage(4, 0xa5, "2.6.0", nullptr, 0,
                               nullptr, 0, out, sizeof(out));
    // FromRadio.config_complete_id (field 7 varint) = 0xa5: 0x38 0xa5 0x01.
    const std::uint8_t expected[] = {0x38, 0xa5, 0x01};
    assert(length == sizeof(expected));
    assert(std::memcmp(out, expected, length) == 0);
    // A zero nonce must still be echoed, or the app waits forever.
    const std::size_t zero_length = encodeApiConfigMessage(4, 0, "2.6.0", nullptr, 0,
                               nullptr, 0, out, sizeof(out));
    const std::uint8_t zero_expected[] = {0x38, 0x00};
    assert(zero_length == sizeof(zero_expected));
    assert(std::memcmp(out, zero_expected, zero_length) == 0);
}

void testSequenceShapeAndTermination()
{
    setLocalMeshtasticNodeNum(0xcda172e0U);
    ApiNodeEntry nodes[2]{};
    nodes[0].num = 0xcda172e0U;
    std::snprintf(nodes[0].label, sizeof(nodes[0].label), "1B99");
    nodes[0].is_self = true;
    nodes[1].num = 0x96f61b44U;
    std::snprintf(nodes[1].label, sizeof(nodes[1].label), "96F61B44");
    nodes[1].has_snr = true;
    nodes[1].snr_x10 = -85;

    std::uint8_t out[512]{};
    // my_info, metadata, two node_info, channel, lora, complete = 7 messages.
    for (std::size_t index = 0; index < 7U; ++index) {
        const std::size_t length = encodeApiConfigMessage(index, 7, "2.6.0-lilyshark",
                                                          nodes, 2, nullptr, 0,
                                                          out, sizeof(out));
        assert(length > 0);
        assert(length <= sizeof(out));
    }
    assert(encodeApiConfigMessage(7, 7, "2.6.0-lilyshark", nodes, 2,
                               nullptr, 0, out,
                                  sizeof(out)) == 0);

    // The self node_info carries the user id string "!cda172e0" and T_DECK.
    const std::size_t self_length =
        encodeApiConfigMessage(2, 7, "2.6.0-lilyshark", nodes, 2,
                               nullptr, 0, out, sizeof(out));
    assert(self_length > 0);
    assert(std::memcmp(out, "\x22", 1) == 0);  // FromRadio.node_info tag
    bool found_id = false;
    for (std::size_t index = 0; index + 9U <= self_length; ++index) {
        if (std::memcmp(out + index, "!cda172e0", 9) == 0) found_id = true;
    }
    assert(found_id);
}

void testWantConfigParses()
{
    // ToRadio.want_config_id (field 3 varint) = 42: 0x18 0x2a.
    const std::uint8_t bytes[] = {0x18, 0x2a};
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::WantConfig);
    assert(message.want_config_id == 42);
}

void testPhoneTextParses()
{
    // ToRadio.packet{ to=0x11223344, want_ack=1, decoded{ portnum=1,
    // payload="hi" } }, assembled by hand:
    const std::uint8_t bytes[] = {
        0x0a, 0x0f,                          // ToRadio.packet, 15 bytes
        0x15, 0x44, 0x33, 0x22, 0x11,        // MeshPacket.to fixed32
        0x22, 0x06,                          // MeshPacket.decoded, 6 bytes
        0x08, 0x01,                          // Data.portnum = TEXT
        0x12, 0x02, 'h', 'i',                // Data.payload
        0x50, 0x01,                          // MeshPacket.want_ack
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::Text);
    assert(message.to_node == 0x11223344U);
    assert(message.want_ack);
    assert(std::strcmp(message.text, "hi") == 0);
}

void testEmptyPositionPayloadIsIgnoredButValid()
{
    // portnum = 3 (POSITION) with an EMPTY payload: no latitude, no
    // longitude, so there is no fix in it. Parses fine, acts on nothing.
    // This case used to stand for every position packet, because the deck
    // ignored the port entirely.
    const std::uint8_t bytes[] = {
        0x0a, 0x0b, 0x15, 0x44, 0x33, 0x22, 0x11,
        0x22, 0x04, 0x08, 0x03, 0x12, 0x00,
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::None);
}

void testPhonePositionParses()
{
    // Bytes generated rather than hand-written: the first version of this
    // test was hand-assembled and wrong, which is the same mistake in the
    // same place twice, so the vector is now produced by the encoder it is
    // meant to describe.
    //
    // ToRadio.packet{ decoded{ portnum=3, payload=Position{
    //   latitude_i=377785000 (37.7785 N), longitude_i=-1224218000 } } }
    const std::uint8_t bytes[] = {
        0x0a, 0x10, 0x22, 0x0e, 0x08, 0x03, 0x12, 0x0a,
        0x0d, 0xa8, 0x8a, 0x84, 0x16, 0x15, 0x70, 0xea,
        0x07, 0xb7,
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::Position);
    assert(message.latitude_i == 377785000);
    assert(message.longitude_i == -1224218000);
}

void testSwiftPositionVectorParses()
{
    // The EXACT bytes MeshtasticProto.encodePositionPacket produces, copied
    // from MeshtasticProtoTests.swift. The phone and the deck cannot import
    // each other's code, so this pair of assertions is the only thing holding
    // their idea of a Position together. If either drifts, one of the two
    // suites fails on a desk instead of the deck silently never learning
    // where it is.
    const std::uint8_t bytes[] = {
        0x0a, 0x15,                          // ToRadio.packet, 21 bytes
        0x15, 0xff, 0xff, 0xff, 0xff,        // MeshPacket.to = broadcast
        0x22, 0x0e,                          // MeshPacket.decoded, 14
        0x08, 0x03,                          // Data.portnum = POSITION
        0x12, 0x0a,                          // Data.payload, 10 bytes
        0x0d, 0xa8, 0x8a, 0x84, 0x16,        // Position.latitude_i
        0x15, 0x70, 0xea, 0x07, 0xb7,        // Position.longitude_i
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::Position);
    assert(message.latitude_i == 377785000);
    assert(message.longitude_i == -1224218000);
}

void testNullIslandIsNotAFix()
{
    // 0,0 is a real place in the Gulf of Guinea and also exactly what an
    // uninitialised struct looks like. A phone without a fix sends it, and a
    // deck that believed it would draw every unfixed phone on Null Island.
    const std::uint8_t bytes[] = {
        0x0a, 0x10, 0x22, 0x0e, 0x08, 0x03, 0x12, 0x0a,
        0x0d, 0x00, 0x00, 0x00, 0x00, 0x15, 0x00, 0x00,
        0x00, 0x00,
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::None);
}

void testOutOfRangePositionRefused()
{
    // Latitude beyond 90 degrees is a mis-scaled or malformed sender, not a
    // place. 0x7fffffff = 2147483647, well past 900000000.
    const std::uint8_t bytes[] = {
        0x0a, 0x10, 0x22, 0x0e, 0x08, 0x03, 0x12, 0x0a,
        0x0d, 0xff, 0xff, 0xff, 0x7f, 0x15, 0x70, 0xea,
        0x07, 0xb7,
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::None);
}

void testHalfAPositionIsNotAFix()
{
    // Latitude only. Half a coordinate places nothing.
    const std::uint8_t bytes[] = {
        0x0a, 0x0b, 0x22, 0x09, 0x08, 0x03, 0x12, 0x05,
        0x0d, 0xa8, 0x8a, 0x84, 0x16,
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::None);
}

void testChannelListIsAdvertisedWithNamesAndNoKeys()
{
    ApiChannelEntry channels[3]{};
    std::snprintf(channels[0].name, sizeof(channels[0].name), "LongFast");
    channels[0].is_default = true;
    std::snprintf(channels[1].name, sizeof(channels[1].name), "NORTH RIDGE");
    std::snprintf(channels[2].name, sizeof(channels[2].name), "RIVER");

    std::uint8_t out[512]{};
    // my_info, metadata, three channels, lora, complete = 7 with no nodes.
    for (std::size_t index = 0; index < 7U; ++index) {
        assert(encodeApiConfigMessage(index, 9, "2.6.0", nullptr, 0, channels, 3,
                                      out, sizeof(out)) > 0);
    }
    assert(encodeApiConfigMessage(7, 9, "2.6.0", nullptr, 0, channels, 3, out,
                                  sizeof(out)) == 0);

    // Separate buffers: the two messages are compared against each other, and
    // reusing one would have the second encode quietly overwrite the first.
    std::uint8_t secondary_bytes[512]{};
    std::uint8_t primary_bytes[512]{};

    // The secondary channels carry their names...
    const std::size_t second =
        encodeApiConfigMessage(3, 9, "2.6.0", nullptr, 0, channels, 3,
                               secondary_bytes, sizeof(secondary_bytes));
    bool found_name = false;
    for (std::size_t i = 0; i + 11U <= second; ++i) {
        if (std::memcmp(secondary_bytes + i, "NORTH RIDGE", 11) == 0) found_name = true;
    }
    assert(found_name);

    // ...and NOT the key. Only the primary carries a psk, and only the
    // one-byte 0x01 that names the published default. A phone that never
    // holds a key cannot leak one.
    const std::size_t primary =
        encodeApiConfigMessage(2, 9, "2.6.0", nullptr, 0, channels, 3,
                               primary_bytes, sizeof(primary_bytes));
    bool primary_has_psk = false;
    for (std::size_t i = 0; i + 3U <= primary; ++i) {
        // Settings.psk is field 2, wire 2: tag 0x12, length 1, value 0x01.
        if (primary_bytes[i] == 0x12 && primary_bytes[i + 1] == 0x01 &&
            primary_bytes[i + 2] == 0x01) {
            primary_has_psk = true;
        }
    }
    assert(primary_has_psk);
    for (std::size_t i = 0; i + 3U <= second; ++i) {
        // No psk on a secondary channel, of any length.
        assert(!(secondary_bytes[i] == 0x12 && secondary_bytes[i + 1] == 0x01 &&
                 secondary_bytes[i + 2] == 0x01));
    }
}

void testADeckWithNoStoredKeysStillAdvertisesTheDefault()
{
    // A phone shown an empty channel list would have nothing to send on, so
    // the primary is emitted even when the caller passes none.
    std::uint8_t out[512]{};
    assert(encodeApiConfigMessage(2, 9, "2.6.0", nullptr, 0, nullptr, 0, out,
                                  sizeof(out)) > 0);
}

void testPhoneChannelSelectionParses()
{
    // MeshPacket.channel is field 3, varint. It used to be dropped, so every
    // message the phone sent went out on the default channel whatever the
    // operator picked.
    const std::uint8_t bytes[] = {
        0x0a, 0x0a,                          // ToRadio.packet, 10 bytes
        0x18, 0x02,                          // MeshPacket.channel = 2
        0x22, 0x06,                          // MeshPacket.decoded, 6 bytes
        0x08, 0x01,                          // Data.portnum = TEXT
        0x12, 0x02, 0x68, 0x69,              // Data.payload "hi"
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::Text);
    assert(message.channel == 2U);
    assert(std::strcmp(message.text, "hi") == 0);
}

void testChannelDefaultsToThePrimary()
{
    // A phone that names no channel means the primary, which is what index 0
    // already is -- not "unset" and not a refusal.
    const std::uint8_t bytes[] = {
        0x0a, 0x08, 0x22, 0x06, 0x08, 0x01, 0x12, 0x02, 'h', 'i',
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::Text);
    assert(message.channel == 0U);
}

void testMalformedBytesRefuse()
{
    // A length-delimited field promising more bytes than exist.
    const std::uint8_t truncated[] = {0x0a, 0x7f, 0x15, 0x44};
    ApiToRadio message{};
    assert(!parseApiToRadio(truncated, sizeof(truncated), message));
    assert(!parseApiToRadio(nullptr, 4, message));
    assert(!parseApiToRadio(truncated, 0, message));
}

void testHeardTextRoundTripsThroughParse()
{
    // What we hand the phone must itself be a well-formed FromRadio whose
    // packet our own ToRadio MeshPacket parser can walk -- same message type,
    // so the parser doubles as an independent check on the encoder.
    std::uint8_t out[512]{};
    const std::size_t length = encodeApiTextPacket(
        0x96f61b44U, 0xffffffffU, 77, "TRACK IS WASHED OUT", -651, -85, out,
        sizeof(out));
    assert(length > 0);
    // FromRadio.packet is field 2; reuse the ToRadio parser on its payload by
    // rewriting the outer tag from field 2 to field 1 (both len-delimited).
    assert(out[0] == 0x12);
    out[0] = 0x0a;
    ApiToRadio message{};
    assert(parseApiToRadio(out, length, message));
    assert(message.kind == ApiToRadio::Kind::Text);
    assert(message.to_node == 0xffffffffU);
    assert(std::strcmp(message.text, "TRACK IS WASHED OUT") == 0);
}

void testLiveNodeInfoMatchesTheDump()
{
    // The phone hears about a node two ways -- the connect-time dump and the
    // live announcement -- and they must be byte-identical for the same node,
    // or the app would see one neighbour as two shapes.
    setLocalMeshtasticNodeNum(0xcda172e0U);
    ApiNodeEntry nodes[2]{};
    nodes[0].num = 0xcda172e0U;
    std::snprintf(nodes[0].label, sizeof(nodes[0].label), "1B99");
    nodes[0].is_self = true;
    nodes[1].num = 0x96f61b44U;
    std::snprintf(nodes[1].label, sizeof(nodes[1].label), "96F61B44");
    nodes[1].has_snr = true;
    nodes[1].snr_x10 = -85;

    std::uint8_t from_dump[256]{};
    const std::size_t dump_length =
        encodeApiConfigMessage(3, 7, "2.6.0", nodes, 2,
                               nullptr, 0, from_dump, sizeof(from_dump));
    std::uint8_t standalone[256]{};
    const std::size_t live_length =
        encodeApiNodeInfo(nodes[1], standalone, sizeof(standalone));
    assert(dump_length > 0);
    assert(live_length == dump_length);
    assert(std::memcmp(from_dump, standalone, live_length) == 0);
}

void testPositionExactBytes()
{
    // Position{latitude_i, longitude_i} for 37.3952800 N, 122.0841600 W --
    // sfixed32 little-endian in 1e-7 degrees, computed by hand:
    // 373952800 = 0x164a1120, -1220841600 = 0xb73b6f80 two's complement,
    // both little-endian on the wire (computed, not eyeballed -- the first
    // draft of this vector transposed digits and failed its own test).
    std::uint8_t out[128]{};
    const std::size_t length = encodeApiPositionPacket(
        0x96f61b44U, 9, 373952800, -1220841600, 0, 0, out, sizeof(out));
    assert(length > 0);
    const std::uint8_t position[] = {
        0x0d, 0x20, 0x11, 0x4a, 0x16,  // latitude_i, field 1 fixed32
        0x15, 0x80, 0x6f, 0x3b, 0xb7,  // longitude_i, field 2 fixed32
    };
    bool found = false;
    for (std::size_t index = 0; index + sizeof(position) <= length; ++index) {
        if (std::memcmp(out + index, position, sizeof(position)) == 0) found = true;
    }
    assert(found);
    // The equator-and-meridian point still writes both coordinates: zero is
    // a place, not an absence.
    const std::size_t zero_length =
        encodeApiPositionPacket(1, 2, 0, 0, 0, 0, out, sizeof(out));
    assert(zero_length > 0);
    const std::uint8_t zero_position[] = {
        0x0d, 0x00, 0x00, 0x00, 0x00, 0x15, 0x00, 0x00, 0x00, 0x00,
    };
    found = false;
    for (std::size_t index = 0; index + sizeof(zero_position) <= zero_length; ++index) {
        if (std::memcmp(out + index, zero_position, sizeof(zero_position)) == 0) {
            found = true;
        }
    }
    assert(found);
}

void testNodeInfoCarriesPosition()
{
    ApiNodeEntry node{};
    node.num = 0x96f61b44U;
    std::snprintf(node.label, sizeof(node.label), "96F6");
    node.has_position = true;
    node.latitude_i = 373952800;
    node.longitude_i = -1220841600;
    std::uint8_t with[192]{};
    const std::size_t with_length = encodeApiNodeInfo(node, with, sizeof(with));
    node.has_position = false;
    std::uint8_t without[192]{};
    const std::size_t without_length = encodeApiNodeInfo(node, without, sizeof(without));
    // 10 bytes of coordinates plus the submessage tag and length.
    assert(with_length == without_length + 12U);
}

void testRoutingAckNamesThePhonesPacket()
{
    // The app matches on Data.request_id, and NONE (0) must be written out:
    // the field is in a oneof, where absence means "no result", not success.
    std::uint8_t out[96]{};
    const std::size_t length =
        encodeApiRoutingAck(0xcda172e0U, 0x11223344U, 0, out, sizeof(out));
    assert(length > 0);
    const std::uint8_t routing_payload[] = {0x12, 0x02, 0x18, 0x00};
    const std::uint8_t request_id[] = {0x35, 0x44, 0x33, 0x22, 0x11};
    bool found_payload = false;
    bool found_request = false;
    for (std::size_t index = 0; index < length; ++index) {
        if (index + sizeof(routing_payload) <= length &&
            std::memcmp(out + index, routing_payload, sizeof(routing_payload)) == 0) {
            found_payload = true;
        }
        if (index + sizeof(request_id) <= length &&
            std::memcmp(out + index, request_id, sizeof(request_id)) == 0) {
            found_request = true;
        }
    }
    assert(found_payload);
    assert(found_request);
    // A failure reason changes the payload byte and nothing else structural.
    const std::size_t fail_length =
        encodeApiRoutingAck(0xcda172e0U, 0x11223344U, 4, out, sizeof(out));
    assert(fail_length == length);
    // An ack for packet id 0 is refused: that id means "the phone sent none".
    assert(encodeApiRoutingAck(1, 0, 0, out, sizeof(out)) == 0);
}

void testPhonePacketIdSurvivesTheParse()
{
    const std::uint8_t bytes[] = {
        0x0a, 0x14,                          // ToRadio.packet, 20 bytes
        0x15, 0x44, 0x33, 0x22, 0x11,        // MeshPacket.to fixed32
        0x35, 0x99, 0x88, 0x77, 0x66,        // MeshPacket.id fixed32
        0x22, 0x06,                          // MeshPacket.decoded
        0x08, 0x01, 0x12, 0x02, 'h', 'i',
        0x50, 0x01,                          // want_ack
    };
    ApiToRadio message{};
    assert(parseApiToRadio(bytes, sizeof(bytes), message));
    assert(message.kind == ApiToRadio::Kind::Text);
    assert(message.packet_id == 0x66778899U);
}

void testEncodeRefusesTinyBuffers()
{
    std::uint8_t out[4]{};
    assert(encodeApiConfigMessage(0, 1, "2.6.0", nullptr, 0,
                               nullptr, 0, out, sizeof(out)) == 0);
    assert(encodeApiTextPacket(1, 2, 3, "hello", 0, 0, out, sizeof(out)) == 0);
}

} // namespace

int main()
{
    testMyInfoExactBytes();
    testConfigCompleteEchoesNonce();
    testSequenceShapeAndTermination();
    testWantConfigParses();
    testPhoneTextParses();
    testEmptyPositionPayloadIsIgnoredButValid();
    testPhonePositionParses();
    testSwiftPositionVectorParses();
    testNullIslandIsNotAFix();
    testOutOfRangePositionRefused();
    testHalfAPositionIsNotAFix();
    testChannelListIsAdvertisedWithNamesAndNoKeys();
    testADeckWithNoStoredKeysStillAdvertisesTheDefault();
    testPhoneChannelSelectionParses();
    testChannelDefaultsToThePrimary();
    testMalformedBytesRefuse();
    testHeardTextRoundTripsThroughParse();
    testLiveNodeInfoMatchesTheDump();
    testPositionExactBytes();
    testNodeInfoCarriesPosition();
    testRoutingAckNamesThePhonesPacket();
    testPhonePacketIdSurvivesTheParse();
    testEncodeRefusesTinyBuffers();
    std::printf("meshtastic_api: all assertions passed\n");
    return 0;
}
