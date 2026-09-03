// MeshCore advert construction, pinned against stock-node bytes.
//
// The golden vector below is the whole reason this file exists. It was
// produced from MeshCore's own known-good test-client keypair (the one
// LocalIdentity::validatePrivateKey carries) with an RFC 8032 reference
// implementation, and independently confirmed by meshcore.js, whose
// Advert.isVerified() runs @noble/curves over the same frame and returns true.
// Ed25519 signatures are deterministic, so there is exactly one correct answer
// for these inputs and this test either produces it or we are not speaking
// MeshCore.
//
// Every frame built here is then pushed back through our own MeshCoreDecoder.
// That round trip is nearly free and it is the check that catches an envelope
// mistake — a wrong header nibble or a path-length byte in the wrong place —
// which a signature check alone would sail straight past, because the header
// and path are deliberately outside the signed message.

#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "lilyshark/core/raw_frame.h"
#include "lilyshark/crypto/ed25519.h"
#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshcore_encode.h"

using namespace lilyshark;

namespace {

std::size_t hexToBytes(std::uint8_t *out, const char *hex)
{
    std::size_t index = 0;
    for (; hex[2 * index] != '\0'; ++index) {
        const char pair[3] = {hex[2 * index], hex[2 * index + 1], '\0'};
        out[index] = static_cast<std::uint8_t>(std::strtoul(pair, nullptr, 16));
    }
    return index;
}

void printHex(const char *label, const std::uint8_t *bytes, std::size_t length)
{
    std::printf("%s", label);
    for (std::size_t index = 0; index < length; ++index) {
        std::printf("%02x", bytes[index]);
    }
    std::printf("\n");
}

void expectFrame(const std::uint8_t *actual, std::size_t actual_length, const char *expected_hex)
{
    std::uint8_t expected[kMeshCoreMaxFrameBytes];
    const std::size_t expected_length = hexToBytes(expected, expected_hex);
    if (actual_length != expected_length ||
        std::memcmp(actual, expected, expected_length) != 0) {
        printHex("actual   ", actual, actual_length);
        printHex("expected ", expected, expected_length);
        assert(false && "encoded frame does not match the pinned vector");
    }
}

/// MeshCore's known-good test-client identity, stored the way MeshCore stores
/// it: expanded private key first, public key derived from it.
struct TestClientIdentity {
    std::uint8_t public_key[crypto::kEd25519PublicKeySize]{};
    std::uint8_t private_key[crypto::kEd25519PrivateKeySize]{};
};

TestClientIdentity meshCoreTestClient()
{
    TestClientIdentity identity{};
    hexToBytes(identity.private_key,
               "7065e18fd9fabb70c1ed90dca19907de698c88b709ea146eafd93d9b830c7b60"
               "c4681193c79bbc39945ba8064104bb618f8fd7a84a0af6f57033d6e8ddcd6471");
    crypto::ed25519DerivePublicKey(identity.public_key, identity.private_key);
    return identity;
}

/// A locally generated identity, seeded deterministically so the vectors it
/// produces stay stable. Real hardware seeds this from esp_random.
TestClientIdentity deckIdentity()
{
    TestClientIdentity identity{};
    std::uint8_t seed[crypto::kEd25519SeedSize];
    std::memset(seed, 0x11, sizeof(seed));
    crypto::ed25519CreateKeypair(identity.public_key, identity.private_key, seed);
    return identity;
}

/// Decode a frame we just built and check it is the advert we meant, then
/// verify its signature the way a receiver would: by rebuilding the signed
/// message from the decoded fields rather than from what the encoder held.
void expectDecodesAsAdvert(const std::uint8_t *frame,
                           std::size_t frame_length,
                           MeshCoreRouteType expected_route,
                           std::size_t expected_app_data_length)
{
    MeshCoreDecoder decoder{};
    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::MeshCore;

    RawFrame raw{};
    assert(raw.assignPayload(frame, frame_length));
    DecodedPacket decoded{};
    assert(decoder.decode(raw, profile, decoded) == DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::MeshCore);
    assert(decoded.kind == PacketKind::Advertisement);
    assert(MeshCoreDecoder::routeType(decoded) == expected_route);
    assert(MeshCoreDecoder::payloadType(decoded) == MeshCorePayloadType::Advertisement);
    assert(MeshCoreDecoder::payloadVersion(decoded) == 0);
    assert(MeshCoreDecoder::pathHashCount(decoded) == 0);
    assert(MeshCoreDecoder::pathHashSize(decoded) == 1);
    assert(!MeshCoreDecoder::hasTransportCodes(decoded));
    assert(decoded.payload_offset == 2);
    assert(decoded.payload_length ==
           kMeshCoreAdvertFixedPayloadBytes + expected_app_data_length);

    const std::uint8_t *payload = raw.bytes + decoded.payload_offset;
    const std::uint8_t *public_key = payload;
    const std::uint8_t *timestamp_bytes = payload + crypto::kEd25519PublicKeySize;
    const std::uint8_t *signature = timestamp_bytes + 4;
    const std::uint8_t *app_data = signature + crypto::kEd25519SignatureSize;
    const std::uint32_t timestamp = static_cast<std::uint32_t>(timestamp_bytes[0]) |
                                    (static_cast<std::uint32_t>(timestamp_bytes[1]) << 8U) |
                                    (static_cast<std::uint32_t>(timestamp_bytes[2]) << 16U) |
                                    (static_cast<std::uint32_t>(timestamp_bytes[3]) << 24U);

    std::uint8_t message[kMeshCoreAdvertSignedMessageBytes];
    const std::size_t message_length = encodeMeshCoreAdvertSignedMessage(
        public_key, timestamp, app_data, expected_app_data_length, message, sizeof(message));
    assert(message_length == crypto::kEd25519PublicKeySize + 4 + expected_app_data_length);
    assert(crypto::ed25519Verify(signature, message, message_length, public_key));
}

void testGoldenFloodAdvert()
{
    const TestClientIdentity identity = meshCoreTestClient();
    MeshCoreAdvertAppData app_data{};
    app_data.node_type = MeshCoreNodeType::Chat;
    app_data.name = "LSK1";

    std::uint8_t frame[kMeshCoreMaxFrameBytes];
    const std::size_t length =
        encodeMeshCoreAdvert(app_data, 0x68b00000U, MeshCoreAdvertReach::Flood,
                             identity.public_key, identity.private_key, frame, sizeof(frame));
    assert(length == 107);
    expectFrame(frame, length,
                "1100"
                "1ec77175b0918ed206f9ae04ec136d6d5d4315bb26305427f645b492e9350c10"
                "0000b068"
                "542b627d72e15a2b15e575b3f9f713e3af3f110ef1f32d67d8b7a10d899ed9a1"
                "fc399b3b9735b9683db8f95b341ab66ceb74374a00dc685d28afef5f2816f600"
                "814c534b31");
    expectDecodesAsAdvert(frame, length, MeshCoreRouteType::Flood, 5);
}

void testGoldenZeroHopAdvert()
{
    // A zero-hop advert is the same signed payload under a different route,
    // because the header is outside the signature. Stock companion firmware
    // sends this form by default and only floods on an explicit request.
    const TestClientIdentity identity = meshCoreTestClient();
    MeshCoreAdvertAppData app_data{};
    app_data.name = "LSK1";

    std::uint8_t frame[kMeshCoreMaxFrameBytes];
    const std::size_t length =
        encodeMeshCoreAdvert(app_data, 0x68b00000U, MeshCoreAdvertReach::ZeroHop,
                             identity.public_key, identity.private_key, frame, sizeof(frame));
    assert(length == 107);
    expectFrame(frame, length,
                "1200"
                "1ec77175b0918ed206f9ae04ec136d6d5d4315bb26305427f645b492e9350c10"
                "0000b068"
                "542b627d72e15a2b15e575b3f9f713e3af3f110ef1f32d67d8b7a10d899ed9a1"
                "fc399b3b9735b9683db8f95b341ab66ceb74374a00dc685d28afef5f2816f600"
                "814c534b31");
    expectDecodesAsAdvert(frame, length, MeshCoreRouteType::Direct, 5);
}

void testLocatedAdvertWithFeatureWords()
{
    // Everything an advert can carry at once: position, both reserved feature
    // words, and a name. Generated with the same reference implementation as
    // the golden vector above.
    const TestClientIdentity identity = deckIdentity();
    MeshCoreAdvertAppData app_data{};
    app_data.node_type = MeshCoreNodeType::Chat;
    app_data.name = "Lilyshark";
    app_data.has_location = true;
    app_data.latitude_micros = 37911000;
    app_data.longitude_micros = -122018000;
    app_data.feature_one = 0x1234;
    app_data.feature_two = 0xbeef;

    std::uint8_t frame[kMeshCoreMaxFrameBytes];
    const std::size_t length =
        encodeMeshCoreAdvert(app_data, 0x69000123U, MeshCoreAdvertReach::Flood,
                             identity.public_key, identity.private_key, frame, sizeof(frame));
    assert(length == 124);
    expectFrame(frame, length,
                "1100"
                "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737"
                "23010069"
                "6d785cf7812b661fb92c997396ecc9368bd2b4394e7ed8a3cdb713718c1d9b87"
                "55dbeeaa3690828a7550ea6b41f8839ed10e10d23e5ed3e448c0770dd4f7270a"
                "f1d87942023027baf83412efbe4c696c79736861726b");
    expectDecodesAsAdvert(frame, length, MeshCoreRouteType::Flood, 22);
}

void testLongestLegalAdvert()
{
    // 32 bytes of app data is MeshCore's MAX_ADVERT_DATA_SIZE. With a position
    // taking eight of them, a 23-byte name is exactly the limit.
    const TestClientIdentity identity = deckIdentity();
    MeshCoreAdvertAppData app_data{};
    app_data.name = "ABCDEFGHIJKLMNOPQRSTUVW";
    app_data.has_location = true;
    app_data.latitude_micros = 37911000;
    app_data.longitude_micros = -122018000;

    std::uint8_t frame[kMeshCoreMaxFrameBytes];
    const std::size_t length =
        encodeMeshCoreAdvert(app_data, 0x69000123U, MeshCoreAdvertReach::ZeroHop,
                             identity.public_key, identity.private_key, frame, sizeof(frame));
    assert(length == 134);
    expectFrame(frame, length,
                "1200"
                "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737"
                "23010069"
                "7915f21b7afabf2acbaa33e1adca3f74cfa3d12f30cff15b4bf099db1e140da6"
                "9e9f15df73411bd63e6dbb9a456ce2bd39bd6f335d7ee09ffc6e2c37e2cef90f"
                "91d87942023027baf84142434445464748494a4b4c4d4e4f5051525354555657");
    expectDecodesAsAdvert(frame, length, MeshCoreRouteType::Direct, 32);
}

void testAppDataFlagsAndFieldOrder()
{
    std::uint8_t out[kMeshCoreMaxAdvertAppDataBytes];

    // Bare CHAT node: one flags byte and nothing else.
    MeshCoreAdvertAppData bare{};
    assert(encodeMeshCoreAdvertAppData(bare, out) == 1);
    assert(out[0] == 0x01);

    // Node types occupy the low nibble untouched by the presence flags.
    MeshCoreAdvertAppData repeater{};
    repeater.node_type = MeshCoreNodeType::Repeater;
    assert(encodeMeshCoreAdvertAppData(repeater, out) == 1);
    assert(out[0] == 0x02);

    MeshCoreAdvertAppData sensor{};
    sensor.node_type = MeshCoreNodeType::Sensor;
    sensor.name = "S";
    assert(encodeMeshCoreAdvertAppData(sensor, out) == 2);
    assert(out[0] == 0x84);
    assert(out[1] == 'S');

    // Position is little-endian int32 micro-degrees, and a negative longitude
    // has to survive the unsigned round trip.
    MeshCoreAdvertAppData located{};
    located.has_location = true;
    located.latitude_micros = 37911000;
    located.longitude_micros = -122018000;
    assert(encodeMeshCoreAdvertAppData(located, out) == 9);
    assert(out[0] == 0x11);
    assert(out[1] == 0xd8 && out[2] == 0x79 && out[3] == 0x42 && out[4] == 0x02);
    assert(out[5] == 0x30 && out[6] == 0x27 && out[7] == 0xba && out[8] == 0xf8);

    // MeshCore only emits a feature word when it is non-zero, so a zeroed
    // feature must not set its flag or consume two bytes.
    MeshCoreAdvertAppData feature_two_only{};
    feature_two_only.feature_two = 0x0102;
    assert(encodeMeshCoreAdvertAppData(feature_two_only, out) == 3);
    assert(out[0] == 0x41);
    assert(out[1] == 0x02 && out[2] == 0x01);

    // A node type wider than the four-bit field is a programming error, not a
    // frame to put on the air.
    MeshCoreAdvertAppData invalid{};
    invalid.node_type = static_cast<MeshCoreNodeType>(0x10);
    assert(encodeMeshCoreAdvertAppData(invalid, out) == 0);
}

void testNameTruncationRespectsUtf8()
{
    std::uint8_t out[kMeshCoreMaxAdvertAppDataBytes];

    // A name longer than the space left is cut, and with a position present
    // that space is 23 bytes.
    MeshCoreAdvertAppData overlong{};
    overlong.has_location = true;
    overlong.name = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    assert(encodeMeshCoreAdvertAppData(overlong, out) == kMeshCoreMaxAdvertAppDataBytes);
    assert(out[0] == 0x91);
    assert(std::memcmp(out + 9, "ABCDEFGHIJKLMNOPQRSTUVW", 23) == 0);

    // The cut must land on a character boundary. "é" is two bytes, so a name
    // of thirty ASCII characters followed by one would otherwise be sliced
    // through the middle of it: 1 flags byte + 30 ASCII leaves one byte, and
    // half a character is not allowed to take it.
    MeshCoreAdvertAppData straddling{};
    straddling.name = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\xc3\xa9";
    assert(encodeMeshCoreAdvertAppData(straddling, out) == 31);
    assert(out[0] == 0x81);
    assert(out[30] == 'A');

    // One character earlier, the accented character fits exactly.
    MeshCoreAdvertAppData exact{};
    exact.name = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAA\xc3\xa9";
    assert(encodeMeshCoreAdvertAppData(exact, out) == kMeshCoreMaxAdvertAppDataBytes);
    assert(out[30] == 0xc3 && out[31] == 0xa9);

    // A four-byte character is kept whole when it fits. With a position and
    // both feature words present only nineteen bytes remain, and the emoji
    // plus fifteen more characters land exactly on that limit.
    MeshCoreAdvertAppData crowded{};
    crowded.has_location = true;
    crowded.feature_one = 1;
    crowded.feature_two = 1;
    crowded.name = "\xf0\x9f\xa6\x88 an emoji that will not fit anywhere near here";
    assert(encodeMeshCoreAdvertAppData(crowded, out) == kMeshCoreMaxAdvertAppDataBytes);
    assert(out[0] == 0xf1);
    assert(out[13] == 0xf0 && out[14] == 0x9f && out[15] == 0xa6 && out[16] == 0x88);
    assert(std::memcmp(out + 17, " an emoji that ", 15) == 0);

    // A name that starts with a byte no UTF-8 sequence can begin with yields
    // nothing at all, and the name flag stays clear rather than announcing a
    // name of zero bytes.
    MeshCoreAdvertAppData unusable{};
    unusable.name = "\xff\xfe";
    assert(encodeMeshCoreAdvertAppData(unusable, out) == 1);
    assert(out[0] == 0x01);

    // Invalid UTF-8 stops the name at the last good character instead of
    // shipping a byte a stock node would render as a replacement glyph.
    MeshCoreAdvertAppData invalid_tail{};
    invalid_tail.name = "ok\xff\xfe";
    assert(encodeMeshCoreAdvertAppData(invalid_tail, out) == 3);
    assert(out[0] == 0x81);
    assert(out[1] == 'o' && out[2] == 'k');

    // An empty name is not a name.
    MeshCoreAdvertAppData empty_name{};
    empty_name.name = "";
    assert(encodeMeshCoreAdvertAppData(empty_name, out) == 1);
    assert(out[0] == 0x01);
}

void testSignatureCoversTimestampAndAppData()
{
    const TestClientIdentity identity = deckIdentity();
    MeshCoreAdvertAppData app_data{};
    app_data.name = "Deck";

    std::uint8_t first[kMeshCoreMaxFrameBytes];
    const std::size_t first_length =
        encodeMeshCoreAdvert(app_data, 1000U, MeshCoreAdvertReach::Flood, identity.public_key,
                             identity.private_key, first, sizeof(first));
    assert(first_length != 0);

    // The same inputs must give the same bytes: Ed25519 here is deterministic,
    // which is what makes the pinned vectors above meaningful at all.
    std::uint8_t repeat[kMeshCoreMaxFrameBytes];
    const std::size_t repeat_length =
        encodeMeshCoreAdvert(app_data, 1000U, MeshCoreAdvertReach::Flood, identity.public_key,
                             identity.private_key, repeat, sizeof(repeat));
    assert(repeat_length == first_length);
    assert(std::memcmp(first, repeat, first_length) == 0);

    // Bumping the timestamp by one second changes the signature, which is what
    // stops a captured advert being replayed under a newer clock.
    std::uint8_t later[kMeshCoreMaxFrameBytes];
    const std::size_t later_length =
        encodeMeshCoreAdvert(app_data, 1001U, MeshCoreAdvertReach::Flood, identity.public_key,
                             identity.private_key, later, sizeof(later));
    assert(later_length == first_length);
    assert(std::memcmp(first + 38, later + 38, crypto::kEd25519SignatureSize) != 0);

    // Renaming does too.
    MeshCoreAdvertAppData renamed = app_data;
    renamed.name = "Dock";
    std::uint8_t other[kMeshCoreMaxFrameBytes];
    const std::size_t other_length =
        encodeMeshCoreAdvert(renamed, 1000U, MeshCoreAdvertReach::Flood, identity.public_key,
                             identity.private_key, other, sizeof(other));
    assert(other_length == first_length);
    assert(std::memcmp(first + 38, other + 38, crypto::kEd25519SignatureSize) != 0);

    // The route is not signed, so switching reach leaves the payload identical
    // and only the header byte moves. A repeater rewriting the path must not
    // be able to invalidate an advert.
    std::uint8_t zero_hop[kMeshCoreMaxFrameBytes];
    const std::size_t zero_hop_length =
        encodeMeshCoreAdvert(app_data, 1000U, MeshCoreAdvertReach::ZeroHop, identity.public_key,
                             identity.private_key, zero_hop, sizeof(zero_hop));
    assert(zero_hop_length == first_length);
    assert(zero_hop[0] == kMeshCoreZeroHopAdvertHeader);
    assert(first[0] == kMeshCoreFloodAdvertHeader);
    assert(std::memcmp(first + 1, zero_hop + 1, first_length - 1) == 0);
}

void testRejectsBadArgumentsAndTightBuffers()
{
    const TestClientIdentity identity = deckIdentity();
    MeshCoreAdvertAppData app_data{};
    app_data.name = "LSK1";

    std::uint8_t frame[kMeshCoreMaxFrameBytes];
    const std::size_t length =
        encodeMeshCoreAdvert(app_data, 42U, MeshCoreAdvertReach::Flood, identity.public_key,
                             identity.private_key, frame, sizeof(frame));
    assert(length == 107);

    // One byte short is still short.
    assert(encodeMeshCoreAdvert(app_data, 42U, MeshCoreAdvertReach::Flood, identity.public_key,
                                identity.private_key, frame, length - 1) == 0);
    assert(encodeMeshCoreAdvert(app_data, 42U, MeshCoreAdvertReach::Flood, identity.public_key,
                                identity.private_key, frame, length) == length);

    assert(encodeMeshCoreAdvert(app_data, 42U, MeshCoreAdvertReach::Flood, nullptr,
                                identity.private_key, frame, sizeof(frame)) == 0);
    assert(encodeMeshCoreAdvert(app_data, 42U, MeshCoreAdvertReach::Flood, identity.public_key,
                                nullptr, frame, sizeof(frame)) == 0);
    assert(encodeMeshCoreAdvert(app_data, 42U, MeshCoreAdvertReach::Flood, identity.public_key,
                                identity.private_key, nullptr, sizeof(frame)) == 0);

    MeshCoreAdvertAppData invalid = app_data;
    invalid.node_type = static_cast<MeshCoreNodeType>(0x20);
    assert(encodeMeshCoreAdvert(invalid, 42U, MeshCoreAdvertReach::Flood, identity.public_key,
                                identity.private_key, frame, sizeof(frame)) == 0);

    // The signed-message builder guards its own buffer the same way.
    std::uint8_t message[kMeshCoreAdvertSignedMessageBytes];
    const std::uint8_t app_bytes[] = {0x81, 'L', 'S', 'K', '1'};
    assert(encodeMeshCoreAdvertSignedMessage(identity.public_key, 42U, app_bytes,
                                             sizeof(app_bytes), message, 36) == 0);
    assert(encodeMeshCoreAdvertSignedMessage(identity.public_key, 42U, app_bytes,
                                             sizeof(app_bytes), message, sizeof(message)) == 41);
    assert(encodeMeshCoreAdvertSignedMessage(identity.public_key, 42U, nullptr, 4, message,
                                             sizeof(message)) == 0);
    assert(encodeMeshCoreAdvertSignedMessage(identity.public_key, 42U, nullptr, 0, message,
                                             sizeof(message)) == 36);
    assert(encodeMeshCoreAdvertSignedMessage(
               identity.public_key, 42U, app_bytes, kMeshCoreMaxAdvertAppDataBytes + 1, message,
               sizeof(message)) == 0);
}

void testDegreesToMicros()
{
    assert(meshCoreDegreesToMicros(37.911) == 37911000);
    assert(meshCoreDegreesToMicros(-122.018) == -122018000);
    assert(meshCoreDegreesToMicros(0.0) == 0);

    // MeshCore truncates toward zero rather than rounding, and a deck that
    // rounded would disagree with the position a stock node reports for it.
    assert(meshCoreDegreesToMicros(1.0000009) == 1000000);
    assert(meshCoreDegreesToMicros(-1.0000009) == -1000000);

    // A missing or corrupt fix must not become a position at the far end of
    // the world, and it must not be undefined behaviour either.
    assert(meshCoreDegreesToMicros(std::nan("")) == 0);
    assert(meshCoreDegreesToMicros(1.0e9) == 0);
    assert(meshCoreDegreesToMicros(-1.0e9) == 0);
    assert(meshCoreDegreesToMicros(180.0) == 180000000);
    assert(meshCoreDegreesToMicros(-180.0) == -180000000);
}

void testTransmitStillDisconnected()
{
    // The encoder is finished and tested; nothing transmits it yet. This flag
    // is what the rest of the firmware reads, and flipping it is a deliberate
    // act that belongs with the radio wiring, not with this file.
    static_assert(!kMeshCoreTransmitReady,
                  "MeshCore adverts must not go on the air until the TX path is wired and "
                  "verified against a stock node");
}

} // namespace

int main()
{
    testGoldenFloodAdvert();
    testGoldenZeroHopAdvert();
    testLocatedAdvertWithFeatureWords();
    testLongestLegalAdvert();
    testAppDataFlagsAndFieldOrder();
    testNameTruncationRespectsUtf8();
    testSignatureCoversTimestampAndAppData();
    testRejectsBadArgumentsAndTightBuffers();
    testDegreesToMicros();
    testTransmitStillDisconnected();
    std::printf("meshcore advert tests passed\n");
    return 0;
}
