#!/usr/bin/env python3
"""Verify that a merged T-Deck factory image contains this exact build."""

from __future__ import annotations

import argparse
from pathlib import Path


BOOTLOADER_OFFSET = 0x0000
PARTITIONS_OFFSET = 0x8000
APPLICATION_OFFSET = 0x10000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--factory", required=True, type=Path)
    parser.add_argument("--app", required=True, type=Path)
    parser.add_argument("--bootloader", required=True, type=Path)
    parser.add_argument("--partitions", required=True, type=Path)
    return parser.parse_args()


def read_nonempty(path: Path) -> bytes:
    try:
        data = path.read_bytes()
    except OSError as error:
        raise SystemExit(f"cannot read {path}: {error}") from error
    if not data:
        raise SystemExit(f"image is empty: {path}")
    return data


def require_slice(factory: bytes, offset: int, expected: bytes, label: str) -> None:
    end = offset + len(expected)
    if end > len(factory):
        raise SystemExit(
            f"factory image ends before {label}: need 0x{end:X}, have 0x{len(factory):X}"
        )
    if factory[offset:end] != expected:
        raise SystemExit(
            f"factory image does not contain the current {label} at 0x{offset:X}"
        )


def main() -> None:
    args = parse_args()
    factory = read_nonempty(args.factory)
    app = read_nonempty(args.app)
    bootloader = read_nonempty(args.bootloader)
    partitions = read_nonempty(args.partitions)

    if bootloader[0] != 0xE9:
        raise SystemExit("bootloader does not start with an ESP image header")
    if app[0] != 0xE9:
        raise SystemExit("application does not start with an ESP image header")

    require_slice(factory, BOOTLOADER_OFFSET, bootloader, "bootloader")
    require_slice(factory, PARTITIONS_OFFSET, partitions, "partition table")
    require_slice(factory, APPLICATION_OFFSET, app, "application")

    print(
        "Factory image verified: "
        f"bootloader {len(bootloader)} B, partitions {len(partitions)} B, "
        f"application {len(app)} B"
    )


if __name__ == "__main__":
    main()
