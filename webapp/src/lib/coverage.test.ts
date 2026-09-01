/**
 * coverage.ts against the Python scorer.
 *
 * The bundled example in coverageExample.ts is real output of
 * scripts/field_receipts_score.py over invented inputs, so the two halves
 * of that file cross-check each other here: the model this module folds out
 * of the scorer's *inputs* has to agree with the counts and the ranking the
 * scorer itself published in its *outputs* (active_cell_count,
 * verified_cell_count, and the order of the most_wanted array).
 *
 * The ISO-week expectations come from the scorer too:
 *
 *   python3 -c "import sys; sys.path.insert(0,'scripts'); \
 *     import field_receipts_score as f; print(f._week_index('2026-W40'))"
 *   -> 105698
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	buildCoverage,
	type CellRecord,
	CoverageInputError,
	cellKey,
	classifyDocument,
	DEFAULT_STALE_AFTER_WEEKS,
	densityOpacity,
	densityStep,
	isoWeekIndex,
	isoWeeksBetween,
	type MostWantedRow,
	parseAnchors,
	parseCellRecords,
	parseMostWanted,
	parseScore,
	rankMostWanted,
	recencyBucket,
	SEASON_0,
} from "./coverage.ts";
import {
	EXAMPLE_CELL_RECORDS,
	EXAMPLE_EVENTS,
	EXAMPLE_LABEL,
	EXAMPLE_MOST_WANTED,
	EXAMPLE_SCORE,
} from "./coverageExample.ts";

/* ── ISO weeks ───────────────────────────────────────────────────────── */

test("isoWeekIndex matches the scorer's _week_index", () => {
	// f._week_index(<key>) for each.
	const PYTHON: Record<string, number> = {
		"1970-W01": 102737,
		"2020-W53": 105398,
		"2025-W52": 105658,
		"2026-W01": 105659,
		"2026-W40": 105698,
		"2026-W41": 105699,
		"2026-W44": 105702,
		"2026-W53": 105711,
		"2027-W01": 105712,
	};
	for (const [week, index] of Object.entries(PYTHON)) {
		assert.equal(isoWeekIndex(week), index, week);
	}
	assert.equal(isoWeeksBetween("2026-W40", "2026-W44"), 4);
	assert.equal(isoWeeksBetween("2026-W53", "2027-W01"), 1);
});

test("a week that does not exist is refused, the way Python refuses it", () => {
	// f._week_index('2025-W53') raises ValueError: Invalid week: 53
	assert.throws(() => isoWeekIndex("2025-W53"), CoverageInputError);
	assert.throws(() => isoWeekIndex("2026-W54"), CoverageInputError);
	assert.throws(() => isoWeekIndex("2026-W00"), CoverageInputError);
	assert.throws(() => isoWeekIndex("2026-40"), CoverageInputError);
	assert.throws(() => isoWeekIndex(""), CoverageInputError);
	// 2026 really does have 53 ISO weeks, and Season 0 ends inside it.
	assert.equal(typeof isoWeekIndex("2026-W53"), "number");
});

/* ── documents ───────────────────────────────────────────────────────── */

test("each scorer document is recognised by its own keys", () => {
	assert.equal(classifyDocument(EXAMPLE_SCORE), "score");
	assert.equal(classifyDocument(EXAMPLE_MOST_WANTED), "most-wanted");
	assert.equal(classifyDocument(EXAMPLE_CELL_RECORDS), "cell-records");
	assert.equal(classifyDocument(EXAMPLE_EVENTS), "events");
});

test("an unknown document is refused rather than guessed at", () => {
	assert.throws(() => classifyDocument({ hello: 1 }), CoverageInputError);
	assert.throws(() => classifyDocument([1, 2]), CoverageInputError);
	assert.throws(() => classifyDocument("{}"), CoverageInputError);
});

