import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import field_receipts_score as frs  # noqa: E402

from test_field_receipts_score import ChainSim, addr, hexkey  # noqa: E402

T0 = 1_760_000_000  # 2026-10-09 UTC, ISO week 2026-W41


def cells_doc(records):
    return {"records": records}


def record(publisher, commitment, geohash5, band="US915", iso_week="2026-W41"):
    return {"publisher": publisher, "commitment": commitment,
            "geohash5": geohash5, "band": band, "iso_week": iso_week}


class GeohashTests(unittest.TestCase):
    def test_known_vector_wikipedia(self):
        # (57.64911, 10.40744) encodes to u4pruydqqvj; 5-char prefix u4pru.
        self.assertEqual(frs.geohash_encode(57.64911, 10.40744, 5), "u4pru")

    def test_decode_encode_roundtrip(self):
        for gh in ("u4pru", "9q8yy", "s0000", "gbsuv"):
            lat_min, lat_max, lon_min, lon_max = frs.geohash_decode(gh)
            center = frs.geohash_encode((lat_min + lat_max) / 2,
                                        (lon_min + lon_max) / 2, 5)
            self.assertEqual(center, gh)

    def test_neighbors_are_eight_distinct_and_symmetric(self):
        gh = "u4pru"
        neighbors = frs.geohash_neighbors(gh)
        self.assertEqual(len(neighbors), 8)
        self.assertNotIn(gh, neighbors)
        # Every neighbor's neighborhood contains the original cell.
        for n in neighbors:
            self.assertIn(gh, frs.geohash_neighbors(n))

    def test_invalid_character_rejected(self):
        with self.assertRaises(frs.ScoreInputError):
            frs.geohash_decode("u4pra")  # 'a' is not in the geohash alphabet


class MostWantedTests(unittest.TestCase):
    def build(self, records, **kwargs):
        sim = ChainSim()
        publishers = {r["publisher"] for r in records}
        for publisher in sorted(publishers):
            for r in records:
                if r["publisher"] == publisher:
                    sim.anchor(publisher, r["commitment"], T0)
        rules = json.loads(
            (REPO_ROOT / "docs/protocol/season-0-rules.json").read_text())
        return frs.build_most_wanted(
            sim.document()["events"], records, rules, "testsha",
            kwargs.get("stale_after_weeks", 4), kwargs.get("as_of"),
            kwargs.get("limit", 50))

    def test_shared_gap_between_two_active_cells_ranks_first(self):
        # u4pru and its east neighbor active; the cells adjacent to both
        # outrank cells adjacent to only one.
        east = [n for n in frs.geohash_neighbors("u4pru")
                if "u4pru" in frs.geohash_neighbors(n)][0]
        recs = [record(addr("alice"), hexkey(1), "u4pru"),
                record(addr("bob"), hexkey(2), east)]
        out = self.build(recs)
        rows = out["most_wanted"]
        self.assertGreater(len(rows), 0)
        self.assertEqual(rows[0]["adjacent_active_cells"], 2)
        self.assertIsNone(rows[0]["last_surveyed_week"])
        self.assertEqual(out["method"]["active_cell_count"], 2)
        # Adjacency never exceeds the active count, and ranking is
        # non-increasing.
        adjacency = [r["adjacent_active_cells"] for r in rows]
        self.assertEqual(adjacency, sorted(adjacency, reverse=True))

    def test_stale_cell_is_wanted_with_its_last_week(self):
        stale_gh = frs.geohash_neighbors("u4pru")[0]
        recs = [record(addr("alice"), hexkey(1), "u4pru", iso_week="2026-W41"),
                record(addr("bob"), hexkey(2), stale_gh, iso_week="2026-W30")]
        out = self.build(recs, as_of="2026-W41")
        by_cell = {r["geohash5"]: r for r in out["most_wanted"]}
        self.assertIn(stale_gh, by_cell)
        self.assertEqual(by_cell[stale_gh]["last_surveyed_week"], "2026-W30")
        self.assertEqual(out["method"]["active_cell_count"], 1)

    def test_unanchored_record_does_not_activate_a_cell(self):
        recs = [record(addr("alice"), hexkey(1), "u4pru")]
        rules = json.loads(
            (REPO_ROOT / "docs/protocol/season-0-rules.json").read_text())
        # No anchor events at all: nothing verified, so no --as-of default.
        with self.assertRaises(frs.ScoreInputError):
            frs.build_most_wanted([], recs, rules, "testsha", 4, None, 50)

    def test_bands_are_independent(self):
        recs = [record(addr("alice"), hexkey(1), "u4pru", band="US915"),
                record(addr("bob"), hexkey(2), "u4pru", band="EU868")]
        out = self.build(recs)
        for row in out["most_wanted"]:
            self.assertIn(row["band"], ("US915", "EU868"))
        # Each active cell contributes its own band's neighbors.
        bands = {r["band"] for r in out["most_wanted"]}
        self.assertEqual(bands, {"US915", "EU868"})

    def test_cli_deterministic_and_markdown(self):
        east = frs.geohash_neighbors("u4pru")[0]
        recs = [record(addr("alice"), hexkey(1), "u4pru"),
                record(addr("bob"), hexkey(2), east, iso_week="2026-W20")]
        sim = ChainSim()
        sim.anchor(addr("alice"), hexkey(1), T0)
        sim.anchor(addr("bob"), hexkey(2), T0)
        with tempfile.TemporaryDirectory() as tmp:
            events = Path(tmp) / "events.json"
            cells = Path(tmp) / "cells.json"
            events.write_text(json.dumps(sim.document()))
            cells.write_text(json.dumps(cells_doc(recs)))
            argv = [sys.executable, str(SCRIPTS_DIR / "field_receipts_score.py"),
                    "most-wanted", "--events", str(events),
                    "--cells", str(cells), "--as-of", "2026-W41"]
            first = subprocess.run(argv, capture_output=True, text=True)
            second = subprocess.run(argv, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(first.stdout, second.stdout)
            doc = json.loads(first.stdout)
            self.assertEqual(doc["method"]["as_of_week"], "2026-W41")
            md = subprocess.run(argv + ["--markdown"],
                                capture_output=True, text=True)
            self.assertEqual(md.returncode, 0, md.stderr)
            self.assertIn("Most-wanted cells — week 2026-W41", md.stdout)
            self.assertIn("| Cell | Band |", md.stdout)


if __name__ == "__main__":
    unittest.main()
