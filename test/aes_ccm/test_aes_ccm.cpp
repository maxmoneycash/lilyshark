// AES-CCM against published vectors, plus the AES-256 core it rides on.
//
// The mode is checked against RFC 3610's first three packet vectors
// (AES-128, 8-byte tag) and a NIST CAVP CCM-VNT vector (AES-256, 16-byte
// tag, 13-byte nonce), and the AES-256 block cipher alone against the NIST
// SP 800-38A F.1.5 known answers. Tamper cases then prove a flipped bit
// anywhere — ciphertext, tag, nonce, or associated data — is rejected and
// the plaintext buffer scrubbed.

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "lilyshark/crypto/aes128.h"
#include "lilyshark/crypto/aes_ccm.h"

using namespace lilyshark;

namespace {

void hexToBytes(std::uint8_t *out, const char *hex)
{
    for (std::size_t i = 0; hex[2 * i] != '\0'; ++i) {
        const char pair[3] = {hex[2 * i], hex[2 * i + 1], '\0'};
        out[i] = static_cast<std::uint8_t>(std::strtoul(pair, nullptr, 16));
    }
}

void testAes256NistEcbVectors()
{
    // NIST SP 800-38A appendix F.1.5 (AES-256 ECB), first three blocks.
    std::uint8_t key[32];
    hexToBytes(key, "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    const crypto::Aes256 aes(key);

    const char *plain_hex[3] = {"6bc1bee22e409f96e93d7e117393172a",
                                "ae2d8a571e03ac9c9eb76fac45af8e51",
                                "30c81c46a35ce411e5fbc1191a0a52ef"};
    const char *cipher_hex[3] = {"f3eed1bdb5d2a03c064b5a7e3db181f8",
                                 "591ccb10d410ed26dc5ba74a31362870",
                                 "b6ed21b99ca6f4f9f153e7b1beafed1d"};
    for (int i = 0; i < 3; ++i) {
        std::uint8_t plain[16];
        std::uint8_t expected[16];
        std::uint8_t out[16];
        hexToBytes(plain, plain_hex[i]);
        hexToBytes(expected, cipher_hex[i]);
        aes.encryptBlock(plain, out);
        assert(std::memcmp(out, expected, 16) == 0);
    }
}

/// Run one RFC 3610 packet vector: encrypt must reproduce the published
/// bytes exactly and decrypt must round-trip them.
void checkRfc3610Vector(const char *nonce_hex, std::size_t plain_length,
                        const char *cipher_hex, const char *tag_hex)
{
    std::uint8_t key[16];
    hexToBytes(key, "c0c1c2c3c4c5c6c7c8c9cacbcccdcecf");
    std::uint8_t nonce[13];
    hexToBytes(nonce, nonce_hex);
    const std::uint8_t aad[8] = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07};

    // Every RFC 3610 vector's payload is the bytes 0x08 upward.
    std::uint8_t plain[32];
    for (std::size_t i = 0; i < plain_length; ++i) {
        plain[i] = static_cast<std::uint8_t>(8 + i);
    }
    std::uint8_t expected_cipher[32];
    std::uint8_t expected_tag[8];
    hexToBytes(expected_cipher, cipher_hex);
    hexToBytes(expected_tag, tag_hex);

    std::uint8_t cipher[32];
    std::uint8_t tag[8];
    assert(crypto::aesCcmEncrypt(key, sizeof(key), nonce, plain, plain_length,
                                 aad, sizeof(aad), cipher, tag, sizeof(tag)));
    assert(std::memcmp(cipher, expected_cipher, plain_length) == 0);
    assert(std::memcmp(tag, expected_tag, sizeof(tag)) == 0);

    std::uint8_t back[32];
    assert(crypto::aesCcmDecrypt(key, sizeof(key), nonce, cipher, plain_length,
                                 aad, sizeof(aad), tag, sizeof(tag), back));
    assert(std::memcmp(back, plain, plain_length) == 0);
}

void testRfc3610PacketVectors()
{
    checkRfc3610Vector("00000003020100a0a1a2a3a4a5", 23,
                       "588c979a61c663d2f066d0c2c0f989806d5f6b61dac384",
                       "17e8d12cfdf926e0");
    checkRfc3610Vector("00000004030201a0a1a2a3a4a5", 24,
                       "72c91a36e135f8cf291ca894085c87e3cc15c439c9e43a3b",
                       "a091d56e10400916");
    checkRfc3610Vector("00000005040302a0a1a2a3a4a5", 25,
                       "51b1e5f44a197d1da46b0f8e2d282ae871e838bb64da859657",
                       "4adaa76fbd9fb0c5");
}

void testNistCavpAes256Vector()
{
    // NIST CAVP CCM-VNT (AES-256), the count-60 entry with a 13-byte nonce:
    // 32-byte associated data, 24-byte payload, 16-byte tag.
    std::uint8_t key[32];
    std::uint8_t nonce[13];
    std::uint8_t aad[32];
    std::uint8_t plain[24];
    std::uint8_t expected_cipher[24];
    std::uint8_t expected_tag[16];
    hexToBytes(key, "4a75ff2f66dae2935403cce27e829ad8be98185c73f8bc61d3ce950a83007e11");
    hexToBytes(nonce, "46eb390b175e75da6193d7edb6");
    hexToBytes(aad, "282f05f734f249c0535ee396282218b7c4913c39b59ad2a03ffaf5b0e9b0f780");
    hexToBytes(plain, "205f2a664a8512e18321a91c13ec13b9e6b633228c57cc1e");
    hexToBytes(expected_cipher, "58f1584f761983bef4d0060746b5d5ee610ecfda31101a7f");
    hexToBytes(expected_tag, "5460e9b7856d60a5ad9803c0762f8176");

    std::uint8_t cipher[24];
    std::uint8_t tag[16];
    assert(crypto::aesCcmEncrypt(key, sizeof(key), nonce, plain, sizeof(plain),
                                 aad, sizeof(aad), cipher, tag, sizeof(tag)));
    assert(std::memcmp(cipher, expected_cipher, sizeof(cipher)) == 0);
    assert(std::memcmp(tag, expected_tag, sizeof(tag)) == 0);

    std::uint8_t back[24];
    assert(crypto::aesCcmDecrypt(key, sizeof(key), nonce, cipher, sizeof(cipher),
                                 aad, sizeof(aad), tag, sizeof(tag), back));
    assert(std::memcmp(back, plain, sizeof(plain)) == 0);
}

void testTamperingIsRejectedAndPlaintextScrubbed()
{
    std::uint8_t key[32];
    hexToBytes(key, "4a75ff2f66dae2935403cce27e829ad8be98185c73f8bc61d3ce950a83007e11");
    std::uint8_t nonce[13];
    hexToBytes(nonce, "46eb390b175e75da6193d7edb6");
    const std::uint8_t aad[4] = {0xde, 0xad, 0xbe, 0xef};
    std::uint8_t plain[21];
    for (std::size_t i = 0; i < sizeof(plain); ++i) {
        plain[i] = static_cast<std::uint8_t>(i * 3 + 1);
    }

    std::uint8_t cipher[sizeof(plain)];
    std::uint8_t tag[8];
    assert(crypto::aesCcmEncrypt(key, sizeof(key), nonce, plain, sizeof(plain),
                                 aad, sizeof(aad), cipher, tag, sizeof(tag)));

    std::uint8_t back[sizeof(plain)];
    const std::uint8_t zero[sizeof(plain)] = {};

    // Each mutation flips one bit somewhere the tag must cover.
    cipher[5] ^= 0x10;
    assert(!crypto::aesCcmDecrypt(key, sizeof(key), nonce, cipher, sizeof(cipher),
                                  aad, sizeof(aad), tag, sizeof(tag), back));
    assert(std::memcmp(back, zero, sizeof(back)) == 0);
    cipher[5] ^= 0x10;

    tag[0] ^= 0x01;
    assert(!crypto::aesCcmDecrypt(key, sizeof(key), nonce, cipher, sizeof(cipher),
                                  aad, sizeof(aad), tag, sizeof(tag), back));
    tag[0] ^= 0x01;

    nonce[12] ^= 0x80;
    assert(!crypto::aesCcmDecrypt(key, sizeof(key), nonce, cipher, sizeof(cipher),
                                  aad, sizeof(aad), tag, sizeof(tag), back));
    nonce[12] ^= 0x80;

    std::uint8_t wrong_aad[4];
    std::memcpy(wrong_aad, aad, sizeof(aad));
    wrong_aad[2] ^= 0x04;
    assert(!crypto::aesCcmDecrypt(key, sizeof(key), nonce, cipher, sizeof(cipher),
                                  wrong_aad, sizeof(wrong_aad), tag, sizeof(tag), back));

    // With everything intact again, the message still authenticates.
    assert(crypto::aesCcmDecrypt(key, sizeof(key), nonce, cipher, sizeof(cipher),
                                 aad, sizeof(aad), tag, sizeof(tag), back));
    assert(std::memcmp(back, plain, sizeof(plain)) == 0);
}

void testZeroLengthPlaintextAuthenticates()
{
    // An empty message is legal CCM: the tag alone authenticates the nonce
    // and associated data.
    std::uint8_t key[32] = {};
    key[0] = 1;
    std::uint8_t nonce[13] = {};
    const std::uint8_t aad[2] = {0xaa, 0xbb};
    std::uint8_t tag[8];
    assert(crypto::aesCcmEncrypt(key, sizeof(key), nonce, nullptr, 0, aad,
                                 sizeof(aad), nullptr, tag, sizeof(tag)));
    assert(crypto::aesCcmDecrypt(key, sizeof(key), nonce, nullptr, 0, aad,
                                 sizeof(aad), tag, sizeof(tag), nullptr));
    tag[3] ^= 0x40;
    assert(!crypto::aesCcmDecrypt(key, sizeof(key), nonce, nullptr, 0, aad,
                                  sizeof(aad), tag, sizeof(tag), nullptr));
}

void testBadParametersAreRefused()
{
    std::uint8_t key[32] = {};
    std::uint8_t nonce[13] = {};
    std::uint8_t plain[4] = {};
    std::uint8_t cipher[4];
    std::uint8_t tag[8];

    // A 24-byte key is real AES but not a CCM key size Meshtastic uses, and
    // this module refuses what it cannot test.
    assert(!crypto::aesCcmEncrypt(key, 24, nonce, plain, sizeof(plain), nullptr,
                                  0, cipher, tag, sizeof(tag)));
    // Odd and out-of-range tag lengths have no CCM encoding.
    assert(!crypto::aesCcmEncrypt(key, 32, nonce, plain, sizeof(plain), nullptr,
                                  0, cipher, tag, 7));
    assert(!crypto::aesCcmEncrypt(key, 32, nonce, plain, sizeof(plain), nullptr,
                                  0, cipher, tag, 2));
    assert(!crypto::aesCcmEncrypt(key, 32, nonce, plain, sizeof(plain), nullptr,
                                  0, cipher, tag, 18));
}

} // namespace

int main()
{
    testAes256NistEcbVectors();
    testRfc3610PacketVectors();
    testNistCavpAes256Vector();
    testTamperingIsRejectedAndPlaintextScrubbed();
    testZeroLengthPlaintextAuthenticates();
    testBadParametersAreRefused();
    std::printf("aes_ccm tests passed\n");
    return 0;
}
