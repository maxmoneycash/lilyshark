/**
 * The COVERAGE screen's bundled example — SYNTHETIC, not season data.
 *
 * Season 0 opens 2026-10-01 (docs/protocol/season-0.md), so no real cells
 * exist yet. These four documents are what the published scorer printed for
 * an invented ten-capture season around the geohash-5 cell `u4pru`
 * (Skagen, Denmark) — the same cell the geohash cross-check vector uses.
 * They were produced by running the real script over invented inputs:
 *
 *   python3 scripts/field_receipts_score.py score \
 *     --events events.json --cells cells.json
 *   python3 scripts/field_receipts_score.py most-wanted \
 *     --events events.json --cells cells.json --limit 12
 *
 * so the shapes are the scorer's own, byte for byte, including the
 * rules_sha256 pin of docs/protocol/season-0-rules.json. What is invented
 * is only the chain events and the sidecar records they were run over: no
 * account here exists, no capture here was ever anchored, and nobody walked
 * any of these cells. Every screen that shows this data labels it with
 * EXAMPLE_LABEL, and the label is never dropped for brevity.
 *
 * The example exists to make the empty screen explicable, not to stand in
 * for a season. When Season 0 data is published, load that instead.
 */

/** Shown wherever a byte of the example reaches the screen. */
export const EXAMPLE_LABEL = "SYNTHETIC EXAMPLE \u00b7 NOT SEASON DATA";

/** Documents in the order the loader should ingest them. */
export interface ExampleDocument {
	name: string;
	doc: unknown;
}

/** Invented chain events: ten CaptureRegistered anchors plus the anchor-point claims they justify. */
export const EXAMPLE_EVENTS = {
	events: [
		{
			data: {
				blob_name: "capture-0000.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee00",
				expires_at_unix: 1767052800,
				publisher: "0xa1fa",
				size_bytes: 120000,
			},
			event_index: 0,
			timestamp_unix: 1759276800,
			tx_version: 1007,
			type: "CaptureRegistered",
		},
		{
			data: {
				blob_name: "capture-0001.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee01",
				expires_at_unix: 1767052800,
				publisher: "0xb4a0",
				size_bytes: 121100,
			},
			event_index: 0,
			timestamp_unix: 1759363200,
			tx_version: 1014,
			type: "CaptureRegistered",
		},
		{
			data: {
				blob_name: "capture-0002.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee02",
				expires_at_unix: 1767052800,
				publisher: "0xa1fa",
				size_bytes: 122200,
			},
			event_index: 0,
			timestamp_unix: 1759449600,
			tx_version: 1021,
			type: "CaptureRegistered",
		},
		{
			data: {
				blob_name: "capture-0003.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee03",
				expires_at_unix: 1767052800,
				publisher: "0xb4a0",
				size_bytes: 123300,
			},
			event_index: 0,
			timestamp_unix: 1759536000,
			tx_version: 1028,
			type: "CaptureRegistered",
		},
		{
			data: {
				blob_name: "capture-0004.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee04",
				expires_at_unix: 1767052800,
				publisher: "0xb4a0",
				size_bytes: 124400,
			},
			event_index: 0,
			timestamp_unix: 1759622400,
			tx_version: 1035,
			type: "CaptureRegistered",
		},
		{
			data: {
				blob_name: "capture-0005.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee05",
				expires_at_unix: 1767052800,
				publisher: "0xa1fa",
				size_bytes: 125500,
			},
			event_index: 0,
			timestamp_unix: 1759708800,
			tx_version: 1042,
			type: "CaptureRegistered",
		},
		{
			data: {
				blob_name: "capture-0006.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee06",
				expires_at_unix: 1767052800,
				publisher: "0xde17a",
				size_bytes: 126600,
			},
			event_index: 0,
			timestamp_unix: 1759795200,
			tx_version: 1049,
			type: "CaptureRegistered",
		},
		{
			data: {
				blob_name: "capture-0007.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee07",
				expires_at_unix: 1767052800,
				publisher: "0xa1fa",
				size_bytes: 127700,
			},
			event_index: 0,
			timestamp_unix: 1759881600,
			tx_version: 1056,
			type: "CaptureRegistered",
		},
		{
			data: {
				blob_name: "capture-0008.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee08",
				expires_at_unix: 1767052800,
				publisher: "0xb4a0",
				size_bytes: 128800,
			},
			event_index: 0,
			timestamp_unix: 1759968000,
			tx_version: 1063,
			type: "CaptureRegistered",
		},
		{
			data: {
				blob_name: "capture-0009.lscap",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee09",
				expires_at_unix: 1767052800,
				publisher: "0xde17a",
				size_bytes: 129900,
			},
			event_index: 0,
			timestamp_unix: 1760054400,
			tx_version: 1070,
			type: "CaptureRegistered",
		},
		{
			data: {
				account: "0xa1fa",
				amount: 40,
				kind: 0,
			},
			event_index: 0,
			timestamp_unix: 1762732800,
			tx_version: 1077,
			type: "PointsAwarded",
		},
		{
			data: {
				account: "0xb4a0",
				amount: 40,
				kind: 0,
			},
			event_index: 0,
			timestamp_unix: 1762732801,
			tx_version: 1084,
			type: "PointsAwarded",
		},
		{
			data: {
				account: "0xde17a",
				amount: 20,
				kind: 0,
			},
			event_index: 0,
			timestamp_unix: 1762732802,
			tx_version: 1091,
			type: "PointsAwarded",
		},
	],
} as const;

