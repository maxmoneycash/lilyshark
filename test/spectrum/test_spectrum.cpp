#include "lilyshark/core/spectrum.h"

#include <cassert>
#include <cstdio>
#include <limits>

namespace {

using namespace lilyshark;

void testInclusiveSweepPlan()
{
    SpectrumSweepRequest request{};
    request.start_frequency_hz = 902000000;
    request.end_frequency_hz = 928000000;
    request.step_hz = 200000;
    assert(spectrumSweepPointCount(request) == 131);
    assert(spectrumSweepFrequency(request, 0) == 902000000);
    assert(spectrumSweepFrequency(request, 129) == 927800000);
    assert(spectrumSweepFrequency(request, 130) == 928000000);
    assert(spectrumSweepFrequency(request, 131) == 0);

    request.end_frequency_hz = 902450000;
    assert(spectrumSweepPointCount(request) == 3);
    assert(spectrumSweepFrequency(request, 2) == 902400000);
}

void testInvalidAndOversizedPlans()
{
    SpectrumSweepRequest request{};
    request.step_hz = 0;
    assert(spectrumSweepPointCount(request) == 0);
    request.step_hz = 1;
    assert(spectrumSweepPointCount(request) == 0);

    request = SpectrumSweepRequest{};
    request.start_frequency_hz = 930000000;
    request.end_frequency_hz = 902000000;
    assert(spectrumSweepPointCount(request) == 0);

    request = SpectrumSweepRequest{};
    request.samples_per_frequency = 0;
    assert(spectrumSweepPointCount(request) == 0);
    request = SpectrumSweepRequest{};
    request.per_frequency_timeout_ms = 0;
    assert(spectrumSweepPointCount(request) == 0);
    request = SpectrumSweepRequest{};
    request.overall_timeout_ms = 0;
    assert(spectrumSweepPointCount(request) == 0);
}

void testBinLabelsAndSummary()
{
    assert(spectrumBinDbmX10(0) == -110);
    assert(spectrumBinDbmX10(1) == -150);
    assert(spectrumBinDbmX10(32) == -1390);
    assert(spectrumBinDbmX10(99) == -1390);

    std::uint16_t counts[kSpectrumPowerBinCount]{};
    counts[2] = 3;
    counts[7] = 8;
    counts[32] = 5;
    const SpectrumBinSummary summary = summarizeSpectrumBins(counts);
    assert(summary.total_samples == 16);
    assert(summary.above_floor_samples == 11);
    assert(summary.modal_count == 8);
    assert(summary.modal_bin == 7);
    assert(summary.strongest_nonzero_bin == 2);
    assert(summary.has_samples);
    assert(summary.has_above_floor_samples);
}

void testFloorOnlyAndEmptySummary()
{
    std::uint16_t counts[kSpectrumPowerBinCount]{};
    SpectrumBinSummary summary = summarizeSpectrumBins(counts);
    assert(!summary.has_samples);
    assert(!summary.has_above_floor_samples);
    assert(summary.total_samples == 0);

    counts[32] = std::numeric_limits<std::uint16_t>::max();
    summary = summarizeSpectrumBins(counts);
    assert(summary.has_samples);
    assert(!summary.has_above_floor_samples);
    assert(summary.strongest_nonzero_bin == 32);
    assert(summary.modal_bin == 32);
    assert(summary.total_samples == std::numeric_limits<std::uint16_t>::max());
}

} // namespace

int main()
{
    testInclusiveSweepPlan();
    testInvalidAndOversizedPlans();
    testBinLabelsAndSummary();
    testFloorOnlyAndEmptySummary();
    std::puts("spectrum model tests passed");
    return 0;
}
