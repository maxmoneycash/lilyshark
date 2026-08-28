#include "lilyshark/device/tdeck_chime.h"

#if defined(ESP_PLATFORM)

#include "lilyshark/tdeck.h"

#include <Arduino.h>
#include <driver/i2s.h>

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace lilyshark {
namespace {

constexpr i2s_port_t kPort = I2S_NUM_0;
constexpr int kSampleRate = 16000;
constexpr double kTwoPi = 6.283185307179586;

/// The driver is installed only while a chime is playing. Chimes are rare and
/// an idle I2S output leaves the amplifier hissing, which on a device meant to
/// sit quietly in a pocket is worse than the sound it is there to make.
bool beginChime() noexcept
{
    i2s_config_t config{};
    config.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_TX);
    config.sample_rate = kSampleRate;
    config.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
    config.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
    config.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    config.intr_alloc_flags = 0;
    config.dma_buf_count = 4;
    config.dma_buf_len = 256;
    config.use_apll = false;
    config.tx_desc_auto_clear = true;
    config.fixed_mclk = 0;
    if (i2s_driver_install(kPort, &config, 0, nullptr) != ESP_OK) return false;

    i2s_pin_config_t pins{};
    pins.mck_io_num = I2S_PIN_NO_CHANGE;
    pins.bck_io_num = tdeck::i2s_bck_pin;
    pins.ws_io_num = tdeck::i2s_ws_pin;
    pins.data_out_num = tdeck::i2s_dout_pin;
    pins.data_in_num = I2S_PIN_NO_CHANGE;
    if (i2s_set_pin(kPort, &pins) != ESP_OK) {
        (void)i2s_driver_uninstall(kPort);
        return false;
    }
    return true;
}

void endChime() noexcept
{
    (void)i2s_zero_dma_buffer(kPort);
    (void)i2s_driver_uninstall(kPort);
}

/// One tone, shaped at both ends. A square-edged start and stop puts a click
/// through the speaker that is louder than the note itself.
void writeTone(double frequency_hz, int milliseconds, double gain) noexcept
{
    const int total = kSampleRate * milliseconds / 1000;
    if (total <= 0) return;
    const int fade = total / 6 > 1 ? total / 6 : 1;
    std::int16_t block[128]{};
    int done = 0;
    while (done < total) {
        const int count = (total - done) < 128 ? (total - done) : 128;
        for (int index = 0; index < count; ++index) {
            const int sample = done + index;
            double envelope = 1.0;
            if (sample < fade) {
                envelope = static_cast<double>(sample) / static_cast<double>(fade);
            } else if (sample > total - fade) {
                envelope = static_cast<double>(total - sample) / static_cast<double>(fade);
            }
            const double phase =
                kTwoPi * frequency_hz * static_cast<double>(sample) / kSampleRate;
            block[index] = static_cast<std::int16_t>(
                gain * envelope * 32000.0 * std::sin(phase));
        }
        std::size_t written = 0;
        if (i2s_write(kPort, block, static_cast<std::size_t>(count) * sizeof(std::int16_t),
                      &written, pdMS_TO_TICKS(200)) != ESP_OK) {
            return;
        }
        done += count;
    }
}

}  // namespace

void playMessageChime() noexcept
{
    if (!beginChime()) return;
    writeTone(880.0, 90, 0.35);
    writeTone(1318.5, 130, 0.35);
    endChime();
}

void playNodeChime() noexcept
{
    if (!beginChime()) return;
    // Quieter and lower than a message: someone arriving is worth knowing
    // about, but it is not addressed to you.
    writeTone(587.3, 70, 0.22);
    writeTone(587.3, 70, 0.22);
    endChime();
}

}  // namespace lilyshark

#else

namespace lilyshark {

void playMessageChime() noexcept {}
void playNodeChime() noexcept {}

}  // namespace lilyshark

#endif
