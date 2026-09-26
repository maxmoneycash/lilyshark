#pragma once

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Stages one outgoing LSK record before committing it to a byte queue. When
/// the queue is full or a record is too long, the whole record is dropped;
/// fragments of a failed record never reach a client.
template <std::size_t Capacity>
class LskTxLineFramer {
public:
    void reset() noexcept
    {
        length_ = 0;
        discarding_ = false;
    }

    template <typename Sink>
    bool feed(const std::uint8_t *bytes, std::size_t count, Sink sink) noexcept
    {
        if (bytes == nullptr || count == 0) return false;
        bool accepted = true;
        for (std::size_t i = 0; i < count; ++i) {
            const std::uint8_t byte = bytes[i];
            if (byte == '\n') {
                if (discarding_) {
                    accepted = false;
                } else if (length_ > 0) {
                    line_[length_++] = '\n';
                    if (!sink(line_, length_)) accepted = false;
                }
                reset();
            } else if (discarding_) {
                continue;
            } else if (length_ + 1 >= Capacity) {
                // Reserve one byte for the final newline.
                length_ = 0;
                discarding_ = true;
                accepted = false;
            } else {
                line_[length_++] = byte;
            }
        }
        return accepted;
    }

private:
    std::uint8_t line_[Capacity]{};
    std::size_t length_ = 0;
    bool discarding_ = false;
};

}  // namespace lilyshark
