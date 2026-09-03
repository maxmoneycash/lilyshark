#include "lilyshark/core/channel_keys.h"

#include "lilyshark/core/settings_checksum.h"
#include "lilyshark/crypto/sha256.h"

#include <algorithm>
#include <cstring>
#include <iterator>

namespace lilyshark {
namespace {

constexpr std::uint8_t kMagic[] = {'L', 'S', 'C', 'K'};
constexpr std::size_t kHeaderSize = 8U;
constexpr std::size_t kEntrySize = kChannelKeyNameCapacity + kChannelKeySize;
constexpr std::size_t kChecksumOffset =
    kHeaderSize + (kChannelKeyCapacity * kEntrySize);

static_assert(kChecksumOffset + 4U == kChannelKeyStoreRecordSize,
              "channel key record size must match its layout");

/// Domain separation, so a fingerprint can never be confused with any other
/// SHA-256 this firmware computes over the same bytes.
constexpr char kFingerprintDomain[] = "lilyshark/channel-key-fingerprint/v1";

void putU32(std::uint8_t *bytes, std::uint32_t value) noexcept
{
    bytes[0] = static_cast<std::uint8_t>(value);
    bytes[1] = static_cast<std::uint8_t>(value >> 8U);
    bytes[2] = static_cast<std::uint8_t>(value >> 16U);
    bytes[3] = static_cast<std::uint8_t>(value >> 24U);
}

std::uint32_t getU32(const std::uint8_t *bytes) noexcept
{
    return static_cast<std::uint32_t>(bytes[0]) |
           (static_cast<std::uint32_t>(bytes[1]) << 8U) |
           (static_cast<std::uint32_t>(bytes[2]) << 16U) |
           (static_cast<std::uint32_t>(bytes[3]) << 24U);
}

/// Overwrite before releasing. `std::fill` on a buffer that is about to go out
/// of scope can be optimised away; a volatile write cannot.
void zeroSecret(std::uint8_t *bytes, std::size_t size) noexcept
{
    volatile std::uint8_t *target = bytes;
    for (std::size_t index = 0; index < size; ++index) {
        target[index] = 0U;
    }
}

bool sameKey(const std::uint8_t *left, const std::uint8_t *right) noexcept
{
    // Constant time over the fixed key length. There is no attacker-facing
    // oracle here, but a comparison that returns early on the first differing
    // byte is a habit worth not forming in a file full of key material.
    std::uint8_t difference = 0U;
    for (std::size_t index = 0; index < kChannelKeySize; ++index) {
        difference = static_cast<std::uint8_t>(difference | (left[index] ^ right[index]));
    }
    return difference == 0U;
}

/// A stored name field must be a valid name followed by nothing but zeroes —
/// otherwise a record could smuggle bytes past the name into storage.
bool isWellFormedNameField(const char *field) noexcept
{
    std::size_t length = 0;
    while (length < kChannelKeyNameCapacity && field[length] != '\0') {
        ++length;
    }
    if (length == 0U || length >= kChannelKeyNameCapacity) {
        return false;
    }
    for (std::size_t index = length; index < kChannelKeyNameCapacity; ++index) {
        if (field[index] != '\0') {
            return false;
        }
    }
    return isValidChannelKeyName(field);
}

/// Value of one hex digit, or 16 for anything else.
std::uint8_t hexDigitValue(char digit) noexcept
{
    if (digit >= '0' && digit <= '9') return static_cast<std::uint8_t>(digit - '0');
    if (digit >= 'a' && digit <= 'f') return static_cast<std::uint8_t>(digit - 'a' + 10);
    if (digit >= 'A' && digit <= 'F') return static_cast<std::uint8_t>(digit - 'A' + 10);
    return 16U;
}

} // namespace

const char *channelKeyResultLabel(ChannelKeyResult result) noexcept
{
    switch (result) {
    case ChannelKeyResult::Ok:
        return "OK";
    case ChannelKeyResult::InvalidName:
        return "NAME INVALID";
    case ChannelKeyResult::DuplicateName:
        return "NAME IN USE";
    case ChannelKeyResult::InvalidKey:
        return "KEY MUST BE 32 HEX";
    case ChannelKeyResult::DuplicateKey:
        return "KEY ALREADY STORED";
    case ChannelKeyResult::StoreFull:
        return "KEY STORE FULL";
    case ChannelKeyResult::InvalidSlot:
        return "NO SUCH KEY";
    }
    return "UNKNOWN";
}

bool isValidChannelKeyName(const char *name) noexcept
{
    if (name == nullptr || name[0] == '\0' || name[0] == ' ') {
        return false;
    }
    std::size_t length = 0;
    while (name[length] != '\0') {
        const unsigned char byte = static_cast<unsigned char>(name[length]);
        if (byte < 0x20U || byte >= 0x7fU) {
            return false;
        }
        ++length;
        if (length >= kChannelKeyNameCapacity) {
            return false;
        }
    }
    return name[length - 1U] != ' ';
}

bool parseChannelKeyHex(const char *hex, std::uint8_t *key, std::size_t key_size) noexcept
{
    if (hex == nullptr || key == nullptr || key_size != kChannelKeySize) {
        return false;
    }
    for (std::size_t index = 0; index < kChannelKeySize; ++index) {
        const std::uint8_t high = hexDigitValue(hex[index * 2U]);
        if (high > 15U) return false;
        const std::uint8_t low = hexDigitValue(hex[index * 2U + 1U]);
        if (low > 15U) return false;
        key[index] = static_cast<std::uint8_t>((high << 4U) | low);
    }
    // Exactly 32 digits: a longer string is a different key with a tail, not
    // this one.
    return hex[kChannelKeySize * 2U] == '\0';
}

ChannelKeyResult ChannelKeyStore::add(const char *name, const std::uint8_t *key,
                                      std::size_t key_size, std::size_t &slot) noexcept
{
    if (!isValidChannelKeyName(name)) {
        return ChannelKeyResult::InvalidName;
    }
    if (key == nullptr || key_size != kChannelKeySize) {
        return ChannelKeyResult::InvalidKey;
    }
    for (std::size_t index = 0; index < size_; ++index) {
        if (std::strcmp(entries_[index].name, name) == 0) {
            return ChannelKeyResult::DuplicateName;
        }
        if (sameKey(entries_[index].key, key)) {
            return ChannelKeyResult::DuplicateKey;
        }
    }
    if (size_ == kChannelKeyCapacity) {
        return ChannelKeyResult::StoreFull;
    }

    Entry &entry = entries_[size_];
    std::size_t index = 0;
    while (name[index] != '\0') {
        entry.name[index] = name[index];
        ++index;
    }
    for (std::size_t remaining = index; remaining < kChannelKeyNameCapacity; ++remaining) {
        entry.name[remaining] = '\0';
    }
    std::copy(key, key + kChannelKeySize, entry.key);
    slot = size_;
    ++size_;
    ++revision_;
    return ChannelKeyResult::Ok;
}

ChannelKeyResult ChannelKeyStore::rename(std::size_t slot, const char *name) noexcept
{
    if (slot >= size_) {
        return ChannelKeyResult::InvalidSlot;
    }
    if (!isValidChannelKeyName(name)) {
        return ChannelKeyResult::InvalidName;
    }
    for (std::size_t index = 0; index < size_; ++index) {
        if (index != slot && std::strcmp(entries_[index].name, name) == 0) {
            return ChannelKeyResult::DuplicateName;
        }
    }

    Entry &entry = entries_[slot];
    std::size_t index = 0;
    while (name[index] != '\0') {
        entry.name[index] = name[index];
        ++index;
    }
    for (std::size_t remaining = index; remaining < kChannelKeyNameCapacity; ++remaining) {
        entry.name[remaining] = '\0';
    }
    ++revision_;
    return ChannelKeyResult::Ok;
}

ChannelKeyResult ChannelKeyStore::remove(std::size_t slot) noexcept
{
    if (slot >= size_) {
        return ChannelKeyResult::InvalidSlot;
    }
    for (std::size_t index = slot; index + 1U < size_; ++index) {
        entries_[index] = entries_[index + 1U];
    }
    --size_;
    zeroSecret(entries_[size_].key, kChannelKeySize);
    std::fill(std::begin(entries_[size_].name), std::end(entries_[size_].name), '\0');
    ++revision_;
    return ChannelKeyResult::Ok;
}

void ChannelKeyStore::clear() noexcept
{
    for (Entry &entry : entries_) {
        zeroSecret(entry.key, kChannelKeySize);
        std::fill(std::begin(entry.name), std::end(entry.name), '\0');
    }
    size_ = 0U;
    ++revision_;
}

const char *ChannelKeyStore::name(std::size_t slot) const noexcept
{
    return slot < size_ ? entries_[slot].name : nullptr;
}

bool ChannelKeyStore::fingerprint(std::size_t slot, char *out,
                                  std::size_t capacity) const noexcept
{
    if (slot >= size_ || out == nullptr ||
        capacity < kChannelKeyFingerprintDigits + 1U) {
        return false;
    }

    crypto::Sha256 hash;
    hash.update(reinterpret_cast<const std::uint8_t *>(kFingerprintDomain),
                sizeof(kFingerprintDomain));
    hash.update(entries_[slot].key, kChannelKeySize);
    std::uint8_t digest[crypto::kSha256DigestSize]{};
    hash.finish(digest);

    static constexpr char kHex[] = "0123456789ABCDEF";
    for (std::size_t index = 0; index < kChannelKeyFingerprintDigits / 2U; ++index) {
        out[index * 2U] = kHex[(digest[index] >> 4U) & 0x0fU];
        out[index * 2U + 1U] = kHex[digest[index] & 0x0fU];
    }
    out[kChannelKeyFingerprintDigits] = '\0';
    zeroSecret(digest, sizeof(digest));
    return true;
}

const std::uint8_t *ChannelKeyStore::channelKeyBytes(std::size_t index) const noexcept
{
    return index < size_ ? entries_[index].key : nullptr;
}

bool ChannelKeyStore::encode(std::uint8_t *bytes, std::size_t size) const noexcept
{
    if (bytes == nullptr || size != kChannelKeyStoreRecordSize) {
        return false;
    }

    std::uint8_t encoded[kChannelKeyStoreRecordSize]{};
    std::copy(std::begin(kMagic), std::end(kMagic), encoded);
    encoded[4] = kChannelKeyStoreSchemaVersion;
    encoded[5] = static_cast<std::uint8_t>(size_);
    // Bytes 6 and 7 are reserved and stay zero.
    for (std::size_t index = 0; index < size_; ++index) {
        std::uint8_t *entry = encoded + kHeaderSize + (index * kEntrySize);
        std::memcpy(entry, entries_[index].name, kChannelKeyNameCapacity);
        std::memcpy(entry + kChannelKeyNameCapacity, entries_[index].key, kChannelKeySize);
    }
    putU32(&encoded[kChecksumOffset], settingsCrc32(encoded, kChecksumOffset));
    std::copy(std::begin(encoded), std::end(encoded), bytes);
    zeroSecret(encoded, kChecksumOffset);
    return true;
}

ChannelKeyDecodeResult ChannelKeyStore::decode(const std::uint8_t *bytes,
                                               std::size_t size) noexcept
{
    if (bytes == nullptr || size != kChannelKeyStoreRecordSize ||
        !std::equal(std::begin(kMagic), std::end(kMagic), bytes) ||
        bytes[4] != kChannelKeyStoreSchemaVersion ||
        bytes[5] > kChannelKeyCapacity || bytes[6] != 0U || bytes[7] != 0U ||
        getU32(&bytes[kChecksumOffset]) != settingsCrc32(bytes, kChecksumOffset)) {
        return ChannelKeyDecodeResult::Invalid;
    }

    const std::size_t count = bytes[5];
    ChannelKeyStore candidate{};
    for (std::size_t index = 0; index < count; ++index) {
        const std::uint8_t *entry = bytes + kHeaderSize + (index * kEntrySize);
        const char *name = reinterpret_cast<const char *>(entry);
        if (!isWellFormedNameField(name)) {
            candidate.clear();
            return ChannelKeyDecodeResult::Invalid;
        }
        std::size_t slot = 0;
        // add() re-checks uniqueness, so a record that names the same key or
        // the same label twice is refused rather than partially loaded.
        if (candidate.add(name, entry + kChannelKeyNameCapacity, kChannelKeySize, slot) !=
            ChannelKeyResult::Ok) {
            candidate.clear();
            return ChannelKeyDecodeResult::Invalid;
        }
    }
    // Unused entries must be zero-filled; a record carrying bytes past its
    // stated count is not one this encoder wrote.
    for (std::size_t index = count; index < kChannelKeyCapacity; ++index) {
        const std::uint8_t *entry = bytes + kHeaderSize + (index * kEntrySize);
        for (std::size_t byte = 0; byte < kEntrySize; ++byte) {
            if (entry[byte] != 0U) {
                candidate.clear();
                return ChannelKeyDecodeResult::Invalid;
            }
        }
    }

    clear();
    for (std::size_t index = 0; index < candidate.size_; ++index) {
        entries_[index] = candidate.entries_[index];
    }
    size_ = candidate.size_;
    ++revision_;
    candidate.clear();
    return ChannelKeyDecodeResult::LoadedV1;
}

} // namespace lilyshark
