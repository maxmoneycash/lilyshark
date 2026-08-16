#include "lilyshark/core/runtime_event_history.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

using namespace lilyshark;

void testStartsEmptyAndBoundsAccess()
{
    RuntimeEventHistory history{};
    assert(history.empty());
    assert(history.size() == 0U);
    assert(history.capacity() == kRuntimeEventHistoryCapacity);
    assert(history.at(0U) == nullptr);
    assert(history.newest() == nullptr);
}

void testRowsPreserveEveryFieldInInsertionOrder()
{
    RuntimeEventHistory history{};
    assert(history.append(300U, RuntimeEventSeverity::Warning,
                          RuntimeEventType::Spectrum, "scan restored") ==
           RuntimeEventAppendResult::Appended);
    assert(history.append(100U, RuntimeEventSeverity::Success,
                          RuntimeEventType::Radio, "receiver ready") ==
           RuntimeEventAppendResult::Appended);
    assert(history.append(100U, RuntimeEventSeverity::Error,
                          RuntimeEventType::Storage, "write failed") ==
           RuntimeEventAppendResult::Appended);

    assert(history.size() == 3U);
    const RuntimeEvent *first = history.at(0U);
    const RuntimeEvent *second = history.at(1U);
    const RuntimeEvent *third = history.at(2U);
    assert(first != nullptr && first->timestamp_us == 300U);
    assert(first->severity == RuntimeEventSeverity::Warning);
    assert(first->type == RuntimeEventType::Spectrum);
    assert(std::strcmp(first->message, "scan restored") == 0);
    assert(second != nullptr && second->timestamp_us == 100U);
    assert(second->severity == RuntimeEventSeverity::Success);
    assert(second->type == RuntimeEventType::Radio);
    assert(std::strcmp(second->message, "receiver ready") == 0);
    assert(third != nullptr && third->timestamp_us == 100U);
    assert(third->severity == RuntimeEventSeverity::Error);
    assert(third->type == RuntimeEventType::Storage);
    assert(std::strcmp(third->message, "write failed") == 0);
    assert(history.at(3U) == nullptr);

    assert(history.newest() == third);
    assert(history.newest(1U) == second);
    assert(history.newest(2U) == first);
    assert(history.newest(3U) == nullptr);
}

void testFullHistoryOverwritesOldestAndKeepsChronologicalAccess()
{
    RuntimeEventHistory history{};
    constexpr std::size_t extra_rows = 9U;
    for(std::size_t index = 0U;
        index < kRuntimeEventHistoryCapacity + extra_rows; ++index) {
        char message[32]{};
        std::snprintf(message, sizeof(message), "event %zu", index);
        assert(history.append(static_cast<std::uint64_t>(index * 1000U),
                              RuntimeEventSeverity::Info,
                              RuntimeEventType::System, message) ==
               RuntimeEventAppendResult::Appended);
        assert(history.size() <= kRuntimeEventHistoryCapacity);
    }

    assert(history.size() == kRuntimeEventHistoryCapacity);
    for(std::size_t index = 0U; index < history.size(); ++index) {
        const RuntimeEvent *event = history.at(index);
        assert(event != nullptr);
        const std::size_t original_index = index + extra_rows;
        assert(event->timestamp_us == original_index * 1000U);
        char expected[32]{};
        std::snprintf(expected, sizeof(expected), "event %zu", original_index);
        assert(std::strcmp(event->message, expected) == 0);
    }
    assert(history.newest()->timestamp_us ==
           (kRuntimeEventHistoryCapacity + extra_rows - 1U) * 1000U);
}

