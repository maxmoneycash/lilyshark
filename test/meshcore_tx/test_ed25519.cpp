// Ed25519 against the RFC 8032 test vectors, plus the expanded-private-key
// path MeshCore actually uses.
//
// The section 7.1 vectors are the whole point: they are the published
// definition of Ed25519, and passing them is what lets us claim a signature
// this deck produces is one a stock node will accept. They are quoted here
// exactly as the RFC prints them, seed and public key separated (the RFC
// concatenates them into a 64-byte "secret key").
//
// The second half of the file covers the shape MeshCore stores: LocalIdentity
// persists the 64-byte expanded key and throws the seed away, so signing from
// an expanded key has to work, and the known-good test-client keypair from
// MeshCore's own Identity.cpp pins that it does.

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "lilyshark/crypto/ed25519.h"

using namespace lilyshark;
using namespace lilyshark::crypto;

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

struct Rfc8032Vector {
    const char *seed;
    const char *public_key;
    const char *message;
    const char *signature;
};

// RFC 8032 section 7.1, TEST 1, TEST 2, TEST 3, TEST 1024 and TEST SHA(abc).
// The 1023-byte message is kept because it is the only vector here that runs
// the hash over more than a handful of blocks.
const Rfc8032Vector kRfc8032Vectors[] = {
    {
        "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        "",
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555f"
        "b8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    },
    {
        "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
        "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
        "72",
        "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da08"
        "5ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
    },
    {
        "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
        "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
        "af82",
        "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18"
        "ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
    },
    {
        "f5e5767cf153319517630f226876b86c8160cc583bc013744c6bf255f5cc0ee5",
        "278117fc144c72340f67d0f2316e8386ceffbf2b2428c9c51fef7c597f1d426e",
        "08b8b2b733424243760fe426a4b54908632110a66c2f6591eabd3345e3e4eb98fa"
        "6e264bf09efe12ee50f8f54e9f77b1e355f6c50544e23fb1433ddf73be84d879de"
        "7c0046dc4996d9e773f4bc9efe5738829adb26c81b37c93a1b270b20329d658675"
        "fc6ea534e0810a4432826bf58c941efb65d57a338bbd2e26640f89ffbc1a858efc"
        "b8550ee3a5e1998bd177e93a7363c344fe6b199ee5d02e82d522c4feba15452f80"
        "288a821a579116ec6dad2b3b310da903401aa62100ab5d1a36553e06203b33890c"
        "c9b832f79ef80560ccb9a39ce767967ed628c6ad573cb116dbefefd75499da96bd"
        "68a8a97b928a8bbc103b6621fcde2beca1231d206be6cd9ec7aff6f6c94fcd7204"
        "ed3455c68c83f4a41da4af2b74ef5c53f1d8ac70bdcb7ed185ce81bd84359d4425"
        "4d95629e9855a94a7c1958d1f8ada5d0532ed8a5aa3fb2d17ba70eb6248e594e1a"
        "2297acbbb39d502f1a8c6eb6f1ce22b3de1a1f40cc24554119a831a9aad6079cad"
        "88425de6bde1a9187ebb6092cf67bf2b13fd65f27088d78b7e883c8759d2c4f5c6"
        "5adb7553878ad575f9fad878e80a0c9ba63bcbcc2732e69485bbc9c90bfbd62481"
        "d9089beccf80cfe2df16a2cf65bd92dd597b0707e0917af48bbb75fed413d238f5"
        "555a7a569d80c3414a8d0859dc65a46128bab27af87a71314f318c782b23ebfe80"
        "8b82b0ce26401d2e22f04d83d1255dc51addd3b75a2b1ae0784504df543af8969b"
        "e3ea7082ff7fc9888c144da2af58429ec96031dbcad3dad9af0dcbaaaf268cb8fc"
        "ffead94f3c7ca495e056a9b47acdb751fb73e666c6c655ade8297297d07ad1ba5e"
        "43f1bca32301651339e22904cc8c42f58c30c04aafdb038dda0847dd988dcda6f3"
        "bfd15c4b4c4525004aa06eeff8ca61783aacec57fb3d1f92b0fe2fd1a85f672451"
        "7b65e614ad6808d6f6ee34dff7310fdc82aebfd904b01e1dc54b2927094b2db68d"
        "6f903b68401adebf5a7e08d78ff4ef5d63653a65040cf9bfd4aca7984a74d37145"
        "986780fc0b16ac451649de6188a7dbdf191f64b5fc5e2ab47b57f7f7276cd419c1"
        "7a3ca8e1b939ae49e488acba6b965610b5480109c8b17b80e1b7b750dfc7598d5d"
        "5011fd2dcc5600a32ef5b52a1ecc820e308aa342721aac0943bf6686b64b257937"
        "6504ccc493d97e6aed3fb0f9cd71a43dd497f01f17c0e2cb3797aa2a2f25665616"
        "8e6c496afc5fb93246f6b1116398a346f1a641f3b041e989f7914f90cc2c7fff35"
        "7876e506b50d334ba77c225bc307ba537152f3f1610e4eafe595f6d9d90d11faa9"
        "33a15ef1369546868a7f3a45a96768d40fd9d03412c091c6315cf4fde7cb686069"
        "37380db2eaaa707b4c4185c32eddcdd306705e4dc1ffc872eeee475a64dfac86ab"
        "a41c0618983f8741c5ef68d3a101e8a3b8cac60c905c15fc910840b94c00a0b9d0",
        "0aab4c900501b3e24d7cdf4663326a3a87df5e4843b2cbdb67cbf6e460fec350aa"
        "5371b1508f9f4528ecea23c436d94b5e8fcd4f681e30a6ac00a9704a188a03",
    },
    {
        "833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42",
        "ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf",
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a21"
        "92992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
        "dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b58909"
        "351fc9ac90b3ecfdfbc7c66431e0303dca179c138ac17ad9bef1177331a704",
    },
};

// The message in the largest RFC vector is 1023 bytes; everything else here is
// far smaller.
constexpr std::size_t kMaxVectorMessageBytes = 1024;

void testRfc8032Vectors()
{
    for (const Rfc8032Vector &vector : kRfc8032Vectors) {
        std::uint8_t seed[kEd25519SeedSize];
        std::uint8_t expected_public[kEd25519PublicKeySize];
        std::uint8_t expected_signature[kEd25519SignatureSize];
        std::uint8_t message[kMaxVectorMessageBytes];

        assert(hexToBytes(seed, vector.seed) == kEd25519SeedSize);
        assert(hexToBytes(expected_public, vector.public_key) == kEd25519PublicKeySize);
        assert(hexToBytes(expected_signature, vector.signature) == kEd25519SignatureSize);
        const std::size_t message_length = hexToBytes(message, vector.message);
        assert(message_length <= kMaxVectorMessageBytes);

        std::uint8_t public_key[kEd25519PublicKeySize];
        std::uint8_t private_key[kEd25519PrivateKeySize];
        ed25519CreateKeypair(public_key, private_key, seed);
        assert(std::memcmp(public_key, expected_public, kEd25519PublicKeySize) == 0);

        std::uint8_t signature[kEd25519SignatureSize];
        ed25519Sign(signature, message, message_length, public_key, private_key);
        assert(std::memcmp(signature, expected_signature, kEd25519SignatureSize) == 0);

        assert(ed25519Verify(signature, message, message_length, public_key));
    }
}

void testTamperedSignaturesAndMessagesAreRejected()
{
    std::uint8_t seed[kEd25519SeedSize];
    std::uint8_t public_key[kEd25519PublicKeySize];
    std::uint8_t private_key[kEd25519PrivateKeySize];
    hexToBytes(seed, "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7");
    ed25519CreateKeypair(public_key, private_key, seed);

    const std::uint8_t message[] = {0xaf, 0x82};
    std::uint8_t signature[kEd25519SignatureSize];
    ed25519Sign(signature, message, sizeof(message), public_key, private_key);
    assert(ed25519Verify(signature, message, sizeof(message), public_key));

    // Every byte of the signature is load-bearing: flipping the low bit of any
    // one of them must break verification. This catches a truncated compare
    // far more reliably than a single hand-picked mutation.
    for (std::size_t index = 0; index < kEd25519SignatureSize; ++index) {
        std::uint8_t mutated[kEd25519SignatureSize];
        std::memcpy(mutated, signature, sizeof(mutated));
        mutated[index] ^= 0x01;
        assert(!ed25519Verify(mutated, message, sizeof(message), public_key));
    }

    const std::uint8_t altered_message[] = {0xaf, 0x83};
    assert(!ed25519Verify(signature, altered_message, sizeof(altered_message), public_key));

    std::uint8_t other_public[kEd25519PublicKeySize];
    std::uint8_t other_private[kEd25519PrivateKeySize];
    std::uint8_t other_seed[kEd25519SeedSize];
    hexToBytes(other_seed, "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");
    ed25519CreateKeypair(other_public, other_private, other_seed);
    assert(!ed25519Verify(signature, message, sizeof(message), other_public));
}

void testNonCurvePublicKeyIsRejected()
{
    // A y-coordinate with no matching x is not a point, and verification must
    // say so rather than running the equation on garbage. Advert signatures
    // arrive from the air, so this path is reachable by anyone with a radio.
    std::uint8_t signature[kEd25519SignatureSize]{};
    std::uint8_t not_a_point[kEd25519PublicKeySize];
    std::memset(not_a_point, 0xff, sizeof(not_a_point));
    const std::uint8_t message[] = {0x00};
    assert(!ed25519Verify(signature, message, sizeof(message), not_a_point));
}

void testMeshCoreTestClientKeypair()
{
    // MeshCore's LocalIdentity::validatePrivateKey carries this pair as its
    // known-good keypair. It is stored the way MeshCore stores every identity:
    // the 64-byte expanded private key, with no seed anywhere. Deriving the
    // published public key from it proves our expanded-key entry point matches
    // orlp/ed25519's ed25519_derive_pub.
    std::uint8_t private_key[kEd25519PrivateKeySize];
    std::uint8_t expected_public[kEd25519PublicKeySize];
    assert(hexToBytes(private_key,
                      "7065e18fd9fabb70c1ed90dca19907de698c88b709ea146eafd93d9b830c7b60"
                      "c4681193c79bbc39945ba8064104bb618f8fd7a84a0af6f57033d6e8ddcd6471") ==
           kEd25519PrivateKeySize);
    assert(hexToBytes(expected_public,
                      "1ec77175b0918ed206f9ae04ec136d6d5d4315bb26305427f645b492e9350c10") ==
           kEd25519PublicKeySize);

    std::uint8_t public_key[kEd25519PublicKeySize];
    ed25519DerivePublicKey(public_key, private_key);
    assert(std::memcmp(public_key, expected_public, kEd25519PublicKeySize) == 0);

    // The clamping MeshCore applied when it generated this key is visible in
    // the stored bytes, and our signer relies on it already being applied.
    assert((private_key[0] & 0x07) == 0);
    assert((private_key[31] & 0x80) == 0);
    assert((private_key[31] & 0x40) != 0);

    const char *text = "lilyshark";
    std::uint8_t signature[kEd25519SignatureSize];
    ed25519Sign(signature, reinterpret_cast<const std::uint8_t *>(text), std::strlen(text),
                public_key, private_key);
    assert(ed25519Verify(signature, reinterpret_cast<const std::uint8_t *>(text),
                         std::strlen(text), public_key));
}

void testExpandedKeyMatchesSeedExpansion()
{
    // Whichever way an identity arrives — generated here from a seed, or
    // imported as a stored 64-byte key — the two paths have to land on the
    // same signature, or a key round-tripped through NVS would stop matching
    // the adverts already on the air under it.
    std::uint8_t seed[kEd25519SeedSize];
    std::memset(seed, 0x11, sizeof(seed));

    std::uint8_t expanded[kEd25519PrivateKeySize];
    ed25519ExpandSeed(expanded, seed);
    assert((expanded[0] & 0x07) == 0);
    assert((expanded[31] & 0x80) == 0);
    assert((expanded[31] & 0x40) != 0);

    std::uint8_t from_seed_public[kEd25519PublicKeySize];
    std::uint8_t from_seed_private[kEd25519PrivateKeySize];
    ed25519CreateKeypair(from_seed_public, from_seed_private, seed);
    assert(std::memcmp(from_seed_private, expanded, kEd25519PrivateKeySize) == 0);

    std::uint8_t derived_public[kEd25519PublicKeySize];
    ed25519DerivePublicKey(derived_public, expanded);
    assert(std::memcmp(derived_public, from_seed_public, kEd25519PublicKeySize) == 0);

    std::uint8_t expected_public[kEd25519PublicKeySize];
    hexToBytes(expected_public, "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737");
    assert(std::memcmp(derived_public, expected_public, kEd25519PublicKeySize) == 0);
}

void testPaddingBoundaryVector()
{
    // 88 bytes is chosen so the nonce hash (32-byte prefix + message) lands in
    // the last sixteen bytes of a SHA-512 block and has to spill into a second
    // padding block, while the challenge hash does not. That branch has no
    // published vector of its own, so this signature was generated with the
    // RFC 8032 appendix reference implementation and pinned here.
    std::uint8_t seed[kEd25519SeedSize];
    std::memset(seed, 0x11, sizeof(seed));
    std::uint8_t public_key[kEd25519PublicKeySize];
    std::uint8_t private_key[kEd25519PrivateKeySize];
    ed25519CreateKeypair(public_key, private_key, seed);

    std::uint8_t message[88];
    for (std::size_t index = 0; index < sizeof(message); ++index) {
        message[index] = static_cast<std::uint8_t>(index);
    }

    std::uint8_t expected_signature[kEd25519SignatureSize];
    hexToBytes(expected_signature,
               "8daf35c0db1334ee91c41c2e1b08da809e689cc42a8676c2efe7b51fae0303d0"
               "6aa9e2dd3947167e3491e6e017287f47e1b1e0ed54312470e62557fb4f0e6800");

    std::uint8_t signature[kEd25519SignatureSize];
    ed25519Sign(signature, message, sizeof(message), public_key, private_key);
    assert(std::memcmp(signature, expected_signature, kEd25519SignatureSize) == 0);
    assert(ed25519Verify(signature, message, sizeof(message), public_key));
}

void testSignAndVerifyAcrossHashBlockBoundaries()
{
    // Sign and verify at every message length that sits near a SHA-512 block
    // edge, so a padding mistake shows up as a self-inconsistency even where
    // no published vector reaches.
    std::uint8_t seed[kEd25519SeedSize];
    std::memset(seed, 0x5a, sizeof(seed));
    std::uint8_t public_key[kEd25519PublicKeySize];
    std::uint8_t private_key[kEd25519PrivateKeySize];
    ed25519CreateKeypair(public_key, private_key, seed);

    const std::size_t lengths[] = {0,  1,  63, 64,  71,  72,  79,  80,  87, 88,
                                   95, 96, 111, 112, 119, 120, 127, 128, 129, 184};
    std::uint8_t message[200];
    for (std::size_t index = 0; index < sizeof(message); ++index) {
        message[index] = static_cast<std::uint8_t>(index * 7 + 1);
    }

    for (const std::size_t length : lengths) {
        assert(length <= sizeof(message));
        std::uint8_t signature[kEd25519SignatureSize];
        ed25519Sign(signature, message, length, public_key, private_key);
        assert(ed25519Verify(signature, message, length, public_key));
        signature[0] ^= 0x80;
        assert(!ed25519Verify(signature, message, length, public_key));
    }
}

} // namespace

int main()
{
    testRfc8032Vectors();
    testTamperedSignaturesAndMessagesAreRejected();
    testNonCurvePublicKeyIsRejected();
    testMeshCoreTestClientKeypair();
    testExpandedKeyMatchesSeedExpansion();
    testPaddingBoundaryVector();
    testSignAndVerifyAcrossHashBlockBoundaries();
    std::printf("ed25519 tests passed\n");
    return 0;
}
