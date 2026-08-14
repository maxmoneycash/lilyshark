#include "lilyshark/core/decoder_registry.h"

namespace lilyshark {

bool DecoderRegistry::add(const PacketDecoder &decoder) noexcept
{
    for (std::size_t index = 0; index < size_; ++index) {
        if (decoders_[index] == &decoder) {
            return true;
        }
    }

    if (size_ == kCapacity) {
        return false;
    }

    decoders_[size_++] = &decoder;
    return true;
}

DecodeResult DecoderRegistry::decode(const RawFrame &frame, const RadioProfile &profile,
                                     DecodedPacket &output) const noexcept
{
    output = makeUnknownPacket(frame);

    for (std::size_t index = 0; index < size_; ++index) {
        DecodedPacket candidate = makeUnknownPacket(frame);
        const DecodeResult result = decoders_[index]->decode(frame, profile, candidate);
        if (result != DecodeResult::NoMatch) {
            output = candidate;
            return result;
        }
    }

    return DecodeResult::NoMatch;
}

} // namespace lilyshark
