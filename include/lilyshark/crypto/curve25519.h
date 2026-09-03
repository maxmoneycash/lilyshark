#pragma once

// X25519 Diffie-Hellman over Curve25519, as specified by RFC 7748.
//
// This backs Meshtastic public-key direct messages: each node publishes a
// 32-byte Curve25519 public key, and a pair of nodes derives the same shared
// secret from one private key and the other's public key.
//
// The implementation in curve25519.cpp is vendored from TweetNaCl (public
// domain) and checked against the RFC 7748 test vectors; see the provenance
// note there before changing anything.

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace crypto {

inline constexpr std::size_t kX25519KeySize = 32;

/// out = scalar * point on Curve25519. The scalar is clamped internally per
/// RFC 7748, so raw random bytes and stored (already clamped) private keys
/// both work unchanged. Runs the constant-time Montgomery ladder; the output
/// is all zeros when `point` has small order, which callers that care about
/// contributory behavior must check for.
void x25519(std::uint8_t out[kX25519KeySize],
            const std::uint8_t scalar[kX25519KeySize],
            const std::uint8_t point[kX25519KeySize]) noexcept;

/// out = scalar * 9, the curve's base point: derives a public key from a
/// private one.
void x25519Base(std::uint8_t out[kX25519KeySize],
                const std::uint8_t scalar[kX25519KeySize]) noexcept;

/// Turn 32 uniformly random bytes into a canonical X25519 private key by
/// clearing the low three bits and forcing bit 254, exactly as RFC 7748
/// section 5 prescribes. x25519() applies the same masks itself; clamping at
/// generation time just makes the stored key byte-for-byte canonical.
void x25519ClampPrivateKey(std::uint8_t scalar[kX25519KeySize]) noexcept;

} // namespace crypto
} // namespace lilyshark
