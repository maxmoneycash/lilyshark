#include "lilyshark/crypto/aes_ccm.h"

#include "lilyshark/crypto/aes128.h"

#include <cstring>

namespace lilyshark {
namespace crypto {
namespace {

/// The two-byte length encoding fixed by L = 2. Associated data one block
/// short of 0xff00 would collide with CCM's reserved longer encodings, so
/// everything from 0xff00 up is refused.
constexpr std::size_t kMaxMessageLength = 0xffff;
constexpr std::size_t kMaxAadLength = 0xfeff;

bool parametersValid(std::size_t key_length, std::size_t message_length,
                     std::size_t aad_length, std::size_t tag_length) noexcept
{
    if (key_length != kAes128KeySize && key_length != kAes256KeySize) return false;
    if (tag_length < 4 || tag_length > 16 || tag_length % 2 != 0) return false;
    if (message_length > kMaxMessageLength) return false;
    if (aad_length > kMaxAadLength) return false;
    return true;
}

/// Absorb up to one block of data into the running CBC-MAC, zero-padding the
/// tail as RFC 3610 requires.
template <typename Cipher>
void macAbsorb(const Cipher &aes, std::uint8_t x[kAesBlockSize],
               const std::uint8_t *data, std::size_t length) noexcept
{
    for (std::size_t i = 0; i < length; ++i) {
        x[i] = static_cast<std::uint8_t>(x[i] ^ data[i]);
    }
    aes.encryptBlock(x, x);
}

/// CBC-MAC over B_0, the length-prefixed associated data, and the message,
/// leaving the untruncated tag T in x.
template <typename Cipher>
void computeMac(const Cipher &aes, const std::uint8_t nonce[kCcmNonceSize],
                const std::uint8_t *aad, std::size_t aad_length,
                const std::uint8_t *message, std::size_t message_length,
                std::size_t tag_length, std::uint8_t x[kAesBlockSize]) noexcept
{
    // B_0 = flags || nonce || l(m); flags pack the Adata bit, the encoded
    // tag length M' and the encoded length-field width L' = L - 1 = 1.
    std::uint8_t b0[kAesBlockSize];
    b0[0] = static_cast<std::uint8_t>((aad_length != 0 ? 0x40U : 0x00U) |
                                      (((tag_length - 2U) / 2U) << 3U) | 0x01U);
    std::memcpy(b0 + 1, nonce, kCcmNonceSize);
    b0[14] = static_cast<std::uint8_t>(message_length >> 8);
    b0[15] = static_cast<std::uint8_t>(message_length & 0xffU);
    aes.encryptBlock(b0, x);

    if (aad_length != 0) {
        // The first associated-data block leads with the two-byte length.
        std::uint8_t first[kAesBlockSize]{};
        first[0] = static_cast<std::uint8_t>(aad_length >> 8);
        first[1] = static_cast<std::uint8_t>(aad_length & 0xffU);
        const std::size_t head = aad_length < kAesBlockSize - 2 ? aad_length
                                                                : kAesBlockSize - 2;
        std::memcpy(first + 2, aad, head);
        macAbsorb(aes, x, first, kAesBlockSize);
        std::size_t offset = head;
        while (offset < aad_length) {
            const std::size_t chunk = aad_length - offset < kAesBlockSize
                                          ? aad_length - offset
                                          : kAesBlockSize;
            macAbsorb(aes, x, aad + offset, chunk);
            offset += chunk;
        }
    }

    std::size_t offset = 0;
    while (offset < message_length) {
        const std::size_t chunk = message_length - offset < kAesBlockSize
                                      ? message_length - offset
                                      : kAesBlockSize;
        macAbsorb(aes, x, message + offset, chunk);
        offset += chunk;
    }
}

/// Write keystream block A_i's encryption into `stream`.
template <typename Cipher>
void keystreamBlock(const Cipher &aes, const std::uint8_t nonce[kCcmNonceSize],
                    std::size_t counter, std::uint8_t stream[kAesBlockSize]) noexcept
{
    std::uint8_t a[kAesBlockSize];
    a[0] = 0x01; // Flags carry only L' = L - 1.
    std::memcpy(a + 1, nonce, kCcmNonceSize);
    a[14] = static_cast<std::uint8_t>(counter >> 8);
    a[15] = static_cast<std::uint8_t>(counter & 0xffU);
    aes.encryptBlock(a, stream);
}

/// XOR the message with keystream blocks A_1..A_n. Symmetric, so it both
/// encrypts and decrypts; in-place operation is fine.
template <typename Cipher>
void ctrXcrypt(const Cipher &aes, const std::uint8_t nonce[kCcmNonceSize],
               const std::uint8_t *input, std::size_t length,
               std::uint8_t *output) noexcept
{
    std::uint8_t stream[kAesBlockSize];
    for (std::size_t offset = 0; offset < length; offset += kAesBlockSize) {
        keystreamBlock(aes, nonce, offset / kAesBlockSize + 1, stream);
        const std::size_t chunk = length - offset < kAesBlockSize ? length - offset
                                                                  : kAesBlockSize;
        for (std::size_t i = 0; i < chunk; ++i) {
            output[offset + i] = static_cast<std::uint8_t>(input[offset + i] ^ stream[i]);
        }
    }
}

template <typename Cipher>
void encryptImpl(const Cipher &aes, const std::uint8_t nonce[kCcmNonceSize],
                 const std::uint8_t *plain, std::size_t plain_length,
                 const std::uint8_t *aad, std::size_t aad_length,
                 std::uint8_t *cipher_out, std::uint8_t *tag_out,
                 std::size_t tag_length) noexcept
{
    std::uint8_t x[kAesBlockSize];
    computeMac(aes, nonce, aad, aad_length, plain, plain_length, tag_length, x);
    // The MAC must read the plaintext before CTR may overwrite it in place.
    ctrXcrypt(aes, nonce, plain, plain_length, cipher_out);
    std::uint8_t s0[kAesBlockSize];
    keystreamBlock(aes, nonce, 0, s0);
    for (std::size_t i = 0; i < tag_length; ++i) {
        tag_out[i] = static_cast<std::uint8_t>(x[i] ^ s0[i]);
    }
}

template <typename Cipher>
bool decryptImpl(const Cipher &aes, const std::uint8_t nonce[kCcmNonceSize],
                 const std::uint8_t *cipher, std::size_t cipher_length,
                 const std::uint8_t *aad, std::size_t aad_length,
                 const std::uint8_t *tag, std::size_t tag_length,
                 std::uint8_t *plain_out) noexcept
{
    ctrXcrypt(aes, nonce, cipher, cipher_length, plain_out);
    std::uint8_t x[kAesBlockSize];
    computeMac(aes, nonce, aad, aad_length, plain_out, cipher_length, tag_length, x);
    std::uint8_t s0[kAesBlockSize];
    keystreamBlock(aes, nonce, 0, s0);
    // Compare in constant time so a forger learns nothing from timing about
    // how many tag bytes matched.
    std::uint8_t difference = 0;
    for (std::size_t i = 0; i < tag_length; ++i) {
        difference = static_cast<std::uint8_t>(difference ^
                                               (tag[i] ^ (x[i] ^ s0[i])));
    }
    if (difference != 0) {
        if (cipher_length != 0) std::memset(plain_out, 0, cipher_length);
        return false;
    }
    return true;
}

} // namespace

bool aesCcmEncrypt(const std::uint8_t *key, std::size_t key_length,
                   const std::uint8_t nonce[kCcmNonceSize],
                   const std::uint8_t *plain, std::size_t plain_length,
                   const std::uint8_t *aad, std::size_t aad_length,
                   std::uint8_t *cipher_out,
                   std::uint8_t *tag_out, std::size_t tag_length) noexcept
{
    if (key == nullptr || nonce == nullptr || tag_out == nullptr) return false;
    if ((plain == nullptr || cipher_out == nullptr) && plain_length != 0) return false;
    if (aad == nullptr && aad_length != 0) return false;
    if (!parametersValid(key_length, plain_length, aad_length, tag_length)) return false;

    if (key_length == kAes128KeySize) {
        const Aes128 aes(key);
        encryptImpl(aes, nonce, plain, plain_length, aad, aad_length, cipher_out,
                    tag_out, tag_length);
    } else {
        const Aes256 aes(key);
        encryptImpl(aes, nonce, plain, plain_length, aad, aad_length, cipher_out,
                    tag_out, tag_length);
    }
    return true;
}

bool aesCcmDecrypt(const std::uint8_t *key, std::size_t key_length,
                   const std::uint8_t nonce[kCcmNonceSize],
                   const std::uint8_t *cipher, std::size_t cipher_length,
                   const std::uint8_t *aad, std::size_t aad_length,
                   const std::uint8_t *tag, std::size_t tag_length,
                   std::uint8_t *plain_out) noexcept
{
    if (key == nullptr || nonce == nullptr || tag == nullptr) return false;
    if ((cipher == nullptr || plain_out == nullptr) && cipher_length != 0) return false;
    if (aad == nullptr && aad_length != 0) return false;
    if (!parametersValid(key_length, cipher_length, aad_length, tag_length)) return false;

    if (key_length == kAes128KeySize) {
        const Aes128 aes(key);
        return decryptImpl(aes, nonce, cipher, cipher_length, aad, aad_length, tag,
                           tag_length, plain_out);
    }
    const Aes256 aes(key);
    return decryptImpl(aes, nonce, cipher, cipher_length, aad, aad_length, tag,
                       tag_length, plain_out);
}

} // namespace crypto
} // namespace lilyshark
