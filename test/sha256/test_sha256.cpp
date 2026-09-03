#include "lilyshark/crypto/sha256.h"

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

using namespace lilyshark::crypto;

void hexDigest(const std::uint8_t digest[kSha256DigestSize], char out[2 * kSha256DigestSize + 1])
{
    for (std::size_t index = 0; index < kSha256DigestSize; ++index) {
        std::snprintf(out + index * 2, 3, "%02x", digest[index]);
    }
}

void expectDigest(const std::uint8_t *message, std::size_t length, const char *expected_hex)
{
    std::uint8_t digest[kSha256DigestSize]{};
    sha256(message, length, digest);
    char hex[2 * kSha256DigestSize + 1]{};
    hexDigest(digest, hex);
    assert(std::strcmp(hex, expected_hex) == 0);
}

// FIPS 180-4 known-answer vectors (also NIST CAVP SHA256ShortMsg).
void testFipsEmptyMessage()
{
    expectDigest(nullptr, 0,
                 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}

void testFipsAbc()
{
    const char *message = "abc";
    expectDigest(reinterpret_cast<const std::uint8_t *>(message), 3,
                 "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

void testFipsTwoBlockMessage()
{
    const char *message = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expectDigest(reinterpret_cast<const std::uint8_t *>(message), std::strlen(message),
                 "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
}

// FIPS 180-4's long vector: one million repetitions of 'a', streamed through
// update() in fixed chunks — no allocation, and it exercises every buffered /
// unbuffered path in the block pipeline.
void testFipsMillionAs()
{
    Sha256 hasher{};
    std::uint8_t chunk[173];
    std::memset(chunk, 'a', sizeof(chunk));
    std::size_t remaining = 1000000;
    while (remaining != 0) {
        const std::size_t take = remaining < sizeof(chunk) ? remaining : sizeof(chunk);
        hasher.update(chunk, take);
        remaining -= take;
    }
    std::uint8_t digest[kSha256DigestSize]{};
    hasher.finish(digest);
    char hex[2 * kSha256DigestSize + 1]{};
    hexDigest(digest, hex);
    assert(std::strcmp(hex,
                       "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0") == 0);
}

// Incremental hashing must equal one-shot hashing for every split point of a
// message that spans a block boundary, including padding-edge lengths 55, 56,
// 63, 64, and 65.
void testEverySplitMatchesOneShot()
{
    std::uint8_t message[65];
    for (std::size_t index = 0; index < sizeof(message); ++index) {
        message[index] = static_cast<std::uint8_t>(index * 7 + 3);
    }
    for (std::size_t length = 55; length <= sizeof(message); ++length) {
        std::uint8_t reference[kSha256DigestSize]{};
        sha256(message, length, reference);
        for (std::size_t split = 0; split <= length; ++split) {
            Sha256 hasher{};
            hasher.update(message, split);
            hasher.update(message + split, length - split);
            std::uint8_t digest[kSha256DigestSize]{};
            hasher.finish(digest);
            assert(std::memcmp(digest, reference, kSha256DigestSize) == 0);
        }
    }
}

void testResetReusesTheObject()
{
    Sha256 hasher{};
    const char *first = "abc";
    hasher.update(reinterpret_cast<const std::uint8_t *>(first), 3);
    std::uint8_t digest[kSha256DigestSize]{};
    hasher.finish(digest);

    // finish() seals the object: further updates and finishes are ignored.
    const std::uint8_t sealed_probe[1] = {0x42};
    hasher.update(sealed_probe, 1);
    std::uint8_t unchanged[kSha256DigestSize]{};
    std::memcpy(unchanged, digest, sizeof(unchanged));
    hasher.finish(digest);
    assert(std::memcmp(digest, unchanged, kSha256DigestSize) == 0);

    hasher.reset();
    hasher.finish(digest);
    char hex[2 * kSha256DigestSize + 1]{};
    hexDigest(digest, hex);
    assert(std::strcmp(hex,
                       "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") == 0);
}

} // namespace

int main()
{
    testFipsEmptyMessage();
    testFipsAbc();
    testFipsTwoBlockMessage();
    testFipsMillionAs();
    testEverySplitMatchesOneShot();
    testResetReusesTheObject();
    std::puts("sha256 tests passed");
    return 0;
}
