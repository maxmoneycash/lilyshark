#include "lilyshark/crypto/aes128.h"

#include <cstring>

namespace lilyshark {
namespace crypto {
namespace {

constexpr std::uint8_t kSbox[256] = {
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
};

constexpr std::uint8_t kRcon[11] = {0x00, 0x01, 0x02, 0x04, 0x08, 0x10,
                                    0x20, 0x40, 0x80, 0x1b, 0x36};

/// Multiply by x in GF(2^8), reducing by the AES polynomial.
std::uint8_t xtime(std::uint8_t value) noexcept
{
    return static_cast<std::uint8_t>((value << 1) ^ (((value >> 7) & 1U) * 0x1bU));
}

/// Russian-peasant multiply in GF(2^8); the MixColumns coefficients are all
/// small, so this stays cheap without a lookup table.
std::uint8_t gmul(std::uint8_t a, std::uint8_t b) noexcept
{
    std::uint8_t result = 0;
    while (b != 0) {
        if ((b & 1U) != 0) result = static_cast<std::uint8_t>(result ^ a);
        a = xtime(a);
        b = static_cast<std::uint8_t>(b >> 1);
    }
    return result;
}

} // namespace

Aes128::Aes128(const std::uint8_t key[kAes128KeySize]) noexcept
{
    std::memcpy(round_keys_, key, kAes128KeySize);
    // Eleven round keys of four words each; every word but the first of a
    // group is the previous word XOR the word four back.
    for (unsigned word = 4; word < 44; ++word) {
        std::uint8_t temp[4];
        std::memcpy(temp, round_keys_ + (word - 1) * 4, 4);
        if (word % 4 == 0) {
            const std::uint8_t first = temp[0];
            temp[0] = static_cast<std::uint8_t>(kSbox[temp[1]] ^ kRcon[word / 4]);
            temp[1] = kSbox[temp[2]];
            temp[2] = kSbox[temp[3]];
            temp[3] = kSbox[first];
        }
        for (unsigned byte = 0; byte < 4; ++byte) {
            round_keys_[word * 4 + byte] =
                static_cast<std::uint8_t>(round_keys_[(word - 4) * 4 + byte] ^ temp[byte]);
        }
    }
}

void Aes128::encryptBlock(const std::uint8_t in[kAesBlockSize],
                          std::uint8_t out[kAesBlockSize]) const noexcept
{
    // The state is column-major: byte r + 4c is row r of column c.
    std::uint8_t state[kAesBlockSize];
    for (std::size_t index = 0; index < kAesBlockSize; ++index) {
        state[index] = static_cast<std::uint8_t>(in[index] ^ round_keys_[index]);
    }

    for (unsigned round = 1; round <= 10; ++round) {
        for (std::size_t index = 0; index < kAesBlockSize; ++index) {
            state[index] = kSbox[state[index]];
        }

        std::uint8_t shifted[kAesBlockSize];
        for (unsigned column = 0; column < 4; ++column) {
            for (unsigned row = 0; row < 4; ++row) {
                shifted[row + 4U * column] = state[row + 4U * ((column + row) % 4U)];
            }
        }
        std::memcpy(state, shifted, kAesBlockSize);

        // The final round omits MixColumns, which is what makes the cipher
        // invertible with the same key schedule read backwards.
        if (round != 10) {
            for (unsigned column = 0; column < 4; ++column) {
                std::uint8_t *col = state + 4U * column;
                const std::uint8_t a0 = col[0];
                const std::uint8_t a1 = col[1];
                const std::uint8_t a2 = col[2];
                const std::uint8_t a3 = col[3];
                col[0] = static_cast<std::uint8_t>(gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3);
                col[1] = static_cast<std::uint8_t>(a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3);
                col[2] = static_cast<std::uint8_t>(a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3));
                col[3] = static_cast<std::uint8_t>(gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2));
            }
        }

        for (std::size_t index = 0; index < kAesBlockSize; ++index) {
            state[index] = static_cast<std::uint8_t>(state[index] ^
                                                     round_keys_[round * kAesBlockSize + index]);
        }
    }

    std::memcpy(out, state, kAesBlockSize);
}

void aesCtrXcrypt(const std::uint8_t key[kAes128KeySize],
                  const std::uint8_t iv[kAesBlockSize],
                  const std::uint8_t *input,
                  std::size_t length,
                  std::uint8_t *output,
                  std::size_t counter_bytes) noexcept
{
    if (input == nullptr || output == nullptr) return;
    if (counter_bytes == 0 || counter_bytes > kAesBlockSize) counter_bytes = 4;

    const Aes128 aes(key);
    std::uint8_t counter[kAesBlockSize];
    std::memcpy(counter, iv, kAesBlockSize);

    std::uint8_t keystream[kAesBlockSize];
    for (std::size_t offset = 0; offset < length; offset += kAesBlockSize) {
        aes.encryptBlock(counter, keystream);
        const std::size_t remaining = length - offset;
        const std::size_t chunk = remaining < kAesBlockSize ? remaining : kAesBlockSize;
        for (std::size_t index = 0; index < chunk; ++index) {
            output[offset + index] = static_cast<std::uint8_t>(input[offset + index] ^
                                                               keystream[index]);
        }
        // Only the tail advances, big-endian, so the rest of the nonce holds.
        for (std::size_t step = 0; step < counter_bytes; ++step) {
            const std::size_t index = kAesBlockSize - 1 - step;
            if (++counter[index] != 0) break;
        }
    }
}

} // namespace crypto
} // namespace lilyshark
