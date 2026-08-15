#pragma once

#include "lilyshark/core/decoder.h"
#include "lilyshark/shelby/shelby_pointer.h"

namespace lilyshark {

/// Surfaces Shelby off-grid pointers carried inside other protocols' payloads.
///
/// This is deliberately not a link-layer decoder. A Shelby pointer is an
/// application payload convention, so the same bytes appear inside Meshtastic,
/// MeshCore, and Reticulum frames alike. Registering this decoder after the
/// protocol decoders lets Lilyshark report "this frame carries a Shelby
/// pointer" without claiming to own the frame's protocol.
///
/// Reports ProtocolId::Custom because the enclosing protocol has already been
/// identified by whichever decoder matched first.
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
