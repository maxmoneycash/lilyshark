// The capture writer against a real filesystem.
//
// Until this file existed, nothing anywhere ran the .lscap path end to end.
// The format had byte-exact tests against an in-memory buffer, the T-Deck sink
// had tests against a fake SD card, and scripts/lscap.py had tests against a
// golden record pasted in from the encoder. No test took a frame, put it
// through a file, and read the file back -- so the numbering, the directory
// creation, the flush and the byte stream had never been checked against each
// other on any machine. The deck's card slot was the only place they would
// ever have met, and the deck has never had a card in it.

#include "lilyshark/export/lilyshark_capture.h"
#include "lilyshark/export/posix_capture_sink.h"

#include <array>
#include <cassert>
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace {

using namespace lilyshark;

// Collects the same bytes in memory, so the file can be compared against what
// the writer believes it emitted.
class MemorySink final : public ByteSink
{
  public:
    bool write(const std::uint8_t *data, std::size_t length) noexcept override
    {
        if (data == nullptr && length != 0) {
            return false;
        }
        bytes_.insert(bytes_.end(), data, data + length);
        return true;
    }

    const std::vector<std::uint8_t> &bytes() const noexcept { return bytes_; }

  private:
    std::vector<std::uint8_t> bytes_{};
};

std::string makeScratchDirectory()
{
    const char *base = std::getenv("TMPDIR");
    std::string pattern = (base != nullptr && base[0] != '\0') ? base : "/tmp";
    if (pattern.back() == '/') {
        pattern.pop_back();
    }
    pattern += "/lilyshark-sink.XXXXXX";
    std::vector<char> buffer(pattern.begin(), pattern.end());
    buffer.push_back('\0');
    const char *made = ::mkdtemp(buffer.data());
    assert(made != nullptr);
    return std::string(made);
}

void removeTree(const std::string &path)
{
    // Only ever called on directories this test made.
    const std::string command = "rm -rf '" + path + "'";
    (void)std::system(command.c_str());
}

RawFrame makeFrame(std::uint16_t seed)
{
    RawFrame frame{};
    const std::uint8_t payload[] = {static_cast<std::uint8_t>(seed),
                                    static_cast<std::uint8_t>(seed >> 8), 0x5a, 0xa5};
    assert(frame.assignPayload(payload, sizeof(payload)));
    frame.original_length = static_cast<std::uint16_t>(sizeof(payload));
    frame.rf.timestamp_us = 1000ULL * seed;
    frame.rf.center_frequency_hz = 913125000U;
    frame.rf.bandwidth_hz = 250000U;
    frame.rf.spreading_factor = 9;
    frame.rf.coding_rate_denominator = 5;
    frame.rf.rssi_dbm_x10 = -1005;
    frame.rf.snr_db_x10 = 63;
    return frame;
}

std::vector<std::uint8_t> readFile(const std::string &path)
{
    std::FILE *file = std::fopen(path.c_str(), "rb");
    assert(file != nullptr);
    std::vector<std::uint8_t> bytes;
    std::uint8_t chunk[1024];
    std::size_t got = 0;
    while ((got = std::fread(chunk, 1, sizeof(chunk), file)) != 0) {
        bytes.insert(bytes.end(), chunk, chunk + got);
    }
    std::fclose(file);
    return bytes;
}

// The end-to-end run the format never had: encoder -> sink -> file -> bytes.
// If the file on disk differs from what the writer handed the sink by even one
// byte, the capture the deck writes is not the capture the tests describe.
void aWrittenCaptureMatchesTheWriterByteForByte(const std::string &root)
{
    MemorySink memory{};
    LilysharkCaptureWriter memory_writer{memory};
    PosixCaptureSink sink{};
    LilysharkCaptureWriter file_writer{sink};

    char path[512]{};
    assert(sink.openNextCapture(root.c_str(), path, sizeof(path), kLilysharkCaptureExtension));
    assert(sink.status() == CaptureStorageStatus::Ok);

    assert(memory_writer.begin() == LilysharkCaptureWriteResult::Ok);
    assert(file_writer.begin() == LilysharkCaptureWriteResult::Ok);
    for (std::uint16_t index = 0; index < 32; ++index) {
        const RawFrame frame = makeFrame(index);
        assert(memory_writer.write(frame) == LilysharkCaptureWriteResult::Ok);
        assert(file_writer.write(frame) == LilysharkCaptureWriteResult::Ok);
    }
    assert(sink.flush());
    const std::size_t reported = sink.bytesWritten();
    sink.close();

    const std::vector<std::uint8_t> on_disk = readFile(path);
    assert(on_disk.size() == memory.bytes().size());
    assert(on_disk.size() == reported);
    assert(std::memcmp(on_disk.data(), memory.bytes().data(), on_disk.size()) == 0);

    // The header the reader keys on actually reached the medium.
    assert(on_disk.size() > 4);
    assert(on_disk[0] == 'L' && on_disk[1] == 'S' && on_disk[2] == 'C' && on_disk[3] == 'P');
}

// A second session must not land on the first session's file. Overwriting
// capture-0001 would destroy an earlier capture without a word, which on a
// card carried back from the field is the whole recording.
void eachSessionTakesTheNextFreeNumber(const std::string &root)
{
    for (unsigned expected = 1; expected <= 3; ++expected) {
        PosixCaptureSink sink{};
        char path[512]{};
        assert(sink.openNextCapture(root.c_str(), path, sizeof(path),
                                    kLilysharkCaptureExtension));
        char wanted[512]{};
        std::snprintf(wanted, sizeof(wanted), "%s/lilyshark/capture-%04u%s", root.c_str(),
                      expected, kLilysharkCaptureExtension);
        assert(std::strcmp(path, wanted) == 0);
        // Leave a byte behind so the name is genuinely taken on the next pass.
        const std::uint8_t marker = 0x4c;
        assert(sink.write(&marker, 1));
        assert(sink.flush());
        sink.close();
    }
}

// The directory is created on demand, because a fresh card has no /lilyshark
// on it and the deck must not need one prepared by hand.
void theCaptureDirectoryIsCreatedOnDemand(const std::string &root)
{
    const std::string nested = root + "/fresh-card";
    assert(::mkdir(nested.c_str(), 0775) == 0);
    struct stat before {};
    assert(::stat((nested + "/lilyshark").c_str(), &before) != 0);

    PosixCaptureSink sink{};
    char path[512]{};
    assert(sink.openNextCapture(nested.c_str(), path, sizeof(path), kLilysharkCaptureExtension));
    sink.close();

    struct stat after {};
    assert(::stat((nested + "/lilyshark").c_str(), &after) == 0);
    assert(S_ISDIR(after.st_mode));
}

// A refused directory must arrive as a refused directory, not as the generic
// "unavailable" that used to cover it.
void aRefusedDirectoryIsNamedAsOne(const std::string &root)
{
    // A regular file where /lilyshark wants to be: mkdir fails with EEXIST,
    // and then the open fails with ENOTDIR.
    const std::string blocked = root + "/blocked-root";
    assert(::mkdir(blocked.c_str(), 0775) == 0);
    std::FILE *occupied = std::fopen((blocked + "/lilyshark").c_str(), "wb");
    assert(occupied != nullptr);
    std::fclose(occupied);

    PosixCaptureSink sink{};
    char path[512]{};
    assert(!sink.openNextCapture(blocked.c_str(), path, sizeof(path),
                                 kLilysharkCaptureExtension));
    assert(sink.status() == CaptureStorageStatus::CardStoppedAnswering ||
           sink.status() == CaptureStorageStatus::DirectoryRefused);
    // Whatever it is, it is not silence and not a bare "not open".
    assert(sink.status() != CaptureStorageStatus::NotOpen);
    assert(path[0] == '\0');
}

// A read-only mount is the "card present but unwritable" case the brief asks
// to separate from "no card". Skipped when the tests run as root, since root
// ignores the permission bits.
void aReadOnlyRootRefusesTheWrite(const std::string &root)
{
    if (::geteuid() == 0) {
        std::printf("  (skipping read-only case: running as root)\n");
        return;
    }
    const std::string locked = root + "/read-only";
    assert(::mkdir(locked.c_str(), 0500) == 0);

    PosixCaptureSink sink{};
    char path[512]{};
    assert(!sink.openNextCapture(locked.c_str(), path, sizeof(path),
                                 kLilysharkCaptureExtension));
    // EACCES on the mkdir: the medium is there and refused to hold the folder.
    assert(sink.status() == CaptureStorageStatus::DirectoryRefused);
    assert(std::strcmp(captureStorageStatusLabel(sink.status()),
                       captureStorageStatusLabel(CaptureStorageStatus::NoCard)) != 0);
    (void)::chmod(locked.c_str(), 0755);
}

// errno is where an ordinary filesystem states its case, and each case must
// keep its own name on the way into the storage vocabulary.
void errnoKeepsItsMeaning()
{
    assert(captureStorageStatusFromErrno(ENOSPC) == CaptureStorageStatus::CardFull);
    assert(captureStorageStatusFromErrno(EROFS) == CaptureStorageStatus::WriteRefused);
    assert(captureStorageStatusFromErrno(EACCES) == CaptureStorageStatus::WriteRefused);
    assert(captureStorageStatusFromErrno(EIO) == CaptureStorageStatus::CardStoppedAnswering);
    assert(captureStorageStatusFromErrno(ENOENT) == CaptureStorageStatus::CardStoppedAnswering);
    assert(captureStorageStatusFromErrno(ENAMETOOLONG) == CaptureStorageStatus::PathTooLong);
    // A full card and a pulled card cost the operator different things, so
    // they must never collapse into each other.
    assert(captureStorageStatusFromErrno(ENOSPC) != captureStorageStatusFromErrno(EIO));
}

// Writing with no file open is its own answer, not a silent success.
void aClosedSinkRefusesBytes(const std::string &root)
{
    PosixCaptureSink sink{};
    const std::uint8_t byte = 0x11;
    assert(!sink.write(&byte, 1));
    assert(sink.status() == CaptureStorageStatus::NotOpen);
    assert(!sink.flush());
    assert(sink.status() == CaptureStorageStatus::NotOpen);

    char path[512]{};
    assert(sink.openNextCapture(root.c_str(), path, sizeof(path), kLilysharkCaptureExtension));
    assert(sink.write(&byte, 1));
    sink.close();
    // After close it is shut again, so a late write cannot look accepted.
    assert(!sink.write(&byte, 1));
    assert(sink.status() == CaptureStorageStatus::NotOpen);
}

// A path buffer too small for the generated name must say so rather than
// writing a truncated path to a file nobody can find again.
void aTooShortPathBufferIsNamed(const std::string &root)
{
    PosixCaptureSink sink{};
    char path[8]{};
    assert(!sink.openNextCapture(root.c_str(), path, sizeof(path), kLilysharkCaptureExtension));
    assert(sink.status() == CaptureStorageStatus::PathTooLong);
    assert(path[0] == '\0');
    assert(!sink.isOpen());
}

// Nonsense arguments are rejected as nonsense, not as a card fault: an
// operator sent to check the card over a caller's bug has been misdirected.
void animpossibleRequestIsNotACardFault(const std::string &root)
{
    PosixCaptureSink sink{};
    char path[512]{};
    assert(!sink.openNextCapture(nullptr, path, sizeof(path), kLilysharkCaptureExtension));
    assert(sink.status() == CaptureStorageStatus::BadRequest);
    assert(!sink.openNextCapture(root.c_str(), path, sizeof(path), "lscap"));
    assert(sink.status() == CaptureStorageStatus::BadRequest);
    assert(!sink.openNextCapture(root.c_str(), nullptr, 0, kLilysharkCaptureExtension));
    assert(sink.status() == CaptureStorageStatus::BadRequest);
}

} // namespace

int main()
{
    const std::string root = makeScratchDirectory();

    aWrittenCaptureMatchesTheWriterByteForByte(root + "");
    theCaptureDirectoryIsCreatedOnDemand(root);
    aRefusedDirectoryIsNamedAsOne(root);
    aReadOnlyRootRefusesTheWrite(root);
    errnoKeepsItsMeaning();
    aTooShortPathBufferIsNamed(root);
    animpossibleRequestIsNotACardFault(root);

    // Numbering gets its own directory so the files above do not shift it.
    const std::string numbering = root + "/numbering";
    assert(::mkdir(numbering.c_str(), 0775) == 0);
    eachSessionTakesTheNextFreeNumber(numbering);

    const std::string closed = root + "/closed";
    assert(::mkdir(closed.c_str(), 0775) == 0);
    aClosedSinkRefusesBytes(closed);

    removeTree(root);
    std::printf("Posix capture sink tests passed\n");
    return 0;
}
