"""Witness-graph analysis over synthetic populations with known structure.

Season 0 has not run, so there is no real witness graph to analyse. These
tests are the substitute: each population below is built with a structure
we chose, and the assertions say what the statistics must report about
that structure — including, for each population, whether the frozen
Season 0 clique rule and the richer statistics agree.

The event fixtures come from the scorer's own ChainSim
(test/field_receipts_score), so the analysis is always run over an event
log the scorer itself replays without discrepancies.
"""

import json
import subprocess
import sys
import tempfile
import unittest
from fractions import Fraction
from itertools import combinations
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(REPO_ROOT / "test" / "field_receipts_score"))

import field_receipts_score as frs  # noqa: E402
import witness_graph_analysis as wga  # noqa: E402

from test_field_receipts_score import ChainSim, addr, hexkey  # noqa: E402

RULES_PATH = REPO_ROOT / "docs" / "protocol" / "season-0-rules.json"
RULES, RULES_SHA256 = frs.load_rules(RULES_PATH)

T0 = 1_760_000_000  # inside the Season 0 window (2026-10-09 UTC)
WINDOW_SECS = 7 * 24 * 60 * 60
MIN_CORROBORATIONS = RULES["clique"]["min_corroborations"]  # 10, frozen


def jitter(n, span):
    """Deterministic human-looking offset — no RNG, no hash(), no clock."""
    return (n * 1103515245 + 12345) % span


class Population:
    """A synthetic witness graph, built one co-attested key at a time."""

    def __init__(self):
        self.sim = ChainSim()
        self._key = 0

    def next_key(self):
        self._key += 1
        return hexkey(self._key)

    def co_attest(self, opener, follower, at, gap):
        """One fresh key: `opener` attests at `at`, `follower` `gap` later."""
        key = self.next_key()
        self.sim.attest(key, addr(opener), at)
        self.sim.attest(key, addr(follower), at + gap)

    def document(self):
        return self.sim.document()


# ------------------------------------------------------------ populations


def honest_hub(pop, hub="hub", partners=10, base=T0):
    """One busy operator corroborating a different neighbour every time.

    Ten corroborations — the rule's floor — but spread over ten partners,
    with ragged human timing.
    """
    for n in range(partners):
        pop.co_attest(hub, f"partner-{n:02d}",
                      base + n * 4001 + jitter(n, 3000),
                      61 + jitter(n * 7, 1800))
    return pop


def closed_pair(pop, left="pair-a", right="pair-b",
                count=MIN_CORROBORATIONS, spacing=600, gap=9, base=T0):
    """Two accounts that only ever witness each other, on a timer."""
    for n in range(count):
        pop.co_attest(left, right, base + n * spacing, gap)
    return pop


def sybil_ring(pop, members, per_pair, base=T0, spacing=900, gap=11):
    """Every member co-attests every other member, `per_pair` times."""
    step = 0
    for left, right in combinations(members, 2):
        for n in range(per_pair):
            pop.co_attest(left, right, base + step * spacing, gap)
            step += 1
    return pop


def window_dodging_pair(pop, left="dodge-a", right="dodge-b", base=T0):
    """A pair one corroboration under the rule's floor.

    Nine in-window corroborations (the rule needs ten), plus three keys
    the follower attests after the 7-day window closes: those pay nothing
    and are invisible to the rule, but they are co-attestation all the
    same, and the graph counts them.
    """
    for n in range(MIN_CORROBORATIONS - 1):
        pop.co_attest(left, right, base + n * 1234, 13)
    for n in range(3):
        pop.co_attest(left, right, base + 100_000 + n * 1500, WINDOW_SECS + 60)
    return pop


