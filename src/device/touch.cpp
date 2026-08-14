#include "lilyshark/device/touch.h"

#include <cstddef>

namespace lilyshark {
namespace {

constexpr std::uint16_t clampCoordinate(std::uint16_t value, std::uint16_t maximum) noexcept
{
    return value > maximum ? maximum : value;
}

} // namespace

TouchPoint mapTDeckTouch(std::uint16_t raw_x, std::uint16_t raw_y,
                          std::uint16_t size, std::uint8_t track_id) noexcept
{
    // Matches LILYGO's T-Deck setup: setSwapXY(true), then
    // setMirrorXY(false, true) with max coordinates 320 by 240.
    const std::uint16_t swapped_x = raw_y;
    const std::uint16_t swapped_y = raw_x >= kTDeckTouchHeight
                                        ? 0
                                        : static_cast<std::uint16_t>(kTDeckTouchHeight - raw_x);

    TouchPoint point{};
    point.x = clampCoordinate(swapped_x, kTDeckTouchWidth - 1U);
    point.y = clampCoordinate(swapped_y, kTDeckTouchHeight - 1U);
    point.size = size;
    point.track_id = track_id;
    point.pressed = true;
    return point;
}

} // namespace lilyshark

#if defined(LILYSHARK_DEVICE)

#include "lilyshark/tdeck.h"

#include <Arduino.h>
#include <Wire.h>

namespace lilyshark {
namespace {

constexpr std::uint16_t kGt911ProductId = 0x8140;
constexpr std::uint16_t kGt911PointStatus = 0x814e;
constexpr std::uint16_t kGt911FirstPoint = 0x814f;
constexpr std::uint8_t kGt911DataReady = 0x80;
constexpr std::uint8_t kGt911PointCountMask = 0x0f;
constexpr std::uint8_t kGt911MaximumPoints = 5;
constexpr std::uint8_t kGt911PointBytes = 8;

} // namespace

bool TDeckTouch::begin(TwoWire &wire) noexcept
{
    wire_ = &wire;
    address_ = 0;
    touch_count_ = 0;
    point_ = {};
    status_ = TouchStatus::NotPresent;

    pinMode(tdeck::touch_interrupt_pin, INPUT);
    delay(20);

    constexpr std::uint8_t addresses[] = {
        tdeck::touch_primary_address,
        tdeck::touch_fallback_address,
    };
    for (const std::uint8_t candidate : addresses) {
        if (probe(candidate)) {
            address_ = candidate;
            status_ = TouchStatus::Ready;
            // A bootloader or previous application can leave one report pending.
            // Acknowledge it before LVGL starts consuming fresh reports.
            if (!writeRegister(kGt911PointStatus, 0)) {
                status_ = TouchStatus::IoError;
                return false;
            }
            return true;
        }
    }

    address_ = 0;
    return false;
}

bool TDeckTouch::poll() noexcept
{
    if (wire_ == nullptr || address_ == 0) {
        status_ = wire_ == nullptr ? TouchStatus::Uninitialized : TouchStatus::NotPresent;
        point_.pressed = false;
        touch_count_ = 0;
        return false;
    }

    std::uint8_t report_status = 0;
    if (!readRegisters(kGt911PointStatus, &report_status, 1)) {
        status_ = TouchStatus::IoError;
        point_.pressed = false;
        touch_count_ = 0;
        return false;
    }

    if ((report_status & kGt911DataReady) == 0) {
        status_ = TouchStatus::Ready;
        return true;
    }

    touch_count_ = static_cast<std::uint8_t>(report_status & kGt911PointCountMask);
    bool report_valid = touch_count_ <= kGt911MaximumPoints;
    std::uint8_t point_bytes[kGt911PointBytes]{};
    if (report_valid && touch_count_ > 0) {
        report_valid = readRegisters(kGt911FirstPoint, point_bytes, sizeof(point_bytes));
    }

    // GT911 requires the buffer status byte to be cleared after every ready
    // report, including releases and malformed reports.
    const bool cleared = writeRegister(kGt911PointStatus, 0);
    if (!report_valid || !cleared) {
        status_ = TouchStatus::IoError;
        point_.pressed = false;
        touch_count_ = 0;
        return false;
    }

    if (touch_count_ == 0) {
        point_.pressed = false;
        status_ = TouchStatus::Ready;
        return true;
    }

    const std::uint16_t raw_x = static_cast<std::uint16_t>(point_bytes[1]) |
                                (static_cast<std::uint16_t>(point_bytes[2]) << 8U);
    const std::uint16_t raw_y = static_cast<std::uint16_t>(point_bytes[3]) |
                                (static_cast<std::uint16_t>(point_bytes[4]) << 8U);
    const std::uint16_t size = static_cast<std::uint16_t>(point_bytes[5]) |
                               (static_cast<std::uint16_t>(point_bytes[6]) << 8U);
    point_ = mapTDeckTouch(raw_x, raw_y, size, point_bytes[0]);
    status_ = TouchStatus::Ready;
    return true;
}

bool TDeckTouch::read(TouchPoint &point) const noexcept
{
    point = point_;
    return point_.pressed;
}

bool TDeckTouch::probe(std::uint8_t address) noexcept
{
    address_ = address;
    std::uint8_t product_id[4]{};
    if (!readRegisters(kGt911ProductId, product_id, sizeof(product_id))) {
        return false;
    }
    return product_id[0] == '9' && product_id[1] == '1' && product_id[2] == '1';
}

bool TDeckTouch::readRegisters(std::uint16_t first_register, std::uint8_t *data,
                               std::uint8_t length) noexcept
{
    if (wire_ == nullptr || address_ == 0 || data == nullptr || length == 0) {
        return false;
    }

    wire_->beginTransmission(address_);
    wire_->write(static_cast<std::uint8_t>(first_register >> 8U));
    wire_->write(static_cast<std::uint8_t>(first_register & 0xffU));
    if (wire_->endTransmission(false) != 0) {
        return false;
    }

    const std::size_t received = wire_->requestFrom(
        address_, static_cast<std::size_t>(length), true);
    if (received != length) {
        while (wire_->available() > 0) {
            (void)wire_->read();
        }
        return false;
    }
    for (std::uint8_t index = 0; index < length; ++index) {
        if (wire_->available() <= 0) {
            return false;
        }
        data[index] = static_cast<std::uint8_t>(wire_->read());
    }
    return true;
}

bool TDeckTouch::writeRegister(std::uint16_t register_address, std::uint8_t value) noexcept
{
    if (wire_ == nullptr || address_ == 0) {
        return false;
    }
    wire_->beginTransmission(address_);
    wire_->write(static_cast<std::uint8_t>(register_address >> 8U));
    wire_->write(static_cast<std::uint8_t>(register_address & 0xffU));
    wire_->write(value);
    return wire_->endTransmission(true) == 0;
}

} // namespace lilyshark

#endif
