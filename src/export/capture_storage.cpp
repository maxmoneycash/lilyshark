#include "lilyshark/export/capture_storage.h"

namespace lilyshark {
namespace {

// One row per status, in enum order. The tests index this table by every
// value and compare every pair, so a new status with a borrowed string fails
// the build's own gate rather than shipping as a second meaning for an
// existing message.
struct StatusText {
    const char *label;
    const char *sentence;
};

constexpr StatusText kStatusText[kCaptureStorageStatusCount] = {
    {"READY", "storage is ready"},
    {"OFF", "capture is off in Settings"},
    {"NO CARD", "no card answered the slot"},
    {"NO FOLDER", "the card refused the /lilyshark folder"},
    {"9999 FILES", "all 9999 capture names on the card are taken"},
    {"PATH TOO LONG", "the capture path did not fit its buffer"},
    {"NO FILE", "no capture file is open"},
    {"BAD REQUEST", "the writer asked for an impossible write"},
    {"WRITE REFUSED", "the card is answering and refused the write"},
    {"CARD FULL", "the card reports no free space"},
    {"CARD GONE", "the card stopped answering after a failed write"},
};

std::size_t indexOf(CaptureStorageStatus status) noexcept
{
    const std::size_t index = static_cast<std::size_t>(status);
    return index < kCaptureStorageStatusCount ? index : 0U;
}

} // namespace

const char *captureStorageStatusLabel(CaptureStorageStatus status) noexcept
{
    return kStatusText[indexOf(status)].label;
}

const char *captureStorageStatusSentence(CaptureStorageStatus status) noexcept
{
    return kStatusText[indexOf(status)].sentence;
}

CaptureFreeSpace classifyFreeSpace(std::uint64_t total_bytes, std::uint64_t used_bytes,
                                   std::uint64_t needed_bytes) noexcept
{
    // A card with a zero-byte filesystem does not exist, so a zero total is
    // the failed query answering in disguise. Reporting Full here is the bug:
    // it sends an operator to delete files off a card that never answered.
    if (total_bytes == 0U) {
        return CaptureFreeSpace::Unknown;
    }
    // Used above total is nonsense from the same failing query.
    if (used_bytes > total_bytes) {
        return CaptureFreeSpace::Unknown;
    }
    const std::uint64_t free_bytes = total_bytes - used_bytes;
    return free_bytes >= (needed_bytes == 0U ? 1U : needed_bytes) ? CaptureFreeSpace::Available
                                                                  : CaptureFreeSpace::Full;
}

} // namespace lilyshark
