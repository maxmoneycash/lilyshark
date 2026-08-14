#include "lilyshark/device/battery_model.h"

#include <cassert>
#include <cstdio>

namespace {

using namespace lilyshark;

void testDividerScaling()
{
    assert(scaleBatteryAdcMillivolts(1000, 2.11F) == 2110);
    assert(scaleBatteryAdcMillivolts(1986, 2.11F) == 4190);
    assert(scaleBatteryAdcMillivolts(1000, 0.0F) == 0);
    assert(scaleBatteryAdcMillivolts(1000, -1.0F) == 0);
}

void testApproximateCurve()
{
    assert(approximateLipoPercent(3200) == 0);
    assert(approximateLipoPercent(3300) == 0);
    assert(approximateLipoPercent(3600) == 10);
    assert(approximateLipoPercent(3725) == 25);
    assert(approximateLipoPercent(3850) == 50);
    assert(approximateLipoPercent(4050) == 85);
    assert(approximateLipoPercent(4200) == 100);
    assert(approximateLipoPercent(4400) == 100);
}

void testPresenceAndEstimate()
{
    const BatteryEstimate normal = estimateBattery(1900, 2.11F);
    assert(normal.present);
    assert(normal.voltage_millivolts == 4009);
    assert(normal.approximate_percent == 81);

    const BatteryEstimate disconnected = estimateBattery(0, 2.11F);
    assert(!disconnected.present);
    assert(disconnected.approximate_percent == 0);

    const BatteryEstimate implausibly_high = estimateBattery(3000, 2.11F);
    assert(!implausibly_high.present);
    assert(implausibly_high.approximate_percent == 0);
}

} // namespace

int main()
{
    testDividerScaling();
    testApproximateCurve();
    testPresenceAndEstimate();
    std::puts("hardware status battery model tests passed");
    return 0;
}
