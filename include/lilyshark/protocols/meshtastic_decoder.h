#pragma once

#include "lilyshark/core/decoder.h"

#include <cstddef>

namespace lilyshark {

class MeshtasticDecoder final : public PacketDecoder
{
  public:
    static constexpr std::size_t kOuterHeaderLength = 16;

    ProtocolId protocol() const noexcept override { return ProtocolId::Meshtastic; }
    DecodeResult decode(const RawFrame &frame, const RadioProfile &profile,
                        DecodedPacket &output) const noexcept override;
};

} // namespace lilyshark
