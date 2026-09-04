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

    void end()
    {
        ++device_shell_fake::state().sd_end_calls;
        device_shell_fake::record("sd.end");
    }

    /// A directory read is a fresh transaction with the card, which is what
    /// makes it the firmware's probe for "is this card still there at all".
    /// A removed card answers nothing.
    bool exists(const char *path) const
    {
        if(path == nullptr || device_shell_fake::state().sd_removed) return false;
        const std::string value(path);
        return device_shell_fake::state().directories.count(value) != 0U ||
               device_shell_fake::state().files.count(value) != 0U;
    }

    /// f_getfree, including its failure mode: it reports zero for both totals
    /// when it cannot answer, so a caller that subtracts them sees a full card
    /// where there is really no reading at all.
    std::uint64_t totalBytes() const
    {
        const auto &card = device_shell_fake::state();
        if(card.sd_free_space_query_fails || card.sd_removed) return 0;
        return card.sd_total_bytes;
    }

    std::uint64_t usedBytes() const
    {
        const auto &card = device_shell_fake::state();
        if(card.sd_free_space_query_fails || card.sd_removed) return 0;
        return card.sd_used_bytes;
    }

    bool mkdir(const char *path)
    {
        const auto &card = device_shell_fake::state();
        if(!card.sd_present || card.sd_removed || card.sd_write_refused || path == nullptr) {
            return false;
        }
        device_shell_fake::state().directories.insert(path);
        return true;
    }

    fs::File open(const char *path, std::uint8_t)
    {
        if(!device_shell_fake::state().sd_present ||
           device_shell_fake::state().sd_removed ||
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
