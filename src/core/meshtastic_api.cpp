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
    /// For proto2-style optional fixed fields whose zero is a real value --
    /// latitude_i of 0 is the equator, and skipping it would move the node.
    void field_sfixed32_always(std::uint32_t field, std::int32_t value) noexcept
    {
        tag(field, kWireFixed32);
        const std::uint32_t bits = static_cast<std::uint32_t>(value);
        for (int shift = 0; shift < 32; shift += 8) {
            byte(static_cast<std::uint8_t>(bits >> shift));
        }
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
constexpr std::uint64_t kPortPosition = 3;
constexpr std::uint64_t kPortRouting = 5;

/// A Position the PHONE sent us, in Meshtastic's 1e-7 degree units.
///
/// The deck's own GPS is a small patch antenna indoors; a phone has a far
/// better one and usually already has a fix. Meshtastic's app sends its
/// position to the radio for exactly this reason, so accepting it costs
/// nothing and is what an ordinary client already expects to be able to do.
void parseDataForPosition(const std::uint8_t *bytes, std::size_t length,
                          ApiToRadio &out) noexcept
{
    Reader reader{bytes, bytes + length};
    bool have_lat = false;
    bool have_lon = false;
    std::int32_t latitude_i = 0;
    std::int32_t longitude_i = 0;
    std::uint32_t field = 0;
    std::uint32_t wire = 0;
    const std::uint8_t *sub = nullptr;
    std::size_t sub_length = 0;
    while (reader.next(field, wire, sub, sub_length)) {
        if (field == 1U && wire == kWireFixed32) {
            latitude_i = static_cast<std::int32_t>(static_cast<std::uint32_t>(sub_length));
            have_lat = true;
        }
        if (field == 2U && wire == kWireFixed32) {
            longitude_i = static_cast<std::int32_t>(static_cast<std::uint32_t>(sub_length));
            have_lon = true;
        }
    }
    if (!reader.ok || !have_lat || !have_lon) return;
    // 0,0 is a real place in the Gulf of Guinea and also what an uninitialised
    // struct looks like. Meshtastic's own clients treat it as "no fix", and a
    // deck that believed it would put every unfixed phone on Null Island.
    if (latitude_i == 0 && longitude_i == 0) return;
    // Out-of-range values are a malformed or mis-scaled sender, not a place.
    if (latitude_i > 900000000 || latitude_i < -900000000) return;
    if (longitude_i > 1800000000 || longitude_i < -1800000000) return;
    out.latitude_i = latitude_i;
    out.longitude_i = longitude_i;
    out.kind = ApiToRadio::Kind::Position;
}

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
    if (!reader.ok || payload == nullptr) return;
    if (portnum == kPortPosition) {
        parseDataForPosition(payload, payload_length, out);
        return;
    }
    if (portnum != kPortText) return;
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
        case 3U:  // channel index the phone chose
            if (wire == kWireVarint) out.channel = static_cast<std::uint32_t>(sub_length);
            break;
        case 4U:  // decoded Data
            if (wire == kWireLen) parseDataForText(sub, sub_length, out);
            break;
        case 6U:  // the phone's own packet id, fixed32
            if (wire == kWireFixed32) out.packet_id = static_cast<std::uint32_t>(sub_length);
            break;
        case 10U:  // want_ack
            if (wire == kWireVarint) out.want_ack = sub_length != 0U;
            break;
        default: break;
        }
    }
    if (!reader.ok) out.kind = ApiToRadio::Kind::None;
}

void writeUser(Writer &writer, const ApiNodeEntry &node) noexcept;

