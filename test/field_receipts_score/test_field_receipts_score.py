import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import field_receipts_score  # noqa: E402

RULES_PATH = REPO_ROOT / "docs" / "protocol" / "season-0-rules.json"
RULES = json.loads(RULES_PATH.read_text(encoding="utf-8"))

# Frozen Season 0 parameters (docs/protocol/season-0.md); the tests below
# assert against these literals so a silent edit to the rules file fails.
POINTS_WITNESS = 25
POINTS_LATE = 5
POINTS_ANCHOR = 10
WINDOW_SECS = 7 * 24 * 60 * 60
CELL_BONUS = 8

T0 = 1_760_000_000  # inside the Season 0 window (2026-10-09 UTC)


def hexkey(n):
    """A distinct 32-byte witness key / commitment as 64 hex chars."""
    return format(n, "064x")


def addr(name):
    return "0x" + name.encode("utf-8").hex()


class ChainSim:
    """Build an events fixture by replaying field_points.move's own logic.

    Emits the same event stream the module would: PointsAwarded credits
    first, then the WitnessAttested record, all in one transaction with
    ascending event_index — so a clean simulation cross-checks with zero
    discrepancies.
    """

    def __init__(self):
        self.events = []
        self.tx = 1000
        self.keys = {}

    def _emit(self, tx, index, event_type, ts, data):
        self.events.append({
            "type": event_type,
            "tx_version": tx,
            "event_index": index,
            "timestamp_unix": ts,
            "data": data,
        })

    def attest(self, key, attester, ts):
        self.tx += 1
        state = self.keys.get(key)
        if state is None:
            self.keys[key] = {"first_at": ts, "attesters": [attester]}
            self._emit(self.tx, 0, "WitnessAttested", ts, {
                "key": key, "attester": attester, "position": 1, "credited": 0,
            })
            return
        state["attesters"].append(attester)
        position = len(state["attesters"])
        in_window = ts <= state["first_at"] + WINDOW_SECS
        index = 0
        if not in_window or position > 8:
            credited = 0
        elif position == 2:
            credited = POINTS_WITNESS
            for account in (state["attesters"][0], attester):
                self._emit(self.tx, index, "PointsAwarded", ts, {
                    "account": account, "kind": 1, "amount": POINTS_WITNESS,
                })
                index += 1
        else:
            credited = POINTS_LATE
            self._emit(self.tx, index, "PointsAwarded", ts, {
                "account": attester, "kind": 2, "amount": POINTS_LATE,
            })
            index += 1
        self._emit(self.tx, index, "WitnessAttested", ts, {
            "key": key, "attester": attester,
            "position": position, "credited": credited,
        })

    def anchor(self, publisher, commitment, ts):
        self.tx += 1
        self._emit(self.tx, 0, "CaptureRegistered", ts, {
            "publisher": publisher, "commitment": commitment,
        })

    def claim_anchors(self, account, count, ts):
        self.tx += 1
        self._emit(self.tx, 0, "PointsAwarded", ts, {
            "account": account, "kind": 0, "amount": count * POINTS_ANCHOR,
        })

    def document(self):
        return {"events": self.events}


def run_cli(argv):
    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        code = field_receipts_score.main(argv)
    return code, stdout.getvalue(), stderr.getvalue()


class ScorerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def write_inputs(self, events_doc, cells_doc=None):
        events_path = self.dir / "events.json"
        events_path.write_text(json.dumps(events_doc), encoding="utf-8")
        argv = ["score", "--events", str(events_path)]
        if cells_doc is not None:
            cells_path = self.dir / "cells.json"
            cells_path.write_text(json.dumps(cells_doc), encoding="utf-8")
            argv += ["--cells", str(cells_path)]
        return argv

    def score(self, events_doc, cells_doc=None):
        code, stdout, stderr = run_cli(self.write_inputs(events_doc, cells_doc))
        self.assertEqual(code, 0, stderr)
        return json.loads(stdout)


