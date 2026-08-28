#include "lilyshark/protocols/lxmf_decoder.h"

#include <cstring>

namespace lilyshark {
namespace {

bool take(MsgpackCursor &cursor, std::size_t count, const std::uint8_t *&out) noexcept
{
    if (cursor.bytes == nullptr) return false;
    if (count > cursor.length || cursor.offset > cursor.length - count) return false;
    out = cursor.bytes + cursor.offset;
    cursor.offset += count;
    return true;
}

bool peek(const MsgpackCursor &cursor, std::uint8_t &tag) noexcept
{
    if (cursor.bytes == nullptr || cursor.offset >= cursor.length) return false;
    tag = cursor.bytes[cursor.offset];
    return true;
}

std::uint32_t readBigEndian(const std::uint8_t *bytes, std::size_t width) noexcept
{
    std::uint32_t value = 0;
    for (std::size_t index = 0; index < width; ++index) {
        value = (value << 8U) | bytes[index];
    }
    return value;
}

/// msgpack stores floats big-endian in IEEE-754 form. Assembled through an
/// integer and memcpy'd rather than cast, so this stays defined behaviour and
/// does not depend on the host's byte order.
double readFloat64(const std::uint8_t *bytes) noexcept
{
    std::uint64_t bits = 0;
    for (std::size_t index = 0; index < 8U; ++index) {
        bits = (bits << 8U) | bytes[index];
    }
    double value = 0.0;
    std::memcpy(&value, &bits, sizeof(value));
    return value;
}

float readFloat32(const std::uint8_t *bytes) noexcept
{
    std::uint32_t bits = readBigEndian(bytes, 4U);
    float value = 0.0F;
    std::memcpy(&value, &bits, sizeof(value));
    return value;
}

/// Copy a body out of the frame, bounded, NUL-terminated, and stripped of
/// anything that would misbehave on a text display. A message body arrives
/// from the air and is not owed any trust.
void copyPrintable(char *destination, std::size_t capacity, const std::uint8_t *source,
                   std::uint32_t size, std::uint16_t &length, bool &truncated) noexcept
{
    const std::size_t limit = capacity - 1U;
    const std::size_t count = size > limit ? limit : size;
    for (std::size_t index = 0; index < count; ++index) {
        const std::uint8_t byte = source[index];
        // Printable ASCII survives; a newline becomes a space so one message
        // cannot take several rows. Everything else becomes a dot, which keeps
        // the length honest without rendering control codes.
        if (byte == '\n' || byte == '\r' || byte == '\t') {
            destination[index] = ' ';
        } else if (byte >= 0x20 && byte < 0x7f) {
            destination[index] = static_cast<char>(byte);
        } else {
            destination[index] = '.';
        }
    }
    destination[count] = '\0';
    length = static_cast<std::uint16_t>(size);
    truncated = size > limit;
}

}  // namespace

bool msgpackReadArrayHeader(MsgpackCursor &cursor, std::uint32_t &count) noexcept
{
    std::uint8_t tag = 0;
    if (!peek(cursor, tag)) return false;
    const std::uint8_t *raw = nullptr;
    if ((tag & 0xf0U) == 0x90U) {
        if (!take(cursor, 1U, raw)) return false;
        count = tag & 0x0fU;
        return true;
    }
    if (tag == 0xdcU) {
        if (!take(cursor, 3U, raw)) return false;
        count = readBigEndian(raw + 1, 2U);
        return true;
    }
    if (tag == 0xddU) {
        if (!take(cursor, 5U, raw)) return false;
        count = readBigEndian(raw + 1, 4U);
        return true;
    }
    return false;
}

bool msgpackReadMapHeader(MsgpackCursor &cursor, std::uint32_t &count) noexcept
{
    std::uint8_t tag = 0;
    if (!peek(cursor, tag)) return false;
    const std::uint8_t *raw = nullptr;
    if ((tag & 0xf0U) == 0x80U) {
        if (!take(cursor, 1U, raw)) return false;
        count = tag & 0x0fU;
        return true;
    }
    if (tag == 0xdeU) {
        if (!take(cursor, 3U, raw)) return false;
        count = readBigEndian(raw + 1, 2U);
        return true;
    }
    if (tag == 0xdfU) {
        if (!take(cursor, 5U, raw)) return false;
        count = readBigEndian(raw + 1, 4U);
        return true;
    }
    return false;
}

bool msgpackReadNumber(MsgpackCursor &cursor, double &value) noexcept
{
    std::uint8_t tag = 0;
    if (!peek(cursor, tag)) return false;
    const std::uint8_t *raw = nullptr;
    if (tag < 0x80U) {  // positive fixint
        if (!take(cursor, 1U, raw)) return false;
        value = static_cast<double>(tag);
        return true;
    }
    if (tag >= 0xe0U) {  // negative fixint
        if (!take(cursor, 1U, raw)) return false;
        value = static_cast<double>(static_cast<std::int8_t>(tag));
        return true;
    }
    switch (tag) {
        case 0xcaU:  // float32
            if (!take(cursor, 5U, raw)) return false;
            value = static_cast<double>(readFloat32(raw + 1));
            return true;
        case 0xcbU:  // float64
            if (!take(cursor, 9U, raw)) return false;
            value = readFloat64(raw + 1);
            return true;
        case 0xccU:  // uint8
            if (!take(cursor, 2U, raw)) return false;
            value = static_cast<double>(raw[1]);
            return true;
        case 0xcdU:  // uint16
            if (!take(cursor, 3U, raw)) return false;
            value = static_cast<double>(readBigEndian(raw + 1, 2U));
            return true;
        case 0xceU:  // uint32
            if (!take(cursor, 5U, raw)) return false;
            value = static_cast<double>(readBigEndian(raw + 1, 4U));
            return true;
        case 0xcfU: {  // uint64
            if (!take(cursor, 9U, raw)) return false;
            std::uint64_t bits = 0;
            for (std::size_t index = 0; index < 8U; ++index) {
                bits = (bits << 8U) | raw[1 + index];
            }
            value = static_cast<double>(bits);
            return true;
        }
        case 0xd0U:  // int8
            if (!take(cursor, 2U, raw)) return false;
            value = static_cast<double>(static_cast<std::int8_t>(raw[1]));
            return true;
        case 0xd1U:  // int16
            if (!take(cursor, 3U, raw)) return false;
            value = static_cast<double>(
                static_cast<std::int16_t>(readBigEndian(raw + 1, 2U)));
            return true;
        case 0xd2U:  // int32
            if (!take(cursor, 5U, raw)) return false;
            value = static_cast<double>(
                static_cast<std::int32_t>(readBigEndian(raw + 1, 4U)));
            return true;
        case 0xd3U: {  // int64
            if (!take(cursor, 9U, raw)) return false;
            std::uint64_t bits = 0;
            for (std::size_t index = 0; index < 8U; ++index) {
                bits = (bits << 8U) | raw[1 + index];
            }
            value = static_cast<double>(static_cast<std::int64_t>(bits));
            return true;
        }
        default:
            return false;
    }
}

bool msgpackReadBytes(MsgpackCursor &cursor, const std::uint8_t *&data,
                      std::uint32_t &size) noexcept
{
    std::uint8_t tag = 0;
    if (!peek(cursor, tag)) return false;
    const std::uint8_t *raw = nullptr;
    std::uint32_t count = 0;
    if ((tag & 0xe0U) == 0xa0U) {  // fixstr
        if (!take(cursor, 1U, raw)) return false;
        count = tag & 0x1fU;
    } else if (tag == 0xd9U || tag == 0xc4U) {  // str8 / bin8
        if (!take(cursor, 2U, raw)) return false;
        count = raw[1];
    } else if (tag == 0xdaU || tag == 0xc5U) {  // str16 / bin16
        if (!take(cursor, 3U, raw)) return false;
        count = readBigEndian(raw + 1, 2U);
    } else if (tag == 0xdbU || tag == 0xc6U) {  // str32 / bin32
        if (!take(cursor, 5U, raw)) return false;
        count = readBigEndian(raw + 1, 4U);
    } else {
        return false;
    }
    const std::uint8_t *body = nullptr;
    if (!take(cursor, count, body)) return false;
    data = body;
    size = count;
    return true;
}

bool msgpackReadNil(MsgpackCursor &cursor) noexcept
{
    std::uint8_t tag = 0;
    if (!peek(cursor, tag) || tag != 0xc0U) return false;
    const std::uint8_t *raw = nullptr;
    return take(cursor, 1U, raw);
}

bool msgpackSkipValue(MsgpackCursor &cursor) noexcept
{
    std::uint8_t tag = 0;
    if (!peek(cursor, tag)) return false;

    if (msgpackReadNil(cursor)) return true;

    // Booleans have no reader of their own; nothing in LXMF needs their value.
    if (tag == 0xc2U || tag == 0xc3U) {
        const std::uint8_t *raw = nullptr;
        return take(cursor, 1U, raw);
    }

    {
        MsgpackCursor probe = cursor;
        const std::uint8_t *data = nullptr;
        std::uint32_t size = 0;
        if (msgpackReadBytes(probe, data, size)) {
            cursor = probe;
            return true;
        }
    }
    {
        MsgpackCursor probe = cursor;
        double value = 0.0;
        if (msgpackReadNumber(probe, value)) {
            cursor = probe;
            return true;
        }
    }
    {
        MsgpackCursor probe = cursor;
        std::uint32_t count = 0;
        if (msgpackReadArrayHeader(probe, count)) {
            for (std::uint32_t index = 0; index < count; ++index) {
                if (!msgpackSkipValue(probe)) return false;
            }
            cursor = probe;
            return true;
        }
    }
    {
        MsgpackCursor probe = cursor;
        std::uint32_t count = 0;
        if (msgpackReadMapHeader(probe, count)) {
            for (std::uint32_t index = 0; index < count; ++index) {
                if (!msgpackSkipValue(probe)) return false;  // key
                if (!msgpackSkipValue(probe)) return false;  // value
            }
            cursor = probe;
            return true;
        }
    }
    // ext, fixext and anything else this build does not need: refuse rather
    // than guess a width and walk off into the rest of the frame.
    return false;
}

bool readLxmfMessage(const std::uint8_t *bytes, std::size_t length,
                     LxmfMessage &out) noexcept
{
    if (bytes == nullptr || length <= kLxmfHeaderLength) return false;

    LxmfMessage message{};
    std::memcpy(message.destination_hash, bytes, kLxmfHashLength);
    std::memcpy(message.source_hash, bytes + kLxmfHashLength, kLxmfHashLength);

    MsgpackCursor cursor{bytes + kLxmfHeaderLength, length - kLxmfHeaderLength, 0};
    std::uint32_t elements = 0;
    if (!msgpackReadArrayHeader(cursor, elements)) return false;
    // The specification fixes four elements: timestamp, content, title,
    // fields. A shorter array is not an LXMF payload, and a longer one is a
    // format this build does not know how to read.
    if (elements != 4U) return false;

    double timestamp = 0.0;
    if (msgpackReadNumber(cursor, timestamp)) {
        message.timestamp = timestamp;
        message.has_timestamp = true;
    } else if (!msgpackReadNil(cursor)) {
        return false;
    }

    const std::uint8_t *data = nullptr;
    std::uint32_t size = 0;
    if (msgpackReadBytes(cursor, data, size)) {
        if (size > 0U) {
            copyPrintable(message.content, sizeof(message.content), data, size,
                          message.content_length, message.content_truncated);
            message.has_content = true;
        }
    } else if (!msgpackReadNil(cursor)) {
        return false;
    }

    if (msgpackReadBytes(cursor, data, size)) {
        if (size > 0U) {
            copyPrintable(message.title, sizeof(message.title), data, size,
                          message.title_length, message.title_truncated);
            message.has_title = true;
        }
    } else if (!msgpackReadNil(cursor)) {
        return false;
    }

    std::uint32_t field_count = 0;
    if (msgpackReadMapHeader(cursor, field_count)) {
        // Counted, not interpreted: the count is what tells an operator a
        // message carried structured extras. Every entry is still stepped
        // over, so a malformed field map fails the whole parse rather than
        // leaving a half-read message looking complete.
        for (std::uint32_t index = 0; index < field_count; ++index) {
            if (!msgpackSkipValue(cursor)) return false;
            if (!msgpackSkipValue(cursor)) return false;
        }
        message.field_count = static_cast<std::uint16_t>(field_count);
        message.has_fields = field_count > 0U;
    } else if (!msgpackReadNil(cursor)) {
        return false;
    }

    message.readable = true;
    out = message;
    return true;
}

}  // namespace lilyshark
