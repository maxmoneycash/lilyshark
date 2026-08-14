#include "lilyshark/device/radio_service.h"

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <limits>

namespace {

using namespace lilyshark;

void testRecoveryWaitsForDeadlineAndSpectrum()
{
    RadioRecoverySchedule recovery{};
    assert(!recovery.shouldAttempt(1000, false));

    recovery.schedule(1000, 500);
    assert(!recovery.shouldAttempt(1499, false));
    assert(!recovery.shouldAttempt(1500, true));
    assert(recovery.shouldAttempt(1500, false));

    recovery.schedule(1500, 500);
    assert(!recovery.shouldAttempt(1500, false));
    assert(recovery.shouldAttempt(2000, false));

    recovery.clear();
    assert(!recovery.shouldAttempt(2000, false));
}

void testRecoveryDeadlineWraps()
{
    RadioRecoverySchedule recovery{};
    const std::uint32_t before_wrap = std::numeric_limits<std::uint32_t>::max() - 499U;
    recovery.schedule(before_wrap, 500);

    assert(!recovery.shouldAttempt(std::numeric_limits<std::uint32_t>::max(), false));
    assert(recovery.shouldAttempt(0, false));
}

} // namespace

int main()
{
    testRecoveryWaitsForDeadlineAndSpectrum();
    testRecoveryDeadlineWraps();
    std::puts("radio recovery model tests passed");
    return 0;
}
