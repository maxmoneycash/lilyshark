#include "lilyshark/device/screenshot.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

namespace {

using namespace lilyshark;

class VectorSink final : public ByteSink
{
  public:
    bool write(const std::uint8_t *data, std::size_t length) noexcept override
    {
        if ((data == nullptr && length != 0) || bytes_.size() + length > limit_) {
            return false;
        }
        bytes_.insert(bytes_.end(), data, data + length);
        return true;
    }

    void setLimit(std::size_t limit) noexcept { limit_ = limit; }
    const std::vector<std::uint8_t> &bytes() const noexcept { return bytes_; }

  private:
    std::vector<std::uint8_t> bytes_{};
    std::size_t limit_ = static_cast<std::size_t>(-1);
};

std::uint32_t readLe32(const std::uint8_t *bytes)
{
    return static_cast<std::uint32_t>(bytes[0]) |
           (static_cast<std::uint32_t>(bytes[1]) << 8U) |
           (static_cast<std::uint32_t>(bytes[2]) << 16U) |
           (static_cast<std::uint32_t>(bytes[3]) << 24U);
}

void testExactTwoByTwoBmp()
{
    // Rows are top-down in memory. The stride pixel must not enter the output.
    const std::array<std::uint16_t, 6> pixels = {
        0xf800, 0x07e0, 0x1234,
        0x001f, 0xffff, 0x5678,
    };
    VectorSink sink;
    assert(writeRgb565Bmp(sink, pixels.data(), 2, 2, 3) == ScreenshotWriteResult::Ok);

    const std::array<std::uint8_t, 70> expected = {
        0x42, 0x4d, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x36, 0x00, 0x00, 0x00, 0x28, 0x00,
        0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x00,
        0x00, 0x00, 0x01, 0x00, 0x18, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x13, 0x0b,
        0x00, 0x00, 0x13, 0x0b, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // Bottom source row, BGR888, then two padding bytes.
        0xff, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00,
        // Top source row, BGR888, then two padding bytes.
        0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0x00, 0x00,
    };
    assert(sink.bytes().size() == expected.size());
    assert(std::equal(expected.begin(), expected.end(), sink.bytes().begin()));
}

struct RowSource {
    std::array<std::uint16_t, 6> pixels{};
    std::array<std::uint16_t, 3> requested_rows{};
    std::size_t requests = 0;
    bool fail = false;
};

bool readRow(void *opaque, std::uint16_t source_y, std::uint16_t *destination,
             std::uint16_t width) noexcept
{
    auto &source = *static_cast<RowSource *>(opaque);
    source.requested_rows[source.requests++] = source_y;
    if (source.fail) {
        return false;
    }
    std::copy_n(source.pixels.data() + static_cast<std::size_t>(source_y) * width,
                width, destination);
    return true;
}

void testStreamingRowsAreRequestedBottomUp()
{
    RowSource source{{0xf800, 0x07e0, 0x001f, 0xffff, 0x0000, 0x8410}};
    std::array<std::uint16_t, 2> row{};
    VectorSink sink;
    assert(writeRgb565Bmp(sink, 2, 3, readRow, &source, row.data(), row.size()) ==
           ScreenshotWriteResult::Ok);
    assert(source.requests == 3);
    assert((source.requested_rows == std::array<std::uint16_t, 3>{2, 1, 0}));
}

void testTDeckDimensionsAndExpandedLowBits()
{
    std::vector<std::uint16_t> pixels(
        static_cast<std::size_t>(kTDeckScreenshotWidth) * kTDeckScreenshotHeight, 0x0821);
    VectorSink sink;
    assert(writeRgb565Bmp(sink, pixels.data(), kTDeckScreenshotWidth,
                          kTDeckScreenshotHeight, kTDeckScreenshotWidth) ==
           ScreenshotWriteResult::Ok);
    assert(sink.bytes().size() == 54U + 320U * 3U * 240U);
    assert(readLe32(sink.bytes().data() + 2) == sink.bytes().size());
    assert(readLe32(sink.bytes().data() + 18) == 320);
    assert(readLe32(sink.bytes().data() + 22) == 240);
    assert(readLe32(sink.bytes().data() + 34) == 320U * 3U * 240U);

    // RGB565 0x0821 is R=1, G=1, B=1. Bit replication yields 8, 4, 8.
    assert(sink.bytes()[54] == 8);
    assert(sink.bytes()[55] == 4);
    assert(sink.bytes()[56] == 8);
}

void testErrors()
{
    const std::array<std::uint16_t, 1> pixel{0xffff};
    VectorSink sink;
    assert(writeRgb565Bmp(sink, nullptr, 1, 1, 1) ==
           ScreenshotWriteResult::InvalidArgument);
    assert(writeRgb565Bmp(sink, pixel.data(), 1, 1, 0) ==
           ScreenshotWriteResult::InvalidArgument);
    assert(writeRgb565Bmp(sink, pixel.data(), 0, 1, 1) ==
           ScreenshotWriteResult::InvalidArgument);
    assert(writeRgb565Bmp(sink, pixel.data(), 65535, 65535, 65535) ==
           ScreenshotWriteResult::ImageTooLarge);

    std::array<std::uint16_t, 1> row{};
    assert(writeRgb565Bmp(sink, 1, 1, nullptr, nullptr, row.data(), row.size()) ==
           ScreenshotWriteResult::InvalidArgument);
    assert(writeRgb565Bmp(sink, 2, 1, readRow, nullptr, row.data(), row.size()) ==
           ScreenshotWriteResult::InvalidArgument);

    RowSource source{};
    source.fail = true;
    VectorSink source_sink;
    assert(writeRgb565Bmp(source_sink, 1, 1, readRow, &source, row.data(), row.size()) ==
           ScreenshotWriteResult::SourceError);
    assert(source_sink.bytes().size() == 54);

    VectorSink limited_sink;
    limited_sink.setLimit(53);
    assert(writeRgb565Bmp(limited_sink, pixel.data(), 1, 1, 1) ==
           ScreenshotWriteResult::SinkError);
    assert(limited_sink.bytes().empty());
}

} // namespace

int main()
{
    testExactTwoByTwoBmp();
    testStreamingRowsAreRequestedBottomUp();
    testTDeckDimensionsAndExpandedLowBits();
    testErrors();
    std::puts("screenshot tests passed");
    return 0;
}
