#pragma once

#include "lilyshark/core/decoded_packet.h"
#include "lilyshark/core/radio_profile.h"
#include "lilyshark/core/raw_frame.h"

#include <cstdint>

namespace lilyshark {

enum class DecodeResult : std::uint8_t {
    NoMatch = 0,
    Matched,
    Malformed,
};

class PacketDecoder
{
  public:
    virtual ProtocolId protocol() const noexcept = 0;
    virtual DecodeResult decode(const RawFrame &frame, const RadioProfile &profile,
                                DecodedPacket &output) const noexcept = 0;

  protected:
    // Decoders are non-owning registry entries and are never deleted through
    // this interface.
    ~PacketDecoder() = default;
};

} // namespace lilyshark