/** Invented capture sidecar metadata, the scorer's --cells input. */
export const EXAMPLE_CELL_RECORDS = {
	records: [
		{
			band: "eu868",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee00",
			geohash5: "u4pru",
			iso_week: "2026-W40",
			publisher: "0xa1fa",
		},
		{
			band: "eu868",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee01",
			geohash5: "u4pru",
			iso_week: "2026-W41",
			publisher: "0xb4a0",
		},
		{
			band: "eu868",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee02",
			geohash5: "u4pru",
			iso_week: "2026-W44",
			publisher: "0xa1fa",
		},
		{
			band: "eu868",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee03",
			geohash5: "u4prv",
			iso_week: "2026-W41",
			publisher: "0xb4a0",
		},
		{
			band: "eu868",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee04",
			geohash5: "u4prv",
			iso_week: "2026-W44",
			publisher: "0xb4a0",
		},
		{
			band: "eu868",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee05",
			geohash5: "u4prt",
			iso_week: "2026-W40",
			publisher: "0xa1fa",
		},
		{
			band: "eu868",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee06",
			geohash5: "u4prs",
			iso_week: "2026-W43",
			publisher: "0xde17a",
		},
		{
			band: "eu868",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee07",
			geohash5: "u4prg",
			iso_week: "2026-W42",
			publisher: "0xa1fa",
		},
		{
			band: "eu868",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee08",
			geohash5: "u4r2h",
			iso_week: "2026-W44",
			publisher: "0xb4a0",
		},
		{
			band: "eu433",
			commitment:
				"00000000000000000000000000000000000000000000000000000000c0ffee09",
			geohash5: "u4pru",
			iso_week: "2026-W44",
			publisher: "0xde17a",
		},
	],
} as const;

