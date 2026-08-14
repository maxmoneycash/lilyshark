#pragma once

#include "device_shell_fake.h"

#include <cstdint>

inline std::int64_t esp_timer_get_time() noexcept
{
    return static_cast<std::int64_t>(device_shell_fake::state().now_us);
}
