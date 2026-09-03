#include "lilyshark/protocols/meshtastic_pkc.h"

#include "lilyshark/crypto/aes_ccm.h"
#include "lilyshark/crypto/curve25519.h"
#include "lilyshark/crypto/sha256.h"

#include <cstring>

namespace lilyshark {
namespace {

bool allZero(const std::uint8_t *bytes, std::size_t length) noexcept
{
    std::uint8_t merged = 0;
    for (std::size_t i = 0; i < length; ++i) merged |= bytes[i];
    return merged == 0;
}

/// The 13-byte CCM nonce, matching CryptoEngine::initNonce byte-for-byte.
/// The firmware memcpys little-endian integers on a little-endian CPU; this
/// spells the bytes out so the wire format holds on any host.
void buildNonce(std::uint32_t from_node, std::uint32_t packet_id,
                std::uint32_t extra_nonce,
                std::uint8_t nonce[crypto::kCcmNonceSize]) noexcept
{
    nonce[0] = static_cast<std::uint8_t>(packet_id);
    nonce[1] = static_cast<std::uint8_t>(packet_id >> 8);
    nonce[2] = static_cast<std::uint8_t>(packet_id >> 16);
    nonce[3] = static_cast<std::uint8_t>(packet_id >> 24);
    // These four bytes are the high half of the firmware's 64-bit packet
    // number, which its random extra nonce then overwrites.
    nonce[4] = static_cast<std::uint8_t>(extra_nonce);
    nonce[5] = static_cast<std::uint8_t>(extra_nonce >> 8);
    nonce[6] = static_cast<std::uint8_t>(extra_nonce >> 16);
    nonce[7] = static_cast<std::uint8_t>(extra_nonce >> 24);
    nonce[8] = static_cast<std::uint8_t>(from_node);
    nonce[9] = static_cast<std::uint8_t>(from_node >> 8);
    nonce[10] = static_cast<std::uint8_t>(from_node >> 16);
    nonce[11] = static_cast<std::uint8_t>(from_node >> 24);
    nonce[12] = 0;
}

} // namespace

bool meshtasticPkcGenerateKeypair(const std::uint8_t entropy[kMeshtasticPkcKeySize],
                                  MeshtasticPkcKeypair &keypair) noexcept
{
    if (entropy == nullptr || allZero(entropy, kMeshtasticPkcKeySize)) return false;
    std::memcpy(keypair.private_key, entropy, kMeshtasticPkcKeySize);
    crypto::x25519ClampPrivateKey(keypair.private_key);
    crypto::x25519Base(keypair.public_key, keypair.private_key);
    return true;
}

bool meshtasticPkcDeriveSharedKey(const std::uint8_t our_private[kMeshtasticPkcKeySize],
                                  const std::uint8_t their_public[kMeshtasticPkcKeySize],
                                  std::uint8_t shared_key[kMeshtasticPkcKeySize]) noexcept
{
    if (our_private == nullptr || their_public == nullptr || shared_key == nullptr) {
        return false;
    }
    if (allZero(our_private, kMeshtasticPkcKeySize)) return false;

    std::uint8_t secret[kMeshtasticPkcKeySize];
    crypto::x25519(secret, our_private, their_public);
    // A small-order public key (all-zero included) collapses the exchange to
    // an attacker-known secret; the firmware's dh2 refuses it and so do we.
    if (allZero(secret, sizeof(secret))) return false;

    crypto::sha256(secret, sizeof(secret), shared_key);
    std::memset(secret, 0, sizeof(secret));
    return true;
}

bool meshtasticPkcEncryptDm(const MeshtasticPkcKeypair &ours,
                            const std::uint8_t their_public[kMeshtasticPkcKeySize],
                            std::uint32_t from_node, std::uint32_t packet_id,
                            std::uint32_t extra_nonce,
                            const std::uint8_t *plain, std::size_t plain_length,
                            std::uint8_t *out, std::size_t out_capacity,
                            std::size_t *out_length) noexcept
{
    if (out == nullptr || out_length == nullptr) return false;
    if (plain == nullptr && plain_length != 0) return false;
    const std::size_t total = plain_length + kMeshtasticPkcOverhead;
    if (total < plain_length || out_capacity < total) return false;

    std::uint8_t shared_key[kMeshtasticPkcKeySize];
    if (!meshtasticPkcDeriveSharedKey(ours.private_key, their_public, shared_key)) {
        return false;
    }

    std::uint8_t nonce[crypto::kCcmNonceSize];
    buildNonce(from_node, packet_id, extra_nonce, nonce);

    const bool ok = crypto::aesCcmEncrypt(shared_key, sizeof(shared_key), nonce,
                                          plain, plain_length, nullptr, 0, out,
                                          out + plain_length, kMeshtasticPkcTagSize);
    std::memset(shared_key, 0, sizeof(shared_key));
    if (!ok) return false;

    // The extra nonce rides in clear after the tag so the receiver can
    // rebuild the same 13-byte nonce.
    std::uint8_t *trailer = out + plain_length + kMeshtasticPkcTagSize;
    trailer[0] = static_cast<std::uint8_t>(extra_nonce);
    trailer[1] = static_cast<std::uint8_t>(extra_nonce >> 8);
    trailer[2] = static_cast<std::uint8_t>(extra_nonce >> 16);
    trailer[3] = static_cast<std::uint8_t>(extra_nonce >> 24);
    *out_length = total;
    return true;
}

bool meshtasticPkcDecryptDm(const MeshtasticPkcKeypair &ours,
                            const std::uint8_t their_public[kMeshtasticPkcKeySize],
                            std::uint32_t from_node, std::uint32_t packet_id,
                            const std::uint8_t *payload, std::size_t payload_length,
                            std::uint8_t *plain_out, std::size_t plain_capacity,
                            std::size_t *plain_length_out) noexcept
{
    if (payload == nullptr || plain_length_out == nullptr) return false;
    if (payload_length < kMeshtasticPkcOverhead) return false;
    const std::size_t cipher_length = payload_length - kMeshtasticPkcOverhead;
    if (plain_capacity < cipher_length) return false;
    if (plain_out == nullptr && cipher_length != 0) return false;

    std::uint8_t shared_key[kMeshtasticPkcKeySize];
    if (!meshtasticPkcDeriveSharedKey(ours.private_key, their_public, shared_key)) {
        return false;
    }

    const std::uint8_t *tag = payload + cipher_length;
    const std::uint8_t *trailer = tag + kMeshtasticPkcTagSize;
    const std::uint32_t extra_nonce = std::uint32_t(trailer[0]) |
                                      (std::uint32_t(trailer[1]) << 8) |
                                      (std::uint32_t(trailer[2]) << 16) |
                                      (std::uint32_t(trailer[3]) << 24);

    std::uint8_t nonce[crypto::kCcmNonceSize];
    buildNonce(from_node, packet_id, extra_nonce, nonce);

    const bool ok = crypto::aesCcmDecrypt(shared_key, sizeof(shared_key), nonce,
                                          payload, cipher_length, nullptr, 0, tag,
                                          kMeshtasticPkcTagSize, plain_out);
    std::memset(shared_key, 0, sizeof(shared_key));
    if (!ok) return false;

    *plain_length_out = cipher_length;
    return true;
}

} // namespace lilyshark
