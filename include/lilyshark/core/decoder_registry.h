#pragma once

#include "lilyshark/core/decoder.h"

#include <cstddef>

namespace lilyshark {

class DecoderRegistry
{
  public:
    static constexpr std::size_t kCapacity = 8;

    // The registry stores a pointer and never allocates. The decoder must
    // remain alive for at least as long as the registry.
    bool add(const PacketDecoder &decoder) noexcept;
    DecodeResult decode(const RawFrame &frame, const RadioProfile &profile,
                        DecodedPacket &output) const noexcept;

    std::size_t size() const noexcept { return size_; }
    constexpr std::size_t capacity() const noexcept { return kCapacity; }

  private:
    const PacketDecoder *decoders_[kCapacity]{};
    std::size_t size_ = 0;
};

} // namespace lilyshark
