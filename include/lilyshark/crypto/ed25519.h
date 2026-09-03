#pragma once

// Ed25519 signatures (RFC 8032), for MeshCore node identity.
//
// A MeshCore node's address is its Ed25519 public key, and every advert it
// floods carries a signature over the identity it claims. Without this the
// deck can decode MeshCore but can never appear on the network.
//
// Self-contained rather than pulled from mbedtls, for the same reason as
// aes128.h and sha256.h: the same bytes run in the host tests and on the
// ESP32, and they are checked against the RFC 8032 section 7.1 known-answer
// vectors in test/meshcore_tx.
//
// Two private-key shapes appear here because MeshCore stores the expanded
// form. RFC 8032 keys start life as a 32-byte seed; SHA-512 and clamping turn
// that into a 64-byte expanded key whose low half is the scalar and whose high
// half is the deterministic nonce prefix. MeshCore's LocalIdentity persists
// exactly those 64 bytes (its `prv_key`) and never keeps the seed, so signing
// has to work from the expanded form to interoperate with a key imported from
// a stock node — and so that our own persisted identity can use the same
// layout.
//
// No allocation, no exceptions. Signing and verification are stack-only; the
// deepest call needs roughly 1.5 KB, which matters on the ESP32 where the LVGL
// loop task is not generously sized.

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace crypto {

inline constexpr std::size_t kEd25519SeedSize = 32;
inline constexpr std::size_t kEd25519PublicKeySize = 32;
inline constexpr std::size_t kEd25519PrivateKeySize = 64;
inline constexpr std::size_t kEd25519SignatureSize = 64;

/// Expand a 32-byte seed into the 64-byte private key: SHA-512 of the seed
/// with the RFC 8032 clamping applied to the low half. Deterministic, so the
/// same seed always yields the same identity.
void ed25519ExpandSeed(std::uint8_t expanded[kEd25519PrivateKeySize],
                       const std::uint8_t seed[kEd25519SeedSize]) noexcept;

/// Recover the public key from an expanded private key, which is what a node
/// does when it has loaded a stored `prv_key` and needs its own address back.
void ed25519DerivePublicKey(std::uint8_t public_key[kEd25519PublicKeySize],
                            const std::uint8_t expanded[kEd25519PrivateKeySize]) noexcept;

/// Generate both halves of an identity from a seed. `seed` must come from a
/// real entropy source; the caller owns that choice.
void ed25519CreateKeypair(std::uint8_t public_key[kEd25519PublicKeySize],
                          std::uint8_t expanded[kEd25519PrivateKeySize],
                          const std::uint8_t seed[kEd25519SeedSize]) noexcept;

/// Sign `length` bytes of `message`. The signature is deterministic — RFC 8032
/// derives its nonce from the private key and the message, with no randomness
/// — so the same inputs always produce the same 64 bytes, which is what makes
/// the golden advert vector in test/meshcore_tx a meaningful check.
///
/// `public_key` must be the one matching `expanded`; it is hashed into the
/// challenge, and passing a mismatched key silently produces a signature that
/// no one can verify.
void ed25519Sign(std::uint8_t signature[kEd25519SignatureSize],
                 const std::uint8_t *message,
                 std::size_t length,
                 const std::uint8_t public_key[kEd25519PublicKeySize],
                 const std::uint8_t expanded[kEd25519PrivateKeySize]) noexcept;

/// Verify a signature. `message` may be nullptr only when `length` is 0.
///
/// This is the cofactorless verification equation, which is what MeshCore,
/// TweetNaCl and libsodium's default all use; it accepts the same signatures a
/// stock node accepts. It deliberately does not enforce the RFC 8032 strict
/// checks (canonical S below the group order, non-small-order points), because
/// rejecting a frame a stock node would have accepted would put us out of step
/// with the network rather than ahead of it.
bool ed25519Verify(const std::uint8_t signature[kEd25519SignatureSize],
                   const std::uint8_t *message,
                   std::size_t length,
                   const std::uint8_t public_key[kEd25519PublicKeySize]) noexcept;

} // namespace crypto
} // namespace lilyshark
