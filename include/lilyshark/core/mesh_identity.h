#pragma once

#include "lilyshark/protocols/meshtastic_encode.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Turn a 48-bit MAC (in the low 48 bits of `mac`) into a Meshtastic node
/// number. Never returns 0 or broadcast.
std::uint32_t deriveMeshtasticNodeNum(std::uint64_t mac) noexcept;

/// Active identity for this firmware instance. Until set, this is
/// `kLilysharkMeshtasticNodeNum` so host tests stay deterministic.
std::uint32_t localMeshtasticNodeNum() noexcept;
void setLocalMeshtasticNodeNum(std::uint32_t node_num) noexcept;

void formatLocalMeshtasticShortName(char *output, std::size_t capacity) noexcept;
void formatLocalMeshtasticLongName(char *output, std::size_t capacity) noexcept;

} // namespace lilyshark
