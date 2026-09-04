#include "lilyshark/device/radio_service.h"

#include <RadioLib.h>

#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;
using radiolib_fake::Operation;

RadioProfile testProfile()
{
    RadioProfile profile{};
    profile.id = 17;
    profile.setName("TEST PROFILE");
    profile.protocol_hint = ProtocolId::Meshtastic;
    profile.modulation = Modulation::LoRa;
    profile.center_frequency_hz = 906875000;
    profile.bandwidth_hz = 250000;
    profile.preamble_symbols = 16;
    profile.sync_word = 0x2b;
    profile.spreading_factor = 11;
    profile.coding_rate_denominator = 5;
    profile.tx_power_dbm = 10;
    profile.crc_enabled = true;
    return profile;
}

std::size_t operationIndex(Operation operation, std::size_t start = 0)
{
    const auto &operations = radiolib_fake::state().operations;
    for (std::size_t index = start; index < operations.size(); ++index) {
        if (operations[index] == operation) {
            return index;
        }
    }
    return operations.size();
}

std::size_t operationCount(Operation operation)
{
    std::size_t count = 0;
    for (const Operation recorded : radiolib_fake::state().operations) {
        if (recorded == operation) {
            ++count;
        }
    }
    return count;
}

struct CapturedFrame {
    RawFrame frame{};
    RadioProfile profile{};
    std::size_t calls = 0;
    bool receiver_rearmed_before_callback = false;
};

void captureFrame(const RawFrame &frame, const RadioProfile &profile, void *context)
{
    auto &capture = *static_cast<CapturedFrame *>(context);
    capture.frame = frame;
    capture.profile = profile;
    ++capture.calls;
    capture.receiver_rearmed_before_callback = radiolib_fake::state().start_receive_calls == 2U;
}

void testConfigureInterruptReadAndRearm()
{
    auto &fake = radiolib_fake::state();
    fake.reset();
    fake.now_ms = 100;
    fake.now_us = 123456;

    CapturedFrame capture{};
    TDeckRadioService service{};
    const RadioProfile profile = testProfile();
    assert(service.begin(profile, captureFrame, &capture));
    // Boosted receive gain is part of what "configured" means: stock
    // Meshtastic listens with it on, and a receiver 2 dB deafer than every
    // stock deck on the same shelf is a silent field bug, not a preference.
    assert(radiolib_fake::state().rx_boosted_gain);
    assert(service.status().initialized);
    assert(service.status().receiving);
    assert(fake.begin_calls == 1U);
    assert(fake.start_receive_calls == 1U);
    assert(std::fabs(fake.last_lora_frequency_mhz - 906.875F) < 0.001F);
    assert(std::fabs(fake.last_lora_bandwidth_khz - 250.0F) < 0.001F);
    assert(fake.last_lora_spreading_factor == 11U);
    assert(fake.last_lora_coding_rate == 5U);
    assert(fake.last_lora_sync_word == 0x2bU);
    assert(fake.last_lora_preamble == 16U);

    fake.packet = {0x11, 0x22, 0x33, 0x44};
    fake.packet_length = fake.packet.size();
    fake.irq_flags = RADIOLIB_SX126X_IRQ_HEADER_VALID;
    fake.header_coding_rate = 4;
    fake.header_has_crc = true;
    fake.read_data_result = RADIOLIB_ERR_CRC_MISMATCH;
    const std::size_t receive_operation_start = fake.operations.size();

    fake.triggerDio1();
    service.poll();

    assert(capture.calls == 1U);
    assert(capture.receiver_rearmed_before_callback);
    assert(capture.profile.id == profile.id);
    assert(capture.frame.captured_length == fake.packet.size());
    assert(capture.frame.bytes[0] == 0x11U);
    assert(capture.frame.bytes[3] == 0x44U);
    assert(capture.frame.rf.timestamp_us == 123456U);
    assert(capture.frame.rf.origin == FrameOrigin::Radio);
    assert(capture.frame.rf.coding_rate_denominator == 8U);
    assert(capture.frame.rf.crc == CrcStatus::Invalid);
    assert(capture.frame.rf.radio_status == RADIOLIB_ERR_CRC_MISMATCH);
    // Computed here, not taken from the radio driver.
    //
    // This used to assert equality with the fake's airtime_us, an arbitrary
    // 24680 -- a number chosen to be recognisable, not an airtime. Received
    // frames took RadioLib's figure while transmitted frames got none, so the
    // moment this deck counted its own transmissions there were two rulers
    // for one number on one screen.
    //
    // The receive path prices a frame with the CODING RATE FROM ITS OWN
    // HEADER (8 here), not the profile's (5): the profile says what WE
    // transmit with, and this frame was sent by somebody else. By hand, at
    // SF11 / 250 kHz the symbol time is 2^11/250000 = 8.192 ms; preamble is
    // 16 + 4.25 = 20.25 symbols; payload is 8 + ceil((32 - 44 + 28 + 16)/36)
    // * 8 = 16 symbols; 36.25 symbols total = 296.96 ms.
    assert(capture.frame.rf.airtime_us == 296960U);
    assert(capture.frame.rf.hasField(RfFieldCodingRate));
    assert(capture.frame.rf.hasField(RfFieldAirtime));
    assert(service.status().received_frames == 1U);
    assert(service.status().crc_errors == 1U);
    assert(service.status().receiving);
    assert(fake.start_receive_calls == 2U);

    const std::size_t irq_index = operationIndex(Operation::GetIrqFlags,
                                                  receive_operation_start);
    const std::size_t read_index = operationIndex(Operation::ReadData,
                                                   receive_operation_start);
    const std::size_t rearm_index = operationIndex(Operation::StartReceive,
                                                    receive_operation_start);
    assert(irq_index < read_index);
    assert(read_index < rearm_index);
    service.stop();
}

