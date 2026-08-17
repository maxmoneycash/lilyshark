#include "lilyshark/protocols/meshtastic_payload.h"

#include <cstdio>
#include <cstring>

#include "lilyshark/crypto/aes128.h"

namespace lilyshark {
namespace {

/// Largest ciphertext worth attempting; a Meshtastic payload cannot approach
/// this, and the bound keeps the scratch buffer on the stack small.
constexpr std::size_t kMaxCiphertext = 256;

/// Protobuf wire types this parser accepts.
constexpr std::uint8_t kWireVarint = 0;
constexpr std::uint8_t kWire64 = 1;
constexpr std::uint8_t kWireLengthDelimited = 2;
constexpr std::uint8_t kWire32 = 5;

bool readVarint(const std::uint8_t *bytes, std::size_t length, std::size_t &cursor,
                std::uint32_t &value) noexcept;

bool readFixed32(const std::uint8_t *bytes, std::size_t length, std::size_t &cursor,
                 std::uint32_t &value) noexcept
{
    if (cursor + 4U > length) return false;
    value = static_cast<std::uint32_t>(bytes[cursor]) |
            (static_cast<std::uint32_t>(bytes[cursor + 1U]) << 8U) |
            (static_cast<std::uint32_t>(bytes[cursor + 2U]) << 16U) |
            (static_cast<std::uint32_t>(bytes[cursor + 3U]) << 24U);
    cursor += 4U;
    return true;
}

bool skipField(const std::uint8_t *bytes, std::size_t length, std::size_t &cursor,
               std::uint8_t wire) noexcept
{
    if (wire == kWireVarint) {
        std::uint32_t unused = 0;
        return readVarint(bytes, length, cursor, unused);
    }
    if (wire == kWire64) {
        if (cursor + 8U > length) return false;
        cursor += 8U;
        return true;
    }
    if (wire == kWireLengthDelimited) {
        std::uint32_t size = 0;
        if (!readVarint(bytes, length, cursor, size)) return false;
        if (size > length - cursor) return false;
        cursor += size;
        return true;
    }
    if (wire == kWire32) {
        if (cursor + 4U > length) return false;
        cursor += 4U;
        return true;
    }
    return false;
}

double meshtasticDegrees(std::uint32_t raw) noexcept
{
    return static_cast<double>(static_cast<std::int32_t>(raw)) * 1e-7;
}

bool parsePosition(const std::uint8_t *bytes, std::size_t length, MeshtasticPayload &parsed) noexcept
{
    std::size_t cursor = 0;
    bool have_lat = false;
    bool have_lon = false;
    std::uint32_t lat_i = 0;
    std::uint32_t lon_i = 0;
    while (cursor < length) {
        std::uint32_t tag = 0;
        if (!readVarint(bytes, length, cursor, tag)) return false;
        const std::uint32_t field = tag >> 3U;
        const std::uint8_t wire = static_cast<std::uint8_t>(tag & 0x07U);
        if (field == 1U && wire == kWire32) {
            if (!readFixed32(bytes, length, cursor, lat_i)) return false;
            have_lat = true;
        } else if (field == 2U && wire == kWire32) {
            if (!readFixed32(bytes, length, cursor, lon_i)) return false;
            have_lon = true;
        } else if (!skipField(bytes, length, cursor, wire)) {
            return false;
        }
    }
    if (!have_lat || !have_lon) return true;
    parsed.latitude_degrees = meshtasticDegrees(lat_i);
    parsed.longitude_degrees = meshtasticDegrees(lon_i);
    parsed.has_position = true;
    return true;
}

bool copyName(char *out, std::size_t cap, const std::uint8_t *bytes, std::size_t length) noexcept
{
    if (cap == 0) return false;
    const std::size_t n = length + 1U > cap ? cap - 1U : length;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint8_t byte = bytes[i];
        if (byte < 0x20U || byte >= 0x7fU) return false;
        out[i] = static_cast<char>(byte);
    }
    out[n] = '\0';
    return n > 0;
}

bool parseUser(const std::uint8_t *bytes, std::size_t length, MeshtasticPayload &parsed) noexcept
{
    std::size_t cursor = 0;
    while (cursor < length) {
        std::uint32_t tag = 0;
        if (!readVarint(bytes, length, cursor, tag)) return false;
        const std::uint32_t field = tag >> 3U;
        const std::uint8_t wire = static_cast<std::uint8_t>(tag & 0x07U);
        if (wire == kWireLengthDelimited) {
            std::uint32_t size = 0;
            if (!readVarint(bytes, length, cursor, size)) return false;
            if (size > length - cursor) return false;
            if (field == 2U) {
                (void)copyName(parsed.long_name, sizeof(parsed.long_name), bytes + cursor, size);
            } else if (field == 3U) {
                (void)copyName(parsed.short_name, sizeof(parsed.short_name), bytes + cursor, size);
            }
            cursor += size;
        } else if (!skipField(bytes, length, cursor, wire)) {
            return false;
        }
    }
    parsed.has_names = parsed.long_name[0] != '\0' || parsed.short_name[0] != '\0';
    return true;
}

bool parseNodeInfo(const std::uint8_t *bytes, std::size_t length, MeshtasticPayload &parsed) noexcept
{
    std::size_t cursor = 0;
    while (cursor < length) {
        std::uint32_t tag = 0;
        if (!readVarint(bytes, length, cursor, tag)) return false;
        const std::uint32_t field = tag >> 3U;
        const std::uint8_t wire = static_cast<std::uint8_t>(tag & 0x07U);
        if (wire == kWireLengthDelimited) {
            std::uint32_t size = 0;
            if (!readVarint(bytes, length, cursor, size)) return false;
            if (size > length - cursor) return false;
            if (field == 2U) {
                (void)parseUser(bytes + cursor, size, parsed);
            } else if (field == 4U) {
                (void)parsePosition(bytes + cursor, size, parsed);
            }
            cursor += size;
        } else if (!skipField(bytes, length, cursor, wire)) {
            return false;
        }
    }
    return true;
}

/// Read a base-128 varint. False when it runs off the end or overruns 32 bits,
/// which is how a wrong key usually announces itself.
bool readVarint(const std::uint8_t *bytes, std::size_t length, std::size_t &cursor,
                std::uint32_t &value) noexcept
{
    std::uint32_t result = 0;
    unsigned shift = 0;
    while (cursor < length) {
        const std::uint8_t byte = bytes[cursor++];
        if (shift > 28U) return false;
        result |= static_cast<std::uint32_t>(byte & 0x7fU) << shift;
        if ((byte & 0x80U) == 0) {
            value = result;
            return true;
        }
        shift += 7U;
    }
    return false;
}

/// True when the bytes are plausible message text: printable ASCII, common
/// whitespace, or UTF-8 continuation bytes. Random plaintext from a wrong key
/// fails this almost every time.
bool looksLikeText(const std::uint8_t *bytes, std::size_t length) noexcept
{
    if (length == 0) return false;
    for (std::size_t index = 0; index < length; ++index) {
        const std::uint8_t byte = bytes[index];
        const bool printable = byte >= 0x20U && byte < 0x7fU;
        const bool whitespace = byte == '\n' || byte == '\r' || byte == '\t';
        const bool utf8 = byte >= 0x80U;
        if (!printable && !whitespace && !utf8) return false;
    }
    return true;
}

} // namespace

