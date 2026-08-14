#pragma once

#include "lilyshark/core/frame_store.h"
#include "lilyshark/export/byte_sink.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr char kLilysharkCaptureExtension[] = ".lscap";
inline constexpr std::size_t kLilysharkCaptureFileHeaderSize = 24;
inline constexpr std::size_t kLilysharkCaptureRecordHeaderSize = 80;

enum class LilysharkCaptureWriteResult : std::uint8_t {
    Ok = 0,
    NotStarted,
    AlreadyStarted,
    InvalidFrame,
    SinkError,
};

// Writes the versioned, protocol-neutral Lilyshark capture format. The format
// stores every RawFrame RF field in its native integer units and supports PHY
// settings, such as 62.5 kHz bandwidth, that LoRaTap v0 cannot represent.
class LilysharkCaptureWriter
{
  public:
    explicit LilysharkCaptureWriter(ByteSink &sink) noexcept : sink_(sink) {}

    LilysharkCaptureWriteResult begin() noexcept;
    LilysharkCaptureWriteResult write(const RawFrame &frame) noexcept;
    LilysharkCaptureWriteResult write(const FrameRecord &record) noexcept;

    bool started() const noexcept { return started_; }
    bool failed() const noexcept { return failed_; }

  private:
    LilysharkCaptureWriteResult writeRecord(const RawFrame &frame, std::uint64_t sequence) noexcept;

    ByteSink &sink_;
    bool started_ = false;
    bool failed_ = false;
};

} // namespace lilyshark
