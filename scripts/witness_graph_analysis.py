#!/usr/bin/env python3
"""Sybil-clique analysis over the Field Receipts witness graph (task PR-007).

Season 0's threat model (docs/protocol/field-receipts.md#threat-model-honestly)
does not claim sybil-proofness: it claims every farming path either costs
real money or is *visible in public data*. The scorer
(`scripts/field_receipts_score.py`) acts on one narrow slice of that
visibility — the frozen Season 0 clique rule: an account with >= 10
corroborations whose top <= 3 partners hold >= 80% of them has its witness
points multiplied by 0.25 in standings.

This script is the measurement that says whether that price was right. It
consumes the same events JSON as the scorer, builds the *co-attestation*
graph (which is strictly richer than the corroboration graph the rule
sees), and reports the structure and timing statistics that a rule could
have used — then prints the delta: who the frozen rule discounts that the
statistics say looks organic (candidate false positives), and who the
statistics flag that the frozen rule misses (candidate false negatives).

It changes no score. The scorer is the authority on standings; this is
evidence for drafting Season 1's rules
(docs/protocol/witness-graph-method.md).

Deterministic, like the scorer: same inputs, same bytes. Every ordering is
explicit, every threshold comparison is exact `Fraction` arithmetic (no
float decides a flag), reported ratios are rounded to 6 places, and
nothing about the run itself (time, paths, hostnames) is emitted.

Inputs
------

`analyze --events events.json` — the same JSON extract of chain events the
scorer reads; the schema is documented in
`scripts/field_receipts_score.py`'s module docstring, and this script
reuses that loader, so validation and the (tx_version, event_index) total
order are identical. `--rules` pins the same frozen rules file and is
reported by SHA-256, because the rule-vs-statistics delta is only
meaningful against a named rule.

The graph
---------

Nodes are accounts that appear in at least one `WitnessAttested` event.
An edge joins two accounts that attested the same witness key; its weight
is the number of witness keys they share. This is a superset of the
corroboration graph the Season 0 rule thresholds on: a corroboration is
only an in-window position-2 attestation, so co-attestation also sees
pairs who pile onto late positions, who attest outside the 7-day window,
and who sit just under the rule's 10-corroboration floor.

What is computed
----------------

* degree distribution — degree (distinct partners) and weighted degree
  (shared keys) per account, plus the histogram;
* connected components — sizes, members, internal density;
* clustering — local clustering coefficient per account, the average over
  accounts of degree >= 2, and global transitivity;
* dense structure — the top-k maximal cliques by (size, internal weight),
  each with its *closure* (share of the members' incident edge weight that
  stays inside the group; closure == 1 is a mutual-only clique), and the
  maximum-average-weight subgraph by greedy peeling (Charikar);
* partner concentration per account — four views: the rule's statistic
  (top <= max_partner_set share of corroborations), the same statistic
  over co-attestation weight, and the closure and edge density of the
  account's closed neighbourhood. The first is what Season 0 thresholds
  on; the last two are what distinguish a closed clique from an account
  that merely has few partners inside a busy neighbourhood;
* timing anomalies — per account, the inter-arrival deltas between its
  attestations (median, modal delta and its share, coefficient of
  variation): near-constant deltas are what a cron job looks like. Per
  pair, the latency between the two accounts' attestations of each shared
  key: a pair that always answers within seconds, or always with the
  *same* latency, is a pair of processes, not a pair of operators.

What is flagged, and by what
----------------------------

`rule_discounted` is `field_receipts_score.detect_cliques` — the frozen
Season 0 rule, imported rather than reimplemented so the two can never
drift.

`statistics_flagged` is this script's method, and it is a stated method,
not a finding: an account carrying at least `--min-signals` of

  closed_neighborhood     weighted degree >= the rule's min_corroborations,
                          and both the closure and the edge density of the
                          account's closed neighbourhood are
                          >= --closure-threshold
  mutual_only_clique      member of a maximal clique of size >= 2 whose
                          closure is exactly 1 and whose internal weight
                          >= the rule's min_corroborations
  automated_interarrival  >= --min-deltas inter-arrival gaps, and either
                          the modal gap holds >= --regularity-threshold of
                          them or their coefficient of variation is
                          <= --cv-threshold
  synchronized_pair       a partner sharing >= --min-shared-keys keys with
                          every latency <= --pair-window-secs, or with an
                          identical latency every time

is flagged. The two structural signals are group-shaped and the two
timing signals are behavioural; requiring two of four is what keeps a
merely small neighborhood from being called a sybil. The thresholds are
this tool's parameters, not protocol parameters — they are arguments so a
reviewer can move them and see the delta move.

Season 0 has not run. There is no real data here: the tool is validated
against synthetic witness graphs with known structure
(test/witness_graph/). The limits of every statistic above, and the
"Findings: awaiting Season 0 data" section, are in
docs/protocol/witness-graph-method.md.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from field_receipts_score import (  # noqa: E402
    DEFAULT_RULES,
    EVENT_WITNESS,
    ScoreInputError,
    _require,
    detect_cliques,
    load_events,
    load_rules,
    replay_onchain,
)

METHOD_GRAPH = (
    "Nodes are accounts appearing in a WitnessAttested event. An edge "
    "joins two accounts that attested the same witness key; its weight is "
    "the number of keys they share. The first attestation of a key by an "
    "account counts; repeats are chain-impossible and are counted in "
    "duplicate_attestations instead. This co-attestation graph is a "
    "superset of the corroboration graph the Season 0 rule thresholds on "
    "(in-window position-2 attestations only)."
)
METHOD_CONCENTRATION = (
    "Four views of the same account. corroboration_top_share is the Season "
    "0 statistic: the share of the account's corroborations held by its "
    "top <= clique.max_partner_set partners (ties by ascending address). "
    "coattestation_top_share is that same statistic over shared-key weight "
    "instead of credited corroborations. neighborhood_closure is the share "
    "of the edge weight incident to the account's closed neighbourhood "
    "({account} + every partner) that stays inside it — 1 means the group "
    "attests nobody else. neighborhood_density is the edge density of that "
    "same group. Closure alone cannot tell a hub's star from a sybil ring "
    "(both are closed if the component is isolated); density alone cannot "
    "tell a clique from a clique embedded in a busy town. The closed-group "
    "signal needs both."
)
METHOD_TIMING = (
    "Per account: gaps between consecutive attestation timestamps, "
    "reported as median, modal gap and the share of gaps equal to it, and "
    "coefficient of variation (sqrt(variance)/mean, exact Fractions "
    "compared, rounded only for display). Per pair: the absolute latency "
    "between the two accounts' attestations of each shared key. Human "
    "operators produce ragged gaps and ragged latencies; schedulers do "
    "not. Neither is proof — see docs/protocol/witness-graph-method.md."
)
METHOD_DELTA = (
    "rule_discounted is field_receipts_score.detect_cliques, imported "
    "unchanged. statistics_flagged is this tool's method: an account "
    "carrying >= min_signals of closed_neighborhood, mutual_only_clique, "
    "automated_interarrival, synchronized_pair. rule_only is what the "
    "frozen rule discounts and the statistics do not (candidate false "
    "positives); statistics_only is what the statistics flag and the "
    "frozen rule misses (candidate false negatives). Neither list is a "
    "verdict about any operator; both are inputs to Season 1 rule drafting."
)

SIGNAL_CLOSED_NEIGHBORHOOD = "closed_neighborhood"
SIGNAL_MUTUAL_ONLY_CLIQUE = "mutual_only_clique"
SIGNAL_AUTOMATED_INTERARRIVAL = "automated_interarrival"
SIGNAL_SYNCHRONIZED_PAIR = "synchronized_pair"

# Bron-Kerbosch is exponential in the worst case; a public event log is an
# adversarial input, so enumeration is budgeted and truncation is reported
# rather than hanging the analysis.
CLIQUE_RECURSION_BUDGET = 200_000


@dataclass(frozen=True)
class Params:
    """Analysis thresholds. Tool parameters, not protocol parameters."""

    top_k: int = 10
    min_shared_keys: int = 5
    pair_window_secs: int = 30
    min_deltas: int = 5
    regularity_threshold: Fraction = Fraction(4, 5)
    cv_threshold: Fraction = Fraction(1, 20)
    closure_threshold: Fraction = Fraction(4, 5)
    min_signals: int = 2

    def as_json(self) -> dict:
        return {
            "top_k": self.top_k,
            "min_shared_keys": self.min_shared_keys,
            "pair_window_secs": self.pair_window_secs,
            "min_deltas": self.min_deltas,
            "regularity_threshold": _round(self.regularity_threshold),
            "cv_threshold": _round(self.cv_threshold),
            "closure_threshold": _round(self.closure_threshold),
            "min_signals": self.min_signals,
        }


def _round(value: Fraction | float, places: int = 6) -> float:
    """Deterministic display value for an exact ratio.

    Thresholds are compared as Fractions; this only ever formats.
    """
    return round(float(value), places)


def _ratio(numerator: int, denominator: int) -> Fraction:
    return Fraction(numerator, denominator) if denominator else Fraction(0)


# ------------------------------------------------------------------- graph


def build_witness_graph(events: list[dict]) -> dict:
    """Build the co-attestation graph from the ordered event log.

    Returns node attestation times, weighted edges with their per-key
    latencies, and the per-key attester lists the edges came from.
    """
    key_attesters: dict[str, list[dict]] = {}
    attestations: dict[str, list[int]] = {}
    seen: set[tuple[str, str]] = set()
    duplicate_attestations = 0

    for event in events:
        if event["type"] != EVENT_WITNESS:
            continue
        data = event["data"]
        key, attester = data["key"], data["attester"]
        if (key, attester) in seen:
            # attest_witness aborts on duplicates; the scorer reports these
            # as discrepancies. The graph counts the first one only.
            duplicate_attestations += 1
            continue
        seen.add((key, attester))
        key_attesters.setdefault(key, []).append({
            "attester": attester,
            "timestamp_unix": event["timestamp_unix"],
            "order": (event["tx_version"], event["event_index"]),
        })
        attestations.setdefault(attester, []).append(event["timestamp_unix"])

    edges: dict[tuple[str, str], dict] = {}
    for key in sorted(key_attesters):
        members = key_attesters[key]
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                first, second = members[i], members[j]
                pair = tuple(sorted((first["attester"], second["attester"])))
                edge = edges.get(pair)
                if edge is None:
                    edge = {"shared_keys": 0, "latencies": [],
                            "leads": {pair[0]: 0, pair[1]: 0}}
                    edges[pair] = edge
                edge["shared_keys"] += 1
                edge["latencies"].append(
                    abs(first["timestamp_unix"] - second["timestamp_unix"]))
                leader = min(
                    (first, second),
                    key=lambda m: (m["timestamp_unix"], m["order"]))["attester"]
                edge["leads"][leader] += 1

    nodes = sorted(attestations)
    adjacency: dict[str, dict[str, int]] = {node: {} for node in nodes}
    for (left, right), edge in edges.items():
        adjacency[left][right] = edge["shared_keys"]
        adjacency[right][left] = edge["shared_keys"]

    return {
        "nodes": nodes,
        "adjacency": adjacency,
        "edges": edges,
        "attestations": {node: sorted(times) for node, times in attestations.items()},
        "key_count": len(key_attesters),
        "duplicate_attestations": duplicate_attestations,
    }


def connected_components(adjacency: dict[str, dict[str, int]]) -> list[list[str]]:
    """Components as sorted member lists, ordered by (-size, first member)."""
    unvisited = set(adjacency)
    components: list[list[str]] = []
    for start in sorted(adjacency):
        if start not in unvisited:
            continue
        stack = [start]
        unvisited.discard(start)
        members = []
        while stack:
            node = stack.pop()
            members.append(node)
            for neighbor in sorted(adjacency[node]):
                if neighbor in unvisited:
                    unvisited.discard(neighbor)
                    stack.append(neighbor)
        components.append(sorted(members))
    components.sort(key=lambda members: (-len(members), members[0]))
    return components


def local_clustering(adjacency: dict[str, dict[str, int]], node: str) -> Fraction:
    """Fraction of the node's neighbour pairs that are themselves joined."""
    neighbors = sorted(adjacency[node])
    degree = len(neighbors)
    if degree < 2:
        return Fraction(0)
    links = 0
    for i in range(degree):
        for j in range(i + 1, degree):
            if neighbors[j] in adjacency[neighbors[i]]:
                links += 1
    return Fraction(2 * links, degree * (degree - 1))