def small_town(pop, base=T0):
    """The documented false-positive shape: a real, small, open neighbourhood.

    `town-a` has exactly three regular partners — everyone within radio
    range — and twelve corroborations, so the frozen rule discounts it.
    Its partners each also work with eight passers-through, so the group
    is not closed, and every gap and latency is ragged.
    """
    peers = ("town-b", "town-c", "town-d")
    for index, peer in enumerate(peers):
        for n in range(4):
            pop.co_attest("town-a", peer,
                          base + n * 7919 + index * 1000 + jitter(n + index, 4000),
                          300 + jitter(n * 3 + index, 2500))
    for index, peer in enumerate(peers):
        for n in range(8):
            pop.co_attest(peer, f"visitor-{index}{n}",
                          base + n * 6113 + index * 500 + jitter(n * 5, 3500),
                          400 + jitter(n * 11 + index, 2000))
    return pop


def mixed_population():
    """Every shape above in one graph, as a season would contain them."""
    pop = Population()
    honest_hub(pop)
    closed_pair(pop)
    sybil_ring(pop, [f"ring3-{i}" for i in range(3)], per_pair=5)
    sybil_ring(pop, [f"ring5-{i}" for i in range(5)], per_pair=3)
    window_dodging_pair(pop)
    small_town(pop)
    return pop


# ------------------------------------------------------------------- base


class AnalysisTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def write_events(self, document, name="events.json"):
        path = self.dir / name
        path.write_text(json.dumps(document), encoding="utf-8")
        return path

    def analyze(self, document, **params):
        events = frs.load_events(self.write_events(document))
        # The scorer must accept the same fixture cleanly: an analysis of a
        # log the scorer disputes would be measuring the fixture, not the
        # graph.
        self.assertEqual(frs.replay_onchain(events, RULES)["discrepancies"], [])
        return wga.analyze(events, RULES, RULES_SHA256, wga.Params(**params))

    def account(self, output, name):
        return output["accounts"][addr(name)]

    def names(self, addresses):
        return sorted(bytes.fromhex(a[2:]).decode("utf-8") for a in addresses)


# ------------------------------------------------------------------ tests


class GraphConstructionTest(AnalysisTest):
    def test_edge_weight_is_the_count_of_shared_keys(self):
        pop = Population()
        closed_pair(pop, count=4)
        output = self.analyze(pop.document())
        entry = self.account(output, "pair-a")
        self.assertEqual(entry["degree"], 1)
        self.assertEqual(entry["weighted_degree"], 4)
        self.assertEqual(entry["top_partners"][0]["shared_keys"], 4)
        self.assertEqual(output["graph"]["edge_count"], 1)
        self.assertEqual(output["graph"]["total_edge_weight"], 4)

    def test_co_attestation_counts_what_the_rule_cannot_see(self):
        # The window-dodging pair's out-of-window keys pay nothing and are
        # not corroborations, but they are shared keys.
        output = self.analyze(window_dodging_pair(Population()).document())
        entry = self.account(output, "dodge-a")
        self.assertEqual(entry["corroborations"], MIN_CORROBORATIONS - 1)
        self.assertEqual(entry["weighted_degree"], MIN_CORROBORATIONS + 2)

    def test_solo_attester_is_an_isolated_node(self):
        pop = Population()
        pop.sim.attest(pop.next_key(), addr("loner"), T0)
        closed_pair(pop, count=3)
        output = self.analyze(pop.document())
        self.assertEqual(output["graph"]["isolated_accounts"], [addr("loner")])
        self.assertEqual(self.account(output, "loner")["degree"], 0)
        self.assertEqual(self.account(output, "loner")["signals"], [])


