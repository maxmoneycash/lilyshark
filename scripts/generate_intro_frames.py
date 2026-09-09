#!/usr/bin/env python3
"""Export current firmware pixels to the website and iOS Deck tour.

Run from any directory. Requires uvx and ImageMagick (magick).
Use --check to rebuild and detect stale assets without replacing them.
"""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PROGRAM = ROOT / ".pio/build/simulator/program"
DESTINATIONS = (
    ROOT / "webapp/public/intro/fw",
    ROOT / "ios/Resources/TDeck/screens",
)

# Indices follow run_simulator_render_test in src/sim_main.cpp. MESSAGES is
# not part of the existing 42-screen intro; keep its narrative order intact.
STATIC_GROUPS = {
    "analyzer": """traffic traffic-filter protocols protocol-detail spectrum
        nodes node-detail packet-detail map survey utilization timeline events""".split(),
    "shell": """splash setup-welcome setup-capabilities setup-network setup-profile
        setup-controls setup-ready home radio-profile settings storage device-status
        display-input help about spectrum-warning reset-setup""".split(),
    "interaction": """packet-pkt packet-rf packet-dec packet-hex packet-raw
        packet-hex-2 packet-hex-3 event-detail""".split(),
}
# Deterministic samples from run_simulator_readme_frames: receiving traffic,
# a deep sweep in progress, a populated timeline, and a pinned live packet.
LIVE_FRAMES = {
    "traffic-live": "live-008.ppm",
    "spectrum-live": "live-040.ppm",
    "timeline-live": "live-084.ppm",
    "packet-live": "packet-live-01.ppm",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if any preview is stale")
    args = parser.parse_args()
    for tool in ("uvx", "magick"):
        if shutil.which(tool) is None:
            parser.error(f"{tool} is required")

    subprocess.run([
        "uvx", "--with", "pip==25.2", "--with", "intelhex==2.3.0",
        "--from", "platformio==6.1.19", "platformio", "run", "-e", "simulator",
    ], cwd=ROOT, check=True)

    stale = []
    with tempfile.TemporaryDirectory(prefix="lilyshark-intro-") as work:
        work = Path(work)
        static, live, png = (work / name for name in ("static", "live", "png"))
        for directory in (static, live, png):
            directory.mkdir()
        env = {**os.environ, "LILYSHARK_SATELLITE_FETCH": "0"}
        subprocess.run([PROGRAM, "--render-test"], cwd=ROOT, check=True, timeout=30,
                       env={**env, "LILYSHARK_RENDER_DIR": str(static)})
        subprocess.run([PROGRAM, "--readme-frames", live], cwd=ROOT, check=True,
                       timeout=30, env=env)
        frames = {
            name: static / f"{group}-{index:02}.ppm"
            for group, names in STATIC_GROUPS.items()
            for index, name in enumerate(names, 1)
        }
        frames.update({name: live / source for name, source in LIVE_FRAMES.items()})
        for name, source in frames.items():
            subprocess.run([
                "magick", source, "-strip", "-define", "png:exclude-chunk=date,time",
                png / f"{name}.png",
            ], check=True)
        # Finish every render and geometry check before replacing any assets.
        geometry = subprocess.check_output([
            "magick", "identify", "-format", "%wx%h\n", *sorted(png.glob("*.png")),
        ], text=True).splitlines()
        if len(geometry) != 42 or any(size != "320x240" for size in geometry):
            raise SystemExit("Expected exactly 42 firmware frames at 320x240")
        for destination in DESTINATIONS:
            if not args.check:
                destination.mkdir(parents=True, exist_ok=True)
            for source in sorted(png.glob("*.png")):
                target = destination / source.name
                if target.exists() and target.read_bytes() == source.read_bytes():
                    continue
                if args.check:
                    stale.append(str(target.relative_to(ROOT)))
                else:
                    shutil.copyfile(source, target)

    if stale:
        raise SystemExit("Stale firmware previews:\n" + "\n".join(stale))
    print(f"42 firmware frames {'verified' if args.check else 'exported'} for web and iOS")


if __name__ == "__main__":
    main()
