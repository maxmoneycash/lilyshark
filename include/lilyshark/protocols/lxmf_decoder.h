#pragma once

// Reading an LXMF message carried inside a Reticulum packet.
//
// Reticulum moves packets; LXMF is the message format almost everything on a
// Reticulum network actually speaks, and it is an open, documented structure.
// Without it an analyzer can say "a 214-byte data packet took three hops to
// destination 0x1a2b3c4d" and nothing whatsoever about what was carried --
// which is the difference between a link tester and a protocol analyzer.
//
// Nothing here attacks a cipher. A message to a SINGLE destination is
// encrypted end to end and stays that way; this parses the messages that were
// never encrypted in the first place -- PLAIN destinations, and the outer
// structure of anything else -- and gives up the moment the bytes stop
// parsing. That an unencrypted destination type carries readable text is a
// property of the protocol worth showing plainly, not a protection worth
// defeating.
//
// Wire format (LXMF specification):
//
//     16 bytes   destination hash
//     16 bytes   source hash
//     64 bytes   Ed25519 signature
//     remainder  msgpack array [timestamp, content, title, fields]
//
// Note the payload order: content comes *before* title. Getting that backwards
// produces a decoder that confidently mislabels every message it reads.

#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kLxmfHashLength = 16;
inline constexpr std::size_t kLxmfSignatureLength = 64;
/// Destination + source + signature, before any msgpack payload.
inline constexpr std::size_t kLxmfHeaderLength =
    (kLxmfHashLength * 2U) + kLxmfSignatureLength;

/// How much of a message body this build will keep. A LXMF message can be far
/// larger than a 320x240 panel can show, and an analyzer running on 8 MB of
/// PSRAM should bound what it copies out of a radio frame.
inline constexpr std::size_t kLxmfMaxContentBytes = 192;
inline constexpr std::size_t kLxmfMaxTitleBytes = 64;

struct LxmfMessage {
    /// True only when the whole structure parsed: header, payload array, and
    /// every element this build reads out of it.
    bool readable = false;

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
};

/// Try to read `length` bytes as an LXMF message.
///
/// Returns false and leaves `out` untouched whenever the bytes do not parse.
/// Encrypted payloads are noise to this function, and noise must never be
/// presented as a message.
bool readLxmfMessage(const std::uint8_t *bytes, std::size_t length,
                     LxmfMessage &out) noexcept;

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