class OnchainReplayTest(ScorerTest):
    def test_clean_pair_corroboration_pays_both(self):
        sim = ChainSim()
        sim.attest(hexkey(1), addr("alice"), T0)
        sim.attest(hexkey(1), addr("bob"), T0 + 3600)
        output = self.score(sim.document())

        self.assertEqual(output["discrepancies"], [])
        for account in (addr("alice"), addr("bob")):
            entry = output["standings"][account]
            self.assertEqual(entry["onchain_points"]["witness"], POINTS_WITNESS)
            self.assertEqual(entry["onchain_points"]["anchor"], 0)
            self.assertEqual(entry["onchain_points"]["total"], POINTS_WITNESS)
            self.assertFalse(entry["clique_discount_applied"])
            self.assertEqual(entry["witness_points_standings"], POINTS_WITNESS)
            self.assertEqual(entry["season_total"], POINTS_WITNESS)

    def test_late_attester_earns_late_points(self):
        sim = ChainSim()
        sim.attest(hexkey(1), addr("alice"), T0)
        sim.attest(hexkey(1), addr("bob"), T0 + 60)
        sim.attest(hexkey(1), addr("carol"), T0 + 120)  # position 3
        output = self.score(sim.document())

        self.assertEqual(output["discrepancies"], [])
        carol = output["standings"][addr("carol")]
        self.assertEqual(carol["onchain_points"]["witness"], POINTS_LATE)
        self.assertEqual(carol["season_total"], POINTS_LATE)
        # The pair still earns the corroboration credit.
        self.assertEqual(
            output["standings"][addr("alice")]["onchain_points"]["witness"],
            POINTS_WITNESS)

    def test_window_expired_second_attester_earns_nothing(self):
        sim = ChainSim()
        sim.attest(hexkey(1), addr("alice"), T0)
        sim.attest(hexkey(1), addr("bob"), T0 + WINDOW_SECS + 1)
        output = self.score(sim.document())

        self.assertEqual(output["discrepancies"], [])
        for account in (addr("alice"), addr("bob")):
            entry = output["standings"][account]
            self.assertEqual(entry["onchain_points"]["witness"], 0)
            self.assertEqual(entry["season_total"], 0)

    def test_window_boundary_is_inclusive(self):
        # field_points.move: in_window = now <= first_at + WITNESS_WINDOW_SECS.
        sim = ChainSim()
        sim.attest(hexkey(1), addr("alice"), T0)
        sim.attest(hexkey(1), addr("bob"), T0 + WINDOW_SECS)
        output = self.score(sim.document())
        self.assertEqual(output["discrepancies"], [])
        self.assertEqual(
            output["standings"][addr("bob")]["onchain_points"]["witness"],
            POINTS_WITNESS)

    def test_anchor_claims_credit_and_cap(self):
        sim = ChainSim()
        sim.anchor(addr("pat"), hexkey(10), T0)
        sim.anchor(addr("pat"), hexkey(11), T0 + 60)
        sim.claim_anchors(addr("pat"), 2, T0 + 120)
        output = self.score(sim.document())

        self.assertEqual(output["discrepancies"], [])
        entry = output["standings"][addr("pat")]
        self.assertEqual(entry["onchain_points"]["anchor"], 2 * POINTS_ANCHOR)
        self.assertEqual(entry["season_total"], 2 * POINTS_ANCHOR)


