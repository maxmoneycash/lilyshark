#pragma once

#include "lilyshark/core/decoder.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

// --- Reticulum announce, semantic tier --------------------------------------
//
// An RNS announce payload has a fixed layout apart from two optional tails:
//
//   public key   64 bytes (32B X25519 + 32B Ed25519)
//   name hash    10 bytes
//   random hash  10 bytes
//   [ratchet     32 bytes — present only when the header's context flag is set]
//   signature    64 bytes
//   [app_data    everything remaining — application-defined]
//
// Every field below is placed by length and flag arithmetic alone; no
// cryptography runs on-device. Key, ratchet, and signature bytes cannot be
// validated without crypto, so they are reported as *present* with byte
// ranges rather than as verified values. app_data is application-defined and
// stays undecoded raw bytes — it is never interpreted.

inline constexpr std::size_t kReticulumHashBytes = 16;
inline constexpr std::size_t kReticulumAnnouncePublicKeyBytes = 64;
inline constexpr std::size_t kReticulumAnnounceNameHashBytes = 10;
inline constexpr std::size_t kReticulumAnnounceRandomHashBytes = 10;
inline constexpr std::size_t kReticulumAnnounceRatchetBytes = 32;
inline constexpr std::size_t kReticulumAnnounceSignatureBytes = 64;

/// Announce payload length with neither ratchet nor app_data:
/// 64 + 10 + 10 + 64.
inline constexpr std::size_t kReticulumAnnounceMinimumBytes =
    kReticulumAnnouncePublicKeyBytes + kReticulumAnnounceNameHashBytes +
    kReticulumAnnounceRandomHashBytes + kReticulumAnnounceSignatureBytes;

/// Largest app_data that fits a captured frame: the shortest possible clear
/// announce framing is RNode shim + HEADER_1 + the fixed announce fields.
inline constexpr std::size_t kReticulumAnnounceMaxAppDataBytes =
    kMaxFrameBytes - 1 /* RNode shim */ - 19 /* HEADER_1 */ - kReticulumAnnounceMinimumBytes;

/// Absolute byte range inside the captured frame. `length == 0` means the
/// field is absent from this packet.
struct ReticulumByteRange {
    std::uint16_t offset = 0;
    std::uint16_t length = 0;
};

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

/// One decoded announce. Filled only when the frame proves, by length and
/// flag arithmetic, that every fixed field fits; `valid` stays false and the
/// rest stays zeroed otherwise. All ranges are absolute offsets into the
/// captured frame bytes.
struct ReticulumAnnounce {
    bool valid = false;
    ReticulumHeaderType header_type = ReticulumHeaderType::HeaderOne;
    std::uint8_t hops = 0;

    /// Full 16-byte truncated destination hash, plus its lowercase hex form
    /// ready for display.
    std::uint8_t destination_hash[kReticulumHashBytes]{};
    char destination_hash_hex[kReticulumHashBytes * 2 + 1]{};
    ReticulumByteRange destination_hash_range{};

    /// HEADER_2 only: the transport instance the announce travelled through.
    bool has_transport_id = false;
    std::uint8_t transport_id[kReticulumHashBytes]{};
    ReticulumByteRange transport_id_range{};

    /// The 64 key bytes are present whenever `valid`; their range is exposed
    /// but the bytes are not copied — presence is all arithmetic can prove.
    bool has_public_key = false;
    ReticulumByteRange public_key_range{};

    std::uint8_t name_hash[kReticulumAnnounceNameHashBytes]{};
    ReticulumByteRange name_hash_range{};
    std::uint8_t random_hash[kReticulumAnnounceRandomHashBytes]{};
    ReticulumByteRange random_hash_range{};

    /// Ratchet presence is signalled by the header's context flag.
    bool has_ratchet = false;
    ReticulumByteRange ratchet_range{};

    bool has_signature = false;
    ReticulumByteRange signature_range{};

    /// Application-defined tail, copied verbatim. Undecoded raw bytes: no
    /// structure is assumed or inferred.
    bool has_app_data = false;
    std::uint16_t app_data_length = 0;
    std::uint8_t app_data[kReticulumAnnounceMaxAppDataBytes]{};
    ReticulumByteRange app_data_range{};
};

/// Read the announce carried by an already-decoded Reticulum packet, the way
/// `readMeshtasticPayload` re-reads a stored frame on demand. Returns false —
/// leaving `out` cleared with `valid == false` — for anything that is not a
/// provable announce: other packet types, split or IFAC-protected frames,
/// malformed packets, non-SINGLE destinations, or payloads too short for the
/// fixed announce fields (including a set context flag without room for the
/// ratchet it promises).
bool readReticulumAnnounce(const RawFrame &frame, const DecodedPacket &packet,
                           ReticulumAnnounce &out) noexcept;

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
