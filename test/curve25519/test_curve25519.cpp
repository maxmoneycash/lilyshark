// X25519 against the RFC 7748 test vectors.
//
// The static vectors, the iterated ladder, and the full Diffie-Hellman
// exchange all come verbatim from RFC 7748 sections 5.2 and 6.1, plus two
// Wycheproof exchange vectors that the Meshtastic firmware's own test suite
// uses, so a pass here means byte-compatibility with the radios in the
// field.

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "lilyshark/crypto/curve25519.h"

using namespace lilyshark;

namespace {

void hexToBytes(std::uint8_t *out, const char *hex)
{
    for (std::size_t i = 0; hex[2 * i] != '\0'; ++i) {
        const char pair[3] = {hex[2 * i], hex[2 * i + 1], '\0'};
        out[i] = static_cast<std::uint8_t>(std::strtoul(pair, nullptr, 16));
    }
}

void testRfc7748StaticVectors()
{
    // RFC 7748 section 5.2, both vectors.
    std::uint8_t scalar[32];
    std::uint8_t point[32];
    std::uint8_t expected[32];
    std::uint8_t out[32];

    hexToBytes(scalar, "a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4");
    hexToBytes(point, "e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c");
    hexToBytes(expected, "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552");
    crypto::x25519(out, scalar, point);
    assert(std::memcmp(out, expected, 32) == 0);

    hexToBytes(scalar, "4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d");
    hexToBytes(point, "e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493");
    hexToBytes(expected, "95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957");
    crypto::x25519(out, scalar, point);
    assert(std::memcmp(out, expected, 32) == 0);
}

void testRfc7748IteratedLadder()
{
    // RFC 7748 section 5.2: start with k = u = the base point encoding and
    // repeatedly feed the output back as the next scalar. One round and one
    // thousand rounds have published expectations; the million-round one is
    // skipped to keep the suite fast.
    std::uint8_t k[32] = {9};
    std::uint8_t u[32] = {9};
    std::uint8_t expected_one[32];
    std::uint8_t expected_thousand[32];
    hexToBytes(expected_one,
               "422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079");
    hexToBytes(expected_thousand,
               "684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51");

    for (unsigned round = 1; round <= 1000; ++round) {
        std::uint8_t next[32];
        crypto::x25519(next, k, u);
        std::memcpy(u, k, 32);
        std::memcpy(k, next, 32);
        if (round == 1) assert(std::memcmp(k, expected_one, 32) == 0);
    }
    assert(std::memcmp(k, expected_thousand, 32) == 0);
}

void testRfc7748DiffieHellman()
{
    // RFC 7748 section 6.1: both public keys and the shared secret.
    std::uint8_t alice_private[32];
    std::uint8_t bob_private[32];
    std::uint8_t expected_alice_public[32];
    std::uint8_t expected_bob_public[32];
    std::uint8_t expected_shared[32];
    hexToBytes(alice_private,
               "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
    hexToBytes(bob_private,
               "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
    hexToBytes(expected_alice_public,
               "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
    hexToBytes(expected_bob_public,
               "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
    hexToBytes(expected_shared,
               "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");

    std::uint8_t alice_public[32];
    std::uint8_t bob_public[32];
    crypto::x25519Base(alice_public, alice_private);
    crypto::x25519Base(bob_public, bob_private);
    assert(std::memcmp(alice_public, expected_alice_public, 32) == 0);
    assert(std::memcmp(bob_public, expected_bob_public, 32) == 0);

    std::uint8_t shared_alice[32];
    std::uint8_t shared_bob[32];
    crypto::x25519(shared_alice, alice_private, bob_public);
    crypto::x25519(shared_bob, bob_private, alice_public);
    assert(std::memcmp(shared_alice, expected_shared, 32) == 0);
    assert(std::memcmp(shared_bob, expected_shared, 32) == 0);
}

void testWycheproofExchangeVectors()
{
    // The two ordinary exchange vectors the Meshtastic firmware test suite
    // takes from Wycheproof's x25519_test.json.
    std::uint8_t private_key[32];
    std::uint8_t public_key[32];
    std::uint8_t expected[32];
    std::uint8_t shared[32];

    hexToBytes(private_key,
               "c8a9d5a91091ad851c668b0736c1c9a02936c0d3ad62670858088047ba057475");
    hexToBytes(public_key,
               "504a36999f489cd2fdbc08baff3d88fa00569ba986cba22548ffde80f9806829");
    hexToBytes(expected,
               "436a2c040cf45fea9b29a0cb81b1f41458f863d0d61b453d0a982720d6d61320");
    crypto::x25519(shared, private_key, public_key);
    assert(std::memcmp(shared, expected, 32) == 0);

    hexToBytes(private_key,
               "d85d8c061a50804ac488ad774ac716c3f5ba714b2712e048491379a500211958");
    hexToBytes(public_key,
               "63aa40c6e38346c5caf23a6df0a5e6c80889a08647e551b3563449befcfc9733");
    hexToBytes(expected,
               "279df67a7c4611db4708a0e8282b195e5ac0ed6f4b2f292c6fbd0acac30d1332");
    crypto::x25519(shared, private_key, public_key);
    assert(std::memcmp(shared, expected, 32) == 0);
}

void testSmallOrderPointYieldsZero()
{
    // A small-order u-coordinate must collapse to the all-zero output that
    // higher layers use to reject the exchange. u = 0 is the simplest one.
    std::uint8_t scalar[32];
    hexToBytes(scalar, "18630f93598637c35da623a74559cf944374a559114c7937811041fc8605564a");
    const std::uint8_t zero_point[32] = {};
    std::uint8_t shared[32];
    crypto::x25519(shared, scalar, zero_point);
    const std::uint8_t zero[32] = {};
    assert(std::memcmp(shared, zero, 32) == 0);
}

void testClampMatchesLadderConditioning()
{
    // The ladder conditions its scalar internally with the same masks, so a
    // clamped and an unclamped copy of the same entropy must agree.
    std::uint8_t raw[32];
    for (int i = 0; i < 32; ++i) raw[i] = static_cast<std::uint8_t>(0xff - i);
    std::uint8_t clamped[32];
    std::memcpy(clamped, raw, 32);
    crypto::x25519ClampPrivateKey(clamped);
    assert((clamped[0] & 7) == 0);
    assert((clamped[31] & 0x80) == 0);
    assert((clamped[31] & 0x40) != 0);

    std::uint8_t from_raw[32];
    std::uint8_t from_clamped[32];
    crypto::x25519Base(from_raw, raw);
    crypto::x25519Base(from_clamped, clamped);
    assert(std::memcmp(from_raw, from_clamped, 32) == 0);
}

} // namespace

int main()
{
    testRfc7748StaticVectors();
    testRfc7748DiffieHellman();
    testWycheproofExchangeVectors();
    testSmallOrderPointYieldsZero();
    testClampMatchesLadderConditioning();
    testRfc7748IteratedLadder();
    std::printf("curve25519 tests passed\n");
    return 0;
}
