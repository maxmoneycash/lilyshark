#include "lilyshark/device/screenshot.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace lilyshark {
namespace {

constexpr std::size_t kBmpHeaderSize = 54;
constexpr std::size_t kPixelsPerOutputChunk = 32;

void putLe16(std::uint8_t *destination, std::uint16_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8U);
}

void putLe32(std::uint8_t *destination, std::uint32_t value) noexcept
{
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8U);
    destination[2] = static_cast<std::uint8_t>(value >> 16U);
    destination[3] = static_cast<std::uint8_t>(value >> 24U);
}

std::uint8_t expand5(std::uint16_t value) noexcept
{
    return static_cast<std::uint8_t>((value << 3U) | (value >> 2U));
}

std::uint8_t expand6(std::uint16_t value) noexcept
{
    return static_cast<std::uint8_t>((value << 2U) | (value >> 4U));
}

bool imageLayout(std::uint16_t width, std::uint16_t height,
                 std::uint32_t &row_size, std::uint32_t &image_size,
                 std::uint32_t &file_size) noexcept
{
    if (width == 0 || height == 0) {
        return false;
    }

    const std::uint64_t raw_row_size = static_cast<std::uint64_t>(width) * 3U;
    const std::uint64_t aligned_row_size = (raw_row_size + 3U) & ~std::uint64_t{3U};
    const std::uint64_t total_image_size = aligned_row_size * height;
    const std::uint64_t total_file_size = kBmpHeaderSize + total_image_size;
    if (total_file_size > std::numeric_limits<std::uint32_t>::max()) {
        return false;
    }

    row_size = static_cast<std::uint32_t>(aligned_row_size);
    image_size = static_cast<std::uint32_t>(total_image_size);
    file_size = static_cast<std::uint32_t>(total_file_size);
    return true;
}

ScreenshotWriteResult writeHeader(ByteSink &sink, std::uint16_t width,
                                  std::uint16_t height, std::uint32_t image_size,
                                  std::uint32_t file_size) noexcept
{
    std::array<std::uint8_t, kBmpHeaderSize> header{};
    header[0] = 'B';
    header[1] = 'M';
    putLe32(header.data() + 2, file_size);
    putLe32(header.data() + 10, kBmpHeaderSize);
    putLe32(header.data() + 14, 40);
    putLe32(header.data() + 18, width);
    putLe32(header.data() + 22, height);
    putLe16(header.data() + 26, 1);
    putLe16(header.data() + 28, 24);
    putLe32(header.data() + 34, image_size);
    putLe32(header.data() + 38, 2835);
    putLe32(header.data() + 42, 2835);
    return sink.write(header.data(), header.size()) ? ScreenshotWriteResult::Ok
                                                    : ScreenshotWriteResult::SinkError;
}

ScreenshotWriteResult writeRow(ByteSink &sink, const std::uint16_t *pixels,
                               std::uint16_t width, std::uint32_t row_size) noexcept
{
    std::array<std::uint8_t, kPixelsPerOutputChunk * 3U> output{};
    std::size_t x = 0;
    while (x < width) {
        const std::size_t remaining = static_cast<std::size_t>(width) - x;
        const std::size_t pixel_count = remaining < kPixelsPerOutputChunk
                                            ? remaining
                                            : kPixelsPerOutputChunk;
        for (std::size_t index = 0; index < pixel_count; ++index) {
            const std::uint16_t pixel = pixels[x + index];
            output[index * 3U] = expand5(pixel & 0x1FU);
            output[index * 3U + 1U] = expand6((pixel >> 5U) & 0x3FU);
            output[index * 3U + 2U] = expand5((pixel >> 11U) & 0x1FU);
        }
        if (!sink.write(output.data(), pixel_count * 3U)) {
            return ScreenshotWriteResult::SinkError;
        }
        x += pixel_count;
    }

    constexpr std::array<std::uint8_t, 3> padding{};
    const std::size_t padding_size = row_size - static_cast<std::uint32_t>(width) * 3U;
    if (padding_size != 0 && !sink.write(padding.data(), padding_size)) {
        return ScreenshotWriteResult::SinkError;
    }
    return ScreenshotWriteResult::Ok;
}

} // namespace

ScreenshotWriteResult writeRgb565Bmp(ByteSink &sink, const std::uint16_t *pixels,
                                     std::uint16_t width, std::uint16_t height,
                                     std::size_t stride_pixels) noexcept
{
    if (pixels == nullptr || stride_pixels < width || width == 0 || height == 0) {
        return ScreenshotWriteResult::InvalidArgument;
    }

    std::uint32_t row_size = 0;
    std::uint32_t image_size = 0;
    std::uint32_t file_size = 0;
    if (!imageLayout(width, height, row_size, image_size, file_size)) {
        return ScreenshotWriteResult::ImageTooLarge;
    }
    ScreenshotWriteResult result = writeHeader(sink, width, height, image_size, file_size);
    if (result != ScreenshotWriteResult::Ok) {
        return result;
    }

    for (std::size_t file_row = 0; file_row < height; ++file_row) {
        const std::size_t source_y = static_cast<std::size_t>(height) - 1U - file_row;
        result = writeRow(sink, pixels + source_y * stride_pixels, width, row_size);
        if (result != ScreenshotWriteResult::Ok) {
            return result;
        }
    }
    return ScreenshotWriteResult::Ok;
}

