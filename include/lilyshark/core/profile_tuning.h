#pragma once

#include "lilyshark/core/radio_profile.h"

namespace lilyshark {

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

// True when the profile uses one of the supported regional tuning bands and
// standard LoRa values. This is also the validation boundary for settings
// restored from nonvolatile storage.
[[nodiscard]] bool isSupportedTunedProfile(const RadioProfile &profile) noexcept;

} // namespace lilyshark
