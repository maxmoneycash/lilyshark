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

    std::size_t getBytesLength(const char *key) const noexcept
    {
        return bytesForKey(key).size();
    }

    std::size_t getBytes(const char *key, void *destination, std::size_t length) const noexcept
    {
        const auto &bytes = bytesForKey(key);
        if(destination == nullptr || length > bytes.size()) return 0;
        if(length != 0) std::memcpy(destination, bytes.data(), length);
        return length;
    }

    std::size_t putBytes(const char *key, const void *source, std::size_t length)
    {
        if(!device_shell_fake::state().preferences_available ||
           (source == nullptr && length != 0)) return 0;
        if(key != nullptr && std::strcmp(key, "app") == 0) {
            ++device_shell_fake::state().app_settings_put_calls;
            if(device_shell_fake::state().fail_app_settings_put) return 0;
        } else if(key != nullptr && std::strcmp(key, "profile") == 0) {
            ++device_shell_fake::state().profile_put_calls;
            if(device_shell_fake::state().fail_profile_put) return 0;
        } else if(key != nullptr && std::strcmp(key, "keys") == 0) {
            ++device_shell_fake::state().channel_keys_put_calls;
            if(device_shell_fake::state().fail_channel_keys_put) return 0;
        }
        const auto *bytes = static_cast<const std::uint8_t *>(source);
        bytesForKey(key).assign(bytes, bytes + length);
        return length;
    }

    bool remove(const char *key)
    {
        if(!device_shell_fake::state().preferences_available) return false;
        if(key != nullptr && std::strcmp(key, "keys") == 0) {
            ++device_shell_fake::state().channel_keys_remove_calls;
            if(device_shell_fake::state().fail_channel_keys_remove) return false;
        }
        bytesForKey(key).clear();
        return true;
    }

  private:
    static std::vector<std::uint8_t> &bytesForKey(const char *key) noexcept
    {
        if(key != nullptr && std::strcmp(key, "app") == 0) {
            return device_shell_fake::state().saved_app_settings;
        }
        if(key != nullptr && std::strcmp(key, "keys") == 0) {
            return device_shell_fake::state().saved_channel_keys;
        }
        return device_shell_fake::state().saved_profile;
    }
};
