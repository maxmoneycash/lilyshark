#!/usr/bin/env python3
"""Season scorer for Field Receipts: deterministic, reproducible, public.

The trust model of Field Receipts (docs/protocol/field-receipts.md) is
"disputes are settled by re-running the scorer". This script is that
scorer for Season 0. It consumes only public inputs and a pinned rules
file, and two runs on the same inputs are byte-identical: all output keys
are sorted, event order is a total order derived from the chain
(tx_version, event_index), and nothing about the run itself (timestamps,
paths, hostnames) is emitted.

Every scoring constant comes from docs/protocol/season-0-rules.json, the
machine-readable freeze of docs/protocol/season-0.md; the output's
`method` block pins that file by SHA-256 so a dispute can verify both
sides ran the same rules.

Inputs
------

`score --events events.json` — a JSON extract of the season's chain
events. The schema mirrors the on-chain event structs
(contracts/field-points/sources/field_points.move and
contracts/capture-registry/sources/capture_registry.move) plus the
ordering fields every Aptos event carries:

    {
      "events": [
        {
          "type": "WitnessAttested" | "PointsAwarded" | "CaptureRegistered",
          "tx_version": <int>,        # transaction version on chain
          "event_index": <int>,       # position within the transaction
          "timestamp_unix": <int>,    # chain time of the transaction
          "data": { ... }             # the Move struct's fields
        }, ...
      ]
    }

    WitnessAttested.data:   {"key": <64 hex>, "attester": "0x..",
                             "position": <int>, "credited": <int>}
    PointsAwarded.data:     {"account": "0x..", "kind": 0|1|2,
                             "amount": <int>}   # 0 anchor, 1 witness, 2 late
    CaptureRegistered.data: {"publisher": "0x..", "commitment": <64 hex>,
                             "blob_name": <str>, "size_bytes": <int>,
                             "expires_at_unix": <int>}

Events are sorted by (tx_version, event_index) before replay, so the
file's own ordering never matters; duplicate (tx_version, event_index)
pairs are rejected because they would break the total order.

`--cells cells.json` (optional) — capture sidecar metadata for cell
scoring, one record per capture whose GPS context has been read:

    {
      "records": [
        {"publisher": "0x..", "commitment": <64 hex>,
         "geohash5": <5 chars>, "band": <str>, "iso_week": "YYYY-Www"}, ...
      ]
    }

In production these records come from fetching each anchored blob,
verifying it against its on-chain commitment, and reading the GPS context
inside — that fetch pipeline is out of scope here (it needs the deployed
chain, task CO-002). The scorer still cross-checks each record against
the event log: a record whose (publisher, commitment) was never anchored
by a CaptureRegistered event is not "verified" and earns nothing (it is
reported in `discrepancies`).

On-chain points are recomputed, not mirrored
--------------------------------------------

The replay recomputes every credit from the module's frozen logic
(position, attestation window) and ignores the `credited` and `amount`
fields except to cross-check them: any disagreement between what the
chain emitted and what the rules imply lands in the output's
`discrepancies` list, and standings always use the recomputed values.

Clique down-weighting (docs/protocol/season-0.md)
-------------------------------------------------

A corroboration is an in-window position-2 attestation; it belongs to
both members of the pair, each with the other as partner. For each
account with >= `clique.min_corroborations` corroborations, take its top
<= `clique.max_partner_set` partners by corroboration count (ties broken
by ascending address); if they account for >= `clique.concentration_threshold`
of the account's corroborations, the account's recomputed witness points
(corroboration + late-witness) are multiplied by `clique.witness_discount`
in season standings. On-chain totals are never modified.

`fetch` exists only as a stub: live event fetching is out of scope until
the module is deployed (CO-002).
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import sys
from fractions import Fraction
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RULES = REPO_ROOT / "docs" / "protocol" / "season-0-rules.json"

EVENT_WITNESS = "WitnessAttested"
EVENT_POINTS = "PointsAwarded"
EVENT_CAPTURE = "CaptureRegistered"
EVENT_TYPES = (EVENT_WITNESS, EVENT_POINTS, EVENT_CAPTURE)

# PointsAwarded.kind values, from field_points.move.
KIND_ANCHOR = 0
KIND_WITNESS = 1
KIND_LATE_WITNESS = 2

ISO_WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")
HEX32_RE = re.compile(r"^[0-9a-f]{64}$")

METHOD_ONCHAIN = (
    "On-chain points are recomputed by replaying WitnessAttested events in "
    "(tx_version, event_index) order against the field_points logic: "
    "position 1 credits 0; position 2 inside the attestation window credits "
    "points_witness_corroboration to both the opener and the corroborator; "
    "positions late_witness_positions[0]..late_witness_positions[1] inside "
    "the window credit points_late_witness; anything later or outside the "
    "window credits 0. Anchor points are the account's PointsAwarded "
    "kind-0 claims, capped at points_per_anchor x its CaptureRegistered "
    "count. Event 'credited'/'amount' fields are cross-checked only; every "
    "disagreement is a discrepancy and standings use the recomputed values."
)
METHOD_CLIQUE = (
    "A corroboration is an in-window position-2 attestation, owned by both "
    "members of the pair with the other as partner. For each account with "
    ">= clique.min_corroborations corroborations, its top <= "
    "clique.max_partner_set partners by corroboration count (ties broken by "
    "ascending address) are summed; if their share is >= "
    "clique.concentration_threshold, the account's recomputed witness "
    "points are multiplied by clique.witness_discount in standings. "
    "On-chain totals are never modified."
)
METHOD_CELLS = (
    "A cell is geohash-5 x band x ISO week. A sidecar record is verified "
    "iff its (publisher, commitment) matches a CaptureRegistered event. "
    "Per geohash-5 x band, verified weeks are processed in ascending "
    "ISO-week order; week k (0-based count of earlier verified weeks in "
    "the input for that cell) credits floor(first_discovery_bonus / 2^k) "
    "to the publisher of the week's first verified record in deterministic "
    "order (anchor tx_version, event_index, then commitment) — one credit "
    "per cell per ISO week."
)


class ScoreInputError(ValueError):
    """A malformed input file; the message says which field and why."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ScoreInputError(message)


