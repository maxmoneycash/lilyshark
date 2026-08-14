#pragma once

#include <RadioLib.h>

inline std::int64_t esp_timer_get_time() noexcept
{
    return static_cast<std::int64_t>(radiolib_fake::state().now_us);
}