ScreenshotWriteResult writeRgb565Bmp(ByteSink &sink, std::uint16_t width,
                                     std::uint16_t height, Rgb565RowReader reader,
                                     void *context, std::uint16_t *row_buffer,
                                     std::size_t row_buffer_pixels) noexcept
{
    if (reader == nullptr || row_buffer == nullptr || row_buffer_pixels < width ||
        width == 0 || height == 0) {
        return ScreenshotWriteResult::InvalidArgument;
    }

    std::uint32_t row_size = 0;
    std::uint32_t image_size = 0;
    std::uint32_t file_size = 0;
    if (!imageLayout(width, height, row_size, image_size, file_size)) {
        return ScreenshotWriteResult::ImageTooLarge;
    }
    ScreenshotWriteResult result = writeHeader(sink, width, height, image_size, file_size);
    if (result != ScreenshotWriteResult::Ok) {
        return result;
    }

    for (std::size_t file_row = 0; file_row < height; ++file_row) {
        const auto source_y = static_cast<std::uint16_t>(height - 1U - file_row);
        if (!reader(context, source_y, row_buffer, width)) {
            return ScreenshotWriteResult::SourceError;
        }
        result = writeRow(sink, row_buffer, width, row_size);
        if (result != ScreenshotWriteResult::Ok) {
            return result;
        }
    }
    return ScreenshotWriteResult::Ok;
}

} // namespace lilyshark

#if defined(LILYSHARK_DEVICE)

#include "lilyshark/tdeck.h"

#include <Arduino.h>
#include <FS.h>
#include <SD.h>
#include <TFT_eSPI.h>

#include <cstdio>
#include <cstdlib>

namespace lilyshark {
namespace {

class ScreenshotFileSink final : public ByteSink
{
  public:
    explicit ScreenshotFileSink(fs::File file) noexcept : file_(file) {}

    bool write(const std::uint8_t *data, std::size_t length) noexcept override
    {
        if (!file_ || (data == nullptr && length != 0)) {
            return false;
        }
        return length == 0 || file_.write(data, length) == length;
    }

    void close() noexcept
    {
        if (file_) {
            file_.flush();
            file_.close();
        }
    }

  private:
    fs::File file_{};
};

struct DisplayRowContext {
    TFT_eSPI &display;
};

bool readDisplayRow(void *opaque, std::uint16_t source_y,
                    std::uint16_t *destination, std::uint16_t width) noexcept
{
    auto &context = *static_cast<DisplayRowContext *>(opaque);
    digitalWrite(tdeck::sd_cs_pin, HIGH);
    digitalWrite(tdeck::radio_cs_pin, HIGH);
    context.display.readRect(0, source_y, width, 1, destination);
    digitalWrite(tdeck::display_cs_pin, HIGH);

    // TFT_eSPI readRect returns byte-swapped RGB565 so the same buffer can be
    // passed directly to pushRect. The BMP encoder consumes native RGB565.
    for (std::size_t x = 0; x < width; ++x) {
        destination[x] = static_cast<std::uint16_t>((destination[x] << 8U) |
                                                    (destination[x] >> 8U));
    }
    return true;
}

bool chooseScreenshotPath(char *path, std::size_t path_capacity) noexcept
{
    if (!SD.exists("/lilyshark") && !SD.mkdir("/lilyshark")) {
        return false;
    }
    for (unsigned index = 1; index <= 9999; ++index) {
        const int written = std::snprintf(path, path_capacity,
                                          "/lilyshark/screenshot-%04u.bmp", index);
        if (written <= 0 || static_cast<std::size_t>(written) >= path_capacity) {
            path[0] = '\0';
            return false;
        }
        if (!SD.exists(path)) {
            return true;
        }
    }
    path[0] = '\0';
    return false;
}

} // namespace

ScreenshotWriteResult saveTDeckScreenshot(TFT_eSPI &display, char *saved_path,
                                          std::size_t saved_path_capacity) noexcept
{
    if (saved_path == nullptr || saved_path_capacity == 0) {
        return ScreenshotWriteResult::InvalidArgument;
    }
    saved_path[0] = '\0';
    if (!chooseScreenshotPath(saved_path, saved_path_capacity)) {
        return ScreenshotWriteResult::StorageError;
    }

    auto *row = static_cast<std::uint16_t *>(
        ps_malloc(kTDeckScreenshotWidth * sizeof(std::uint16_t)));
    if (row == nullptr) {
        row = static_cast<std::uint16_t *>(
            std::malloc(kTDeckScreenshotWidth * sizeof(std::uint16_t)));
    }
    if (row == nullptr) {
        saved_path[0] = '\0';
        return ScreenshotWriteResult::OutOfMemory;
    }

    digitalWrite(tdeck::display_cs_pin, HIGH);
    digitalWrite(tdeck::radio_cs_pin, HIGH);
    fs::File file = SD.open(saved_path, FILE_WRITE);
    if (!file) {
        std::free(row);
        saved_path[0] = '\0';
        return ScreenshotWriteResult::StorageError;
    }

    ScreenshotFileSink sink(file);
    DisplayRowContext context{display};
    const ScreenshotWriteResult result =
        writeRgb565Bmp(sink, kTDeckScreenshotWidth, kTDeckScreenshotHeight,
                       readDisplayRow, &context, row, kTDeckScreenshotWidth);
    sink.close();
    std::free(row);

    if (result != ScreenshotWriteResult::Ok) {
        SD.remove(saved_path);
        saved_path[0] = '\0';
    }
    return result;
}

} // namespace lilyshark

#endif
