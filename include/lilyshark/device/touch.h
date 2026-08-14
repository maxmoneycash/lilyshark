#pragma once

#include <cstdint>

#if defined(LILYSHARK_DEVICE)
class TwoWire;
#endif

namespace lilyshark {

inline constexpr std::uint16_t kTDeckTouchWidth = 320;
inline constexpr std::uint16_t kTDeckTouchHeight = 240;

struct TouchPoint {
    std::uint16_t x = 0;
    std::uint16_t y = 0;
    std::uint16_t size = 0;
    std::uint8_t track_id = 0;
    bool pressed = false;
};

// The original T-Deck reference firmware configures its GT911 with swap XY and
// mirror Y for the ST7789 at rotation 1. This pure transform also clamps the
// controller's inclusive edge coordinates to LVGL's zero-based bounds.
TouchPoint mapTDeckTouch(std::uint16_t raw_x, std::uint16_t raw_y,
                          std::uint16_t size = 0, std::uint8_t track_id = 0) noexcept;

enum class TouchStatus : std::uint8_t {
    Uninitialized,
    Ready,
    NotPresent,
    IoError,
};

#if defined(LILYSHARK_DEVICE)

// Direct GT911 driver for the original LILYGO T-Deck. The caller owns and
// initializes the shared Wire bus. poll() performs one bounded controller
// transaction; read() exposes the last state in the shape LVGL expects.
class TDeckTouch
{
  public:
    bool begin(TwoWire &wire) noexcept;
    bool poll() noexcept;
    bool read(TouchPoint &point) const noexcept;

    TouchStatus status() const noexcept { return status_; }
    bool present() const noexcept { return address_ != 0; }
    bool pressed() const noexcept { return point_.pressed; }
    std::uint8_t address() const noexcept { return address_; }
    std::uint8_t touchCount() const noexcept { return touch_count_; }
    const TouchPoint &point() const noexcept { return point_; }

  private:
    bool probe(std::uint8_t address) noexcept;
    bool readRegisters(std::uint16_t first_register, std::uint8_t *data,
                       std::uint8_t length) noexcept;
    bool writeRegister(std::uint16_t register_address, std::uint8_t value) noexcept;

    TwoWire *wire_ = nullptr;
    TouchPoint point_{};
    TouchStatus status_ = TouchStatus::Uninitialized;
    std::uint8_t address_ = 0;
    std::uint8_t touch_count_ = 0;
};

#endif

} // namespace lilyshark
