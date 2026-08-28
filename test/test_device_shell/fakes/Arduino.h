#pragma once

#include "device_shell_fake.h"

#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>

#define IRAM_ATTR

inline constexpr int LOW = 0;
inline constexpr int HIGH = 1;
inline constexpr int INPUT = 0;
inline constexpr int OUTPUT = 1;
inline constexpr int INPUT_PULLUP = 2;
inline constexpr int FALLING = 3;
inline constexpr int SERIAL_8N1 = 0;
inline constexpr int ADC_11db = 0;

using portMUX_TYPE = int;
#define portMUX_INITIALIZER_UNLOCKED 0

inline void portENTER_CRITICAL_ISR(portMUX_TYPE *) noexcept {}
inline void portEXIT_CRITICAL_ISR(portMUX_TYPE *) noexcept {}
inline void portENTER_CRITICAL(portMUX_TYPE *) noexcept {}
inline void portEXIT_CRITICAL(portMUX_TYPE *) noexcept {}

inline std::uint32_t millis() noexcept
{
    return static_cast<std::uint32_t>(device_shell_fake::state().now_us / 1000ULL);
}

inline void delay(std::uint32_t milliseconds) noexcept
{
    device_shell_fake::advance_ms(milliseconds);
}

inline void delayMicroseconds(std::uint32_t microseconds) noexcept
{
    device_shell_fake::state().now_us += microseconds;
}

inline void pinMode(std::uint8_t pin, int mode)
{
    device_shell_fake::record("pin.mode." + std::to_string(pin) + "." +
                              std::to_string(mode));
}

inline void digitalWrite(std::uint8_t pin, int level)
{
    auto &fake = device_shell_fake::state();
    // Pin 42 is the T-Deck display backlight. Preserve the exact framebuffer
    // that would first become visible so startup ordering can be asserted.
    if(pin == 42U && level == HIGH && !fake.first_backlight_frame_captured) {
        fake.first_backlight_framebuffer = fake.framebuffer;
        fake.first_backlight_frame_captured = true;
    }
    fake.pin_levels[pin] = level;
    device_shell_fake::record("digital." + std::to_string(pin) + "." +
                              (level == HIGH ? "high" : "low"));
}

inline void attachInterrupt(std::uint8_t pin, void (*handler)(), int)
{
    if(pin < device_shell_fake::state().interrupt_handlers.size()) {
        device_shell_fake::state().interrupt_handlers[pin] = handler;
    }
    device_shell_fake::record("interrupt.attach." + std::to_string(pin));
}

class EspClass {
public:
    std::uint64_t getEfuseMac() const noexcept { return 0x112233445566ULL; }
};

inline EspClass ESP;

inline void analogReadResolution(int) noexcept {}
inline void analogSetPinAttenuation(std::uint8_t, int) noexcept {}
inline std::uint32_t analogReadMilliVolts(std::uint8_t) noexcept
{
    return device_shell_fake::state().battery_adc_mv;
}

inline void *ps_malloc(std::size_t size) noexcept
{
    device_shell_fake::record("psram.allocate");
    if(!device_shell_fake::state().psram_available) return nullptr;
    return std::malloc(size);
}

class HardwareSerial {
  public:
    explicit HardwareSerial(bool console = false) noexcept : console_(console) {}

    void begin(std::uint32_t baud)
    {
        device_shell_fake::record(console_ ? "serial.begin" : "gps.begin." + std::to_string(baud));
    }

    void begin(std::uint32_t baud, int, std::int8_t, std::int8_t)
    {
        device_shell_fake::record("gps.begin." + std::to_string(baud));
    }

    void end()
    {
        if(!console_) device_shell_fake::record("gps.end");
    }

    void println(const char *line)
    {
        if(!console_) return;
        device_shell_fake::state().serial_log += line == nullptr ? "" : line;
        device_shell_fake::state().serial_log.push_back('\n');
    }

    int printf(const char *format, ...)
    {
        if(!console_) return 0;
        char buffer[512]{};
        va_list arguments;
        va_start(arguments, format);
        const int written = std::vsnprintf(buffer, sizeof(buffer), format, arguments);
        va_end(arguments);
        if(written > 0) {
            const std::size_t count = static_cast<std::size_t>(written) < sizeof(buffer)
                ? static_cast<std::size_t>(written) : sizeof(buffer) - 1U;
            device_shell_fake::state().serial_log.append(buffer, count);
        }
        return written;
    }

    void flush() noexcept {}
    void setRxBufferSize(std::size_t) noexcept {}
    std::size_t write(const std::uint8_t *, std::size_t size) noexcept { return size; }

    // Host-side input, so tests can drive the analyzer link the way the web
    // analyzer does: bytes arrive on the console port and loop() consumes
    // them. Only the console instance carries input; the GPS port stays mute.
    void pushInput(const std::string &line)
    {
        if(!console_) return;
        pending_ += line;
        pending_.push_back('\n');
    }
    int available() const noexcept { return pending_.empty() ? 0 : 1; }
    int read() noexcept
    {
        if(pending_.empty()) return -1;
        const char value = pending_.front();
        pending_.erase(pending_.begin());
        return static_cast<unsigned char>(value);
    }

  private:
    bool console_ = false;
    std::string pending_{};
};

inline HardwareSerial Serial{true};
inline HardwareSerial Serial1{false};
