#include "lilyshark/protocols/meshtastic_api.h"

#include "lilyshark/core/mesh_identity.h"

#include <cstdio>
#include <cstring>

namespace lilyshark {
namespace {

// Wire types, protobuf encoding spec.
constexpr std::uint32_t kWireVarint = 0;
constexpr std::uint32_t kWireFixed64 = 1;
constexpr std::uint32_t kWireLen = 2;
constexpr std::uint32_t kWireFixed32 = 5;

// The phone side refuses to talk to firmware that requires an app newer than
// itself; stock 2.x firmware announces 30200 and so do we.
constexpr std::uint32_t kMinAppVersion = 30200;
// HardwareModel.T_DECK, mesh.proto.
constexpr std::uint32_t kHwModelTDeck = 50;

/// Appends protobuf fields to a caller buffer, going quietly inert on
/// overflow so a truncated message is never handed out as a whole one.
struct Writer {
    std::uint8_t *out;
    std::size_t capacity;
    std::size_t length = 0;
    bool ok = true;

    void byte(std::uint8_t value) noexcept
    {
        if (length >= capacity) { ok = false; return; }
        out[length++] = value;
    }
    void varint(std::uint64_t value) noexcept
    {
        do {
            std::uint8_t part = value & 0x7fU;
            value >>= 7U;
            byte(value != 0U ? static_cast<std::uint8_t>(part | 0x80U) : part);
        } while (value != 0U && ok);
    }
    void tag(std::uint32_t field, std::uint32_t wire) noexcept
    {
        varint((static_cast<std::uint64_t>(field) << 3U) | wire);
    }
    /// proto3 style: a zero scalar is the default and is not written.
    void field_uint(std::uint32_t field, std::uint64_t value) noexcept
    {
        if (value == 0U) return;
        tag(field, kWireVarint);
        varint(value);
    }
    void field_fixed32(std::uint32_t field, std::uint32_t value) noexcept
    {
        if (value == 0U) return;
        tag(field, kWireFixed32);
        for (int shift = 0; shift < 32; shift += 8) {
            byte(static_cast<std::uint8_t>(value >> shift));
        }
    }
    void field_float(std::uint32_t field, float value) noexcept
    {
        std::uint32_t bits = 0;
        std::memcpy(&bits, &value, sizeof(bits));
        field_fixed32(field, bits);
    }
    void field_int32(std::uint32_t field, std::int32_t value) noexcept
    {
        if (value == 0) return;
        tag(field, kWireVarint);
        // int32 goes over the wire as the two's-complement 64-bit varint;
        // a negative RSSI is ten bytes and that is simply what the format is.
        varint(static_cast<std::uint64_t>(static_cast<std::int64_t>(value)));
    }
    void field_bytes(std::uint32_t field, const std::uint8_t *bytes,
                     std::size_t count) noexcept
    {
        if (count == 0U) return;
        tag(field, kWireLen);
        varint(count);
        for (std::size_t index = 0; index < count && ok; ++index) byte(bytes[index]);
    }
    void field_string(std::uint32_t field, const char *value) noexcept
    {
        if (value == nullptr || value[0] == '\0') return;
        field_bytes(field, reinterpret_cast<const std::uint8_t *>(value),
                    std::strlen(value));
    }
    void field_message(std::uint32_t field, const Writer &child) noexcept
    {
        if (!child.ok) { ok = false; return; }
        field_bytes(field, child.out, child.length);
    }
};

/// Walks one protobuf, tolerating every field it does not know.
struct Reader {
    const std::uint8_t *cursor;
    const std::uint8_t *end;
    bool ok = true;

