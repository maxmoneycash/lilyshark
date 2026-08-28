#!/usr/bin/env python3
"""Watch a Lilyshark T-Deck over USB and summarise what it hears.

The firmware streams LSK JSON lines over the CDC serial port. This reads them
for a while and reports the device's identity, GPS state, and every node it
heard — which is the whole of "did the flash work and can it hear anyone".

    python3 scripts/listen_tdeck.py /dev/cu.usbmodem1101 60

Needs pyserial (`pip install pyserial`). The port name does not identify the
deck — it stays the same when you swap devices on one cable. The `local` line
printed first is the deck's real identity.
"""
from __future__ import print_function

import collections
import json
import sys
import time

try:
    import serial
except ImportError:
    print("pyserial is required:  pip install pyserial", file=sys.stderr)
    sys.exit(2)


def main():
    if len(sys.argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    port, seconds = sys.argv[1], int(sys.argv[2])
    link = serial.Serial(port, 115200, timeout=1)
    end = time.time() + seconds

    sources = collections.Counter()
    kinds = {}
    local = firmware = gps = position = None
    rx = crc = None

    while time.time() < end:
        try:
            raw = link.readline()
        except serial.SerialException as error:
            print("serial: %s" % error, file=sys.stderr)
            break
        if not raw:
            continue
        line = raw.decode("utf-8", "replace").strip()
        if not line.startswith("{"):
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if "local" in record:
            if local is None:
                print("local: %s  fw: %s" % (record["local"], record.get("fw", "?")))
            local = record["local"]
            firmware = record.get("fw")
        if "gps" in record:
            gps = record["gps"]
        if "pos" in record:
            position = record["pos"]
        if "rx" in record:
            rx, crc = record.get("rx"), record.get("crc")
        if "src" in record:
            sources[record["src"]] += 1
            if "kind" in record:
                kinds[record["src"]] = record["kind"]
            if record["src"] != local:
                print("*** PEER %s kind=%s rssi=%s" % (
                    record["src"], record.get("kind", "?"), record.get("rssi", "?")))

    print("\nsources:")
    for node, count in sources.most_common():
        tag = "SELF" if node == local else "PEER"
        print("  %s: %d  %s" % (node, count, tag))
    print("local=%s fw=%s rx=%s crc=%s gps=%s pos=%s" % (
        local, firmware, rx, crc, gps, position))
    if not sources:
        print("heard nothing — check the profile matches the network in range")
    return 0


if __name__ == "__main__":
    sys.exit(main())
