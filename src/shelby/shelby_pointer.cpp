#include "lilyshark/shelby/shelby_pointer.h"

#include <cstring>

namespace lilyshark {
namespace {

constexpr std::uint8_t kMagic[4] = {'S', 'H', 'L', 'B'};

constexpr std::size_t kOffsetMagic = 0;
constexpr std::size_t kOffsetVersion = 4;
constexpr std::size_t kOffsetFlags = 5;
constexpr std::size_t kOffsetCommitment = 6;
constexpr std::size_t kOffsetOwner = 38;
constexpr std::size_t kOffsetSize = 70;
constexpr std::size_t kOffsetExpiry = 74;
constexpr std::size_t kOffsetChunkIndex = 78;
constexpr std::size_t kOffsetChunkCount = 80;

static_assert(kOffsetChunkCount + 2 == ShelbyPointer::kEncodedSize,
              "wire layout must fill exactly kEncodedSize bytes");

void putLe16(std::uint8_t *destination, std::uint16_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8U);
}

void putLe32(std::uint8_t *destination, std::uint32_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8U);
    destination[2] = static_cast<std::uint8_t>(value >> 16U);
    destination[3] = static_cast<std::uint8_t>(value >> 24U);
}

std::uint16_t readLe16(const std::uint8_t *source) noexcept
{
    return static_cast<std::uint16_t>(static_cast<std::uint16_t>(source[0]) |
                                      (static_cast<std::uint16_t>(source[1]) << 8U));
}

std::uint32_t readLe32(const std::uint8_t *source) noexcept
{
    return static_cast<std::uint32_t>(source[0]) |
           (static_cast<std::uint32_t>(source[1]) << 8U) |
           (static_cast<std::uint32_t>(source[2]) << 16U) |
           (static_cast<std::uint32_t>(source[3]) << 24U);
}

bool hasMagic(const std::uint8_t *source) noexcept
{
    return std::memcmp(source, kMagic, sizeof(kMagic)) == 0;
}

} // namespace

ShelbyPointerResult encodeShelbyPointer(const ShelbyPointer &pointer, std::uint8_t *destination,
                                        std::size_t capacity) noexcept
{
    if (destination == nullptr || capacity < ShelbyPointer::kEncodedSize) {
        return ShelbyPointerResult::BufferTooSmall;
    }
    // A zero chunk_count would make the pointer undecodable by its own rules.
    if (pointer.chunk_count == 0 || pointer.chunk_index >= pointer.chunk_count) {
        return ShelbyPointerResult::Malformed;
    }

    std::memcpy(destination + kOffsetMagic, kMagic, sizeof(kMagic));
    destination[kOffsetVersion] = ShelbyPointer::kVersion;
    destination[kOffsetFlags] = pointer.flags;
    std::memcpy(destination + kOffsetCommitment, pointer.commitment,
                ShelbyPointer::kCommitmentSize);
    std::memcpy(destination + kOffsetOwner, pointer.owner, ShelbyPointer::kOwnerSize);
    putLe32(destination + kOffsetSize, pointer.size_bytes);
    putLe32(destination + kOffsetExpiry, pointer.expires_at_unix);
    putLe16(destination + kOffsetChunkIndex, pointer.chunk_index);
    putLe16(destination + kOffsetChunkCount, pointer.chunk_count);
    return ShelbyPointerResult::Ok;
}

ShelbyPointerResult decodeShelbyPointer(const std::uint8_t *source, std::size_t length,
                                        ShelbyPointer &output) noexcept
{
    if (source == nullptr || length < ShelbyPointer::kEncodedSize) {
        return ShelbyPointerResult::BufferTooSmall;
    }
    if (!hasMagic(source)) {
        return ShelbyPointerResult::NoMagic;
    }
    const std::uint8_t version = source[kOffsetVersion];
    if (version != ShelbyPointer::kVersion) {
        return ShelbyPointerResult::UnsupportedVersion;
    }

    ShelbyPointer parsed{};
    parsed.version = version;
    parsed.flags = source[kOffsetFlags];
    std::memcpy(parsed.commitment, source + kOffsetCommitment, ShelbyPointer::kCommitmentSize);
    std::memcpy(parsed.owner, source + kOffsetOwner, ShelbyPointer::kOwnerSize);
    parsed.size_bytes = readLe32(source + kOffsetSize);
    parsed.expires_at_unix = readLe32(source + kOffsetExpiry);
    parsed.chunk_index = readLe16(source + kOffsetChunkIndex);
    parsed.chunk_count = readLe16(source + kOffsetChunkCount);

    if (parsed.chunk_count == 0 || parsed.chunk_index >= parsed.chunk_count) {
        return ShelbyPointerResult::Malformed;
    }
    // kFlagChunked and chunk_count must agree, otherwise a receiver cannot tell
    // whether it is holding a complete blob.
    const bool chunked_flag = (parsed.flags & ShelbyPointer::kFlagChunked) != 0;
    if (chunked_flag != (parsed.chunk_count > 1)) {
        return ShelbyPointerResult::Malformed;
    }

    output = parsed;
    return ShelbyPointerResult::Ok;
}

bool looksLikeShelbyPointer(const std::uint8_t *source, std::size_t length) noexcept
{
    ShelbyPointer discard{};
    return decodeShelbyPointer(source, length, discard) == ShelbyPointerResult::Ok;
}

std::size_t findShelbyPointer(const std::uint8_t *source, std::size_t length) noexcept
{
    if (source == nullptr || length < ShelbyPointer::kEncodedSize) {
        return length;
    }
    const std::size_t last = length - ShelbyPointer::kEncodedSize;
    for (std::size_t offset = 0; offset <= last; ++offset) {
        if (hasMagic(source + offset) &&
            looksLikeShelbyPointer(source + offset, length - offset)) {
            return offset;
        }
    }
    return length;
}

} // namespace lilyshark
