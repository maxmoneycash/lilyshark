// AES-128, counter mode, and reading a default-key Meshtastic message.
//
// The cipher is checked against the FIPS-197 known-answer vector, and the
// message path against a frame built by an independent implementation
// (Python's `cryptography`, via scripts in the scratchpad) so a mistake
// shared between our encryptor and our decryptor cannot pass unnoticed.

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>

#include "lilyshark/core/mesh_identity.h"
#include "lilyshark/crypto/aes128.h"
#include "lilyshark/protocols/meshtastic_encode.h"
#include "lilyshark/protocols/meshtastic_payload.h"

using namespace lilyshark;

namespace {

void testFips197BlockVector()
{
    // FIPS-197 Appendix C.1.
    const std::uint8_t key[16] = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                                  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f};
    const std::uint8_t plain[16] = {0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
                                    0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff};
    const std::uint8_t expected[16] = {0x69, 0xc4, 0xe0, 0xd8, 0x6a, 0x7b, 0x04, 0x30,
                                       0xd8, 0xcd, 0xb7, 0x80, 0x70, 0xb4, 0xc5, 0x5a};

    std::uint8_t out[16]{};
    const crypto::Aes128 aes(key);
    aes.encryptBlock(plain, out);
    assert(std::memcmp(out, expected, sizeof(expected)) == 0);
}

void testCounterModeRoundTripsAcrossBlockBoundary()
{
    const std::uint8_t key[16] = {0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
                                  0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c};
    std::uint8_t iv[16]{};
    iv[0] = 0x11;
    iv[8] = 0x22;

    // Deliberately not a multiple of the block size: the tail is where an
    // off-by-one in the keystream would hide.
    std::uint8_t clear[37];
    for (std::size_t index = 0; index < sizeof(clear); ++index) {
        clear[index] = static_cast<std::uint8_t>(index * 7U + 1U);
    }

    std::uint8_t cipher[sizeof(clear)]{};
    std::uint8_t back[sizeof(clear)]{};
    crypto::aesCtrXcrypt(key, iv, clear, sizeof(clear), cipher);
    assert(std::memcmp(cipher, clear, sizeof(clear)) != 0);
    crypto::aesCtrXcrypt(key, iv, cipher, sizeof(cipher), back);
    assert(std::memcmp(back, clear, sizeof(clear)) == 0);
}

/// A complete Meshtastic frame: 16-byte plain header, then a Data protobuf
/// carrying a text message, encrypted under the published default key.
constexpr std::uint8_t kFrame[] = {
    0xff, 0xff, 0xff, 0xff, 0x2c, 0x1b, 0x6a, 0x33, 0x01, 0x00, 0xa0, 0x51,
    0x63, 0x08, 0x00, 0x00, 0x57, 0xfa, 0x91, 0x46, 0x92, 0xe8, 0x22, 0x4c,
    0x0d, 0xfe, 0xdb, 0x60, 0x3e, 0x2d, 0x33, 0xe5, 0xb6, 0x76, 0x05, 0x64,
    0x3c, 0xee, 0x9d, 0xd0, 0x55, 0x47, 0x81, 0xd7, 0x26, 0x5a,
};
constexpr std::uint32_t kFrameFrom = 0x336a1b2cU;
constexpr std::uint32_t kFramePacketId = 0x51a00001U;
constexpr std::size_t kHeaderLength = 16;

void testReadsTextMessageFromRealFrame()
{
    MeshtasticPayload payload{};
    const bool ok = readMeshtasticPayload(kFrame + kHeaderLength,
                                          sizeof(kFrame) - kHeaderLength,
                                          kFrameFrom, kFramePacketId, payload);
    assert(ok);
    assert(payload.readable);
    assert(payload.portnum == static_cast<std::uint16_t>(MeshtasticPort::TextMessage));
    assert(payload.has_text);
    assert(std::strcmp(payload.text, "radio check from the ridge") == 0);
    assert(payload.text_length == 26);
    assert(std::strcmp(meshtasticPortLabel(payload.portnum), "TEXT") == 0);
}

void testWrongNonceIsRejectedRatherThanGuessed()
{
    // Same bytes, wrong sender: the keystream differs, so the plaintext is
    // noise. It must fail to parse rather than surface as a message.
    MeshtasticPayload payload{};
    const bool ok = readMeshtasticPayload(kFrame + kHeaderLength,
                                          sizeof(kFrame) - kHeaderLength,
                                          kFrameFrom ^ 0x1234U, kFramePacketId, payload);
    assert(!ok);
    assert(!payload.readable);
    assert(!payload.has_text);
}