test("cell records parse, and a malformed one names its field", () => {
	const records = parseCellRecords(EXAMPLE_CELL_RECORDS);
	assert.equal(records.length, 10);
	assert.deepEqual(records[0], {
		publisher: "0xa1fa",
		commitment:
			"00000000000000000000000000000000000000000000000000000000c0ffee00",
		geohash5: "u4pru",
		band: "eu868",
		isoWeek: "2026-W40",
	});
	assert.throws(
		() => parseCellRecords({ records: [{ ...records[0], geohash5: "u4pr" }] }),
		/geohash5/,
	);
	// 'a' is not in the geohash alphabet: five characters is not enough.
	assert.throws(
		() => parseCellRecords({ records: [{ ...records[0], geohash5: "u4pra" }] }),
		/geohash5/,
	);
	assert.throws(() => parseCellRecords({ records: [{}] }), CoverageInputError);
	assert.throws(() => parseCellRecords({}), CoverageInputError);
});

test("the anchor index is the CaptureRegistered stream, first write wins", () => {
	const anchors = parseAnchors(EXAMPLE_EVENTS);
	assert.equal(anchors.size, 10);
	const first = anchors.get(
		"00000000000000000000000000000000000000000000000000000000c0ffee00",
	);
	assert.deepEqual(first, {
		txVersion: 1007,
		eventIndex: 0,
		publisher: "0xa1fa",
	});
	// Out-of-order events still index by (tx_version, event_index), and a
	// second anchor of the same commitment never displaces the first.
	const doc = {
		events: [
			{
				type: "CaptureRegistered",
				tx_version: 9,
				event_index: 0,
				data: { publisher: "0xbb", commitment: "ff" },
			},
			{
				type: "CaptureRegistered",
				tx_version: 2,
				event_index: 1,
				data: { publisher: "0xaa", commitment: "ff" },
			},
			{ type: "PointsAwarded", tx_version: 1, data: { account: "0xaa" } },
		],
	};
	assert.equal(parseAnchors(doc).get("ff")?.publisher, "0xaa");
	assert.throws(() => parseAnchors({ events: {} }), CoverageInputError);
});

test("the score output parses into ranked standings", () => {
	const score = parseScore(EXAMPLE_SCORE);
	assert.equal(score.discrepancyCount, 0);
	assert.equal(score.eventCount, 13);
	assert.equal(score.cellRecordCount, 10);
	assert.equal(score.rulesSeason, "season-0");
	assert.equal(score.standings.length, 3);
	assert.equal(score.standings[0].account, "0xa1fa");
	assert.equal(score.standings[0].cellPoints, 26);
	assert.equal(score.standings[0].seasonTotal, 66);
	assert.ok(
		score.standings[0].seasonTotal >= score.standings[1].seasonTotal,
		"standings must come out ranked",
	);
});

test("the most-wanted output parses with its method block", () => {
	const wanted = parseMostWanted(EXAMPLE_MOST_WANTED);
	assert.equal(wanted.asOfWeek, "2026-W44");
	assert.equal(wanted.staleAfterWeeks, DEFAULT_STALE_AFTER_WEEKS);
	assert.equal(wanted.activeCellCount, 6);
	assert.equal(wanted.verifiedCellCount, 7);
	assert.equal(wanted.rows.length, 12);
	assert.deepEqual(wanted.rows[0], {
		geohash5: "u4pre",
		band: "eu868",
		adjacentActiveCells: 3,
		lastSurveyedWeek: null,
	});
	assert.throws(() => parseMostWanted({ most_wanted: [] }), /as_of_week/);
	assert.throws(
		() =>
			parseMostWanted({
				method: { as_of_week: "2026-W44" },
				most_wanted: [
					{ geohash5: "u4pra", band: "eu868", adjacent_active_cells: 1 },
				],
			}),
		/geohash5/,
	);
});

/* ── the model ───────────────────────────────────────────────────────── */

const records = parseCellRecords(EXAMPLE_CELL_RECORDS);
const anchors = parseAnchors(EXAMPLE_EVENTS);
const mostWanted = parseMostWanted(EXAMPLE_MOST_WANTED);
const model = buildCoverage({ records, anchors, mostWanted });