class HonestHubTest(AnalysisTest):
    def setUp(self):
        super().setUp()
        self.output = self.analyze(honest_hub(Population()).document())

    def test_degree_distribution_is_one_hub_and_ten_leaves(self):
        histogram = self.output["degree_distribution"]["histogram"]
        self.assertEqual(histogram, [{"degree": 1, "accounts": 10},
                                     {"degree": 10, "accounts": 1}])
        self.assertEqual(self.output["degree_distribution"]["max"], 10)
        self.assertEqual(self.account(self.output, "hub")["degree"], 10)

    def test_a_star_is_closed_but_not_dense(self):
        # The whole component is isolated, so closure is 1 — which is why
        # closure alone cannot flag a sybil. Density separates them.
        concentration = self.account(
            self.output, "hub")["partner_concentration"]
        self.assertEqual(concentration["neighborhood_closure"], 1.0)
        self.assertLess(concentration["neighborhood_density"], 0.8)
        self.assertEqual(self.account(self.output, "hub")["clustering"], 0.0)
        self.assertEqual(self.output["clustering"]["transitivity"], 0.0)

    def test_one_component_and_no_mutual_only_clique(self):
        components = self.output["components"]
        self.assertEqual(len(components), 1)
        self.assertEqual(components[0]["size"], 11)
        self.assertEqual(
            self.output["dense_subgraphs"]["mutual_only_clique_count"], 0)

    def test_neither_the_rule_nor_the_statistics_flag_the_hub(self):
        hub = self.account(self.output, "hub")
        self.assertEqual(hub["corroborations"], MIN_CORROBORATIONS)
        self.assertEqual(
            hub["partner_concentration"]["corroboration_top_share"], 0.3)
        self.assertFalse(hub["rule_discounted"])
        self.assertFalse(hub["statistics_flagged"])
        self.assertEqual(hub["signals"], [])
        self.assertEqual(hub["delta"], "none")
        self.assertEqual(self.output["rule_vs_statistics"]["counts"],
                         {"rule_discounted": 0, "statistics_flagged": 0,
                          "agreement": 0, "rule_only": 0,
                          "statistics_only": 0})


class ClosedPairTest(AnalysisTest):
    def setUp(self):
        super().setUp()
        self.output = self.analyze(closed_pair(Population()).document())

    def test_rule_and_statistics_agree(self):
        for name in ("pair-a", "pair-b"):
            entry = self.account(self.output, name)
            self.assertTrue(entry["rule_discounted"])
            self.assertTrue(entry["statistics_flagged"])
            self.assertEqual(entry["delta"], "agreement")
        delta = self.output["rule_vs_statistics"]
        self.assertEqual(self.names(delta["agreement"]), ["pair-a", "pair-b"])
        self.assertEqual(delta["rule_only"], [])
        self.assertEqual(delta["statistics_only"], [])

    def test_every_signal_fires(self):
        self.assertEqual(
            self.account(self.output, "pair-a")["signals"],
            sorted([wga.SIGNAL_CLOSED_NEIGHBORHOOD,
                    wga.SIGNAL_MUTUAL_ONLY_CLIQUE,
                    wga.SIGNAL_AUTOMATED_INTERARRIVAL,
                    wga.SIGNAL_SYNCHRONIZED_PAIR]))

    def test_the_pair_is_a_mutual_only_clique_and_the_densest_subgraph(self):
        dense = self.output["dense_subgraphs"]
        self.assertEqual(dense["mutual_only_clique_count"], 1)
        clique = dense["top_cliques"][0]
        self.assertEqual(clique["size"], 2)
        self.assertEqual(clique["closure"], 1.0)
        self.assertEqual(clique["internal_weight"], MIN_CORROBORATIONS)
        self.assertTrue(clique["mutual_only"])
        densest = dense["densest_subgraph"]
        self.assertEqual(self.names(densest["accounts"]), ["pair-a", "pair-b"])
        self.assertEqual(densest["density"], MIN_CORROBORATIONS / 2)

    def test_timing_is_machine_shaped(self):
        timing = self.account(self.output, "pair-a")["timing"]
        self.assertTrue(timing["automated"])
        self.assertEqual(timing["distinct_deltas"], 1)
        self.assertEqual(timing["modal_delta_share"], 1.0)
        self.assertEqual(timing["delta_cv"], 0.0)
        pair = self.output["timing_anomalies"]["top_synchronized_pairs"][0]
        self.assertTrue(pair["constant_latency"])
        self.assertTrue(pair["always_within_window"])
        self.assertEqual(pair["distinct_latencies"], 1)
        self.assertEqual(pair["max_latency_secs"], 9)
        self.assertEqual(pair["lead_share"], 1.0)  # the same account always first

    def test_a_pair_below_the_corroboration_floor_is_left_alone_by_the_rule(self):
        output = self.analyze(
            closed_pair(Population(), count=MIN_CORROBORATIONS - 1).document())
        entry = self.account(output, "pair-a")
        self.assertFalse(entry["rule_discounted"])
        # Structural signals share the rule's volume floor, so below it only
        # the behavioural signals remain — and here they are enough.
        self.assertNotIn(wga.SIGNAL_CLOSED_NEIGHBORHOOD, entry["signals"])
        self.assertEqual(entry["delta"], "statistics_only")


