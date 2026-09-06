#!/usr/bin/env python3
"""Add a Swift file to the Xcode project's compile phases.

ios/Shared is NOT a file-system synchronized group -- only the two widget
folders are -- so a new .swift file dropped in there is simply never compiled.
Nothing warns. The symbol is just missing at build time, or worse the file is
a modifier nobody calls and the build stays green while the code is dead.

That has already pushed one modifier into Theme.swift to avoid the problem,
and cramming every new file into an existing one to dodge a registration step
is not a plan. This does the registration.

It edits project.pbxproj directly, which is a plist in Xcode's old ASCII
format. That is worth doing carefully rather than cleverly: a corrupted
pbxproj loses the project, so this makes the smallest possible edit, verifies
the result parses, and refuses rather than guessing when anything looks
unfamiliar.

Usage:
  scripts/add_ios_source.py ios/Shared/App/DesignSystem.swift
  scripts/add_ios_source.py --check          # every Swift file is compiled
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PBXPROJ = REPO_ROOT / "ios/PommeCore.xcodeproj/project.pbxproj"

# Directories whose Swift files are expected to be compiled into the app.
# Anything under a file-system synchronized group is excluded, because those
# are picked up automatically and have no explicit reference to check for.
TRACKED_DIRS = ["ios/Shared"]
SYNCHRONIZED = ["ios/PommeCore Widgets", "ios/PommeCore Watch Complications"]


def fail(message: str) -> int:
    print(f"add_ios_source: {message}", file=sys.stderr)
    return 1


def make_id(existing: set[str]) -> str:
    """A fresh 24-hex-character object id, in Xcode's format."""
    while True:
        candidate = uuid.uuid4().hex[:24].upper()
        if candidate not in existing:
            return candidate


def tracked_swift_files() -> list[Path]:
    out: list[Path] = []
    for directory in TRACKED_DIRS:
        for path in sorted((REPO_ROOT / directory).rglob("*.swift")):
            rel = path.relative_to(REPO_ROOT).as_posix()
            if any(rel.startswith(s) for s in SYNCHRONIZED):
                continue
            out.append(path)
    return out


def check() -> int:
    text = PBXPROJ.read_text()
    compiled = compiled_swift_paths(text, PBXPROJ.parent.parent)
    missing = [
        p.relative_to(REPO_ROOT).as_posix()
        for p in tracked_swift_files()
        if p.resolve() not in compiled
    ]
    if missing:
        print("These Swift files are NOT referenced by the Xcode project,", file=sys.stderr)
        print("which means they are not compiled and their code is dead:", file=sys.stderr)
        for name in missing:
            print(f"  {name}", file=sys.stderr)
        print("\nRun scripts/add_ios_source.py <file> for each.", file=sys.stderr)
        return 1
    print(f"All {len(tracked_swift_files())} tracked Swift files are in the project")
    return 0


def compiled_swift_paths(text: str, source_root: Path) -> set[Path]:
    """Resolve group paths and Sources membership, not filename mentions."""
    objects = dict(re.findall(r"\b([0-9A-Z]{16,32}) /\* [^\n]+? \*/ = \{(.*?)\};", text, re.S))

    def field(body: str, name: str) -> str | None:
        match = re.search(r"\b" + re.escape(name) + r"\s*=\s*(\"[^\"]*\"|[^;]+);", body)
        if not match:
            return None
        value = match.group(1).strip()
        return json.loads(value) if value.startswith('"') else value

    parents: dict[str, str] = {}
    for key, body in objects.items():
        if field(body, "isa") != "PBXGroup":
            continue
        children = re.search(r"children\s*=\s*\((.*?)\);", body, re.S)
        if children:
            for child in re.findall(r"\b[0-9A-Z]{16,32}\b", children.group(1)):
                parents[child] = key

    def resolve(key: str, seen: frozenset[str] = frozenset()) -> Path:
        if key in seen:
            raise ValueError("cyclic Xcode group hierarchy")
        body = objects[key]
        tree = field(body, "sourceTree")
        if tree == "SOURCE_ROOT" or key not in parents:
            base = source_root
        else:
            base = resolve(parents[key], seen | {key})
        return (base / (field(body, "path") or "")).resolve()

    compiled: set[Path] = set()
    for body in objects.values():
        if field(body, "isa") != "PBXSourcesBuildPhase":
            continue
        files = re.search(r"files\s*=\s*\((.*?)\);", body, re.S)
        if not files:
            continue
        for build_id in re.findall(r"\b[0-9A-Z]{16,32}\b", files.group(1)):
            reference = re.search(r"fileRef\s*=\s*([0-9A-Z]{16,32})", objects.get(build_id, ""))
            if reference and reference.group(1) in objects:
                compiled.add(resolve(reference.group(1)))
    return compiled


