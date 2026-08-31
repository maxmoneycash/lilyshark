#pragma once

#include "lilyshark/protocols/meshcore_decoder.h"
#include "lilyshark/protocols/meshtastic_encode.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// MeshCore TX uses the same device identity the boot announce transmits:
/// the stable Lilyshark node number (kLilysharkMeshtasticNodeNum). There is
/// deliberately no second identity store.
inline constexpr std::uint32_t kLilysharkMeshCoreNodeId = kLilysharkMeshtasticNodeNum;

/// One-byte MeshCore path hash for a node id — the top byte, the same
/// derivation the web analyzer uses when it keys MeshCore contacts.
constexpr std::uint8_t meshCoreSourceHash(std::uint32_t node_id) noexcept
{
    return static_cast<std::uint8_t>(node_id >> 24U);
}

/// What this firmware can honestly put on air today. Signed adverts need an
/// Ed25519 keypair, DMs need ECDH-derived keys, and channel texts need a
/// channel key plus its MAC — none of which any code in this repository
/// models. A v1 RAW_CUSTOM frame is fully specified by our own MeshCore
/// decoder, needs no cryptography, and carries the device identity in the
/// clear, so it is the one frame the device can transmit without inventing
/// unverifiable bytes.
inline constexpr bool kMeshCoreRawTransmitReady = true;

/// Wire layout of the transmitted frame:
///   [0] header: version 1 (encoded 0), payload type RAW_CUSTOM, route flood
///   [1] encoded path length: empty (repeaters append hashes, senders do not)
///   [2..5] Lilyshark node id, little-endian — the RAW_CUSTOM identity tag
///   [6..]  UTF-8 text, no terminator
inline constexpr std::uint8_t kMeshCoreRawTextWireHeader =
    static_cast<std::uint8_t>((static_cast<std::uint8_t>(MeshCorePayloadType::RawCustom) << 2U) |
                              static_cast<std::uint8_t>(MeshCoreRouteType::Flood));
inline constexpr std::size_t kMeshCoreRawTextEnvelopeBytes = 2;
inline constexpr std::size_t kMeshCoreRawTextIdBytes = 4;
inline constexpr std::size_t kMeshCoreMaxRawTextBytes =
    MeshCoreDecoder::kMaxPayloadBytes - kMeshCoreRawTextIdBytes;

/// Build a complete v1 RAW_CUSTOM flood frame carrying the node id and text.
/// Returns the frame length, or 0 when the node id is zero, the text is
/// empty or longer than kMeshCoreMaxRawTextBytes, or the buffer is too small.
std::size_t encodeMeshCoreRawText(std::uint32_t node_id, const char *text,
                                  std::uint8_t *out, std::size_t out_size) noexcept;

} // namespace lilyshark