class SybilRingTest(AnalysisTest):
    def test_three_ring_is_caught_by_both(self):
        members = [f"ring3-{i}" for i in range(3)]
        output = self.analyze(sybil_ring(Population(), members, 5).document())
        clique = output["dense_subgraphs"]["top_cliques"][0]
        self.assertEqual(clique["size"], 3)
        self.assertEqual(clique["closure"], 1.0)
        self.assertEqual(clique["internal_weight"], 15)
        for name in members:
            entry = self.account(output, name)
            self.assertEqual(entry["degree"], 2)
            self.assertEqual(entry["corroborations"], 10)
            self.assertEqual(entry["clustering"], 1.0)
            self.assertEqual(
                entry["partner_concentration"]["corroboration_top_share"], 1.0)
            self.assertEqual(entry["delta"], "agreement")

    def test_five_ring_slips_under_the_frozen_threshold(self):
        # Four partners, evenly used: the top <= 3 of them hold 9 of 12
        # corroborations — 75%, under the frozen 80% — so the rule never
        # fires. The group statistics do not care how the weight is split.
        members = [f"ring5-{i}" for i in range(5)]
        output = self.analyze(sybil_ring(Population(), members, 3).document())
        for name in members:
            entry = self.account(output, name)
            self.assertEqual(entry["corroborations"], 12)
            concentration = entry["partner_concentration"]
            self.assertEqual(concentration["corroboration_top_share"], 0.75)
            # The same statistic over co-attestation would not have saved
            # it either: only the group view does.
            self.assertEqual(concentration["coattestation_top_share"], 0.75)
            self.assertEqual(concentration["neighborhood_closure"], 1.0)
            self.assertEqual(concentration["neighborhood_density"], 1.0)
            self.assertFalse(entry["rule_discounted"])
            self.assertTrue(entry["statistics_flagged"])
            self.assertEqual(entry["delta"], "statistics_only")
        clique = output["dense_subgraphs"]["top_cliques"][0]
        self.assertEqual(clique["size"], 5)
        self.assertTrue(clique["mutual_only"])
        self.assertEqual(
            self.names(output["rule_vs_statistics"]["statistics_only"]),
            sorted(members))

    def test_window_dodging_pair_is_a_false_negative_of_the_rule(self):
        output = self.analyze(window_dodging_pair(Population()).document())
        entry = self.account(output, "dodge-a")
        self.assertFalse(entry["rule_discounted"])
        self.assertTrue(entry["statistics_flagged"])
        self.assertIn(wga.SIGNAL_CLOSED_NEIGHBORHOOD, entry["signals"])
        self.assertIn(wga.SIGNAL_MUTUAL_ONLY_CLIQUE, entry["signals"])
        self.assertEqual(entry["delta"], "statistics_only")


class SmallTownTest(AnalysisTest):
    """The documented limit: a genuinely small, genuinely open neighbourhood."""

    def setUp(self):
        super().setUp()
        self.output = self.analyze(small_town(Population()).document())

    def test_the_rule_discounts_the_town_and_the_statistics_do_not(self):
        entry = self.account(self.output, "town-a")
        self.assertEqual(entry["corroborations"], 12)
        self.assertEqual(
            entry["partner_concentration"]["corroboration_top_share"], 1.0)
        self.assertTrue(entry["rule_discounted"])
        self.assertFalse(entry["statistics_flagged"])
        self.assertEqual(entry["signals"], [])
        self.assertEqual(entry["delta"], "rule_only")
        self.assertEqual(
            self.names(self.output["rule_vs_statistics"]["rule_only"]),
            ["town-a"])

    def test_the_neighbourhood_is_open_and_sparse(self):
        concentration = self.account(
            self.output, "town-a")["partner_concentration"]
        self.assertLess(concentration["neighborhood_closure"], 0.8)
        self.assertLess(concentration["neighborhood_density"], 0.8)

    def test_the_towns_partners_are_untouched_by_either_view(self):
        for name in ("town-b", "town-c", "town-d", "visitor-00"):
            entry = self.account(self.output, name)
            self.assertFalse(entry["rule_discounted"])
            self.assertFalse(entry["statistics_flagged"])


