#pragma once

#include "device_shell_fake.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <string>

inline constexpr std::uint16_t TFT_BLACK = 0;

class TFT_eSPI {
  public:
    void begin() { device_shell_fake::record("display.begin"); }

    void writecommand(std::uint8_t command)
    {
        device_shell_fake::state().display_commands.push_back(command);
        device_shell_fake::record("display.command." + std::to_string(command));
    }

    void writedata(std::uint8_t data)
    {
        device_shell_fake::state().display_data.push_back(data);
        device_shell_fake::record("display.data." + std::to_string(data));
    }

    void setRotation(std::uint8_t rotation)
    {
        device_shell_fake::record("display.rotation." + std::to_string(rotation));
    }

    void fillScreen(std::uint16_t color)
    {
        device_shell_fake::state().framebuffer.fill(color);
        device_shell_fake::record("display.fill." + std::to_string(color));
    }

    void startWrite() noexcept {}

    void setAddrWindow(std::int32_t x, std::int32_t y,
                       std::uint32_t width, std::uint32_t height) noexcept
    {
        auto &fake = device_shell_fake::state();
        fake.display_window_x = x < 0 ? 0U : static_cast<std::uint32_t>(x);
        fake.display_window_y = y < 0 ? 0U : static_cast<std::uint32_t>(y);
        fake.display_window_width = width;
        fake.display_window_height = height;
    }

    void pushColors(std::uint16_t *pixels, std::uint32_t count, bool) noexcept
    {
        auto &fake = device_shell_fake::state();
        if(pixels == nullptr || fake.display_window_width == 0U) return;
        const std::uint32_t maximum = fake.display_window_width * fake.display_window_height;
        count = std::min(count, maximum);
        for(std::uint32_t index = 0; index < count; ++index) {
            const std::uint32_t x = fake.display_window_x + index % fake.display_window_width;
            const std::uint32_t y = fake.display_window_y + index / fake.display_window_width;
            if(x < 320U && y < 240U) fake.framebuffer[y * 320U + x] = pixels[index];
        }
        ++fake.display_flushes;
        device_shell_fake::record("display.flush");
    }

    void endWrite() noexcept {}

    void readRect(std::int32_t x, std::int32_t y, std::uint32_t width,
                  std::uint32_t height, std::uint16_t *destination) const noexcept
    {
        if(destination == nullptr) return;
        const auto &framebuffer = device_shell_fake::state().framebuffer;
        for(std::uint32_t row = 0; row < height; ++row) {
            for(std::uint32_t column = 0; column < width; ++column) {
                const std::uint32_t source_x = static_cast<std::uint32_t>(x) + column;
                const std::uint32_t source_y = static_cast<std::uint32_t>(y) + row;
                const std::uint16_t pixel = source_x < 320U && source_y < 240U
                    ? framebuffer[source_y * 320U + source_x] : 0U;
                destination[row * width + column] =
                    static_cast<std::uint16_t>((pixel << 8U) | (pixel >> 8U));
            }
        }
    }
};
