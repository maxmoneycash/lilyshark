#pragma once

#include <cstddef>

namespace lilyshark {

/// Reassembles newline-delimited analyzer commands across BLE writes. A bad
/// line is discarded through its delimiter so a valid suffix cannot execute.
class LskLineAssembler {
public:
    static constexpr std::size_t kCapacity = 240;

    void reset() noexcept
    {
        length_ = 0;
        discarding_ = false;
    }

    template <typename Sink>
    void feed(const char *bytes, std::size_t count, Sink sink) noexcept
    {
        if (bytes == nullptr) return;
        for (std::size_t i = 0; i < count; ++i) {
            const unsigned char byte = static_cast<unsigned char>(bytes[i]);
            if (byte == '\n' || byte == '\r') {
                if (!discarding_ && length_ > 0) {
                    line_[length_] = '\0';
                    sink(line_);
                }
                reset();
            } else if (discarding_) {
                continue;
            } else if (byte < 0x20 || length_ + 1 >= kCapacity) {
                length_ = 0;
                discarding_ = true;
            } else {
                line_[length_++] = static_cast<char>(byte);
            }
        }
    }

private:
    char line_[kCapacity]{};
    std::size_t length_ = 0;
    bool discarding_ = false;
};

}  // namespace lilyshark