def _address(value: object, where: str) -> str:
    _require(isinstance(value, str) and value.startswith("0x") and len(value) > 2,
             f"{where}: address must be a 0x-prefixed hex string, got {value!r}")
    address = str(value).lower()
    _require(all(c in "0123456789abcdef" for c in address[2:]),
             f"{where}: address is not hex: {value!r}")
    return address


def _hex32(value: object, where: str) -> str:
    _require(isinstance(value, str), f"{where}: expected 64 hex chars, got {value!r}")
    lowered = str(value).lower()
    _require(bool(HEX32_RE.match(lowered)),
             f"{where}: expected 64 hex chars (32 bytes), got {value!r}")
    return lowered


def _int(value: object, where: str) -> int:
    _require(isinstance(value, int) and not isinstance(value, bool),
             f"{where}: expected an integer, got {value!r}")
    return int(value)


def load_rules(path: Path) -> tuple[dict, str]:
    """Load the pinned rules file and return (rules, sha256 of its bytes)."""
    raw = path.read_bytes()
    rules = json.loads(raw.decode("utf-8"))
    for section, keys in (
        ("onchain", ("points_witness_corroboration", "points_late_witness",
                     "late_witness_positions", "max_credited_attesters",
                     "witness_window_secs", "points_per_anchor")),
        ("cells", ("first_discovery_bonus", "weekly_cap_credits_per_cell")),
        ("clique", ("min_corroborations", "max_partner_set",
                    "concentration_threshold", "witness_discount")),
    ):
        _require(section in rules, f"rules file missing section {section!r}")
        for key in keys:
            _require(key in rules[section],
                     f"rules file missing {section}.{key}")
    return rules, hashlib.sha256(raw).hexdigest()


