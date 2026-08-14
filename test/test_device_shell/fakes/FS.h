#pragma once

#include "device_shell_fake.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>

namespace fs {

class File {
  public:
    File() = default;
    explicit File(std::shared_ptr<device_shell_fake::FileData> data) noexcept
        : data_(std::move(data)), open_(data_ != nullptr)
    {
        position_ = data_ == nullptr ? 0 : data_->bytes.size();
    }

    explicit operator bool() const noexcept { return open_ && data_ != nullptr; }

    std::size_t write(const std::uint8_t *source, std::size_t length)
    {
        if(!*this || (source == nullptr && length != 0) ||
           device_shell_fake::state().fail_file_write) return 0;
        if(position_ + length > data_->bytes.size()) data_->bytes.resize(position_ + length);
        if(length != 0) std::memcpy(data_->bytes.data() + position_, source, length);
        position_ += length;
        return length;
    }

    void flush() noexcept {}

    std::size_t position() const noexcept { return position_; }

    std::size_t size() const noexcept
    {
        if(!data_) return 0;
        if(device_shell_fake::state().fail_file_flush && position_ != 0) return position_ - 1U;
        return data_->bytes.size();
    }

    void close() noexcept { open_ = false; }

  private:
    std::shared_ptr<device_shell_fake::FileData> data_{};
    std::size_t position_ = 0;
    bool open_ = false;
};

} // namespace fs
