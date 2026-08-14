#pragma once

#include "lilyshark/core/frame_store.h"
#include "lilyshark/export/byte_sink.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::uint32_t kPcapLoraTapLinkType = 270;
inline constexpr std::size_t kLoraTapV0HeaderSize = 15;
inline constexpr std::uint32_t kPcapCaptureLength =
    static_cast<std::uint32_t>(kLoraTapV0HeaderSize + kMaxFrameBytes);

enum class PcapWriteResult : std::uint8_t {
    Ok = 0,
    NotStarted,
    AlreadyStarted,
    InvalidBandwidth,
    SinkError,
};

// Writes classic little-endian PCAP containing LoRaTap v0 packets. All
// temporary buffers are fixed-size stack storage and payloads stream directly
// to the sink.
class PcapLoraTapWriter
{
  public:
    explicit PcapLoraTapWriter(ByteSink &sink) noexcept : sink_(sink) {}

    PcapWriteResult begin() noexcept;
    PcapWriteResult write(const RawFrame &frame) noexcept;
    PcapWriteResult write(const FrameRecord &record) noexcept { return write(record.raw); }

    bool started() const noexcept { return started_; }
    bool failed() const noexcept { return failed_; }

  private:
    ByteSink &sink_;
    bool started_ = false;
    bool failed_ = false;
};

} // namespace lilyshark
