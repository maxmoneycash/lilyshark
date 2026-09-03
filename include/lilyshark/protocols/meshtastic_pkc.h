#pragma once

// Meshtastic 2.5+ public-key direct messages (PKC).
//
// The construction is verified against meshtastic/firmware
// src/mesh/CryptoEngine.cpp (encryptCurve25519 / decryptCurve25519) rather
// than reconstructed from documentation:
//
//   session key = SHA-256( X25519(our private key, their public key) )
//   cipher      = AES-256-CCM, 8-byte tag, no associated data
//   nonce (13)  = packet id (4, LE) || extra nonce (4, LE)
//                 || sending node number (4, LE) || 0x00
//   payload     = ciphertext || tag (8) || extra nonce (4, LE)
//
// The extra nonce is fresh randomness the sender mixes into every packet so
// that a reused packet id cannot reuse a keystream; it travels in clear at
// the end of the payload because the receiver needs it to rebuild the nonce.
// The firmware's own test vector (test/test_crypto) round-trips through this
// implementation byte-for-byte.

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kMeshtasticPkcKeySize = 32;
inline constexpr std::size_t kMeshtasticPkcTagSize = 8;
inline constexpr std::size_t kMeshtasticPkcExtraNonceSize = 4;

/// Every encrypted payload is this much longer than its plaintext.
inline constexpr std::size_t kMeshtasticPkcOverhead =
    kMeshtasticPkcTagSize + kMeshtasticPkcExtraNonceSize;

/// A node's Curve25519 identity. Plain fixed-size bytes with no padding so
/// the whole struct can be persisted to NVS as a single 64-byte blob and
/// read back on any firmware build. The public half is what User.public_key
/// carries over the air.
struct MeshtasticPkcKeypair {
    std::uint8_t private_key[kMeshtasticPkcKeySize];
    std::uint8_t public_key[kMeshtasticPkcKeySize];
};
static_assert(sizeof(MeshtasticPkcKeypair) == 2 * kMeshtasticPkcKeySize,
              "the keypair must stay a packed 64-byte NVS blob");

/// Build a keypair from 32 bytes of hardware randomness supplied by the
/// caller — the crypto core deliberately has no RNG of its own. The entropy
/// is clamped into a canonical private key and the public key derived from
/// it. Returns false only for all-zero entropy, which no working RNG
/// produces, so a dead RNG cannot silently mint a predictable identity.
bool meshtasticPkcGenerateKeypair(const std::uint8_t entropy[kMeshtasticPkcKeySize],
                                  MeshtasticPkcKeypair &keypair) noexcept;

/// Derive the AES-256 session key both directions of a DM share. Returns
/// false for a blank private key or when the X25519 exchange lands on a
/// small-order point (an all-zero shared secret), mirroring the weak-key
/// rejection in the firmware's Curve25519::dh2.
bool meshtasticPkcDeriveSharedKey(const std::uint8_t our_private[kMeshtasticPkcKeySize],
                                  const std::uint8_t their_public[kMeshtasticPkcKeySize],
                                  std::uint8_t shared_key[kMeshtasticPkcKeySize]) noexcept;

/// Encrypt one direct message. `extra_nonce` must be fresh randomness from
/// the caller for every packet. Writes plain_length + kMeshtasticPkcOverhead
/// bytes into `out` and reports the total via `out_length`. Returns false —
/// writing nothing — when the buffer is too small, the key exchange is
/// rejected, or the plaintext exceeds the mode's 65535-byte limit.
bool meshtasticPkcEncryptDm(const MeshtasticPkcKeypair &ours,
                            const std::uint8_t their_public[kMeshtasticPkcKeySize],
                            std::uint32_t from_node, std::uint32_t packet_id,
                            std::uint32_t extra_nonce,
                            const std::uint8_t *plain, std::size_t plain_length,
                            std::uint8_t *out, std::size_t out_capacity,
                            std::size_t *out_length) noexcept;

/// Decrypt one direct message payload (everything after the 16-byte packet
/// header). `from_node` is the sender, whose public key `their_public` must
/// be; `packet_id` is the header's id field. Returns true only when the tag
/// authenticates; on any failure the plaintext buffer is zeroed.
bool meshtasticPkcDecryptDm(const MeshtasticPkcKeypair &ours,
                            const std::uint8_t their_public[kMeshtasticPkcKeySize],
                            std::uint32_t from_node, std::uint32_t packet_id,
                            const std::uint8_t *payload, std::size_t payload_length,
                            std::uint8_t *plain_out, std::size_t plain_capacity,
                            std::size_t *plain_length_out) noexcept;

} // namespace lilyshark
