#pragma once

#include "lilyshark/export/byte_sink.h"

#include <cstddef>
#include <cstdint>

#if defined(LILYSHARK_DEVICE)
class TFT_eSPI;
#endif

namespace lilyshark {

inline constexpr std::uint16_t kTDeckScreenshotWidth = 320;
inline constexpr std::uint16_t kTDeckScreenshotHeight = 240;

enum class ScreenshotWriteResult : std::uint8_t {
    Ok,
    InvalidArgument,
    ImageTooLarge,
    SourceError,
    SinkError,
    StorageError,
    OutOfMemory,
};

// Fills destination with one top-down RGB565 source row. The encoder requests
// rows in BMP file order, from the bottom of the image to the top.
using Rgb565RowReader = bool (*)(void *context, std::uint16_t source_y,
                                 std::uint16_t *destination,
                                 std::uint16_t width) noexcept;

// Encodes a top-down RGB565 image as a bottom-up, uncompressed 24-bit BMP.
// stride_pixels may exceed width when the source has padded rows.
ScreenshotWriteResult writeRgb565Bmp(ByteSink &sink, const std::uint16_t *pixels,
                                     std::uint16_t width, std::uint16_t height,
                                     std::size_t stride_pixels) noexcept;

// Streaming form for sources such as a display controller. row_buffer belongs
// to the caller and must hold at least width RGB565 pixels.
ScreenshotWriteResult writeRgb565Bmp(ByteSink &sink, std::uint16_t width,
                                     std::uint16_t height, Rgb565RowReader reader,
                                     void *context, std::uint16_t *row_buffer,
                                     std::size_t row_buffer_pixels) noexcept;

#if defined(LILYSHARK_DEVICE)

// Call synchronously from the main loop after SD has been mounted. The helper
// stores the current 320x240 display as /lilyshark/screenshot-####.bmp.
ScreenshotWriteResult saveTDeckScreenshot(TFT_eSPI &display, char *saved_path,
                                          std::size_t saved_path_capacity) noexcept;

#endif

} // namespace lilyshark