test("the model's cell counts agree with the scorer's own method block", () => {
	assert.equal(model.cells.length, mostWanted.verifiedCellCount);
	assert.equal(model.activeCells, mostWanted.activeCellCount);
	assert.equal(model.asOfWeek, "2026-W44");
	assert.equal(model.verification, "anchored");
	assert.equal(model.unanchoredRecords, 0);
	assert.deepEqual(model.bands, ["eu433", "eu868"]);
});

test("a cell carries its first surveyor, last week and adjacency", () => {
	const cell = model.cells.find((c) => c.key === cellKey("u4pru", "eu868"));
	assert.ok(cell);
	assert.equal(cell.observations, 3);
	assert.deepEqual(cell.weeks, ["2026-W40", "2026-W41", "2026-W44"]);
	assert.equal(cell.firstWeek, "2026-W40");
	assert.equal(cell.lastWeek, "2026-W44");
	// The scorer credits the first verified capture of the earliest week.
	assert.equal(cell.firstSurveyedBy, "0xa1fa");
	assert.equal(cell.staleWeeks, 0);
	assert.equal(cell.active, true);
	assert.equal(cell.recency, "current");
	assert.equal(cell.density, 2);
	// u4prg, u4prs, u4prv and u4r2h are the active ones of its eight.
	assert.equal(cell.adjacentActiveCells, 4);
});

test("a cell past the staleness threshold stops being active", () => {
	const cell = model.cells.find((c) => c.key === cellKey("u4prt", "eu868"));
	assert.ok(cell);
	assert.equal(cell.lastWeek, "2026-W40");
	assert.equal(cell.staleWeeks, 4);
	assert.equal(cell.active, false);
	assert.equal(cell.recency, "stale");
	// …and it is exactly the cell the scorer put on the wanted list with a
	// last_surveyed_week instead of a null.
	const wanted = model.wanted.find((w) => w.geohash5 === "u4prt");
	assert.equal(wanted?.lastSurveyedWeek, "2026-W40");
	assert.equal(wanted?.staleWeeks, 4);
});

test("a record whose capture was never anchored earns no cell", () => {
	const forged: CellRecord[] = [
		...records,
		{
			publisher: "0xdecoy",
			commitment: "".padStart(64, "e"),
			geohash5: "u4r25",
			band: "eu868",
			isoWeek: "2026-W44",
		},
	];
	const forgedModel = buildCoverage({ records: forged, anchors, mostWanted });
	assert.equal(forgedModel.unanchoredRecords, 1);
	assert.equal(forgedModel.cells.length, model.cells.length);
	assert.ok(!forgedModel.cells.some((c) => c.geohash5 === "u4r25"));
	// The same record with the publisher swapped under a real anchor is
	// refused too: the anchor's publisher has to match.
	const stolen = buildCoverage({
		records: [{ ...records[0], publisher: "0xdecoy" }],
		anchors,
		mostWanted,
	});
	assert.equal(stolen.unanchoredRecords, 1);
	assert.equal(stolen.cells.length, 0);
});

test("with no events document nothing is called verified", () => {
	const unchecked = buildCoverage({ records, mostWanted });
	assert.equal(unchecked.verification, "unchecked");
	assert.equal(unchecked.cells.length, 7);
	for (const cell of unchecked.cells) {
		assert.equal(
			cell.firstSurveyedBy,
			null,
			"attribution needs the anchor index, so it stays unattributed",
		);
	}
});

test("an empty model invents nothing", () => {
	const empty = buildCoverage({});
	assert.deepEqual(empty.cells, []);
	assert.deepEqual(empty.wanted, []);
	assert.equal(empty.asOfWeek, null);
	assert.equal(empty.activeCells, 0);
	assert.equal(empty.staleAfterWeeks, DEFAULT_STALE_AFTER_WEEKS);
});

/* ── ranking ─────────────────────────────────────────────────────────── */

test("the ranking reproduces the published most_wanted order", () => {
	const published = mostWanted.rows.map((r) => `${r.geohash5}/${r.band}`);
	assert.deepEqual(
		model.wanted.map((r) => `${r.geohash5}/${r.band}`),
		published,
	);
	assert.deepEqual(
		model.wanted.map((r) => r.rank),
		published.map((_, i) => i + 1),
	);
});

