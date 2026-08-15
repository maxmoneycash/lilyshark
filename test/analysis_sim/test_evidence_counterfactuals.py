import json
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "analysis"))

import counterfactuals as cf  # noqa: E402
import shelby_network_evidence as ev  # noqa: E402


class CounterfactualTest(unittest.TestCase):
    def test_sd_survival_decays_with_time(self):
        survivals = [cf.sd_survival(y) for y in cf.YEARS]
        self.assertEqual(survivals, sorted(survivals, reverse=True))
        for s in survivals:
            self.assertGreater(s, 0)
            self.assertLess(s, 1)

    def test_replication_beats_single_card_at_every_horizon(self):
        for y in cf.YEARS:
            self.assertGreater(cf.network_survival(y), cf.sd_survival(y))

    def test_network_survival_worsens_with_group_loss_rate(self):
        for y in cf.YEARS:
            self.assertLess(
                cf.network_survival(y, cf.REPLICA_GROUP_LOSS_YR_SENSITIVITY),
                cf.network_survival(y),
            )

    def test_coverage_rises_and_resolution_falls_with_gateways(self):
        coverages = [cf.domain_gateway_coverage(g) for g in cf.GATEWAY_FRACTIONS]
        times = [cf.expected_days_to_resolution(g) for g in cf.GATEWAY_FRACTIONS]
        self.assertEqual(coverages, sorted(coverages))
        self.assertEqual(times, sorted(times, reverse=True))
        # 5% gateways is the same-day knee the report claims
        self.assertLess(cf.expected_days_to_resolution(0.05), 1.0)
        self.assertGreater(cf.domain_gateway_coverage(0.05), 0.5)

    def test_zero_gateways_never_resolves(self):
        self.assertEqual(cf.expected_days_to_resolution(0.0), float("inf"))


class EvidenceTest(unittest.TestCase):
    """Runs against the pinned fixture — CI never touches the network."""

    @classmethod
    def setUpClass(cls):
        cls.snap = json.loads(ev.FIXTURE.read_text())
        cls.a = ev.analyze(cls.snap)

    def test_fixture_has_all_sources(self):
        for key in ("fetched_at", "stats", "analytics", "economy", "sync"):
            self.assertIn(key, self.snap)

    def test_derived_values_are_consistent(self):
        a = self.a
        stats = self.snap["stats"]
        self.assertEqual(a["total_blobs"], int(stats["totalBlobs"]))
        self.assertAlmostEqual(
            a["total_gb"], int(stats["totalStorage"]) / 1e9, places=6
        )
        self.assertGreater(a["activities_per_blob"], 1.0)
        self.assertGreater(a["tx_all_time"], 0)

    def test_every_type_row_is_well_formed(self):
        for row in self.a["types"]:
            self.assertGreater(row["count"], 0)
            self.assertGreater(row["gb"], 0)
            self.assertGreater(row["avg_kb"], 0)

    def test_capture_size_claim_is_true_of_the_snapshot(self):
        # The report says the network's average object is capture-sized: same
        # order of magnitude as a 200 KB session capture.
        self.assertGreater(self.a["avg_blob_kb"], 20)
        self.assertLess(self.a["avg_blob_kb"], 2000)

    def test_offline_report_generation(self):
        code = ev.main(["--offline"])
        self.assertEqual(code, 0)
        report = (ev.OUT_DIR / "results_evidence.md").read_text()
        self.assertIn("Blobs stored", report)
        self.assertIn("ShelbyUSD", report)


if __name__ == "__main__":
    unittest.main()
