#pragma once

#include <RadioLib.h>

inline unsigned long millis() noexcept
{
    return radiolib_fake::state().now_ms;
}