def transitivity(adjacency: dict[str, dict[str, int]]) -> Fraction:
    """3 x triangles / connected triples, over the whole graph."""
    triangles = 0
    triples = 0
    for node in sorted(adjacency):
        neighbors = sorted(adjacency[node])
        degree = len(neighbors)
        triples += degree * (degree - 1) // 2
        for i in range(degree):
            for j in range(i + 1, degree):
                if neighbors[j] in adjacency[neighbors[i]]:
                    triangles += 1
    # Each triangle is counted once per member above, so `triangles` is
    # already 3x the triangle count.
    return _ratio(triangles, triples)


def maximal_cliques(adjacency: dict[str, dict[str, int]]) -> tuple[list[list[str]], bool]:
    """Bron-Kerbosch with pivoting; deterministic order, budgeted depth."""
    neighbors = {node: set(adjacency[node]) for node in adjacency}
    found: list[list[str]] = []
    budget = [CLIQUE_RECURSION_BUDGET]
    truncated = [False]

    def expand(clique: list[str], candidates: set[str], excluded: set[str]) -> None:
        if budget[0] <= 0:
            truncated[0] = True
            return
        budget[0] -= 1
        if not candidates and not excluded:
            if len(clique) >= 2:
                found.append(sorted(clique))
            return
        pivot = max(sorted(candidates | excluded),
                    key=lambda node: len(neighbors[node] & candidates))
        for node in sorted(candidates - neighbors[pivot]):
            expand(clique + [node],
                   candidates & neighbors[node],
                   excluded & neighbors[node])
            candidates = candidates - {node}
            excluded = excluded | {node}
            if budget[0] <= 0:
                truncated[0] = True
                return

    expand([], set(adjacency), set())
    found.sort()
    return found, truncated[0]


