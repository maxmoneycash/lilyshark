#include "lilyshark/device/simulate_source.h"

#include "lilyshark/shelby/shelby_pointer.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;

void testDefaultOriginIsUnknown()
{
    const RawFrame frame{};
    assert(frame.rf.origin == FrameOrigin::Unknown);
}

void testCadenceAndSyntheticProvenance()
{
    device::SimulateSource source{};
    assert(!source.due(device::kSimulateFrameIntervalMs - 1U));
    assert(source.due(device::kSimulateFrameIntervalMs));

    RawFrame frame{};
    for (std::uint32_t sequence = 0; sequence < 14U; ++sequence) {
        const std::uint32_t now_ms = (sequence + 1U) * device::kSimulateFrameIntervalMs;
        frame = source.next(now_ms, 906875000U, 250000U, 11U, 5U, 17U);
        assert(frame.rf.origin == FrameOrigin::Synthetic);
        assert(frame.rf.timestamp_us == static_cast<std::uint64_t>(now_ms) * 1000ULL);
        assert(frame.rf.center_frequency_hz == 906875000U);
        assert(frame.rf.bandwidth_hz == 250000U);
        assert(frame.rf.spreading_factor == 11U);
        assert(frame.rf.coding_rate_denominator == 5U);
        assert(frame.rf.profile_id == 17U);
        assert(frame.captured_length > 0U);
        assert(frame.original_length == frame.captured_length);

        if (device::SimulateSource::carriesPointer(sequence)) {
            assert(findShelbyPointer(frame.bytes, frame.captured_length) == 16U);
        }
    }

    assert(source.emitted() == 14U);
    assert(!source.due(14U * device::kSimulateFrameIntervalMs));
    assert(source.due(15U * device::kSimulateFrameIntervalMs));
}

} // namespace

int main()
{
    testDefaultOriginIsUnknown();
    testCadenceAndSyntheticProvenance();
    std::puts("simulate source tests passed");
    return 0;
}
