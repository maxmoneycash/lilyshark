#include "lilyshark/core/lsk_line_assembler.h"

#include <cassert>
#include <string>
#include <vector>

using lilyshark::LskLineAssembler;

int main()
{
    LskLineAssembler parser;
    std::vector<std::string> lines;
    const auto collect = [&](const char *line) { lines.emplace_back(line); };

    parser.feed("LSK HE", 6, collect);
    parser.feed("LLO\nLSK BYE\r\n", 13, collect);
    assert((lines == std::vector<std::string>{"LSK HELLO", "LSK BYE"}));

    lines.clear();
    const std::string longest(LskLineAssembler::kCapacity - 1, 'A');
    parser.feed(longest.data(), longest.size(), collect);
    parser.feed("\n", 1, collect);
    assert(lines.size() == 1 && lines[0] == longest);

    lines.clear();
    const std::string too_long(LskLineAssembler::kCapacity, 'B');
    parser.feed(too_long.data(), too_long.size(), collect);
    parser.feed("LSK INJ deadbeef\nLSK HELLO\n", 27, collect);
    assert((lines == std::vector<std::string>{"LSK HELLO"}));

    lines.clear();
    const char nul_line[] = {'L', 'S', 'K', ' ', 'I', 'N', 'J', '\0', 'x', '\n'};
    parser.feed(nul_line, sizeof(nul_line), collect);
    parser.feed("LSK HELLO\n", 10, collect);
    assert((lines == std::vector<std::string>{"LSK HELLO"}));

    lines.clear();
    parser.feed("LSK INJ ", 8, collect);
    parser.reset();  // BLE disconnect: the next central cannot finish this line.
    parser.feed("deadbeef\nLSK HELLO\n", 19, collect);
    assert((lines == std::vector<std::string>{"deadbeef", "LSK HELLO"}));
}