def add(target: Path) -> int:
    if not target.exists():
        return fail(f"{target} does not exist")
    if target.suffix != ".swift":
        return fail("only .swift files are handled")
    try:
        source_path = target.relative_to(PBXPROJ.parent.parent).as_posix()
    except ValueError:
        return fail("the source must be inside ios/")

    text = PBXPROJ.read_text()
    name = target.name
    if target.resolve() in compiled_swift_paths(text, PBXPROJ.parent.parent):
        print(f"{name} is already in the project")
        return 0
    if name in text:
        return fail(f"{name} is mentioned but its path or Sources membership is wrong; repair that reference first")

    existing_ids = set(re.findall(r"\b([0-9A-F]{24})\b", text))

    # Model the edit on a file that is already there, so the new entries carry
    # exactly the shape this project uses rather than a shape that merely
    # parses. Theme.swift is a plain Shared/App source in every target.
    model = "Theme.swift"
    file_ref_match = re.search(
        r"([0-9A-F]{24}) /\* " + re.escape(model) + r" \*/ = \{isa = PBXFileReference;[^}]*\};",
        text,
    )
    if not file_ref_match:
        return fail(f"could not find the {model} file reference to model the edit on")
    model_ref_id = file_ref_match.group(1)

    new_ref_id = make_id(existing_ids)
    existing_ids.add(new_ref_id)

    # 1. The file reference.
    new_ref = (
        f"\t\t{new_ref_id} /* {name} */ = {{isa = PBXFileReference; "
        f"lastKnownFileType = sourcecode.swift; path = {json.dumps(source_path)}; sourceTree = SOURCE_ROOT; }};"
    )
    text = text.replace(file_ref_match.group(0), file_ref_match.group(0) + "\n" + new_ref, 1)

    # 2. A build file per target that compiles the model, so membership
    #    matches: a file in the app but not the watch app is a link error only
    #    on the target nobody built.
    for build_match in list(
        re.finditer(
            r"\t\t([0-9A-F]{24}) /\* " + re.escape(model) + r" in Sources \*/ = "
            r"\{isa = PBXBuildFile; fileRef = " + model_ref_id + r" /\* "
            + re.escape(model) + r" \*/; \};",
            text,
        )
    ):
        build_id = make_id(existing_ids)
        existing_ids.add(build_id)
        new_build = (
            f"\t\t{build_id} /* {name} in Sources */ = {{isa = PBXBuildFile; "
            f"fileRef = {new_ref_id} /* {name} */; }};"
        )
        text = text.replace(build_match.group(0), build_match.group(0) + "\n" + new_build, 1)
        # 3. Put it in the same Sources phase as the model's build file.
        phase_entry = f"\t\t\t\t{build_match.group(1)} /* {model} in Sources */,"
        if phase_entry in text:
            text = text.replace(
                phase_entry,
                phase_entry + f"\n\t\t\t\t{build_id} /* {name} in Sources */,",
                1,
            )

    # 4. Into the same group as the model.
    group_entry = f"\t\t\t\t{model_ref_id} /* {model} */,"
    if group_entry not in text:
        return fail(f"could not find {model} in any group")
    text = text.replace(
        group_entry, group_entry + f"\n\t\t\t\t{new_ref_id} /* {name} */,", 1
    )

    # Verify the file still parses as a plist. A pbxproj that does not is a
    # lost project, and finding that out at the next build is too late.
    with tempfile.NamedTemporaryFile(mode="w", suffix=".pbxproj") as candidate:
        candidate.write(text)
        candidate.flush()
        result = subprocess.run(
            ["plutil", "-lint", candidate.name], capture_output=True, text=True
        )
    if result.returncode != 0:
        return fail(
            f"the candidate project did not parse; the original was kept\n{result.stdout}{result.stderr}"
        )

    PBXPROJ.write_text(text)

    print(f"Added {name} to the project (ref {new_ref_id})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", nargs="?", help="the .swift file to add")
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify every tracked Swift file is compiled",
    )
    args = parser.parse_args()

    if not PBXPROJ.exists():
        return fail(f"missing {PBXPROJ}")
    if args.check:
        return check()
    if not args.file:
        parser.print_help()
        return 2
    return add(Path(args.file).resolve())


if __name__ == "__main__":
    sys.exit(main())
