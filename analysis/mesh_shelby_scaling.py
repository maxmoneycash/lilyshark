#!/usr/bin/env python3
"""Shelby x LoRa scaling model: how the off-grid relationship plays out over
the next several years.

Three relationships, one script:

  A. Pointer capacity   — how many Shelby pointers a mesh can carry per hour,
                          as the radio architecture improves (flooding today
                          through scheduled access and channel reuse).
  B. Capture storage    — how much .lscap data a Lilyshark fleet lands on
                          Shelby as the fleet grows.
  C. The asymmetry      — airtime consumed per megabyte of blob content the
                          mesh *references*, which is why the design carries
                          an 82-byte pointer instead of the bytes.

Parameters come from published or measured sources wherever possible:

  - R = 7.36 rebroadcast factor for a flooded mesh at realistic density,
    measured against Meshtastic's own discrete-event simulator (the DePIN
    verification report this repo's docs cite; see docs/shelby-off-grid.md).
  - Architecture steps and their R/utilization/channel improvements from the
    same report's scaling ladder.
  - LoRa airtime from the standard symbol-budget equation at LongFast
    (SF11 / 250 kHz / CR 4:5), matching scripts' and the report's preset.
  - The Shelby pointer is 82 bytes (docs/shelby-pointer-format.md).

Everything else is an explicit, labeled assumption at the top of the file —
change the numbers and rerun. This is a model, not a forecast.

Deterministic: no randomness, no wall clock. Writes analysis/results.md and
analysis/chart_*.svg. Python 3.10+, standard library only.
"""

from __future__ import annotations

import math
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent

# ── Radio parameters (LongFast, the busiest Meshtastic preset) ──────────────
SF = 11
BW_HZ = 250_000
CR_DENOM = 5  # coding rate 4/5
PREAMBLE_SYMBOLS = 16  # LongFast preamble
POINTER_BYTES = 82  # docs/shelby-pointer-format.md
LORA_MAX_PAYLOAD = 237  # hard ceiling; ~200 practical

# ── Mesh parameters (measured / published in the DePIN report) ───────────────
NODES_PER_DOMAIN = 30  # working density from the simulation
# (year, label, rebroadcast factor R, usable channel utilization, channels)
ARCH_STEPS = [
    (2025, "managed flood (Meshtastic today)", 7.36, 0.20, 1),
    (2026, "source routing (MeshCore shipped)", 4.0, 0.20, 1),
    (2028, "scheduled access (TDMA/slotted)", 2.2, 0.45, 1),
    (2030, "multi-channel reuse (4 slots)", 2.0, 0.45, 4),
    (2032, "spatial reuse (sector relays)", 1.6, 0.55, 9),
]

# ── Fleet + content assumptions (explicit, tunable) ─────────────────────────
CAPTURES_PER_DEVICE_DAY = 24  # one saved session capture per hour of active use
AVG_CAPTURE_KB = 200  # a field session: thousands of frames with RF metadata
FLEET_SIZES = [10, 100, 1_000, 10_000, 100_000]
YEARS = list(range(2026, 2034))

# ── Shelby-side assumptions ─────────────────────────────────────────────────
AVG_BLOB_KB = 200  # what a pointer usually references: a capture session
GATEWAY_READS_PER_BLOB = 5  # each stored capture is fetched ~5x (analysis, sharing)


# ── LoRa airtime ─────────────────────────────────────────────────────────────
def symbol_ms() -> float:
    return (2**SF) / BW_HZ * 1000.0


def toa_ms(payload_bytes: int, explicit_header: bool = True) -> float:
    """Time on air, standard Semtech symbol budget at SF11/BW250/CR4:5."""
    h = 0 if explicit_header else 1
    de = 1 if (SF >= 11 and BW_HZ == 125_000) else 0  # low-data-rate optimize
    n_sym = 8 + max(
        math.ceil(
            (8 * payload_bytes - 4 * SF + 28 + 16 - 20 * h)
            / (4 * (SF - 2 * de))
        )
        * CR_DENOM,
        0,
    )
    return (PREAMBLE_SYMBOLS + 4.25 + n_sym) * symbol_ms()


def delivered_per_hour(payload_bytes: int, r: float, util: float, channels: int) -> float:
    """Application messages delivered per hour across a collision domain."""
    airtime_s = toa_ms(payload_bytes) / 1000.0
    raw_tx = 3600.0 * util * channels / airtime_s
    return raw_tx / r


