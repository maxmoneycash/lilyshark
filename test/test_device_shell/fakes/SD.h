#pragma once

#include "FS.h"
#include "SPI.h"
#include "device_shell_fake.h"

#include <cstdint>
#include <memory>
#include <string>

inline constexpr std::uint8_t FILE_WRITE = 1;

class SDClass {
  public:
    bool begin(std::uint8_t, SPIClass &, std::uint32_t)
    {
        device_shell_fake::record("sd.begin");
        return device_shell_fake::state().sd_present;
    }

    bool exists(const char *path) const
    {
        if(path == nullptr) return false;
        const std::string value(path);
        return device_shell_fake::state().directories.count(value) != 0U ||
               device_shell_fake::state().files.count(value) != 0U;
    }

    bool mkdir(const char *path)
    {
        if(!device_shell_fake::state().sd_present || path == nullptr) return false;
        device_shell_fake::state().directories.insert(path);
        return true;
    }

    fs::File open(const char *path, std::uint8_t)
    {
        if(!device_shell_fake::state().sd_present ||
           device_shell_fake::state().fail_file_open || path == nullptr) return {};
        auto &entry = device_shell_fake::state().files[path];
        if(!entry) entry = std::make_shared<device_shell_fake::FileData>();
        device_shell_fake::record("sd.open." + std::string(path));
        return fs::File(entry);
    }

    bool remove(const char *path)
    {
        return path != nullptr && device_shell_fake::state().files.erase(path) != 0U;
    }
};

inline SDClass SD{};