    bool done() const noexcept { return cursor >= end; }
    std::uint64_t varint() noexcept
    {
        std::uint64_t value = 0;
        for (unsigned shift = 0; shift < 64U; shift += 7U) {
            if (cursor >= end) { ok = false; return 0; }
            const std::uint8_t part = *cursor++;
            value |= static_cast<std::uint64_t>(part & 0x7fU) << shift;
            if ((part & 0x80U) == 0U) return value;
        }
        ok = false;
        return 0;
    }
    std::uint32_t fixed32() noexcept
    {
        if (end - cursor < 4) { ok = false; return 0; }
        std::uint32_t value = 0;
        for (int shift = 0; shift < 32; shift += 8) {
            value |= static_cast<std::uint32_t>(*cursor++) << shift;
        }
        return value;
    }
    /// On return the field's payload is consumed; for kWireLen the payload
    /// bounds come back so the caller can descend into a submessage.
    bool next(std::uint32_t &field, std::uint32_t &wire, const std::uint8_t *&payload,
              std::size_t &payload_length) noexcept
    {
        if (done()) return false;
        const std::uint64_t key = varint();
        if (!ok) return false;
        field = static_cast<std::uint32_t>(key >> 3U);
        wire = static_cast<std::uint32_t>(key & 7U);
        payload = nullptr;
        payload_length = 0;
        switch (wire) {
        case kWireVarint: payload_length = varint(); return ok;  // value in payload_length
        case kWireFixed64:
            if (end - cursor < 8) { ok = false; return false; }
            cursor += 8;
            return true;
        case kWireLen: {
            const std::uint64_t count = varint();
            if (!ok || static_cast<std::uint64_t>(end - cursor) < count) {
                ok = false;
                return false;
            }
            payload = cursor;
            payload_length = static_cast<std::size_t>(count);
            cursor += count;
            return true;
        }
        case kWireFixed32: payload_length = fixed32(); return ok;  // value in payload_length
        default: ok = false; return false;
        }
    }
};

// mesh.proto PortNum.
constexpr std::uint64_t kPortText = 1;

void parseDataForText(const std::uint8_t *bytes, std::size_t length,
                      ApiToRadio &out) noexcept
{
    Reader reader{bytes, bytes + length};
    std::uint64_t portnum = 0;
    const std::uint8_t *payload = nullptr;
    std::size_t payload_length = 0;
    std::uint32_t field = 0;
    std::uint32_t wire = 0;
    const std::uint8_t *sub = nullptr;
    std::size_t sub_length = 0;
    while (reader.next(field, wire, sub, sub_length)) {
        if (field == 1U && wire == kWireVarint) portnum = sub_length;
        if (field == 2U && wire == kWireLen) { payload = sub; payload_length = sub_length; }
    }
    if (!reader.ok || portnum != kPortText || payload == nullptr) return;
    if (payload_length >= sizeof(out.text)) payload_length = sizeof(out.text) - 1U;
    std::memcpy(out.text, payload, payload_length);
    out.text[payload_length] = '\0';
    out.kind = ApiToRadio::Kind::Text;
}

void parseMeshPacket(const std::uint8_t *bytes, std::size_t length,
                     ApiToRadio &out) noexcept
{
    Reader reader{bytes, bytes + length};
    std::uint32_t field = 0;
    std::uint32_t wire = 0;
    const std::uint8_t *sub = nullptr;
    std::size_t sub_length = 0;
    while (reader.next(field, wire, sub, sub_length)) {
        switch (field) {
        case 2U:  // to, fixed32
            if (wire == kWireFixed32) out.to_node = static_cast<std::uint32_t>(sub_length);
            break;
        case 4U:  // decoded Data
            if (wire == kWireLen) parseDataForText(sub, sub_length, out);
            break;
        case 10U:  // want_ack
            if (wire == kWireVarint) out.want_ack = sub_length != 0U;
            break;
        default: break;
        }
    }
    if (!reader.ok) out.kind = ApiToRadio::Kind::None;
}

void writeUser(Writer &writer, const ApiNodeEntry &node) noexcept
{
    char id[12]{};
    std::snprintf(id, sizeof(id), "!%08lx", static_cast<unsigned long>(node.num));
    writer.field_string(1, id);
    writer.field_string(2, node.label);
    // Meshtastic short names are at most four characters; the tail of a hex
    // label is what stock firmware itself falls back to.
    const std::size_t label_length = std::strlen(node.label);
    const char *short_name = label_length > 4U ? node.label + (label_length - 4U)
                                               : node.label;
    writer.field_string(3, short_name);
    if (node.is_self) writer.field_uint(5, kHwModelTDeck);
}

} // namespace

bool parseApiToRadio(const std::uint8_t *bytes, std::size_t length,
                     ApiToRadio &out) noexcept
{
    out = ApiToRadio{};
    if (bytes == nullptr || length == 0U) return false;
    Reader reader{bytes, bytes + length};
    std::uint32_t field = 0;
    std::uint32_t wire = 0;
    const std::uint8_t *sub = nullptr;
    std::size_t sub_length = 0;
    while (reader.next(field, wire, sub, sub_length)) {
        switch (field) {
        case 1U:  // packet
            if (wire == kWireLen) parseMeshPacket(sub, sub_length, out);
            break;
        case 3U:  // want_config_id
            if (wire == kWireVarint) {
                out.kind = ApiToRadio::Kind::WantConfig;
                out.want_config_id = static_cast<std::uint32_t>(sub_length);
            }
            break;
        case 4U:  // disconnect
            if (wire == kWireVarint && sub_length != 0U) {
                out.kind = ApiToRadio::Kind::Disconnect;
            }
            break;
        default: break;  // heartbeat and the rest parse to Kind::None
        }
    }
    return reader.ok;
}

std::size_t encodeApiConfigMessage(std::size_t index, std::uint32_t config_id,
                                   const char *firmware_version,
                                   const ApiNodeEntry *nodes, std::size_t node_count,
                                   std::uint8_t *out, std::size_t capacity) noexcept
{
    if (out == nullptr || capacity == 0U) return 0;
    Writer from_radio{out, capacity};
    std::uint8_t scratch[192]{};
    Writer child{scratch, sizeof(scratch)};

    if (index == 0U) {
        // FromRadio.my_info
        child.field_uint(1, localMeshtasticNodeNum());
        child.field_uint(11, kMinAppVersion);
        from_radio.field_message(3, child);
    } else if (index == 1U) {
        // FromRadio.metadata
        child.field_string(1, firmware_version);
        child.field_uint(5, 1);  // hasBluetooth -- how the phone reached us
        child.field_uint(9, kHwModelTDeck);
        from_radio.field_message(13, child);
    } else if (index < 2U + node_count) {
        // FromRadio.node_info
        const ApiNodeEntry &node = nodes[index - 2U];
        std::uint8_t user_scratch[64]{};
        Writer user{user_scratch, sizeof(user_scratch)};
        writeUser(user, node);
        child.field_uint(1, node.num);
        child.field_message(2, user);
        if (node.has_snr) {
            child.field_float(4, static_cast<float>(node.snr_x10) / 10.0f);
        }
        from_radio.field_message(4, child);
    } else if (index == 2U + node_count) {
        // FromRadio.channel: the primary channel. A one-byte psk of 0x01 is
        // Meshtastic's own shorthand for "the published default key", which
        // is the channel this deck actually listens on.
        std::uint8_t settings_scratch[16]{};
        Writer settings{settings_scratch, sizeof(settings_scratch)};
        const std::uint8_t default_psk[1] = {0x01};
        settings.field_bytes(2, default_psk, sizeof(default_psk));
        child.field_message(2, settings);
        child.field_uint(3, 1);  // Channel.Role.PRIMARY
        from_radio.field_message(10, child);
    } else if (index == 3U + node_count) {
        // FromRadio.config.lora -- enough for the app to state the region and
        // preset instead of showing UNSET everywhere.
        std::uint8_t lora_scratch[16]{};
        Writer lora{lora_scratch, sizeof(lora_scratch)};
        lora.field_uint(1, 1);  // use_preset (LONG_FAST is preset 0, the default)
        lora.field_uint(7, 1);  // RegionCode.US
        lora.field_uint(8, 3);  // hop_limit
        lora.field_uint(9, 1);  // tx_enabled
        child.field_message(6, lora);
        from_radio.field_message(5, child);
    } else if (index == 4U + node_count) {
        // FromRadio.config_complete_id -- the nonce back, closing the dump.
        from_radio.field_uint(7, config_id);
        if (config_id == 0U) {
            // field_uint skips zero, but the echo must exist even then.
            from_radio.tag(7, kWireVarint);
            from_radio.varint(0);
        }
    } else {
        return 0;
    }
    return from_radio.ok ? from_radio.length : 0;
}

std::size_t encodeApiTextPacket(std::uint32_t from_node, std::uint32_t to_node,
                                std::uint32_t packet_id, const char *text,
                                std::int16_t rssi_x10, std::int16_t snr_x10,
                                std::uint8_t *out, std::size_t capacity) noexcept
{
    if (out == nullptr || capacity == 0U || text == nullptr || text[0] == '\0') {
        return 0;
    }
    std::uint8_t data_scratch[256]{};
    Writer data{data_scratch, sizeof(data_scratch)};
    data.field_uint(1, kPortText);
    data.field_bytes(2, reinterpret_cast<const std::uint8_t *>(text),
                     std::strlen(text));

    std::uint8_t packet_scratch[300]{};
    Writer packet{packet_scratch, sizeof(packet_scratch)};
    packet.field_fixed32(1, from_node);
    packet.field_fixed32(2, to_node);
    packet.field_message(4, data);
    packet.field_fixed32(6, packet_id);
    packet.field_float(8, static_cast<float>(snr_x10) / 10.0f);
    packet.field_int32(12, rssi_x10 / 10);

    Writer from_radio{out, capacity};
    from_radio.field_message(2, packet);
    return from_radio.ok ? from_radio.length : 0;
}

} // namespace lilyshark