# ── Scenario A: pointer capacity ─────────────────────────────────────────────
def scenario_a() -> list[dict[str, object]]:
    rows = []
    for year, label, r, util, ch in ARCH_STEPS:
        ptr_hr = delivered_per_hour(POINTER_BYTES, r, util, ch)
        chat_hr = delivered_per_hour(180, r, util, ch)  # a typical text payload
        rows.append(
            {
                "year": year,
                "label": label,
                "r": r,
                "util": util,
                "channels": ch,
                "pointer_ms": toa_ms(POINTER_BYTES),
                "pointers_per_hour": ptr_hr,
                "pointers_per_day": ptr_hr * 24,
                "chat_msgs_per_hour": chat_hr,
            }
        )
    return rows


# ── Scenario B: capture storage on Shelby ────────────────────────────────────
def scenario_b() -> list[dict[str, object]]:
    rows = []
    gb_per_device_year = CAPTURES_PER_DEVICE_DAY * AVG_CAPTURE_KB * 365 / 1e6
    for fleet in FLEET_SIZES:
        per_year = gb_per_device_year * fleet
        rows.append(
            {
                "fleet": fleet,
                "gb_per_year": per_year,
                "tb_after_3y": per_year * 3 / 1000.0,
                "blobs_per_year": CAPTURES_PER_DEVICE_DAY * 365 * fleet,
                "served_gb_per_year": per_year * GATEWAY_READS_PER_BLOB,
            }
        )
    return rows


# ── Scenario C: the asymmetry ────────────────────────────────────────────────
def scenario_c() -> list[dict[str, object]]:
    """Airtime the mesh spends *referencing* one MB of blob content."""
    blob_bytes = AVG_BLOB_KB * 1000
    rows = []
    for year, label, r, util, ch in ARCH_STEPS:
        # One pointer announces the whole blob; the mesh carries it R times.
        air_s = toa_ms(POINTER_BYTES) / 1000.0 * r
        rows.append(
            {
                "year": year,
                "label": label,
                "airtime_s_per_mb": air_s / (blob_bytes / 1e6),
                "airtime_s_per_blob": air_s,
                "ip_bytes_per_air_byte": blob_bytes / (POINTER_BYTES * r),
            }
        )
    # Baseline for contrast: trying to send the blob itself over the mesh,
    # chopped into max-size frames — the approach the pointer replaces.
    frames = math.ceil(blob_bytes / LORA_MAX_PAYLOAD)
    baseline_s = frames * toa_ms(LORA_MAX_PAYLOAD) / 1000.0 * ARCH_STEPS[0][2]
    return rows, {"frames": frames, "baseline_s": baseline_s}


# ── SVG charts (hand-rolled, no dependencies) ────────────────────────────────
def svg_bars(title: str, series: list[tuple[str, float]], unit: str, color: str) -> str:
    w, h, pad_l, pad_b, pad_t = 720, 380, 90, 70, 44
    peak = max(v for _, v in series) or 1.0
    inner_w, inner_h = w - pad_l - 24, h - pad_t - pad_b
    bar_w = inner_w / len(series) * 0.62
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" font-family="ui-monospace, monospace" font-size="12">',
        f'<rect width="{w}" height="{h}" fill="#120e11"/>',
        f'<text x="{pad_l}" y="26" fill="#ff4f9d" font-size="15">{title}</text>',
    ]
    for frac in (0.25, 0.5, 0.75, 1.0):
        y = pad_t + inner_h * (1 - frac)
        parts.append(
            f'<line x1="{pad_l}" y1="{y:.1f}" x2="{w - 24}" y2="{y:.1f}" '
            f'stroke="#3a2f36" stroke-width="1"/>'
            f'<text x="{pad_l - 8}" y="{y + 4:.1f}" fill="#8b7c85" text-anchor="end">'
            f"{peak * frac:,.0f}</text>"
        )
    for i, (label, v) in enumerate(series):
        x = pad_l + inner_w * (i + 0.5) / len(series) - bar_w / 2
        bh = inner_h * v / peak
        y = pad_t + inner_h - bh
        parts.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{bh:.1f}" '
            f'fill="{color}" opacity="0.9"/>'
            f'<text x="{x + bar_w / 2:.1f}" y="{y - 6:.1f}" fill="#e8dde3" '
            f'text-anchor="middle">{v:,.0f}</text>'
            f'<text x="{x + bar_w / 2:.1f}" y="{pad_t + inner_h + 18:.1f}" '
            f'fill="#8b7c85" text-anchor="middle">{label}</text>'
        )
    parts.append(
        f'<text x="{pad_l}" y="{h - 8}" fill="#8b7c85">{unit}</text></svg>'
    )
    return "\n".join(parts)


