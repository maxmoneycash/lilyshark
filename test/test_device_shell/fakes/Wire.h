#pragma once

#include "device_shell_fake.h"

#include <cstddef>
#include <cstdint>
#include <deque>
#include <vector>

class TwoWire {
  public:
    void reset()
    {
        address_ = 0;
        tx_.clear();
        rx_.clear();
    }

    bool begin(std::int8_t sda, std::int8_t scl, std::uint32_t frequency)
    {
        device_shell_fake::record("wire.begin." + std::to_string(sda) + "." +
                                  std::to_string(scl) + "." + std::to_string(frequency));
        return true;
    }

    void beginTransmission(std::uint8_t address)
    {
        address_ = address;
        tx_.clear();
    }

    std::size_t write(std::uint8_t value)
    {
        tx_.push_back(value);
        return 1;
    }

    std::uint8_t endTransmission(bool = true)
    {
        if(address_ == 0x55U && tx_.size() == 2U && tx_[0] == 0x01U) {
            device_shell_fake::record("keyboard.brightness." + std::to_string(tx_[1]));
            if(!device_shell_fake::state().keyboard_present) return 2U;
        }
        if((address_ == 0x5dU || address_ == 0x14U) &&
           !device_shell_fake::state().touch_present) return 2U;
        return 0U;
    }

    std::size_t requestFrom(std::uint8_t address, std::size_t length, bool = true)
    {
        rx_.clear();
        if(address == 0x55U) {
            if(!device_shell_fake::state().keyboard_present) return 0U;
            if(!device_shell_fake::state().keyboard_bytes.empty() && length != 0U) {
                rx_.push_back(device_shell_fake::state().keyboard_bytes.front());
                device_shell_fake::state().keyboard_bytes.pop_front();
            }
            return rx_.size();
        }
        if((address == 0x5dU || address == 0x14U) &&
           device_shell_fake::state().touch_present && tx_.size() >= 2U) {
            const std::uint16_t register_address =
                static_cast<std::uint16_t>(tx_[0] << 8U) | tx_[1];
            if(register_address == 0x8140U && length == 4U) {
                rx_.push_back('9');
                rx_.push_back('1');
                rx_.push_back('1');
                rx_.push_back(0);
                device_shell_fake::record("touch.product.read");
            } else if(register_address == 0x814eU && length == 1U) {
                rx_.push_back(0);
            }
        }
        return rx_.size();
    }

    std::uint8_t requestFrom(std::uint8_t address, std::uint8_t length)
    {
        return static_cast<std::uint8_t>(requestFrom(address,
                                                     static_cast<std::size_t>(length), true));
    }

    int available() const noexcept { return static_cast<int>(rx_.size()); }

    int read()
    {
        if(rx_.empty()) return -1;
        const int value = rx_.front();
        rx_.pop_front();
        return value;
    }

  private:
    std::uint8_t address_ = 0;
    std::vector<std::uint8_t> tx_{};
    std::deque<std::uint8_t> rx_{};
};

inline TwoWire Wire{};
