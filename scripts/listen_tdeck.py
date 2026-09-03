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
    # The firmware only streams once the analyzer link is open; a purely
    # passive listener sees nothing and looks like a dead radio. This is the
    # same handshake the web analyzer performs.
    time.sleep(0.3)
    link.reset_input_buffer()
    link.write(b"LSK HELLO\n")
    link.flush()
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
        # Every link line is "LSK <KIND> {json}" -- ID for identity, T for
        # telemetry, F for a heard frame. Parsing bare JSON finds nothing and
        # looks exactly like a dead radio, which is how the first version of
        # this script reported a perfectly healthy deck as silent.
        if not line.startswith("LSK "):
            continue
        parts = line.split(" ", 2)
        if len(parts) < 3:
            continue
        kind, body = parts[1], parts[2]
        if not body.startswith("{"):
            continue
        try:
            record = json.loads(body)
        except ValueError:
            continue
        if kind == "ID" and local is None:
            print("local: %s  fw: %s" % (record.get("node"), record.get("fw", "?")))
            local = record.get("node")
            firmware = record.get("fw")
            continue
        if "gps" in record:
            gps = record["gps"]
        if "pos" in record:
            position = record["pos"]
        if "rx" in record:
            rx, crc = record.get("rx"), record.get("crc")
        if kind == "S" and "db" in record:
            # A finished spectrum sweep pass. Start one from the deck's
            # SPECTRUM screen while this script is attached to see it.
            db = record.get("db") or []
            print("*** SWEEP %.3f-%.3f MHz  bins=%s  peak=%s dBm  floor=%s dBm" % (
                record.get("f0", 0) / 1e6, record.get("f1", 0) / 1e6,
                record.get("bins", len(db)),
                max(db) if db else "?", min(db) if db else "?"))
            continue
        if kind == "F" and "src" in record:
            # src is a node number; the identity is the same value in hex.
            node = "!%08x" % int(record["src"])
            sources[node] += 1
            kinds[node] = record.get("kind", "?")
            # Frames can arrive before the identity does; without the
            # local check this announces the deck's own beacon as a peer.
            if local is not None and node != local:
                print("*** PEER %s kind=%s rssi=%.1f%s" % (
                    node, record.get("kind", "?"),
                    record.get("rssi_x10", 0) / 10.0,
                    "  text=%r" % record["text"] if record.get("text") else ""))

    print("\nsources:")
    for node, count in sources.most_common():
        tag = "SELF" if node == local else "PEER"
        print("  %s: %d  %s" % (node, count, tag))
    try:
        link.write(b"LSK BYE\n")
        link.flush()
    except serial.SerialException:
        pass
    print("local=%s fw=%s rx=%s crc=%s gps=%s pos=%s" % (
        local, firmware, rx, crc, gps, position))
    if not sources:
        print("heard nothing — check the profile matches the network in range")
    return 0


if __name__ == "__main__":
    sys.exit(main())
