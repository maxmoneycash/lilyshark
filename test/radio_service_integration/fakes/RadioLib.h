#pragma once

#include <SPI.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

inline constexpr std::int16_t RADIOLIB_ERR_NONE = 0;
inline constexpr std::int16_t RADIOLIB_ERR_CRC_MISMATCH = -7;
inline constexpr std::int16_t RADIOLIB_ERR_PACKET_TOO_LONG = -38;
inline constexpr std::int16_t RADIOLIB_ERR_INVALID_FREQUENCY = -12;
inline constexpr std::int16_t RADIOLIB_ERR_RANGING_TIMEOUT = -101;
inline constexpr std::uint16_t RADIOLIB_SX126X_IRQ_HEADER_VALID = 1U << 4U;
inline constexpr std::uint16_t RADIOLIB_SX126X_IRQ_HEADER_ERR = 1U << 5U;
inline constexpr std::size_t RADIOLIB_SX126X_SPECTRAL_SCAN_RES_SIZE = 33;
inline constexpr int RADIOLIB_MODEM_LORA = 1;
inline constexpr int RADIOLIB_SHAPING_NONE = 0;

using RadioLibIrqFlags_t = std::uint16_t;

struct DataRate_t {
    struct {
        std::uint8_t spreadingFactor = 0;
        float bandwidth = 0.0F;
        std::uint8_t codingRate = 0;
    } lora;
};

struct PacketConfig_t {
    struct {
        std::uint16_t preambleLength = 0;
        bool implicitHeader = false;
        bool crcEnabled = false;
        bool ldrOptimize = false;
    } lora;
};

struct ConfigFSK_t {
    float frequency = 0.0F;
    float receiverBandwidth = 0.0F;
    std::int8_t power = 0;
};

namespace radiolib_fake {

enum class Operation : std::uint8_t {
    Begin,
    BeginFsk,
    ClearDio1Action,
    Standby,
    SetDio1Action,
    StartReceive,
    GetPacketLength,
    GetIrqFlags,
    ReadData,
    GetHeaderInfo,
    CalculateAirtime,
    SetFrequency,
    ScanStart,
    ScanStatus,
    ScanResult,
    ScanAbort,
};

struct State {
    std::uint32_t now_ms = 0;
    std::uint64_t now_us = 0;
    std::vector<Operation> operations{};
    std::vector<std::int16_t> begin_results{};
    std::vector<std::int16_t> start_receive_results{};
    std::size_t begin_result_index = 0;
    std::size_t start_receive_result_index = 0;

    std::int16_t set_dio2_result = RADIOLIB_ERR_NONE;
    std::int16_t set_crc_result = RADIOLIB_ERR_NONE;
    std::int16_t header_mode_result = RADIOLIB_ERR_NONE;
    std::int16_t invert_iq_result = RADIOLIB_ERR_NONE;
    std::int16_t standby_result = RADIOLIB_ERR_NONE;
    std::int16_t read_data_result = RADIOLIB_ERR_NONE;
    std::int16_t header_info_result = RADIOLIB_ERR_NONE;
    std::int16_t begin_fsk_result = RADIOLIB_ERR_NONE;
    std::int16_t upload_patch_result = RADIOLIB_ERR_NONE;
    std::int16_t rx_bandwidth_result = RADIOLIB_ERR_NONE;
    std::int16_t shaping_result = RADIOLIB_ERR_NONE;
    std::int16_t set_frequency_result = RADIOLIB_ERR_NONE;
    std::int16_t scan_start_result = RADIOLIB_ERR_NONE;
    std::int16_t scan_status_result = RADIOLIB_ERR_RANGING_TIMEOUT;
    std::int16_t scan_result_result = RADIOLIB_ERR_NONE;

    std::vector<std::uint8_t> packet{};
    /// Every frame the firmware asked the radio to send, in order.
    std::vector<std::vector<std::uint8_t>> transmitted{};
    std::size_t packet_length = 0;
    RadioLibIrqFlags_t irq_flags = 0;
    std::uint8_t header_coding_rate = 1;
    bool header_has_crc = true;
    float rssi_dbm = -91.5F;
    float snr_db = -7.25F;
    float frequency_error_hz = 125.0F;
    std::uint32_t airtime_us = 24680;
    std::array<std::uint16_t, RADIOLIB_SX126X_SPECTRAL_SCAN_RES_SIZE> scan_counts{};

    float last_lora_frequency_mhz = 0.0F;
    float last_lora_bandwidth_khz = 0.0F;
    std::uint8_t last_lora_spreading_factor = 0;
    std::uint8_t last_lora_coding_rate = 0;
    std::uint8_t last_lora_sync_word = 0;
    std::uint16_t last_lora_preamble = 0;
    float last_scan_frequency_mhz = 0.0F;
    std::uint16_t last_scan_samples = 0;
    std::size_t begin_calls = 0;
    std::size_t start_receive_calls = 0;
    std::size_t scan_abort_calls = 0;
    void (*dio1_action)() = nullptr;

    void reset() { *this = State{}; }

    std::int16_t nextBeginResult()
    {
        ++begin_calls;
        if (begin_result_index < begin_results.size()) {
            return begin_results[begin_result_index++];
        }
        return RADIOLIB_ERR_NONE;
    }

