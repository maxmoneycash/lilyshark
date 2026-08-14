#pragma once

#include "lilyshark/core/radio_profile.h"

#include <cstddef>

namespace lilyshark {

// These are explicit receive profiles, not an assertion that one radio can
// monitor all of them at once. The active profile is always user-visible.
const RadioProfile *builtinProfiles() noexcept;
std::size_t builtinProfileCount() noexcept;
const RadioProfile *findBuiltinProfile(std::uint16_t id) noexcept;

} // namespace lilyshark
