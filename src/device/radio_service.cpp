#include "lilyshark/device/radio_service.h"

#if defined(LILYSHARK_DEVICE)

#include "lilyshark/tdeck.h"

#include <Arduino.h>
#include <SPI.h>
#include <esp_timer.h>
#include <modules/SX126x/patches/SX126x_patch_scan.h>

namespace lilyshark {

namespace {

static_assert(RADIOLIB_SX126X_SPECTRAL_SCAN_RES_SIZE == kSpectrumPowerBinCount,
              "RadioLib SX126x spectrum result size changed");

constexpr std::uint32_t kSx1262MinimumFrequencyHz = 150000000;
constexpr std::uint32_t kSx1262MaximumFrequencyHz = 960000000;
constexpr float kSpectrumReceiverBandwidthKhz = 234.3F;
constexpr std::uint32_t kInterFrequencySettleMs = 5;
constexpr std::uint32_t kReceiveRetryMs = 500;
constexpr std::uint32_t kConfigureRecoveryMs = 1000;

bool deadlineReached(std::uint32_t now, std::uint32_t started, std::uint32_t limit) noexcept
{
    return static_cast<std::uint32_t>(now - started) >= limit;
}

std::uint64_t monotonicMicros() noexcept
{
    return static_cast<std::uint64_t>(esp_timer_get_time());
}

std::uint32_t receivedLoRaAirtimeUs(SX1262 &radio, const RadioProfile &profile,
                                    const LoRaRxMetadata &metadata,
                                    std::size_t packet_length) noexcept
{
    if (metadata.coding_rate_denominator == 0U || profile.bandwidth_hz == 0U) {
        return 0U;
    }

    DataRate_t data_rate{};
    data_rate.lora.spreadingFactor = profile.spreading_factor;
    data_rate.lora.bandwidth = static_cast<float>(profile.bandwidth_hz) / 1000.0F;
    data_rate.lora.codingRate = metadata.coding_rate_denominator;

    PacketConfig_t packet_config{};
    packet_config.lora.preambleLength = profile.preamble_symbols;
    packet_config.lora.implicitHeader = profile.implicit_header;
    packet_config.lora.crcEnabled = metadata.crc == CrcStatus::Valid ||
                                    metadata.crc == CrcStatus::Invalid;
    const float symbol_length_ms =
        static_cast<float>(std::uint32_t{1} << profile.spreading_factor) /
        data_rate.lora.bandwidth;
    packet_config.lora.ldrOptimize = symbol_length_ms >= 16.0F;

    return static_cast<std::uint32_t>(radio.calculateTimeOnAir(
        RADIOLIB_MODEM_LORA, data_rate, packet_config, packet_length));
}

} // namespace

TDeckRadioService *TDeckRadioService::instance_ = nullptr;
volatile bool TDeckRadioService::dio1_pending_ = false;

TDeckRadioService::TDeckRadioService() noexcept
    : module_(tdeck::radio_cs_pin, tdeck::radio_dio1_pin, tdeck::radio_reset_pin,
              tdeck::radio_busy_pin, SPI),
      radio_(&module_)
{
}

std::uint8_t TDeckRadioService::radioLibSyncWord(std::uint16_t value) noexcept
{
    if (value <= 0xffU) {
        return static_cast<std::uint8_t>(value);
    }

    // SX126x register notation (for example private sync 0x1424) stores the
    // logical one-byte sync word in the upper nibble of each register byte.
    const std::uint8_t msb = static_cast<std::uint8_t>(value >> 8U);
    const std::uint8_t lsb = static_cast<std::uint8_t>(value & 0xffU);
    return static_cast<std::uint8_t>((msb & 0xf0U) | ((lsb & 0xf0U) >> 4U));
}

bool TDeckRadioService::begin(const RadioProfile &profile, FrameHandler handler, void *context) noexcept
{
    handler_ = handler;
    handler_context_ = context;
    instance_ = this;
    return configure(profile);
}

bool TDeckRadioService::setProfile(const RadioProfile &profile) noexcept
{
    if (spectrum_status_.active()) {
        return false;
    }
    const RadioProfile previous_profile = profile_;
    radio_.clearDio1Action();
    radio_.standby();
    dio1_pending_ = false;
    if (configure(profile)) {
        status_.last_profile_error = RADIOLIB_ERR_NONE;
        return true;
    }

    const std::int16_t candidate_error = status_.last_error;
    ++status_.profile_switch_failures;
    status_.last_profile_error = candidate_error;

    // A profile change must be transactional. If the candidate cannot enter
    // receive mode, restore the receiver that was working before the switch.
    // configure() deliberately performs a complete modem reset here.
    if (previous_profile.center_frequency_hz != 0) {
        const bool restored = configure(previous_profile);
        status_.last_profile_error = candidate_error;
        if (!restored) {
            // last_error now describes the more important restore failure.
            return false;
        }
    }
    return false;
}

bool TDeckRadioService::startSpectrumSweep(const SpectrumSweepRequest &request) noexcept
{
    if (spectrum_status_.active()) {
        return false;
    }

    const std::size_t point_count = spectrumSweepPointCount(request);
    if (point_count == 0 || request.start_frequency_hz < kSx1262MinimumFrequencyHz ||
        request.end_frequency_hz > kSx1262MaximumFrequencyHz) {
        spectrum_status_ = SpectrumSweepStatus{};
        spectrum_status_.state = SpectrumSweepState::Failed;
        spectrum_status_.failure = SpectrumSweepFailure::InvalidRequest;
        return false;
    }
    if (!status_.initialized) {
        spectrum_status_ = SpectrumSweepStatus{};
        spectrum_status_.state = SpectrumSweepState::Failed;
        spectrum_status_.failure = SpectrumSweepFailure::RadioUnavailable;
        return false;
    }

    spectrum_result_ = SpectrumSweepResult{};
    spectrum_result_.request = request;
    spectrum_result_.generation = spectrum_generation_ + 1U;
    spectrum_status_ = SpectrumSweepStatus{};
    spectrum_status_.state = SpectrumSweepState::Preparing;
    spectrum_status_.points_total = static_cast<std::uint16_t>(point_count);
    spectrum_status_.current_frequency_hz = request.start_frequency_hz;
    spectrum_status_.started_ms = millis();
    spectrum_terminal_state_ = SpectrumSweepState::Idle;
    spectrum_point_started_ms_ = 0;

    // DIO1 is shared with packet receive. No scan call is allowed until the
    // receive ISR has been detached and any pending edge has been discarded.
    radio_.clearDio1Action();
    dio1_pending_ = false;
    status_.receiving = false;
    const std::int16_t state = radio_.standby();
    if (state != RADIOLIB_ERR_NONE) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::StandbyFailed, state);
    }
    return true;
}

