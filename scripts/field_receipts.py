#!/usr/bin/env python3
"""Derive Field Receipts witness keys from .lscap captures.

The derivation is frozen in docs/protocol/field-receipts.md ("Witness key
derivation (normative)") and pinned by WITNESS-VECTOR-1. This is the
reference implementation — the same role scripts/shelby_pointer.py plays
for the pointer format. Version 1 .lscap records carry only boot-relative
timestamps, so `keys` needs a wall-clock anchor (--epoch, the unix time of
tick 0) before any frame is eligible.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import lscap  # noqa: E402  -- same directory; added to sys.path by the runner

FREQ_STEP_HZ = 25_000
BUCKET_SECONDS = 60
CRC_VALID = 2
PRESENT_TIMESTAMP = 1 << 0
PRESENT_CENTER_FREQUENCY = 1 << 1

# WITNESS-VECTOR-1, as published in docs/protocol/field-receipts.md.
VECTOR_NAME = "WITNESS-VECTOR-1"
VECTOR_PAYLOAD = bytes(range(0xA0, 0xC0))
VECTOR_FREQ_HZ = 906_862_500  # exactly half-way; exercises round-half-up
VECTOR_UNIX_SECONDS = 1_893_456_000  # 2030-01-01T00:00:00Z
VECTOR_ROUNDED_FREQ_HZ = 906_875_000
VECTOR_TIME_BUCKET = 31_557_600
VECTOR_KEY_HEX = "94ed6915ddbbfb1b5c2557f5ecb61cfe3783f40be380323af53beb8c3b610125"

# Eligibility reasons, named so diagnostics match the spec's numbered rules.
INELIGIBLE_SYNTHETIC = "synthetic"
INELIGIBLE_CRC = "crc_not_valid"
INELIGIBLE_EMPTY = "empty_payload"
INELIGIBLE_TRUNCATED = "truncated"
INELIGIBLE_FIELDS_ABSENT = "required_fields_absent"
INELIGIBLE_NO_WALL_CLOCK = "no_wall_clock"
INELIGIBLE_SELF_TRANSMITTED = "self_transmitted"

DIRECTION_TRANSMIT = 2


def round_frequency_hz(freq_hz: int) -> int:
    """Round to the nearest 25 kHz step, half-up (integer arithmetic)."""
    return ((freq_hz + FREQ_STEP_HZ // 2) // FREQ_STEP_HZ) * FREQ_STEP_HZ


def time_bucket(unix_seconds: int) -> int:
    return unix_seconds // BUCKET_SECONDS


def witness_preimage(payload: bytes, freq_hz: int, unix_seconds: int) -> bytes:
    """The exact byte string hashed: payload || u32le(freq') || u32le(bucket)."""
    return (
        payload
        + round_frequency_hz(freq_hz).to_bytes(4, "little")
        + time_bucket(unix_seconds).to_bytes(4, "little")
    )


def witness_key(payload: bytes, freq_hz: int, unix_seconds: int) -> bytes:
    return hashlib.sha256(witness_preimage(payload, freq_hz, unix_seconds)).digest()


def frame_ineligibility(record: dict[str, object], has_wall_clock: bool) -> str | None:
    """Return the spec's reason a record yields no key, or None if eligible.

    Synthetic is checked first: those frames are refused, not skipped. A frame
    the capturing deck sent is refused next, for the same reason -- a witness
    key asserts that somebody heard a transmission they did not make, so one
    computed over our own beacon attests to nothing. Captures written before
    the firmware timestamped its own transmissions have those records at tick
    zero, and they were skipped here as field-absent by accident; this refuses
    them on purpose, and by the same rule the firmware uses.
    """
    if record["synthetic"]:
        return INELIGIBLE_SYNTHETIC
    if int(record["direction"]) == DIRECTION_TRANSMIT:
        return INELIGIBLE_SELF_TRANSMITTED
    if int(record["crc_state"]) != CRC_VALID:
        return INELIGIBLE_CRC
    captured = int(record["captured_length"])
    if captured < 1:
        return INELIGIBLE_EMPTY
    if captured != int(record["original_length"]):
        return INELIGIBLE_TRUNCATED
    required = PRESENT_TIMESTAMP | PRESENT_CENTER_FREQUENCY
    if int(record["present_fields"]) & required != required:
        return INELIGIBLE_FIELDS_ABSENT
    if not has_wall_clock:
        return INELIGIBLE_NO_WALL_CLOCK
    return None


def command_keys(args: argparse.Namespace) -> int:
    eligible = 0
    refused_synthetic = 0
    skipped: dict[str, int] = {}

    with args.capture.open("rb") as stream:
        file_header = lscap.read_file_header(stream)
        ticks_per_second = int(file_header["timestamp_ticks_per_second"])
        has_wall_clock = args.epoch is not None
        for record in lscap.iter_records(stream, file_header):
            reason = frame_ineligibility(record, has_wall_clock)
            if reason == INELIGIBLE_SYNTHETIC:
                refused_synthetic += 1
                continue
            if reason is not None:
                skipped[reason] = skipped.get(reason, 0) + 1
                continue

            payload = bytes.fromhex(str(record["payload_hex"]))
            freq_hz = int(record["center_frequency_hz"])
            unix_seconds = args.epoch + int(record["timestamp_us"]) // ticks_per_second
            key = witness_key(payload, freq_hz, unix_seconds)
            eligible += 1

            if args.verbose:
                print(
                    json.dumps(
                        {
                            "sequence": record["sequence"],
                            "witness_key_hex": key.hex(),
                            "payload_hex": payload.hex(),
                            "freq_hz": freq_hz,
                            "rounded_freq_hz": round_frequency_hz(freq_hz),
                            "unix_seconds": unix_seconds,
                            "time_bucket": time_bucket(unix_seconds),
                        },
                        separators=(",", ":"),
                    )
                )
            else:
                print(f"{record['sequence']} {key.hex()}")

    if refused_synthetic:
        noun = "frame" if refused_synthetic == 1 else "frames"
        print(
            f"refused {refused_synthetic} synthetic {noun}: simulated frames "
            "never produce witness keys (docs/protocol/field-receipts.md)",
            file=sys.stderr,
        )
    for reason, count in sorted(skipped.items()):
        print(f"skipped {count} ineligible frame(s): {reason}", file=sys.stderr)

    if eligible == 0:
        if args.epoch is None and skipped.get(INELIGIBLE_NO_WALL_CLOCK):
            print(
                "error: no eligible frames — version 1 .lscap records carry no "
                "wall-clock time; pass --epoch <unix seconds of tick 0>",
                file=sys.stderr,
            )
        else:
            print(f"error: no eligible frames in {args.capture}", file=sys.stderr)
        return 1
    return 0


def command_vector(args: argparse.Namespace) -> int:
    del args
    preimage = witness_preimage(VECTOR_PAYLOAD, VECTOR_FREQ_HZ, VECTOR_UNIX_SECONDS)
    key = witness_key(VECTOR_PAYLOAD, VECTOR_FREQ_HZ, VECTOR_UNIX_SECONDS)

    # Self-test: the recomputed key must match the published vector exactly.
    if key.hex() != VECTOR_KEY_HEX:
        print(
            f"error: {VECTOR_NAME} self-test FAILED: computed {key.hex()}, "
            f"published {VECTOR_KEY_HEX}",
            file=sys.stderr,
        )
        return 1
    assert round_frequency_hz(VECTOR_FREQ_HZ) == VECTOR_ROUNDED_FREQ_HZ
    assert time_bucket(VECTOR_UNIX_SECONDS) == VECTOR_TIME_BUCKET

    print(
        json.dumps(
            {
                "name": VECTOR_NAME,
                "payload_hex": VECTOR_PAYLOAD.hex(),
                "freq_hz": VECTOR_FREQ_HZ,
                "rounded_freq_hz": VECTOR_ROUNDED_FREQ_HZ,
                "unix_seconds": VECTOR_UNIX_SECONDS,
                "time_bucket": VECTOR_TIME_BUCKET,
                "preimage_hex": preimage.hex(),
                "witness_key_hex": key.hex(),
                "self_test": "ok",
            },
            indent=2,
        )
    )
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Derive Field Receipts witness keys from .lscap captures."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    keys = commands.add_parser(
        "keys",
        help="print one line per eligible frame: sequence and witness key hex",
    )
    keys.add_argument("capture", type=Path)
    keys.add_argument(
        "--epoch",
        type=int,
        default=None,
        help="wall-clock anchor: unix seconds at capture tick 0 (required for "
        "version 1 captures, which store only boot-relative time)",
    )
    keys.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="print each frame's derivation inputs as JSON alongside the key",
    )
    keys.set_defaults(func=command_keys)

    vector = commands.add_parser(
        "vector",
        help=f"print {VECTOR_NAME}'s inputs and key after recomputing it",
    )
    vector.set_defaults(func=command_vector)

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return args.func(args)
    except lscap.CaptureFormatError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except BrokenPipeError:
        return 0
    except OSError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
