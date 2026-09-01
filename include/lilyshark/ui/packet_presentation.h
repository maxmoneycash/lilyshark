#pragma once

#include "lilyshark/core/frame_store.h"

namespace lilyshark {

const char *packetKindLabel(const DecodedPacket &packet) noexcept;
const char *decodeStateLabel(DecodeState state) noexcept;

/// How a decoded payload was read, per frame — the key *state*, never key
/// material. "DEFAULT KEY" is the published PSK and means the traffic was
/// never private; "STORED KEY" means an operator-entered channel key read it,
/// and the key's name comes from the key store by
/// `DecodedPacket::channel_key_slot`. "NO KEY MATCH" is the honest label for
/// bytes that stayed opaque.
const char *packetKeyStateLabel(const DecodedPacket &packet) noexcept;
bool contributesToNodeSummary(const FrameRecord &record) noexcept;
bool contributesToExistingNodeCrcErrors(const FrameRecord &record, bool identity_established,
                                        ProtocolId protocol, std::uint32_t source) noexcept;
std::uint16_t incrementedNodeCrcErrorCount(std::uint16_t current) noexcept;

} // namespace lilyshark
