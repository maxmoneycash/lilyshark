#pragma once

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kSpectrumPowerBinCount = 33;
inline constexpr std::size_t kMaxSpectrumSweepPoints = 160;
// RadioLib documents bin zero as -11 dBm and subsequent bins in -4 dBm
// increments. Bin 32 is the catch-all floor at -139 dBm and below.
inline constexpr std::int16_t kSpectrumFirstBinDbmX10 = -110;
inline constexpr std::int16_t kSpectrumBinWidthDbmX10 = 40;

struct SpectrumSweepRequest {
    std::uint32_t start_frequency_hz = 902000000;
    std::uint32_t end_frequency_hz = 928000000;
    std::uint32_t step_hz = 200000;
    std::uint16_t samples_per_frequency = 1024;
    std::uint32_t per_frequency_timeout_ms = 250;
    std::uint32_t overall_timeout_ms = 60000;
};

struct SpectrumBinSummary {
    std::uint32_t total_samples = 0;
    std::uint32_t above_floor_samples = 0;
    std::uint16_t modal_count = 0;
    std::uint8_t modal_bin = 0;
    std::uint8_t strongest_nonzero_bin = static_cast<std::uint8_t>(kSpectrumPowerBinCount - 1);
    bool has_samples = false;
    bool has_above_floor_samples = false;
};

struct SpectrumPoint {
    std::uint32_t frequency_hz = 0;
    std::uint16_t counts[kSpectrumPowerBinCount]{};
};

struct SpectrumSweepResult {
    SpectrumSweepRequest request{};
    SpectrumPoint points[kMaxSpectrumSweepPoints]{};
    // Valid prefix of points. A failed or cancelled sweep can retain a useful
    // partial result here after receive mode has been restored.
    std::uint16_t point_count = 0;
    std::uint32_t generation = 0;
};

enum class SpectrumSweepState : std::uint8_t {
    Idle,
    Preparing,
    Scanning,
    Advancing,
    Restoring,
    Complete,
    Failed,
    Cancelled,
};

enum class SpectrumSweepFailure : std::uint8_t {
    None,
    InvalidRequest,
    RadioUnavailable,
    StandbyFailed,
    FskInitializationFailed,
    PatchUploadFailed,
    ScanConfigurationFailed,
    FrequencySetFailed,
    ScanStartFailed,
    ScanReadFailed,
    Timeout,
    Cancelled,
    RestoreFailed,
};

struct SpectrumSweepStatus {
    SpectrumSweepState state = SpectrumSweepState::Idle;
    SpectrumSweepFailure failure = SpectrumSweepFailure::None;
    std::int16_t radio_error = 0;
    std::int16_t restore_error = 0;
    std::uint16_t points_completed = 0;
    std::uint16_t points_total = 0;
    std::uint32_t current_frequency_hz = 0;
    std::uint32_t started_ms = 0;
    std::uint32_t finished_ms = 0;
    bool timed_out = false;
    bool restoration_succeeded = false;

    // Semtech and RadioLib both describe this scan facility as experimental.
    // Lilyshark keeps the flag explicit until recovery is verified on hardware.
    bool experimental_unverified = true;

    bool active() const noexcept
    {
        return state == SpectrumSweepState::Preparing || state == SpectrumSweepState::Scanning ||
               state == SpectrumSweepState::Advancing || state == SpectrumSweepState::Restoring;
    }
};

std::size_t spectrumSweepPointCount(const SpectrumSweepRequest &request) noexcept;
std::uint32_t spectrumSweepFrequency(const SpectrumSweepRequest &request,
                                     std::size_t point_index) noexcept;
std::int16_t spectrumBinDbmX10(std::size_t bin_index) noexcept;
SpectrumBinSummary summarizeSpectrumBins(
    const std::uint16_t (&counts)[kSpectrumPowerBinCount]) noexcept;

} // namespace lilyshark
