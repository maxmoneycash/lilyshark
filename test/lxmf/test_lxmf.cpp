// Fixtures use LXMF 1.1.1 and RNS 1.5.2; regenerate with generate_fixtures.py.

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "lilyshark/protocols/lxmf_decoder.h"
#include "fixtures.h"

using namespace lilyshark;

namespace {

void testPlainMessageReadsEveryPart()
{
    LxmfMessage message{};
    assert(readLxmfMessage(kLxmfPlain, sizeof(kLxmfPlain), message));
    assert(message.readable);
    assert(message.has_destination_hash);

    // Hashes come off the front in order, destination first.
    for (std::size_t index = 0; index < kLxmfHashLength; ++index) {
        assert(message.destination_hash[index] == 0x10 + index);
        assert(message.source_hash[index] == 0x20 + index);
    }

    assert(message.has_timestamp);
    assert(message.timestamp > 1771199999.0 && message.timestamp < 1771200002.0);

    // LXMF packs title second and content third.
    assert(message.has_content);
    assert(std::strcmp(message.content, "TRACK IS WASHED OUT PAST THE CREEK") == 0);
    assert(message.has_title);
    assert(std::strcmp(message.title, "TRAIL REPORT") == 0);
    assert(!message.content_truncated);

    assert(message.has_fields);
    assert(message.field_count == 2);
}

void testEmptyPartsAreAllowed()
{
    // The specification requires all three parts to be present but permits
    // them to be empty, so an empty body is a valid message and not a
    // malformed one.
    LxmfMessage message{};
    assert(readLxmfMessage(kLxmfEmpty, sizeof(kLxmfEmpty), message));
    assert(message.readable);
    assert(!message.has_content);
    assert(!message.has_title);
    assert(!message.has_fields);
    assert(message.field_count == 0);
}

void testReferenceStackMessages()
{
    for (const bool stamped : {false, true}) {
        const auto *bytes = stamped ? kLxmfStamped : kLxmfReference;
        const std::size_t length = stamped ? sizeof(kLxmfStamped) : sizeof(kLxmfReference);
        for (const auto framing : {LxmfFraming::AtRest, LxmfFraming::Opportunistic}) {
            const std::size_t offset = framing == LxmfFraming::AtRest ? 0U : kLxmfHashLength;
            LxmfMessage message{};
            assert(readLxmfMessage(bytes + offset, length - offset, message, framing));
            assert(std::strcmp(message.title, "Field note") == 0);
            assert(std::strcmp(message.content, "Heard on 913.125 MHz") == 0);
            assert(message.timestamp == 1771200000.5);
            assert(message.has_stamp == stamped);
            assert(message.has_destination_hash == (framing == LxmfFraming::AtRest));
            assert(std::memcmp(message.source_hash, bytes + kLxmfHashLength, kLxmfHashLength) == 0);
            if (!message.has_destination_hash) {
                for (const auto byte : message.destination_hash) assert(byte == 0U);
            }
            for (std::size_t truncated = 0; truncated < length - offset; ++truncated) {
                LxmfMessage incomplete{};
                assert(!readLxmfMessage(bytes + offset, truncated, incomplete, framing));
            }
        }
    }
}

void testMalformedStampAndTrailingBytesAreRefused()
{
    std::vector<std::uint8_t> bytes(std::begin(kLxmfReference), std::end(kLxmfReference));
    bytes.push_back(0x00);
    LxmfMessage message{};
    assert(!readLxmfMessage(bytes.data(), bytes.size(), message));
    // The fifth array element is present but is an integer, not stamp bytes.
    bytes[kLxmfHeaderLength] = 0x95;
    assert(!readLxmfMessage(bytes.data(), bytes.size(), message));
}

void testNilPartsAreAllowed()
{
    LxmfMessage message{};
    assert(readLxmfMessage(kLxmfNils, sizeof(kLxmfNils), message));
    assert(message.readable);
    assert(message.has_timestamp);
    assert(!message.has_content);
    assert(!message.has_title);
    assert(!message.has_fields);
}

void testWrongElementCountIsRefused()
{
    LxmfMessage message{};
    assert(!readLxmfMessage(kLxmfShortArray, sizeof(kLxmfShortArray), message));
    assert(!message.readable);
}

void testOversizedContentIsTruncatedAndSaysSo()
{
    LxmfMessage message{};
    assert(readLxmfMessage(kLxmfLongContent, sizeof(kLxmfLongContent), message));
    assert(message.has_content);
    assert(message.content_truncated);
    // The kept text is bounded, but the reported length is the true one, so a
    // display can say how much was left out rather than silently shortening.
    assert(std::strlen(message.content) == kLxmfMaxContentBytes);
    assert(message.content_length == 300);
}

void testControlBytesCannotReachTheDisplay()
{
    // A body arrives from the air. Nothing in it is owed trust, least of all
    // an escape sequence on a device that renders text.
    LxmfMessage message{};
    assert(readLxmfMessage(kLxmfControlBytes, sizeof(kLxmfControlBytes), message));
    assert(message.has_content);
    for (const char *scan = message.content; *scan != '\0'; ++scan) {
        assert(static_cast<unsigned char>(*scan) >= 0x20);
        assert(static_cast<unsigned char>(*scan) < 0x7f);
    }
    // "A\0B\033C\nD" keeps its length; the newline becomes a space.
    assert(std::strcmp(message.content, "A.B.C D") == 0);
}

void testNestedFieldsAreWalkedNotGuessed()
{
    LxmfMessage message{};
    assert(readLxmfMessage(kLxmfNestedFields, sizeof(kLxmfNestedFields), message));
    assert(message.readable);
    assert(message.has_fields);
    assert(message.field_count == 2);
    assert(std::strcmp(message.content, "hi") == 0);
}

void testTruncationAtEveryLengthIsRefusedNotRead()
{
    // Every prefix of a good message must fail rather than produce a partly
    // filled one. A radio frame can end anywhere.
    for (std::size_t length = 0; length < sizeof(kLxmfPlain); ++length) {
        LxmfMessage message{};
        const bool ok = readLxmfMessage(kLxmfPlain, length, message);
        assert(!ok);
        assert(!message.readable);
    }
    LxmfMessage whole{};
    assert(readLxmfMessage(kLxmfPlain, sizeof(kLxmfPlain), whole));
}

void testNoiseIsNeverAMessage()
{
    // An encrypted payload is noise to this reader, and noise must not be
    // presented as a message. Walk a simple generator over the payload area.
    std::uint8_t frame[220]{};
    for (std::size_t seed = 0; seed < 512; ++seed) {
        std::uint32_t state = static_cast<std::uint32_t>(seed * 2654435761U + 1U);
        for (std::size_t index = 0; index < sizeof(frame); ++index) {
            state = state * 1664525U + 1013904223U;
            frame[index] = static_cast<std::uint8_t>(state >> 24U);
        }
        LxmfMessage message{};
        if (readLxmfMessage(frame, sizeof(frame), message)) {
            // A chance parse is possible, but it must be internally coherent:
            // never a claim of readability with unbounded strings behind it.
            assert(message.readable);
            assert(std::strlen(message.content) <= kLxmfMaxContentBytes);
            assert(std::strlen(message.title) <= kLxmfMaxTitleBytes);
        }
    }
}

void testMsgpackReaderRefusesUnsupportedTypes()
{
    // ext types are not part of what LXMF needs here, and guessing a width
    // would walk the cursor off into the rest of the frame.
    const std::uint8_t ext[] = {0xd4, 0x01, 0x02};
    MsgpackCursor cursor{ext, sizeof(ext), 0};
    assert(!msgpackSkipValue(cursor));
    assert(cursor.offset == 0);
}

void testMsgpackNumbersWidenConsistently()
{
    const std::uint8_t positive_fixint[] = {0x2a};
    MsgpackCursor a{positive_fixint, sizeof(positive_fixint), 0};
    double value = 0.0;
    assert(msgpackReadNumber(a, value));
    assert(value == 42.0);

    const std::uint8_t negative_fixint[] = {0xff};
    MsgpackCursor b{negative_fixint, sizeof(negative_fixint), 0};
    assert(msgpackReadNumber(b, value));
    assert(value == -1.0);

    const std::uint8_t uint32_value[] = {0xce, 0x00, 0x01, 0x00, 0x00};
    MsgpackCursor c{uint32_value, sizeof(uint32_value), 0};
    assert(msgpackReadNumber(c, value));
    assert(value == 65536.0);
}

}  // namespace

int main()
{
    testPlainMessageReadsEveryPart();
    testReferenceStackMessages();
    testMalformedStampAndTrailingBytesAreRefused();
    testEmptyPartsAreAllowed();
    testNilPartsAreAllowed();
    testWrongElementCountIsRefused();
    testOversizedContentIsTruncatedAndSaysSo();
    testControlBytesCannotReachTheDisplay();
    testNestedFieldsAreWalkedNotGuessed();
    testTruncationAtEveryLengthIsRefusedNotRead();
    testNoiseIsNeverAMessage();
    testMsgpackReaderRefusesUnsupportedTypes();
    testMsgpackNumbersWidenConsistently();
    std::printf("lxmf tests passed\n");
    return 0;
}
