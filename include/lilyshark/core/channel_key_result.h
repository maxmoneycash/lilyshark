#pragma once

#include <cstdint>

namespace lilyshark {

/// Outcome of a channel-key store mutation. Every refusal names its reason so
/// the screen can say what went wrong instead of failing silently.
enum class ChannelKeyResult : std::uint8_t {
    Ok = 0,
    /// The name is empty, too long, not printable ASCII, or padded with
    /// spaces.
    InvalidName,
    /// Another stored key already uses that name.
    DuplicateName,
    /// The key is not exactly `kChannelKeySize` bytes, or the pointer is null.
    InvalidKey,
    /// The same key material is already stored under another name.
    DuplicateKey,
    /// The store already holds `kChannelKeyCapacity` keys.
    StoreFull,
    /// The slot index is past the end of the stored list.
    InvalidSlot,
};

enum class ChannelKeyDecodeResult : std::uint8_t {
    Invalid = 0,
    LoadedV1,
};

/// Short label for a result, for the UI and the runtime event log. Never
/// includes key material.
[[nodiscard]] const char *channelKeyResultLabel(ChannelKeyResult result) noexcept;

} // namespace lilyshark
