#pragma once

#include "lilyshark/export/byte_sink.h"
#include "lilyshark/export/capture_storage.h"

#if defined(LILYSHARK_DEVICE)

#include <FS.h>
#include <SPI.h>

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::uint32_t kTDeckSdSpiFrequencyHz = 800000;

// Every capture file the deck writes lives here. Named once because the
// failure diagnosis reads the directory back to find out whether the card is
// still answering, and a second spelling would quietly stop testing that.
inline constexpr const char *kTDeckCaptureDirectory = "/lilyshark";

// Call from setup before opening a capture. Radio/display chip-select lines are
// deasserted because the T-Deck shares one SPI bus across all three devices.
bool mountTDeckSd(SPIClass &spi, std::uint32_t frequency_hz = kTDeckSdSpiFrequencyHz) noexcept;

// Same mount, with the reason attached: Ok, or NoCard when nothing answered.
// SDFS::begin unwinds sdcard_unmount/sdcard_uninit and resets its drive index
// on failure, so once it has returned false nothing survives that could tell
// an empty slot from an unmountable card -- which is exactly why NoCard is
// documented as "no card answered" and not as "the slot is empty".
CaptureStorageStatus mountTDeckSdStatus(SPIClass &spi,
                                        std::uint32_t frequency_hz = kTDeckSdSpiFrequencyHz) noexcept;

// Free space on the mounted card, three-valued. Unknown is a real answer:
// f_getfree returns zero for both totals when it fails, and calling that
// "full" would send an operator deleting files off a healthy card.
CaptureFreeSpace tdeckSdFreeSpace(std::uint64_t needed_bytes = 1U) noexcept;

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

    // Why the last open, write, or flush failed. Callers that only look at the
    // bool cannot tell a full card from a pulled one, which is how four
    // different card faults ended up sharing one "I/O ERROR" on screen.
    CaptureStorageStatus status() const noexcept { return status_; }

  private:
    // Ask the card two more questions before naming a write failure, and let
    // each answer stand for itself.
    CaptureStorageStatus diagnose(std::size_t needed_bytes) noexcept;

    fs::File file_{};
    std::size_t expected_size_ = 0;
    CaptureStorageStatus status_ = CaptureStorageStatus::NotOpen;
    // Set once /lilyshark is known to exist. The "did the card stop
    // answering" probe reads that directory back, and reading back a
    // directory nobody created yet would report every fault as a missing card.
    bool directory_ready_ = false;
};

} // namespace lilyshark

#endif