void testMessagesAreBoundedAndExplicitlyReportTruncation()
{
    RuntimeEventHistory history{};
    char exact[kRuntimeEventMessageCapacity]{};
    std::memset(exact, 'x', sizeof(exact) - 1U);
    exact[sizeof(exact) - 1U] = '\0';
    assert(history.append(1U, RuntimeEventSeverity::Info,
                          RuntimeEventType::Capture, exact) ==
           RuntimeEventAppendResult::Appended);
    assert(std::strlen(history.newest()->message) ==
           kRuntimeEventMessageCapacity - 1U);

    char oversized[kRuntimeEventMessageCapacity + 17U]{};
    std::memset(oversized, 'y', sizeof(oversized) - 1U);
    oversized[sizeof(oversized) - 1U] = '\0';
    assert(history.append(2U, RuntimeEventSeverity::Warning,
                          RuntimeEventType::Capture, oversized) ==
           RuntimeEventAppendResult::AppendedTruncated);
    const RuntimeEvent *event = history.newest();
    assert(event != nullptr);
    assert(std::strlen(event->message) == kRuntimeEventMessageCapacity - 1U);
    for(std::size_t index = 0U;
        index < kRuntimeEventMessageCapacity - 1U; ++index) {
        assert(event->message[index] == 'y');
    }
    assert(event->message[kRuntimeEventMessageCapacity - 1U] == '\0');
}

void testInvalidAppendLeavesHistoryUnchanged()
{
    RuntimeEventHistory history{};
    assert(history.append(10U, RuntimeEventSeverity::Success,
                          RuntimeEventType::Hardware, "touch ready") ==
           RuntimeEventAppendResult::Appended);
    const RuntimeEvent baseline = *history.at(0U);

    assert(history.append(11U, RuntimeEventSeverity::Count,
                          RuntimeEventType::System, "bad severity") ==
           RuntimeEventAppendResult::Invalid);
    assert(history.append(12U, RuntimeEventSeverity::Info,
                          RuntimeEventType::Count, "bad type") ==
           RuntimeEventAppendResult::Invalid);
    assert(history.append(13U, static_cast<RuntimeEventSeverity>(255U),
                          RuntimeEventType::System, "bad severity") ==
           RuntimeEventAppendResult::Invalid);
    assert(history.append(14U, RuntimeEventSeverity::Info,
                          static_cast<RuntimeEventType>(255U), "bad type") ==
           RuntimeEventAppendResult::Invalid);
    assert(history.append(15U, RuntimeEventSeverity::Info,
                          RuntimeEventType::System, nullptr) ==
           RuntimeEventAppendResult::Invalid);
    assert(history.append(16U, RuntimeEventSeverity::Info,
                          RuntimeEventType::System, "") ==
           RuntimeEventAppendResult::Invalid);

    assert(history.size() == 1U);
    const RuntimeEvent *retained = history.at(0U);
    assert(retained != nullptr);
    assert(retained->timestamp_us == baseline.timestamp_us);
    assert(retained->severity == baseline.severity);
    assert(retained->type == baseline.type);
    assert(std::strcmp(retained->message, baseline.message) == 0);
}

void testClearAndResetReturnToFreshState()
{
    RuntimeEventHistory history{};
    for(std::size_t index = 0U; index < history.capacity(); ++index) {
        assert(history.append(index, RuntimeEventSeverity::Info,
                              RuntimeEventType::System, "row") ==
               RuntimeEventAppendResult::Appended);
    }
    history.clear();
    assert(history.empty());
    assert(history.at(0U) == nullptr);
    assert(history.append(42U, RuntimeEventSeverity::Success,
                          RuntimeEventType::Survey, "survey complete") ==
           RuntimeEventAppendResult::Appended);
    assert(history.size() == 1U);
    assert(history.at(0U)->timestamp_us == 42U);

    history.reset();
    assert(history.empty());
    assert(history.newest() == nullptr);
    assert(history.append(UINT64_MAX, RuntimeEventSeverity::Info,
                          RuntimeEventType::System, "clock boundary") ==
           RuntimeEventAppendResult::Appended);
    assert(history.newest()->timestamp_us == UINT64_MAX);
}

} // namespace

int main()
{
    testStartsEmptyAndBoundsAccess();
    testRowsPreserveEveryFieldInInsertionOrder();
    testFullHistoryOverwritesOldestAndKeepsChronologicalAccess();
    testMessagesAreBoundedAndExplicitlyReportTruncation();
    testInvalidAppendLeavesHistoryUnchanged();
    testClearAndResetReturnToFreshState();
    std::puts("runtime event history tests passed");
    return 0;
}