void TDeckRadioService::cancelSpectrumSweep() noexcept
{
    if (!spectrum_status_.active()) {
        return;
    }
    if (spectrum_status_.state == SpectrumSweepState::Restoring) {
        spectrum_terminal_state_ = SpectrumSweepState::Cancelled;
        spectrum_status_.failure = SpectrumSweepFailure::Cancelled;
        return;
    }
    beginSpectrumRestoration(SpectrumSweepState::Cancelled,
                             SpectrumSweepFailure::Cancelled, RADIOLIB_ERR_NONE);
}

bool TDeckRadioService::configure(const RadioProfile &profile) noexcept
{
    status_.receiving = false;
    profile_ = profile;

    if (profile.modulation != Modulation::LoRa || profile.center_frequency_hz == 0 ||
        profile.bandwidth_hz == 0 || profile.spreading_factor == 0 ||
        profile.coding_rate_denominator == 0) {
        status_.last_error = RADIOLIB_ERR_INVALID_FREQUENCY;
        status_.initialized = false;
        configure_recovery_.clear();
        return false;
    }

    const float frequency_mhz = static_cast<float>(profile.center_frequency_hz) / 1000000.0F;
    const float bandwidth_khz = static_cast<float>(profile.bandwidth_hz) / 1000.0F;
    std::int16_t state = radio_.begin(frequency_mhz, bandwidth_khz, profile.spreading_factor,
                                      profile.coding_rate_denominator,
                                      radioLibSyncWord(profile.sync_word), profile.tx_power_dbm,
                                      profile.preamble_symbols, tdeck::radio_tcxo_voltage, false);
    if (state == RADIOLIB_ERR_NONE) {
        state = radio_.setDio2AsRfSwitch(true);
    }
    if (state == RADIOLIB_ERR_NONE) {
        state = profile.crc_enabled ? radio_.setCRC(2) : radio_.setCRC(0);
    }
    if (state == RADIOLIB_ERR_NONE) {
        state = profile.implicit_header ? radio_.implicitHeader(kMaxFrameBytes) : radio_.explicitHeader();
    }
    if (state == RADIOLIB_ERR_NONE) {
        state = radio_.invertIQ(profile.inverted_iq);
    }

    status_.last_error = state;
    status_.initialized = state == RADIOLIB_ERR_NONE;
    if (!status_.initialized) {
        configure_recovery_.schedule(millis(), kConfigureRecoveryMs);
        return false;
    }

    configure_recovery_.clear();
    radio_.setDio1Action(onDio1);
    resumeReceive();
    return status_.receiving;
}