/// FromRadio{node_info} for one node, shared by the config dump and the
/// live announcement so the phone hears the same shape both ways.
void writeNodeInfoMessage(Writer &from_radio, const ApiNodeEntry &node) noexcept
{
    std::uint8_t scratch[128]{};
    Writer child{scratch, sizeof(scratch)};
    std::uint8_t user_scratch[64]{};
    Writer user{user_scratch, sizeof(user_scratch)};
    writeUser(user, node);
    child.field_uint(1, node.num);
    child.field_message(2, user);
    if (node.has_position) {
        std::uint8_t position_scratch[16]{};
        Writer position{position_scratch, sizeof(position_scratch)};
        position.field_sfixed32_always(1, node.latitude_i);
        position.field_sfixed32_always(2, node.longitude_i);
        child.field_message(3, position);
    }
    if (node.has_snr) {
        child.field_float(4, static_cast<float>(node.snr_x10) / 10.0f);
    }
    from_radio.field_message(4, child);
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
                                   const ApiChannelEntry *channels,
                                   std::size_t channel_count,
                                   std::uint8_t *out, std::size_t capacity) noexcept
{
    // At least the primary, always: a deck with no stored keys still listens
    // on the default channel, and a phone shown an empty channel list would
    // have nothing to send on.
    if (channels == nullptr || channel_count == 0U) channel_count = 1U;
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
        writeNodeInfoMessage(from_radio, nodes[index - 2U]);
    } else if (index < 2U + node_count + channel_count) {
        // FromRadio.channel, one per channel this deck can seal on.
        //
        // Index 0 is the primary. A one-byte psk of 0x01 is Meshtastic's own
        // shorthand for "the published default key", which is the channel
        // this deck actually listens on.
        //
        // The others carry a NAME and no psk. The phone selects by index and
        // the deck seals -- see ApiChannelEntry. A stock Meshtastic client
        // would read a keyless secondary channel as unencrypted, which is why
        // this is a Lilyshark-to-Lilyshark arrangement and not a claim about
        // what any Meshtastic app will do with it.
        const std::size_t channel_index = index - (2U + node_count);
        std::uint8_t settings_scratch[32]{};
        Writer settings{settings_scratch, sizeof(settings_scratch)};
        const bool primary = channels == nullptr || channel_index == 0U ||
                             channels[channel_index].is_default;
        if (primary) {
            const std::uint8_t default_psk[1] = {0x01};
            settings.field_bytes(2, default_psk, sizeof(default_psk));
        }
        if (channels != nullptr && channels[channel_index].name[0] != '\0') {
            settings.field_string(3, channels[channel_index].name);
        }
        child.field_uint(1, static_cast<std::uint32_t>(channel_index));
        child.field_message(2, settings);
        // Role: PRIMARY for index 0, SECONDARY for the rest. A dump with two
        // PRIMARY channels is malformed to every Meshtastic client.
        child.field_uint(3, channel_index == 0U ? 1U : 2U);
        from_radio.field_message(10, child);
    } else if (index == 2U + node_count + channel_count) {
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
    } else if (index == 3U + node_count + channel_count) {
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

std::size_t encodeApiNodeInfo(const ApiNodeEntry &node, std::uint8_t *out,
                              std::size_t capacity) noexcept
{
    if (out == nullptr || capacity == 0U || node.num == 0U) return 0;
    Writer from_radio{out, capacity};
    writeNodeInfoMessage(from_radio, node);
    return from_radio.ok ? from_radio.length : 0;
}

std::size_t encodeApiRoutingAck(std::uint32_t local_node,
                                std::uint32_t acked_packet_id,
                                std::uint8_t error_reason,
                                std::uint8_t *out, std::size_t capacity) noexcept
{
    if (out == nullptr || capacity == 0U || acked_packet_id == 0U) return 0;
    // Routing{error_reason}: the field lives in a oneof, so even NONE (0)
    // must be written -- an absent field is "no result", not "no error".
    std::uint8_t routing_scratch[4]{};
    Writer routing{routing_scratch, sizeof(routing_scratch)};
    routing.tag(3, kWireVarint);
    routing.varint(error_reason);

    std::uint8_t data_scratch[32]{};
    Writer data{data_scratch, sizeof(data_scratch)};
    data.field_uint(1, kPortRouting);
    data.field_bytes(2, routing.out, routing.length);
    data.field_fixed32(6, acked_packet_id);  // Data.request_id

    std::uint8_t packet_scratch[64]{};
    Writer packet{packet_scratch, sizeof(packet_scratch)};
    packet.field_fixed32(1, local_node);
    packet.field_fixed32(2, local_node);
    packet.field_message(4, data);
    packet.field_uint(11, 120);  // Priority.ACK

    Writer from_radio{out, capacity};
    from_radio.field_message(2, packet);
    return from_radio.ok ? from_radio.length : 0;
}

std::size_t encodeApiPositionPacket(std::uint32_t from_node, std::uint32_t packet_id,
                                    std::int32_t latitude_i, std::int32_t longitude_i,
                                    std::int16_t rssi_x10, std::int16_t snr_x10,
                                    std::uint8_t *out, std::size_t capacity) noexcept
{
    if (out == nullptr || capacity == 0U) return 0;
    std::uint8_t position_scratch[16]{};
    Writer position{position_scratch, sizeof(position_scratch)};
    position.field_sfixed32_always(1, latitude_i);
    position.field_sfixed32_always(2, longitude_i);

    std::uint8_t data_scratch[32]{};
    Writer data{data_scratch, sizeof(data_scratch)};
    data.field_uint(1, kPortPosition);
    data.field_message(2, position);

    std::uint8_t packet_scratch[64]{};
    Writer packet{packet_scratch, sizeof(packet_scratch)};
    packet.field_fixed32(1, from_node);
    packet.field_fixed32(2, 0xffffffffU);
    packet.field_message(4, data);
    packet.field_fixed32(6, packet_id);
    packet.field_float(8, static_cast<float>(snr_x10) / 10.0f);
    packet.field_int32(12, rssi_x10 / 10);

    Writer from_radio{out, capacity};
    from_radio.field_message(2, packet);
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
