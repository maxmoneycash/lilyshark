#include "lilyshark/core/runtime_event_history.h"

#include <algorithm>

namespace lilyshark {
namespace {

bool validSeverity(RuntimeEventSeverity severity) noexcept
{
    return static_cast<std::uint8_t>(severity) <
           static_cast<std::uint8_t>(RuntimeEventSeverity::Count);
}

bool validType(RuntimeEventType type) noexcept
{
    return static_cast<std::uint8_t>(type) <
           static_cast<std::uint8_t>(RuntimeEventType::Count);
}

} // namespace

RuntimeEventAppendResult RuntimeEventHistory::append(
    std::uint64_t timestamp_us, RuntimeEventSeverity severity,
    RuntimeEventType type, const char *message) noexcept
{
    if(!validSeverity(severity) || !validType(type) || message == nullptr ||
       message[0] == '\0') {
        return RuntimeEventAppendResult::Invalid;
    }

    RuntimeEvent event{};
    event.timestamp_us = timestamp_us;
    event.severity = severity;
    event.type = type;

    std::size_t message_size = 0U;
    while(message_size + 1U < kRuntimeEventMessageCapacity &&
          message[message_size] != '\0') {
        ++message_size;
    }
    std::copy(message, message + message_size, event.message);
    event.message[message_size] = '\0';
    const bool truncated = message[message_size] != '\0';

    std::size_t destination = 0U;
    if(size_ < kRuntimeEventHistoryCapacity) {
        destination = (oldest_index_ + size_) % kRuntimeEventHistoryCapacity;
        ++size_;
    } else {
        destination = oldest_index_;
        oldest_index_ = (oldest_index_ + 1U) % kRuntimeEventHistoryCapacity;
    }
    events_[destination] = event;
    return truncated ? RuntimeEventAppendResult::AppendedTruncated
                     : RuntimeEventAppendResult::Appended;
}

const RuntimeEvent *RuntimeEventHistory::at(
    std::size_t chronological_index) const noexcept
{
    if(chronological_index >= size_) return nullptr;
    const std::size_t index =
        (oldest_index_ + chronological_index) % kRuntimeEventHistoryCapacity;
    return &events_[index];
}

const RuntimeEvent *RuntimeEventHistory::newest(
    std::size_t offset_from_newest) const noexcept
{
    if(offset_from_newest >= size_) return nullptr;
    return at(size_ - 1U - offset_from_newest);
}

void RuntimeEventHistory::clear() noexcept
{
    events_ = {};
    oldest_index_ = 0U;
    size_ = 0U;
}

} // namespace lilyshark
