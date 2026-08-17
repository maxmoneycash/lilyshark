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

#include "lilyshark/crypto/aes128.h"
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

void testEmptyAndOversizedInputsAreRefused()
{
    MeshtasticPayload payload{};
    assert(!readMeshtasticPayload(nullptr, 0, 1, 1, payload));
    assert(!readMeshtasticPayload(kFrame, 0, 1, 1, payload));
    std::uint8_t big[512]{};
    assert(!readMeshtasticPayload(big, sizeof(big), 1, 1, payload));
}

} // namespace

int main()
{
    testFips197BlockVector();
    testCounterModeRoundTripsAcrossBlockBoundary();
    testReadsTextMessageFromRealFrame();
    testWrongNonceIsRejectedRatherThanGuessed();
    testGarbageIsRejected();
    testEmptyAndOversizedInputsAreRefused();
    std::printf("meshtastic payload tests passed\n");
    return 0;
}
