#!/usr/bin/env python3
"""Refuse to build the iOS app with an SDK older than the project asks for.

Every target in the Xcode project states the oldest OS it will run on, its
deployment target. Building one against an SDK OLDER than that is incoherent
-- the compiler is being asked to target a system it has no headers for --
and Xcode reports it as a WARNING, not an error. The build goes green, the
products are produced, and nothing in the log says the widget extension was
compiled against an SDK five majors behind its own stated floor.

That is exactly what CI was set up to do. `.github/workflows/build.yml` chose
no Xcode at all, so it took the runner image's default, and `ios/BUILD.md`
justified the choice by checking the three Swift PACKAGE floors (iOS 18,
macOS 15, watchOS 11) and concluding the image "should satisfy the floors".
It never read the Xcode project, where the widget extension sets
IPHONEOS_DEPLOYMENT_TARGET = 26.4 -- and `xcodebuild -scheme PommeCore` does
build that target. The check was not wrong about what it checked; it checked
the wrong file.

So this reads the deployment targets out of project.pbxproj and compares them
against the SDKs the selected Xcode actually has. It is the whole point of
this script that it fails LOUDLY, because the failure it exists to catch is
one that otherwise passes silently.

Run with no arguments to check the current toolchain. Exit 0 means the SDKs
can build what the project declares.
"""
from __future__ import print_function

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PBXPROJ = os.path.join(ROOT, "ios", "PommeCore.xcodeproj", "project.pbxproj")

# Deployment-target setting -> the `xcodebuild -showsdks` platform that has to
# be able to satisfy it.
PLATFORMS = [
    ("IPHONEOS_DEPLOYMENT_TARGET", "iphonesimulator", "iOS"),
    ("MACOSX_DEPLOYMENT_TARGET", "macosx", "macOS"),
    ("WATCHOS_DEPLOYMENT_TARGET", "watchsimulator", "watchOS"),
]


def version_tuple(text):
    """"26.4" -> (26, 4). Compared as numbers, so 26.4 > 18.5 rather than
    sorting as strings, where "18.5" > "26.4"."""
    parts = []
    for piece in text.split("."):
        try:
            parts.append(int(piece))
        except ValueError:
            parts.append(0)
    while len(parts) < 2:
        parts.append(0)
    return tuple(parts)


def required_targets():
    """The HIGHEST deployment target declared for each platform.

    The highest, not the lowest: a build has to satisfy every target it
    builds, and it is the most demanding one that decides whether an SDK is
    adequate. Taking the lowest is how a project with one modern target
    reports itself as buildable by anything.
    """
    with open(PBXPROJ, "r") as handle:
        text = handle.read()
    out = {}
    for setting, _sdk, _label in PLATFORMS:
        found = re.findall(re.escape(setting) + r" = ([0-9.]+);", text)
        if found:
            out[setting] = max(found, key=version_tuple)
    return out


def available_sdks():
    """Highest SDK version the selected Xcode has, per platform."""
    try:
        listing = subprocess.check_output(
            ["xcodebuild", "-showsdks"], stderr=subprocess.STDOUT
        ).decode("utf-8", "replace")
    except (OSError, subprocess.CalledProcessError) as exc:
        print("could not ask xcodebuild for its SDKs: %s" % exc, file=sys.stderr)
        return None
    out = {}
    for _setting, sdk, _label in PLATFORMS:
        found = re.findall(r"-sdk %s([0-9.]+)" % re.escape(sdk), listing)
        if found:
            out[sdk] = max(found, key=version_tuple)
    return out


def main():
    if not os.path.exists(PBXPROJ):
        print("missing: %s" % PBXPROJ, file=sys.stderr)
        return 1

    required = required_targets()
    if not required:
        print("no deployment targets found in the Xcode project", file=sys.stderr)
        return 1

    sdks = available_sdks()
    if sdks is None:
        return 1

    try:
        xcode = subprocess.check_output(
            ["xcodebuild", "-version"], stderr=subprocess.STDOUT
        ).decode("utf-8", "replace").splitlines()[0]
    except (OSError, subprocess.CalledProcessError, IndexError):
        xcode = "unknown Xcode"

    problems = []
    for setting, sdk, label in PLATFORMS:
        need = required.get(setting)
        if need is None:
            continue
        have = sdks.get(sdk)
        if have is None:
            problems.append(
                "%s: the project targets %s but this Xcode has no %s SDK"
                % (label, need, sdk)
            )
        elif version_tuple(have) < version_tuple(need):
            problems.append(
                "%s: the project targets %s, but the newest %s SDK here is %s"
                % (label, need, sdk, have)
            )

    if problems:
        print("This Xcode cannot honestly build the iOS app.", file=sys.stderr)
        print("  %s" % xcode, file=sys.stderr)
        for line in problems:
            print("  %s" % line, file=sys.stderr)
        print(
            "\n"
            "Xcode treats a deployment target above its SDK as a WARNING, so a\n"
            "build on this toolchain would go GREEN while compiling a target\n"
            "against a system it has no headers for. That is the failure this\n"
            "check exists to make loud.\n"
            "\n"
            "Either select an Xcode new enough for the targets above, or lower\n"
            "the deployment target in ios/PommeCore.xcodeproj deliberately.",
            file=sys.stderr,
        )
        return 1

    print("%s can build every declared target:" % xcode)
    for setting, sdk, label in PLATFORMS:
        need = required.get(setting)
        if need is not None:
            print("  %-8s project targets %-6s SDK %s" % (label, need, sdks.get(sdk)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
