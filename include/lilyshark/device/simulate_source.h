#pragma once

// Simulate mode: synthetic mesh traffic, generated on the device.
//
// A LoRa analyzer with no mesh around it shows empty tables, which makes the
// interface impossible to exercise on the bench and impossible to show anyone.
// Simulate mode fabricates frames that look like a plausible LongFast channel
// and hands them to the same ingest path a real SX1262 frame takes. Screens and
// decoders therefore exercise the production path. Native .lscap records carry
// an explicit synthetic flag, while the LoRaTap writer rejects synthetic
// frames because that format has no compatible provenance field.
//
// It is off by default, persists across reboots, and is announced in the UI
// whenever it is on: a capture produced in simulate mode must never be
// mistaken for one produced by a radio.

#include <cstdint>

#include "lilyshark/core/raw_frame.h"

namespace lilyshark {
namespace device {

/// Cadence of synthetic arrivals. Roughly a busy-but-plausible LongFast
/// channel: frequent enough that a screen visibly moves, slow enough that the
/// airtime and packets-per-minute readouts stay believable.
inline constexpr std::uint32_t kSimulateFrameIntervalMs = 2400U;

/// Deterministic synthetic traffic for one simulated mesh.
///
/// The generator owns only a counter: frame contents derive from the sequence
/// number, so the same build always produces the same traffic and a bug seen
/// on the bench can be reproduced exactly.
class SimulateSource {
public:
    /// True when enough time has passed to emit the next frame.
    bool due(std::uint32_t now_ms) const noexcept
    {
        return now_ms - last_emit_ms_ >= kSimulateFrameIntervalMs;
    }

    /// Build the next frame. `profile_id` and the radio parameters are passed
    /// in so synthetic frames report the profile the device is actually
    /// configured for rather than a hardcoded one.
    RawFrame next(std::uint32_t now_ms,
                        std::uint32_t center_frequency_hz,
                        std::uint32_t bandwidth_hz,
                        std::uint8_t spreading_factor,
                        std::uint8_t coding_rate_denominator,
                        std::uint16_t profile_id) noexcept;

    /// Every ninth frame carries a Shelby pointer, so the off-grid path can be
    /// demonstrated and tested without waiting for a real one.
    static bool carriesPointer(std::uint32_t sequence) noexcept
    {
        return sequence % 9U == 4U;
    }

    std::uint32_t emitted() const noexcept { return emitted_; }

    void reset() noexcept
    {
        emitted_ = 0;
        last_emit_ms_ = 0;
    }

private:
    std::uint32_t emitted_ = 0;
    std::uint32_t last_emit_ms_ = 0;
};

}  // namespace device
}  // namespace lilyshark