void testGarbageIsRejected()
{
    std::uint8_t noise[24];
    for (std::size_t index = 0; index < sizeof(noise); ++index) {
        noise[index] = static_cast<std::uint8_t>(index * 31U + 5U);
    }
    MeshtasticPayload payload{};
    // A private-PSK channel looks exactly like this to us, and must stay opaque.
    (void)readMeshtasticPayload(noise, sizeof(noise), 0x1000U, 0x2000U, payload);
    assert(!payload.has_text);
}

void writeLe32(std::uint8_t *out, std::uint32_t value) noexcept
{
    out[0] = static_cast<std::uint8_t>(value);
    out[1] = static_cast<std::uint8_t>(value >> 8U);
    out[2] = static_cast<std::uint8_t>(value >> 16U);
    out[3] = static_cast<std::uint8_t>(value >> 24U);
}

void testReadsPositionPayload()
{
    const std::int32_t lat_i = 374419000;
    const std::int32_t lon_i = -1221430000;
    std::uint8_t data[14]{};
    data[0] = 0x08;
    data[1] = 0x03; // portnum = POSITION
    data[2] = 0x12;
    data[3] = 10; // inner Position length
    data[4] = 0x0d;
    writeLe32(data + 5, static_cast<std::uint32_t>(lat_i));
    data[9] = 0x15;
    writeLe32(data + 10, static_cast<std::uint32_t>(lon_i));

    std::uint8_t nonce[16]{};
    const std::uint32_t from = 0x11223344U;
    const std::uint32_t id = 0x55667788U;
    nonce[0] = 0x88;
    nonce[1] = 0x77;
    nonce[2] = 0x66;
    nonce[3] = 0x55;
    nonce[8] = 0x44;
    nonce[9] = 0x33;
    nonce[10] = 0x22;
    nonce[11] = 0x11;

    std::uint8_t cipher[sizeof(data)]{};
    crypto::aesCtrXcrypt(kMeshtasticDefaultPsk, nonce, data, sizeof(data), cipher);

    MeshtasticPayload payload{};
    assert(readMeshtasticPayload(cipher, sizeof(cipher), from, id, payload));
    assert(payload.portnum == static_cast<std::uint16_t>(MeshtasticPort::Position));
    assert(payload.has_position);
    assert(payload.latitude_degrees > 37.441 && payload.latitude_degrees < 37.443);
    assert(payload.longitude_degrees < -122.142 && payload.longitude_degrees > -122.144);
}

void testLongFastHashMatchesKnownFrame()
{
    assert(meshtasticChannelHash(kMeshtasticDefaultChannelName, kMeshtasticDefaultPsk,
                                 sizeof(kMeshtasticDefaultPsk)) == 0x08);

    // The default channel's name follows the modem preset, and the hash
    // follows the name: a MediumFast frame and a LongFast frame must not
    // share a header hash, or the Bay Area profile would transmit frames
    // the community's nodes silently drop.
    assert(std::strcmp(meshtasticDefaultChannelName(11, 250000U), "LongFast") == 0);
    assert(std::strcmp(meshtasticDefaultChannelName(9, 250000U), "MediumFast") == 0);
    assert(std::strcmp(meshtasticDefaultChannelName(10, 250000U), "MediumSlow") == 0);
    assert(std::strcmp(meshtasticDefaultChannelName(12, 125000U), "LongSlow") == 0);
    // An unmapped combination falls back to LongFast rather than inventing.
    assert(std::strcmp(meshtasticDefaultChannelName(6, 41700U), "LongFast") == 0);
    assert(meshtasticChannelHash("MediumFast", kMeshtasticDefaultPsk,
                                 sizeof(kMeshtasticDefaultPsk)) !=
           meshtasticChannelHash("LongFast", kMeshtasticDefaultPsk,
                                 sizeof(kMeshtasticDefaultPsk)));
}

