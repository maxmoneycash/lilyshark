#!/usr/bin/env python3
"""Hold the Meshtastic BLE UUIDs identical across the three languages that
declare them.

The same four identifiers appear in the firmware (C++), the web analyzer
(TypeScript) and the phone app (Swift). No language can import a constant from
another, so the only thing keeping them in step is that somebody types the
same hex three times.

If one drifts, nothing fails to compile and no test goes red. The phone simply
stops finding the deck, on a real radio, in a field -- the same shape of
failure as a mismatched App Group, which is why that is checked too. This
script is the cheapest possible guard: it reads the three files and refuses to
let them disagree.

The service UUID is Meshtastic's, not ours; changing it here does not change
what a phone app looks for. Any edit that makes these files differ is a
mistake, and this catches it in seconds instead of on a hillside.
"""
from __future__ import print_function

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SOURCES = [
    "include/lilyshark/device/tdeck_ble.h",
    "webapp/src/mesh/meshtasticProto.ts",
    "ios/Packages/MeshtasticKit/Sources/MeshtasticKit/BLE/MeshtasticBLEConstants.swift",
]

# Prefixes of the four characteristics, which are what a drifting edit would
# change. Matching on the prefix and then comparing the whole UUID means a
# single altered digit anywhere in the identifier is still caught.
PREFIXES = ["6ba1b218", "2c55e69e", "f75c76d2", "ed9da18c"]
PATTERN = re.compile(
    "|".join(p + r"[0-9a-f-]*" for p in PREFIXES), re.IGNORECASE
)


def uuids_in(path):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return None
    with open(full, "r") as handle:
        text = handle.read()
    return sorted({match.group(0).lower() for match in PATTERN.finditer(text)})


def main():
    found = {}
    for path in SOURCES:
        values = uuids_in(path)
        if values is None:
            print("missing: %s" % path, file=sys.stderr)
            return 1
        if len(values) != len(PREFIXES):
            print(
                "%s declares %d of the %d BLE UUIDs: %s"
                % (path, len(values), len(PREFIXES), values),
                file=sys.stderr,
            )
            return 1
        found[path] = values

    reference_path = SOURCES[0]
    reference = found[reference_path]
    for path, values in found.items():
        if values != reference:
            print("BLE UUIDs disagree between files.", file=sys.stderr)
            print("  %s: %s" % (reference_path, reference), file=sys.stderr)
            print("  %s: %s" % (path, values), file=sys.stderr)
            print(
                "A phone finds a deck by this service UUID. If these differ,\n"
                "the app stops seeing the radio and nothing else complains.",
                file=sys.stderr,
            )
            return 1

    print("BLE UUIDs agree across %d languages" % len(SOURCES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