/** scripts/field_receipts_score.py score over the two documents above. */
export const EXAMPLE_SCORE = {
	discrepancies: [],
	method: {
		cell_algorithm:
			"A cell is geohash-5 x band x ISO week. A sidecar record is verified iff its (publisher, commitment) matches a CaptureRegistered event. Per geohash-5 x band, verified weeks are processed in ascending ISO-week order; week k (0-based count of earlier verified weeks in the input for that cell) credits floor(first_discovery_bonus / 2^k) to the publisher of the week's first verified record in deterministic order (anchor tx_version, event_index, then commitment) \u2014 one credit per cell per ISO week.",
		cell_record_count: 10,
		clique_algorithm:
			"A corroboration is an in-window position-2 attestation, owned by both members of the pair with the other as partner. For each account with >= clique.min_corroborations corroborations, its top <= clique.max_partner_set partners by corroboration count (ties broken by ascending address) are summed; if their share is >= clique.concentration_threshold, the account's recomputed witness points are multiplied by clique.witness_discount in standings. On-chain totals are never modified.",
		discrepancy_count: 0,
		event_count: 13,
		event_time_range_unix: [1759276800, 1762732802],
		onchain_recompute:
			"On-chain points are recomputed by replaying WitnessAttested events in (tx_version, event_index) order against the field_points logic: position 1 credits 0; position 2 inside the attestation window credits points_witness_corroboration to both the opener and the corroborator; positions late_witness_positions[0]..late_witness_positions[1] inside the window credit points_late_witness; anything later or outside the window credits 0. Anchor points are the account's PointsAwarded kind-0 claims, capped at points_per_anchor x its CaptureRegistered count. Event 'credited'/'amount' fields are cross-checked only; every disagreement is a discrepancy and standings use the recomputed values.",
		rules_season: "season-0",
		rules_sha256:
			"09c89fec73974732fbe6136f9803fa65dc352d2bdbeeeb17f48a3890909d0139",
		scorer: "scripts/field_receipts_score.py",
		tx_version_range: [1007, 1091],
	},
	standings: {
		"0xa1fa": {
			cell_points: 26,
			clique_discount_applied: false,
			onchain_points: {
				anchor: 40,
				total: 40,
				witness: 0,
			},
			season_total: 66,
			witness_points_standings: 0,
		},
		"0xb4a0": {
			cell_points: 24,
			clique_discount_applied: false,
			onchain_points: {
				anchor: 40,
				total: 40,
				witness: 0,
			},
			season_total: 64,
			witness_points_standings: 0,
		},
		"0xde17a": {
			cell_points: 16,
			clique_discount_applied: false,
			onchain_points: {
				anchor: 20,
				total: 20,
				witness: 0,
			},
			season_total: 36,
			witness_points_standings: 0,
		},
	},
} as const;

/** scripts/field_receipts_score.py most-wanted over the same inputs. */
export const EXAMPLE_MOST_WANTED = {
	method: {
		active_cell_count: 6,
		as_of_week: "2026-W44",
		generator: "scripts/field_receipts_score.py most-wanted",
		rules_season: "season-0",
		rules_sha256:
			"09c89fec73974732fbe6136f9803fa65dc352d2bdbeeeb17f48a3890909d0139",
		stale_after_weeks: 4,
		verified_cell_count: 7,
	},
	most_wanted: [
		{
			adjacent_active_cells: 3,
			band: "eu868",
			geohash5: "u4pre",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 3,
			band: "eu868",
			geohash5: "u4r25",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 3,
			band: "eu868",
			geohash5: "u4r2j",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 3,
			band: "eu868",
			geohash5: "u4prt",
			last_surveyed_week: "2026-W40",
		},
		{
			adjacent_active_cells: 1,
			band: "eu868",
			geohash5: "u4pr7",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 1,
			band: "eu868",
			geohash5: "u4prd",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 1,
			band: "eu433",
			geohash5: "u4pre",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 1,
			band: "eu868",
			geohash5: "u4prf",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 1,
			band: "eu433",
			geohash5: "u4prg",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 1,
			band: "eu868",
			geohash5: "u4prk",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 1,
			band: "eu868",
			geohash5: "u4prm",
			last_surveyed_week: null,
		},
		{
			adjacent_active_cells: 1,
			band: "eu433",
			geohash5: "u4prs",
			last_surveyed_week: null,
		},
	],
} as const;

export const EXAMPLE_DOCUMENTS: ExampleDocument[] = [
	{ name: "example-events.json", doc: EXAMPLE_EVENTS },
	{ name: "example-cells.json", doc: EXAMPLE_CELL_RECORDS },
	{ name: "example-score.json", doc: EXAMPLE_SCORE },
	{ name: "example-most-wanted.json", doc: EXAMPLE_MOST_WANTED },
];
