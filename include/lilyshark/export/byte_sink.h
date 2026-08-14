#pragma once

#include <cstddef>
#include <cstdint>

namespace lilyshark {

// A synchronous destination for encoded capture bytes. Implementations own
// their storage; encoders never allocate or retain the supplied buffer.
class ByteSink
{
  public:
    virtual ~ByteSink() = default;
    virtual bool write(const std::uint8_t *data, std::size_t length) noexcept = 0;
};

} // namespace lilyshark
