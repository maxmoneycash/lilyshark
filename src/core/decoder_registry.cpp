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
    DecodeResult primary_result = DecodeResult::NoMatch;
    bool has_primary_result = false;

    for (std::size_t index = 0; index < size_; ++index) {
        DecodedPacket candidate = makeUnknownPacket(frame);
        const DecodeResult result = decoders_[index]->decode(frame, profile, candidate);
        if (result == DecodeResult::NoMatch) {
            continue;
        }

        if (!has_primary_result) {
            output = candidate;
            primary_result = result;
            has_primary_result = true;
            continue;
        }

        // A Shelby pointer is application metadata carried by an enclosing
        // protocol. Only merge its dedicated marker from later successful
        // decoders; the first decoder still owns every primary packet field
        // and the registry's DecodeResult.
        if (result == DecodeResult::Matched &&
            candidate.hasAttribute(AttributeShelbyPointer)) {
            output.attributes |= AttributeShelbyPointer;
        }
    }

    return primary_result;
}

} // namespace lilyshark
