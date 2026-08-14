#include "lilyshark/device/tdeck_display_init.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

using lilyshark::TDeckDisplayInitAction;
using lilyshark::TDeckDisplayInitStep;

constexpr TDeckDisplayInitStep command(std::uint8_t value)
{
    return {TDeckDisplayInitAction::Command, value};
}

constexpr TDeckDisplayInitStep data(std::uint8_t value)
{
    return {TDeckDisplayInitAction::Data, value};
}

constexpr TDeckDisplayInitStep wait(std::uint16_t milliseconds)
{
    return {TDeckDisplayInitAction::DelayMs, milliseconds};
}

// Golden expansion of LilyGO T-Deck commit 274ddaa, INIT_SEQUENCE_2 branch.
constexpr TDeckDisplayInitStep kExpectedVendorSequence[] = {
    command(0x11), wait(120), command(0x13), command(0x36), data(0x00),
    command(0x3a), data(0x55), wait(10), command(0xb2), data(0x0c),
    data(0x0c), data(0x00), data(0x33), data(0x33), command(0xb7), data(0x75),
    command(0xbb), data(0x1a), command(0xc0), data(0x2c), command(0xc2),
    data(0x01), command(0xc3), data(0x13), command(0xc4), data(0x20),
    command(0xc6), data(0x0f), command(0xd0), data(0xa4), data(0xa1),
    command(0xe0), data(0xd0), data(0x0d), data(0x14), data(0x0d), data(0x0d),
    data(0x09), data(0x38), data(0x44), data(0x4e), data(0x3a), data(0x17),
    data(0x18), data(0x2f), data(0x30), command(0xe1), data(0xd0), data(0x09),
    data(0x0f), data(0x08), data(0x07), data(0x14), data(0x37), data(0x44),
    data(0x4d), data(0x38), data(0x15), data(0x16), data(0x2c), data(0x3e),
    command(0x21), command(0x2a), data(0x00), data(0x00), data(0x00), data(0xef),
    command(0x2b), data(0x00), data(0x00), data(0x01), data(0x3f), wait(120),
    command(0x29), wait(120),
};

void testPinnedVendorSequenceIsExact()
{
    static_assert(std::size(kExpectedVendorSequence) ==
                  lilyshark::kTDeckDisplayVendorInitSequenceSize);
    assert(std::strcmp(lilyshark::kTDeckDisplayInitSourceCommit,
                       "274ddaa0d04fcf8acd43643f52d81c565326c984") == 0);

    for(std::size_t index = 0; index < std::size(kExpectedVendorSequence); ++index) {
        assert(lilyshark::kTDeckDisplayVendorInitSequence[index].action ==
               kExpectedVendorSequence[index].action);
        assert(lilyshark::kTDeckDisplayVendorInitSequence[index].value ==
               kExpectedVendorSequence[index].value);
    }
}

void testOwnedSoftwareResetPreamble()
{
    static_assert(lilyshark::kTDeckDisplaySoftwareResetCommand == 0x01);
    static_assert(lilyshark::kTDeckDisplaySoftwareResetDelayMs >= 150);
}

} // namespace

int main()
{
    testPinnedVendorSequenceIsExact();
    testOwnedSoftwareResetPreamble();
    std::puts("T-Deck display initialization tests passed");
    return 0;
}
