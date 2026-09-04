#include "lilyshark/device/tdeck_sd_sink.h"

#if defined(LILYSHARK_DEVICE)

#include "lilyshark/tdeck.h"

#include <Arduino.h>
#include <SD.h>

#include <cstdio>
#include <limits>

namespace lilyshark {

CaptureStorageStatus mountTDeckSdStatus(SPIClass &spi, std::uint32_t frequency_hz) noexcept
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
    return SD.begin(tdeck::sd_cs_pin, spi, frequency_hz) ? CaptureStorageStatus::Ok
                                                         : CaptureStorageStatus::NoCard;
}

bool mountTDeckSd(SPIClass &spi, std::uint32_t frequency_hz) noexcept
{
    return mountTDeckSdStatus(spi, frequency_hz) == CaptureStorageStatus::Ok;
}

CaptureFreeSpace tdeckSdFreeSpace(std::uint64_t needed_bytes) noexcept
{
    return classifyFreeSpace(SD.totalBytes(), SD.usedBytes(), needed_bytes);
}

CaptureStorageStatus TDeckSdByteSink::diagnose(std::size_t needed_bytes) noexcept
{
    // A card that filled up, a card that was pulled out, and a card mounted
    // read-only all fail the same write() with the same false. Two further
    // questions separate them, and each is allowed to say "I don't know"
    // rather than being folded into the next answer:
    //
    //   free space says Full   -> there is genuinely no room
    //   free space says Unknown-> f_getfree could not answer; that is NOT full
    //   directory read fails   -> the card stopped answering entirely
    //   both answered fine     -> the card refused these particular bytes
    if (tdeckSdFreeSpace(static_cast<std::uint64_t>(needed_bytes)) == CaptureFreeSpace::Full) {
        return CaptureStorageStatus::CardFull;
    }
    if (directory_ready_ && !SD.exists(kTDeckCaptureDirectory)) {
        return CaptureStorageStatus::CardStoppedAnswering;
    }
    return CaptureStorageStatus::WriteRefused;
}

bool TDeckSdByteSink::open(const char *path) noexcept
{
    // close() forgets the directory because a closed sink may next be used on
    // a different card. Opening the next file on the SAME card must not: this
    // is called from openNextCapture, which has just proved /lilyshark exists,
    // and losing that would make every later fault look like a missing card.
    const bool directory_known = directory_ready_;
    close();
    directory_ready_ = directory_known;
    if (path == nullptr || path[0] == '\0') {
        status_ = CaptureStorageStatus::BadRequest;
        return false;
    }
    file_ = SD.open(path, FILE_WRITE);
    if (!file_) {
        status_ = diagnose(1U);
        return false;
    }
    expected_size_ = file_.position();
    status_ = CaptureStorageStatus::Ok;
    return true;
}

bool TDeckSdByteSink::openNextCapture(char *path, std::size_t path_capacity,
                                      const char *extension) noexcept
{
    directory_ready_ = false;
    if (path == nullptr || path_capacity == 0 || extension == nullptr || extension[0] != '.') {
        status_ = CaptureStorageStatus::BadRequest;
        return false;
    }
    path[0] = '\0';
    if (!SD.exists(kTDeckCaptureDirectory) && !SD.mkdir(kTDeckCaptureDirectory)) {
        status_ = CaptureStorageStatus::DirectoryRefused;
        return false;
    }
    directory_ready_ = true;

    for (unsigned index = 1; index <= 9999; ++index) {
        const int written = std::snprintf(path, path_capacity, "%s/capture-%04u%s",
                                          kTDeckCaptureDirectory, index, extension);
        if (written <= 0 || static_cast<std::size_t>(written) >= path_capacity) {
            path[0] = '\0';
            status_ = CaptureStorageStatus::PathTooLong;
            return false;
        }
        if (!SD.exists(path)) {
            return open(path);
        }
    }

    path[0] = '\0';
    status_ = CaptureStorageStatus::NamesExhausted;
    return false;
}

bool TDeckSdByteSink::write(const std::uint8_t *data, std::size_t length) noexcept
{
    if (!file_) {
        status_ = CaptureStorageStatus::NotOpen;
        return false;
    }
    if ((data == nullptr && length != 0) ||
        length > std::numeric_limits<std::size_t>::max() - expected_size_) {
        status_ = CaptureStorageStatus::BadRequest;
        return false;
    }
    if (length == 0) {
        return true;
    }
    if (file_.write(data, length) != length) {
        status_ = diagnose(length);
        return false;
    }
    expected_size_ += length;
    status_ = CaptureStorageStatus::Ok;
    return true;
}

bool TDeckSdByteSink::flush() noexcept
{
    if (!file_) {
        status_ = CaptureStorageStatus::NotOpen;
        return false;
    }
    file_.flush();
    if (file_.position() == expected_size_ && file_.size() >= expected_size_) {
        status_ = CaptureStorageStatus::Ok;
        return true;
    }
    // Bytes this sink accepted are not on the card. Same three causes as a
    // failed write, so the same three questions decide which one to report.
    status_ = diagnose(1U);
    return false;
}

void TDeckSdByteSink::close() noexcept
{
    if (file_) {
        file_.close();
    }
    expected_size_ = 0;
    directory_ready_ = false;
    status_ = CaptureStorageStatus::NotOpen;
}

bool TDeckSdByteSink::isOpen() const noexcept
{
    return static_cast<bool>(file_);
}

} // namespace lilyshark

#endif
