#!/usr/bin/env python3
"""Generate deterministic synthetic Lilyshark demo captures.

The capture is what an afternoon on a T-Deck might hear on the US LongFast
slot: a couple dozen frames across the three mesh protocols Lilyshark
decodes, one CRC failure, one truncated frame — and, at sequence 9, a Shelby
off-grid pointer riding behind a 16-byte protocol header. The webapp
analyzer, the Python scanner, and the firmware decoder all find it there.

Every record carries the .lscap synthetic-provenance flag. Regenerating always
produces the same bytes.
"""

from __future__ import annotations

import hashlib
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lscap  # noqa: E402
import shelby_pointer  # noqa: E402

OUT_PATH = Path(__file__).resolve().parents[1] / "samples" / "sample-mesh-traffic.lscap"

FILE_HEADER = lscap.FILE_HEADER.pack(
    lscap.FILE_MAGIC, lscap.FORMAT_MAJOR, lscap.FORMAT_MINOR,
    lscap.FILE_HEADER_SIZE, lscap.RECORD_HEADER_SIZE,
    0, 1_000_000, 0,
)

# present_fields bits for everything the demo frames report.
PRESENT = (
    (1 << 0)   # timestamp
    | (1 << 1)  # center_frequency
    | (1 << 2)  # bandwidth
    | (1 << 3)  # airtime
    | (1 << 4)  # frequency_error
    | (1 << 5)  # rssi
    | (1 << 6)  # snr
    | (1 << 8)  # preamble
    | (1 << 9)  # sync_word
    | (1 << 10)  # profile_id
    | (1 << 11)  # spreading_factor
    | (1 << 12)  # coding_rate
    | (1 << 14)  # radio_status
)

US_LONGFAST_HZ = 906_875_000

# The pointer at sequence 9 references a REAL blob on shelbynet: an earlier
# field capture uploaded via scripts/shelby-put.ts (webapp). Resolving this
# commitment through the indexer and fetching the bytes from the Shelby RPC
# is exactly what the analyzer's RESOLVE button does.
#   object: @3494…8728/captures/field-capture-0846.lscap
#   expires: 2026-11-13T21:51:31Z
OWNER = bytes.fromhex(
    "34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728"
)
REAL_COMMITMENT = bytes.fromhex(
    "6ab9566563ba70a73965f89a46edf3d49978c5091b8da8786e8cb58a449a32c9"
)
REAL_SIZE = 4495
REAL_EXPIRY_UNIX = 1_794_606_691


def demo_pointer() -> bytes:
    """The pointer embedded at sequence 9: an .lscap capture stored on Shelby."""
    return shelby_pointer.encode_pointer(
        flags=shelby_pointer.FLAG_CAPTURE,
        commitment=REAL_COMMITMENT,
        owner=OWNER,
        size_bytes=REAL_SIZE,
        expires_at_unix=REAL_EXPIRY_UNIX,
    )


def payloads(plain: bool = False) -> list[tuple[str, bytes]]:
    rng = random.Random(0x51B)
    frames: list[tuple[str, bytes]] = []
    for index in range(24):
        if index == 9 and not plain:
            # A pointer inside an enclosing protocol's payload: 16 header
            # bytes first, matching the placement used on the air.
            header = bytes(rng.randrange(256) for _ in range(16))
            frames.append(("meshtastic+shelby-pointer", header + demo_pointer()))
            continue
        kind = ("meshtastic", "meshcore", "reticulum")[index % 3]
        length = rng.randrange(24, 180)
        frames.append((kind, bytes(rng.randrange(256) for _ in range(length))))
    return frames


def build(plain: bool = False) -> bytes:
    rng = random.Random(0x15CA9)
    out = bytearray(FILE_HEADER)
    timestamp = 5_000_000
    for sequence, (kind, payload) in enumerate(payloads(plain)):
        truncated = kind == "reticulum" and sequence == 20
        captured = payload[:-7] if truncated else payload
        crc = 3 if sequence == 14 else 2  # one CRC failure at sequence 14
        direction = 2 if sequence == 17 else 1  # one transmitted frame
        timestamp += rng.randrange(1_800_000, 4_200_000)
        out += lscap.RECORD_HEADER.pack(
            lscap.RECORD_MAGIC,
            lscap.RECORD_HEADER_SIZE,
            1,                     # record layout version
            len(captured),
            len(payload),
            sequence,
            timestamp,
            PRESENT,
            US_LONGFAST_HZ,
            250_000,               # bandwidth Hz
            439,                   # bit rate bps at SF11/BW250/CR4:5
            0,                     # frequency deviation (LoRa)
            400_000 + len(payload) * 4_600,  # airtime us
            rng.randrange(-4_200, 4_200),    # frequency error Hz
            rng.randrange(-1150, -820),      # RSSI dBm x10
            rng.randrange(-120, 105),        # SNR dB x10
            16,                    # preamble symbols
            0x2B,                  # sync word
            1,                     # profile id
            0,                     # radio status
            0,                     # tx power (not reported on rx)
            11,                    # spreading factor
            5,                     # coding rate denominator
            20,                    # channel index (US slot 20)
            0,                     # radio index
            1,                     # modulation: LoRa
            direction,
            crc,
            lscap.SYNTHETIC_METADATA_FLAG,
            b"\x00\x00\x00",
        )
        out += captured
    return bytes(out)


def main() -> int:
    # --plain: a local synthetic companion with the same shape and no pointer
    # of its own. The published Shelby commitment remains immutable and is not
    # derived from this regenerated fixture.
    if "--plain" in sys.argv:
        out = Path(__file__).resolve().parents[1] / "samples" / "field-capture-0846.lscap"
        data = build(plain=True)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        print(f"wrote {out} ({len(data)} bytes, 24 records, no pointer)")
        return 0
    data = build()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_bytes(data)
    print(f"wrote {OUT_PATH} ({len(data)} bytes, 24 records)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