class MixedPopulationTest(AnalysisTest):
    def setUp(self):
        super().setUp()
        self.output = self.analyze(mixed_population().document())

    def test_the_delta_is_the_interesting_output(self):
        delta = self.output["rule_vs_statistics"]
        self.assertEqual(self.names(delta["agreement"]),
                         ["pair-a", "pair-b", "ring3-0", "ring3-1", "ring3-2"])
        self.assertEqual(self.names(delta["rule_only"]), ["town-a"])
        self.assertEqual(
            self.names(delta["statistics_only"]),
            ["dodge-a", "dodge-b", "ring5-0", "ring5-1", "ring5-2",
             "ring5-3", "ring5-4"])
        self.assertEqual(delta["counts"],
                         {"rule_discounted": 6, "statistics_flagged": 12,
                          "agreement": 5, "rule_only": 1,
                          "statistics_only": 7})

    def test_components_separate_the_populations(self):
        sizes = [component["size"] for component in self.output["components"]]
        # hub(11), town(3 peers + 24 visitors + town-a = 28), ring5(5),
        # ring3(3), pair(2), dodge(2).
        self.assertEqual(sorted(sizes, reverse=True), [28, 11, 5, 3, 2, 2])
        self.assertEqual(len(sizes), 6)

    def test_cliques_are_ranked_by_size_then_weight(self):
        cliques = self.output["dense_subgraphs"]["top_cliques"]
        sizes = [clique["size"] for clique in cliques]
        self.assertEqual(sizes, sorted(sizes, reverse=True))
        self.assertEqual(cliques[0]["size"], 5)
        self.assertTrue(cliques[0]["mutual_only"])
        self.assertFalse(
            self.output["dense_subgraphs"]["enumeration_truncated"])

    def test_the_rule_view_is_the_scorer_itself(self):
        # Imported, never reimplemented: the two cannot drift.
        self.assertIs(wga.detect_cliques, frs.detect_cliques)
        events = frs.load_events(self.write_events(mixed_population().document()))
        replay = frs.replay_onchain(events, RULES)
        self.assertEqual(
            sorted(frs.detect_cliques(replay["corroborations"], RULES)),
            self.output["rule_vs_statistics"]["rule_discounted"])

    def test_method_block_pins_the_rules_and_disclaims_findings(self):
        method = self.output["method"]
        self.assertEqual(method["rules_season"], "season-0")
        self.assertEqual(method["rules_sha256"], RULES_SHA256)
        self.assertEqual(method["scorer_discrepancy_count"], 0)
        self.assertEqual(method["duplicate_attestations"], 0)
        self.assertIn("Season 0 has not run", method["findings_status"])
        self.assertIn("witness-graph-method.md", method["findings_status"])
        self.assertEqual(method["parameters"]["min_signals"], 2)

    def test_thresholds_are_parameters_and_move_the_delta(self):
        # Requiring all four signals loses the groups flagged on structure
        # alone; loosening far enough drags the small town back in, which
        # is the honest shape of the trade-off. Both directions must move.
        strict = self.analyze(mixed_population().document(), min_signals=4)
        loose = self.analyze(mixed_population().document(), min_signals=1,
                             closure_threshold=Fraction(3, 10))
        counts = self.output["rule_vs_statistics"]["counts"]
        self.assertLess(strict["rule_vs_statistics"]["counts"][
            "statistics_flagged"], counts["statistics_flagged"])
        self.assertGreater(loose["rule_vs_statistics"]["counts"][
            "statistics_flagged"], counts["statistics_flagged"])
        self.assertIn("town-a", self.names(
            loose["rule_vs_statistics"]["statistics_flagged"]))