void testReceiveArmRetryAndInvalidLengthRearm()
{
    auto &fake = radiolib_fake::state();
    fake.reset();
    fake.now_ms = 200;
    fake.start_receive_results = {-601, RADIOLIB_ERR_NONE, RADIOLIB_ERR_NONE};

    CapturedFrame capture{};
    TDeckRadioService service{};
    assert(!service.begin(testProfile(), captureFrame, &capture));
    assert(service.status().initialized);
    assert(!service.status().receiving);
    assert(service.status().receive_errors == 1U);

    fake.now_ms = 699;
    service.poll();
    assert(fake.start_receive_calls == 1U);
    fake.now_ms = 700;
    service.poll();
    assert(fake.start_receive_calls == 2U);
    assert(service.status().receiving);

    fake.packet_length = kMaxFrameBytes + 1U;
    fake.triggerDio1();
    service.poll();
    assert(capture.calls == 0U);
    assert(service.status().receive_errors == 2U);
    assert(service.status().receiving);
    assert(fake.start_receive_calls == 3U);
    service.stop();
}

SpectrumSweepRequest twoPointSweep()
{
    SpectrumSweepRequest request{};
    request.start_frequency_hz = 902000000;
    request.end_frequency_hz = 902200000;
    request.step_hz = 200000;
    request.samples_per_frequency = 64;
    request.per_frequency_timeout_ms = 50;
    request.overall_timeout_ms = 1000;
    return request;
}

void testSpectrumSweepRestoresReceiver()
{
    auto &fake = radiolib_fake::state();
    fake.reset();
    fake.now_ms = 1000;

    TDeckRadioService service{};
    assert(service.begin(testProfile(), nullptr, nullptr));
    assert(service.startSpectrumSweep(twoPointSweep()));
    assert(service.spectrumStatus().state == SpectrumSweepState::Preparing);
    service.clearSpectrumResult();
    assert(service.spectrumStatus().state == SpectrumSweepState::Preparing);
    assert(!service.status().receiving);
    assert(fake.dio1_action == nullptr);

    service.poll();
    assert(service.spectrumStatus().state == SpectrumSweepState::Scanning);
    assert(std::fabs(fake.last_scan_frequency_mhz - 902.0F) < 0.001F);
    assert(fake.last_scan_samples == 64U);
    assert(operationCount(Operation::ScanStart) == 1U);

    fake.scan_counts.fill(0);
    fake.scan_counts[2] = 7;
    fake.scan_status_result = RADIOLIB_ERR_NONE;
    service.poll();
    assert(service.spectrumStatus().state == SpectrumSweepState::Advancing);
    assert(service.spectrumStatus().points_completed == 1U);

    fake.now_ms += 4;
    service.poll();
    assert(operationCount(Operation::ScanStart) == 1U);
    fake.now_ms += 1;
    service.poll();
    assert(service.spectrumStatus().state == SpectrumSweepState::Scanning);
    assert(operationCount(Operation::ScanStart) == 2U);
    assert(std::fabs(fake.last_scan_frequency_mhz - 902.2F) < 0.001F);

    fake.scan_counts.fill(0);
    fake.scan_counts[6] = 11;
    fake.scan_status_result = RADIOLIB_ERR_NONE;
    service.poll();
    assert(service.spectrumStatus().state == SpectrumSweepState::Restoring);
    assert(fake.scan_abort_calls == 1U);

    service.poll();
    assert(service.spectrumStatus().state == SpectrumSweepState::Complete);
    assert(service.spectrumStatus().restoration_succeeded);
    assert(service.spectrumStatus().restore_error == RADIOLIB_ERR_NONE);
    assert(service.spectrumResult().generation == 1U);
    assert(service.spectrumResult().point_count == 2U);
    assert(service.spectrumResult().points[0].frequency_hz == 902000000U);
    assert(service.spectrumResult().points[0].counts[2] == 7U);
    assert(service.spectrumResult().points[1].frequency_hz == 902200000U);
    assert(service.spectrumResult().points[1].counts[6] == 11U);
    assert(fake.begin_calls == 2U);
    assert(service.status().initialized);
    assert(service.status().receiving);
    assert(fake.dio1_action != nullptr);
    service.clearSpectrumResult();
    assert(service.spectrumStatus().state == SpectrumSweepState::Idle);
    assert(service.spectrumStatus().points_completed == 0U);
    assert(service.spectrumResult().point_count == 0U);
    assert(service.status().receiving);
    service.stop();
}

