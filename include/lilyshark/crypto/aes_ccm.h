#pragma once

// AES-CCM authenticated encryption (RFC 3610 / NIST SP 800-38C) over the
// in-tree AES-128 and AES-256 block ciphers.
//
// The length field width L is fixed at 2, so nonces are always 13 bytes and
// messages top out at 65535 bytes. That matches both RFC 3610's own test
// vectors and the hostap-derived aes_ccm_ae/aes_ccm_ad in Meshtastic
// firmware, whose public-key direct messages this exists to speak: AES-256,
// 8-byte tag, no associated data. Checked against the RFC 3610 packet
// vectors and a NIST CAVP AES-256 vector.

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace crypto {

inline constexpr std::size_t kCcmNonceSize = 13;

/// Encrypt `plain_length` bytes and authenticate them together with the
/// associated data. `cipher_out` receives exactly `plain_length` bytes and
/// `tag_out` exactly `tag_length`. Returns false without writing anything
/// when a parameter is out of range: the key must be 16 or 32 bytes, the tag
/// an even length from 4 to 16, the message at most 65535 bytes, and the
/// associated data short enough for CCM's two-byte length encoding (under
/// 0xff00 bytes). `cipher_out` may alias `plain`.
bool aesCcmEncrypt(const std::uint8_t *key, std::size_t key_length,
                   const std::uint8_t nonce[kCcmNonceSize],
                   const std::uint8_t *plain, std::size_t plain_length,
                   const std::uint8_t *aad, std::size_t aad_length,
                   std::uint8_t *cipher_out,
                   std::uint8_t *tag_out, std::size_t tag_length) noexcept;

/// Decrypt and verify. Returns true only when the tag authenticates; on any
/// failure `plain_out` is zeroed rather than left holding the unverified
/// plaintext the check had to compute. `plain_out` may alias `cipher`, in
/// which case a failure zeroes the ciphertext buffer too — callers keeping
/// the ciphertext must not alias.
bool aesCcmDecrypt(const std::uint8_t *key, std::size_t key_length,
                   const std::uint8_t nonce[kCcmNonceSize],
                   const std::uint8_t *cipher, std::size_t cipher_length,
                   const std::uint8_t *aad, std::size_t aad_length,
                   const std::uint8_t *tag, std::size_t tag_length,
                   std::uint8_t *plain_out) noexcept;

} // namespace crypto
} // namespace lilyshark