def svg_lines(
    title: str,
    xs: list[int],
    lines: list[tuple[str, list[float], str]],
    unit: str,
) -> str:
    w, h, pad_l, pad_b, pad_t = 720, 380, 90, 56, 44
    peak = max(max(vals) for _, vals, _ in lines) or 1.0
    inner_w, inner_h = w - pad_l - 24, h - pad_t - pad_b
    lo, hi = min(xs), max(xs)

    def xy(i: int, v: float) -> tuple[float, float]:
        return (
            pad_l + inner_w * (xs[i] - lo) / (hi - lo),
            pad_t + inner_h * (1 - v / peak),
        )

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" font-family="ui-monospace, monospace" font-size="12">',
        f'<rect width="{w}" height="{h}" fill="#120e11"/>',
        f'<text x="{pad_l}" y="26" fill="#ff4f9d" font-size="15">{title}</text>',
    ]
    for frac in (0.25, 0.5, 0.75, 1.0):
        y = pad_t + inner_h * (1 - frac)
        parts.append(
            f'<line x1="{pad_l}" y1="{y:.1f}" x2="{w - 24}" y2="{y:.1f}" '
            f'stroke="#3a2f36"/>'
            f'<text x="{pad_l - 8}" y="{y + 4:.1f}" fill="#8b7c85" text-anchor="end">'
            f"{peak * frac:,.0f}</text>"
        )
    for i, year in enumerate(xs):
        x, _ = xy(i, 0)
        parts.append(
            f'<text x="{x:.1f}" y="{pad_t + inner_h + 18:.1f}" fill="#8b7c85" '
            f'text-anchor="middle">{year}</text>'
        )
    ly = pad_t + 14
    for label, vals, color in lines:
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (xy(i, v) for i, v in enumerate(vals)))
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2"/>')
        for i, v in enumerate(vals):
            x, y = xy(i, v)
            parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.6" fill="{color}"/>')
        parts.append(f'<text x="{pad_l}" y="{ly}" fill="{color}">▪ {label}</text>')
        ly += 16
    parts.append(f'<text x="{pad_l}" y="{h - 6}" fill="#8b7c85">{unit}</text></svg>')
    return "\n".join(parts)


# ── Report ───────────────────────────────────────────────────────────────────
def fmt(n: float, digits: int = 0) -> str:
    return f"{n:,.{digits}f}"


