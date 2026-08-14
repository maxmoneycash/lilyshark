#pragma once

#include "lilyshark/core/decoder.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

enum class ReticulumHeaderType : std::uint8_t {
    HeaderOne = 0,
    HeaderTwo = 1,
};

enum class ReticulumPacketType : std::uint8_t {
    Data = 0,
    Announce = 1,
    LinkRequest = 2,
    Proof = 3,
};

enum class ReticulumDestinationType : std::uint8_t {
    Single = 0,
    Group = 1,
    Plain = 2,
    Link = 3,
};

class ReticulumDecoder final : public PacketDecoder
{
  public:
    static constexpr std::size_t kRNodeShimLength = 1;
    static constexpr std::size_t kHeaderOneLength = 19;
    static constexpr std::size_t kHeaderTwoLength = 35;
    static constexpr std::size_t kMinimumIfacBytes = 1;

    ProtocolId protocol() const noexcept override { return ProtocolId::Reticulum; }
    DecodeResult decode(const RawFrame &frame, const RadioProfile &profile,
                        DecodedPacket &output) const noexcept override;

    // protocol_flags packs RNS flags in bits 0..7, context in bits 8..15,
    // the RNode physical shim in bits 16..23, and the clear RNS header length
    // in bits 24..31. Split and IFAC-protected frames have no clear context or
    // RNS header length. This stateless decoder never claims split reassembly.
    static std::uint8_t rnsFlags(const DecodedPacket &packet) noexcept;
    static std::uint8_t context(const DecodedPacket &packet) noexcept;
    static std::uint8_t rnodeShim(const DecodedPacket &packet) noexcept;
    static std::uint8_t headerLength(const DecodedPacket &packet) noexcept;
    static bool isRNodeSplitFrame(const DecodedPacket &packet) noexcept;
    static bool isIfacProtected(const DecodedPacket &packet) noexcept;
    static ReticulumHeaderType headerType(const DecodedPacket &packet) noexcept;
    static bool contextFlag(const DecodedPacket &packet) noexcept;
    static ReticulumPacketType packetType(const DecodedPacket &packet) noexcept;
    static ReticulumDestinationType destinationType(const DecodedPacket &packet) noexcept;
    static bool isTransportPacket(const DecodedPacket &packet) noexcept;
    static std::uint8_t observedHops(const DecodedPacket &packet) noexcept;

    // The shared model has 32-bit identifiers, while RNS hashes are 128-bit.
    // These are only the first four network-order bytes and must be labelled as
    // prefixes by callers. FieldSource/FieldDestination remain unset so generic
    // consumers cannot mistake them for complete identifiers. The transport
    // prefix is present only in HEADER_2.
    static std::uint32_t destinationHashPrefix(const DecodedPacket &packet) noexcept;
    static std::uint32_t transportIdPrefix(const DecodedPacket &packet) noexcept;
};

} // namespace lilyshark
