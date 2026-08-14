#pragma once

#include "lilyshark/core/radio_profile.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kSavedProfileV1Size = 16U;
inline constexpr std::size_t kSavedProfileV2Size = 18U;

enum class SavedProfileDecodeResult : std::uint8_t {
    Invalid = 0,
    LoadedV2,
    MigratedV1,
};

// Decodes either supported on-device format. The output remains unchanged on
// failure. Version 1 profiles receive an inferred frequency policy.
[[nodiscard]] SavedProfileDecodeResult decodeSavedProfile(
    const std::uint8_t *bytes, std::size_t size, RadioProfile &profile) noexcept;

// Encodes the current validated format used by Preferences storage.
[[nodiscard]] bool encodeSavedProfileV2(
    const RadioProfile &profile, std::uint8_t *bytes, std::size_t size) noexcept;

} // namespace lilyshark
