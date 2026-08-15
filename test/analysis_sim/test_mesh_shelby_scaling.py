import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "analysis"))

import mesh_shelby_scaling as sim  # noqa: E402


class AirtimeTest(unittest.TestCase):
    def test_toa_positive_and_grows_with_payload(self):
        small = sim.toa_ms(1)
        pointer = sim.toa_ms(sim.POINTER_BYTES)
        big = sim.toa_ms(sim.LORA_MAX_PAYLOAD)
        for v in (small, pointer, big):
            self.assertGreater(v, 0)
        self.assertLess(small, pointer)
        self.assertLess(pointer, big)

    def test_pointer_airtime_matches_longfast_budget(self):
        # SF11/BW250 symbol time is 8.192 ms; an 82-byte payload must cost
        # well under a second on the air, and a 237-byte one just over two.
        self.assertLess(sim.toa_ms(sim.POINTER_BYTES), 1000)
        self.assertGreater(sim.toa_ms(sim.LORA_MAX_PAYLOAD), 2000)
        self.assertLess(sim.toa_ms(sim.LORA_MAX_PAYLOAD), 2300)

    def test_pointer_fits_one_frame(self):
        self.assertLessEqual(sim.POINTER_BYTES, sim.LORA_MAX_PAYLOAD)


class CapacityTest(unittest.TestCase):
    def test_delivered_falls_with_r_and_rises_with_channels(self):
        base = sim.delivered_per_hour(82, r=7.36, util=0.20, channels=1)
        better_r = sim.delivered_per_hour(82, r=4.0, util=0.20, channels=1)
        more_ch = sim.delivered_per_hour(82, r=7.36, util=0.20, channels=4)
        self.assertGreater(better_r, base)
        self.assertGreater(more_ch, base)
        self.assertAlmostEqual(more_ch / base, 4.0, places=6)

    def test_architecture_ladder_only_improves(self):
        caps = [row["pointers_per_hour"] for row in sim.scenario_a()]
        self.assertEqual(caps, sorted(caps))
        self.assertTrue(all(c > 0 for c in caps))

    def test_arch_years_are_ordered(self):
        years = [row["year"] for row in sim.scenario_a()]
        self.assertEqual(years, sorted(years))


class ScenarioTest(unittest.TestCase):
    def test_storage_scales_linearly_with_fleet(self):
        rows = sim.scenario_b()
        by_fleet = {row["fleet"]: row["gb_per_year"] for row in rows}
        self.assertAlmostEqual(by_fleet[100] / by_fleet[10], 10.0, places=6)
        self.assertAlmostEqual(by_fleet[100_000] / by_fleet[1_000], 100.0, places=6)
        for row in rows:
            self.assertGreater(row["blobs_per_year"], 0)
            self.assertGreaterEqual(row["served_gb_per_year"], row["gb_per_year"])

    def test_pointer_beats_sending_the_blob_by_orders_of_magnitude(self):
        rows, baseline = sim.scenario_c()
        worst_pointer = max(row["airtime_s_per_blob"] for row in rows)
        self.assertLess(worst_pointer * 100, baseline["baseline_s"])
        self.assertGreater(baseline["frames"], 1)

    def test_reference_efficiency_improves_as_r_falls(self):
        rows, _ = sim.scenario_c()
        ratios = [row["ip_bytes_per_air_byte"] for row in rows]
        self.assertEqual(ratios, sorted(ratios))

    def test_report_and_charts_are_generated(self):
        sim.main()
        results = (sim.OUT_DIR / "results.md").read_text()
        self.assertIn("R = 7.36", results)
        self.assertIn("12,6", results)  # the send-the-blob baseline, seconds
        for name in (
            "chart_pointer_capacity.svg",
            "chart_shelby_storage.svg",
            "chart_airtime_cost.svg",
        ):
            text = (sim.OUT_DIR / name).read_text()
            self.assertTrue(text.startswith("<svg") or "<svg" in text[:200])
            self.assertIn("</svg>", text)


if __name__ == "__main__":
    unittest.main()
