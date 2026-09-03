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
                      const char *short_name,
                      const MeshtasticPkcKeypair *identity) noexcept
{
    char id[12]{};
    std::snprintf(id, sizeof(id), "!%08x", static_cast<unsigned>(node_num));
    if (!writeStringField(out, cap, used, 1, id) ||
        !writeStringField(out, cap, used, 2, long_name) ||
        !writeStringField(out, cap, used, 3, short_name)) {
        return false;
    }
    // Publishing the public key is what lets anyone reply privately. Without
    // it in our NodeInfo, every peer can only answer under the channel key.
    if (identity != nullptr) {
        return writeBytesField(out, cap, used, 8, identity->public_key,
                               sizeof(identity->public_key));
    }
    return true;
}

} // namespace

bool meshtasticRequestUsesPkc(const MeshtasticEncodeRequest &request) noexcept
{
    // A named channel key wins over the peer's public key, always. Both are
    // ways of being private, but they are private to different audiences, and
    // the operator chose one of them by composing in that channel's
    // conversation. Sealing to the peer instead would deliver the message
    // somewhere the sender was not looking.
    if (request.channel_key != nullptr) return false;
    // Stock firmware keeps traceroute, nodeinfo, routing and position on the
    // channel key even for direct messages, because those are how nodes find
    // and acknowledge each other -- sealing them would hide the mesh from
    // itself. Text is the message a person actually meant to be private.
    return request.identity != nullptr && request.peer_public_key != nullptr &&
           request.port == MeshtasticPort::TextMessage &&
           request.to_node != 0xffffffffU && request.to_node != 0U;
}

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
                              request.short_name, request.identity)) {
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

    const bool pkc = meshtasticRequestUsesPkc(request);
    const std::size_t sealed = data_used + (pkc ? kMeshtasticPkcOverhead : 0U);
    if (kHeader + sealed > out_size) return 0;

    // One key decides both halves of what follows -- the header byte a
    // listener sorts on, and the keystream the body is sealed with. Deriving
    // them from one pointer is what makes it impossible to stamp one channel's
    // hash on another channel's ciphertext.
    const std::uint8_t *channel_key =
        request.channel_key != nullptr ? request.channel_key : kMeshtasticDefaultPsk;
    static_assert(sizeof(kMeshtasticDefaultPsk) == crypto::kAes128KeySize,
                  "the default PSK must be one AES-128 key, or the header hash "
                  "over it would cover a different number of bytes than a "
                  "stored key's");

    writeLe32(out, request.to_node);
    writeLe32(out + 4, request.from_node);
    writeLe32(out + 8, request.packet_id);
    const std::uint8_t hop = static_cast<std::uint8_t>(request.hop_limit & 0x07U);
    out[12] = static_cast<std::uint8_t>(hop | (request.want_ack ? 0x08U : 0U) |
                                        static_cast<std::uint8_t>(hop << 5U));
    // A zero channel byte is how a public-key message announces itself: no
    // channel hash can be zero for a named channel, so stock firmware reads
    // it as "this one is sealed to a person, not to a channel".
    out[13] = pkc ? 0U
                  : meshtasticChannelHash(request.channel_name != nullptr
                                              ? request.channel_name
                                              : kMeshtasticDefaultChannelName,
                                          channel_key, crypto::kAes128KeySize);
    out[14] = 0;
    out[15] = 0;

    if (pkc) {
        std::size_t written = 0;
        if (!meshtasticPkcEncryptDm(*request.identity, request.peer_public_key,
                                    request.from_node, request.packet_id,
                                    request.extra_nonce, data, data_used,
                                    out + kHeader, out_size - kHeader, &written)) {
            return 0;
        }
        return kHeader + written;
    }

    std::uint8_t nonce[crypto::kAesBlockSize]{};
    nonce[0] = static_cast<std::uint8_t>(request.packet_id);
    nonce[1] = static_cast<std::uint8_t>(request.packet_id >> 8U);
    nonce[2] = static_cast<std::uint8_t>(request.packet_id >> 16U);
    nonce[3] = static_cast<std::uint8_t>(request.packet_id >> 24U);
    nonce[8] = static_cast<std::uint8_t>(request.from_node);
    nonce[9] = static_cast<std::uint8_t>(request.from_node >> 8U);
    nonce[10] = static_cast<std::uint8_t>(request.from_node >> 16U);
    nonce[11] = static_cast<std::uint8_t>(request.from_node >> 24U);
    crypto::aesCtrXcrypt(channel_key, nonce, data, data_used, out + kHeader);
    return kHeader + data_used;
}

} // namespace lilyshark
