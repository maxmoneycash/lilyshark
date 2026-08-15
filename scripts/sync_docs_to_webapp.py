#!/usr/bin/env python3
"""Publish the repository's documentation into the web app.

Copies the docs set into webapp/public/docs/ (preserving relative structure
so inter-doc links and chart images keep working) and writes a manifest.json
the DOCS screen renders its index from. Display titles come from each file's
first Markdown heading; the order below is the curated reading order.

Deterministic: same sources, same bytes out. test/docs_sync checks the
published copies are byte-identical to the sources, so the website can never
quietly drift from the repo docs.

Usage: python3 scripts/sync_docs_to_webapp.py
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEST = REPO_ROOT / "webapp" / "public" / "docs"

# (source relative to repo root, doc id, destination relative to DEST)
DOCS = [
    ("docs/quickstart.md", "quickstart", "quickstart.md"),
    ("docs/architecture.md", "architecture", "architecture.md"),
    ("docs/why-shelby.md", "why-shelby", "why-shelby.md"),
    ("docs/shelby-off-grid.md", "shelby-off-grid", "shelby-off-grid.md"),
    ("docs/shelby-pointer-format.md", "shelby-pointer-format", "shelby-pointer-format.md"),
    ("docs/lilyshark-capture-format.md", "lilyshark-capture-format", "lilyshark-capture-format.md"),
    ("docs/FLASHING.md", "flashing", "FLASHING.md"),
    ("docs/RECORDING_UI.md", "recording-ui", "RECORDING_UI.md"),
    ("analysis/results_evidence.md", "results-evidence", "analysis/results_evidence.md"),
    ("analysis/results.md", "results-scaling", "analysis/results.md"),
    ("analysis/results_counterfactuals.md", "results-counterfactuals", "analysis/results_counterfactuals.md"),
    ("analysis/README.md", "analysis-readme", "analysis/README.md"),
    ("samples/README.md", "samples", "samples/README.md"),
]

# Charts referenced by the analysis reports (same-directory relative links).
ASSETS = [
    ("analysis/chart_pointer_capacity.svg", "analysis/chart_pointer_capacity.svg"),
    ("analysis/chart_shelby_storage.svg", "analysis/chart_shelby_storage.svg"),
    ("analysis/chart_airtime_cost.svg", "analysis/chart_airtime_cost.svg"),
    ("analysis/chart_blob_sizes.svg", "analysis/chart_blob_sizes.svg"),
]


def title_of(markdown: str, fallback: str) -> str:
    for line in markdown.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def main() -> int:
    manifest = []
    for src_rel, doc_id, dest_rel in DOCS:
        src = REPO_ROOT / src_rel
        text = src.read_text()
        dest = DEST / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text)
        manifest.append(
            {
                "id": doc_id,
                "title": title_of(text, doc_id),
                "path": f"/docs/{dest_rel}",
                "source": src_rel,
            }
        )

    for src_rel, dest_rel in ASSETS:
        src = REPO_ROOT / src_rel
        if not src.exists():
            continue
        dest = DEST / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)

    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"published {len(manifest)} docs + {len(ASSETS)} assets to {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
