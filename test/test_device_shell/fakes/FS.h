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
        if(data_ != nullptr) data_->is_open = true;
    }

    explicit operator bool() const noexcept
    {
        return open_ && data_ != nullptr && data_->is_open;
    }

    std::size_t write(const std::uint8_t *source, std::size_t length)
    {
        auto &card = device_shell_fake::state();
        if(!*this || (source == nullptr && length != 0) || card.fail_file_write) return 0;
        // A pulled card and a read-only one both refuse the bytes. They are
        // told apart by what happens NEXT -- see SDClass::exists and
        // totalBytes -- not by the write itself, which is exactly the
        // situation the firmware has to diagnose.
        if(card.sd_removed || card.sd_write_refused) return 0;
        // A full card takes nothing and stays exactly as full as it was.
        if(card.sd_used_bytes + length > card.sd_total_bytes) return 0;
        card.sd_used_bytes += length;
        if(position_ + length > data_->bytes.size()) data_->bytes.resize(position_ + length);
        if(length != 0) std::memcpy(data_->bytes.data() + position_, source, length);
        position_ += length;
        return length;
    }

    std::size_t read(std::uint8_t *destination, std::size_t length)
    {
        if(!*this || destination == nullptr || length == 0) return 0;
        if(position_ > data_->bytes.size()) return 0;
        const std::size_t available = data_->bytes.size() - position_;
        const std::size_t got = length < available ? length : available;
        if(got != 0) std::memcpy(destination, data_->bytes.data() + position_, got);
        position_ += got;
        return got;
    }

    void flush() noexcept
    {
        if(*this) ++data_->flush_calls;
    }

    std::size_t position() const noexcept { return position_; }

    std::size_t size() const noexcept
    {
        if(!data_) return 0;
        if(device_shell_fake::state().fail_file_flush && position_ != 0) return position_ - 1U;
        return data_->bytes.size();
    }

    void close() noexcept
    {
        if(*this) {
            data_->is_open = false;
            ++data_->close_calls;
        }
        open_ = false;
    }

  private:
    std::shared_ptr<device_shell_fake::FileData> data_{};
    std::size_t position_ = 0;
    bool open_ = false;
};

} // namespace fs