def load_events(path: Path) -> list[dict]:
    """Load, validate, and totally order the chain event extract."""
    document = json.loads(path.read_text(encoding="utf-8"))
    _require(isinstance(document, dict) and isinstance(document.get("events"), list),
             "events file must be an object with an 'events' array")
    events = []
    seen_order: set[tuple[int, int]] = set()
    for index, raw in enumerate(document["events"]):
        where = f"events[{index}]"
        _require(isinstance(raw, dict), f"{where}: expected an object")
        event_type = raw.get("type")
        _require(event_type in EVENT_TYPES,
                 f"{where}: type must be one of {EVENT_TYPES}, got {event_type!r}")
        tx_version = _int(raw.get("tx_version"), f"{where}.tx_version")
        event_index = _int(raw.get("event_index", 0), f"{where}.event_index")
        timestamp = _int(raw.get("timestamp_unix"), f"{where}.timestamp_unix")
        data = raw.get("data")
        _require(isinstance(data, dict), f"{where}.data: expected an object")
        order = (tx_version, event_index)
        _require(order not in seen_order,
                 f"{where}: duplicate (tx_version, event_index) {order} breaks "
                 "the total order")
        seen_order.add(order)

        parsed: dict[str, object]
        if event_type == EVENT_WITNESS:
            parsed = {
                "key": _hex32(data.get("key"), f"{where}.data.key"),
                "attester": _address(data.get("attester"), f"{where}.data.attester"),
                "position": _int(data.get("position"), f"{where}.data.position"),
                "credited": _int(data.get("credited"), f"{where}.data.credited"),
            }
        elif event_type == EVENT_POINTS:
            parsed = {
                "account": _address(data.get("account"), f"{where}.data.account"),
                "kind": _int(data.get("kind"), f"{where}.data.kind"),
                "amount": _int(data.get("amount"), f"{where}.data.amount"),
            }
        else:
            parsed = {
                "publisher": _address(data.get("publisher"), f"{where}.data.publisher"),
                "commitment": _hex32(data.get("commitment"), f"{where}.data.commitment"),
            }
        events.append({
            "type": event_type,
            "tx_version": tx_version,
            "event_index": event_index,
            "timestamp_unix": timestamp,
            "data": parsed,
        })
    events.sort(key=lambda e: (e["tx_version"], e["event_index"]))
    return events


def load_cell_records(path: Path) -> list[dict]:
    document = json.loads(path.read_text(encoding="utf-8"))
    _require(isinstance(document, dict) and isinstance(document.get("records"), list),
             "cells file must be an object with a 'records' array")
    records = []
    for index, raw in enumerate(document["records"]):
        where = f"records[{index}]"
        _require(isinstance(raw, dict), f"{where}: expected an object")
        geohash5 = raw.get("geohash5")
        _require(isinstance(geohash5, str) and len(geohash5) == 5,
                 f"{where}.geohash5: expected a 5-character geohash, got {geohash5!r}")
        band = raw.get("band")
        _require(isinstance(band, str) and band != "",
                 f"{where}.band: expected a non-empty string, got {band!r}")
        iso_week = raw.get("iso_week")
        _require(isinstance(iso_week, str) and bool(ISO_WEEK_RE.match(iso_week)),
                 f"{where}.iso_week: expected 'YYYY-Www', got {iso_week!r}")
        records.append({
            "publisher": _address(raw.get("publisher"), f"{where}.publisher"),
            "commitment": _hex32(raw.get("commitment"), f"{where}.commitment"),
            "geohash5": geohash5,
            "band": band,
            "iso_week": iso_week,
        })
    return records


