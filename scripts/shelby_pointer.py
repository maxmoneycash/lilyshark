#!/usr/bin/env python3
"""Emit, parse, scan, and verify Shelby off-grid pointers.

The wire format is documented in docs/shelby-pointer-format.md and mirrors
include/lilyshark/shelby/shelby_pointer.h exactly: 82 bytes, little-endian,
magic "SHLB". This is the reference tooling for the connected side of the
link — a LoRa node carries the pointer, and a machine like this one resolves
it against the actual blob bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import lscap  # noqa: E402  -- same directory; added to sys.path by the runner

MAGIC = b"SHLB"
VERSION = 1
ENCODED_SIZE = 82
COMMITMENT_SIZE = 32
OWNER_SIZE = 32

FLAG_ENCRYPTED = 1 << 0
FLAG_CHUNKED = 1 << 1
FLAG_CAPTURE = 1 << 2

OFFSET_FLAGS = 5
OFFSET_COMMITMENT = 6
OFFSET_OWNER = 38
OFFSET_SIZE = 70
OFFSET_EXPIRY = 74
OFFSET_CHUNK_INDEX = 78
OFFSET_CHUNK_COUNT = 80

# Mirrored from ShelbyPointerResult in shelby_pointer.h, so diagnostics name
# the same rejection the firmware would report.
REASON_BUFFER_TOO_SMALL = "buffer_too_small"
REASON_NO_MAGIC = "no_magic"
REASON_UNSUPPORTED_VERSION = "unsupported_version"
REASON_MALFORMED = "malformed"


class ShelbyPointerError(ValueError):
    """The input is not a readable Shelby pointer."""

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(f"{reason}: {detail}")
        self.reason = reason


def _check_chunking(chunk_index: int, chunk_count: int) -> None:
    if chunk_count == 0 or chunk_index >= chunk_count:
        raise ShelbyPointerError(
            REASON_MALFORMED,
            f"impossible chunk state: index {chunk_index} of {chunk_count}",
        )


def encode_pointer(
    *,
    flags: int,
    commitment: bytes,
    owner: bytes,
    size_bytes: int,
    expires_at_unix: int,
    chunk_index: int = 0,
    chunk_count: int = 1,
) -> bytes:
    """Encode one pointer. Applies the same validation as the C++ encoder."""
    if len(commitment) != COMMITMENT_SIZE:
        raise ShelbyPointerError(
            REASON_MALFORMED, f"commitment must be {COMMITMENT_SIZE} bytes"
        )
    if len(owner) != OWNER_SIZE:
        raise ShelbyPointerError(REASON_MALFORMED, f"owner must be {OWNER_SIZE} bytes")
    _check_chunking(chunk_index, chunk_count)

    out = bytearray(ENCODED_SIZE)
    out[0:4] = MAGIC
    out[4] = VERSION
    out[OFFSET_FLAGS] = flags & 0xFF
    out[OFFSET_COMMITMENT : OFFSET_COMMITMENT + COMMITMENT_SIZE] = commitment
    out[OFFSET_OWNER : OFFSET_OWNER + OWNER_SIZE] = owner
    out[OFFSET_SIZE : OFFSET_SIZE + 4] = size_bytes.to_bytes(4, "little")
    out[OFFSET_EXPIRY : OFFSET_EXPIRY + 4] = expires_at_unix.to_bytes(4, "little")
    out[OFFSET_CHUNK_INDEX : OFFSET_CHUNK_INDEX + 2] = chunk_index.to_bytes(2, "little")
    out[OFFSET_CHUNK_COUNT : OFFSET_CHUNK_COUNT + 2] = chunk_count.to_bytes(2, "little")
    return bytes(out)


def decode_pointer(data: bytes | bytearray | memoryview, offset: int = 0) -> dict[str, object]:
    """Decode one pointer at `offset`.

    Applies the same checks in the same order as the C++ decoder, so this
    tooling and the firmware accept exactly the same bytes.
    """
    view = bytes(data[offset : offset + ENCODED_SIZE])
    if len(view) < ENCODED_SIZE:
        raise ShelbyPointerError(
            REASON_BUFFER_TOO_SMALL,
            f"need {ENCODED_SIZE} bytes at offset {offset}, found {len(view)}",
        )
    if view[0:4] != MAGIC:
        raise ShelbyPointerError(REASON_NO_MAGIC, "leading bytes are not 'SHLB'")
    version = view[4]
    if version != VERSION:
        raise ShelbyPointerError(
            REASON_UNSUPPORTED_VERSION, f"version {version} is not readable by this build"
        )

    flags = view[OFFSET_FLAGS]
    commitment = view[OFFSET_COMMITMENT : OFFSET_COMMITMENT + COMMITMENT_SIZE]
    owner = view[OFFSET_OWNER : OFFSET_OWNER + OWNER_SIZE]
    size_bytes = int.from_bytes(view[OFFSET_SIZE : OFFSET_SIZE + 4], "little")
    expires_at_unix = int.from_bytes(view[OFFSET_EXPIRY : OFFSET_EXPIRY + 4], "little")
    chunk_index = int.from_bytes(view[OFFSET_CHUNK_INDEX : OFFSET_CHUNK_INDEX + 2], "little")
    chunk_count = int.from_bytes(view[OFFSET_CHUNK_COUNT : OFFSET_CHUNK_COUNT + 2], "little")

    _check_chunking(chunk_index, chunk_count)
    # The chunked flag and the chunk count must agree, otherwise a receiver
    # cannot tell whether it is holding a complete blob.
    if bool(flags & FLAG_CHUNKED) != (chunk_count > 1):
        raise ShelbyPointerError(
            REASON_MALFORMED,
            f"chunked flag ({bool(flags & FLAG_CHUNKED)}) disagrees with "
            f"chunk count {chunk_count}",
        )

    return {
        "version": version,
        "flags": flags,
        "encrypted": bool(flags & FLAG_ENCRYPTED),
        "chunked": bool(flags & FLAG_CHUNKED),
        "capture": bool(flags & FLAG_CAPTURE),
        "commitment_hex": commitment.hex(),
        "owner_hex": owner.hex(),
        "size_bytes": size_bytes,
        "expires_at_unix": expires_at_unix,
        "chunk_index": chunk_index,
        "chunk_count": chunk_count,
    }


def find_pointer(data: bytes | bytearray | memoryview) -> tuple[int, dict[str, object]] | None:
    """Locate a pointer anywhere inside a payload, behind any protocol header."""
    last = len(data) - ENCODED_SIZE
    for offset in range(last + 1):
        if data[offset : offset + 4] != MAGIC:
            continue
        try:
            return offset, decode_pointer(data, offset)
        except ShelbyPointerError:
            continue
    return None


def _parse_owner(text: str) -> bytes:
    cleaned = text[2:] if text.startswith(("0x", "0X")) else text
    try:
        owner = bytes.fromhex(cleaned)
    except ValueError:
        raise argparse.ArgumentTypeError(f"owner is not hex: {text!r}") from None
    if len(owner) != OWNER_SIZE:
        raise argparse.ArgumentTypeError(
            f"owner must be {OWNER_SIZE} bytes ({OWNER_SIZE * 2} hex digits)"
        )
    return owner


def _load_pointer_argument(value: str) -> bytes:
    path = Path(value)
    if path.is_file():
        return path.read_bytes()
    cleaned = value[2:] if value.startswith(("0x", "0X")) else value
    try:
        return bytes.fromhex(cleaned)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"{value!r} is neither a file nor a hex string"
        ) from None


def command_emit(args: argparse.Namespace) -> int:
    blob = args.blob.read_bytes()
    commitment = hashlib.sha256(blob).digest()
    expires = args.expires if args.expires is not None else int(time.time()) + args.days * 86400

    flags = 0
    if args.encrypted:
        flags |= FLAG_ENCRYPTED
    if args.capture:
        flags |= FLAG_CAPTURE

    if args.chunk_size is not None and args.chunk_size < len(blob):
        chunks = list(range(0, len(blob), args.chunk_size))
        chunk_count = len(chunks)
        indices = list(range(chunk_count))
        flags |= FLAG_CHUNKED
    else:
        chunk_count = 1
        indices = [0]

    pointers = []
    for index in indices:
        encoded = encode_pointer(
            flags=flags,
            commitment=commitment,
            owner=args.owner,
            size_bytes=len(blob),
            expires_at_unix=expires,
            chunk_index=index,
            chunk_count=chunk_count,
        )
        suffix = f".{index}" if chunk_count > 1 else ""
        out_path = args.out_dir / f"{args.blob.stem}{suffix}.shlb"
        out_path.write_bytes(encoded)
        summary = decode_pointer(encoded)
        summary["file"] = str(out_path)
        pointers.append(summary)

    print(json.dumps({"blob": str(args.blob), "pointers": pointers}, indent=2))
    return 0


def command_parse(args: argparse.Namespace) -> int:
    data = _load_pointer_argument(args.pointer)
    try:
        found = find_pointer(data) if args.scan else (0, decode_pointer(data))
    except ShelbyPointerError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if found is None:
        print("error: no Shelby pointer found in the input", file=sys.stderr)
        return 1
    offset, pointer = found
    print(json.dumps({"offset": offset, "pointer": pointer}, indent=2))
    return 0


def command_scan(args: argparse.Namespace) -> int:
    hits = 0
    with args.capture.open("rb") as stream:
        file_header = lscap.read_file_header(stream)
        for record in lscap.iter_records(stream, file_header):
            payload = bytes.fromhex(str(record["payload_hex"]))
            found = find_pointer(payload)
            if found is None:
                continue
            offset, pointer = found
            hits += 1
            print(
                json.dumps(
                    {
                        "frame_index": record["index"],
                        "sequence": record["sequence"],
                        "timestamp_us": record["timestamp_us"],
                        "payload_offset": offset,
                        "pointer": pointer,
                    },
                    separators=(",", ":"),
                )
            )
    print(f"{hits} Shelby pointer(s) in {args.capture}", file=sys.stderr)
    return 0


def command_verify(args: argparse.Namespace) -> int:
    data = _load_pointer_argument(args.pointer)
    try:
        pointer = decode_pointer(data)
    except ShelbyPointerError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if pointer["chunked"]:
        print(
            "error: pointer is one chunk of a split blob; verify the reassembled "
            "blob, not a single chunk",
            file=sys.stderr,
        )
        return 1

    blob = args.blob.read_bytes()
    problems = []
    if len(blob) != pointer["size_bytes"]:
        problems.append(
            f"size mismatch: blob is {len(blob)} bytes, pointer claims "
            f"{pointer['size_bytes']}"
        )
    digest = hashlib.sha256(blob).hexdigest()
    if digest != pointer["commitment_hex"]:
        problems.append(
            f"commitment mismatch: blob sha256 {digest}, pointer claims "
            f"{pointer['commitment_hex']}"
        )
    if pointer["expires_at_unix"] <= int(time.time()):
        problems.append(
            f"pointer expired at {pointer['expires_at_unix']} "
            f"({time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(pointer['expires_at_unix']))})"
        )

    if problems:
        for problem in problems:
            print(f"error: {problem}", file=sys.stderr)
        return 1
    print(f"ok: {args.blob} matches pointer ({len(blob)} bytes, sha256 {digest})")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Emit, parse, scan, and verify Shelby off-grid pointers."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    emit = commands.add_parser(
        "emit", help="build pointer(s) for a local blob; commitment = SHA-256 of the bytes"
    )
    emit.add_argument("blob", type=Path)
    emit.add_argument("--owner", type=_parse_owner, required=True,
                      help="32-byte owner account address as hex")
    emit.add_argument("--expires", type=int, default=None,
                      help="expiry as unix seconds (default: --days from now)")
    emit.add_argument("--days", type=int, default=30,
                      help="days until expiry when --expires is not given (default: 30)")
    emit.add_argument("--chunk-size", type=int, default=None,
                      help="announce the blob as chunks of this many bytes")
    emit.add_argument("--encrypted", action="store_true")
    emit.add_argument("--capture", action="store_true",
                      help="mark the blob as a Lilyshark .lscap capture")
    emit.add_argument("--out-dir", type=Path, default=Path("."))
    emit.set_defaults(func=command_emit)

    parse = commands.add_parser("parse", help="decode a pointer from a file or hex string")
    parse.add_argument("pointer")
    parse.add_argument("--scan", action="store_true",
                       help="scan the whole input instead of requiring offset 0")
    parse.set_defaults(func=command_parse)

    scan = commands.add_parser(
        "scan", help="report every frame in an .lscap capture that carries a pointer"
    )
    scan.add_argument("capture", type=Path)
    scan.set_defaults(func=command_scan)

    verify = commands.add_parser(
        "verify", help="check a blob file against a pointer's commitment, size, and expiry"
    )
    verify.add_argument("pointer", help="pointer file or hex string")
    verify.add_argument("blob", type=Path)
    verify.set_defaults(func=command_verify)

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