const char *meshtasticPortLabel(std::uint16_t portnum) noexcept
{
    switch (static_cast<MeshtasticPort>(portnum)) {
    case MeshtasticPort::TextMessage: return "TEXT";
    case MeshtasticPort::Position: return "POSITION";
    case MeshtasticPort::NodeInfo: return "NODEINFO";
    case MeshtasticPort::Routing: return "ROUTING";
    case MeshtasticPort::Telemetry: return "TELEMETRY";
    case MeshtasticPort::Traceroute: return "TRACEROUTE";
    case MeshtasticPort::Neighborinfo: return "NEIGHBORINFO";
    case MeshtasticPort::Unknown:
    default: break;
    }
    static char fallback[16];
    std::snprintf(fallback, sizeof(fallback), "PORT %u", static_cast<unsigned>(portnum));
    return fallback;
}

bool readMeshtasticPayload(const std::uint8_t *ciphertext,
                           std::size_t length,
                           std::uint32_t from_node,
                           std::uint32_t packet_id,
                           MeshtasticPayload &out) noexcept
{
    if (ciphertext == nullptr || length == 0 || length > kMaxCiphertext) return false;

    // CryptoEngine::initNonce — the packet id occupies a 64-bit slot, so the
    // upper four bytes are zero for every packet a radio actually sends.
    std::uint8_t nonce[crypto::kAesBlockSize]{};
    nonce[0] = static_cast<std::uint8_t>(packet_id & 0xffU);
    nonce[1] = static_cast<std::uint8_t>((packet_id >> 8U) & 0xffU);
    nonce[2] = static_cast<std::uint8_t>((packet_id >> 16U) & 0xffU);
    nonce[3] = static_cast<std::uint8_t>((packet_id >> 24U) & 0xffU);
    nonce[8] = static_cast<std::uint8_t>(from_node & 0xffU);
    nonce[9] = static_cast<std::uint8_t>((from_node >> 8U) & 0xffU);
    nonce[10] = static_cast<std::uint8_t>((from_node >> 16U) & 0xffU);
    nonce[11] = static_cast<std::uint8_t>((from_node >> 24U) & 0xffU);

    std::uint8_t plain[kMaxCiphertext];
    crypto::aesCtrXcrypt(kMeshtasticDefaultPsk, nonce, ciphertext, length, plain);

    // Parse the Data message strictly. Anything unexpected means this was not
    // default-key traffic, and the caller must keep treating it as opaque.
    MeshtasticPayload parsed{};
    bool saw_portnum = false;
    const std::uint8_t *payload_bytes = nullptr;
    std::size_t payload_length = 0;

    std::size_t cursor = 0;
    while (cursor < length) {
        std::uint32_t tag = 0;
        if (!readVarint(plain, length, cursor, tag)) return false;
        const std::uint32_t field = tag >> 3U;
        const std::uint8_t wire = static_cast<std::uint8_t>(tag & 0x07U);
        if (field == 0) return false;

        if (wire == kWireVarint) {
            std::uint32_t value = 0;
            if (!readVarint(plain, length, cursor, value)) return false;
            if (field == 1U) {
                if (value > 0xffffU) return false;
                parsed.portnum = static_cast<std::uint16_t>(value);
                saw_portnum = true;
            }
        } else if (wire == kWireLengthDelimited) {
            std::uint32_t size = 0;
            if (!readVarint(plain, length, cursor, size)) return false;
            if (size > length - cursor) return false;
            if (field == 2U) {
                payload_bytes = plain + cursor;
                payload_length = size;
            }
            cursor += size;
        } else {
            // Fixed-width fields are legal protobuf but absent from Data;
            // seeing one means this is not a Data message.
            return false;
        }
    }

    if (!saw_portnum) return false;
    parsed.readable = true;
    parsed.payload_length = static_cast<std::uint16_t>(payload_length);

    if (parsed.portnum == static_cast<std::uint16_t>(MeshtasticPort::TextMessage) &&
        payload_bytes != nullptr && looksLikeText(payload_bytes, payload_length)) {
        const std::size_t copy = payload_length > kMeshtasticMaxTextBytes
                                     ? kMeshtasticMaxTextBytes
                                     : payload_length;
        std::memcpy(parsed.text, payload_bytes, copy);
        parsed.text[copy] = '\0';
        parsed.text_length = static_cast<std::uint16_t>(copy);
        parsed.has_text = true;
    }
    if (payload_bytes != nullptr && payload_length > 0) {
        if (parsed.portnum == static_cast<std::uint16_t>(MeshtasticPort::Position)) {
            (void)parsePosition(payload_bytes, payload_length, parsed);
        } else if (parsed.portnum == static_cast<std::uint16_t>(MeshtasticPort::NodeInfo)) {
            (void)parseNodeInfo(payload_bytes, payload_length, parsed);
        }
    }

    out = parsed;
    return true;
}

} // namespace lilyshark
