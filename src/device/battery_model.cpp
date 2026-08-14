#include "lilyshark/device/battery_model.h"

#include <cstddef>

namespace lilyshark {
namespace {

struct VoltagePoint {
    std::uint16_t millivolts;
    std::uint8_t percent;
};

// Approximate unloaded single-cell LiPo discharge curve. Linear interpolation
// is used between points; callers should present the result as an estimate.
constexpr VoltagePoint discharge_curve[] = {
    {3300, 0},  {3500, 5},  {3600, 10}, {3700, 20}, {3750, 30}, {3800, 40},
    {3850, 50}, {3900, 60}, {3950, 70}, {4000, 80}, {4100, 90}, {4200, 100},
};

constexpr std::uint32_t minimum_present_millivolts = 2500;
constexpr std::uint32_t maximum_plausible_millivolts = 5000;

} // namespace

std::uint32_t scaleBatteryAdcMillivolts(std::uint32_t adc_millivolts,
                                       float divider_multiplier) noexcept
{
    if (divider_multiplier <= 0.0F) {
        return 0;
    }
    return static_cast<std::uint32_t>(static_cast<float>(adc_millivolts) * divider_multiplier + 0.5F);
}

std::uint8_t approximateLipoPercent(std::uint32_t battery_millivolts) noexcept
{
    if (battery_millivolts <= discharge_curve[0].millivolts) {
        return discharge_curve[0].percent;
    }

    constexpr std::size_t point_count = sizeof(discharge_curve) / sizeof(discharge_curve[0]);
    for (std::size_t index = 1; index < point_count; ++index) {
        const VoltagePoint upper = discharge_curve[index];
        if (battery_millivolts <= upper.millivolts) {
            const VoltagePoint lower = discharge_curve[index - 1];
            const std::uint32_t voltage_span = upper.millivolts - lower.millivolts;
            const std::uint32_t percent_span = upper.percent - lower.percent;
            const std::uint32_t offset = battery_millivolts - lower.millivolts;
            return static_cast<std::uint8_t>(lower.percent +
                                             ((offset * percent_span + voltage_span / 2U) / voltage_span));
        }
    }

    return discharge_curve[point_count - 1].percent;
}

BatteryEstimate estimateBattery(std::uint32_t adc_millivolts,
                                float divider_multiplier) noexcept
{
    BatteryEstimate estimate{};
    estimate.adc_millivolts = adc_millivolts;
    estimate.voltage_millivolts = scaleBatteryAdcMillivolts(adc_millivolts, divider_multiplier);
    estimate.present = estimate.voltage_millivolts >= minimum_present_millivolts &&
                       estimate.voltage_millivolts <= maximum_plausible_millivolts;
    if (estimate.present) {
        estimate.approximate_percent = approximateLipoPercent(estimate.voltage_millivolts);
    }
    return estimate;
}

} // namespace lilyshark
