#!/usr/bin/env python3
"""Read one T-Deck boot log and check Lilyshark startup milestones."""

from __future__ import annotations

import argparse
import codecs
import glob
import math
import os
from pathlib import Path
import select
import stat
import sys
import termios
import time
import tty
from typing import BinaryIO, Iterable


BAUD = 115200
DEFAULT_SECONDS = 20.0
AUTO_PORT_PATTERNS = ("/dev/cu.usbmodem*", "/dev/ttyACM*")

MILESTONES = (
    ("display", "Lilyshark display:", "Lilyshark display: ready"),
    ("touch", "Lilyshark touch:", "Lilyshark touch: ready"),
    ("PCAP capture", "Lilyshark SD capture:", "Lilyshark SD capture: recording "),
    (
        "native capture",
        "Lilyshark native capture:",
        "Lilyshark native capture: recording ",
    ),
    ("radio", "Lilyshark radio:", "(listening, error 0)"),
    ("UI", "Lilyshark UI ready", "Lilyshark UI ready"),
)

ESP32_FAILURE_MARKERS = (
    "Guru Meditation Error:",
    "abort() was called",
    "Brownout detector was triggered",
    "assert failed:",
    "CORRUPT HEAP:",
    "Stack smashing protect failure!",
    "Task watchdog got triggered",
    "Interrupt wdt timeout on CPU",
    "Rebooting...",
)


def assess_boot_log(text: str) -> list[str]:
    """Return concrete startup failures found in a serial log."""
    starts = 0
    seen: dict[str, str] = {}
    fatal_lines: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line == "Lilyshark starting":
            starts += 1
            seen.clear()
            fatal_lines.clear()
            continue
        if line.startswith("Lilyshark fatal:"):
            fatal_lines.append(line)
        elif any(marker in line for marker in ESP32_FAILURE_MARKERS):
            fatal_lines.append(line)
        for name, prefix, _ in MILESTONES:
            if line.startswith(prefix):
                seen[name] = line

    failures: list[str] = []
    if starts == 0:
        failures.append('startup: missing "Lilyshark starting"')
    elif starts > 1:
        failures.append(
            f"startup: observed {starts} boot banners; the device restarted during capture"
        )

    for line in fatal_lines:
        failures.append(f"firmware: reported {line!r}")

    for name, prefix, success_marker in MILESTONES:
        line = seen.get(name)
        if line is None:
            failures.append(f'{name}: missing "{prefix}"')
        elif success_marker not in line:
            failures.append(f"{name}: reported {line!r}")

    return failures


def select_auto_port(candidates: Iterable[str]) -> str:
    unique = sorted(set(candidates))
    if len(unique) != 1:
        listed = "\n".join(f"  {candidate}" for candidate in unique)
        detail = f"\n{listed}" if listed else ""
        raise ValueError(
            f"automatic detection found {len(unique)} eligible serial devices:{detail}\n"
            "Pass the T-Deck serial port explicitly."
        )
    return unique[0]


def find_auto_port() -> str:
    candidates: list[str] = []
    for pattern in AUTO_PORT_PATTERNS:
        candidates.extend(glob.glob(pattern))
    return select_auto_port(candidates)


def validate_port(port: str) -> None:
    if not os.path.isabs(port) or not port.startswith("/dev/"):
        raise ValueError(f"serial port must be an absolute /dev path: {port}")
    try:
        mode = os.stat(port).st_mode
    except OSError as error:
        raise ValueError(f"serial port is unavailable: {port}: {error.strerror}") from error
    if not stat.S_ISCHR(mode):
        raise ValueError(f"serial port is not a character device: {port}")


def configure_serial(fd: int) -> list[object]:
    original = termios.tcgetattr(fd)
    tty.setraw(fd, termios.TCSANOW)
    attributes = termios.tcgetattr(fd)
    attributes[2] &= ~(termios.CSIZE | termios.PARENB | termios.CSTOPB)
    attributes[2] |= termios.CS8 | termios.CLOCAL | termios.CREAD
    attributes[4] = termios.B115200
    attributes[5] = termios.B115200
    termios.tcsetattr(fd, termios.TCSANOW, attributes)
    return original