def group_weights(adjacency: dict[str, dict[str, int]],
                  group: list[str]) -> tuple[int, int]:
    """(internal weight, incident weight) for a set of accounts.

    Internal counts each inside edge once; incident counts every edge with
    at least one endpoint in the group once.
    """
    members = set(group)
    internal = 0
    incident = 0
    for node in sorted(members):
        for neighbor, weight in sorted(adjacency[node].items()):
            if neighbor in members:
                if node < neighbor:
                    internal += weight
                    incident += weight
            else:
                incident += weight
    return internal, incident


def densest_subgraph(adjacency: dict[str, dict[str, int]]) -> dict:
    """Charikar greedy peeling: maximize internal weight / |S|.

    Repeatedly drop the lowest weighted-degree node (ties by ascending
    address) and keep the best subgraph seen. Deterministic, 1/2-optimal,
    and — unlike clique enumeration — it finds *near*-cliques, which is
    what a sybil group with one honest-looking outside edge looks like.
    """
    if not adjacency:
        return {"accounts": [], "size": 0, "internal_weight": 0, "density": 0.0}
    remaining = {node: dict(neighbors) for node, neighbors in adjacency.items()}
    weighted_degree = {node: sum(neighbors.values())
                       for node, neighbors in remaining.items()}
    total_weight = sum(weighted_degree.values()) // 2
    best = (Fraction(total_weight, len(remaining)), sorted(remaining))
    while len(remaining) > 1:
        victim = min(sorted(remaining), key=lambda node: (weighted_degree[node], node))
        for neighbor, weight in remaining[victim].items():
            remaining[neighbor].pop(victim, None)
            weighted_degree[neighbor] -= weight
            total_weight -= weight
        del remaining[victim]
        del weighted_degree[victim]
        density = Fraction(total_weight, len(remaining))
        if density > best[0]:
            best = (density, sorted(remaining))
    internal, _ = group_weights(adjacency, best[1])
    return {
        "accounts": best[1],
        "size": len(best[1]),
        "internal_weight": internal,
        "density": _round(best[0]),
    }


