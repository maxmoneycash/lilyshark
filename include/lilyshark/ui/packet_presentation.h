#pragma once

#include "lilyshark/core/frame_store.h"

namespace lilyshark {

const char *packetKindLabel(const DecodedPacket &packet) noexcept;
const char *decodeStateLabel(DecodeState state) noexcept;
bool contributesToNodeSummary(const FrameRecord &record) noexcept;

} // namespace lilyshark