class TimingTest(AnalysisTest):
    def test_ragged_human_timing_is_not_called_automated(self):
        output = self.analyze(honest_hub(Population()).document())
        timing = self.account(output, "hub")["timing"]
        self.assertFalse(timing["automated"])
        self.assertGreater(timing["distinct_deltas"], 1)
        self.assertGreater(timing["delta_cv"], 0.05)
        self.assertEqual(output["timing_anomalies"][
            "automated_interarrival_accounts"], [])

    def test_low_variation_without_a_modal_gap_still_reads_as_automated(self):
        # 3600s +/- 1s: no gap repeats often, but the stream is a metronome.
        pop = Population()
        for n in range(8):
            pop.co_attest("cron-a", "cron-b", T0 + n * 3600 + (n % 3), 40)
        output = self.analyze(pop.document())
        timing = self.account(output, "cron-a")["timing"]
        self.assertLess(timing["modal_delta_share"], 0.8)
        self.assertLess(timing["delta_cv"], 0.05)
        self.assertTrue(timing["automated"])

    def test_short_streams_are_never_called_automated(self):
        pop = Population()
        for n in range(3):  # 2 gaps, under --min-deltas
            pop.co_attest("brief-a", "brief-b", T0 + n * 100, 5)
        output = self.analyze(pop.document())
        self.assertFalse(self.account(output, "brief-a")["timing"]["automated"])

    def test_a_pair_answering_within_seconds_every_time_is_synchronized(self):
        pop = Population()
        for n in range(6):
            pop.co_attest("fast-a", "fast-b", T0 + n * 5000 + jitter(n, 900),
                          5 + n)  # varying latency, all inside the window
        output = self.analyze(pop.document())
        pair = output["timing_anomalies"]["top_synchronized_pairs"][0]
        self.assertTrue(pair["always_within_window"])
        self.assertFalse(pair["constant_latency"])
        self.assertEqual(output["timing_anomalies"]["synchronized_pair_count"], 1)

    def test_slow_ragged_pairs_are_not_synchronized(self):
        pop = Population()
        for n in range(6):
            pop.co_attest("slow-a", "slow-b", T0 + n * 5000,
                          600 + jitter(n, 4000))
        output = self.analyze(pop.document())
        self.assertEqual(output["timing_anomalies"]["synchronized_pair_count"], 0)
        self.assertEqual(
            output["timing_anomalies"]["top_synchronized_pairs"], [])

    def test_pair_window_is_a_parameter(self):
        pop = Population()
        for n in range(6):
            # Latencies vary, so only the window decides.
            pop.co_attest("mid-a", "mid-b", T0 + n * 5000, 120 + n * 7)
        default = self.analyze(pop.document())
        widened = self.analyze(pop.document(), pair_window_secs=300)
        self.assertEqual(default["timing_anomalies"]["synchronized_pair_count"], 0)
        self.assertEqual(widened["timing_anomalies"]["synchronized_pair_count"], 1)


class DuplicateAttestationTest(AnalysisTest):
    def test_repeat_attestation_of_a_key_is_counted_not_graphed(self):
        pop = Population()
        closed_pair(pop, count=3)
        document = pop.document()
        document["events"].append({
            "type": "WitnessAttested", "tx_version": 99_999, "event_index": 0,
            "timestamp_unix": T0 + 10, "data": {
                "key": hexkey(1), "attester": addr("pair-a"),
                "position": 3, "credited": 0}})
        events = frs.load_events(self.write_events(document))
        output = wga.analyze(events, RULES, RULES_SHA256, wga.Params())
        self.assertEqual(output["method"]["duplicate_attestations"], 1)
        self.assertEqual(self.account(output, "pair-a")["weighted_degree"], 3)


