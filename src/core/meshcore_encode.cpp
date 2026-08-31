#include "lilyshark/protocols/meshcore_encode.h"

#include <cstring>

namespace lilyshark {

static_assert(kMeshCoreRawTextWireHeader == 0x3d,
              "v1 RAW_CUSTOM flood header must match the decoder's bit layout");
static_assert(kMeshCoreRawTextEnvelopeBytes + kMeshCoreRawTextIdBytes +
                      kMeshCoreMaxRawTextBytes <= kMaxFrameBytes,
              "a full raw text frame must fit the SX1262 packet buffer");

std::size_t encodeMeshCoreRawText(std::uint32_t node_id, const char *text,
                                  std::uint8_t *out, std::size_t out_size) noexcept
{
    if (out == nullptr || node_id == 0 || text == nullptr || text[0] == '\0') {
        return 0;
    }
    const std::size_t text_length = std::strlen(text);
    if (text_length > kMeshCoreMaxRawTextBytes) {
        return 0;
    }
    const std::size_t frame_length =
        kMeshCoreRawTextEnvelopeBytes + kMeshCoreRawTextIdBytes + text_length;
    if (frame_length > out_size) {
        return 0;
    }

    out[0] = kMeshCoreRawTextWireHeader;
    out[1] = 0; // Empty path: repeaters append hashes; the sender never does.
    out[2] = static_cast<std::uint8_t>(node_id);
    out[3] = static_cast<std::uint8_t>(node_id >> 8U);
    out[4] = static_cast<std::uint8_t>(node_id >> 16U);
    out[5] = static_cast<std::uint8_t>(node_id >> 24U);
    std::memcpy(out + kMeshCoreRawTextEnvelopeBytes + kMeshCoreRawTextIdBytes, text, text_length);
    return frame_length;
}

} // namespace lilyshark
