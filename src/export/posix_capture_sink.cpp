#include "lilyshark/export/posix_capture_sink.h"

#if !defined(ESP_PLATFORM)

#include <cerrno>
#include <cstring>
#include <sys/stat.h>
#include <sys/types.h>

namespace lilyshark {

CaptureStorageStatus captureStorageStatusFromErrno(int error_number) noexcept
{
    switch (error_number) {
    case ENOSPC:
#if defined(EDQUOT)
    case EDQUOT:
#endif
    case EFBIG:
        return CaptureStorageStatus::CardFull;
    case EACCES:
    case EPERM:
    case EROFS:
        return CaptureStorageStatus::WriteRefused;
    case ENOENT:
    case ENOTDIR:
    case ENXIO:
    case ENODEV:
    case EIO:
        // The file or the medium under it went away mid-session. On the deck
        // that is a card pulled from the slot; here it is a temp directory
        // deleted underneath a running capture. Same evidence, same name.
        return CaptureStorageStatus::CardStoppedAnswering;
    case ENAMETOOLONG:
        return CaptureStorageStatus::PathTooLong;
    default:
        // Do not guess. An unrecognised errno means the medium refused this
        // write for a reason this code has not learned to name, which is
        // exactly what WriteRefused says.
        return CaptureStorageStatus::WriteRefused;
    }
}

PosixCaptureSink::~PosixCaptureSink()
{
    close();
}

bool PosixCaptureSink::openNextCapture(const char *root, char *path, std::size_t path_capacity,
                                       const char *extension) noexcept
{
    close();
    if (root == nullptr || root[0] == '\0' || path == nullptr || path_capacity == 0 ||
        extension == nullptr || extension[0] != '.') {
        status_ = CaptureStorageStatus::BadRequest;
        return false;
    }
    path[0] = '\0';

    char directory[512]{};
    int written = std::snprintf(directory, sizeof(directory), "%s/lilyshark", root);
    if (written <= 0 || static_cast<std::size_t>(written) >= sizeof(directory)) {
        status_ = CaptureStorageStatus::PathTooLong;
        return false;
    }
    errno = 0;
    if (::mkdir(directory, 0775) != 0 && errno != EEXIST) {
        status_ = errno == ENAMETOOLONG ? CaptureStorageStatus::PathTooLong
                                        : CaptureStorageStatus::DirectoryRefused;
        return false;
    }

    for (unsigned index = 1; index <= 9999; ++index) {
        written = std::snprintf(path, path_capacity, "%s/capture-%04u%s", directory, index,
                                extension);
        if (written <= 0 || static_cast<std::size_t>(written) >= path_capacity) {
            path[0] = '\0';
            status_ = CaptureStorageStatus::PathTooLong;
            return false;
        }
        struct stat existing {};
        if (::stat(path, &existing) == 0) {
            continue;
        }
        errno = 0;
        // "wx" refuses to open a file that appeared between the stat and here,
        // so two writers racing on one directory cannot end up sharing a file.
        file_ = std::fopen(path, "wxb");
        if (file_ == nullptr) {
            if (errno == EEXIST) {
                continue;
            }
            path[0] = '\0';
            status_ = captureStorageStatusFromErrno(errno);
            return false;
        }
        written_ = 0;
        status_ = CaptureStorageStatus::Ok;
        return true;
    }

    path[0] = '\0';
    status_ = CaptureStorageStatus::NamesExhausted;
    return false;
}

bool PosixCaptureSink::write(const std::uint8_t *data, std::size_t length) noexcept
{
    if (file_ == nullptr) {
        status_ = CaptureStorageStatus::NotOpen;
        return false;
    }
    if (data == nullptr && length != 0) {
        status_ = CaptureStorageStatus::BadRequest;
        return false;
    }
    if (length == 0) {
        return true;
    }
    errno = 0;
    if (std::fwrite(data, 1, length, file_) != length) {
        status_ = captureStorageStatusFromErrno(errno);
        return false;
    }
    written_ += length;
    status_ = CaptureStorageStatus::Ok;
    return true;
}

bool PosixCaptureSink::flush() noexcept
{
    if (file_ == nullptr) {
        status_ = CaptureStorageStatus::NotOpen;
        return false;
    }
    errno = 0;
    if (std::fflush(file_) != 0) {
        status_ = captureStorageStatusFromErrno(errno);
        return false;
    }
    status_ = CaptureStorageStatus::Ok;
    return true;
}

void PosixCaptureSink::close() noexcept
{
    if (file_ != nullptr) {
        std::fclose(file_);
        file_ = nullptr;
    }
    written_ = 0;
    status_ = CaptureStorageStatus::NotOpen;
}

} // namespace lilyshark

#endif
