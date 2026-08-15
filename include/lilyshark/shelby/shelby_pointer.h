#pragma once

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Shelby off-grid pointer.
///
/// A LoRa node has no IP path, so it cannot speak to Shelby directly. What it
/// can do is carry a *pointer* to a Shelby blob: the mesh moves ~200 usable
/// bytes per frame, which is far too small for media but far larger than a blob
/// reference. A node with connectivity (a gateway, or the operator's phone when
/// it next has signal) resolves the pointer and moves the bytes.
///
/// The pointer therefore rides *inside* an existing protocol's payload —
/// Meshtastic, MeshCore, or Reticulum — rather than replacing any of them. It is
/// a payload convention, not a new link layer, which is why the same encoding
/// works on all three and why an unmodified node forwards it untouched.
///
/// Wire layout — 82 bytes, little-endian:
///
///   0..3    magic "SHLB"
///   4       version (1)
///   5       flags
///   6..37   blob commitment (32 bytes)
///   38..69  owner account address (32 bytes)
///   70..73  blob size in bytes
///   74..77  expiry, unix seconds
///   78..79  chunk index    (0 when the blob is not split across frames)
///   80..81  chunk count    (1 when the blob is not split across frames)
///
/// 82 bytes leaves comfortable headroom inside a Meshtastic payload (~237 max,
/// ~200 practical) for the enclosing protocol's own header.
struct ShelbyPointer {
    static constexpr std::size_t kEncodedSize = 82;
    static constexpr std::size_t kCommitmentSize = 32;
    static constexpr std::size_t kOwnerSize = 32;
    static constexpr std::uint8_t kVersion = 1;

    /// Set when the referenced blob is encrypted with the channel key. The
    /// firmware never holds that key; it only reports the claim.
    static constexpr std::uint8_t kFlagEncrypted = 1U << 0;
    /// Set when the blob is one part of a multi-frame set.
    static constexpr std::uint8_t kFlagChunked = 1U << 1;
    /// Set when the pointer describes a Lilyshark capture (.lscap) rather than
    /// user content.
    static constexpr std::uint8_t kFlagCapture = 1U << 2;

    std::uint8_t version = kVersion;
    std::uint8_t flags = 0;
    std::uint8_t commitment[kCommitmentSize]{};
    std::uint8_t owner[kOwnerSize]{};
    std::uint32_t size_bytes = 0;
    std::uint32_t expires_at_unix = 0;
    std::uint16_t chunk_index = 0;
    std::uint16_t chunk_count = 1;

    bool isEncrypted() const noexcept { return (flags & kFlagEncrypted) != 0; }
    bool isChunked() const noexcept { return (flags & kFlagChunked) != 0; }
    bool isCapture() const noexcept { return (flags & kFlagCapture) != 0; }
};

enum class ShelbyPointerResult : std::uint8_t {
    Ok = 0,
    /// Buffer too small to hold or contain a pointer.
    BufferTooSmall,
    /// Leading bytes are not the Shelby pointer magic.
    NoMagic,
    /// Magic matched but the version is one this build cannot read.
    UnsupportedVersion,
    /// Structurally impossible field combination.
    Malformed,
};

/// Write `pointer` into `destination`. Returns BufferTooSmall when
/// `capacity` < ShelbyPointer::kEncodedSize.
ShelbyPointerResult encodeShelbyPointer(const ShelbyPointer &pointer, std::uint8_t *destination,
                                        std::size_t capacity) noexcept;

/// Read a pointer from `source`. Only reports Ok when the magic, version, and
/// chunk fields are all self-consistent, so a decoder can use this as a
/// detector on arbitrary payload bytes without extra guards.
ShelbyPointerResult decodeShelbyPointer(const std::uint8_t *source, std::size_t length,
                                        ShelbyPointer &output) noexcept;

/// True when `source` begins with a Shelby pointer this build can read. Cheap
/// enough to run over every captured payload.
bool looksLikeShelbyPointer(const std::uint8_t *source, std::size_t length) noexcept;

/// Locate a pointer anywhere inside a payload, for protocols that prefix their
/// own header before the application bytes. Returns the byte offset, or
/// `length` when no pointer is present.
std::size_t findShelbyPointer(const std::uint8_t *source, std::size_t length) noexcept;

} // namespace lilyshark
