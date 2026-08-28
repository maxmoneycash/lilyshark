// Structured fuzzing of the LXMF reader.
//
// Random bytes rarely reach the interesting paths of a parser: almost every
// draw fails at the array header. Mutating *valid* messages does reach them,
// so this walks single-byte, truncation, and length-field mutations across a
// known-good frame and requires the reader to stay inside its own bounds for
// every one of them.

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "lilyshark/protocols/lxmf_decoder.h"

using namespace lilyshark;

namespace {

std::vector<std::uint8_t> goodMessage()
{
    std::vector<std::uint8_t> frame;
    for (int i = 0; i < 16; ++i) frame.push_back(static_cast<std::uint8_t>(0x10 + i));
    for (int i = 0; i < 16; ++i) frame.push_back(static_cast<std::uint8_t>(0x20 + i));
    for (int i = 0; i < 64; ++i) frame.push_back(static_cast<std::uint8_t>((i * 3) & 0xff));
    // msgpack: fixarray(4), float64, bin8 "HELLO", bin8 "T", fixmap(1) 1 -> 7
    frame.push_back(0x94);
    frame.push_back(0xcb);
    for (int i = 0; i < 8; ++i) frame.push_back(0x40);
    frame.push_back(0xc4); frame.push_back(0x05);
    for (char c : {'H', 'E', 'L', 'L', 'O'}) frame.push_back(static_cast<std::uint8_t>(c));
    frame.push_back(0xc4); frame.push_back(0x01); frame.push_back('T');
    frame.push_back(0x81); frame.push_back(0x01); frame.push_back(0x07);
    return frame;
}

void checkCoherent(const LxmfMessage &m)
{
    // Whatever the reader claims, it must be self-consistent and bounded.
    if (!m.readable) return;
    assert(std::strlen(m.content) <= kLxmfMaxContentBytes);
    assert(std::strlen(m.title) <= kLxmfMaxTitleBytes);
    if (m.has_content) assert(m.content_length > 0);
    if (m.has_title) assert(m.title_length > 0);
    for (const char *s = m.content; *s; ++s) {
        assert(static_cast<unsigned char>(*s) >= 0x20 && static_cast<unsigned char>(*s) < 0x7f);
    }
    for (const char *s = m.title; *s; ++s) {
        assert(static_cast<unsigned char>(*s) >= 0x20 && static_cast<unsigned char>(*s) < 0x7f);
    }
}

}  // namespace

int main()
{
    const std::vector<std::uint8_t> base = goodMessage();
    {
        LxmfMessage m{};
        assert(readLxmfMessage(base.data(), base.size(), m));
        assert(std::strcmp(m.content, "HELLO") == 0);
        assert(std::strcmp(m.title, "T") == 0);
        assert(m.field_count == 1);
    }

    std::size_t accepted = 0;
    std::size_t trials = 0;

    // Every single-byte value at every offset.
    for (std::size_t offset = 0; offset < base.size(); ++offset) {
        for (int value = 0; value < 256; ++value) {
            std::vector<std::uint8_t> frame = base;
            frame[offset] = static_cast<std::uint8_t>(value);
            LxmfMessage m{};
            ++trials;
            if (readLxmfMessage(frame.data(), frame.size(), m)) ++accepted;
            checkCoherent(m);
        }
    }

    // Every truncation.
    for (std::size_t length = 0; length <= base.size(); ++length) {
        LxmfMessage m{};
        ++trials;
        if (readLxmfMessage(base.data(), length, m)) ++accepted;
        checkCoherent(m);
    }

    // Two-byte mutations across the msgpack region, where the length fields live.
    for (std::size_t a = 96; a < base.size(); ++a) {
        for (std::size_t b = a + 1; b < base.size(); ++b) {
            for (int value : {0x00, 0x7f, 0xc4, 0xdb, 0xff}) {
                std::vector<std::uint8_t> frame = base;
                frame[a] = static_cast<std::uint8_t>(value);
                frame[b] = static_cast<std::uint8_t>(0xff - value);
                LxmfMessage m{};
                ++trials;
                if (readLxmfMessage(frame.data(), frame.size(), m)) ++accepted;
                checkCoherent(m);
            }
        }
    }

    // Oversized declared lengths against a short buffer: the classic overread.
    for (int tag : {0xc4, 0xc5, 0xc6, 0xd9, 0xda, 0xdb}) {
        std::vector<std::uint8_t> frame(base.begin(), base.begin() + 97);
        frame.push_back(static_cast<std::uint8_t>(tag));
        for (int i = 0; i < 4; ++i) frame.push_back(0xff);
        LxmfMessage m{};
        ++trials;
        if (readLxmfMessage(frame.data(), frame.size(), m)) ++accepted;
        checkCoherent(m);
    }

    std::printf("lxmf fuzz: %zu trials, %zu accepted, no out-of-bounds\n", trials, accepted);
    return 0;
}
