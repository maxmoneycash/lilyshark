#pragma once

// SHA-256 as specified by FIPS 180-4.
//
// Present because Meshtastic public-key direct messages derive their
// AES-256-CCM session key by hashing the raw X25519 shared secret, so the
// digest bytes must match every other implementation exactly. Checked
// against the NIST short-message known-answer vectors.

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace crypto {

inline constexpr std::size_t kSha256DigestSize = 32;

/// One-shot digest of `length` bytes. `data` may be null when `length` is
/// zero. `digest` may alias `data`; the input is fully consumed before the
/// output is written.
void sha256(const std::uint8_t *data, std::size_t length,
            std::uint8_t digest[kSha256DigestSize]) noexcept;

} // namespace crypto
} // namespace lilyshark
