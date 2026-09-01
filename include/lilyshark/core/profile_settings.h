#pragma once

#include "lilyshark/core/radio_profile.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kSavedProfileV1Size = 16U;
inline constexpr std::size_t kSavedProfileV2Size = 18U;
/// Version 3 adds the sync word, the preamble length and its override flag,
/// and the band plan — and, like every other preference record on this device,
/// a trailing CRC-32 over everything before it. Versions 1 and 2 had no
/// checksum; a half-written record could decode as a plausible profile and
/// silently retune the radio. Anything that fails the CRC is refused outright,
/// leaving the caller to roll back to the last profile it trusted.
inline constexpr std::size_t kSavedProfileV3Size = 28U;

enum class SavedProfileDecodeResult : std::uint8_t {
    Invalid = 0,
    LoadedV3,
    MigratedV2,
    MigratedV1,
};

// Decodes any supported on-device format. The output remains unchanged on
// failure. Version 1 profiles receive an inferred frequency policy; versions 1
// and 2 take their sync word, preamble and band plan from the built-in preset
// their id names, which is where those values came from before this format
// could carry them.
[[nodiscard]] SavedProfileDecodeResult decodeSavedProfile(
    const std::uint8_t *bytes, std::size_t size, RadioProfile &profile) noexcept;

// Encodes the current validated format used by Preferences storage.
[[nodiscard]] bool encodeSavedProfileV3(
    const RadioProfile &profile, std::uint8_t *bytes, std::size_t size) noexcept;

} // namespace lilyshark