class CliTest(AnalysisTest):
    def run_cli(self, args, document=None, name="cli-events.json"):
        path = self.write_events(document or mixed_population().document(), name)
        return subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "witness_graph_analysis.py"),
             "analyze", "--events", str(path)] + args,
            capture_output=True, check=False, cwd=str(self.dir))

    def test_two_runs_are_byte_identical(self):
        document = mixed_population().document()
        first = self.run_cli([], document, "run1.json")
        second = self.run_cli([], document, "run2.json")
        self.assertEqual(first.returncode, 0, first.stderr.decode())
        self.assertEqual(first.stdout, second.stdout)
        self.assertGreater(len(first.stdout), 0)

    def test_markdown_is_deterministic_too(self):
        document = mixed_population().document()
        first = self.run_cli(["--markdown"], document, "md1.json")
        second = self.run_cli(["--markdown"], document, "md2.json")
        self.assertEqual(first.returncode, 0, first.stderr.decode())
        self.assertEqual(first.stdout, second.stdout)
        report = first.stdout.decode()
        for heading in ("# Witness graph analysis", "## Degree distribution",
                        "## Components", "## Dense subgraphs",
                        "## Partner concentration", "## Timing anomalies",
                        "## The frozen rule vs the statistics"):
            self.assertIn(heading, report)
        self.assertIn("Season 0 has not run", report)
        self.assertIn("witness-graph-method.md", report)
        self.assertIn("rule_only", report)
        self.assertIn("statistics_only", report)

    def test_event_file_order_does_not_change_the_output(self):
        document = mixed_population().document()
        shuffled = {"events": list(reversed(document["events"]))}
        forward = self.run_cli([], document, "fwd.json")
        reverse = self.run_cli([], shuffled, "rev.json")
        self.assertEqual(forward.stdout, reverse.stdout)

    def test_empty_event_log_is_analysable(self):
        result = self.run_cli([], {"events": []}, "empty.json")
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        output = json.loads(result.stdout)
        self.assertEqual(output["graph"]["account_count"], 0)
        self.assertEqual(output["accounts"], {})
        self.assertEqual(output["rule_vs_statistics"]["counts"][
            "statistics_flagged"], 0)

    def test_bad_parameters_are_rejected(self):
        result = self.run_cli(["--min-signals", "0"])
        self.assertEqual(result.returncode, 1)
        self.assertIn(b"--min-signals", result.stderr)
        result = self.run_cli(["--closure-threshold", "1.5"])
        self.assertEqual(result.returncode, 1)
        self.assertIn(b"--closure-threshold", result.stderr)

    def test_malformed_events_are_rejected_by_the_shared_loader(self):
        result = self.run_cli([], {"events": [
            {"type": "Bogus", "tx_version": 1, "event_index": 0,
             "timestamp_unix": T0, "data": {}}]}, "bad.json")
        self.assertEqual(result.returncode, 1)
        self.assertIn(b"type", result.stderr)


class DocumentationTest(unittest.TestCase):
    """The method doc is part of the deliverable, and says so honestly."""

    METHOD_DOC = REPO_ROOT / "docs" / "protocol" / "witness-graph-method.md"

    def test_method_doc_exists_and_awaits_data(self):
        text = self.METHOD_DOC.read_text(encoding="utf-8")
        self.assertIn("Findings: awaiting Season 0 data", text)
        self.assertIn("scripts/witness_graph_analysis.py", text)
        for statistic in ("degree", "clustering", "closure", "density",
                          "inter-arrival", "component"):
            self.assertIn(statistic, text.lower())

    def test_season_1_recommendation_is_a_method_not_a_conclusion(self):
        text = self.METHOD_DOC.read_text(encoding="utf-8")
        self.assertIn("Season 1", text)
        # Every signal the tool can raise must be described in the doc.
        for signal in (wga.SIGNAL_CLOSED_NEIGHBORHOOD,
                       wga.SIGNAL_MUTUAL_ONLY_CLIQUE,
                       wga.SIGNAL_AUTOMATED_INTERARRIVAL,
                       wga.SIGNAL_SYNCHRONIZED_PAIR):
            self.assertIn(signal, text)


if __name__ == "__main__":
    unittest.main()
