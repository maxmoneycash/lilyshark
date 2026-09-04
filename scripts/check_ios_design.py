#!/usr/bin/env python3
"""Catch the design system being bypassed.

A design system is only a system while everything uses it. The moment a raw
`.font(.system(size: 14))` appears beside `Design.Text.row`, there are two
scales, and the second one wins wherever somebody was in a hurry. Six months
of that and nothing matches anything -- which is exactly the state this app
was inherited in.

Nothing here is subtle. It looks for values that should have come from
Design.* and for the two accessibility rules the app must not break:

  - motion that ignores Reduce Motion. Someone who asked the system for
    stillness asked us too, and `.animation(...)` applied directly skips
    the check that `.meshAnimation` performs.
  - a tap target below 44pt. Apple's minimum, and the reason it matters HERE
    is a cold hand outdoors, not a review guideline.

This is a LINT, not a proof. It reads text, so it can be fooled and it can be
wrong; every finding names the file and line so a human can disagree. The
allowlist at the bottom is for the cases where a raw value is genuinely right,
and each entry has to say why.

Usage:
  scripts/check_ios_design.py           # report and exit non-zero on findings
  scripts/check_ios_design.py --list    # report, always exit 0
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
VIEWS = REPO_ROOT / "ios/Shared"

# The design system itself defines these numbers; it is the one file allowed
# to contain them.
EXEMPT_FILES = {
    "DesignSystem.swift",
}

# Raw sizing where a token exists.
RAW_FONT = re.compile(r"\.font\(\s*\.system\(\s*size:\s*(\d+)")
# `.animation(` that is not the system-honouring `.meshAnimation(`.
RAW_ANIMATION = re.compile(r"(?<!mesh)\.animation\(")
# A frame small enough to be a tap target problem, when it is on a Button.
SMALL_FRAME = re.compile(r"\.frame\(\s*(?:width:\s*(\d+)|height:\s*(\d+))")

# Where a raw value is correct, with the reason. A bare path is not enough --
# if it cannot be explained it should use a token.
ALLOWED = {
    # The brand lockup is typeset to the web app's exact spec (JetBrains Mono
    # at a specific optical size), not to the app's type scale. Matching the
    # scale here would stop it matching the website, which is the point of it.
    "Theme.swift": "brand lockup is typeset to the web app's spec, not the app scale",
}


def swift_files() -> list[Path]:
    return sorted(p for p in VIEWS.rglob("*.swift") if p.name not in EXEMPT_FILES)


def scan() -> list[str]:
    findings: list[str] = []
    for path in swift_files():
        rel = path.relative_to(REPO_ROOT).as_posix()
        allowed_reason = ALLOWED.get(path.name)
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()

        for number, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith("//"):
                continue

            if RAW_FONT.search(line) and not allowed_reason:
                findings.append(
                    f"{rel}:{number}: raw font size — use Design.Text.*\n"
                    f"    {stripped[:100]}"
                )

            if RAW_ANIMATION.search(line):
                # withAnimation inside a gesture handler is a different thing
                # and is checked by eye, not here.
                if "withAnimation" not in line:
                    findings.append(
                        f"{rel}:{number}: .animation() bypasses Reduce Motion — "
                        f"use .meshAnimation(_:value:)\n    {stripped[:100]}"
                    )

            match = SMALL_FRAME.search(line)
            if match:
                value = int(match.group(1) or match.group(2))
                # Only a problem where it is plausibly a control. A 20pt icon
                # inside a 44pt touchable is correct and common.
                if value < 44 and "touchable" not in line:
                    context = "\n".join(lines[max(0, number - 4) : number + 2])
                    if "Button" in context and "touchable" not in context:
                        findings.append(
                            f"{rel}:{number}: {value}pt frame on a control — "
                            f"below the 44pt minimum; add .touchable()\n    {stripped[:100]}"
                        )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--list", action="store_true", help="report findings but always exit 0"
    )
    args = parser.parse_args()

    if not VIEWS.exists():
        print(f"check_ios_design: missing {VIEWS}", file=sys.stderr)
        return 1

    findings = scan()
    if not findings:
        print(f"Design system honoured across {len(swift_files())} Swift files")
        return 0

    stream = sys.stdout if args.list else sys.stderr
    print(f"{len(findings)} place(s) bypass the design system:\n", file=stream)
    for finding in findings:
        print(f"  {finding}", file=stream)
    print(
        "\nEach is either a value that belongs in DesignSystem.swift, or a\n"
        "deliberate exception that belongs in this script's ALLOWED map with\n"
        "the reason written down.",
        file=stream,
    )
    return 0 if args.list else 1


if __name__ == "__main__":
    sys.exit(main())
