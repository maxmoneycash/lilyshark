#!/usr/bin/env python3
"""A sheet's Done button must not have a large title sliding under it.

Two failures this catches, both of which shipped:

1. A sheet presents a titled view at the default LARGE display mode and puts a
   Done button in .cancellationAction. The large title scrolls UNDER the
   translucent navigation bar while the button sits on top of it, so the
   heading travels through the button as the content moves -- the contact
   detail sheet showed a peer's name emerging from behind "Done". The fix is
   .lilysharkSheet(), which pins the title inline and places the button.

2. .navigationBarTitleDisplayMode is @available(macOS, unavailable) and
   @available(tvOS, unavailable). Calling it without a guard breaks the
   PommeCore-macOS target -- which no CI job builds, and which cannot even be
   built from this checkout (its packages are iOS-only), so the compiler is
   never going to be the one to tell you. Two such lines were added by hand
   in 8c6a2fa and sat there unnoticed.

Only sheet PRESENTATION sites are checked. A view that owns its own
NavigationStack (ContactDetailSheet, FirmwareUpdateView) declares its toolbar
in its own body, where this script cannot tell a sheet from a pushed screen --
and guessing wrong there would flag the contact list, whose large title is
deliberate.
"""
from __future__ import print_function

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "ios" / "Shared"

PIN = "navigationBarTitleDisplayMode"
MODIFIER = "lilysharkSheet"
DISMISS = "ToolbarItem(placement: .cancellationAction)"

# The one place the raw pin is allowed to look unguarded to a reader: it is
# inside the shared modifier, which carries the guard itself.
MODIFIER_FILE = "App/Theme.swift"

DIRECTIVE = re.compile(r"^\s*#(if|elseif|else|endif)\b\s*(.*?)\s*$")


def excludes(condition, platform):
    """True if `condition` is false on `platform` -- i.e. the branch it guards
    does not compile there.

    Evaluated with only `platform` set, which is what a single-platform build
    actually sees. macCatalyst is treated as false because it implies os(iOS),
    so a Catalyst build already satisfies any os(iOS) branch.
    """
    expr = condition
    expr = re.sub(r"targetEnvironment\(\w+\)", "False", expr)
    expr = re.sub(
        r"os\((\w+)\)",
        lambda m: "True" if m.group(1) == platform else "False",
        expr,
    )
    expr = expr.replace("&&", " and ").replace("||", " or ").replace("!", " not ")
    if re.search(r"[A-Za-z_]", expr.replace("True", "").replace("False", "")
                 .replace("and", "").replace("or", "").replace("not", "")):
        # An expression this script does not understand (swift(>=...), a custom
        # flag). Refuse to guess: treat it as NOT excluding, so an unguarded
        # call is reported rather than silently waved through.
        return False
    try:
        return not eval(expr, {"__builtins__": {}}, {})  # noqa: S307
    except Exception:
        return False


def branch_conditions(lines):
    """For each line, the list of enclosing #if branch conditions in effect."""
    stack = []          # list of [current_condition, [conditions already tried]]
    out = []
    for raw in lines:
        m = DIRECTIVE.match(raw)
        kind = m.group(1) if m else None
        if kind == "if":
            stack.append([m.group(2), []])
        elif kind == "elseif" and stack:
            prior = stack[-1][1] + [stack[-1][0]]
            stack[-1] = [m.group(2), prior]
        elif kind == "else" and stack:
            prior = stack[-1][1] + [stack[-1][0]]
            # The #else branch is "none of the above".
            stack[-1] = [" and ".join(f"not ({c})" for c in prior), prior]
        elif kind == "endif" and stack:
            stack.pop()
        out.append([frame[0] for frame in stack])
        if kind == "endif":
            pass
    return out


def compiles_on(conditions, platform):
    return not any(excludes(c, platform) for c in conditions)


def sheet_blocks(text):
    """Yield (start_line, end_line, body) for every `.sheet(` closure."""
    for m in re.finditer(r"\.sheet\s*\(", text):
        # Walk to the closure's opening brace, then match braces to its close.
        i, depth = m.end() - 1, 0
        while i < len(text):
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        j = text.find("{", i)
        if j == -1:
            continue
        depth, k = 0, j
        while k < len(text):
            if text[k] == "{":
                depth += 1
            elif text[k] == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        yield (text.count("\n", 0, m.start()) + 1,
               text.count("\n", 0, k) + 1,
               text[j:k])


def main():
    if not SOURCES.is_dir():
        print(f"check_sheet_chrome: {SOURCES} not found", file=sys.stderr)
        return 1

    unguarded, sliding = [], []
    checked_sheets = 0

    for path in sorted(SOURCES.rglob("*.swift")):
        rel = path.relative_to(SOURCES).as_posix()
        text = path.read_text()
        lines = text.splitlines()
        enclosing = branch_conditions(lines)

        # Check 2: the pin must never reach macOS or tvOS.
        # tvOS is the API's other unavailable platform, but this project
        # declares no tvOS target (xcodebuild -list: iOS, macOS, watchOS and
        # two extensions), so enforcing it here would fail the gate over a
        # build nobody can run. macOS is a real declared target.
        if rel != MODIFIER_FILE:
            for n, line in enumerate(lines):
                if PIN not in line or line.lstrip().startswith("//"):
                    continue
                if compiles_on(enclosing[n], "macOS"):
                    unguarded.append((rel, n + 1, "macOS"))

        # Check 1: a sheet with a dismiss button needs the title pinned.
        for start, end, body in sheet_blocks(text):
            hand_rolled = DISMISS in body
            if not hand_rolled and MODIFIER not in body:
                continue
            # Skip sheets that only exist where the pin is unavailable; there
            # is no large title to slide on macOS.
            if not compiles_on(enclosing[start - 1], "iOS"):
                continue
            checked_sheets += 1
            if not hand_rolled or MODIFIER in body or f"{PIN}(.inline)" in body:
                continue
            sliding.append((rel, start, end))

    status = 0
    if sliding:
        print("Sheets whose title can slide under their own Done button:",
              file=sys.stderr)
        for rel, start, end in sliding:
            print(f"  ios/Shared/{rel}:{start}  (.sheet closure through line {end})",
                  file=sys.stderr)
        print("\nReplace the hand-rolled toolbar with .lilysharkSheet { ... } "
              "(Shared/App/Theme.swift).", file=sys.stderr)
        status = 1

    if unguarded:
        print(f"\n{PIN} reachable where it does not exist:", file=sys.stderr)
        for rel, n, platform in unguarded:
            print(f"  ios/Shared/{rel}:{n}  compiles on {platform}", file=sys.stderr)
        print("\nWrap it in #if !os(macOS) && !os(tvOS), or use .lilysharkSheet, "
              "which carries the guard.", file=sys.stderr)
        status = 1

    if status == 0:
        print(f"sheet chrome: {checked_sheets} sheets with a dismiss button, "
              f"all pinned inline; no unguarded {PIN}")
    return status


if __name__ == "__main__":
    sys.exit(main())
