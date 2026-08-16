#pragma once

#include <cstdint>
#include <deque>

inline constexpr int SERIAL_8N1 = 0;
inline constexpr int ADC_11db = 0;

namespace hardware_status_fake {

inline std::uint32_t now_ms = 0;
inline std::uint32_t battery_adc_mv = 2000;

} // namespace hardware_status_fake

inline std::uint32_t millis() noexcept
{
    return hardware_status_fake::now_ms;
}

inline void analogReadResolution(int) noexcept {}
inline void analogSetPinAttenuation(std::uint8_t, int) noexcept {}

inline std::uint32_t analogReadMilliVolts(std::uint8_t) noexcept
{
    return hardware_status_fake::battery_adc_mv;
}

class HardwareSerial
{
  public:
    void begin(std::uint32_t baud, int, std::int8_t, std::int8_t) noexcept
    {
        ++begin_calls;
        last_baud = baud;
        running = true;
    }

    void end() noexcept
    {
        ++end_calls;
        running = false;
    }

    int available() const noexcept
    {
        return static_cast<int>(bytes.size());
    }

    int read() noexcept
    {
        if (bytes.empty()) return -1;
        const int value = bytes.front();
        bytes.pop_front();
        ++read_calls;
        return value;
    }

    void push(char value)
    {
        bytes.push_back(static_cast<std::uint8_t>(value));
    }

    std::deque<std::uint8_t> bytes{};
    std::uint32_t last_baud = 0;
    std::uint32_t begin_calls = 0;
    std::uint32_t end_calls = 0;
    std::uint32_t read_calls = 0;
    bool running = false;
};

inline HardwareSerial Serial1{};
