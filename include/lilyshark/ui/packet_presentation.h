#pragma once

#include "lilyshark/core/frame_store.h"

namespace lilyshark {

const char *packetKindLabel(const DecodedPacket &packet) noexcept;
const char *decodeStateLabel(DecodeState state) noexcept;
bool contributesToNodeSummary(const FrameRecord &record) noexcept;
bool contributesToExistingNodeCrcErrors(const FrameRecord &record, bool identity_established,
                                        ProtocolId protocol, std::uint32_t source) noexcept;
std::uint16_t incrementedNodeCrcErrorCount(std::uint16_t current) noexcept;

} // namespace lilyshark