void TDeckRadioService::onDio1() noexcept
{
    dio1_pending_ = true;
}

void TDeckRadioService::resumeReceive() noexcept
{
    const std::int16_t state = radio_.startReceive();
    status_.last_error = state;
    status_.receiving = state == RADIOLIB_ERR_NONE;
    if (status_.receiving) {
        next_receive_retry_ms_ = 0;
    } else {
        ++status_.receive_errors;
        next_receive_retry_ms_ = millis() + kReceiveRetryMs;
    }
}

void TDeckRadioService::consumeInterrupt() noexcept
{
    dio1_pending_ = false;
    status_.receiving = false;

    const std::size_t packet_length = radio_.getPacketLength();
    if (packet_length == 0 || packet_length > kMaxFrameBytes) {
        status_.last_error = RADIOLIB_ERR_PACKET_TOO_LONG;
        ++status_.receive_errors;
        resumeReceive();
        return;
    }

    std::uint8_t payload[kMaxFrameBytes]{};
    // readData() clears the IRQ flags. Preserve them first so an invalid
    // explicit header cannot make getLoRaRxHeaderInfo() expose stale register
    // values from an earlier packet.
    const RadioLibIrqFlags_t irq_flags = radio_.getIrqFlags();
    const std::int16_t state = radio_.readData(payload, packet_length);
    status_.last_error = state;

    if (state == RADIOLIB_ERR_NONE || state == RADIOLIB_ERR_CRC_MISMATCH) {
        const bool crc_failed = state == RADIOLIB_ERR_CRC_MISMATCH;
        LoRaRxMetadata rx_metadata{};
        if (profile_.implicit_header) {
            rx_metadata = resolveLoRaRxMetadata(false, 0U, false,
                                                profile_.coding_rate_denominator,
                                                profile_.crc_enabled, crc_failed);
        } else {
            const bool header_valid =
                (irq_flags & RADIOLIB_SX126X_IRQ_HEADER_VALID) != 0U &&
                (irq_flags & RADIOLIB_SX126X_IRQ_HEADER_ERR) == 0U;
            std::uint8_t header_coding_rate = 0;
            bool header_has_crc = false;
            if (header_valid &&
                radio_.getLoRaRxHeaderInfo(&header_coding_rate, &header_has_crc) ==
                    RADIOLIB_ERR_NONE) {
                rx_metadata = resolveLoRaRxMetadata(true, header_coding_rate,
                                                    header_has_crc,
                                                    profile_.coding_rate_denominator,
                                                    profile_.crc_enabled, crc_failed);
            } else {
                rx_metadata = unavailableExplicitLoRaRxMetadata(crc_failed);
            }
        }

        RawFrame frame{};
        frame.assignPayload(payload, packet_length);
        frame.rf.timestamp_us = monotonicMicros();
        frame.rf.present_fields = resolveLoRaRxPresentFields(
            RfFieldTimestamp | RfFieldFrequency | RfFieldBandwidth | RfFieldFrequencyError |
                RfFieldRssi | RfFieldSnr | RfFieldPreamble | RfFieldSyncWord | RfFieldProfile |
                RfFieldSpreadingFactor | RfFieldCodingRate | RfFieldRadioStatus | RfFieldAirtime,
            rx_metadata);
        frame.rf.center_frequency_hz = profile_.center_frequency_hz;
        frame.rf.bandwidth_hz = profile_.bandwidth_hz;
        frame.rf.airtime_us = receivedLoRaAirtimeUs(radio_, profile_, rx_metadata,
                                                    packet_length);
        frame.rf.rssi_dbm_x10 = static_cast<std::int16_t>(radio_.getRSSI() * 10.0F);
        frame.rf.snr_db_x10 = static_cast<std::int16_t>(radio_.getSNR() * 10.0F);
        frame.rf.frequency_error_hz = static_cast<std::int32_t>(radio_.getFrequencyError());
        frame.rf.preamble_symbols = profile_.preamble_symbols;
        frame.rf.sync_word = profile_.sync_word;
        frame.rf.profile_id = profile_.id;
        frame.rf.spreading_factor = profile_.spreading_factor;
        frame.rf.coding_rate_denominator = rx_metadata.coding_rate_denominator;
        frame.rf.radio_status = state;
        frame.rf.modulation = profile_.modulation;
        frame.rf.direction = FrameDirection::Receive;
        frame.rf.crc = rx_metadata.crc;
        frame.rf.origin = FrameOrigin::Radio;
        frame.rf.implicit_header = profile_.implicit_header;
        frame.rf.inverted_iq = profile_.inverted_iq;

        ++status_.received_frames;
        status_.last_frame_ms = millis();
        if (state == RADIOLIB_ERR_CRC_MISMATCH) {
            ++status_.crc_errors;
        }
        // Restart the modem before handing the record to decoders and SD
        // exporters. Those callbacks are synchronous and can take several
        // milliseconds; the SX1262 can keep receiving while the shared SPI
        // bus services a different, deasserted-CS peripheral.
        resumeReceive();
        if (handler_ != nullptr) {
            handler_(frame, profile_, handler_context_);
        }
        return;
    } else {
        ++status_.receive_errors;
    }

    resumeReceive();
}

