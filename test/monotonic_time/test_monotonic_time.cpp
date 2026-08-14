#include "lilyshark/core/monotonic_time.h"

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <limits>

namespace {

void testOrdinaryDeadline()
{
    assert(!lilyshark::monotonicDeadlineReached(999U, 1000U));
    assert(lilyshark::monotonicDeadlineReached(1000U, 1000U));
    assert(lilyshark::monotonicDeadlineReached(1001U, 1000U));
}

void testDeadlineAcrossMillisWrap()
{
    constexpr std::uint32_t before_wrap =
        std::numeric_limits<std::uint32_t>::max() - 7U;
    constexpr std::uint32_t deadline = before_wrap + 16U;

    assert(!lilyshark::monotonicDeadlineReached(before_wrap, deadline));
    assert(!lilyshark::monotonicDeadlineReached(7U, deadline));
    assert(lilyshark::monotonicDeadlineReached(8U, deadline));
    assert(lilyshark::monotonicDeadlineReached(9U, deadline));
}

} // namespace

int main()
{
    testOrdinaryDeadline();
    testDeadlineAcrossMillisWrap();
    std::puts("monotonic time tests passed");
    return 0;
}
