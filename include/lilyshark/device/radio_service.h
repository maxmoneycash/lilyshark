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

#if defined(LILYSHARK_DEVICE)

class TDeckRadioService
{
  public:
    using FrameHandler = void (*)(const RawFrame &frame, const RadioProfile &profile, void *context);

    TDeckRadioService() noexcept;

    bool begin(const RadioProfile &profile, FrameHandler handler, void *context) noexcept;
    bool setProfile(const RadioProfile &profile) noexcept;

    // Experimental SX1262 facility. An accepted sweep temporarily suspends
    // packet reception and advances only when poll() is called. Completion,
    // cancellation, error, and timeout all perform a full modem reconfigure
    // before the terminal state is exposed. Results may be partial on failure.
    bool startSpectrumSweep(const SpectrumSweepRequest &request) noexcept;
    void cancelSpectrumSweep() noexcept;
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

    static TDeckRadioService *instance_;
    static volatile bool dio1_pending_;
};

#endif

} // namespace lilyshark