    std::int16_t nextStartReceiveResult()
    {
        ++start_receive_calls;
        if (start_receive_result_index < start_receive_results.size()) {
            return start_receive_results[start_receive_result_index++];
        }
        return RADIOLIB_ERR_NONE;
    }

    void triggerDio1() const
    {
        if (dio1_action != nullptr) {
            dio1_action();
        }
    }
};

inline State runtime{};

inline State &state() noexcept
{
    return runtime;
}

} // namespace radiolib_fake

class Module
{
  public:
    Module(int, int, int, int, SPIClass &) {}
};

class SX1262
{
  public:
    explicit SX1262(Module *) {}

    std::int16_t begin(float frequency, float bandwidth, std::uint8_t spreading_factor,
                       std::uint8_t coding_rate, std::uint8_t sync_word, std::int8_t,
                       std::uint16_t preamble, float, bool)
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::Begin);
        fake.last_lora_frequency_mhz = frequency;
        fake.last_lora_bandwidth_khz = bandwidth;
        fake.last_lora_spreading_factor = spreading_factor;
        fake.last_lora_coding_rate = coding_rate;
        fake.last_lora_sync_word = sync_word;
        fake.last_lora_preamble = preamble;
        return fake.nextBeginResult();
    }

    std::int16_t setDio2AsRfSwitch(bool) { return radiolib_fake::state().set_dio2_result; }
    std::int16_t setCRC(std::uint8_t) { return radiolib_fake::state().set_crc_result; }
    std::int16_t implicitHeader(std::size_t)
    {
        return radiolib_fake::state().header_mode_result;
    }
    std::int16_t explicitHeader() { return radiolib_fake::state().header_mode_result; }
    std::int16_t invertIQ(bool) { return radiolib_fake::state().invert_iq_result; }

    void clearDio1Action()
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::ClearDio1Action);
        fake.dio1_action = nullptr;
    }

    std::int16_t standby()
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::Standby);
        return fake.standby_result;
    }

    void setDio1Action(void (*action)())
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::SetDio1Action);
        fake.dio1_action = action;
    }

    std::int16_t startReceive()
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::StartReceive);
        return fake.nextStartReceiveResult();
    }

    std::int16_t transmit(const std::uint8_t *data, std::size_t length)
    {
        auto &fake = radiolib_fake::state();
        fake.transmitted.emplace_back(data, data + length);
        return RADIOLIB_ERR_NONE;
    }

    std::size_t getPacketLength()
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::GetPacketLength);
        return fake.packet_length;
    }

    RadioLibIrqFlags_t getIrqFlags()
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::GetIrqFlags);
        return fake.irq_flags;
    }

    std::int16_t readData(std::uint8_t *destination, std::size_t length)
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::ReadData);
        const std::size_t count = std::min(length, fake.packet.size());
        if (count != 0U) {
            std::memcpy(destination, fake.packet.data(), count);
        }
        return fake.read_data_result;
    }

    std::int16_t getLoRaRxHeaderInfo(std::uint8_t *coding_rate, bool *has_crc)
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::GetHeaderInfo);
        *coding_rate = fake.header_coding_rate;
        *has_crc = fake.header_has_crc;
        return fake.header_info_result;
    }

    std::uint32_t calculateTimeOnAir(int, const DataRate_t &, const PacketConfig_t &,
                                     std::size_t)
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::CalculateAirtime);
        return fake.airtime_us;
    }

    float getRSSI() const { return radiolib_fake::state().rssi_dbm; }
    float getSNR() const { return radiolib_fake::state().snr_db; }
    float getFrequencyError() const { return radiolib_fake::state().frequency_error_hz; }

    std::int16_t beginFSK(const ConfigFSK_t &)
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::BeginFsk);
        return fake.begin_fsk_result;
    }

    std::int16_t uploadPatch(const std::uint8_t *, std::size_t)
    {
        return radiolib_fake::state().upload_patch_result;
    }
    std::int16_t setRxBandwidth(float) { return radiolib_fake::state().rx_bandwidth_result; }
    std::int16_t setDataShaping(int) { return radiolib_fake::state().shaping_result; }

    std::int16_t setFrequency(float frequency)
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::SetFrequency);
        fake.last_scan_frequency_mhz = frequency;
        return fake.set_frequency_result;
    }

    std::int16_t spectralScanStart(std::uint16_t samples)
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::ScanStart);
        fake.last_scan_samples = samples;
        if (fake.scan_start_result == RADIOLIB_ERR_NONE) {
            fake.scan_status_result = RADIOLIB_ERR_RANGING_TIMEOUT;
        }
        return fake.scan_start_result;
    }

    std::int16_t spectralScanGetStatus()
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::ScanStatus);
        return fake.scan_status_result;
    }

    std::int16_t spectralScanGetResult(std::uint16_t *counts)
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::ScanResult);
        std::copy(fake.scan_counts.begin(), fake.scan_counts.end(), counts);
        return fake.scan_result_result;
    }

    void spectralScanAbort()
    {
        auto &fake = radiolib_fake::state();
        fake.operations.push_back(radiolib_fake::Operation::ScanAbort);
        ++fake.scan_abort_calls;
    }

    float tcxoVoltage = 0.0F;
    bool useRegulatorLDO = false;
};
