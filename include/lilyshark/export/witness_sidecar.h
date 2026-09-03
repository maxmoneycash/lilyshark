#pragma once

// Witness-key sidecar: `<capture>.witness` written next to the `.lscap`.
//
// The device already holds every input to a Field Receipts witness key at
// capture time (payload bytes, center frequency, timestamp), so it derives the
// keys as frames land and queues them in this sidecar. Nothing is transmitted
// and nothing touches the network — the file rides the existing
// resolve-when-connected pattern: the operator's phone or the analyzer submits
// the attestations when it next has connectivity, exactly like Shelby pointer
// resolution.
//
// Format — plain text, one line per record, lowercase hex, LF endings:
//
//   lilyshark-witness 1 <anchor-source> <epoch-unix-seconds>
//   <sequence> <64-hex-digit witness key>
//   ...
//
// The header carries the sidecar version, the wall-clock anchor source
// ("gps"), and the anchor itself: the unix time of capture tick 0, so
// `epoch + record_timestamp / ticks_per_second` reproduces each frame's
// `unix_seconds` and the whole file can be re-derived from the `.lscap`
// (scripts/field_receipts.py `keys --epoch <epoch>` prints the same
// `<sequence> <key-hex>` lines). Only eligible frames produce lines; an
// ineligible frame writes nothing — never a placeholder. Without a wall-clock
// anchor no sidecar is written at all, because every frame would be ineligible
// (spec rule 4).

#include "lilyshark/core/frame_store.h"
#include "lilyshark/export/byte_sink.h"
#include "lilyshark/shelby/witness_key.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr char kWitnessSidecarExtension[] = ".witness";
inline constexpr std::uint32_t kWitnessSidecarVersion = 1;

/// Where the wall-clock anchor came from. `.lscap` v1 records carry only
/// boot-relative ticks, so the anchor is always external to the capture.
enum class WitnessAnchorSource : std::uint8_t {
    /// UTC time from a GPS receiver with a current fix.
    Gps = 0,
};

/// The header token for an anchor source ("gps").
const char *witnessAnchorSourceToken(WitnessAnchorSource source) noexcept;

enum class WitnessSidecarWriteResult : std::uint8_t {
    Ok = 0,
    NotStarted,
    AlreadyStarted,
    /// begin() was given an unusable anchor (zero tick rate).
    InvalidAnchor,
    /// The frame yields no key; lastIneligibility() says why. No bytes were
    /// written.
    Ineligible,
    SinkError,
};

// Streams the sidecar to a ByteSink, one write call per line, mirroring
// LilysharkCaptureWriter's shape so the capture session can drive both writers
// the same way. No allocation; fixed line buffers.
class WitnessSidecarWriter
{
  public:
    explicit WitnessSidecarWriter(ByteSink &sink) noexcept : sink_(sink) {}

    /// Writes the header line. `epoch_unix_seconds` anchors capture tick 0 to
    /// wall time; `ticks_per_second` is the capture file's tick rate (the
    /// `.lscap` writer always emits 1,000,000).
    WitnessSidecarWriteResult begin(WitnessAnchorSource anchor,
                                    std::uint64_t epoch_unix_seconds,
                                    std::uint32_t ticks_per_second = 1000000U) noexcept;

    /// Derives and appends one `<sequence> <key-hex>` line when the record is
    /// eligible; returns Ineligible (writing nothing) when it is not.
    WitnessSidecarWriteResult write(const FrameRecord &record) noexcept;

    // Re-arms the writer after its previous sink has been flushed and closed.
    void reset() noexcept
    {
        started_ = false;
        failed_ = false;
        eligible_count_ = 0;
        last_ineligibility_ = WitnessEligibility::Eligible;
    }

    bool started() const noexcept { return started_; }
    bool failed() const noexcept { return failed_; }
    /// Why the most recent write() returned Ineligible.
    WitnessEligibility lastIneligibility() const noexcept { return last_ineligibility_; }
    /// Lines written since begin(), excluding the header.
    std::uint32_t eligibleCount() const noexcept { return eligible_count_; }

  private:
    ByteSink &sink_;
    std::uint64_t epoch_unix_seconds_ = 0;
    std::uint32_t ticks_per_second_ = 0;
    std::uint32_t eligible_count_ = 0;
    WitnessEligibility last_ineligibility_ = WitnessEligibility::Eligible;
    bool started_ = false;
    bool failed_ = false;
};

} // namespace lilyshark