void testEncodeTextRoundTripsThroughDefaultKeyReader()
{
    MeshtasticEncodeRequest request{};
    request.from_node = 0x4c534b01U;
    request.packet_id = 0x11223344U;
    request.text = "hello bay";
    std::uint8_t frame[128]{};
    const std::size_t n = encodeMeshtasticFrame(request, frame, sizeof(frame));
    assert(n > 16);
    assert(frame[13] == 0x08);
    MeshtasticPayload payload{};
    assert(readMeshtasticPayload(frame + 16, n - 16, request.from_node, request.packet_id, payload));
    assert(payload.has_text);
    assert(std::strcmp(payload.text, "hello bay") == 0);
}

void testEncodeTextWritesDestination()
{
    MeshtasticEncodeRequest request{};
    request.from_node = 0x4c534b01U;
    request.to_node = 0x11223344U;
    request.packet_id = 1;
    request.text = "dm";
    std::uint8_t frame[128]{};
    const std::size_t n = encodeMeshtasticFrame(request, frame, sizeof(frame));
    assert(n > 16);
    assert(frame[0] == 0x44);
    assert(frame[1] == 0x33);
    assert(frame[2] == 0x22);
    assert(frame[3] == 0x11);
}

void testEncodePositionRoundTrips()
{
    MeshtasticEncodeRequest request{};
    request.port = MeshtasticPort::Position;
    request.from_node = 0x4c534b01U;
    request.packet_id = 7;
    request.latitude_degrees = 37.91112;
    request.longitude_degrees = -122.01760;
    std::uint8_t frame[128]{};
    const std::size_t n = encodeMeshtasticFrame(request, frame, sizeof(frame));
    assert(n > 16);
    MeshtasticPayload payload{};
    assert(readMeshtasticPayload(frame + 16, n - 16, request.from_node, request.packet_id, payload));
    assert(payload.has_position);
    assert(payload.latitude_degrees > 37.911 && payload.latitude_degrees < 37.912);
    assert(payload.longitude_degrees < -122.017 && payload.longitude_degrees > -122.018);
}

void testMacsBecomeDistinctNonBroadcastNodeNums()
{
    const std::uint32_t a = deriveMeshtasticNodeNum(0xAABBCCDDEE11ULL);
    const std::uint32_t b = deriveMeshtasticNodeNum(0xAABBCCDDEE22ULL);
    assert(a != 0U);
    assert(a != 0xffffffffU);
    assert(a != b);
    setLocalMeshtasticNodeNum(a);
    assert(localMeshtasticNodeNum() == a);
    char short_name[8]{};
    char long_name[24]{};
    formatLocalMeshtasticShortName(short_name, sizeof(short_name));
    formatLocalMeshtasticLongName(long_name, sizeof(long_name));
    assert(std::strlen(short_name) == 4);
    assert(std::strncmp(long_name, "Lilyshark-", 10) == 0);
    setLocalMeshtasticNodeNum(0);
    assert(localMeshtasticNodeNum() == a);
}

void testEmptyAndOversizedInputsAreRefused()
{
    MeshtasticPayload payload{};
    assert(!readMeshtasticPayload(nullptr, 0, 1, 1, payload));
    assert(!readMeshtasticPayload(kFrame, 0, 1, 1, payload));
    std::uint8_t big[512]{};
    assert(!readMeshtasticPayload(big, sizeof(big), 1, 1, payload));
}

} // namespace

void testWantAckBitReachesTheHeader()
{
    MeshtasticEncodeRequest request{};
    request.from_node = 0x11111111U;
    request.to_node = 0x22222222U;
    request.packet_id = 77U;
    request.port = MeshtasticPort::TextMessage;
    request.text = "CONFIRM ME";
    request.want_ack = true;
    std::uint8_t frame[256]{};
    const std::size_t n = encodeMeshtasticFrame(request, frame, sizeof(frame));
    assert(n > 16U);
    // Byte 12 is the flags byte: hop_limit low, want-ack at bit 3.
    assert((frame[12] & 0x08U) != 0U);

    request.want_ack = false;
    const std::size_t m = encodeMeshtasticFrame(request, frame, sizeof(frame));
    assert(m > 16U);
    assert((frame[12] & 0x08U) == 0U);
}

