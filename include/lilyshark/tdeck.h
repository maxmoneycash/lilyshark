#pragma once

#include <cstdint>

namespace lilyshark::tdeck {

// Original LILYGO T-Deck hardware map. TFT, SD, and SX1262 share this SPI bus.
inline constexpr uint8_t power_enable_pin = 10;
inline constexpr uint8_t spi_sck_pin = 40;
inline constexpr uint8_t spi_mosi_pin = 41;
inline constexpr uint8_t spi_miso_pin = 38;

inline constexpr uint8_t display_cs_pin = 12;
inline constexpr uint8_t display_dc_pin = 11;
inline constexpr int8_t display_reset_pin = -1;
inline constexpr uint8_t backlight_pin = 42;

inline constexpr uint8_t sd_cs_pin = 39;

inline constexpr uint8_t radio_cs_pin = 9;
inline constexpr uint8_t radio_busy_pin = 13;
inline constexpr uint8_t radio_reset_pin = 17;
inline constexpr uint8_t radio_dio1_pin = 45;
inline constexpr float radio_tcxo_voltage = 1.8F;

inline constexpr uint8_t i2c_sda_pin = 18;
inline constexpr uint8_t i2c_scl_pin = 8;
inline constexpr uint32_t i2c_frequency_hz = 400000;
inline constexpr uint8_t keyboard_address = 0x55;
inline constexpr uint8_t keyboard_interrupt_pin = 46;
inline constexpr uint8_t touch_interrupt_pin = 16;
inline constexpr uint8_t touch_primary_address = 0x5D;
inline constexpr uint8_t touch_fallback_address = 0x14;

inline constexpr uint8_t trackball_up_pin = 3;
inline constexpr uint8_t trackball_down_pin = 15;
inline constexpr uint8_t trackball_left_pin = 1;
inline constexpr uint8_t trackball_right_pin = 2;
inline constexpr uint8_t trackball_press_pin = 0;

// The MAX98357A class-D amplifier driving the speaker.
inline constexpr uint8_t i2s_ws_pin = 5;
inline constexpr uint8_t i2s_dout_pin = 6;
inline constexpr uint8_t i2s_bck_pin = 7;

inline constexpr uint8_t battery_adc_pin = 4;
// The official T-Deck schematic and factory test use an equal divider.
inline constexpr float battery_divider_multiplier = 2.0F;

inline constexpr uint8_t gps_rx_pin = 44;
inline constexpr uint8_t gps_tx_pin = 43;
inline constexpr uint32_t gps_baud = 9600;

} // namespace lilyshark::tdeck
