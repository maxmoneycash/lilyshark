// The storage-fault vocabulary, and the free-space reading that must never
// round a failed query down to "full".
//
// Both of these exist because the deck answered four different card problems
// with one word. The tests are written to fail if that ever comes back: they
// compare every status against every other status, rather than spot-checking
// the handful of strings someone happened to think of.

#include "lilyshark/export/capture_storage.h"

#include <cassert>
#include <cstddef>
#include <cstdio>
#include <cstring>

namespace {

using namespace lilyshark;

constexpr CaptureStorageStatus kAllStatuses[] = {
    CaptureStorageStatus::Ok,
    CaptureStorageStatus::CaptureDisabled,
    CaptureStorageStatus::NoCard,
    CaptureStorageStatus::DirectoryRefused,
    CaptureStorageStatus::NamesExhausted,
    CaptureStorageStatus::PathTooLong,
    CaptureStorageStatus::NotOpen,
    CaptureStorageStatus::BadRequest,
    CaptureStorageStatus::WriteRefused,
    CaptureStorageStatus::CardFull,
    CaptureStorageStatus::CardStoppedAnswering,
};

constexpr std::size_t kStatusCount = sizeof(kAllStatuses) / sizeof(kAllStatuses[0]);

// If someone adds a status to the enum and forgets this list, every "for each
// status" test below would silently stop covering it.
static_assert(kStatusCount == kCaptureStorageStatusCount,
              "kAllStatuses must list every CaptureStorageStatus");

// The whole point of the enum. "unavailable" used to mean a disabled setting,
// an empty slot, and a card that refused the file; "I/O ERROR" used to mean a
// full card, a write-protected card, and a card pulled mid-write. Any two
// statuses sharing a string puts an operator back to guessing, so compare
// every pair rather than the ones that seem likely to collide.
void everyStatusHasItsOwnWords()
{
    for (std::size_t left = 0; left < kStatusCount; ++left) {
        const char *left_label = captureStorageStatusLabel(kAllStatuses[left]);
        const char *left_sentence = captureStorageStatusSentence(kAllStatuses[left]);
        assert(left_label != nullptr && left_label[0] != '\0');
        assert(left_sentence != nullptr && left_sentence[0] != '\0');
        // The CAPTURE screen puts this label in a fixed column beside a name.
        assert(std::strlen(left_label) <= 16);
        for (std::size_t right = left + 1; right < kStatusCount; ++right) {
            assert(std::strcmp(left_label, captureStorageStatusLabel(kAllStatuses[right])) != 0);
            assert(std::strcmp(left_sentence,
                               captureStorageStatusSentence(kAllStatuses[right])) != 0);
        }
    }
}

// The four faults the brief names must each arrive as their own words. Spelled
// out separately from the pairwise loop because these are the ones a person
// reads off a serial monitor in the field.
void theFourCardFaultsReadDifferently()
{
    assert(std::strcmp(captureStorageStatusLabel(CaptureStorageStatus::NoCard), "NO CARD") == 0);
    assert(std::strcmp(captureStorageStatusLabel(CaptureStorageStatus::WriteRefused),
                       "WRITE REFUSED") == 0);
    assert(std::strcmp(captureStorageStatusLabel(CaptureStorageStatus::CardFull),
                       "CARD FULL") == 0);
    assert(std::strcmp(captureStorageStatusLabel(CaptureStorageStatus::CardStoppedAnswering),
                       "CARD GONE") == 0);
    // "capture is off" is not a fault at all, and used to be indistinguishable
    // from a missing card on the boot line.
    assert(std::strcmp(captureStorageStatusLabel(CaptureStorageStatus::CaptureDisabled),
                       "OFF") == 0);

    // The NoCard wording must not claim the slot is empty. SDFS::begin unwinds
    // its whole mount on failure, so nothing survives that could tell an empty
    // slot from a card that would not mount -- saying "no card in the slot"
    // would be inventing the half of the answer the hardware did not give.
    const char *no_card = captureStorageStatusSentence(CaptureStorageStatus::NoCard);
    assert(std::strstr(no_card, "answered") != nullptr);
    assert(std::strstr(no_card, "empty") == nullptr);
}

// An out-of-range value must not read off the end of the table. It reports as
// Ok, which is the only entry that is always present.
void anUnknownStatusStaysInsideTheTable()
{
    const auto rogue = static_cast<CaptureStorageStatus>(200);
    assert(captureStorageStatusLabel(rogue) != nullptr);
    assert(captureStorageStatusSentence(rogue) != nullptr);
}

// The absent-is-not-zero trap, in the one place where "full" is something an
// operator acts on by deleting files.
//
// SD.totalBytes() and SD.usedBytes() are both f_getfree, and f_getfree reports
// zero for both when it fails. `total - used == 0` therefore reads a FAILED
// QUERY as a full card and sends someone deleting files off a healthy one.
void aFailedFreeSpaceQueryIsNotAFullCard()
{
    // Both totals zero: the query did not answer. Not full.
    assert(classifyFreeSpace(0, 0, 1) == CaptureFreeSpace::Unknown);
    // Zero total with a non-zero used is the same failure, self-contradicting.
    assert(classifyFreeSpace(0, 4096, 1) == CaptureFreeSpace::Unknown);
    // Used above total cannot happen on a working filesystem.
    assert(classifyFreeSpace(1024, 2048, 1) == CaptureFreeSpace::Unknown);

    // A card that really is full.
    assert(classifyFreeSpace(1024, 1024, 1) == CaptureFreeSpace::Full);
    // Room for some bytes, but not for the write being attempted.
    assert(classifyFreeSpace(1024, 1000, 100) == CaptureFreeSpace::Full);

    // Room to spare.
    assert(classifyFreeSpace(1024, 0, 1) == CaptureFreeSpace::Available);
    assert(classifyFreeSpace(1024, 1000, 24) == CaptureFreeSpace::Available);

    // A zero-byte request still needs one byte of room, so "no space at all"
    // cannot be reported as Available on a technicality.
    assert(classifyFreeSpace(1024, 1024, 0) == CaptureFreeSpace::Full);
    assert(classifyFreeSpace(1024, 1023, 0) == CaptureFreeSpace::Available);

    // Real card sizes: the arithmetic must not overflow or wrap.
    constexpr std::uint64_t kThirtyTwoGb = 32ULL * 1024ULL * 1024ULL * 1024ULL;
    assert(classifyFreeSpace(kThirtyTwoGb, kThirtyTwoGb - 8, 16) == CaptureFreeSpace::Full);
    assert(classifyFreeSpace(kThirtyTwoGb, 0, kThirtyTwoGb) == CaptureFreeSpace::Available);
}

} // namespace

int main()
{
    everyStatusHasItsOwnWords();
    theFourCardFaultsReadDifferently();
    anUnknownStatusStaysInsideTheTable();
    aFailedFreeSpaceQueryIsNotAFullCard();
    std::printf("Capture storage status tests passed\n");
    return 0;
}
