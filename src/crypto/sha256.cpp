#include "lilyshark/crypto/sha256.h"

#include <cstring>

namespace lilyshark {
namespace crypto {
namespace {

// First 32 bits of the fractional parts of the cube roots of the first 64
// primes (FIPS 180-4 section 4.2.2).
constexpr std::uint32_t kRoundConstants[64] = {
    0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U,
    0x923f82a4U, 0xab1c5ed5U, 0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
    0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U, 0xe49b69c1U, 0xefbe4786U,
    0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
    0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U,
    0x06ca6351U, 0x14292967U, 0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
    0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U, 0xa2bfe8a1U, 0xa81a664bU,
    0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
    0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU,
    0x5b9cca4fU, 0x682e6ff3U, 0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
    0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
};

constexpr std::uint32_t rotateRight(std::uint32_t value, unsigned bits) noexcept
{
    return (value >> bits) | (value << (32U - bits));
}

std::uint32_t loadBe32(const std::uint8_t *source) noexcept
{
    return (static_cast<std::uint32_t>(source[0]) << 24U) |
           (static_cast<std::uint32_t>(source[1]) << 16U) |
           (static_cast<std::uint32_t>(source[2]) << 8U) |
           static_cast<std::uint32_t>(source[3]);
}

void storeBe32(std::uint8_t *destination, std::uint32_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value >> 24U);
    destination[1] = static_cast<std::uint8_t>(value >> 16U);
    destination[2] = static_cast<std::uint8_t>(value >> 8U);
    destination[3] = static_cast<std::uint8_t>(value);
}

} // namespace

void Sha256::reset() noexcept
{
    // First 32 bits of the fractional parts of the square roots of the first
    // eight primes (FIPS 180-4 section 5.3.3).
    state_[0] = 0x6a09e667U;
    state_[1] = 0xbb67ae85U;
    state_[2] = 0x3c6ef372U;
    state_[3] = 0xa54ff53aU;
    state_[4] = 0x510e527fU;
    state_[5] = 0x9b05688cU;
    state_[6] = 0x1f83d9abU;
    state_[7] = 0x5be0cd19U;
    total_bytes_ = 0;
    buffered_ = 0;
    finished_ = false;
}

void Sha256::processBlock(const std::uint8_t block[kSha256BlockSize]) noexcept
{
    std::uint32_t schedule[64];
    for (std::size_t word = 0; word < 16; ++word) {
        schedule[word] = loadBe32(block + word * 4);
    }
    for (std::size_t word = 16; word < 64; ++word) {
        const std::uint32_t s0 = rotateRight(schedule[word - 15], 7) ^
                                 rotateRight(schedule[word - 15], 18) ^ (schedule[word - 15] >> 3U);
        const std::uint32_t s1 = rotateRight(schedule[word - 2], 17) ^
                                 rotateRight(schedule[word - 2], 19) ^ (schedule[word - 2] >> 10U);
        schedule[word] = schedule[word - 16] + s0 + schedule[word - 7] + s1;
    }

    std::uint32_t a = state_[0];
    std::uint32_t b = state_[1];
    std::uint32_t c = state_[2];
    std::uint32_t d = state_[3];
    std::uint32_t e = state_[4];
    std::uint32_t f = state_[5];
    std::uint32_t g = state_[6];
    std::uint32_t h = state_[7];

    for (std::size_t round = 0; round < 64; ++round) {
        const std::uint32_t big_sigma1 =
            rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const std::uint32_t choose = (e & f) ^ (~e & g);
        const std::uint32_t temp1 = h + big_sigma1 + choose + kRoundConstants[round] +
                                    schedule[round];
        const std::uint32_t big_sigma0 =
            rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const std::uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        const std::uint32_t temp2 = big_sigma0 + majority;

        h = g;
        g = f;
        f = e;
        e = d + temp1;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2;
    }

    state_[0] += a;
    state_[1] += b;
    state_[2] += c;
    state_[3] += d;
    state_[4] += e;
    state_[5] += f;
    state_[6] += g;
    state_[7] += h;
}

void Sha256::update(const std::uint8_t *data, std::size_t length) noexcept
{
    if (finished_ || data == nullptr || length == 0) {
        return;
    }
    total_bytes_ += length;

    if (buffered_ != 0) {
        const std::size_t space = kSha256BlockSize - buffered_;
        const std::size_t take = length < space ? length : space;
        std::memcpy(buffer_ + buffered_, data, take);
        buffered_ += take;
        data += take;
        length -= take;
        if (buffered_ < kSha256BlockSize) {
            return;
        }
        processBlock(buffer_);
        buffered_ = 0;
    }

    while (length >= kSha256BlockSize) {
        processBlock(data);
        data += kSha256BlockSize;
        length -= kSha256BlockSize;
    }

    if (length != 0) {
        std::memcpy(buffer_, data, length);
        buffered_ = length;
    }
}

void Sha256::finish(std::uint8_t digest[kSha256DigestSize]) noexcept
{
    if (finished_) {
        return;
    }

    const std::uint64_t total_bits = total_bytes_ * 8U;
    buffer_[buffered_++] = 0x80U;
    if (buffered_ > kSha256BlockSize - 8) {
        std::memset(buffer_ + buffered_, 0, kSha256BlockSize - buffered_);
        processBlock(buffer_);
        buffered_ = 0;
    }
    std::memset(buffer_ + buffered_, 0, kSha256BlockSize - 8 - buffered_);
    storeBe32(buffer_ + kSha256BlockSize - 8, static_cast<std::uint32_t>(total_bits >> 32U));
    storeBe32(buffer_ + kSha256BlockSize - 4, static_cast<std::uint32_t>(total_bits));
    processBlock(buffer_);

    for (std::size_t word = 0; word < 8; ++word) {
        storeBe32(digest + word * 4, state_[word]);
    }
    finished_ = true;
}

void sha256(const std::uint8_t *data, std::size_t length,
            std::uint8_t digest[kSha256DigestSize]) noexcept
{
    Sha256 hasher{};
    hasher.update(data, length);
    hasher.finish(digest);
}

} // namespace crypto
} // namespace lilyshark