def replay_onchain(events: list[dict], rules: dict) -> dict:
    """Recompute every on-chain credit from the event log alone.

    Returns per-account recomputed points, the corroboration graph for
    clique detection, the anchor index for cell verification, and the
    discrepancies between recomputation and what the chain emitted.
    """
    onchain = rules["onchain"]
    points_witness = int(onchain["points_witness_corroboration"])
    points_late = int(onchain["points_late_witness"])
    late_low, late_high = (int(v) for v in onchain["late_witness_positions"])
    max_credited = int(onchain["max_credited_attesters"])
    window_secs = int(onchain["witness_window_secs"])
    points_per_anchor = int(onchain["points_per_anchor"])
    assert late_high == max_credited and late_low == 3, (
        "rules onchain section is internally inconsistent")

    witness_state: dict[str, dict] = {}       # key -> {first_at, attesters}
    witness_points: dict[str, int] = {}       # account -> recomputed 25s + 5s
    corroborations: dict[str, dict[str, int]] = {}  # account -> partner -> n
    awarded: dict[str, dict[int, int]] = {}   # account -> kind -> summed amount
    registered: dict[str, int] = {}           # publisher -> anchor count
    anchors: dict[str, tuple] = {}            # commitment -> first anchor
    participants: set[str] = set()            # every address seen in any event
    discrepancies: list[dict] = []

    def credit(account: str, amount: int) -> None:
        witness_points[account] = witness_points.get(account, 0) + amount

    for event in events:
        data = event["data"]
        if event["type"] == EVENT_CAPTURE:
            publisher = data["publisher"]
            participants.add(publisher)
            registered[publisher] = registered.get(publisher, 0) + 1
            anchors.setdefault(
                data["commitment"],
                (event["tx_version"], event["event_index"], publisher),
            )
            continue
        if event["type"] == EVENT_POINTS:
            account = data["account"]
            participants.add(account)
            kind = data["kind"]
            if kind not in (KIND_ANCHOR, KIND_WITNESS, KIND_LATE_WITNESS):
                discrepancies.append({
                    "type": "unknown_points_kind",
                    "account": account,
                    "kind": kind,
                    "tx_version": event["tx_version"],
                })
                continue
            if kind == KIND_ANCHOR and data["amount"] % points_per_anchor != 0:
                discrepancies.append({
                    "type": "anchor_amount_not_multiple",
                    "account": account,
                    "amount": data["amount"],
                    "points_per_anchor": points_per_anchor,
                    "tx_version": event["tx_version"],
                })
            per_account = awarded.setdefault(account, {})
            per_account[kind] = per_account.get(kind, 0) + data["amount"]
            continue

        # WitnessAttested: replay the module's logic, then cross-check the
        # event's own position/credited fields against the recomputation.
        key = data["key"]
        attester = data["attester"]
        participants.add(attester)
        state = witness_state.get(key)
        if state is None:
            state = {"first_at": event["timestamp_unix"], "attesters": []}
            witness_state[key] = state
        if attester in state["attesters"]:
            # attest_witness aborts on duplicates; a duplicate in the log
            # is chain data the module could not have produced.
            discrepancies.append({
                "type": "witness_duplicate_attester",
                "key": key,
                "attester": attester,
                "tx_version": event["tx_version"],
            })
            continue
        state["attesters"].append(attester)
        position = len(state["attesters"])
        in_window = event["timestamp_unix"] <= state["first_at"] + window_secs

        if position == 1:
            recomputed = 0
        elif not in_window or position > max_credited:
            recomputed = 0
        elif position == 2:
            recomputed = points_witness
            opener = state["attesters"][0]
            credit(opener, points_witness)
            credit(attester, points_witness)
            corroborations.setdefault(opener, {})[attester] = (
                corroborations.setdefault(opener, {}).get(attester, 0) + 1)
            corroborations.setdefault(attester, {})[opener] = (
                corroborations.setdefault(attester, {}).get(opener, 0) + 1)
        else:
            recomputed = points_late
            credit(attester, points_late)

        if data["position"] != position:
            discrepancies.append({
                "type": "witness_position_mismatch",
                "key": key,
                "attester": attester,
                "event_position": data["position"],
                "recomputed_position": position,
                "tx_version": event["tx_version"],
            })
        if data["credited"] != recomputed:
            discrepancies.append({
                "type": "witness_credited_mismatch",
                "key": key,
                "attester": attester,
                "event_credited": data["credited"],
                "recomputed_credited": recomputed,
                "tx_version": event["tx_version"],
            })

    # Cross-check the PointsAwarded stream against the replay. The replay
    # is authoritative; the emitted amounts are only evidence to audit.
    per_account_witness_awarded: dict[str, int] = {}
    anchor_points: dict[str, int] = {}
    # Every address seen in any event gets a standings row, so an account
    # whose activity all recomputed to zero still shows up as zero rather
    # than vanishing from the published table.
    accounts = participants | set(witness_points) | set(awarded) | set(registered)
    for account in sorted(accounts):
        kinds = awarded.get(account, {})
        emitted_witness = kinds.get(KIND_WITNESS, 0) + kinds.get(KIND_LATE_WITNESS, 0)
        recomputed_witness = witness_points.get(account, 0)
        per_account_witness_awarded[account] = emitted_witness
        if emitted_witness != recomputed_witness:
            discrepancies.append({
                "type": "witness_points_awarded_mismatch",
                "account": account,
                "events_sum": emitted_witness,
                "recomputed": recomputed_witness,
            })
        claimed = kinds.get(KIND_ANCHOR, 0)
        max_claimable = registered.get(account, 0) * points_per_anchor
        if claimed > max_claimable:
            discrepancies.append({
                "type": "anchor_overclaim",
                "account": account,
                "claimed": claimed,
                "max_claimable": max_claimable,
            })
        anchor_points[account] = min(claimed, max_claimable)

    return {
        "witness_points": witness_points,
        "anchor_points": anchor_points,
        "corroborations": corroborations,
        "anchors": anchors,
        "accounts": accounts,
        "discrepancies": discrepancies,
    }