class CliqueTest(ScorerTest):
    def build_clique_and_hub(self):
        """Two accounts that only corroborate each other, ten times over,
        next to an honest hub with ten distinct partners."""
        sim = ChainSim()
        min_n = RULES["clique"]["min_corroborations"]
        self.assertEqual(min_n, 10)  # frozen Season 0 parameter
        for n in range(min_n):
            sim.attest(hexkey(100 + n), addr("sybil-a"), T0 + n * 100)
            sim.attest(hexkey(100 + n), addr("sybil-b"), T0 + n * 100 + 10)
        for n in range(min_n):
            partner = addr(f"partner-{n:02d}")
            sim.attest(hexkey(200 + n), addr("hub"), T0 + n * 100)
            sim.attest(hexkey(200 + n), partner, T0 + n * 100 + 10)
        return sim

    def test_closed_pair_is_discounted_and_honest_hub_is_not(self):
        output = self.score(self.build_clique_and_hub().document())
        self.assertEqual(output["discrepancies"], [])

        raw = 10 * POINTS_WITNESS  # 250 recomputed witness points each
        for account in (addr("sybil-a"), addr("sybil-b")):
            entry = output["standings"][account]
            self.assertTrue(entry["clique_discount_applied"])
            self.assertEqual(entry["onchain_points"]["witness"], raw)
            self.assertEqual(entry["witness_points_standings"], raw * 0.25)
            self.assertEqual(entry["season_total"], raw * 0.25)

        hub = output["standings"][addr("hub")]
        self.assertFalse(hub["clique_discount_applied"])
        self.assertEqual(hub["witness_points_standings"], raw)
        self.assertEqual(hub["season_total"], raw)
        # The hub's partners are each far below min_corroborations.
        partner = output["standings"][addr("partner-00")]
        self.assertFalse(partner["clique_discount_applied"])
        self.assertEqual(partner["witness_points_standings"], POINTS_WITNESS)

    def test_below_min_corroborations_is_never_discounted(self):
        sim = ChainSim()
        for n in range(RULES["clique"]["min_corroborations"] - 1):
            sim.attest(hexkey(300 + n), addr("small-a"), T0 + n * 100)
            sim.attest(hexkey(300 + n), addr("small-b"), T0 + n * 100 + 10)
        output = self.score(sim.document())
        for account in (addr("small-a"), addr("small-b")):
            self.assertFalse(
                output["standings"][account]["clique_discount_applied"])

    def test_concentration_threshold_is_exact_at_80_percent(self):
        # The top <= 3 partners' share decides the discount, and the rules
        # say ">= 80%". With one heavy partner and single-corroboration
        # others, the top-3 sum is heavy + 2: at 6+4x1 that is 8/10 (exactly
        # 80%, discounted); at 5+5x1 it is 7/10 (below, not discounted).
        def build(heavy):
            sim = ChainSim()
            for n in range(heavy):
                sim.attest(hexkey(400 + n), addr("edge"), T0 + n * 100)
                sim.attest(hexkey(400 + n), addr("mate"), T0 + n * 100 + 10)
            for n in range(10 - heavy):
                sim.attest(hexkey(500 + n), addr("edge"), T0 + 5000 + n * 100)
                sim.attest(hexkey(500 + n), addr(f"other-{n}"),
                           T0 + 5000 + n * 100 + 10)
            return sim

        at_threshold = self.score(build(6).document())
        self.assertTrue(
            at_threshold["standings"][addr("edge")]["clique_discount_applied"])
        below = self.score(build(5).document())
        self.assertFalse(
            below["standings"][addr("edge")]["clique_discount_applied"])

    def test_method_block_documents_the_discount(self):
        output = self.score(self.build_clique_and_hub().document())
        method = output["method"]
        self.assertIn("clique.witness_discount", method["clique_algorithm"])
        self.assertEqual(method["rules_season"], "season-0")
        self.assertEqual(len(method["rules_sha256"]), 64)


class CellScoringTest(ScorerTest):
    WEEKS = ["2026-W41", "2026-W42", "2026-W43", "2026-W44", "2026-W45"]

    def build_resurvey(self):
        """One publisher re-surveys the same geohash-5 x band five weeks
        running; a rival lands a second (later-anchored) capture in the
        first week to probe the weekly cap."""
        sim = ChainSim()
        records = []
        for n, week in enumerate(self.WEEKS):
            commitment = hexkey(600 + n)
            sim.anchor(addr("surveyor"), commitment, T0 + n * 604800)
            records.append({
                "publisher": addr("surveyor"), "commitment": commitment,
                "geohash5": "9q8yy", "band": "868MHz", "iso_week": week,
            })
        rival = hexkey(700)
        sim.anchor(addr("rival"), rival, T0 + 3600)  # later tx than surveyor's
        records.append({
            "publisher": addr("rival"), "commitment": rival,
            "geohash5": "9q8yy", "band": "868MHz", "iso_week": self.WEEKS[0],
        })
        return sim, {"records": records}

    def test_first_discovery_decay_and_weekly_cap(self):
        sim, cells = self.build_resurvey()
        output = self.score(sim.document(), cells)

        self.assertEqual(output["discrepancies"], [])
        surveyor = output["standings"][addr("surveyor")]
        # floor(8 / 2^k) over five verified weeks: 8 + 4 + 2 + 1 + 0.
        self.assertEqual(surveyor["cell_points"], 8 + 4 + 2 + 1 + 0)
        # Weekly cap: the rival's week-41 capture is verified but the cell's
        # single week-41 credit went to the earlier-anchored capture.
        rival = output["standings"][addr("rival")]
        self.assertEqual(rival["cell_points"], 0)

    def test_earlier_anchor_takes_the_weekly_credit(self):
        sim, cells = self.build_resurvey()
        # Re-run with the rival's record listed first: input order of the
        # cells file must not matter, only anchor order on chain.
        cells["records"] = list(reversed(cells["records"]))
        output = self.score(sim.document(), cells)
        self.assertEqual(
            output["standings"][addr("surveyor")]["cell_points"], 15)
        self.assertEqual(output["standings"][addr("rival")]["cell_points"], 0)

    def test_distinct_band_is_a_distinct_cell(self):
        sim = ChainSim()
        c1, c2 = hexkey(800), hexkey(801)
        sim.anchor(addr("surveyor"), c1, T0)
        sim.anchor(addr("surveyor"), c2, T0 + 60)
        cells = {"records": [
            {"publisher": addr("surveyor"), "commitment": c1,
             "geohash5": "9q8yy", "band": "868MHz", "iso_week": "2026-W41"},
            {"publisher": addr("surveyor"), "commitment": c2,
             "geohash5": "9q8yy", "band": "915MHz", "iso_week": "2026-W41"},
        ]}
        output = self.score(sim.document(), cells)
        self.assertEqual(
            output["standings"][addr("surveyor")]["cell_points"],
            2 * CELL_BONUS)

    def test_unanchored_record_earns_nothing_and_is_reported(self):
        sim = ChainSim()
        sim.attest(hexkey(1), addr("alice"), T0)  # unrelated activity
        cells = {"records": [{
            "publisher": addr("ghost"), "commitment": hexkey(900),
            "geohash5": "9q8yy", "band": "868MHz", "iso_week": "2026-W41",
        }]}
        output = self.score(sim.document(), cells)
        self.assertNotIn(addr("ghost"), output["standings"])
        types = [d["type"] for d in output["discrepancies"]]
        self.assertEqual(types, ["cell_capture_not_anchored"])


