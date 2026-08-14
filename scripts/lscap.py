#!/usr/bin/env python3
"""Validate and dump Lilyshark .lscap version 1 captures."""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path
from typing import BinaryIO, Iterator


FILE_MAGIC = b"LSCP"
RECORD_MAGIC = b"LSFR"
FORMAT_MAJOR = 1
RECORD_LAYOUT_VERSION = 1
FILE_HEADER_SIZE = 24
RECORD_HEADER_SIZE = 80
MAX_CAPTURED_LENGTH = 255

FILE_HEADER = struct.Struct("<4sHHHHIII")
RECORD_HEADER = struct.Struct("<4sHHHHQQIIIIIIihhHHHhbBBBBBBBB3s")

PRESENT_FIELDS = (
    (0, "timestamp"),
    (1, "center_frequency"),
    (2, "bandwidth"),
    (3, "airtime"),
    (4, "frequency_error"),
    (5, "rssi"),
    (6, "snr"),
    (7, "tx_power"),
    (8, "preamble"),
    (9, "sync_word"),
    (10, "profile_id"),
    (11, "spreading_factor"),
    (12, "coding_rate"),
    (13, "channel_index"),
    (14, "radio_status"),
    (15, "bit_rate"),
    (16, "frequency_deviation"),
)
METADATA_FLAGS = (
    (0, "implicit_header"),
    (1, "inverted_iq"),
)
MODULATION_NAMES = {0: "unknown", 1: "lora", 2: "fsk"}
DIRECTION_NAMES = {0: "unknown", 1: "receive", 2: "transmit"}
CRC_NAMES = {0: "unknown", 1: "not_present", 2: "valid", 3: "invalid"}


class CaptureFormatError(ValueError):
    """The input does not follow the supported .lscap layout."""


def _read_up_to(stream: BinaryIO, size: int) -> bytes:
    chunks = []
    remaining = size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _offset_text(offset: int) -> str:
    return f"{offset} (0x{offset:X})"


def _file_error(message: str) -> CaptureFormatError:
    return CaptureFormatError(f"file header at offset 0 (0x0): {message}")


def _record_error(index: int, offset: int, message: str) -> CaptureFormatError:
    return CaptureFormatError(
        f"record {index} at offset {_offset_text(offset)}: {message}"
    )


def _flag_names(value: int, fields: tuple[tuple[int, str], ...]) -> list[str]:
    return [name for bit, name in fields if value & (1 << bit)]


def _known_mask(fields: tuple[tuple[int, str], ...]) -> int:
    mask = 0
    for bit, _ in fields:
        mask |= 1 << bit
    return mask


PRESENT_FIELDS_MASK = _known_mask(PRESENT_FIELDS)
METADATA_FLAGS_MASK = _known_mask(METADATA_FLAGS)


def read_file_header(stream: BinaryIO) -> dict[str, object]:
    base = _read_up_to(stream, FILE_HEADER_SIZE)
    if len(base) != FILE_HEADER_SIZE:
        raise _file_error(
            f"incomplete header; expected {FILE_HEADER_SIZE} bytes, found {len(base)}"
        )

    (
        magic,
        major_version,
        minor_version,
        header_size,
        record_header_size,
        file_flags,
        timestamp_ticks_per_second,
        reserved,
    ) = FILE_HEADER.unpack(base)

    if magic != FILE_MAGIC:
        raise _file_error(f"invalid magic {magic!r}; expected {FILE_MAGIC!r}")
    if major_version != FORMAT_MAJOR:
        raise _file_error(f"unsupported major version {major_version}")
    if header_size < FILE_HEADER_SIZE:
        raise _file_error(
            f"invalid header size {header_size}; minimum is {FILE_HEADER_SIZE}"
        )
    if record_header_size < RECORD_HEADER_SIZE:
        raise _file_error(
            f"invalid record header size {record_header_size}; "
            f"minimum is {RECORD_HEADER_SIZE}"
        )

    extension_size = header_size - FILE_HEADER_SIZE
    extension = _read_up_to(stream, extension_size)
    if len(extension) != extension_size:
        raise _file_error(
            f"incomplete declared header; expected {header_size} bytes, "
            f"found {FILE_HEADER_SIZE + len(extension)}"
        )

    return {
        "type": "file_header",
        "magic": "LSCP",
        "major_version": major_version,
        "minor_version": minor_version,
        "header_size": header_size,
        "record_header_size": record_header_size,
        "file_flags": file_flags,
        "timestamp_ticks_per_second": timestamp_ticks_per_second,
        "reserved": reserved,
        "header_extension_hex": extension.hex(),
    }