void TDeckRadioService::poll() noexcept
{
    if (!status_.initialized &&
        configure_recovery_.shouldAttempt(millis(), spectrum_status_.active())) {
        configure(profile_);
        return;
    }
    if (spectrum_status_.active()) {
        pollSpectrumSweep();
        return;
    }
    if (!status_.initialized) {
        return;
    }
    if (!status_.receiving) {
        const std::uint32_t now = millis();
        if (next_receive_retry_ms_ == 0 ||
            static_cast<std::int32_t>(now - next_receive_retry_ms_) >= 0) {
            resumeReceive();
        }
        return;
    }
    if (!dio1_pending_) return;
    consumeInterrupt();
}

bool TDeckRadioService::prepareSpectrumSweep() noexcept
{
    ConfigFSK_t config{};
    config.frequency = static_cast<float>(spectrum_result_.request.start_frequency_hz) / 1000000.0F;
    config.receiverBandwidth = kSpectrumReceiverBandwidthKhz;
    config.power = profile_.tx_power_dbm;
    radio_.tcxoVoltage = tdeck::radio_tcxo_voltage;
    radio_.useRegulatorLDO = false;

    std::int16_t state = radio_.beginFSK(config);
    if (state != RADIOLIB_ERR_NONE) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::FskInitializationFailed, state);
        return false;
    }
    state = radio_.setDio2AsRfSwitch(true);
    if (state != RADIOLIB_ERR_NONE) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::ScanConfigurationFailed, state);
        return false;
    }

    // The Semtech scan patch is volatile and begin() resets the radio, so it
    // must be uploaded for every sweep rather than cached as a software flag.
    state = radio_.uploadPatch(sx126x_patch_scan, sizeof(sx126x_patch_scan));
    if (state != RADIOLIB_ERR_NONE) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::PatchUploadFailed, state);
        return false;
    }
    state = radio_.setRxBandwidth(kSpectrumReceiverBandwidthKhz);
    if (state == RADIOLIB_ERR_NONE) {
        state = radio_.setDataShaping(RADIOLIB_SHAPING_NONE);
    }
    if (state != RADIOLIB_ERR_NONE) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::ScanConfigurationFailed, state);
        return false;
    }

    return startSpectrumPoint();
}

