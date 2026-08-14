#pragma once

#include "lilyshark/core/decoder.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

enum class MeshCoreRouteType : std::uint8_t {
    TransportFlood = 0,
    Flood = 1,
    Direct = 2,
    TransportDirect = 3,
};

enum class MeshCorePayloadType : std::uint8_t {
    Request = 0,
    Response = 1,
    TextMessage = 2,
    Acknowledgement = 3,
    Advertisement = 4,
    GroupText = 5,
    GroupData = 6,
    AnonymousRequest = 7,
    ReturnedPath = 8,
    Trace = 9,
    Multipart = 10,
    Control = 11,
    RawCustom = 15,
};

class MeshCoreDecoder final : public PacketDecoder
{
  public:
    static constexpr std::size_t kMaxPathBytes = 64;
    static constexpr std::size_t kMaxPayloadBytes = 184;
    static constexpr std::size_t kAdvertMinimumPayloadBytes = 100;

    ProtocolId protocol() const noexcept override { return ProtocolId::MeshCore; }
    DecodeResult decode(const RawFrame &frame, const RadioProfile &profile,
                        DecodedPacket &output) const noexcept override;

    // protocol_flags packs the original MeshCore header in bits 0..7 and the
    // encoded path-length byte in bits 8..15. The common hop fields retain the
    // decoded path count and hash width, but their generic presence bits remain
    // unset because these values are not Meshtastic-style hop limits.
    static std::uint8_t wireHeader(const DecodedPacket &packet) noexcept;
    static MeshCoreRouteType routeType(const DecodedPacket &packet) noexcept;
    static MeshCorePayloadType payloadType(const DecodedPacket &packet) noexcept;
    static std::uint8_t payloadVersion(const DecodedPacket &packet) noexcept;
    static std::uint8_t encodedPathLength(const DecodedPacket &packet) noexcept;
    static std::uint8_t pathHashCount(const DecodedPacket &packet) noexcept;
    static std::uint8_t pathHashSize(const DecodedPacket &packet) noexcept;
    static bool hasTransportCodes(const DecodedPacket &packet) noexcept;

    // Transport codes use source/destination as private backing slots without
    // setting FieldSource/FieldDestination. An ACK checksum uses packet_id
    // without setting FieldPacketId. Call these accessors only for the matching
    // route or payload type.
    static std::uint16_t transportCodeOne(const DecodedPacket &packet) noexcept;
    static std::uint16_t transportCodeTwo(const DecodedPacket &packet) noexcept;
    static std::uint32_t acknowledgementChecksum(const DecodedPacket &packet) noexcept;
};

} // namespace lilyshark