def build_report() -> str:
    a = scenario_a()
    b = scenario_b()
    c, baseline = scenario_c()

    lines: list[str] = []
    w = lines.append
    w("# Shelby × LoRa: scaling relationships, 2025–2033")
    w("")
    w("Generated by `analysis/mesh_shelby_scaling.py` — a parameterized model,")
    w("not a forecast. Measured inputs: R = 7.36 for a flooded mesh (Meshtastic's")
    w("own simulator), the architecture ladder from the DePIN verification report,")
    w("LongFast airtime from the Semtech symbol budget, and the 82-byte `SHLB`")
    w("pointer from docs/shelby-pointer-format.md. Everything else is a labeled")
    w("assumption at the top of the script.")
    w("")

    w("## A. The mesh can always afford the pointer")
    w("")
    w(f"A pointer is {POINTER_BYTES} bytes — {toa_ms(POINTER_BYTES):,.0f} ms on the air at LongFast. Even")
    w("after the mesh pays its rebroadcast tax, one collision domain carries")
    w("thousands of pointers a day at every step of the architecture ladder:")
    w("")
    w("| Year | Architecture | R | Pointers/hour | Pointers/day | Text msgs/hour |")
    w("| ---: | --- | ---: | ---: | ---: | ---: |")
    for row in a:
        w(
            f"| {row['year']} | {row['label']} | {row['r']} | "
            f"{fmt(row['pointers_per_hour'])} | {fmt(row['pointers_per_day'])} | "
            f"{fmt(row['chat_msgs_per_hour'])} |"
        )
    w("")
    w(f"At {NODES_PER_DOMAIN} nodes per collision domain, a 100,000-node mesh is")
    w(f"~{100_000 // NODES_PER_DOMAIN:,} domains, so even today's flood architecture moves")
    w(f"**{fmt(a[0]['pointers_per_day'] * (100_000 / NODES_PER_DOMAIN) / 1e6, 1)}M pointers a day**")
    w("network-wide. The bottleneck for off-grid Shelby was never announcing the")
    w("blob — it is and remains moving the blob's bytes, which is what gateways")
    w("are for.")
    w("")
    w("![Pointers per day by architecture](chart_pointer_capacity.svg)")
    w("")

    w("## B. Captures accumulate on Shelby")
    w("")
    w(f"Each Lilyshark device saves ~{CAPTURES_PER_DEVICE_DAY} session captures/day at")
    w(f"~{AVG_CAPTURE_KB} KB each (assumptions). Storage is immutable and")
    w("content-addressed, so it only grows; reads multiply it (analysis,")
    w(f"sharing — modeled at {GATEWAY_READS_PER_BLOB} serves per blob):")
    w("")
    w("| Devices | GB written/yr | TB after 3 yrs | Blobs/yr | GB served/yr |")
    w("| ---: | ---: | ---: | ---: | ---: |")
    for row in b:
        w(
            f"| {row['fleet']:,} | {fmt(row['gb_per_year'])} | "
            f"{fmt(row['tb_after_3y'], 2)} | {fmt(row['blobs_per_year'])} | "
            f"{fmt(row['served_gb_per_year'])} |"
        )
    w("")
    w("Shelby compensates *serving*, not idle storage — and a capture archive is")
    w("exactly serve-heavy: small writes, repeated reads by analysts and gateways.")
    w("")
    w("![Capture storage on Shelby by fleet size](chart_shelby_storage.svg)")
    w("")

    w("## C. Why the radio carries a reference, never the payload")
    w("")
    w(f"Announcing one {AVG_BLOB_KB} KB blob costs the mesh one pointer × R")
    w("rebroadcasts. Sending the blob itself would take"
      f" {baseline['frames']} max-size")
    w(f"frames — **{baseline['baseline_s']:,.0f} seconds of shared channel time** under")
    w(f"today's flood, versus {c[0]['airtime_s_per_blob']:.1f} seconds for the pointer.")
    w("The ratio only improves as R falls:")
    w("")
    w("| Year | Architecture | Airtime per blob (s) | Airtime per MB (s) | IP bytes per air byte |")
    w("| ---: | --- | ---: | ---: | ---: |")
    for row in c:
        w(
            f"| {row['year']} | {row['label']} | {fmt(row['airtime_s_per_blob'], 2)} | "
            f"{fmt(row['airtime_s_per_mb'], 1)} | {fmt(row['ip_bytes_per_air_byte'])} |"
        )
    w("")
    w("![Airtime cost per blob referenced](chart_airtime_cost.svg)")
    w("")
    w("The asymmetry is the design: every year the mesh gets better at carrying")
    w("pointers, and nothing makes it better at carrying payloads — airtime stays")
    w("scarce by physics. The 82-byte pointer is the permanent interface; the")
    w("architecture ladder just makes it cheaper to use.")
    w("")
    return "\n".join(lines)


def write_charts() -> None:
    a = scenario_a()
    b = scenario_b()
    c, _ = scenario_c()

    (OUT_DIR / "chart_pointer_capacity.svg").write_text(
        svg_bars(
            "Shelby pointers per day, one collision domain",
            [(str(row["year"]), row["pointers_per_day"]) for row in a],
            "architecture ladder, LongFast SF11/BW250, 82-byte SHLB pointer",
            "#ff4f9d",
        )
    )
    (OUT_DIR / "chart_shelby_storage.svg").write_text(
        svg_lines(
            "Cumulative capture storage on Shelby (TB)",
            YEARS,
            [
                (
                    f"{fleet:,} devices",
                    [
                        CAPTURES_PER_DEVICE_DAY * AVG_CAPTURE_KB * 365 / 1e9 * fleet * (y - 2025)
                        for y in YEARS
                    ],
                    color,
                )
                for fleet, color in zip(
                    FLEET_SIZES, ["#ff4f9d", "#ffb000", "#5ccfe6", "#39ff5a", "#b3a5e3"]
                )
            ],
            "24 captures/device/day at 200 KB (assumptions; linear by construction)",
        )
    )
    baseline = scenario_c()[1]
    (OUT_DIR / "chart_airtime_cost.svg").write_text(
        svg_bars(
            "Shared-channel seconds to reference one 200 KB blob",
            [(str(row["year"]), row["airtime_s_per_blob"]) for row in c],
            f"one 82-byte pointer × R rebroadcasts; the blob itself: ~{baseline['baseline_s']:,.0f} s",
            "#5ccfe6",
        )
    )


def main() -> None:
    (OUT_DIR / "results.md").write_text(build_report())
    write_charts()
    print(f"wrote {OUT_DIR / 'results.md'} and chart_*.svg")


if __name__ == "__main__":
    main()
