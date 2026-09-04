#pragma once

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Why a capture file is not taking bytes.
///
/// The deck used to answer that question with one word. "unavailable" on the
/// boot line meant the operator had capture switched off in Settings, and it
/// meant nothing answered the card slot, and it meant a card was mounted and
/// refused the file. Three different situations, one string; and the CAPTURE
/// screen collapsed the same set into "I/O ERROR". An operator reading either
/// could not tell whether to flip a setting, push the card in, delete some
/// files, or go find another card.
///
/// Every value below is a different thing to go and do about it. Two of them
/// sharing a message is the bug this enum exists to prevent, so the tests
/// compare the label and sentence tables pairwise rather than spot-checking
/// one string.
enum class CaptureStorageStatus : std::uint8_t {
    /// Storage accepted everything asked of it.
    Ok = 0,
    /// Nobody asked for a capture; the operator turned it off.
    CaptureDisabled,
    /// The slot did not answer. This deliberately does not claim the slot is
    /// empty: the SD library unwinds its whole mount on failure and leaves
    /// nothing behind that separates "no card in the slot" from "a card that
    /// would not mount", so saying "no card" would be an invention.
    NoCard,
    /// The card mounted and then refused to hold /lilyshark.
    DirectoryRefused,
    /// capture-0001 through capture-9999 are all taken.
    NamesExhausted,
    /// The generated path did not fit the caller's buffer.
    PathTooLong,
    /// A write or flush arrived with no file open.
    NotOpen,
    /// The writer handed the sink something impossible: a null buffer with a
    /// non-zero length, or a length that would overflow the byte count.
    BadRequest,
    /// The card is mounted and answering, and refused these bytes anyway --
    /// a read-only mount or a bad block.
    WriteRefused,
    /// The filesystem reports no room left.
    CardFull,
    /// A write failed and the follow-up directory read failed too, so the
    /// card is no longer answering. Named for what was observed, not for the
    /// cause: FatFs can serve a directory from a cached sector, so a card
    /// pulled mid-write does not always fail this check on the first try.
    CardStoppedAnswering,
};

inline constexpr std::size_t kCaptureStorageStatusCount = 11U;

/// Free space is three-valued on purpose.
///
/// SD.totalBytes() and SD.usedBytes() are both f_getfree calls that return 0
/// when the query itself fails, so the obvious `total - used == 0` test reads
/// a FAILED QUERY as a full card -- the absent-is-not-zero trap, in the one
/// place where "full" is a thing an operator would act on by deleting files.
enum class CaptureFreeSpace : std::uint8_t { Unknown = 0, Available, Full };

/// Short all-caps text for a status row. At most 16 characters so it fits
/// beside a label on the 320px CAPTURE screen.
const char *captureStorageStatusLabel(CaptureStorageStatus status) noexcept;

/// One lower-case clause for the serial log and the event feed. Callers place
/// it inside their own sentence.
const char *captureStorageStatusSentence(CaptureStorageStatus status) noexcept;

/// Classify a free-space reading, given the filesystem's own totals and how
/// many bytes are about to be written. A `total_bytes` of zero is treated as
/// "the query did not answer", never as "the card holds nothing".
CaptureFreeSpace classifyFreeSpace(std::uint64_t total_bytes, std::uint64_t used_bytes,
                                   std::uint64_t needed_bytes) noexcept;

} // namespace lilyshark
