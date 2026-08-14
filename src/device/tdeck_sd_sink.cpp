#include "lilyshark/device/tdeck_sd_sink.h"

#if defined(LILYSHARK_DEVICE)

#include "lilyshark/tdeck.h"

#include <Arduino.h>
#include <SD.h>

#include <cstdio>
#include <limits>

namespace lilyshark {

bool mountTDeckSd(SPIClass &spi, std::uint32_t frequency_hz) noexcept
{
    pinMode(tdeck::power_enable_pin, OUTPUT);
    digitalWrite(tdeck::power_enable_pin, HIGH);
    pinMode(tdeck::display_cs_pin, OUTPUT);
    pinMode(tdeck::radio_cs_pin, OUTPUT);
    pinMode(tdeck::sd_cs_pin, OUTPUT);
    digitalWrite(tdeck::display_cs_pin, HIGH);
    digitalWrite(tdeck::radio_cs_pin, HIGH);
    digitalWrite(tdeck::sd_cs_pin, HIGH);
    spi.begin(tdeck::spi_sck_pin, tdeck::spi_miso_pin, tdeck::spi_mosi_pin);
    return SD.begin(tdeck::sd_cs_pin, spi, frequency_hz);
}

bool TDeckSdByteSink::open(const char *path) noexcept
{
    close();
    if (path == nullptr || path[0] == '\0') {
        return false;
    }
    file_ = SD.open(path, FILE_WRITE);
    expected_size_ = file_ ? file_.position() : 0;
    return static_cast<bool>(file_);
}

bool TDeckSdByteSink::openNextCapture(char *path, std::size_t path_capacity,
                                      const char *extension) noexcept
{
    if (path == nullptr || path_capacity == 0 || extension == nullptr || extension[0] != '.') {
        return false;
    }
    path[0] = '\0';
    if (!SD.exists("/lilyshark") && !SD.mkdir("/lilyshark")) {
        return false;
    }

    for (unsigned index = 1; index <= 9999; ++index) {
        const int written = std::snprintf(path, path_capacity, "/lilyshark/capture-%04u%s",
                                          index, extension);
        if (written <= 0 || static_cast<std::size_t>(written) >= path_capacity) {
            path[0] = '\0';
            return false;
        }
        if (!SD.exists(path)) {
            return open(path);
        }
    }

    path[0] = '\0';
    return false;
}

bool TDeckSdByteSink::write(const std::uint8_t *data, std::size_t length) noexcept
{
    if (!file_ || (data == nullptr && length != 0) ||
        length > std::numeric_limits<std::size_t>::max() - expected_size_) {
        return false;
    }
    if (length == 0) {
        return true;
    }
    if (file_.write(data, length) != length) {
        return false;
    }
    expected_size_ += length;
    return true;
}

bool TDeckSdByteSink::flush() noexcept
{
    if (!file_) {
        return false;
    }
    file_.flush();
    return file_.position() == expected_size_ && file_.size() >= expected_size_;
}

void TDeckSdByteSink::close() noexcept
{
    if (file_) {
        file_.close();
    }
    expected_size_ = 0;
}

bool TDeckSdByteSink::isOpen() const noexcept
{
    return static_cast<bool>(file_);
}

} // namespace lilyshark

#endif
