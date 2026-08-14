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
    InvalidFrame,
};

// Writes classic little-endian PCAP containing LoRaTap v0 packets. Each packet
// record is assembled in fixed-size stack storage and passed to the sink in one
// write call. PCAP timestamps preserve RawFrame's boot-relative monotonic
// microseconds; they are not Unix wall time.
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
