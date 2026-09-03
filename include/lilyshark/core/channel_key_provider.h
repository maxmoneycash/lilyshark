#pragma once

// The one seam through which stored key material reaches a decoder.
//
// The payload reader takes a `const ChannelKeyProvider *`, never a key store
// and never a buffer of keys, so the storage layer and the decoding layer
// share exactly one narrow interface: an ordered count and a pointer to
// sixteen bytes. Nothing here can name, list, print, or serialise a key, and a
// null provider is the normal keyless case rather than an error.

#include <cstddef>
#include <cstdint>

namespace lilyshark {

class ChannelKeyProvider
{
  public:
    /// Number of candidate keys, in the order they should be tried.
    [[nodiscard]] virtual std::size_t channelKeyCount() const noexcept = 0;

    /// The key at `index`: exactly 16 bytes, or nullptr past the end.
    ///
    /// This is the only path key material takes out of storage. Anything that
    /// writes a file, draws a pixel, or prints a line must not call it.
    [[nodiscard]] virtual const std::uint8_t *channelKeyBytes(
        std::size_t index) const noexcept = 0;

  protected:
    // Providers are non-owning references and are never deleted through this
    // interface, matching PacketDecoder.
    ~ChannelKeyProvider() = default;
};

} // namespace lilyshark