def detect_cliques(corroborations: dict[str, dict[str, int]], rules: dict) -> set[str]:
    """Return the accounts whose witness points get the standings discount.

    Algorithm (docs/protocol/season-0.md, 'Closed witness cliques'): an
    account with >= min_corroborations corroborations is discounted iff
    its top <= max_partner_set partners (by corroboration count, ties
    broken by ascending address for determinism) hold >= the
    concentration threshold of its corroborations. Exact arithmetic via
    Fraction — no float comparison decides a discount.
    """
    clique = rules["clique"]
    min_corroborations = int(clique["min_corroborations"])
    max_partner_set = int(clique["max_partner_set"])
    threshold = Fraction(str(clique["concentration_threshold"]))
    discounted: set[str] = set()
    for account, partners in corroborations.items():
        total = sum(partners.values())
        if total < min_corroborations:
            continue
        top = sorted(partners.items(), key=lambda item: (-item[1], item[0]))
        top_sum = sum(count for _, count in top[:max_partner_set])
        if Fraction(top_sum, total) >= threshold:
            discounted.add(account)
    return discounted


def score_cells(records: list[dict], anchors: dict[str, tuple], rules: dict) -> dict:
    """Score cell first-discovery bonuses with decay and the weekly cap."""
    first_bonus = int(rules["cells"]["first_discovery_bonus"])
    cell_points: dict[str, int] = {}
    discrepancies: list[dict] = []
    # (geohash5, band) -> iso_week -> list of (order tuple, publisher)
    cells: dict[tuple[str, str], dict[str, list]] = {}
    seen: set[tuple] = set()

    for record in records:
        dedup = (record["commitment"], record["publisher"], record["geohash5"],
                 record["band"], record["iso_week"])
        if dedup in seen:
            continue
        seen.add(dedup)
        anchor = anchors.get(record["commitment"])
        if anchor is None or anchor[2] != record["publisher"]:
            discrepancies.append({
                "type": "cell_capture_not_anchored",
                "commitment": record["commitment"],
                "publisher": record["publisher"],
            })
            continue
        order = (anchor[0], anchor[1], record["commitment"])
        cells.setdefault((record["geohash5"], record["band"]), {}) \
            .setdefault(record["iso_week"], []).append((order, record["publisher"]))

    for _, weeks in sorted(cells.items()):
        for k, iso_week in enumerate(sorted(weeks)):
            bonus = first_bonus // (2 ** k) if k < first_bonus.bit_length() else 0
            # One credit per cell per ISO week: the first verified capture
            # in deterministic order takes it.
            _, publisher = min(weeks[iso_week])
            if bonus > 0:
                cell_points[publisher] = cell_points.get(publisher, 0) + bonus

    return {"cell_points": cell_points, "discrepancies": discrepancies}


def _as_number(value: Fraction):
    """Emit an exact JSON number: int when integral, else float.

    The only non-integers here are quarter-points (witness x 0.25), which
    binary floats represent exactly, so serialization is deterministic.
    """
    if value.denominator == 1:
        return int(value)
    return float(value)


