#include "lilyshark/crypto/sha256.h"

#include <cstring>

namespace lilyshark {
namespace crypto {
namespace {

// The round constants and initial state are the fractional parts of the cube
// and square roots of the first primes, straight from FIPS 180-4 section 4.2.2
// and 5.3.3.
constexpr std::uint32_t kRoundConstants[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

inline std::uint32_t rotr(std::uint32_t value, unsigned bits) noexcept
{
    return (value >> bits) | (value << (32U - bits));
}

/// One 64-byte block through the compression function.
void compress(std::uint32_t state[8], const std::uint8_t block[64]) noexcept
{
    std::uint32_t w[64];
    for (unsigned t = 0; t < 16; ++t) {
        w[t] = (std::uint32_t(block[4 * t]) << 24) | (std::uint32_t(block[4 * t + 1]) << 16) |
               (std::uint32_t(block[4 * t + 2]) << 8) | std::uint32_t(block[4 * t + 3]);
    }
    for (unsigned t = 16; t < 64; ++t) {
        const std::uint32_t s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >> 3);
        const std::uint32_t s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >> 10);
        w[t] = w[t - 16] + s0 + w[t - 7] + s1;
    }

    std::uint32_t a = state[0];
    std::uint32_t b = state[1];
    std::uint32_t c = state[2];
    std::uint32_t d = state[3];
    std::uint32_t e = state[4];
    std::uint32_t f = state[5];
    std::uint32_t g = state[6];
    std::uint32_t h = state[7];

    for (unsigned t = 0; t < 64; ++t) {
        const std::uint32_t big_s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const std::uint32_t choose = (e & f) ^ (~e & g);
        const std::uint32_t temp1 = h + big_s1 + choose + kRoundConstants[t] + w[t];
        const std::uint32_t big_s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const std::uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        const std::uint32_t temp2 = big_s0 + majority;
        h = g;
        g = f;
        f = e;
        e = d + temp1;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2;
    }

    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
}

} // namespace

void sha256(const std::uint8_t *data, std::size_t length,
            std::uint8_t digest[kSha256DigestSize]) noexcept
{
    std::uint32_t state[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                              0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};

    std::size_t offset = 0;
    while (length - offset >= 64) {
        compress(state, data + offset);
        offset += 64;
    }

    // The tail plus the mandatory 0x80 marker and 64-bit big-endian bit
    // length pad out to one or two final blocks.
    std::uint8_t block[64];
    const std::size_t remaining = length - offset;
    if (remaining != 0) std::memcpy(block, data + offset, remaining);
    block[remaining] = 0x80;
    if (remaining >= 56) {
        std::memset(block + remaining + 1, 0, 64 - remaining - 1);
        compress(state, block);
        std::memset(block, 0, 56);
    } else {
        std::memset(block + remaining + 1, 0, 56 - remaining - 1);
    }
    const std::uint64_t bit_length = std::uint64_t(length) * 8U;
    for (unsigned i = 0; i < 8; ++i) {
        block[56 + i] = static_cast<std::uint8_t>(bit_length >> (56U - 8U * i));
    }
    compress(state, block);

    for (unsigned i = 0; i < 8; ++i) {
        digest[4 * i] = static_cast<std::uint8_t>(state[i] >> 24);
        digest[4 * i + 1] = static_cast<std::uint8_t>(state[i] >> 16);
        digest[4 * i + 2] = static_cast<std::uint8_t>(state[i] >> 8);
        digest[4 * i + 3] = static_cast<std::uint8_t>(state[i]);
    }
}

} // namespace crypto
} // namespace lilyshark