class DiscrepancyTest(ScorerTest):
    def test_doctored_credited_field_is_flagged_and_overruled(self):
        sim = ChainSim()
        sim.attest(hexkey(1), addr("alice"), T0)
        sim.attest(hexkey(1), addr("bob"), T0 + WINDOW_SECS + 1)  # expired
        doc = sim.document()
        # Doctor the expired attestation to claim the corroboration credit,
        # with matching (forged) PointsAwarded events.
        for event in doc["events"]:
            if event["type"] == "WitnessAttested" and event["data"]["position"] == 2:
                event["data"]["credited"] = POINTS_WITNESS
        tx = max(e["tx_version"] for e in doc["events"]) + 1
        for i, account in enumerate((addr("alice"), addr("bob"))):
            doc["events"].append({
                "type": "PointsAwarded", "tx_version": tx, "event_index": i,
                "timestamp_unix": T0, "data": {
                    "account": account, "kind": 1, "amount": POINTS_WITNESS},
            })
        output = self.score(doc)

        types = sorted(d["type"] for d in output["discrepancies"])
        self.assertEqual(types, [
            "witness_credited_mismatch",
            "witness_points_awarded_mismatch",
            "witness_points_awarded_mismatch",
        ])
        # Standings use the recomputed values: the window expired, so zero.
        for account in (addr("alice"), addr("bob")):
            entry = output["standings"][account]
            self.assertEqual(entry["onchain_points"]["witness"], 0)
            self.assertEqual(entry["season_total"], 0)
        self.assertEqual(output["method"]["discrepancy_count"], 3)

    def test_anchor_overclaim_is_flagged_and_capped(self):
        sim = ChainSim()
        sim.anchor(addr("pat"), hexkey(10), T0)
        sim.claim_anchors(addr("pat"), 3, T0 + 60)  # only 1 registered
        output = self.score(sim.document())

        types = [d["type"] for d in output["discrepancies"]]
        self.assertEqual(types, ["anchor_overclaim"])
        entry = output["standings"][addr("pat")]
        self.assertEqual(entry["onchain_points"]["anchor"], POINTS_ANCHOR)
        self.assertEqual(entry["season_total"], POINTS_ANCHOR)

    def test_duplicate_attester_is_chain_impossible_data(self):
        sim = ChainSim()
        sim.attest(hexkey(1), addr("alice"), T0)
        doc = sim.document()
        doc["events"].append({
            "type": "WitnessAttested", "tx_version": 9999, "event_index": 0,
            "timestamp_unix": T0 + 60, "data": {
                "key": hexkey(1), "attester": addr("alice"),
                "position": 2, "credited": POINTS_WITNESS},
        })
        output = self.score(doc)
        types = [d["type"] for d in output["discrepancies"]]
        self.assertEqual(types, ["witness_duplicate_attester"])
        self.assertEqual(
            output["standings"][addr("alice")]["onchain_points"]["witness"], 0)