test("the ranking is the file's order however the rows arrive", () => {
	const shuffled = [...mostWanted.rows].reverse();
	assert.deepEqual(
		rankMostWanted(shuffled, mostWanted.asOfWeek).map((r) => r.geohash5),
		model.wanted.map((r) => r.geohash5),
	);
});

test("adjacency wins, then never-surveyed, then the stalest", () => {
	const rows: MostWantedRow[] = [
		{
			geohash5: "b0000",
			band: "b",
			adjacentActiveCells: 1,
			lastSurveyedWeek: null,
		},
		{
			geohash5: "c0000",
			band: "b",
			adjacentActiveCells: 3,
			lastSurveyedWeek: "2026-W43",
		},
		{
			geohash5: "d0000",
			band: "b",
			adjacentActiveCells: 1,
			lastSurveyedWeek: "2026-W40",
		},
		{
			geohash5: "e0000",
			band: "b",
			adjacentActiveCells: 1,
			lastSurveyedWeek: "2026-W42",
		},
	];
	assert.deepEqual(
		rankMostWanted(rows, "2026-W44").map((r) => r.geohash5),
		["c0000", "b0000", "d0000", "e0000"],
	);
	// Without an as-of week no staleness can be computed, so it is not
	// pretended: the surveyed rows fall back to geohash order.
	assert.deepEqual(
		rankMostWanted(rows, null).map((r) => r.staleWeeks),
		[null, null, null, null],
	);
});

/* ── colour scale ────────────────────────────────────────────────────── */

test("recency buckets hinge on the scorer's staleness threshold", () => {
	assert.equal(recencyBucket(0, 4), "current");
	assert.equal(recencyBucket(1, 4), "recent");
	assert.equal(recencyBucket(2, 4), "aging");
	assert.equal(recencyBucket(3, 4), "aging");
	assert.equal(recencyBucket(4, 4), "stale");
	assert.equal(recencyBucket(40, 4), "stale");
	// A different --stale-after-weeks moves every boundary with it.
	assert.equal(recencyBucket(1, 2), "aging");
	assert.equal(recencyBucket(2, 2), "stale");
	assert.equal(recencyBucket(3, 12), "recent");
	assert.equal(recencyBucket(11, 12), "aging");
});

test("density steps are coarse, and their opacity rises with them", () => {
	assert.equal(densityStep(1), 0);
	assert.equal(densityStep(2), 1);
	assert.equal(densityStep(3), 2);
	assert.equal(densityStep(4), 2);
	assert.equal(densityStep(5), 3);
	assert.equal(densityStep(500), 3);
	const opacities = [0, 1, 2, 3].map((s) => densityOpacity(s as 0 | 1 | 2 | 3));
	for (let i = 1; i < opacities.length; i++) {
		assert.ok(opacities[i] > opacities[i - 1], "opacity has to rise");
		assert.ok(opacities[i] <= 0.6, "a fill must not hide the map under it");
	}
});

/* ── what the screen must keep saying ────────────────────────────────── */

const screen = readFileSync(
	new URL("../mesh/screens/Coverage.tsx", import.meta.url),
	"utf8",
);

test("the screen states that Season 0 has not opened", () => {
	assert.equal(SEASON_0.opensUtc, "2026-10-01");
	assert.match(screen, /NO SEASON DATA/);
	assert.match(screen, /SEASON_0\.opensUtc/);
	assert.match(screen, /does not invent cells/);
});

test("the screen states why the cells are coarse", () => {
	assert.match(screen, /geohash-5/);
	assert.match(screen, /privacy/i);
	assert.match(screen, /no per-frame GPS/i);
});

test("the screen labels the example everywhere it appears", () => {
	assert.equal(EXAMPLE_LABEL, "SYNTHETIC EXAMPLE · NOT SEASON DATA");
	assert.match(screen, /EXAMPLE_LABEL/);
	// The badge rides on the source list, the map and the wanted list, so a
	// reader cannot see the example's cells without seeing what they are.
	const uses = screen.match(/EXAMPLE_LABEL/g) ?? [];
	assert.ok(uses.length >= 3, `EXAMPLE_LABEL used ${uses.length} times`);
});