def build_output(events: list[dict], cell_records: list[dict],
                 rules: dict, rules_sha256: str) -> dict:
    replay = replay_onchain(events, rules)
    discounted = detect_cliques(replay["corroborations"], rules)
    cells = score_cells(cell_records, replay["anchors"], rules)
    discount = Fraction(str(rules["clique"]["witness_discount"]))

    accounts = sorted(replay["accounts"] | set(cells["cell_points"]))
    standings = {}
    for account in accounts:
        witness = replay["witness_points"].get(account, 0)
        anchor = replay["anchor_points"].get(account, 0)
        cell = cells["cell_points"].get(account, 0)
        applied = account in discounted
        witness_standings = Fraction(witness) * discount if applied else Fraction(witness)
        standings[account] = {
            "onchain_points": {
                "anchor": anchor,
                "witness": witness,
                "total": anchor + witness,
            },
            "cell_points": cell,
            "clique_discount_applied": applied,
            "witness_points_standings": _as_number(witness_standings),
            "season_total": _as_number(witness_standings + anchor + cell),
        }

    discrepancies = replay["discrepancies"] + cells["discrepancies"]
    discrepancies.sort(key=lambda d: json.dumps(d, sort_keys=True))

    method = {
        "scorer": "scripts/field_receipts_score.py",
        "rules_season": rules.get("season"),
        "rules_sha256": rules_sha256,
        "event_count": len(events),
        "cell_record_count": len(cell_records),
        "tx_version_range": (
            [events[0]["tx_version"], events[-1]["tx_version"]] if events else None),
        "event_time_range_unix": (
            [min(e["timestamp_unix"] for e in events),
             max(e["timestamp_unix"] for e in events)] if events else None),
        "onchain_recompute": METHOD_ONCHAIN,
        "clique_algorithm": METHOD_CLIQUE,
        "cell_algorithm": METHOD_CELLS,
        "discrepancy_count": len(discrepancies),
    }
    return {"method": method, "standings": standings, "discrepancies": discrepancies}


def command_score(args: argparse.Namespace) -> int:
    rules, rules_sha256 = load_rules(args.rules)
    events = load_events(args.events)
    cell_records = load_cell_records(args.cells) if args.cells else []
    output = build_output(events, cell_records, rules, rules_sha256)
    sys.stdout.write(json.dumps(output, indent=2, sort_keys=True) + "\n")
    return 0


def command_fetch(args: argparse.Namespace) -> int:
    del args
    print(
        "error: fetch is a stub — live event fetching is out of scope until "
        "field_points is deployed (task CO-002). Query the Aptos indexer "
        "GraphQL for the module's events (lilyshark::field_points::"
        "WitnessAttested / PointsAwarded and lilyshark::capture_registry::"
        "CaptureRegistered), ordered by transaction_version, save them in "
        "the events JSON schema documented in this script's docstring, and "
        "run `score --events <file>`.",
        file=sys.stderr,
    )
    return 2


# ------------------------------------------------------------- most wanted
#
# Flightradar24 publishes "most wanted receiver locations"; Hivemapper's
# live gap map steers drivers to unmapped roads. `most-wanted` is that
# mechanism over Field Receipts data: cells adjacent to verified activity
# that are unsurveyed or stale, ranked so contributors know where a walk
# is worth the most. Deterministic like `score`: same inputs, same bytes.

GEOHASH32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def geohash_decode(geohash: str) -> tuple[float, float, float, float]:
    """Return the (lat_min, lat_max, lon_min, lon_max) box of a geohash."""
    lat = [-90.0, 90.0]
    lon = [-180.0, 180.0]
    even = True
    for ch in geohash:
        idx = GEOHASH32.find(ch)
        _require(idx >= 0, f"invalid geohash character {ch!r} in {geohash!r}")
        for bit in (16, 8, 4, 2, 1):
            rng = lon if even else lat
            mid = (rng[0] + rng[1]) / 2
            if idx & bit:
                rng[0] = mid
            else:
                rng[1] = mid
            even = not even
    return lat[0], lat[1], lon[0], lon[1]