void testRestoreFailureSchedulesFullConfigureRecovery()
{
    constexpr std::int16_t restore_failure = -812;
    auto &fake = radiolib_fake::state();
    fake.reset();
    fake.now_ms = 4000;
    fake.begin_results = {RADIOLIB_ERR_NONE, restore_failure, RADIOLIB_ERR_NONE};

    TDeckRadioService service{};
    assert(service.begin(testProfile(), nullptr, nullptr));
    SpectrumSweepRequest request = twoPointSweep();
    request.end_frequency_hz = request.start_frequency_hz;
    assert(service.startSpectrumSweep(request));
    service.poll();
    fake.scan_counts[1] = 3;
    fake.scan_status_result = RADIOLIB_ERR_NONE;
    service.poll();
    assert(service.spectrumStatus().state == SpectrumSweepState::Restoring);

    service.poll();
    assert(service.spectrumStatus().state == SpectrumSweepState::Failed);
    assert(service.spectrumStatus().failure == SpectrumSweepFailure::RestoreFailed);
    assert(!service.spectrumStatus().restoration_succeeded);
    assert(service.spectrumStatus().restore_error == restore_failure);
    assert(!service.status().initialized);
    assert(!service.status().receiving);
    assert(fake.begin_calls == 2U);

    fake.now_ms += 999;
    service.poll();
    assert(fake.begin_calls == 2U);
    fake.now_ms += 1;
    service.poll();
    assert(fake.begin_calls == 3U);
    assert(service.status().initialized);
    assert(service.status().receiving);
    assert(service.spectrumStatus().state == SpectrumSweepState::Failed);
    assert(service.spectrumStatus().failure == SpectrumSweepFailure::RestoreFailed);
    service.stop();
}

// A transmit must leave the receiver able to report the next packet. transmit()
// clears the DIO1 action before keying up; if it is not re-attached the radio
// keeps "receiving" in status while the interrupt that delivers packets is
// gone. The device announces itself on the mesh at boot, so this went deaf
// before it had ever heard anything, and two devices could never see one
// another.
void testTransmitLeavesReceiverAbleToDeliverPackets()
{
    auto &fake = radiolib_fake::state();
    fake.reset();
    fake.now_ms = 100;

    CapturedFrame capture{};
    TDeckRadioService service{};
    assert(service.begin(testProfile(), captureFrame, &capture));
    assert(fake.dio1_action != nullptr);

    const std::uint8_t payload[] = {0xDE, 0xAD, 0xBE, 0xEF};
    assert(service.transmit(payload, sizeof(payload)));
    assert(service.status().receiving);
    assert(fake.dio1_action != nullptr &&
           "the DIO1 handler must survive a transmit or no packet is ever reported");

    // Prove it end to end: raise an interrupt the way the radio would and
    // require the frame to reach the sink.
    const unsigned before = capture.calls;
    fake.packet = {0x01, 0x02, 0x03};
    fake.packet_length = fake.packet.size();
    fake.irq_flags = RADIOLIB_SX126X_IRQ_HEADER_VALID;
    fake.header_has_crc = true;
    fake.read_data_result = RADIOLIB_ERR_NONE;
    fake.dio1_action();
    service.poll();
    assert(capture.calls == before + 1U &&
           "a packet received after a transmit must still reach the capture sink");
    service.stop();
}

} // namespace

int main()
{
    testConfigureInterruptReadAndRearm();
    testReceiveArmRetryAndInvalidLengthRearm();
    testSpectrumSweepRestoresReceiver();
    testRestoreFailureSchedulesFullConfigureRecovery();
    testTransmitLeavesReceiverAbleToDeliverPackets();
    std::puts("radio service state-transition tests passed");
    return 0;
}