def iter_records(
    stream: BinaryIO, file_header: dict[str, object]
) -> Iterator[dict[str, object]]:
    expected_record_header_size = int(file_header["record_header_size"])
    index = 0

    while True:
        record_offset = stream.tell()
        base = _read_up_to(stream, RECORD_HEADER_SIZE)
        if not base:
            return
        if len(base) != RECORD_HEADER_SIZE:
            raise _record_error(
                index,
                record_offset,
                f"incomplete header; expected {RECORD_HEADER_SIZE} bytes, "
                f"found {len(base)}",
            )

        (
            magic,
            header_size,
            layout_version,
            captured_length,
            original_length,
            sequence,
            timestamp_us,
            present_fields,
            center_frequency_hz,
            bandwidth_hz,
            bit_rate_bps,
            frequency_deviation_hz,
            airtime_us,
            frequency_error_hz,
            rssi_dbm_x10,
            snr_db_x10,
            preamble_symbols,
            sync_word,
            profile_id,
            radio_status,
            tx_power_dbm,
            spreading_factor,
            coding_rate_denominator,
            channel_index,
            radio_index,
            modulation,
            direction,
            crc_state,
            metadata_flags,
            reserved,
        ) = RECORD_HEADER.unpack(base)

        if magic != RECORD_MAGIC:
            raise _record_error(
                index, record_offset, f"invalid magic {magic!r}; expected {RECORD_MAGIC!r}"
            )
        if header_size < RECORD_HEADER_SIZE:
            raise _record_error(
                index,
                record_offset,
                f"invalid header size {header_size}; minimum is {RECORD_HEADER_SIZE}",
            )
        if header_size != expected_record_header_size:
            raise _record_error(
                index,
                record_offset,
                f"header size {header_size} does not match file header value "
                f"{expected_record_header_size}",
            )
        if layout_version != RECORD_LAYOUT_VERSION:
            raise _record_error(
                index,
                record_offset,
                f"unsupported record layout version {layout_version}",
            )
        if captured_length > MAX_CAPTURED_LENGTH:
            raise _record_error(
                index,
                record_offset,
                f"invalid captured length {captured_length}; maximum is "
                f"{MAX_CAPTURED_LENGTH}",
            )
        if original_length < captured_length:
            raise _record_error(
                index,
                record_offset,
                f"invalid lengths: original length {original_length} is smaller than "
                f"captured length {captured_length}",
            )

        extension_size = header_size - RECORD_HEADER_SIZE
        extension = _read_up_to(stream, extension_size)
        if len(extension) != extension_size:
            raise _record_error(
                index,
                record_offset,
                f"incomplete declared header; expected {header_size} bytes, "
                f"found {RECORD_HEADER_SIZE + len(extension)}",
            )

        payload = _read_up_to(stream, captured_length)
        if len(payload) != captured_length:
            raise _record_error(
                index,
                record_offset,
                f"incomplete payload; expected {captured_length} bytes, "
                f"found {len(payload)}",
            )

        yield {
            "type": "frame",
            "index": index,
            "offset": record_offset,
            "magic": "LSFR",
            "header_size": header_size,
            "layout_version": layout_version,
            "captured_length": captured_length,
            "original_length": original_length,
            "sequence": sequence,
            "timestamp_us": timestamp_us,
            "present_fields": present_fields,
            "present_field_names": _flag_names(present_fields, PRESENT_FIELDS),
            "unknown_present_field_bits": present_fields & ~PRESENT_FIELDS_MASK,
            "center_frequency_hz": center_frequency_hz,
            "bandwidth_hz": bandwidth_hz,
            "bit_rate_bps": bit_rate_bps,
            "frequency_deviation_hz": frequency_deviation_hz,
            "airtime_us": airtime_us,
            "frequency_error_hz": frequency_error_hz,
            "rssi_dbm_x10": rssi_dbm_x10,
            "snr_db_x10": snr_db_x10,
            "preamble_symbols": preamble_symbols,
            "sync_word": sync_word,
            "profile_id": profile_id,
            "radio_status": radio_status,
            "tx_power_dbm": tx_power_dbm,
            "spreading_factor": spreading_factor,
            "coding_rate_denominator": coding_rate_denominator,
            "channel_index": channel_index,
            "radio_index": radio_index,
            "modulation": modulation,
            "modulation_name": MODULATION_NAMES.get(modulation),
            "direction": direction,
            "direction_name": DIRECTION_NAMES.get(direction),
            "crc_state": crc_state,
            "crc_state_name": CRC_NAMES.get(crc_state),
            "metadata_flags": metadata_flags,
            "metadata_flag_names": _flag_names(metadata_flags, METADATA_FLAGS),
            "unknown_metadata_flag_bits": metadata_flags & ~METADATA_FLAGS_MASK,
            "reserved_hex": reserved.hex(),
            "header_extension_hex": extension.hex(),
            "payload_hex": payload.hex(),
        }
        index += 1


def _open_capture(path: Path) -> BinaryIO:
    return path.open("rb")


def validate(path: Path) -> None:
    with _open_capture(path) as stream:
        file_header = read_file_header(stream)
        record_count = 0
        payload_bytes = 0
        for record in iter_records(stream, file_header):
            record_count += 1
            payload_bytes += int(record["captured_length"])

    noun = "record" if record_count == 1 else "records"
    print(
        f"valid .lscap {file_header['major_version']}.{file_header['minor_version']}: "
        f"{record_count} {noun}, {payload_bytes} payload bytes"
    )


def dump_ndjson(path: Path) -> None:
    with _open_capture(path) as stream:
        file_header = read_file_header(stream)
        print(json.dumps(file_header, separators=(",", ":")))
        for record in iter_records(stream, file_header):
            print(json.dumps(record, separators=(",", ":")))


def dump_pretty_json(path: Path) -> None:
    with _open_capture(path) as stream:
        file_header = read_file_header(stream)
        records = list(iter_records(stream, file_header))
    print(json.dumps({"file_header": file_header, "records": records}, indent=2))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate or dump a Lilyshark .lscap version 1 capture."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    validate_parser = commands.add_parser(
        "validate", help="validate the complete capture"
    )
    validate_parser.add_argument("capture", type=Path)

    dump_parser = commands.add_parser(
        "dump", help="dump the file header and complete frame records as JSON"
    )
    dump_parser.add_argument("capture", type=Path)
    dump_parser.add_argument(
        "--pretty",
        action="store_true",
        help="write one indented JSON document instead of newline-delimited JSON",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "validate":
            validate(args.capture)
        elif args.pretty:
            dump_pretty_json(args.capture)
        else:
            dump_ndjson(args.capture)
    except CaptureFormatError as error:
        print(f"error: {args.capture}: {error}", file=sys.stderr)
        return 1
    except BrokenPipeError:
        return 0
    except OSError as error:
        print(f"error: cannot read {args.capture}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