class DeterminismTest(ScorerTest):
    def build_fixture(self):
        sim = ChainSim()
        for n in range(10):
            sim.attest(hexkey(100 + n), addr("sybil-a"), T0 + n * 100)
            sim.attest(hexkey(100 + n), addr("sybil-b"), T0 + n * 100 + 10)
        sim.attest(hexkey(50), addr("alice"), T0)
        sim.attest(hexkey(50), addr("bob"), T0 + 60)
        sim.attest(hexkey(50), addr("carol"), T0 + 120)
        commitment = hexkey(600)
        sim.anchor(addr("alice"), commitment, T0 + 200)
        sim.claim_anchors(addr("alice"), 1, T0 + 260)
        cells = {"records": [{
            "publisher": addr("alice"), "commitment": commitment,
            "geohash5": "9q8yy", "band": "868MHz", "iso_week": "2026-W41",
        }]}
        return sim.document(), cells

    def run_scorer_subprocess(self, events_doc, cells_doc, name):
        events_path = self.dir / f"{name}-events.json"
        cells_path = self.dir / f"{name}-cells.json"
        events_path.write_text(json.dumps(events_doc), encoding="utf-8")
        cells_path.write_text(json.dumps(cells_doc), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "field_receipts_score.py"),
             "score", "--events", str(events_path), "--cells", str(cells_path)],
            capture_output=True, check=False, cwd=str(self.dir),
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        return result.stdout

    def test_two_runs_are_byte_identical(self):
        events_doc, cells_doc = self.build_fixture()
        first = self.run_scorer_subprocess(events_doc, cells_doc, "run1")
        second = self.run_scorer_subprocess(events_doc, cells_doc, "run2")
        self.assertEqual(first, second)
        self.assertGreater(len(first), 0)

    def test_input_file_order_does_not_matter(self):
        events_doc, cells_doc = self.build_fixture()
        baseline = self.run_scorer_subprocess(events_doc, cells_doc, "fwd")
        shuffled = {"events": list(reversed(events_doc["events"]))}
        reordered = self.run_scorer_subprocess(shuffled, cells_doc, "rev")
        self.assertEqual(baseline, reordered)

    def test_output_pins_the_rules_file_by_hash(self):
        import hashlib

        events_doc, cells_doc = self.build_fixture()
        output = json.loads(self.run_scorer_subprocess(events_doc, cells_doc, "pin"))
        self.assertEqual(
            output["method"]["rules_sha256"],
            hashlib.sha256(RULES_PATH.read_bytes()).hexdigest())


class InputValidationTest(ScorerTest):
    def test_duplicate_total_order_is_rejected(self):
        doc = {"events": [
            {"type": "WitnessAttested", "tx_version": 1, "event_index": 0,
             "timestamp_unix": T0, "data": {
                 "key": hexkey(1), "attester": addr("a"),
                 "position": 1, "credited": 0}},
            {"type": "WitnessAttested", "tx_version": 1, "event_index": 0,
             "timestamp_unix": T0, "data": {
                 "key": hexkey(2), "attester": addr("b"),
                 "position": 1, "credited": 0}},
        ]}
        code, _, stderr = run_cli(self.write_inputs(doc))
        self.assertEqual(code, 1)
        self.assertIn("duplicate", stderr)

    def test_malformed_event_type_is_rejected(self):
        doc = {"events": [
            {"type": "Bogus", "tx_version": 1, "event_index": 0,
             "timestamp_unix": T0, "data": {}},
        ]}
        code, _, stderr = run_cli(self.write_inputs(doc))
        self.assertEqual(code, 1)
        self.assertIn("type", stderr)

    def test_fetch_is_a_stub(self):
        code, _, stderr = run_cli(["fetch"])
        self.assertEqual(code, 2)
        self.assertIn("stub", stderr)


class RulesFreezeTest(unittest.TestCase):
    """docs/protocol/season-0-rules.json must match season-0.md's tables."""

    def test_frozen_parameters(self):
        self.assertEqual(RULES["season"], "season-0")
        onchain = RULES["onchain"]
        self.assertEqual(onchain["points_witness_corroboration"], 25)
        self.assertEqual(onchain["points_late_witness"], 5)
        self.assertEqual(onchain["late_witness_positions"], [3, 8])
        self.assertEqual(onchain["max_credited_attesters"], 8)
        self.assertEqual(onchain["witness_window_secs"], 7 * 24 * 60 * 60)
        self.assertEqual(onchain["points_per_anchor"], 10)
        cells = RULES["cells"]
        self.assertEqual(cells["first_discovery_bonus"], 8)
        self.assertEqual(cells["weekly_cap_credits_per_cell"], 1)
        clique = RULES["clique"]
        self.assertEqual(clique["min_corroborations"], 10)
        self.assertEqual(clique["max_partner_set"], 3)
        self.assertEqual(clique["concentration_threshold"], 0.8)
        self.assertEqual(clique["witness_discount"], 0.25)
        self.assertEqual(
            RULES["season_window_utc"],
            {"start": "2026-10-01T00:00:00Z", "end": "2026-12-31T23:59:59Z"})


if __name__ == "__main__":
    unittest.main()