def geohash_encode(lat: float, lon: float, length: int) -> str:
    out = []
    lat_rng = [-90.0, 90.0]
    lon_rng = [-180.0, 180.0]
    even = True
    idx = 0
    bits = 0
    while len(out) < length:
        rng, value = (lon_rng, lon) if even else (lat_rng, lat)
        mid = (rng[0] + rng[1]) / 2
        idx <<= 1
        if value >= mid:
            idx |= 1
            rng[0] = mid
        else:
            rng[1] = mid
        even = not even
        bits += 1
        if bits == 5:
            out.append(GEOHASH32[idx])
            idx = 0
            bits = 0
    return "".join(out)


def geohash_neighbors(geohash: str) -> list[str]:
    """The up-to-8 same-length neighbors, by center-shift re-encoding.

    Longitude wraps at the antimeridian; a shift past a pole is dropped
    rather than clamped, so polar cells report fewer neighbors.
    """
    lat_min, lat_max, lon_min, lon_max = geohash_decode(geohash)
    lat_c = (lat_min + lat_max) / 2
    lon_c = (lon_min + lon_max) / 2
    dlat = lat_max - lat_min
    dlon = lon_max - lon_min
    neighbors = set()
    for step_lat in (-dlat, 0.0, dlat):
        for step_lon in (-dlon, 0.0, dlon):
            if step_lat == 0.0 and step_lon == 0.0:
                continue
            lat = lat_c + step_lat
            if not -90.0 < lat < 90.0:
                continue
            lon = lon_c + step_lon
            if lon >= 180.0:
                lon -= 360.0
            elif lon < -180.0:
                lon += 360.0
            candidate = geohash_encode(lat, lon, len(geohash))
            if candidate != geohash:
                neighbors.add(candidate)
    return sorted(neighbors)


def _week_index(iso_week: str) -> int:
    """Comparable index of an ISO week: ordinal of its Monday // 7."""
    year, week = int(iso_week[:4]), int(iso_week[6:])
    return datetime.date.fromisocalendar(year, week, 1).toordinal() // 7


def build_most_wanted(events: list[dict], cell_records: list[dict],
                      rules: dict, rules_sha256: str,
                      stale_after_weeks: int, as_of_week: str | None,
                      limit: int) -> dict:
    replay = replay_onchain(events, rules)
    anchors = replay["anchors"]

    # Last verified iso_week per (geohash5, band) — verified exactly as
    # score_cells defines it: the record's commitment is anchored by the
    # same publisher.
    last_week: dict[tuple[str, str], str] = {}
    for record in cell_records:
        anchor = anchors.get(record["commitment"])
        if anchor is None or anchor[2] != record["publisher"]:
            continue
        cell = (record["geohash5"], record["band"])
        if cell not in last_week or _week_index(record["iso_week"]) > \
                _week_index(last_week[cell]):
            last_week[cell] = record["iso_week"]

    if as_of_week is None and last_week:
        as_of_week = max(last_week.values(), key=_week_index)
    _require(as_of_week is not None,
             "no verified cell records and no --as-of week given")
    as_of_idx = _week_index(as_of_week)

    def is_active(cell: tuple[str, str]) -> bool:
        week = last_week.get(cell)
        return week is not None and as_of_idx - _week_index(week) < stale_after_weeks

    active = sorted(c for c in last_week if is_active(c))
    wanted: dict[tuple[str, str], int] = {}
    for geohash5, band in active:
        for neighbor in geohash_neighbors(geohash5):
            cell = (neighbor, band)
            if is_active(cell):
                continue
            wanted[cell] = wanted.get(cell, 0) + 1

    def rank(item):
        (geohash5, band), adjacent = item
        week = last_week.get((geohash5, band))
        # Never-surveyed outranks stale at equal adjacency; then stalest.
        surveyed = 0 if week is None else 1
        staleness = 0 if week is None else -(as_of_idx - _week_index(week))
        return (-adjacent, surveyed, staleness, geohash5, band)

    rows = [{
        "geohash5": geohash5,
        "band": band,
        "adjacent_active_cells": adjacent,
        "last_surveyed_week": last_week.get((geohash5, band)),
    } for (geohash5, band), adjacent in sorted(wanted.items(), key=rank)[:limit]]

    return {
        "method": {
            "generator": "scripts/field_receipts_score.py most-wanted",
            "rules_season": rules.get("season"),
            "rules_sha256": rules_sha256,
            "as_of_week": as_of_week,
            "stale_after_weeks": stale_after_weeks,
            "active_cell_count": len(active),
            "verified_cell_count": len(last_week),
        },
        "most_wanted": rows,
    }


