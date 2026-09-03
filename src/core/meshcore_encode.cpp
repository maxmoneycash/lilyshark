#include "lilyshark/protocols/meshcore_encode.h"

#include "lilyshark/crypto/ed25519.h"
#include "lilyshark/protocols/meshcore_decoder.h"

#include <cstring>

namespace lilyshark {
namespace {

using crypto::kEd25519PrivateKeySize;
using crypto::kEd25519PublicKeySize;
using crypto::kEd25519SignatureSize;

constexpr std::uint8_t kNodeTypeMask = 0x0f;
constexpr std::uint8_t kLatLonFlag = 0x10;
constexpr std::uint8_t kFeatureOneFlag = 0x20;
constexpr std::uint8_t kFeatureTwoFlag = 0x40;
constexpr std::uint8_t kNameFlag = 0x80;

/// Micro-degrees only ever need +/-180e6, and pinning the range keeps the
/// double-to-int32 conversion out of undefined-behaviour territory.
constexpr double kMaxMicroDegrees = 180000000.0;

void writeLittleEndian16(std::uint8_t *out, std::uint16_t value) noexcept
{
    out[0] = static_cast<std::uint8_t>(value & 0xffU);
    out[1] = static_cast<std::uint8_t>((value >> 8U) & 0xffU);
}

void writeLittleEndian32(std::uint8_t *out, std::uint32_t value) noexcept
{
    out[0] = static_cast<std::uint8_t>(value & 0xffU);
    out[1] = static_cast<std::uint8_t>((value >> 8U) & 0xffU);
    out[2] = static_cast<std::uint8_t>((value >> 16U) & 0xffU);
    out[3] = static_cast<std::uint8_t>((value >> 24U) & 0xffU);
}

bool isUtf8Continuation(std::uint8_t byte) noexcept
{
    return (byte & 0xc0U) == 0x80U;
}

/// How many bytes of `text` form whole, well-formed UTF-8 characters within
/// `max_bytes`. This is a port of MeshCore's mesh::validUtf8PrefixLength, and
/// it has to stay a port: cutting a name mid-sequence would put bytes on the
/// air that a stock node renders as replacement characters, and the two ends
/// would disagree about where the name ends.
std::size_t validUtf8PrefixLength(const char *text, std::size_t max_bytes) noexcept
{
    if (text == nullptr) {
        return 0;
    }

    std::size_t offset = 0;
    while (text[offset] != '\0') {
        const std::uint8_t first = static_cast<std::uint8_t>(text[offset]);
        std::size_t sequence_length = 0;

        if (first <= 0x7f) {
            sequence_length = 1;
        } else if (first >= 0xc2 && first <= 0xdf) {
            sequence_length = 2;
        } else if (first >= 0xe0 && first <= 0xef) {
            sequence_length = 3;
        } else if (first >= 0xf0 && first <= 0xf4) {
            sequence_length = 4;
        } else {
            break;
        }

        if (offset + sequence_length > max_bytes) {
            break;
        }

        bool complete = true;
        for (std::size_t index = 1; index < sequence_length; ++index) {
            if (text[offset + index] == '\0' ||
                !isUtf8Continuation(static_cast<std::uint8_t>(text[offset + index]))) {
                complete = false;
                break;
            }
        }
        if (!complete) {
            break;
        }

        // Reject the overlong and surrogate encodings that a decoder would
        // treat as invalid even though the byte count looks right.
        if (sequence_length == 3) {
            const std::uint8_t second = static_cast<std::uint8_t>(text[offset + 1]);
            if ((first == 0xe0 && second < 0xa0) || (first == 0xed && second > 0x9f)) {
                break;
            }
        } else if (sequence_length == 4) {
            const std::uint8_t second = static_cast<std::uint8_t>(text[offset + 1]);
            if ((first == 0xf0 && second < 0x90) || (first == 0xf4 && second > 0x8f)) {
                break;
            }
        }

        offset += sequence_length;
    }
    return offset;
}

} // namespace

// The decoder was written from the same Packet.h and refuses an advert payload
// shorter than key + timestamp + signature. If those two numbers ever drift
// apart, every frame this encoder produces would fail our own round-trip.
static_assert(kMeshCoreAdvertFixedPayloadBytes == MeshCoreDecoder::kAdvertMinimumPayloadBytes,
              "encoder and decoder must agree on the fixed part of an advert payload");
static_assert(kMeshCoreMaxPayloadBytes == MeshCoreDecoder::kMaxPayloadBytes,
              "encoder and decoder must agree on the maximum MeshCore payload");
static_assert(kMeshCoreAdvertFixedPayloadBytes ==
                  kEd25519PublicKeySize + 4 + kEd25519SignatureSize,
              "the advert payload prefix is exactly a public key, a timestamp and a signature");
static_assert(kMeshCoreAdvertFixedPayloadBytes + kMeshCoreMaxAdvertAppDataBytes <=
                  kMeshCoreMaxPayloadBytes,
              "the largest advert must fit MeshCore's payload budget");
static_assert(kEd25519PrivateKeySize == 64,
              "MeshCore's LocalIdentity persists expanded Ed25519 private keys");

std::int32_t meshCoreDegreesToMicros(double degrees) noexcept
{
    const double scaled = degrees * 1e6;
    // Written as a positive test so that a NaN, which compares false against
    // everything, falls through to the "no position" answer.
    if (!(scaled >= -kMaxMicroDegrees && scaled <= kMaxMicroDegrees)) {
        return 0;
    }
    return static_cast<std::int32_t>(scaled);
}

std::size_t encodeMeshCoreAdvertAppData(const MeshCoreAdvertAppData &data,
                                        std::uint8_t out[kMeshCoreMaxAdvertAppDataBytes]) noexcept
{
    if (out == nullptr) {
        return 0;
    }
    const std::uint8_t node_type = static_cast<std::uint8_t>(data.node_type);
    if ((node_type & ~kNodeTypeMask) != 0) {
        return 0;
    }

    // Field order is fixed by AdvertDataBuilder::encodeTo: flags, position,
    // feature words, then the name filling whatever remains.
    out[0] = node_type;
    std::size_t length = 1;

    if (data.has_location) {
        out[0] |= kLatLonFlag;
        writeLittleEndian32(out + length, static_cast<std::uint32_t>(data.latitude_micros));
        length += 4;
        writeLittleEndian32(out + length, static_cast<std::uint32_t>(data.longitude_micros));
        length += 4;
    }
    if (data.feature_one != 0) {
        out[0] |= kFeatureOneFlag;
        writeLittleEndian16(out + length, data.feature_one);
        length += 2;
    }
    if (data.feature_two != 0) {
        out[0] |= kFeatureTwoFlag;
        writeLittleEndian16(out + length, data.feature_two);
        length += 2;
    }
    if (data.name != nullptr && data.name[0] != '\0') {
        const std::size_t name_length =
            validUtf8PrefixLength(data.name, kMeshCoreMaxAdvertAppDataBytes - length);
        if (name_length > 0) {
            out[0] |= kNameFlag;
            std::memcpy(out + length, data.name, name_length);
            length += name_length;
        }
    }
    return length;
}

std::size_t encodeMeshCoreAdvertSignedMessage(const std::uint8_t public_key[32],
                                              std::uint32_t timestamp,
                                              const std::uint8_t *app_data,
                                              std::size_t app_data_length,
                                              std::uint8_t *out,
                                              std::size_t out_size) noexcept
{
    if (public_key == nullptr || out == nullptr) {
        return 0;
    }
    if (app_data == nullptr && app_data_length != 0) {
        return 0;
    }
    if (app_data_length > kMeshCoreMaxAdvertAppDataBytes) {
        return 0;
    }
    const std::size_t length = kEd25519PublicKeySize + 4 + app_data_length;
    if (length > out_size) {
        return 0;
    }

    std::memcpy(out, public_key, kEd25519PublicKeySize);
    writeLittleEndian32(out + kEd25519PublicKeySize, timestamp);
    if (app_data_length != 0) {
        std::memcpy(out + kEd25519PublicKeySize + 4, app_data, app_data_length);
    }
    return length;
}

std::size_t encodeMeshCoreAdvert(const MeshCoreAdvertAppData &data,
                                 std::uint32_t timestamp,
                                 MeshCoreAdvertReach reach,
                                 const std::uint8_t public_key[32],
                                 const std::uint8_t private_key[64],
                                 std::uint8_t *out,
                                 std::size_t out_size) noexcept
{
    if (public_key == nullptr || private_key == nullptr || out == nullptr) {
        return 0;
    }

    std::uint8_t app_data[kMeshCoreMaxAdvertAppDataBytes]{};
    const std::size_t app_data_length = encodeMeshCoreAdvertAppData(data, app_data);
    if (app_data_length == 0) {
        return 0;
    }

    std::uint8_t message[kMeshCoreAdvertSignedMessageBytes]{};
    const std::size_t message_length = encodeMeshCoreAdvertSignedMessage(
        public_key, timestamp, app_data, app_data_length, message, sizeof(message));
    if (message_length == 0) {
        return 0;
    }

    // Header plus the path-length byte, then the payload. A fresh advert
    // always leaves with an empty path: flood adverts have their hops appended
    // by the repeaters that forward them, and a zero-hop advert has none by
    // definition.
    constexpr std::size_t kEnvelopeBytes = 2;
    const std::size_t frame_length =
        kEnvelopeBytes + kMeshCoreAdvertFixedPayloadBytes + app_data_length;
    if (frame_length > out_size || frame_length > kMeshCoreMaxFrameBytes) {
        return 0;
    }

    out[0] = reach == MeshCoreAdvertReach::Flood ? kMeshCoreFloodAdvertHeader
                                                 : kMeshCoreZeroHopAdvertHeader;
    out[1] = 0x00;

    std::uint8_t *const payload = out + kEnvelopeBytes;
    std::memcpy(payload, public_key, kEd25519PublicKeySize);
    writeLittleEndian32(payload + kEd25519PublicKeySize, timestamp);
    std::uint8_t *const signature = payload + kEd25519PublicKeySize + 4;
    crypto::ed25519Sign(signature, message, message_length, public_key, private_key);
    std::memcpy(signature + kEd25519SignatureSize, app_data, app_data_length);
    return frame_length;
}

} // namespace lilyshark
