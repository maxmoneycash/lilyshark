#pragma once

// SHA-256 (FIPS 180-4).
//
// Self-contained rather than pulled from mbedtls, for the same reason as
// aes128.h: the same bytes run in the host tests and on the ESP32, and the
// implementation is checked against the FIPS 180-4 known-answer vectors
// (empty message, "abc", and the two-block message) in test/sha256.
//
// No allocation, no exceptions; state lives in the caller's object.

#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace crypto {

inline constexpr std::size_t kSha256DigestSize = 32;
inline constexpr std::size_t kSha256BlockSize = 64;

/// Incremental SHA-256. update() may be called any number of times with any
/// chunk sizes; finish() writes the digest and seals the object until reset().
class Sha256 {
  public:
    Sha256() noexcept { reset(); }

    /// Return to the initial state, discarding any buffered input.
    void reset() noexcept;

    /// Absorb `length` bytes. `data` may be nullptr only when `length` is 0.
    void update(const std::uint8_t *data, std::size_t length) noexcept;

    /// Pad, finalize, and write the 32-byte digest. After finish() the object
    /// ignores further update()/finish() calls until reset().
    void finish(std::uint8_t digest[kSha256DigestSize]) noexcept;

  private:
    void processBlock(const std::uint8_t block[kSha256BlockSize]) noexcept;

    std::uint32_t state_[8]{};
    std::uint8_t buffer_[kSha256BlockSize]{};
    std::uint64_t total_bytes_ = 0;
    std::size_t buffered_ = 0;
    bool finished_ = false;
};

/// One-shot convenience over the incremental interface.
void sha256(const std::uint8_t *data, std::size_t length,
            std::uint8_t digest[kSha256DigestSize]) noexcept;

} // namespace crypto
} // namespace lilyshark
