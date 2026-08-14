#pragma once

#include "lilyshark/core/decoded_packet.h"
#include "lilyshark/core/raw_frame.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

struct FrameRecord {
    std::uint64_t sequence = 0;
    RawFrame raw{};
    DecodedPacket decoded{};
};

template <std::size_t Capacity> class FrameStore
{
    static_assert(Capacity > 0, "FrameStore capacity must be greater than zero");

  public:
    std::uint64_t push(const RawFrame &raw, const DecodedPacket &decoded) noexcept
    {
        FrameRecord &record = records_[next_index_];
        record.sequence = next_sequence_++;
        record.raw = raw;
        record.decoded = decoded;

        next_index_ = (next_index_ + 1) % Capacity;
        if (size_ < Capacity) {
            ++size_;
        } else {
            ++dropped_count_;
        }
        return record.sequence;
    }

    const FrameRecord *at(std::size_t index_from_oldest) const noexcept
    {
        if (index_from_oldest >= size_) {
            return nullptr;
        }
        const std::size_t oldest_index = size_ == Capacity ? next_index_ : 0;
        return &records_[(oldest_index + index_from_oldest) % Capacity];
    }

    const FrameRecord *newest(std::size_t offset = 0) const noexcept
    {
        if (offset >= size_) {
            return nullptr;
        }
        return at(size_ - 1 - offset);
    }

    void clear() noexcept
    {
        size_ = 0;
        next_index_ = 0;
        next_sequence_ = 1;
        dropped_count_ = 0;
    }

    std::size_t size() const noexcept { return size_; }
    constexpr std::size_t capacity() const noexcept { return Capacity; }
    std::uint64_t droppedCount() const noexcept { return dropped_count_; }
    std::uint64_t totalSeen() const noexcept { return next_sequence_ - 1; }
    bool empty() const noexcept { return size_ == 0; }

  private:
    FrameRecord records_[Capacity]{};
    std::size_t size_ = 0;
    std::size_t next_index_ = 0;
    std::uint64_t next_sequence_ = 1;
    std::uint64_t dropped_count_ = 0;
};

} // namespace lilyshark
