#pragma once

#include "lilyshark/export/byte_sink.h"
#include "lilyshark/export/capture_storage.h"

#if !defined(ESP_PLATFORM)

#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace lilyshark {

/// The capture writer's destination on an ordinary filesystem.
///
/// This exists because the .lscap path had never been run end to end. The
/// format had unit tests, the T-Deck sink had fake-SD tests, and no build had
/// ever taken a frame from the encoder, put it through a file, and read the
/// file back -- so nothing proved the numbering, the directory creation, and
/// the byte stream fit together. Point the simulator at a temp directory and
/// the whole path runs on a machine that has no card slot.
///
/// It mirrors TDeckSdByteSink deliberately: same /lilyshark subdirectory,
/// same capture-NNNN numbering, same CaptureStorageStatus vocabulary. A
/// divergence here would mean the tested path is not the shipped one.
class PosixCaptureSink final : public ByteSink
{
  public:
    PosixCaptureSink() = default;
    ~PosixCaptureSink() override;
    PosixCaptureSink(const PosixCaptureSink &) = delete;
    PosixCaptureSink &operator=(const PosixCaptureSink &) = delete;

    /// Create `<root>/lilyshark` if needed and open the lowest unused
    /// capture-NNNN file in it, writing the full path back to `path`.
    bool openNextCapture(const char *root, char *path, std::size_t path_capacity,
                         const char *extension) noexcept;
    bool write(const std::uint8_t *data, std::size_t length) noexcept override;
    bool flush() noexcept;
    void close() noexcept;
    bool isOpen() const noexcept { return file_ != nullptr; }
    std::size_t bytesWritten() const noexcept { return written_; }

    /// Why the last call failed, in the same vocabulary the device sink uses.
    CaptureStorageStatus status() const noexcept { return status_; }

  private:
    std::FILE *file_ = nullptr;
    std::size_t written_ = 0;
    CaptureStorageStatus status_ = CaptureStorageStatus::NotOpen;
};

/// Translate a C library errno into the storage vocabulary. Split out so the
/// mapping is testable without arranging a full disk.
CaptureStorageStatus captureStorageStatusFromErrno(int error_number) noexcept;

} // namespace lilyshark

#endif
