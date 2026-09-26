#include "lilyshark/core/lsk_tx_line_framer.h"

#include <cassert>
#include <cstdint>
#include <string>
#include <vector>

using lilyshark::LskTxLineFramer;

template <std::size_t N, typename Sink>
bool feed(LskTxLineFramer<N> &framer, const std::string &text, Sink sink)
{
    return framer.feed(reinterpret_cast<const std::uint8_t *>(text.data()),
                       text.size(), sink);
}

int main()
{
    LskTxLineFramer<32> framer;
    std::vector<std::string> sent;
    const auto collect = [&](const std::uint8_t *line, std::size_t length) {
        sent.emplace_back(reinterpret_cast<const char *>(line), length);
        return true;
    };

    assert(feed(framer, "LSK F {", collect));
    assert(sent.empty());
    assert(feed(framer, "\"seq\":1}\nLSK OK\n", collect));
    assert((sent == std::vector<std::string>{"LSK F {\"seq\":1}\n", "LSK OK\n"}));

    sent.clear();
    const std::string longest(31, 'y');
    assert(feed(framer, longest + "\n", collect));
    assert((sent == std::vector<std::string>{longest + "\n"}));

    sent.clear();
    const std::string oversized(32, 'x');
    assert(!feed(framer, oversized, collect));
    assert(!feed(framer, "LSK INJ bad\n", collect));
    assert(sent.empty());
    assert(feed(framer, "LSK HELLO\n", collect));
    assert((sent == std::vector<std::string>{"LSK HELLO\n"}));

    sent.clear();
    const auto full = [&](const std::uint8_t *, std::size_t) { return false; };
    assert(!feed(framer, "LSK T {bad}\n", full));
    assert(sent.empty());
    assert(feed(framer, "LSK T {good}\n", collect));
    assert((sent == std::vector<std::string>{"LSK T {good}\n"}));

    sent.clear();
    assert(feed(framer, "LSK F {partial", collect));
    framer.reset();
    assert(feed(framer, "LSK HELLO\n", collect));
    assert((sent == std::vector<std::string>{"LSK HELLO\n"}));
}
