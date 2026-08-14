#pragma once

#include <cstdint>

namespace lilyshark {

// Safe for deadlines scheduled less than 2^31 milliseconds ahead. Callers poll
// frequently, so the modular difference remains unambiguous at wrap.
constexpr bool monotonicDeadlineReached(std::uint32_t now_ms,
                                        std::uint32_t deadline_ms) noexcept
{
    return now_ms - deadline_ms < (std::uint32_t{1} << 31U);
}

} // namespace lilyshark
