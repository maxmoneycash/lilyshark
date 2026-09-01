#pragma once

#include "lilyshark/core/channel_key_provider.h"
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

    /// Non-owning. The provider must outlive the decoder. Null — the default —
    /// is the keyless behaviour: the published default key and nothing else.
    void setChannelKeys(const ChannelKeyProvider *keys) noexcept { channel_keys_ = keys; }
    [[nodiscard]] const ChannelKeyProvider *channelKeys() const noexcept
    {
        return channel_keys_;
    }

  private:
    const ChannelKeyProvider *channel_keys_ = nullptr;
};

} // namespace lilyshark
