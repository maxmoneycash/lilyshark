#pragma once

#include "device_shell_fake.h"

#include <cstddef>
#include <cstdint>
#include <cstring>

class Preferences {
  public:
    bool begin(const char *, bool)
    {
        device_shell_fake::record("preferences.begin");
        return device_shell_fake::state().preferences_available;
    }

    std::size_t getBytesLength(const char *) const noexcept
    {
        return device_shell_fake::state().saved_profile.size();
    }

    std::size_t getBytes(const char *, void *destination, std::size_t length) const noexcept
    {
        const auto &bytes = device_shell_fake::state().saved_profile;
        if(destination == nullptr || length > bytes.size()) return 0;
        if(length != 0) std::memcpy(destination, bytes.data(), length);
        return length;
    }

    std::size_t putBytes(const char *, const void *source, std::size_t length)
    {
        if(!device_shell_fake::state().preferences_available ||
           (source == nullptr && length != 0)) return 0;
        const auto *bytes = static_cast<const std::uint8_t *>(source);
        device_shell_fake::state().saved_profile.assign(bytes, bytes + length);
        return length;
    }
};
