#include "lilyshark/core/spectrum.h"

#include <limits>

namespace lilyshark {

std::size_t spectrumSweepPointCount(const SpectrumSweepRequest &request) noexcept
{
    if (request.start_frequency_hz == 0 || request.end_frequency_hz < request.start_frequency_hz ||
        request.step_hz == 0 || request.samples_per_frequency == 0 ||
        request.per_frequency_timeout_ms == 0 || request.overall_timeout_ms == 0) {
        return 0;
    }

    const std::uint64_t span = static_cast<std::uint64_t>(request.end_frequency_hz) -
                               static_cast<std::uint64_t>(request.start_frequency_hz);
    const std::uint64_t count = span / request.step_hz + 1U;
    if (count == 0 || count > kMaxSpectrumSweepPoints) {
        return 0;
    }
    return static_cast<std::size_t>(count);
}

std::uint32_t spectrumSweepFrequency(const SpectrumSweepRequest &request,
                                     std::size_t point_index) noexcept
{
    const std::size_t count = spectrumSweepPointCount(request);
    if (count == 0 || point_index >= count) {
        return 0;
    }

    const std::uint64_t frequency = static_cast<std::uint64_t>(request.start_frequency_hz) +
                                    static_cast<std::uint64_t>(request.step_hz) * point_index;
    if (frequency > request.end_frequency_hz || frequency > std::numeric_limits<std::uint32_t>::max()) {
        return 0;
    }
    return static_cast<std::uint32_t>(frequency);
}

std::int16_t spectrumBinDbmX10(std::size_t bin_index) noexcept
{
    if (bin_index >= kSpectrumPowerBinCount) {
        bin_index = kSpectrumPowerBinCount - 1;
    }
    return static_cast<std::int16_t>(kSpectrumFirstBinDbmX10 -
                                     static_cast<std::int16_t>(bin_index * kSpectrumBinWidthDbmX10));
}

SpectrumBinSummary summarizeSpectrumBins(
    const std::uint16_t (&counts)[kSpectrumPowerBinCount]) noexcept
{
    SpectrumBinSummary summary{};
    summary.strongest_nonzero_bin = static_cast<std::uint8_t>(kSpectrumPowerBinCount - 1);

    for (std::size_t index = 0; index < kSpectrumPowerBinCount; ++index) {
        const std::uint16_t count = counts[index];
        summary.total_samples += count;
        if (index + 1U < kSpectrumPowerBinCount) {
            summary.above_floor_samples += count;
        }
        if (count > summary.modal_count) {
            summary.modal_count = count;
            summary.modal_bin = static_cast<std::uint8_t>(index);
        }
        if (!summary.has_samples && count != 0) {
            summary.strongest_nonzero_bin = static_cast<std::uint8_t>(index);
            summary.has_samples = true;
        }
    }

    summary.has_above_floor_samples = summary.above_floor_samples != 0;
    return summary;
}

} // namespace lilyshark