def command_most_wanted(args: argparse.Namespace) -> int:
    rules, rules_sha256 = load_rules(args.rules)
    events = load_events(args.events)
    cell_records = load_cell_records(args.cells) if args.cells else []
    _require(args.stale_after_weeks >= 1, "--stale-after-weeks must be >= 1")
    if args.as_of is not None:
        _require(bool(ISO_WEEK_RE.match(args.as_of)),
                 f"--as-of: expected 'YYYY-Www', got {args.as_of!r}")
    output = build_most_wanted(events, cell_records, rules, rules_sha256,
                               args.stale_after_weeks, args.as_of, args.limit)
    if args.markdown:
        method = output["method"]
        lines = [
            f"# Most-wanted cells — week {method['as_of_week']}",
            "",
            f"Cells adjacent to verified activity with no verified capture "
            f"in the last {method['stale_after_weeks']} weeks. Generated by "
            f"`{method['generator']}` from public receipts; re-run it to "
            f"dispute it.",
            "",
            "| Cell | Band | Adjacent active | Last surveyed |",
            "| --- | --- | ---: | --- |",
        ]
        for row in output["most_wanted"]:
            lines.append(
                f"| `{row['geohash5']}` | {row['band']} "
                f"| {row['adjacent_active_cells']} "
                f"| {row['last_surveyed_week'] or 'never'} |")
        sys.stdout.write("\n".join(lines) + "\n")
    else:
        sys.stdout.write(json.dumps(output, indent=2, sort_keys=True) + "\n")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score a Field Receipts season from public chain events."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    score = commands.add_parser(
        "score",
        help="replay events, recompute points, and print deterministic "
        "season standings as JSON",
    )
    score.add_argument(
        "--events", type=Path, required=True,
        help="JSON extract of chain events (schema in the module docstring)",
    )
    score.add_argument(
        "--cells", type=Path, default=None,
        help="optional capture sidecar metadata for cell scoring "
        "(publisher, commitment, geohash5, band, iso_week per record)",
    )
    score.add_argument(
        "--rules", type=Path, default=DEFAULT_RULES,
        help="pinned season rules JSON (default: docs/protocol/"
        "season-0-rules.json, the Season 0 freeze)",
    )
    score.set_defaults(func=command_score)

    wanted = commands.add_parser(
        "most-wanted",
        help="rank unsurveyed or stale cells adjacent to verified activity "
        "(deterministic JSON, or --markdown for the published list)",
    )
    wanted.add_argument("--events", type=Path, required=True,
                        help="JSON extract of chain events")
    wanted.add_argument("--cells", type=Path, default=None,
                        help="capture sidecar metadata (cell records)")
    wanted.add_argument("--rules", type=Path, default=DEFAULT_RULES,
                        help="pinned season rules JSON")
    wanted.add_argument("--stale-after-weeks", type=int, default=4,
                        help="a cell with no verified capture in this many "
                        "weeks counts as wanted (default 4)")
    wanted.add_argument("--as-of", type=str, default=None,
                        help="ISO week 'YYYY-Www' to evaluate at (default: "
                        "the latest verified record's week, for determinism)")
    wanted.add_argument("--limit", type=int, default=50,
                        help="maximum cells listed (default 50)")
    wanted.add_argument("--markdown", action="store_true",
                        help="emit the human-readable list instead of JSON")
    wanted.set_defaults(func=command_most_wanted)

    fetch = commands.add_parser(
        "fetch",
        help="stub: points at the indexer GraphQL; never fetches",
    )
    fetch.set_defaults(func=command_fetch)

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
