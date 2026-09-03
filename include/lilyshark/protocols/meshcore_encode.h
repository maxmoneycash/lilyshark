#pragma once

// MeshCore transmit-side frame construction.
//
// Stage 1 of docs/meshcore-participation-plan.md: build the one packet that
// makes a deck exist on a MeshCore network — a signed ADVERT carrying our
// Ed25519 public key, a timestamp, and the app data (node type, name and
// optional position) other nodes file us under.
//
// Every layout here was read from MeshCore's own sources (Mesh::createAdvert,
// AdvertDataBuilder::encodeTo, Packet.h) and cross-checked against
// meshcore.js, and the results are pinned byte-for-byte in test/meshcore_tx.
//
// Pure functions over caller-owned buffers: no allocation, no globals, no
// clock and no radio. Deciding *when* to advertise, where the timestamp comes
// from, and who transmits the bytes are all the caller's problem, which is
// what makes the whole encoder host-testable.

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Whether the firmware has a wired MeshCore transmit path: an Ed25519
/// identity minted from the hardware RNG and persisted, a monotonic advert
/// clock, and a caller that hands encodeMeshCoreAdvert()'s bytes to the radio
/// while a MeshCore profile is tuned. All three landed together, so this is
/// now true.
///
/// What it deliberately does NOT claim is that a stock MeshCore node has
/// listed this deck as a contact. That milestone is still open: the frames are
/// pinned byte-for-byte against two independent implementations and survive a
/// round trip through our own decoder, which is evidence about bytes, not
/// about RF. See "Wiring stage 1 into the firmware" in the plan document.
inline constexpr bool kMeshCoreTransmitReady = true;

inline std::size_t encodeMeshCoreText(const char *, std::uint8_t *, std::size_t) noexcept
{
    return 0;
}

/// MeshCore's MAX_TRANS_UNIT: the largest frame the radio may put on the air.
inline constexpr std::size_t kMeshCoreMaxFrameBytes = 255;

/// MeshCore's MAX_PACKET_PAYLOAD: everything after the header, transport
/// codes and path.
inline constexpr std::size_t kMeshCoreMaxPayloadBytes = 184;

/// MeshCore's MAX_ADVERT_DATA_SIZE. Longer app data is not truncated by
/// receivers, it is simply never produced by a stock node.
inline constexpr std::size_t kMeshCoreMaxAdvertAppDataBytes = 32;

/// Public key, timestamp and signature: the part of an advert payload that is
/// always present, before any app data.
inline constexpr std::size_t kMeshCoreAdvertFixedPayloadBytes = 32 + 4 + 64;

/// The bytes that get signed: public key, timestamp, and app data. The
/// signature itself and the frame header are outside the signature, which is
/// why a repeater can rewrite the path without breaking it.
inline constexpr std::size_t kMeshCoreAdvertSignedMessageBytes =
    32 + 4 + kMeshCoreMaxAdvertAppDataBytes;

/// Route FLOOD (1) with payload type ADVERT (4) at payload version 1: the
/// whole mesh learns about us, repeaters appending their hash as they forward.
inline constexpr std::uint8_t kMeshCoreFloodAdvertHeader = 0x11;

/// Route DIRECT (2) with an empty path, which MeshCore calls zero hop: only
/// nodes that hear us directly learn about us, and nobody repeats it. This is
/// what stock companion firmware sends by default, and it is the polite
/// setting for a deck that advertises often.
inline constexpr std::uint8_t kMeshCoreZeroHopAdvertHeader = 0x12;

/// The advert's low nibble of flags. CHAT is what a person-carried node
/// claims; the others describe infrastructure we are not.
enum class MeshCoreNodeType : std::uint8_t {
    None = 0,
    Chat = 1,
    Repeater = 2,
    Room = 3,
    Sensor = 4,
};

enum class MeshCoreAdvertReach : std::uint8_t {
    ZeroHop,
    Flood,
};

/// What an advert says about us beyond the key itself. Field presence is
/// driven by the flags byte, so an unset name or position costs no bytes.
struct MeshCoreAdvertAppData {
    MeshCoreNodeType node_type = MeshCoreNodeType::Chat;

    /// UTF-8, not NUL-terminated on the wire. Truncated on a character
    /// boundary to whatever space is left after the other fields; a name that
    /// does not fit at all is dropped rather than mangled.
    const char *name = nullptr;

    bool has_location = false;
    std::int32_t latitude_micros = 0;
    std::int32_t longitude_micros = 0;

    /// Reserved feature words. MeshCore only emits each when it is non-zero,
    /// and this mirrors that, so leaving them at zero produces exactly the
    /// bytes a stock node produces.
    std::uint16_t feature_one = 0;
    std::uint16_t feature_two = 0;
};

/// The timestamp the next advert from this identity must carry.
///
/// `clock_floor` is the epoch second persisted for this identity,
/// `seconds_since_boot` is how long this power cycle has been running, and
/// `last_emitted` is the newest timestamp already put on the air.
///
/// This is a correctness rule, not a convenience. A MeshCore receiver drops an
/// advert whose timestamp is not strictly greater than the last one it stored
/// for that key, and it drops it silently — a deck whose clock restarts lower
/// advertises perfectly and is invisible, with no error anywhere to notice.
/// The result therefore only has to increase, forever, which is what lets a
/// deck with no real-time clock participate at all.
///
/// Saturates at 2106 rather than wrapping: going backwards is the one outcome
/// this exists to prevent, so an identity that reaches the end of the epoch
/// stops being rediscoverable instead of silently replaying itself.
std::uint32_t meshCoreNextAdvertTimestamp(std::uint32_t clock_floor,
                                          std::uint32_t seconds_since_boot,
                                          std::uint32_t last_emitted) noexcept;

/// Convert decimal degrees to the int32 micro-degrees adverts carry.
/// Returns 0 for anything that is not a finite coordinate, because an advert
/// with a nonsense position is worse than one with none.
std::int32_t meshCoreDegreesToMicros(double degrees) noexcept;

/// Encode the app-data block. Returns its length in bytes, or 0 when
/// `node_type` is outside the four-bit field.
std::size_t encodeMeshCoreAdvertAppData(const MeshCoreAdvertAppData &data,
                                        std::uint8_t out[kMeshCoreMaxAdvertAppDataBytes]) noexcept;

/// Assemble the exact bytes an advert signature covers. Exposed because
/// verifying an inbound advert (stage 2) has to rebuild the same message, and
/// two copies of that layout would eventually disagree.
std::size_t encodeMeshCoreAdvertSignedMessage(const std::uint8_t public_key[32],
                                              std::uint32_t timestamp,
                                              const std::uint8_t *app_data,
                                              std::size_t app_data_length,
                                              std::uint8_t *out,
                                              std::size_t out_size) noexcept;

/// Build a complete, signed advert frame ready for the radio.
///
/// `timestamp` is epoch seconds and must be strictly greater than the last one
/// this identity emitted: receivers drop a repeat or older timestamp as a
/// replay, silently. `private_key` is the 64-byte expanded Ed25519 key
/// (crypto/ed25519.h), and `public_key` must be its own public key.
///
/// Returns the frame length, or 0 if any argument is missing, the app data
/// cannot be built, or the frame would not fit `out_size`.
std::size_t encodeMeshCoreAdvert(const MeshCoreAdvertAppData &data,
                                 std::uint32_t timestamp,
                                 MeshCoreAdvertReach reach,
                                 const std::uint8_t public_key[32],
                                 const std::uint8_t private_key[64],
                                 std::uint8_t *out,
                                 std::size_t out_size) noexcept;

} // namespace lilyshark
