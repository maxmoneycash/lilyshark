#pragma once

// Field Receipts witness key (docs/protocol/field-receipts.md, "Witness key
// derivation (normative)").
//
// A witness key identifies one over-the-air transmission: two independently
// operated receivers that heard the same frame derive the same 32 bytes, and
// that coincidence is the protocol's anti-spoof primitive. The derivation is
// frozen and shared byte-exact with scripts/field_receipts.py and the webapp;
// every implementation is pinned by WITNESS-VECTOR-1:
//
//   witness_key     = SHA-256( payload_bytes || u32le(rounded_freq_hz) || u32le(time_bucket) )
//   rounded_freq_hz = ((freq_hz + 12500) // 25000) * 25000
//   time_bucket     = unix_seconds // 60
//
// The key deliberately contains no location and no node identity.

#include "lilyshark/core/raw_frame.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kWitnessKeySize = 32;
inline constexpr std::uint32_t kWitnessFrequencyStepHz = 25000;
inline constexpr std::uint32_t kWitnessBucketSeconds = 60;

/// Why a frame yields no witness key, mirroring the spec's numbered
/// eligibility rules. An ineligible frame yields no key — never a placeholder.
enum class WitnessEligibility : std::uint8_t {
    Eligible = 0,
    /// Metadata marks the frame simulated. Synthetic frames are refused
    /// loudly, never skipped silently (spec rule 5).
    Synthetic,
    /// CRC state is not `valid` (spec rule 1).
    CrcNotValid,
    /// Captured length is zero (spec rule 2).
    EmptyPayload,
    /// Captured length differs from the original length (spec rule 2).
    Truncated,
    /// Timestamp or center-frequency present bit is clear (spec rule 3).
    RequiredFieldsAbsent,
    /// No wall-clock anchor: .lscap v1 timestamps are boot-relative ticks, so
    /// unix time needs an anchor from outside the record (spec rule 4).
    NoWallClock,
    /// This deck sent the frame. A witness key asserts that a receiver heard
    /// a transmission it did not make, which is the whole value of one; a key
    /// over our own beacon attests to nothing but our own existence. Our
    /// transmissions were excluded by accident until now -- they carried no
    /// timestamp, so they failed the rule above -- and the moment they were
    /// given the real timestamp they always deserved, they would have started
    /// producing receipts. Refused by name so the count is visible rather
    /// than hidden inside a field-absence tally.
    SelfTransmitted,
};

/// Round to the nearest 25 kHz step, half-up — an offset of exactly 12,500 Hz
/// above a step rounds to the step above.
std::uint32_t roundWitnessFrequencyHz(std::uint32_t freq_hz) noexcept;

/// unix_seconds // 60, encoded as u32 the way the preimage stores it.
std::uint32_t witnessTimeBucket(std::uint64_t unix_seconds) noexcept;

/// The spec's eligibility list over one captured frame. `has_wall_clock` is
/// whether the caller can anchor the frame's tick timestamp to unix time.
WitnessEligibility witnessEligibility(const RawFrame &frame, bool has_wall_clock) noexcept;

/// The frozen derivation. `payload` must be the frame's captured bytes exactly
/// as stored — no radio metadata, no length prefix, no padding. Writes the raw
/// 32-byte SHA-256 digest to `out_key`.
void computeWitnessKey(const std::uint8_t *payload, std::size_t payload_length,
                       std::uint32_t freq_hz, std::uint64_t unix_seconds,
                       std::uint8_t out_key[kWitnessKeySize]) noexcept;

/// Diagnostic label matching scripts/field_receipts.py's reason tokens
/// ("synthetic", "crc_not_valid", ...); "eligible" for Eligible.
const char *witnessEligibilityLabel(WitnessEligibility eligibility) noexcept;

} // namespace lilyshark