# ------------------------------------------------------------------ timing


def _median(values: list[int]) -> Fraction:
    ordered = sorted(values)
    n = len(ordered)
    if n == 0:
        return Fraction(0)
    middle = n // 2
    if n % 2:
        return Fraction(ordered[middle])
    return Fraction(ordered[middle - 1] + ordered[middle], 2)


def interarrival_stats(times: list[int], params: Params) -> dict:
    """Regularity of one account's attestation stream."""
    ordered = sorted(times)
    deltas = [later - earlier for earlier, later in zip(ordered, ordered[1:])]
    stats = {
        "attestations": len(times),
        "delta_count": len(deltas),
        "min_delta": min(deltas) if deltas else None,
        "max_delta": max(deltas) if deltas else None,
        "median_delta": _round(_median(deltas)) if deltas else None,
        "modal_delta": None,
        "modal_delta_share": None,
        "delta_cv": None,
        "distinct_deltas": len(set(deltas)),
        "automated": False,
    }
    if not deltas:
        return stats
    counts: dict[int, int] = {}
    for delta in deltas:
        counts[delta] = counts.get(delta, 0) + 1
    modal_delta = min(sorted(counts), key=lambda d: (-counts[d], d))
    modal_share = _ratio(counts[modal_delta], len(deltas))
    mean = _ratio(sum(deltas), len(deltas))
    if mean > 0:
        variance = _ratio(sum((Fraction(d) - mean) ** 2 for d in deltas), len(deltas))
        cv_squared = variance / (mean * mean)
        cv = Fraction(math.isqrt(int(cv_squared * 10 ** 12)), 10 ** 6)
        regular_cv = cv_squared <= params.cv_threshold * params.cv_threshold
    else:
        cv = Fraction(0)
        regular_cv = True
    stats["modal_delta"] = modal_delta
    stats["modal_delta_share"] = _round(modal_share)
    stats["delta_cv"] = _round(cv)
    stats["automated"] = bool(
        len(deltas) >= params.min_deltas
        and (modal_share >= params.regularity_threshold or regular_cv))
    return stats


def pair_timing(pair: tuple[str, str], edge: dict, params: Params) -> dict:
    """Latency profile of one co-attesting pair."""
    latencies = edge["latencies"]
    shared = edge["shared_keys"]
    enough = shared >= params.min_shared_keys
    tight = enough and max(latencies) <= params.pair_window_secs
    constant = enough and len(set(latencies)) == 1
    leads = edge["leads"]
    return {
        "accounts": [pair[0], pair[1]],
        "shared_keys": shared,
        "min_latency_secs": min(latencies),
        "median_latency_secs": _round(_median(latencies)),
        "max_latency_secs": max(latencies),
        "distinct_latencies": len(set(latencies)),
        "lead_share": _round(_ratio(max(leads.values()), shared)),
        "always_within_window": bool(tight),
        "constant_latency": bool(constant),
        "synchronized": bool(tight or constant),
    }


# ---------------------------------------------------------------- analysis