void testRoutingAckRoundTrips()
{
    // The acknowledgement official firmware sends: an empty Routing message
    // whose request_id names the packet being confirmed. Encoded by our
    // sender, read back by our reader -- and the plaintext protobuf checked
    // byte for byte against the spec, so a field-number mistake shared by
    // both sides cannot cancel out.
    MeshtasticEncodeRequest request{};
    request.from_node = 0x778899aaU;
    request.to_node = 0x33445566U;
    request.packet_id = 424242U;
    request.port = MeshtasticPort::Routing;
    request.request_id = 0x12345678U;
    std::uint8_t frame[256]{};
    const std::size_t n = encodeMeshtasticFrame(request, frame, sizeof(frame));
    assert(n > 16U);

    MeshtasticPayload payload{};
    assert(readMeshtasticPayload(frame + 16, n - 16, request.from_node, request.packet_id,
                                 payload));
    assert(payload.readable);
    assert(payload.portnum == static_cast<std::uint16_t>(MeshtasticPort::Routing));
    assert(payload.has_request_id);
    assert(payload.request_id == 0x12345678U);
    assert(!payload.has_text);

    // Decrypt with the same nonce construction and compare the plaintext to
    // the hand-derived protobuf: Data{ portnum=5, payload="", request_id }.
    //   08 05        field 1 varint 5
    //   12 00        field 2 length 0
    //   30 f8 ac d1 91 01   field 6 varint 0x12345678
    std::uint8_t nonce[16]{};
    nonce[0] = static_cast<std::uint8_t>(request.packet_id);
    nonce[1] = static_cast<std::uint8_t>(request.packet_id >> 8U);
    nonce[2] = static_cast<std::uint8_t>(request.packet_id >> 16U);
    nonce[3] = static_cast<std::uint8_t>(request.packet_id >> 24U);
    nonce[8] = static_cast<std::uint8_t>(request.from_node);
    nonce[9] = static_cast<std::uint8_t>(request.from_node >> 8U);
    nonce[10] = static_cast<std::uint8_t>(request.from_node >> 16U);
    nonce[11] = static_cast<std::uint8_t>(request.from_node >> 24U);
    std::uint8_t plain[64]{};
    crypto::aesCtrXcrypt(kMeshtasticDefaultPsk, nonce, frame + 16, n - 16, plain);
    const std::uint8_t expected[] = {0x08, 0x05, 0x12, 0x00,
                                     0x30, 0xf8, 0xac, 0xd1, 0x91, 0x01};
    assert(n - 16 == sizeof(expected));
    assert(std::memcmp(plain, expected, sizeof(expected)) == 0);
}

// Telemetry vectors built from the published protobuf field numbers rather
// than from our own encoder, so a field-number mistake cannot be shared by
// the writer and the reader and cancel out.
const std::uint8_t kTelemetryDevice[] = {
    0x0d, 0x00, 0x93, 0x9e, 0x69, 0x12, 0x15, 0x08, 0x4d, 0x15, 0x66, 0x66, 0x76, 0x40,
    0x1d, 0x00, 0x00, 0x48, 0x41, 0x25, 0x00, 0x00, 0xa0, 0x3f, 0x28, 0xcd, 0x83, 0x06
};

const std::uint8_t kTelemetryEnvironment[] = {
    0x0d, 0x01, 0x93, 0x9e, 0x69, 0x1a, 0x0a, 0x0d, 0x00, 0x00, 0xac, 0x41, 0x15, 0x00,
    0x00, 0x41, 0x42
};

bool nearly(float value, double want)
{
    const double delta = static_cast<double>(value) - want;
    return delta < 0.01 && delta > -0.01;
}

MeshtasticPayload readTelemetryFixture(const std::uint8_t *body, std::size_t length)
{
    // Wrap the Telemetry message in a Data message on port 67, encrypt it the
    // way a radio would, and read it back through the public entry point.
    std::uint8_t data[128]{};
    std::size_t used = 0;
    data[used++] = 0x08;  // field 1 varint: portnum
    data[used++] = 67;    // TELEMETRY
    data[used++] = 0x12;  // field 2 length-delimited: payload
    data[used++] = static_cast<std::uint8_t>(length);
    std::memcpy(data + used, body, length);
    used += length;

    constexpr std::uint32_t from_node = 0x0badf00dU;
    constexpr std::uint32_t packet_id = 4242U;
    std::uint8_t nonce[16]{};
    nonce[0] = static_cast<std::uint8_t>(packet_id);
    nonce[1] = static_cast<std::uint8_t>(packet_id >> 8U);
    nonce[2] = static_cast<std::uint8_t>(packet_id >> 16U);
    nonce[3] = static_cast<std::uint8_t>(packet_id >> 24U);
    nonce[8] = static_cast<std::uint8_t>(from_node);
    nonce[9] = static_cast<std::uint8_t>(from_node >> 8U);
    nonce[10] = static_cast<std::uint8_t>(from_node >> 16U);
    nonce[11] = static_cast<std::uint8_t>(from_node >> 24U);
    std::uint8_t cipher[128]{};
    crypto::aesCtrXcrypt(kMeshtasticDefaultPsk, nonce, data, used, cipher);

    MeshtasticPayload payload{};
    assert(readMeshtasticPayload(cipher, used, from_node, packet_id, payload));
    return payload;
}

