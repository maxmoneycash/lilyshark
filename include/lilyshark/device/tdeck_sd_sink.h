#pragma once

#include "lilyshark/export/byte_sink.h"

#if defined(LILYSHARK_DEVICE)

#include <FS.h>
#include <SPI.h>

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::uint32_t kTDeckSdSpiFrequencyHz = 800000;

// Call from setup before opening a capture. Radio/display chip-select lines are
// deasserted because the T-Deck shares one SPI bus across all three devices.
bool mountTDeckSd(SPIClass &spi, std::uint32_t frequency_hz = kTDeckSdSpiFrequencyHz) noexcept;

// File writes are synchronous. Use this sink only from the main loop/task;
// radio ISRs should enqueue RawFrame values and return immediately.
class TDeckSdByteSink final : public ByteSink
{
  public:
    bool open(const char *path) noexcept;
    bool openNextCapture(char *path, std::size_t path_capacity,
                         const char *extension = ".pcap") noexcept;
    bool write(const std::uint8_t *data, std::size_t length) noexcept override;
    // Flushes buffered data and verifies that the file position and visible
    // size still cover every byte accepted by write().
    bool flush() noexcept;
    void close() noexcept;
    bool isOpen() const noexcept;

  private:
    fs::File file_{};
    std::size_t expected_size_ = 0;
};

} // namespace lilyshark

#endif