def read_serial(port: str, seconds: float, log_file: BinaryIO | None) -> tuple[str, str | None]:
    chunks: list[bytes] = []
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    fd = os.open(port, os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
    original: list[object] | None = None
    read_error: str | None = None

    try:
        original = configure_serial(fd)
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            remaining = max(0.0, deadline - time.monotonic())
            readable, _, _ = select.select([fd], [], [], min(0.25, remaining))
            if not readable:
                continue
            try:
                chunk = os.read(fd, 4096)
            except BlockingIOError:
                continue
            except OSError as error:
                read_error = f"serial read failed: {error.strerror or error}"
                break
            if not chunk:
                read_error = "serial device closed during capture"
                break
            chunks.append(chunk)
            if log_file is not None:
                log_file.write(chunk)
                log_file.flush()
            decoded = decoder.decode(chunk)
            if decoded:
                sys.stdout.write(decoded)
                sys.stdout.flush()
    finally:
        if original is not None:
            try:
                termios.tcsetattr(fd, termios.TCSANOW, original)
            except OSError:
                pass
        os.close(fd)

    trailing = decoder.decode(b"", final=True)
    if trailing:
        sys.stdout.write(trailing)
        sys.stdout.flush()
    return b"".join(chunks).decode("utf-8", errors="replace"), read_error


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read a bounded 115200-baud Lilyshark startup log. This command does not "
            "flash the device or send serial data."
        )
    )
    parser.add_argument("port", nargs="?", help="explicit T-Deck serial device")
    parser.add_argument(
        "--auto",
        action="store_true",
        help="use exactly one /dev/cu.usbmodem* or /dev/ttyACM* device",
    )
    parser.add_argument(
        "--seconds",
        type=float,
        default=DEFAULT_SECONDS,
        help=f"capture duration from 1 to 300 seconds (default: {DEFAULT_SECONDS:g})",
    )
    parser.add_argument("--log", type=Path, help="save raw serial bytes to a new file")
    args = parser.parse_args(argv)

    if args.auto == (args.port is not None):
        parser.error("pass one explicit serial port or --auto")
    if not math.isfinite(args.seconds) or not 1.0 <= args.seconds <= 300.0:
        parser.error("--seconds must be between 1 and 300")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        port = find_auto_port() if args.auto else args.port
        assert port is not None
        validate_port(port)
    except ValueError as error:
        print(f"Serial smoke test stopped: {error}", file=sys.stderr)
        return 1

    log_file: BinaryIO | None = None
    if args.log is not None:
        try:
            log_file = args.log.open("xb")
        except OSError as error:
            print(f"Serial smoke test stopped: cannot create {args.log}: {error}", file=sys.stderr)
            return 1

    print(
        f"Reading {port} at {BAUD} baud for {args.seconds:g} seconds. "
        "If no startup lines appear, press Reset once.",
        file=sys.stderr,
    )
    print("The harness reads serial output only. It does not flash or send data.", file=sys.stderr)

    try:
        text, read_error = read_serial(port, args.seconds, log_file)
    except (OSError, termios.error) as error:
        print(f"Serial smoke test stopped: cannot read {port}: {error}", file=sys.stderr)
        return 1
    finally:
        if log_file is not None:
            log_file.close()

    failures = assess_boot_log(text)
    if read_error is not None:
        failures.insert(0, f"connection: {read_error}")

    if failures:
        print("\nFirst-device serial smoke test failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        if args.log is not None:
            print(f"Raw serial log: {args.log}", file=sys.stderr)
        return 1

    print(
        "\nFirst-device serial smoke test passed: display, touch, storage, radio, "
        "and UI startup milestones are ready.",
        file=sys.stderr,
    )
    if args.log is not None:
        print(f"Raw serial log: {args.log}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
