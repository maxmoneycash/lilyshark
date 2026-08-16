#pragma once

#include "lilyshark/core/decoder.h"
#include "lilyshark/shelby/shelby_pointer.h"

namespace lilyshark {

/// Surfaces Shelby off-grid pointers carried inside other protocols' payloads.
///
/// This is deliberately not a link-layer decoder. A Shelby pointer is an
/// application payload convention, so the same bytes appear inside Meshtastic,
/// MeshCore, and Reticulum frames alike. Registering this decoder after the
/// protocol decoders lets the registry add AttributeShelbyPointer without
/// replacing the enclosing packet's protocol or decoded fields.
///
/// Reports ProtocolId::Custom when it is the only matching decoder. When an
/// enclosing protocol matched first, only AttributeShelbyPointer is merged.
class ShelbyPointerDecoder final : public PacketDecoder
{
  public:
    ProtocolId protocol() const noexcept override { return ProtocolId::Custom; }

    DecodeResult decode(const RawFrame &frame, const RadioProfile &profile,
                        DecodedPacket &output) const noexcept override;

    /// Extract the pointer from a frame previously matched by this decoder.
    /// Returns false when the frame carries no readable pointer.
    static bool extract(const RawFrame &frame, ShelbyPointer &output) noexcept;
};

} // namespace lilyshark
