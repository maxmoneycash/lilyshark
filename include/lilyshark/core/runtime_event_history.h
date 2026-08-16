#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kRuntimeEventHistoryCapacity = 24U;
inline constexpr std::size_t kRuntimeEventMessageCapacity = 96U;

enum class RuntimeEventSeverity : std::uint8_t {
    Info = 0,
    Success,
    Warning,
    Error,
    Count,
};

enum class RuntimeEventType : std::uint8_t {
    System = 0,
    Radio,
    Profile,
    Capture,
    Storage,
    Spectrum,
    Screenshot,
    Survey,
    Hardware,
    Count,
};

struct RuntimeEvent {
    std::uint64_t timestamp_us = 0U;
    RuntimeEventSeverity severity = RuntimeEventSeverity::Info;
    RuntimeEventType type = RuntimeEventType::System;
    char message[kRuntimeEventMessageCapacity]{};
};

enum class RuntimeEventAppendResult : std::uint8_t {
    Invalid = 0,
    Appended,
    AppendedTruncated,
};

// A bounded insertion-ordered history. Once full, append() overwrites the
// oldest row. at(0) is always the oldest retained row.
class RuntimeEventHistory
{
  public:
    [[nodiscard]] RuntimeEventAppendResult append(
        std::uint64_t timestamp_us, RuntimeEventSeverity severity,
        RuntimeEventType type, const char *message) noexcept;

    [[nodiscard]] const RuntimeEvent *at(
        std::size_t chronological_index) const noexcept;
    [[nodiscard]] const RuntimeEvent *newest(
        std::size_t offset_from_newest = 0U) const noexcept;

    void clear() noexcept;
    void reset() noexcept { clear(); }

    [[nodiscard]] std::size_t size() const noexcept { return size_; }
    [[nodiscard]] bool empty() const noexcept { return size_ == 0U; }
    [[nodiscard]] static constexpr std::size_t capacity() noexcept
    {
        return kRuntimeEventHistoryCapacity;
    }

  private:
    std::array<RuntimeEvent, kRuntimeEventHistoryCapacity> events_{};
    std::size_t oldest_index_ = 0U;
    std::size_t size_ = 0U;
};

} // namespace lilyshark
