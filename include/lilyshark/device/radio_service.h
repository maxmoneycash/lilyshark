#pragma once

#include "lilyshark/core/radio_profile.h"
#include "lilyshark/core/raw_frame.h"
#include "lilyshark/core/spectrum.h"

#include <cstdint>

#if defined(LILYSHARK_DEVICE)
#include <RadioLib.h>
#endif

namespace lilyshark {

struct RadioStatus {
    bool initialized = false;
    bool receiving = false;
    std::int16_t last_error = 0;
    std::uint32_t received_frames = 0;
    std::uint32_t crc_errors = 0;
    std::uint32_t receive_errors = 0;
    std::uint32_t profile_switch_failures = 0;
    std::uint32_t last_frame_ms = 0;
    std::int16_t last_profile_error = 0;
};

struct LoRaRxMetadata {
    std::uint8_t coding_rate_denominator = 0;
    CrcStatus crc = CrcStatus::Unknown;
};

constexpr std::uint8_t sx126xLoRaCodingRateDenominator(std::uint8_t header_code) noexcept
{
    switch (header_code) {
    case 0:
        return 0;
    case 1:
    case 5:
        return 5;
    case 2:
    case 6:
        return 6;
    case 3:
        return 7;
    case 4:
    case 7:
        return 8;
    default:
        return 0;
    }
}

constexpr std::uint32_t resolveLoRaRxPresentFields(std::uint32_t present_fields,
                                                   const LoRaRxMetadata &metadata) noexcept
{
    const std::uint32_t coding_rate_field = static_cast<std::uint32_t>(RfFieldCodingRate);
    const std::uint32_t airtime_field = static_cast<std::uint32_t>(RfFieldAirtime);
    return metadata.coding_rate_denominator == 0U
               ? present_fields & ~(coding_rate_field | airtime_field)
               : present_fields | coding_rate_field | airtime_field;
}

constexpr LoRaRxMetadata resolveLoRaRxMetadata(bool header_info_available,
                                                std::uint8_t header_coding_rate,
                                                bool header_has_crc,
                                                std::uint8_t configured_coding_rate,
                                                bool configured_crc_enabled,
                                                bool crc_failed) noexcept
{
    LoRaRxMetadata metadata{};
    metadata.coding_rate_denominator =
        header_info_available ? sx126xLoRaCodingRateDenominator(header_coding_rate)
                              : configured_coding_rate;
    const bool crc_present = header_info_available ? header_has_crc : configured_crc_enabled;
    metadata.crc = crc_failed ? CrcStatus::Invalid
                              : (crc_present ? CrcStatus::Valid : CrcStatus::NotPresent);
    return metadata;
}

constexpr LoRaRxMetadata unavailableExplicitLoRaRxMetadata(bool crc_failed) noexcept
{
    return LoRaRxMetadata{0U, crc_failed ? CrcStatus::Invalid : CrcStatus::Unknown};
}

class RadioRecoverySchedule
{
  public:
    void schedule(std::uint32_t now_ms, std::uint32_t delay_ms) noexcept
    {
        retry_at_ms_ = now_ms + delay_ms;
        scheduled_ = true;
    }

    void clear() noexcept
    {
        retry_at_ms_ = 0;
        scheduled_ = false;
    }

    bool shouldAttempt(std::uint32_t now_ms, bool spectrum_active) const noexcept
    {
        return scheduled_ && !spectrum_active &&
               static_cast<std::int32_t>(now_ms - retry_at_ms_) >= 0;
    }

  private:
    std::uint32_t retry_at_ms_ = 0;
    bool scheduled_ = false;
};

#if defined(LILYSHARK_DEVICE)

class TDeckRadioService
{
  public:
    using FrameHandler = void (*)(const RawFrame &frame, const RadioProfile &profile, void *context);

    TDeckRadioService() noexcept;

    bool begin(const RadioProfile &profile, FrameHandler handler, void *context) noexcept;
    bool setProfile(const RadioProfile &profile) noexcept;
    bool transmit(const std::uint8_t *data, std::size_t length) noexcept;

    // Experimental SX1262 facility. An accepted sweep temporarily suspends
    // packet reception and advances only when poll() is called. Completion,
    // cancellation, error, and timeout all perform a full modem reconfigure
    // before the terminal state is exposed. Results may be partial on failure.
    bool startSpectrumSweep(const SpectrumSweepRequest &request) noexcept;
    void cancelSpectrumSweep() noexcept;
    void clearSpectrumResult() noexcept;
    void poll() noexcept;
    void stop() noexcept;

    const RadioProfile &activeProfile() const noexcept { return profile_; }
    const RadioStatus &status() const noexcept { return status_; }
    const SpectrumSweepStatus &spectrumStatus() const noexcept { return spectrum_status_; }
    const SpectrumSweepResult &spectrumResult() const noexcept { return spectrum_result_; }

  private:
    static void onDio1() noexcept;
    static std::uint8_t radioLibSyncWord(std::uint16_t profile_sync_word) noexcept;
    bool configure(const RadioProfile &profile) noexcept;
    void resumeReceive() noexcept;
    void consumeInterrupt() noexcept;
    void pollSpectrumSweep() noexcept;
    bool prepareSpectrumSweep() noexcept;
    bool startSpectrumPoint() noexcept;
    void beginSpectrumRestoration(SpectrumSweepState terminal_state,
                                  SpectrumSweepFailure failure,
                                  std::int16_t radio_error,
                                  bool timed_out = false) noexcept;
    void restoreAfterSpectrumSweep() noexcept;

    Module module_;
    SX1262 radio_;
    RadioProfile profile_{};
    FrameHandler handler_ = nullptr;
    void *handler_context_ = nullptr;
    RadioStatus status_{};
    SpectrumSweepStatus spectrum_status_{};
    SpectrumSweepResult spectrum_result_{};
    SpectrumSweepState spectrum_terminal_state_ = SpectrumSweepState::Idle;
    std::uint32_t spectrum_point_started_ms_ = 0;
    std::uint32_t spectrum_generation_ = 0;
    std::uint32_t next_receive_retry_ms_ = 0;
    RadioRecoverySchedule configure_recovery_{};

    static TDeckRadioService *instance_;
    static volatile bool dio1_pending_;
};

#endif

} // namespace lilyshark