void testDeviceTelemetryIsRead()
{
    const MeshtasticPayload payload =
        readTelemetryFixture(kTelemetryDevice, sizeof(kTelemetryDevice));
    assert(payload.portnum == static_cast<std::uint16_t>(MeshtasticPort::Telemetry));
    assert(payload.has_telemetry);
    assert(payload.has_battery_level && payload.battery_level == 77);
    assert(payload.has_voltage && nearly(payload.voltage, 3.85));
    assert(payload.has_channel_utilization && nearly(payload.channel_utilization, 12.5));
    assert(payload.has_air_util_tx && nearly(payload.air_util_tx, 1.25));
    assert(payload.has_uptime && payload.uptime_seconds == 98765U);
    // A device-metrics packet says nothing about the weather.
    assert(!payload.has_temperature);
    assert(!payload.has_relative_humidity);
}

void testEnvironmentTelemetryIsRead()
{
    const MeshtasticPayload payload =
        readTelemetryFixture(kTelemetryEnvironment, sizeof(kTelemetryEnvironment));
    assert(payload.has_telemetry);
    assert(payload.has_temperature && nearly(payload.temperature_c, 21.5));
    assert(payload.has_relative_humidity && nearly(payload.relative_humidity, 48.25));
    // ...and an environment packet says nothing about the battery, so a
    // display must not invent 0%.
    assert(!payload.has_battery_level);
    assert(!payload.has_voltage);
}

void testTruncatedTelemetryIsNeverHalfRead()
{
    // Every prefix must either parse cleanly or be refused; what must never
    // happen is a payload that claims telemetry it did not read.
    for (std::size_t length = 0; length < sizeof(kTelemetryDevice); ++length) {
        std::uint8_t data[128]{};
        std::size_t used = 0;
        data[used++] = 0x08;
        data[used++] = 67;
        data[used++] = 0x12;
        data[used++] = static_cast<std::uint8_t>(length);
        std::memcpy(data + used, kTelemetryDevice, length);
        used += length;

        constexpr std::uint32_t from_node = 0x0badf00dU;
        constexpr std::uint32_t packet_id = 99U;
        std::uint8_t nonce[16]{};
        nonce[0] = static_cast<std::uint8_t>(packet_id);
        nonce[8] = static_cast<std::uint8_t>(from_node);
        nonce[9] = static_cast<std::uint8_t>(from_node >> 8U);
        nonce[10] = static_cast<std::uint8_t>(from_node >> 16U);
        nonce[11] = static_cast<std::uint8_t>(from_node >> 24U);
        std::uint8_t cipher[128]{};
        crypto::aesCtrXcrypt(kMeshtasticDefaultPsk, nonce, data, used, cipher);
        MeshtasticPayload payload{};
        if (readMeshtasticPayload(cipher, used, from_node, packet_id, payload)) {
            if (payload.has_battery_level) assert(payload.battery_level <= 100U);
        }
    }
}

int main()
{
    testFips197BlockVector();
    testWantAckBitReachesTheHeader();
    testDeviceTelemetryIsRead();
    testEnvironmentTelemetryIsRead();
    testTruncatedTelemetryIsNeverHalfRead();
    testRoutingAckRoundTrips();
    testCounterModeRoundTripsAcrossBlockBoundary();
    testReadsTextMessageFromRealFrame();
    testWrongNonceIsRejectedRatherThanGuessed();
    testGarbageIsRejected();
    testReadsPositionPayload();
    testLongFastHashMatchesKnownFrame();
    testEncodeTextRoundTripsThroughDefaultKeyReader();
    testEncodeTextWritesDestination();
    testEncodePositionRoundTrips();
    testMacsBecomeDistinctNonBroadcastNodeNums();
    testEmptyAndOversizedInputsAreRefused();
    std::printf("meshtastic payload tests passed\n");
    return 0;
}
