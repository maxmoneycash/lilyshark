#pragma once

// AES-128, and counter mode on top of it.
//
// Self-contained rather than pulled from mbedtls so the same bytes run in the
// host tests and on the ESP32: a cipher that only exists on the device cannot
// be proven correct in CI, and this one is checked against the FIPS-197
// known-answer vectors.
//
// Encryption only. Counter mode needs the forward direction for both
// encrypting and decrypting, so the inverse cipher would be dead weight.

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace crypto {

inline constexpr std::size_t kAesBlockSize = 16;
inline constexpr std::size_t kAes128KeySize = 16;

/// One expanded AES-128 key, reusable across blocks.
class Aes128 {
  public:
    explicit Aes128(const std::uint8_t key[kAes128KeySize]) noexcept;

    /// Transform one 16-byte block. `in` and `out` may be the same buffer.
    void encryptBlock(const std::uint8_t in[kAesBlockSize],
                      std::uint8_t out[kAesBlockSize]) const noexcept;

  private:
    std::uint8_t round_keys_[176]{};
};

/// AES-128-CTR over `length` bytes. Symmetric: the same call decrypts.
///
/// `counter_bytes` is how much of the tail of the IV increments, which is a
/// property of the protocol rather than of AES — Meshtastic's CTR<AES128>
/// sets a 4-byte counter, so only the last four bytes advance and the rest of
/// the nonce stays fixed.
void aesCtrXcrypt(const std::uint8_t key[kAes128KeySize],
                  const std::uint8_t iv[kAesBlockSize],
                  const std::uint8_t *input,
                  std::size_t length,
                  std::uint8_t *output,
                  std::size_t counter_bytes = 4) noexcept;

} // namespace crypto
} // namespace lilyshark
