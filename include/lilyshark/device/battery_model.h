#pragma once

#include <cstdint>

namespace lilyshark {

// A LiPo percentage inferred from terminal voltage is inherently approximate:
// load, temperature, cell age, and ADC calibration all affect the reading.
struct BatteryEstimate {
    std::uint32_t adc_millivolts = 0;
    std::uint32_t voltage_millivolts = 0;
    std::uint8_t approximate_percent = 0;
    bool present = false;
};

std::uint32_t scaleBatteryAdcMillivolts(std::uint32_t adc_millivolts,
                                       float divider_multiplier) noexcept;
std::uint8_t approximateLipoPercent(std::uint32_t battery_millivolts) noexcept;
BatteryEstimate estimateBattery(std::uint32_t adc_millivolts,
                                float divider_multiplier) noexcept;

} // namespace lilyshark
