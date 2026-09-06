#pragma once

// Read clear or already-decrypted LXMF messages. This parser checks structure;
// callers must inspect the Reticulum envelope before passing captured bytes.
//
// Stored LXMF framing:
//
//     16 bytes   destination hash
//     16 bytes   source hash
//     64 bytes   Ed25519 signature
//     remainder  msgpack array [timestamp, title, content, fields, optional stamp]
//
// Opportunistic delivery strips the destination hash; it is carried by the
// Reticulum header instead. Callers select that 80-byte framing explicitly.
// Packing order and framing: https://github.com/markqvist/LXMF/blob/master/LXMF/LXMessage.py

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kLxmfHashLength = 16;
inline constexpr std::size_t kLxmfSignatureLength = 64;
/// Destination + source + signature, before any msgpack payload.
inline constexpr std::size_t kLxmfHeaderLength =
    (kLxmfHashLength * 2U) + kLxmfSignatureLength;
inline constexpr std::size_t kLxmfOpportunisticHeaderLength =
    kLxmfHashLength + kLxmfSignatureLength;

enum class LxmfFraming : std::uint8_t { AtRest, Opportunistic };

/// How much of a message body this build will keep. A LXMF message can be far
/// larger than a 320x240 panel can show, and an analyzer running on 8 MB of
/// PSRAM should bound what it copies out of a radio frame.
inline constexpr std::size_t kLxmfMaxContentBytes = 192;
inline constexpr std::size_t kLxmfMaxTitleBytes = 64;

struct LxmfMessage {
    /// True only when the whole structure parsed: header, payload array, and
    /// every element this build reads out of it.
    bool readable = false;

    // Opportunistic framing has no destination hash in this buffer.
    bool has_destination_hash = false;
    std::uint8_t destination_hash[kLxmfHashLength]{};
    std::uint8_t source_hash[kLxmfHashLength]{};

    /// Seconds since the UNIX epoch, as sent. Zero when the field was absent
    /// or not a number.
    double timestamp = 0.0;
    bool has_timestamp = false;

    bool has_content = false;
    std::uint16_t content_length = 0;
    /// Always NUL-terminated. Non-printable bytes are replaced, so a binary
    /// body cannot scribble control codes across the display.
    char content[kLxmfMaxContentBytes + 1]{};
    /// True when the body was longer than this build keeps.
    bool content_truncated = false;

    bool has_title = false;
    std::uint16_t title_length = 0;
    char title[kLxmfMaxTitleBytes + 1]{};
    bool title_truncated = false;

    /// Number of entries in the trailing fields map, which this build counts
    /// but does not interpret. A non-zero count is how an operator sees that a
    /// message carried structured extras -- telemetry, an image, a ticket.
    std::uint16_t field_count = 0;
    bool has_fields = false;
    // Presence only. This reader does not verify stamp work or signatures.
    bool has_stamp = false;
};

/// Try to read `length` bytes as an LXMF message.
///
/// Returns false and leaves `out` untouched whenever the bytes do not parse.
/// Callers must restrict input to clear or already-decrypted payloads. Parsing
/// validates structure only and cannot prove sender identity or encryption state.
bool readLxmfMessage(const std::uint8_t *bytes, std::size_t length,
                     LxmfMessage &out, LxmfFraming framing = LxmfFraming::AtRest) noexcept;

// The msgpack subset LXMF needs, exposed so it can be tested directly rather
// than only through a whole message.

struct MsgpackCursor {
    const std::uint8_t *bytes = nullptr;
    std::size_t length = 0;
    std::size_t offset = 0;
};

/// Array header. Returns false when the next value is not an array.
bool msgpackReadArrayHeader(MsgpackCursor &cursor, std::uint32_t &count) noexcept;

/// Map header. Returns false when the next value is not a map.
bool msgpackReadMapHeader(MsgpackCursor &cursor, std::uint32_t &count) noexcept;

/// A float, double, or any integer, widened to double.
bool msgpackReadNumber(MsgpackCursor &cursor, double &value) noexcept;

/// A str or bin value. Reports the wire length and hands back a pointer into
/// the source buffer; nothing is copied here.
bool msgpackReadBytes(MsgpackCursor &cursor, const std::uint8_t *&data,
                      std::uint32_t &size) noexcept;

/// True when the next value is nil, consuming it.
bool msgpackReadNil(MsgpackCursor &cursor) noexcept;

/// Step over one complete value of any type, including nested containers.
/// Returns false on a truncated or unsupported encoding.
bool msgpackSkipValue(MsgpackCursor &cursor) noexcept;

}  // namespace lilyshark