bool TDeckRadioService::startSpectrumPoint() noexcept
{
    const std::size_t index = spectrum_status_.points_completed;
    const std::uint32_t frequency_hz = spectrumSweepFrequency(spectrum_result_.request, index);
    if (frequency_hz == 0) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::InvalidRequest,
                                 RADIOLIB_ERR_INVALID_FREQUENCY);
        return false;
    }

    spectrum_status_.current_frequency_hz = frequency_hz;
    std::int16_t state = radio_.setFrequency(static_cast<float>(frequency_hz) / 1000000.0F);
    if (state != RADIOLIB_ERR_NONE) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::FrequencySetFailed, state);
        return false;
    }
    state = radio_.spectralScanStart(spectrum_result_.request.samples_per_frequency);
    if (state != RADIOLIB_ERR_NONE) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::ScanStartFailed, state);
        return false;
    }
    spectrum_status_.state = SpectrumSweepState::Scanning;
    spectrum_point_started_ms_ = millis();
    return true;
}

void TDeckRadioService::clearSpectrumResult() noexcept
{
    if (spectrum_status_.active()) {
        return;
    }
    spectrum_status_ = SpectrumSweepStatus{};
    spectrum_result_ = SpectrumSweepResult{};
    spectrum_terminal_state_ = SpectrumSweepState::Idle;
    spectrum_point_started_ms_ = 0;
}

