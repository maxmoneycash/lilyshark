// Meshtastic public-key direct messages, checked against the firmware.
//
// The decisive case is a known-answer packet lifted from
// meshtastic/firmware test/test_crypto/test_main.cpp (test_PKC): a real
// encrypted DM this module must open, and — because the extra nonce is
// pinned — re-encrypt to the identical bytes. Around it sit NIST vectors
// for the SHA-256 key derivation, the Wycheproof exchange cases the
// firmware uses (including its weak-key rejection), and adversarial
// round-trip coverage.

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "lilyshark/crypto/sha256.h"
#include "lilyshark/protocols/meshtastic_pkc.h"

using namespace lilyshark;

namespace {

void hexToBytes(std::uint8_t *out, const char *hex)
{
    for (std::size_t i = 0; hex[2 * i] != '\0'; ++i) {
        const char pair[3] = {hex[2 * i], hex[2 * i + 1], '\0'};
        out[i] = static_cast<std::uint8_t>(std::strtoul(pair, nullptr, 16));
    }
}

void testSha256KnownAnswers()
{
    // NIST FIPS 180-4 examples and CAVS short-message vectors: the empty
    // string, one byte, two bytes, "abc", and a two-block message.
    struct Case {
        const char *message_hex;
        const char *digest_hex;
    };
    const Case cases[] = {
        {"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
        {"d3", "28969cdfa74a12c82f3bad960b0b000aca2ac329deea5c2328ebc6f2ba9802c1"},
        {"11af", "5ca7133fa735326081558ac312c620eeca9970d1e70a4b95533d956f072d1f98"},
        {"616263", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
        {"6162636462636465636465666465666765666768666768696768696a68696a6b"
         "696a6b6c6a6b6c6d6b6c6d6e6c6d6e6f6d6e6f706e6f7071",
         "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"},
    };
    for (const Case &c : cases) {
        std::uint8_t message[64];
        const std::size_t length = std::strlen(c.message_hex) / 2;
        hexToBytes(message, c.message_hex);
        std::uint8_t expected[32];
        hexToBytes(expected, c.digest_hex);
        std::uint8_t digest[32];
        crypto::sha256(message, length, digest);
        assert(std::memcmp(digest, expected, 32) == 0);
    }
}

void testSharedKeyDerivationMatchesFirmware()
{
    // The fourth Wycheproof case in the firmware's test_DH25519 checks the
    // hashed shared secret — exactly what meshtasticPkcDeriveSharedKey
    // returns.
    std::uint8_t private_key[32];
    std::uint8_t public_key[32];
    std::uint8_t expected[32];
    std::uint8_t shared[32];
    hexToBytes(private_key,
               "10300724f3bea134eb1575245ef26ff9b8ccd59849cd98ce1a59002fe1d5986c");
    hexToBytes(public_key,
               "f7e13a1a067d2f4e1061bf9936fde5be6b0c2494a8f809cbac7f290ef719e91c");
    hexToBytes(expected,
               "24becd5dfed9e9289ba2e15b82b0d54f8e9aacb72f5e4248c58d8d74b451ce76");
    assert(meshtasticPkcDeriveSharedKey(private_key, public_key, shared));
    assert(std::memcmp(shared, expected, 32) == 0);
}

void testWeakPublicKeyIsRejected()
{
    // Wycheproof's small-order public key, which the firmware's dh2 refuses:
    // the exchange collapses to an all-zero secret.
    std::uint8_t private_key[32];
    std::uint8_t public_key[32];
    std::uint8_t shared[32];
    hexToBytes(private_key,
               "18630f93598637c35da623a74559cf944374a559114c7937811041fc8605564a");
    hexToBytes(public_key,
               "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f");
    assert(!meshtasticPkcDeriveSharedKey(private_key, public_key, shared));

    // A blank private key is refused before any curve math happens.
    const std::uint8_t blank[32] = {};
    hexToBytes(public_key,
               "db18fc50eea47f00251cb784819a3cf5fc361882597f589f0d7ff820e8064457");
    assert(!meshtasticPkcDeriveSharedKey(blank, public_key, shared));
}

// The known-answer packet from the firmware's test_PKC, shared by the next
// two tests.
constexpr std::uint32_t kKatFromNode = 0x0929;
constexpr std::uint32_t kKatPacketId = 0x13b2d662;
constexpr std::uint32_t kKatExtraNonce = 0x2b796a03;
constexpr char kKatPrivateHex[] =
    "a00330633e63522f8a4d81ec6d9d1e6617f6c8ffd3a4c698229537d44e522277";
constexpr char kKatPublicHex[] =
    "db18fc50eea47f00251cb784819a3cf5fc361882597f589f0d7ff820e8064457";
constexpr char kKatPayloadHex[] =
    "40df24abfcc30a17a3d9046726099e796a1c036a792b";
constexpr char kKatPlainHex[] = "08011204746573744800";

void testFirmwareKnownAnswerDecrypts()
{
    MeshtasticPkcKeypair ours{};
    hexToBytes(ours.private_key, kKatPrivateHex);
    std::uint8_t their_public[32];
    hexToBytes(their_public, kKatPublicHex);

    // The session key the firmware logs for this exchange starts with these
    // eight bytes; checking them pins the SHA-256-over-X25519 derivation.
    std::uint8_t shared[32];
    assert(meshtasticPkcDeriveSharedKey(ours.private_key, their_public, shared));
    std::uint8_t expected_shared_prefix[8];
    hexToBytes(expected_shared_prefix, "777b1545c9d6f9a2");
    assert(std::memcmp(shared, expected_shared_prefix, 8) == 0);

    std::uint8_t payload[22];
    hexToBytes(payload, kKatPayloadHex);
    std::uint8_t expected_plain[10];
    hexToBytes(expected_plain, kKatPlainHex);

    std::uint8_t plain[64];
    std::size_t plain_length = 0;
    assert(meshtasticPkcDecryptDm(ours, their_public, kKatFromNode, kKatPacketId,
                                  payload, sizeof(payload), plain, sizeof(plain),
                                  &plain_length));
    assert(plain_length == sizeof(expected_plain));
    assert(std::memcmp(plain, expected_plain, sizeof(expected_plain)) == 0);
}

void testFirmwareKnownAnswerReencrypts()
{
    // With the extra nonce pinned to the captured packet's value, encryption
    // is deterministic and must reproduce the firmware's bytes exactly —
    // ciphertext, tag, and trailer.
    MeshtasticPkcKeypair ours{};
    hexToBytes(ours.private_key, kKatPrivateHex);
    std::uint8_t their_public[32];
    hexToBytes(their_public, kKatPublicHex);
    std::uint8_t plain[10];
    hexToBytes(plain, kKatPlainHex);
    std::uint8_t expected_payload[22];
    hexToBytes(expected_payload, kKatPayloadHex);

    std::uint8_t payload[64];
    std::size_t payload_length = 0;
    assert(meshtasticPkcEncryptDm(ours, their_public, kKatFromNode, kKatPacketId,
                                  kKatExtraNonce, plain, sizeof(plain), payload,
                                  sizeof(payload), &payload_length));
    assert(payload_length == sizeof(expected_payload));
    assert(std::memcmp(payload, expected_payload, sizeof(expected_payload)) == 0);
}

void testGeneratedKeypairsRoundTripBothDirections()
{
    // Two nodes with caller-supplied "hardware" entropy exchange a DM each
    // way; each must open the other's packet and derive identical session
    // keys.
    std::uint8_t entropy_a[32];
    std::uint8_t entropy_b[32];
    for (int i = 0; i < 32; ++i) {
        entropy_a[i] = static_cast<std::uint8_t>(i * 17 + 3);
        entropy_b[i] = static_cast<std::uint8_t>(200 - i * 5);
    }
    MeshtasticPkcKeypair node_a{};
    MeshtasticPkcKeypair node_b{};
    assert(meshtasticPkcGenerateKeypair(entropy_a, node_a));
    assert(meshtasticPkcGenerateKeypair(entropy_b, node_b));

    std::uint8_t key_ab[32];
    std::uint8_t key_ba[32];
    assert(meshtasticPkcDeriveSharedKey(node_a.private_key, node_b.public_key, key_ab));
    assert(meshtasticPkcDeriveSharedKey(node_b.private_key, node_a.public_key, key_ba));
    assert(std::memcmp(key_ab, key_ba, 32) == 0);

    const char message[] = "meet at the water tower";
    const std::size_t message_length = sizeof(message) - 1;
    std::uint8_t payload[64];
    std::size_t payload_length = 0;
    assert(meshtasticPkcEncryptDm(node_a, node_b.public_key, 0x11223344U,
                                  0xdeadbeefU, 0x0badf00dU,
                                  reinterpret_cast<const std::uint8_t *>(message),
                                  message_length, payload, sizeof(payload),
                                  &payload_length));
    assert(payload_length == message_length + kMeshtasticPkcOverhead);

    std::uint8_t plain[64];
    std::size_t plain_length = 0;
    assert(meshtasticPkcDecryptDm(node_b, node_a.public_key, 0x11223344U,
                                  0xdeadbeefU, payload, payload_length, plain,
                                  sizeof(plain), &plain_length));
    assert(plain_length == message_length);
    assert(std::memcmp(plain, message, message_length) == 0);

    // And the reverse direction with different packet metadata.
    assert(meshtasticPkcEncryptDm(node_b, node_a.public_key, 0x55667788U, 7U, 9U,
                                  reinterpret_cast<const std::uint8_t *>(message),
                                  message_length, payload, sizeof(payload),
                                  &payload_length));
    assert(meshtasticPkcDecryptDm(node_a, node_b.public_key, 0x55667788U, 7U,
                                  payload, payload_length, plain, sizeof(plain),
                                  &plain_length));
    assert(plain_length == message_length);
    assert(std::memcmp(plain, message, message_length) == 0);
}

void testWrongKeysMetadataAndTamperingAreRejected()
{
    std::uint8_t entropy_a[32];
    std::uint8_t entropy_b[32];
    std::uint8_t entropy_c[32];
    for (int i = 0; i < 32; ++i) {
        entropy_a[i] = static_cast<std::uint8_t>(i + 1);
        entropy_b[i] = static_cast<std::uint8_t>(i + 101);
        entropy_c[i] = static_cast<std::uint8_t>(i + 201);
    }
    MeshtasticPkcKeypair node_a{};
    MeshtasticPkcKeypair node_b{};
    MeshtasticPkcKeypair eavesdropper{};
    assert(meshtasticPkcGenerateKeypair(entropy_a, node_a));
    assert(meshtasticPkcGenerateKeypair(entropy_b, node_b));
    assert(meshtasticPkcGenerateKeypair(entropy_c, eavesdropper));

    const std::uint8_t message[5] = {1, 2, 3, 4, 5};
    std::uint8_t payload[32];
    std::size_t payload_length = 0;
    assert(meshtasticPkcEncryptDm(node_a, node_b.public_key, 42U, 1000U, 77U,
                                  message, sizeof(message), payload,
                                  sizeof(payload), &payload_length));

    std::uint8_t plain[32];
    std::size_t plain_length = 0;

    // A third party without either private key cannot open it.
    assert(!meshtasticPkcDecryptDm(eavesdropper, node_a.public_key, 42U, 1000U,
                                   payload, payload_length, plain, sizeof(plain),
                                   &plain_length));
    // The right key under the wrong sender identity or packet id builds the
    // wrong nonce, so the tag must fail.
    assert(!meshtasticPkcDecryptDm(node_b, node_a.public_key, 43U, 1000U, payload,
                                   payload_length, plain, sizeof(plain),
                                   &plain_length));
    assert(!meshtasticPkcDecryptDm(node_b, node_a.public_key, 42U, 1001U, payload,
                                   payload_length, plain, sizeof(plain),
                                   &plain_length));

    // A flipped ciphertext bit, a flipped tag bit, and a flipped trailer
    // (extra nonce) bit must each be rejected, and the plaintext scrubbed.
    const std::uint8_t zero[sizeof(message)] = {};
    const std::size_t victims[3] = {0, sizeof(message) + 2, payload_length - 1};
    for (const std::size_t victim : victims) {
        payload[victim] ^= 0x20;
        assert(!meshtasticPkcDecryptDm(node_b, node_a.public_key, 42U, 1000U,
                                       payload, payload_length, plain,
                                       sizeof(plain), &plain_length));
        assert(std::memcmp(plain, zero, sizeof(message)) == 0);
        payload[victim] ^= 0x20;
    }

    // Intact once more, it opens.
    assert(meshtasticPkcDecryptDm(node_b, node_a.public_key, 42U, 1000U, payload,
                                  payload_length, plain, sizeof(plain),
                                  &plain_length));
    assert(plain_length == sizeof(message));
    assert(std::memcmp(plain, message, sizeof(message)) == 0);
}

void testSizingAndDegenerateInputsAreRefused()
{
    std::uint8_t entropy[32];
    for (int i = 0; i < 32; ++i) entropy[i] = static_cast<std::uint8_t>(i + 31);
    MeshtasticPkcKeypair ours{};
    assert(meshtasticPkcGenerateKeypair(entropy, ours));

    // Dead-RNG entropy is refused rather than minting a predictable key.
    const std::uint8_t dead[32] = {};
    MeshtasticPkcKeypair unused{};
    assert(!meshtasticPkcGenerateKeypair(dead, unused));

    const std::uint8_t message[4] = {9, 9, 9, 9};
    std::uint8_t payload[32];
    std::size_t payload_length = 0;

    // An output buffer one byte too small for plaintext plus overhead.
    assert(!meshtasticPkcEncryptDm(ours, ours.public_key, 1U, 2U, 3U, message,
                                   sizeof(message), payload,
                                   sizeof(message) + kMeshtasticPkcOverhead - 1,
                                   &payload_length));
    assert(meshtasticPkcEncryptDm(ours, ours.public_key, 1U, 2U, 3U, message,
                                  sizeof(message), payload, sizeof(payload),
                                  &payload_length));

    std::uint8_t plain[8];
    std::size_t plain_length = 0;
    // A payload shorter than tag plus trailer cannot be a DM at all.
    assert(!meshtasticPkcDecryptDm(ours, ours.public_key, 1U, 2U, payload,
                                   kMeshtasticPkcOverhead - 1, plain,
                                   sizeof(plain), &plain_length));
    // A plaintext buffer smaller than the message is refused up front.
    assert(!meshtasticPkcDecryptDm(ours, ours.public_key, 1U, 2U, payload,
                                   payload_length, plain, sizeof(message) - 1,
                                   &plain_length));
}

} // namespace

int main()
{
    testSha256KnownAnswers();
    testSharedKeyDerivationMatchesFirmware();
    testWeakPublicKeyIsRejected();
    testFirmwareKnownAnswerDecrypts();
    testFirmwareKnownAnswerReencrypts();
    testGeneratedKeypairsRoundTripBothDirections();
    testWrongKeysMetadataAndTamperingAreRejected();
    testSizingAndDegenerateInputsAreRefused();
    std::printf("meshtastic pkc tests passed\n");
    return 0;
}
