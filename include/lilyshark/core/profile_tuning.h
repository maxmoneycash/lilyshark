#pragma once

#include "lilyshark/core/radio_profile.h"

namespace lilyshark {

/// SX1262 LoRa preamble limits.
///
/// `SetPacketParams` carries PreambleLength as a 16-bit field (SX1261/2
/// datasheet rev 2.1, section 13.4.6, table 13-67), so 65535 symbols is the
/// hardware ceiling. The floor is 6: the modem's preamble detector needs at
/// least that many symbols before the 4.25-symbol sync sequence, and RadioLib's
/// SX126x::setPreambleLength rejects anything shorter for LoRa. Nothing between
/// the two is clamped — an out-of-range request is refused, not rounded.
inline constexpr std::uint16_t kMinimumPreambleSymbols = 6U;
inline constexpr std::uint16_t kMaximumPreambleSymbols = 65535U;

/// Outcome of an explicit single-field profile edit. Every rejection names its
/// reason; nothing is silently clamped into range.
enum class ProfileEditResult : std::uint8_t {
    Applied = 0,
    /// The request was already the profile's value. `out` holds the profile
    /// unchanged, and callers should not rewrite nonvolatile storage.
    Unchanged,
    /// The value is outside what the SX1262 can be programmed with.
    OutOfRange,
    /// The field does not exist for this profile's modulation.
    UnsupportedModulation,
};

// Returns a tuned copy. Positive directions step up, negative directions step
// down, and zero leaves the profile unchanged. Unsupported bands are left
// unchanged.
[[nodiscard]] RadioProfile stepProfileFrequency(const RadioProfile &profile,
                                                int direction) noexcept;

// These helpers cycle forward through the standard LoRa values and preserve
// every other profile field.
[[nodiscard]] RadioProfile cycleProfileBandwidth(const RadioProfile &profile) noexcept;
[[nodiscard]] RadioProfile cycleProfileSpreadingFactor(const RadioProfile &profile) noexcept;
[[nodiscard]] RadioProfile cycleProfileCodingRate(const RadioProfile &profile) noexcept;

// Returns the protocol-defined preamble for the profile's bandwidth and
// spreading factor. Protocols without a fixed rule retain the supplied value.
[[nodiscard]] std::uint16_t derivePreambleSymbols(const RadioProfile &profile) noexcept;

// Short display name for a band plan, or "AUTO" for RegionCode::Unspecified.
[[nodiscard]] const char *regionLabel(RegionCode region) noexcept;

// The band edges for a region, inclusive. False for Unspecified, Count, and
// any value outside the enumeration.
[[nodiscard]] bool regionBandLimits(RegionCode region, std::uint32_t &lower_hz,
                                    std::uint32_t &upper_hz) noexcept;

// True when the value is something an SX1262 sync word register can hold.
// Values at or below 0xff are the one-byte logical form RadioLib expands;
// larger values are the raw register pair, whose low nibbles are the fixed
// control bits and so must both be 4 (0x1424 private, 0x3444 public).
[[nodiscard]] bool isSupportedSyncWord(std::uint16_t sync_word) noexcept;

// True when the preamble length is inside the SX1262 range, and — for a
// profile that has not been overridden — equal to the derived value.
[[nodiscard]] bool isSupportedPreambleSymbols(const RadioProfile &profile,
                                              std::uint16_t symbols) noexcept;

// Explicit field edits. `out` is written only when the result is Applied or
// Unchanged, and always holds a complete profile in those cases. Out-of-range
// requests are refused outright: an analyzer that quietly retunes itself to a
// value the operator did not ask for is worse than one that says no.
[[nodiscard]] ProfileEditResult setProfileSyncWord(const RadioProfile &profile,
                                                   std::uint16_t sync_word,
                                                   RadioProfile &out) noexcept;
[[nodiscard]] ProfileEditResult setProfilePreambleSymbols(const RadioProfile &profile,
                                                          std::uint16_t symbols,
                                                          RadioProfile &out) noexcept;

// Drops a preamble override and returns to the protocol-derived value.
[[nodiscard]] ProfileEditResult clearProfilePreambleOverride(const RadioProfile &profile,
                                                             RadioProfile &out) noexcept;

// Infers the policy missing from the version 1 saved-profile format. Only an
// exact Meshtastic occupied-band center can become an explicit slot.
[[nodiscard]] bool inferLegacyFrequencyTuningPolicy(RadioProfile &profile) noexcept;

// True when the profile uses one of the supported regional tuning bands and
// standard LoRa values. This is also the validation boundary for settings
// restored from nonvolatile storage.
[[nodiscard]] bool isSupportedTunedProfile(const RadioProfile &profile) noexcept;

} // namespace lilyshark