void TDeckRadioService::pollSpectrumSweep() noexcept
{
    if (spectrum_status_.state == SpectrumSweepState::Preparing) {
        prepareSpectrumSweep();
        return;
    }
    if (spectrum_status_.state == SpectrumSweepState::Restoring) {
        restoreAfterSpectrumSweep();
        return;
    }
    if (spectrum_status_.state == SpectrumSweepState::Advancing) {
        const std::uint32_t now = millis();
        if (deadlineReached(now, spectrum_status_.started_ms,
                            spectrum_result_.request.overall_timeout_ms)) {
            beginSpectrumRestoration(SpectrumSweepState::Failed,
                                     SpectrumSweepFailure::Timeout,
                                     RADIOLIB_ERR_RANGING_TIMEOUT, true);
        } else if (deadlineReached(now, spectrum_point_started_ms_, kInterFrequencySettleMs)) {
            startSpectrumPoint();
        }
        return;
    }
    if (spectrum_status_.state != SpectrumSweepState::Scanning) {
        return;
    }

    const std::uint32_t now = millis();
    if (deadlineReached(now, spectrum_status_.started_ms,
                        spectrum_result_.request.overall_timeout_ms)) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::Timeout,
                                 RADIOLIB_ERR_RANGING_TIMEOUT, true);
        return;
    }

    const std::int16_t scan_state = radio_.spectralScanGetStatus();
    if (scan_state == RADIOLIB_ERR_NONE) {
        SpectrumPoint &point = spectrum_result_.points[spectrum_status_.points_completed];
        point.frequency_hz = spectrum_status_.current_frequency_hz;
        const std::int16_t read_state = radio_.spectralScanGetResult(point.counts);
        if (read_state != RADIOLIB_ERR_NONE) {
            beginSpectrumRestoration(SpectrumSweepState::Failed,
                                     SpectrumSweepFailure::ScanReadFailed, read_state);
            return;
        }

        ++spectrum_status_.points_completed;
        spectrum_result_.point_count = spectrum_status_.points_completed;
        if (spectrum_status_.points_completed >= spectrum_status_.points_total) {
            beginSpectrumRestoration(SpectrumSweepState::Complete,
                                     SpectrumSweepFailure::None, RADIOLIB_ERR_NONE);
            return;
        }
        // RadioLib's official frequency-sweep example leaves 5 ms between
        // scans. Represent that wait as a state, keeping poll() nonblocking.
        spectrum_status_.state = SpectrumSweepState::Advancing;
        spectrum_point_started_ms_ = now;
        return;
    }

    if (scan_state != RADIOLIB_ERR_RANGING_TIMEOUT) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::ScanReadFailed, scan_state);
        return;
    }
    if (deadlineReached(now, spectrum_point_started_ms_,
                        spectrum_result_.request.per_frequency_timeout_ms)) {
        beginSpectrumRestoration(SpectrumSweepState::Failed,
                                 SpectrumSweepFailure::Timeout,
                                 RADIOLIB_ERR_RANGING_TIMEOUT, true);
    }
}

void TDeckRadioService::beginSpectrumRestoration(SpectrumSweepState terminal_state,
                                                 SpectrumSweepFailure failure,
                                                 std::int16_t radio_error,
                                                 bool timed_out) noexcept
{
    radio_.clearDio1Action();
    radio_.spectralScanAbort();
    radio_.standby();
    dio1_pending_ = false;
    status_.receiving = false;
    spectrum_terminal_state_ = terminal_state;
    spectrum_status_.state = SpectrumSweepState::Restoring;
    spectrum_status_.failure = failure;
    spectrum_status_.radio_error = radio_error;
    spectrum_status_.timed_out = timed_out;
}

void TDeckRadioService::restoreAfterSpectrumSweep() noexcept
{
    // A scan patch can leave the modem in an undocumented state. Re-applying
    // individual LoRa fields is insufficient; configure() performs a complete
    // SX1262 begin sequence and only reports recovery after RX has restarted.
    const RadioProfile restore_profile = profile_;
    const bool restored = configure(restore_profile);
    spectrum_status_.restoration_succeeded = restored;
    spectrum_status_.restore_error = restored ? RADIOLIB_ERR_NONE : status_.last_error;
    spectrum_status_.finished_ms = millis();
    spectrum_generation_ = spectrum_result_.generation;

    if (!restored) {
        spectrum_status_.state = SpectrumSweepState::Failed;
        spectrum_status_.failure = SpectrumSweepFailure::RestoreFailed;
        return;
    }
    spectrum_status_.state = spectrum_terminal_state_;
}

void TDeckRadioService::stop() noexcept
{
    radio_.clearDio1Action();
    if (spectrum_status_.active()) {
        radio_.spectralScanAbort();
        spectrum_status_.state = SpectrumSweepState::Cancelled;
        spectrum_status_.failure = SpectrumSweepFailure::Cancelled;
        spectrum_status_.finished_ms = millis();
        spectrum_generation_ = spectrum_result_.generation;
    }
    radio_.standby();
    status_.receiving = false;
    status_.initialized = false;
    next_receive_retry_ms_ = 0;
    configure_recovery_.clear();
    dio1_pending_ = false;
    if (instance_ == this) {
        instance_ = nullptr;
    }
}

} // namespace lilyshark

#endif