def analyze(events: list[dict], rules: dict, rules_sha256: str,
            params: Params) -> dict:
    graph = build_witness_graph(events)
    adjacency = graph["adjacency"]
    nodes = graph["nodes"]

    replay = replay_onchain(events, rules)
    corroborations = replay["corroborations"]
    rule_discounted = detect_cliques(corroborations, rules)

    clique_rules = rules["clique"]
    max_partner_set = int(clique_rules["max_partner_set"])
    min_weight = int(clique_rules["min_corroborations"])

    # --- components
    components = connected_components(adjacency)
    component_of = {node: index
                    for index, members in enumerate(components)
                    for node in members}
    component_rows = []
    for index, members in enumerate(components):
        internal, _incident = group_weights(adjacency, members)
        size = len(members)
        possible = size * (size - 1) // 2
        edge_count = sum(len(adjacency[node]) for node in members) // 2
        component_rows.append({
            "component": index,
            "size": size,
            "accounts": members,
            "edge_count": edge_count,
            "internal_weight": internal,
            "edge_density": _round(_ratio(edge_count, possible)),
        })

    # --- cliques and dense structure
    cliques, cliques_truncated = maximal_cliques(adjacency)
    clique_rows = []
    mutual_only_members: set[str] = set()
    for members in cliques:
        internal, incident = group_weights(adjacency, members)
        closure = _ratio(internal, incident)
        closed = closure == 1
        if closed and internal >= min_weight:
            mutual_only_members.update(members)
        clique_rows.append({
            "accounts": members,
            "size": len(members),
            "internal_weight": internal,
            "closure": _round(closure),
            "mutual_only": bool(closed),
        })
    clique_rows.sort(key=lambda row: (-row["size"], -row["internal_weight"],
                                      -row["closure"], row["accounts"]))

    # --- per account
    accounts: dict[str, dict] = {}
    degree_counts: dict[int, int] = {}
    clustering_values: list[Fraction] = []
    for node in nodes:
        neighbors = adjacency[node]
        degree = len(neighbors)
        degree_counts[degree] = degree_counts.get(degree, 0) + 1
        weighted_degree = sum(neighbors.values())
        clustering = local_clustering(adjacency, node)
        if degree >= 2:
            clustering_values.append(clustering)

        partner_corroborations = corroborations.get(node, {})
        total_corroborations = sum(partner_corroborations.values())
        top_corroboration_partners = sorted(
            partner_corroborations.items(), key=lambda item: (-item[1], item[0])
        )[:max_partner_set]
        corroboration_share = _ratio(
            sum(count for _, count in top_corroboration_partners),
            total_corroborations)

        top_partners = sorted(
            neighbors.items(), key=lambda item: (-item[1], item[0])
        )[:max_partner_set]
        coattestation_share = _ratio(
            sum(weight for _, weight in top_partners), weighted_degree)
        # Closure and density are computed over the whole closed
        # neighbourhood {node} + every partner. Closure alone cannot tell a
        # star from a ring — an isolated hub's neighbourhood is closed too
        # — so the signal below needs both.
        group = [node] + sorted(neighbors)
        internal, incident = group_weights(adjacency, group)
        closure = _ratio(internal, incident)
        group_edges = sum(
            1 for i, left in enumerate(group) for right in group[i + 1:]
            if right in adjacency[left])
        density = _ratio(group_edges, len(group) * (len(group) - 1) // 2)

        timing = interarrival_stats(graph["attestations"][node], params)

        accounts[node] = {
            "degree": degree,
            "weighted_degree": weighted_degree,
            "attestations": timing["attestations"],
            "corroborations": total_corroborations,
            "clustering": _round(clustering),
            "component": component_of[node],
            "top_partners": [
                {"account": partner, "shared_keys": weight,
                 "corroborations": partner_corroborations.get(partner, 0)}
                for partner, weight in top_partners
            ],
            "partner_concentration": {
                "corroboration_top_share": _round(corroboration_share),
                "coattestation_top_share": _round(coattestation_share),
                "neighborhood_closure": _round(closure),
                "neighborhood_density": _round(density),
            },
            "timing": timing,
            # Filled in below, once pair timing is known.
            "signals": [],
            "rule_discounted": node in rule_discounted,
            "statistics_flagged": False,
            "delta": "none",
        }

        signals = []
        if (weighted_degree >= min_weight
                and closure >= params.closure_threshold
                and density >= params.closure_threshold):
            signals.append(SIGNAL_CLOSED_NEIGHBORHOOD)
        if node in mutual_only_members:
            signals.append(SIGNAL_MUTUAL_ONLY_CLIQUE)
        if timing["automated"]:
            signals.append(SIGNAL_AUTOMATED_INTERARRIVAL)
        accounts[node]["signals"] = signals

    # --- pair timing, and the last signal
    pair_rows = []
    for pair in sorted(graph["edges"]):
        row = pair_timing(pair, graph["edges"][pair], params)
        pair_rows.append(row)
        if row["synchronized"]:
            for account in pair:
                if SIGNAL_SYNCHRONIZED_PAIR not in accounts[account]["signals"]:
                    accounts[account]["signals"].append(SIGNAL_SYNCHRONIZED_PAIR)
    synchronized_pairs = [row for row in pair_rows if row["synchronized"]]
    synchronized_pairs.sort(
        key=lambda row: (-row["shared_keys"], row["max_latency_secs"],
                         row["accounts"]))

    automated_accounts = sorted(
        node for node in nodes if accounts[node]["timing"]["automated"])

    # --- rule vs statistics
    statistics_flagged = set()
    for node in nodes:
        accounts[node]["signals"].sort()
        if len(accounts[node]["signals"]) >= params.min_signals:
            statistics_flagged.add(node)
            accounts[node]["statistics_flagged"] = True
    for node in nodes:
        in_rule = node in rule_discounted
        in_stats = node in statistics_flagged
        accounts[node]["delta"] = (
            "agreement" if in_rule and in_stats else
            "rule_only" if in_rule else
            "statistics_only" if in_stats else
            "none")

    # An account can be discounted by the rule without appearing in the
    # co-attestation graph only if the event log is inconsistent; keep the
    # rule's own list authoritative anyway.
    rule_list = sorted(rule_discounted)
    stats_list = sorted(statistics_flagged)
    agreement = sorted(rule_discounted & statistics_flagged)
    rule_only = sorted(rule_discounted - statistics_flagged)
    statistics_only = sorted(statistics_flagged - rule_discounted)

    edge_count = len(graph["edges"])
    total_weight = sum(edge["shared_keys"] for edge in graph["edges"].values())
    node_count = len(nodes)
    possible_edges = node_count * (node_count - 1) // 2

    return {
        "method": {
            "generator": "scripts/witness_graph_analysis.py analyze",
            "rules_season": rules.get("season"),
            "rules_sha256": rules_sha256,
            "event_count": len(events),
            "witness_event_count": sum(
                1 for event in events if event["type"] == EVENT_WITNESS),
            "witness_key_count": graph["key_count"],
            "duplicate_attestations": graph["duplicate_attestations"],
            "scorer_discrepancy_count": len(replay["discrepancies"]),
            "parameters": params.as_json(),
            "graph_definition": METHOD_GRAPH,
            "concentration_definition": METHOD_CONCENTRATION,
            "timing_definition": METHOD_TIMING,
            "delta_definition": METHOD_DELTA,
            "findings_status": (
                "Season 0 has not run. This output is tooling validated "
                "against synthetic graphs; no finding about any real "
                "operator is claimed. See "
                "docs/protocol/witness-graph-method.md."),
        },
        "graph": {
            "account_count": node_count,
            "edge_count": edge_count,
            "total_edge_weight": total_weight,
            "edge_density": _round(_ratio(edge_count, possible_edges)),
            "isolated_accounts": sorted(
                node for node in nodes if not adjacency[node]),
        },
        "degree_distribution": {
            "histogram": [
                {"degree": degree, "accounts": degree_counts[degree]}
                for degree in sorted(degree_counts)
            ],
            "min": min((accounts[n]["degree"] for n in nodes), default=0),
            "max": max((accounts[n]["degree"] for n in nodes), default=0),
            "median": _round(_median([accounts[n]["degree"] for n in nodes])),
            "mean": _round(_ratio(2 * edge_count, node_count)),
            "max_weighted_degree": max(
                (accounts[n]["weighted_degree"] for n in nodes), default=0),
        },
        "components": component_rows,
        "clustering": {
            "average_local": _round(
                sum(clustering_values, Fraction(0)) / len(clustering_values)
                if clustering_values else Fraction(0)),
            "transitivity": _round(transitivity(adjacency)),
            "accounts_with_degree_ge_2": len(clustering_values),
        },
        "dense_subgraphs": {
            "maximal_clique_count": len(clique_rows),
            "enumeration_truncated": cliques_truncated,
            "top_cliques": clique_rows[:params.top_k],
            "mutual_only_clique_count": sum(
                1 for row in clique_rows if row["mutual_only"]),
            "densest_subgraph": densest_subgraph(adjacency),
        },
        "timing_anomalies": {
            "automated_interarrival_accounts": automated_accounts,
            "synchronized_pair_count": len(synchronized_pairs),
            "top_synchronized_pairs": synchronized_pairs[:params.top_k],
        },
        "rule_vs_statistics": {
            "counts": {
                "rule_discounted": len(rule_list),
                "statistics_flagged": len(stats_list),
                "agreement": len(agreement),
                "rule_only": len(rule_only),
                "statistics_only": len(statistics_only),
            },
            "rule_discounted": rule_list,
            "statistics_flagged": stats_list,
            "agreement": agreement,
            "rule_only": rule_only,
            "statistics_only": statistics_only,
        },
        "accounts": accounts,
    }


# ---------------------------------------------------------------- markdown


def render_markdown(output: dict) -> str:
    method = output["method"]
    graph = output["graph"]
    degrees = output["degree_distribution"]
    delta = output["rule_vs_statistics"]
    accounts = output["accounts"]
    top_k = method["parameters"]["top_k"]

    lines = [
        "# Witness graph analysis",
        "",
        f"Co-attestation graph over {method['witness_event_count']} witness "
        f"attestations of {method['witness_key_count']} keys by "
        f"{graph['account_count']} accounts, against rules "
        f"`{method['rules_season']}` (sha256 "
        f"`{method['rules_sha256'][:16]}…`). Generated by "
        f"`{method['generator']}`; re-run it to dispute it.",
        "",
        f"**{method['findings_status']}**",
        "",
        "## Graph",
        "",
        f"- accounts: {graph['account_count']} "
        f"({len(graph['isolated_accounts'])} with no co-attestation partner)",
        f"- edges: {graph['edge_count']}, total weight "
        f"{graph['total_edge_weight']}, density {graph['edge_density']}",
        f"- degree: min {degrees['min']}, median {degrees['median']}, "
        f"mean {degrees['mean']}, max {degrees['max']}",
        f"- clustering: average local "
        f"{output['clustering']['average_local']}, transitivity "
        f"{output['clustering']['transitivity']}",
        f"- components: {len(output['components'])} "
        f"(largest {output['components'][0]['size'] if output['components'] else 0})",
        "",
        "### Degree distribution",
        "",
        "| Degree | Accounts |",
        "| ---: | ---: |",
    ]
    for row in degrees["histogram"]:
        lines.append(f"| {row['degree']} | {row['accounts']} |")

    lines += [
        "",
        "## Components",
        "",
        "| # | Size | Edges | Internal weight | Density |",
        "| ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in output["components"][:top_k]:
        lines.append(
            f"| {row['component']} | {row['size']} | {row['edge_count']} "
            f"| {row['internal_weight']} | {row['edge_density']} |")

    dense = output["dense_subgraphs"]
    lines += [
        "",
        "## Dense subgraphs",
        "",
        f"{dense['maximal_clique_count']} maximal cliques of size >= 2, "
        f"{dense['mutual_only_clique_count']} of them mutual-only "
        f"(closure 1: the members attest nobody else)."
        + (" Enumeration hit its budget and is truncated."
           if dense["enumeration_truncated"] else ""),
        "",
        "| Clique | Size | Internal weight | Closure | Mutual-only |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for row in dense["top_cliques"]:
        members = ", ".join(f"`{a}`" for a in row["accounts"])
        lines.append(
            f"| {members} | {row['size']} | {row['internal_weight']} "
            f"| {row['closure']} | {'yes' if row['mutual_only'] else 'no'} |")
    densest = dense["densest_subgraph"]
    lines += [
        "",
        f"Densest subgraph (greedy peeling): {densest['size']} accounts, "
        f"internal weight {densest['internal_weight']}, "
        f"weight/account {densest['density']}.",
        "",
        "## Partner concentration",
        "",
        "The Season 0 rule thresholds on the first numeric column; the "
        "rest is what the co-attestation graph adds.",
        "",
        "| Account | Corrob. | Rule top-share | Co-att. top-share | "
        "Closure | Density |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    by_concentration = sorted(
        accounts.items(),
        key=lambda item: (-item[1]["corroborations"],
                          -item[1]["partner_concentration"][
                              "corroboration_top_share"],
                          item[0]))
    for account, entry in by_concentration[:top_k]:
        concentration = entry["partner_concentration"]
        lines.append(
            f"| `{account}` | {entry['corroborations']} "
            f"| {concentration['corroboration_top_share']} "
            f"| {concentration['coattestation_top_share']} "
            f"| {concentration['neighborhood_closure']} "
            f"| {concentration['neighborhood_density']} |")

    timing = output["timing_anomalies"]
    lines += [
        "",
        "## Timing anomalies",
        "",
        f"{len(timing['automated_interarrival_accounts'])} accounts attest "
        f"on near-constant intervals; {timing['synchronized_pair_count']} "
        f"pairs answer each other on a machine's schedule.",
        "",
        "Near-constant inter-arrival: "
        + (", ".join(f"`{account}`" for account in
                     timing["automated_interarrival_accounts"][:top_k])
           + ("…" if len(timing["automated_interarrival_accounts"]) > top_k
              else "")
           if timing["automated_interarrival_accounts"] else "none"),
        "",
        "| Pair | Shared keys | Median latency | Max latency | Distinct "
        "latencies |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for row in timing["top_synchronized_pairs"]:
        left, right = row["accounts"]
        lines.append(
            f"| `{left}` + `{right}` | {row['shared_keys']} "
            f"| {row['median_latency_secs']} | {row['max_latency_secs']} "
            f"| {row['distinct_latencies']} |")

    lines += [
        "",
        "## The frozen rule vs the statistics",
        "",
        f"- rule discounts: {delta['counts']['rule_discounted']}",
        f"- statistics flag: {delta['counts']['statistics_flagged']}",
        f"- both agree: {delta['counts']['agreement']}",
        f"- **rule only** (candidate false positives): "
        f"{delta['counts']['rule_only']}",
        f"- **statistics only** (candidate false negatives): "
        f"{delta['counts']['statistics_only']}",
        "",
        "| Account | Verdict | Corrob. | Rule top-share | Closure | Density "
        "| Signals |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    interesting = [account for account in sorted(accounts)
                   if accounts[account]["delta"] != "none"]
    for account in interesting:
        entry = accounts[account]
        concentration = entry["partner_concentration"]
        signals = ", ".join(entry["signals"]) or "—"
        lines.append(
            f"| `{account}` | {entry['delta']} | {entry['corroborations']} "
            f"| {concentration['corroboration_top_share']} "
            f"| {concentration['neighborhood_closure']} "
            f"| {concentration['neighborhood_density']} | {signals} |")

    lines += [
        "",
        "Neither column is a verdict about an operator. `rule_only` and "
        "`statistics_only` are the two error directions of a frozen "
        "threshold, and the input to Season 1's rules — the method, its "
        "limits, and the awaiting-data findings section are in "
        "`docs/protocol/witness-graph-method.md`.",
    ]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------- cli


def command_analyze(args: argparse.Namespace) -> int:
    rules, rules_sha256 = load_rules(args.rules)
    events = load_events(args.events)
    _require(args.top_k >= 1, "--top-k must be >= 1")
    _require(args.min_signals >= 1, "--min-signals must be >= 1")
    _require(args.min_shared_keys >= 1, "--min-shared-keys must be >= 1")
    _require(args.min_deltas >= 1, "--min-deltas must be >= 1")
    _require(args.pair_window_secs >= 0, "--pair-window-secs must be >= 0")
    for name, value in (("--regularity-threshold", args.regularity_threshold),
                        ("--cv-threshold", args.cv_threshold),
                        ("--closure-threshold", args.closure_threshold)):
        _require(0 <= value <= 1, f"{name} must be between 0 and 1")
    params = Params(
        top_k=args.top_k,
        min_shared_keys=args.min_shared_keys,
        pair_window_secs=args.pair_window_secs,
        min_deltas=args.min_deltas,
        regularity_threshold=Fraction(str(args.regularity_threshold)),
        cv_threshold=Fraction(str(args.cv_threshold)),
        closure_threshold=Fraction(str(args.closure_threshold)),
        min_signals=args.min_signals,
    )
    output = analyze(events, rules, rules_sha256, params)
    if args.markdown:
        sys.stdout.write(render_markdown(output))
    else:
        sys.stdout.write(json.dumps(output, indent=2, sort_keys=True) + "\n")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze the Field Receipts witness co-attestation graph "
        "for sybil structure, and diff the frozen Season 0 clique rule "
        "against richer statistics."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    analyze_cmd = commands.add_parser(
        "analyze",
        help="build the witness graph and print deterministic statistics as "
        "JSON (or --markdown for the readable report)",
    )
    analyze_cmd.add_argument(
        "--events", type=Path, required=True,
        help="JSON extract of chain events (same schema as the scorer)")
    analyze_cmd.add_argument(
        "--rules", type=Path, default=DEFAULT_RULES,
        help="pinned season rules JSON (default: docs/protocol/"
        "season-0-rules.json, the Season 0 freeze)")
    analyze_cmd.add_argument(
        "--top-k", type=int, default=10,
        help="how many cliques, components and pairs to list (default 10)")
    analyze_cmd.add_argument(
        "--min-shared-keys", type=int, default=5,
        help="pairs below this many shared keys are never called "
        "synchronized (default 5)")
    analyze_cmd.add_argument(
        "--pair-window-secs", type=int, default=30,
        help="a pair whose every co-attestation lands within this many "
        "seconds is synchronized (default 30)")
    analyze_cmd.add_argument(
        "--min-deltas", type=int, default=5,
        help="accounts with fewer inter-arrival gaps than this are never "
        "called automated (default 5)")
    analyze_cmd.add_argument(
        "--regularity-threshold", type=float, default=0.8,
        help="share of gaps equal to the modal gap that reads as automated "
        "(default 0.8)")
    analyze_cmd.add_argument(
        "--cv-threshold", type=float, default=0.05,
        help="coefficient of variation of gaps at or below which the stream "
        "reads as automated (default 0.05)")
    analyze_cmd.add_argument(
        "--closure-threshold", type=float, default=0.8,
        help="closure AND edge density of a closed neighbourhood at or "
        "above which the group reads as a closed clique (default 0.8)")
    analyze_cmd.add_argument(
        "--min-signals", type=int, default=2,
        help="how many of the four signals flag an account (default 2)")
    analyze_cmd.add_argument(
        "--markdown", action="store_true",
        help="emit the human-readable report instead of JSON")
    analyze_cmd.set_defaults(func=command_analyze)

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return args.func(args)
    except ScoreInputError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except (OSError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
