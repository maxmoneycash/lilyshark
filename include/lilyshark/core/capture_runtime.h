#pragma once

#include "lilyshark/core/decoder_registry.h"
#include "lilyshark/core/frame_store.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

struct IngestResult {
    DecodeResult decode_result = DecodeResult::NoMatch;
    std::uint64_t sequence = 0;
};

template <std::size_t FrameCapacity> class CaptureRuntime
{
  public:
    bool addDecoder(const PacketDecoder &decoder) noexcept { return decoders_.add(decoder); }

    IngestResult ingest(const RawFrame &frame, const RadioProfile &profile) noexcept
    {
        DecodedPacket decoded{};
        const DecodeResult result = decoders_.decode(frame, profile, decoded);
        return {result, frames_.push(frame, decoded)};
    }

    FrameStore<FrameCapacity> &frames() noexcept { return frames_; }
    const FrameStore<FrameCapacity> &frames() const noexcept { return frames_; }
    const DecoderRegistry &decoders() const noexcept { return decoders_; }

  private:
    DecoderRegistry decoders_{};
    FrameStore<FrameCapacity> frames_{};
};

} // namespace lilyshark
