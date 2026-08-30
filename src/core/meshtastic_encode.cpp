#include "lilyshark/protocols/meshtastic_encode.h"

#include "lilyshark/crypto/aes128.h"

#include <cstdio>
#include <cstring>

namespace lilyshark {
namespace {

constexpr std::size_t kHeader = 16;
constexpr std::size_t kMaxPlain = 200;

void writeLe32(std::uint8_t *out, std::uint32_t value) noexcept
{
    out[0] = static_cast<std::uint8_t>(value);
    out[1] = static_cast<std::uint8_t>(value >> 8U);
    out[2] = static_cast<std::uint8_t>(value >> 16U);
    out[3] = static_cast<std::uint8_t>(value >> 24U);
}

bool writeVarint(std::uint8_t *out, std::size_t cap, std::size_t &used,
                 std::uint32_t value) noexcept
{
    do {
        if (used >= cap) return false;
        std::uint8_t byte = static_cast<std::uint8_t>(value & 0x7fU);
        value >>= 7U;
        if (value != 0) byte = static_cast<std::uint8_t>(byte | 0x80U);
        out[used++] = byte;
    } while (value != 0);
    return true;
}

bool writeTag(std::uint8_t *out, std::size_t cap, std::size_t &used, std::uint32_t field,
              std::uint8_t wire) noexcept
{
    return writeVarint(out, cap, used, (field << 3U) | wire);
}

bool writeBytesField(std::uint8_t *out, std::size_t cap, std::size_t &used, std::uint32_t field,
                     const std::uint8_t *bytes, std::size_t length) noexcept
{
    if (!writeTag(out, cap, used, field, 2) || !writeVarint(out, cap, used,
                                                            static_cast<std::uint32_t>(length))) {
        return false;
    }
    if (used + length > cap) return false;
    if (length > 0 && bytes != nullptr) {
        std::memcpy(out + used, bytes, length);
    }
    used += length;
    return true;
}

bool writeStringField(std::uint8_t *out, std::size_t cap, std::size_t &used, std::uint32_t field,
                      const char *text) noexcept
{
    const std::size_t length = text == nullptr ? 0 : std::strlen(text);
    return writeBytesField(out, cap, used, field, reinterpret_cast<const std::uint8_t *>(text),
                           length);
}

std::int32_t degreesToMeshtastic(double degrees) noexcept
{
    return static_cast<std::int32_t>(degrees * 1e7);
}

bool writePositionPayload(std::uint8_t *out, std::size_t cap, std::size_t &used,
                          double lat, double lon) noexcept
{
    if (!writeTag(out, cap, used, 1, 5) || used + 4U > cap) return false;
    writeLe32(out + used, static_cast<std::uint32_t>(degreesToMeshtastic(lat)));
    used += 4U;
    if (!writeTag(out, cap, used, 2, 5) || used + 4U > cap) return false;
    writeLe32(out + used, static_cast<std::uint32_t>(degreesToMeshtastic(lon)));
    used += 4U;
    return true;
}

bool writeUserPayload(std::uint8_t *out, std::size_t cap, std::size_t &used,
                      std::uint32_t node_num, const char *long_name,
                      const char *short_name) noexcept
{
    char id[12]{};
    std::snprintf(id, sizeof(id), "!%08x", static_cast<unsigned>(node_num));
    return writeStringField(out, cap, used, 1, id) &&
           writeStringField(out, cap, used, 2, long_name) &&
           writeStringField(out, cap, used, 3, short_name);
}

} // namespace

std::uint8_t meshtasticChannelHash(const char *name, const std::uint8_t *psk,
                                   std::size_t psk_length) noexcept
{
    std::uint8_t hash = 0;
    if (name != nullptr) {
        for (const char *cursor = name; *cursor != '\0'; ++cursor) {
            hash = static_cast<std::uint8_t>(hash ^ static_cast<std::uint8_t>(*cursor));
        }
    }
    if (psk != nullptr) {
        for (std::size_t index = 0; index < psk_length; ++index) {
            hash = static_cast<std::uint8_t>(hash ^ psk[index]);
        }
    }
    return hash;
}

std::size_t encodeMeshtasticFrame(const MeshtasticEncodeRequest &request,
                                  std::uint8_t *out, std::size_t out_size) noexcept
{
    if (out == nullptr || out_size < kHeader + 4U || request.from_node == 0) return 0;

    std::uint8_t inner[kMaxPlain]{};
    std::size_t inner_used = 0;
    if (request.port == MeshtasticPort::TextMessage) {
        if (request.text == nullptr || request.text[0] == '\0') return 0;
        const std::size_t text_len = std::strlen(request.text);
        if (text_len > kMeshtasticMaxTextBytes || text_len > sizeof(inner)) return 0;
        std::memcpy(inner, request.text, text_len);
        inner_used = text_len;
    } else if (request.port == MeshtasticPort::Position) {
        if (!writePositionPayload(inner, sizeof(inner), inner_used, request.latitude_degrees,
                                  request.longitude_degrees)) {
            return 0;
        }
    } else if (request.port == MeshtasticPort::NodeInfo) {
        std::uint8_t user[96]{};
        std::size_t user_used = 0;
        if (!writeUserPayload(user, sizeof(user), user_used, request.from_node, request.long_name,
                              request.short_name)) {
            return 0;
        }
        if (!writeTag(inner, sizeof(inner), inner_used, 1, 0) ||
            !writeVarint(inner, sizeof(inner), inner_used, request.from_node) ||
            !writeBytesField(inner, sizeof(inner), inner_used, 2, user, user_used)) {
            return 0;
        }
    } else if (request.port == MeshtasticPort::Routing) {
        // An empty Routing message is error_reason NONE -- the acknowledgement.
        inner_used = 0;
    } else {
        return 0;
    }

    std::uint8_t data[kMaxPlain + 8]{};
    std::size_t data_used = 0;
    if (!writeTag(data, sizeof(data), data_used, 1, 0) ||
        !writeVarint(data, sizeof(data), data_used, static_cast<std::uint32_t>(request.port)) ||
        !writeBytesField(data, sizeof(data), data_used, 2, inner, inner_used)) {
        return 0;
    }
    if (request.request_id != 0 &&
        (!writeTag(data, sizeof(data), data_used, 6, 0) ||
         !writeVarint(data, sizeof(data), data_used, request.request_id))) {
        return 0;
    }

    if (kHeader + data_used > out_size) return 0;

    writeLe32(out, request.to_node);
    writeLe32(out + 4, request.from_node);
    writeLe32(out + 8, request.packet_id);
    const std::uint8_t hop = static_cast<std::uint8_t>(request.hop_limit & 0x07U);
    out[12] = static_cast<std::uint8_t>(hop | (request.want_ack ? 0x08U : 0U) |
                                        static_cast<std::uint8_t>(hop << 5U));
    out[13] = meshtasticChannelHash(kMeshtasticDefaultChannelName, kMeshtasticDefaultPsk,
                                    sizeof(kMeshtasticDefaultPsk));
    out[14] = 0;
    out[15] = 0;

    std::uint8_t nonce[crypto::kAesBlockSize]{};
    nonce[0] = static_cast<std::uint8_t>(request.packet_id);
    nonce[1] = static_cast<std::uint8_t>(request.packet_id >> 8U);
    nonce[2] = static_cast<std::uint8_t>(request.packet_id >> 16U);
    nonce[3] = static_cast<std::uint8_t>(request.packet_id >> 24U);
    nonce[8] = static_cast<std::uint8_t>(request.from_node);
    nonce[9] = static_cast<std::uint8_t>(request.from_node >> 8U);
    nonce[10] = static_cast<std::uint8_t>(request.from_node >> 16U);
    nonce[11] = static_cast<std::uint8_t>(request.from_node >> 24U);
    crypto::aesCtrXcrypt(kMeshtasticDefaultPsk, nonce, data, data_used, out + kHeader);
    return kHeader + data_used;
}

} // namespace lilyshark
