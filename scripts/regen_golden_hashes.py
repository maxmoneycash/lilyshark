#!/usr/bin/env python3
"""Regenerate the simulator's golden pixel hashes in src/sim_main.cpp.

The render test hashes every screen and compares against expected values
baked into the source. After a deliberate UI change the expectations must be
refreshed; this runs the render test, captures what it printed, and rewrites
the three expectation arrays and the named single-frame constants in place.

The array slice bounds follow the frame order the render test prints:
analyzer screens first (Screen::count of them), then the shell routes, then
the interaction frames, then the named extras. They are derived from the
source rather than hardcoded, so adding a screen does not silently shear
every later array — the mistake this script exists to prevent.

Run from the repository root, after building the simulator:

    python3 scripts/regen_golden_hashes.py
"""
from __future__ import print_function

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src" / "sim_main.cpp"
PROGRAM = ROOT / ".pio" / "build" / "simulator" / "program"

ARRAYS = [
    "constexpr std::array<std::uint64_t, static_cast<std::size_t>(Screen::count)> expected_hashes",
    "constexpr std::array<std::uint64_t, shell_routes.size()> shell_expected_hashes",
    "constexpr std::array<std::uint64_t, interaction_names.size()> interaction_expected_hashes",
]
NAMED = {
    "MAP NODE CARD": "kMapNodeCardHash",
    "CHAT": "kChatHash",
    "SPECTRUM SWEPT": "kSpectrumSweptHash",
}


def count_array(source, declaration):
    match = re.search(re.escape(declaration) + r"\s*=\s*\{\{(.*?)\}\};", source, re.S)
    if not match:
        raise SystemExit("declaration not found: %s" % declaration)
    return len(re.findall(r"0x[0-9a-f]+ULL", match.group(1)))


def fill(source, declaration, values):
    match = re.search(r"(" + re.escape(declaration) + r"\s*=\s*\{\{)(.*?)(\}\};)", source, re.S)
    body = ",\n".join(
        "        " + ", ".join("0x%sULL" % value for value in values[index : index + 3])
        for index in range(0, len(values), 3)
    )
    return source[: match.start(2)] + "\n" + body + ",\n    " + source[match.end(2) :]


def main():
    if not PROGRAM.exists():
        print("build the simulator first: pio run -e simulator", file=sys.stderr)
        return 1
    result = subprocess.run([str(PROGRAM), "--render-test"], capture_output=True, text=True,
                            timeout=600, cwd=ROOT)
    pairs = re.findall(r"render ([A-Z0-9 &/]+): fnv1a=([0-9a-f]{16})", result.stderr)
    if not pairs:
        print("the render test printed no hashes; its output follows:", file=sys.stderr)
        sys.stderr.write(result.stderr[-2000:])
        return 1

    source = SOURCE.read_text()
    sizes = [count_array(source, declaration) for declaration in ARRAYS]
    named_count = sum(1 for name, _ in pairs if name in NAMED)
    expected_total = sum(sizes) + named_count
    if len(pairs) != expected_total:
        print(
            "frame count mismatch: render test printed %d, source expects %d "
            "(%s arrays + %d named). A screen was added or removed without "
            "its expectation slot — fix the arrays first." % (
                len(pairs), expected_total, "+".join(str(s) for s in sizes), named_count),
            file=sys.stderr,
        )
        return 1

    cursor = 0
    for declaration, size in zip(ARRAYS, sizes):
        # Named frames are interleaved at the end; the arrays consume the
        # ordered prefix that is not a named frame.
        values = []
        while len(values) < size:
            name, value = pairs[cursor]
            cursor += 1
            if name in NAMED:
                continue
            values.append(value)
        source = fill(source, declaration, values)

    for name, value in pairs:
        constant = NAMED.get(name)
        if constant:
            source = re.sub(constant + r" = 0x[0-9a-f]+ULL;",
                            "%s = 0x%sULL;" % (constant, value), source)

    SOURCE.write_text(source)
    print("refreshed %d frame hashes (%s arrays + %d named)" % (
        len(pairs), "+".join(str(s) for s in sizes), named_count))
    print("rebuild and rerun the render test to confirm they hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
