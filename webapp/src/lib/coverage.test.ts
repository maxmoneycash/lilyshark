/**
 * coverage.ts — the bucketing, the statistics, and above all the
 * provenance rule.
 *
 * The tests that matter most here are the ones that try to get a measured
 * dB figure onto a cell nothing measured: an internet row and a synthetic
 * sample both carry positions, and both would shade a box exactly like a
 * real reception if the fold let them. Every one of those attempts has a
 * test below that says it must fail.
 *
 * The cell names are the ones geohash.test.ts already pins against
 * scripts/field_receipts_score.py, so a bucketing bug shows up as a wrong
 * cell name rather than as a rectangle nobody checks.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	buildCoverage,
	type CoverageObservation,
	cellProvenance,
	coverageGaps,
	GRADE_FLOOR_DB,
	GRADE_LEGEND,
	GRADE_ORDER,
	geohashLengthForZoom,
	gradeFillOpacity,
	gradeForSnr,
	isPlausibleFix,
	signalStats,
} from "./coverage.ts";
import { encodeGeohash } from "./geohash.ts";

/** Palo Alto, the demo mesh's own coordinate: geohash-5 `9q9jh`. */
const PALO_ALTO = { lat: 37.4419, lon: -122.143 };
/** One cell east, so a two-cell model is a real neighbour pair. */
const NEXT_CELL = { lat: 37.4419, lon: -122.09 };

const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);

function radio(over: Partial<CoverageObservation> = {}): CoverageObservation {
	return {
		...PALO_ALTO,
		atMs: T0,
		provenance: "radio",
		snrDb: 3,
		rssiDbm: -92,
		hops: 0,
		id: 1,
		...over,
	};
}

/* ── fixes ───────────────────────────────────────────────────────────── */

test("the null island is not a fix", () => {
	assert.ok(isPlausibleFix(PALO_ALTO.lat, PALO_ALTO.lon));
	assert.ok(!isPlausibleFix(0, 0));
	assert.ok(!isPlausibleFix(0.05, -0.05));
	assert.ok(!isPlausibleFix(undefined, -122.1));
	assert.ok(!isPlausibleFix(37.44, undefined));
	assert.ok(!isPlausibleFix(Number.NaN, 0));
	assert.ok(!isPlausibleFix(91, 0), "off the globe is not a fix either");
	// A real fix on one axis only still counts: the equator and the prime
	// meridian are places, the origin is the absence of a fix.
	assert.ok(isPlausibleFix(0, 12.5));
	assert.ok(isPlausibleFix(51.5, 0));
});

test("an implausible fix is discarded, not bucketed", () => {
	const model = buildCoverage([
		radio(),
		radio({ lat: 0, lon: 0, id: 2 }),
		radio({ lat: Number.NaN, lon: Number.NaN, id: 3 }),
	]);
	assert.equal(model.discarded, 2);
	assert.equal(model.cells.length, 1);
	assert.equal(model.observations, 1);
});

/* ── bucketing ───────────────────────────────────────────────────────── */

test("observations land in the geohash cell of their coordinate", () => {
	const model = buildCoverage([radio(), radio({ ...NEXT_CELL, id: 2 })]);
	assert.deepEqual(
		model.cells.map((c) => c.geohash),
		["9q9jh", "9q9jj"],
	);
	// f.geohash_encode(37.4419, -122.143, 5) -> '9q9jh' and
	// f.geohash_encode(37.4419, -122.09, 5) -> '9q9jj'.
	assert.equal(encodeGeohash(PALO_ALTO.lat, PALO_ALTO.lon, 5), "9q9jh");
	assert.equal(encodeGeohash(NEXT_CELL.lat, NEXT_CELL.lon, 5), "9q9jj");
});

test("cells come out in a stable order whatever order samples arrived", () => {
	const forward = buildCoverage([
		radio({ ...NEXT_CELL, id: 2 }),
		radio(),
		radio({ lat: 37.8, lon: -122.2, id: 3 }),
	]);
	const backward = buildCoverage([
		radio({ lat: 37.8, lon: -122.2, id: 3 }),
		radio(),
		radio({ ...NEXT_CELL, id: 2 }),
	]);
	assert.deepEqual(
		forward.cells.map((c) => c.geohash),
		backward.cells.map((c) => c.geohash),
	);
	assert.deepEqual(
		forward.cells.map((c) => c.geohash),
		["9q9jh", "9q9jj", "9q9p5"],
	);
});

test("precision decides the cell size, and the count of cells with it", () => {
	const samples = [radio(), radio({ ...NEXT_CELL, id: 2 })];
	assert.equal(buildCoverage(samples, { precision: 5 }).cells.length, 2);
	// At geohash-4 (39 km) both coordinates fall in one box.
	const coarse = buildCoverage(samples, { precision: 4 });
	assert.equal(coarse.cells.length, 1);
	assert.equal(coarse.cells[0].geohash, "9q9j");
	assert.equal(coarse.precision, 4);
});

test("several samples from one node are one source, not one each", () => {
	const model = buildCoverage([
		radio({ atMs: T0 }),
		radio({ atMs: T0 + 60_000 }),
		radio({ atMs: T0 + 120_000, id: 2 }),
	]);
	const cell = model.cells[0];
	assert.equal(cell.observations, 3);
	assert.equal(cell.sources, 2);
	assert.equal(cell.firstHeardMs, T0);
	assert.equal(cell.lastHeardMs, T0 + 120_000);
	assert.equal(model.firstHeardMs, T0);
	assert.equal(model.lastHeardMs, T0 + 120_000);
});

test("a cell counts the samples that came straight off the air", () => {
	const model = buildCoverage([
		radio({ hops: 0 }),
		radio({ hops: 2, id: 2 }),
		radio({ hops: undefined, id: 3 }),
	]);
	assert.equal(model.cells[0].radioObservations, 3);
	assert.equal(model.cells[0].directObservations, 1);
});

/* ── statistics ──────────────────────────────────────────────────────── */

test("signalStats is the plain five-number summary", () => {
	assert.equal(signalStats([]), null);
	assert.deepEqual(signalStats([-5]), {
		count: 1,
		min: -5,
		max: -5,
		mean: -5,
		median: -5,
	});
	assert.deepEqual(signalStats([2, -6, 0, -4]), {
		count: 4,
		min: -6,
		max: 2,
		mean: -2,
		median: -2,
	});
	// Odd counts take the middle sample, not an average of two.
	assert.equal(signalStats([9, 1, 2])?.median, 2);
	assert.equal(signalStats([Number.NaN, 3])?.count, 1);
});

test("a cell's statistics are of its own samples, in dB and dBm", () => {
	const model = buildCoverage([
		radio({ snrDb: -2, rssiDbm: -100 }),
		radio({ snrDb: -8, rssiDbm: -110, id: 2 }),
		radio({ snrDb: 4, rssiDbm: -80, id: 3 }),
	]);
	const cell = model.cells[0];
	assert.equal(cell.snrDb?.count, 3);
	assert.equal(cell.snrDb?.min, -8);
	assert.equal(cell.snrDb?.max, 4);
	assert.equal(cell.snrDb?.median, -2);
	assert.equal(cell.rssiDbm?.max, -80);
	assert.equal(cell.rssiDbm?.min, -110);
	assert.equal(cell.bestSnrDb, 4);
	assert.equal(model.bestSnrDb, 4);
});

test("a cell heard without any SNR figure is heard, not graded", () => {
	const model = buildCoverage([
		radio({ snrDb: undefined, rssiDbm: undefined }),
	]);
	const cell = model.cells[0];
	assert.equal(cell.provenance, "measured");
	assert.equal(cell.snrDb, null);
	assert.equal(cell.bestSnrDb, null);
	assert.equal(cell.grade, null, "no figure must not become a grade");
	assert.equal(model.ungradedMeasuredCells, 1);
	assert.equal(model.bestSnrDb, null);
});

/* ── grades ──────────────────────────────────────────────────────────── */

test("grades sit on the stated dB floors", () => {
	assert.equal(gradeForSnr(12), "strong");
	assert.equal(gradeForSnr(0), "strong");
	assert.equal(gradeForSnr(-0.1), "fair");
	assert.equal(gradeForSnr(-7.5), "fair");
	assert.equal(gradeForSnr(-7.6), "weak");
	assert.equal(gradeForSnr(-15), "weak");
	assert.equal(gradeForSnr(-15.1), "marginal");
	assert.equal(gradeForSnr(-30), "marginal");
});

test("the grade floors descend and every grade states its units", () => {
	let previous = Number.POSITIVE_INFINITY;
	for (const grade of GRADE_ORDER) {
		assert.ok(
			GRADE_FLOOR_DB[grade] < previous,
			`${grade} must sit below the grade above it`,
		);
		previous = GRADE_FLOOR_DB[grade];
		assert.ok(
			GRADE_LEGEND[grade].includes("dB"),
			`${grade}'s legend has to name its unit`,
		);
	}
	assert.equal(GRADE_FLOOR_DB.marginal, Number.NEGATIVE_INFINITY);
});

test("a stronger grade is shaded more heavily, and none of them opaque", () => {
	let previous = 1;
	for (const grade of GRADE_ORDER) {
		const opacity = gradeFillOpacity(grade);
		assert.ok(
			opacity < previous,
			`${grade} must be lighter than the one above`,
		);
		assert.ok(opacity > 0, `${grade} must still be visible`);
		previous = opacity;
	}
	assert.ok(
		gradeFillOpacity("strong") < 0.5,
		"the basemap has to stay readable under the layer",
	);
});

test("a cell is graded on its best measured SNR, not its average", () => {
	// One good reception proves a link is possible; a pile of weak ones does
	// not disprove it, so the strongest sample is what the shading answers.
	const model = buildCoverage([
		radio({ snrDb: -18 }),
		radio({ snrDb: -17, id: 2 }),
		radio({ snrDb: 2, id: 3 }),
	]);
	assert.equal(model.cells[0].grade, "strong");
	assert.equal(model.cells[0].snrDb?.median, -17);
	assert.deepEqual(model.byGrade, { strong: 1, fair: 0, weak: 0, marginal: 0 });
});

test("zoom picks a cell no finer than the map can justify", () => {
	assert.equal(geohashLengthForZoom(3), 3);
	assert.equal(geohashLengthForZoom(8), 4);
	assert.equal(geohashLengthForZoom(12), 5);
	assert.equal(geohashLengthForZoom(15), 6);
	assert.equal(geohashLengthForZoom(19), 7);
	assert.equal(geohashLengthForZoom(Number.NaN), 5);
	// Never coarser as you zoom in.
	let previous = 0;
	for (let zoom = 0; zoom <= 20; zoom++) {
		const length = geohashLengthForZoom(zoom);
		assert.ok(length >= previous, `zoom ${zoom} went coarser`);
		previous = length;
	}
});

/* ── provenance ──────────────────────────────────────────────────────── */

test("an internet row never becomes a measured cell", () => {
	const model = buildCoverage([
		{ ...PALO_ALTO, atMs: T0, provenance: "net", id: 7 },
	]);
	const cell = model.cells[0];
	assert.equal(cell.provenance, "reported");
	assert.equal(cell.netObservations, 1);
	assert.equal(cell.radioObservations, 0);
	assert.equal(model.measuredCells, 0);
	assert.equal(model.reportedCells, 1);
});

test("an internet row carrying an SNR still contributes none", () => {
	// A bridged row has no SNR of ours by construction, but nothing stops a
	// caller putting one in the object. The fold must ignore it: the figure
	// would otherwise shade a box this radio never heard.
	const model = buildCoverage([
		{
			...PALO_ALTO,
			atMs: T0,
			provenance: "net",
			snrDb: 11,
			rssiDbm: -40,
			id: 7,
		},
	]);
	const cell = model.cells[0];
	assert.equal(cell.snrDb, null);
	assert.equal(cell.rssiDbm, null);
	assert.equal(cell.bestSnrDb, null);
	assert.equal(cell.grade, null);
	assert.equal(model.bestSnrDb, null);
	assert.deepEqual(model.byGrade, { strong: 0, fair: 0, weak: 0, marginal: 0 });
});

test("a synthetic sample never becomes a measured cell either", () => {
	const model = buildCoverage([
		{ ...PALO_ALTO, atMs: T0, provenance: "sim", snrDb: 9, id: 4 },
	]);
	const cell = model.cells[0];
	assert.equal(cell.provenance, "synthetic");
	assert.equal(cell.simObservations, 1);
	assert.equal(cell.snrDb, null, "invented dB is not a measurement");
	assert.equal(cell.grade, null);
	assert.equal(model.syntheticCells, 1);
	assert.equal(model.measuredCells, 0);
});

test("radio evidence outranks the rumour that shares its box", () => {
	const model = buildCoverage([
		radio({ snrDb: -3 }),
		{ ...PALO_ALTO, atMs: T0, provenance: "net", id: 7 },
	]);
	const cell = model.cells[0];
	assert.equal(cell.provenance, "measured");
	assert.equal(cell.radioObservations, 1);
	assert.equal(
		cell.netObservations,
		1,
		"the rumour is still counted, not hidden",
	);
	assert.equal(cell.snrDb?.count, 1, "and it is still out of the statistics");
	assert.equal(cell.grade, "fair");
});

test("with no radio sample, fiction outranks rumour as the louder warning", () => {
	assert.equal(
		cellProvenance({
			radioObservations: 0,
			simObservations: 1,
			netObservations: 5,
		}),
		"synthetic",
	);
	assert.equal(
		cellProvenance({
			radioObservations: 1,
			simObservations: 9,
			netObservations: 9,
		}),
		"measured",
	);
	assert.equal(
		cellProvenance({
			radioObservations: 0,
			simObservations: 0,
			netObservations: 1,
		}),
		"reported",
	);
});

test("the summary's counts add up to what went in", () => {
	const model = buildCoverage([
		radio(),
		radio({ id: 2 }),
		{ ...NEXT_CELL, atMs: T0, provenance: "net", id: 7 },
		{ ...PALO_ALTO, atMs: T0, provenance: "sim", id: 8 },
		radio({ lat: 0, lon: 0, id: 9 }),
	]);
	assert.equal(model.radioObservations, 2);
	assert.equal(model.netObservations, 1);
	assert.equal(model.simObservations, 1);
	assert.equal(model.discarded, 1);
	assert.equal(model.observations, 4);
	assert.equal(
		model.cells.reduce((sum, c) => sum + c.observations, 0),
		model.observations,
	);
	assert.equal(
		model.measuredCells + model.reportedCells + model.syntheticCells,
		model.cells.length,
	);
});

/* ── gaps ────────────────────────────────────────────────────────────── */

test("gaps are the unheard neighbours of measured cells", () => {
	const model = buildCoverage([radio()], { gaps: true });
	assert.equal(model.cells.length, 1);
	// A single measured cell has eight neighbours and has heard none of them.
	assert.equal(model.gaps.length, 8);
	assert.ok(!model.gaps.some((g) => g.geohash === "9q9jh"));
	assert.ok(model.gaps.every((g) => g.adjacentMeasured === 1));
});

test("a heard neighbour is not a gap, and shared gaps count their sides", () => {
	const model = buildCoverage([radio(), radio({ ...NEXT_CELL, id: 2 })], {
		gaps: true,
	});
	const names = new Set(model.gaps.map((g) => g.geohash));
	assert.ok(!names.has("9q9jh"), "a measured cell is not its own gap");
	assert.ok(!names.has("9q9jj"), "nor is the measured cell beside it");
	// f.geohash_neighbors('9q9jh') and f.geohash_neighbors('9q9jj') share
	// exactly these four boxes: the row above and the row below the pair.
	assert.deepEqual(
		model.gaps.filter((g) => g.adjacentMeasured === 2).map((g) => g.geohash),
		["9q9hu", "9q9hv", "9q9jk", "9q9jm"],
	);
});

test("nothing but a measured cell may open a gap", () => {
	// A box beside an internet row is not a place this radio failed to hear:
	// nothing here was ever listening for it. Same for a box beside fiction.
	const rumour = buildCoverage(
		[{ ...PALO_ALTO, atMs: T0, provenance: "net", id: 7 }],
		{ gaps: true },
	);
	assert.deepEqual(rumour.gaps, []);
	const fiction = buildCoverage(
		[{ ...PALO_ALTO, atMs: T0, provenance: "sim", id: 8 }],
		{ gaps: true },
	);
	assert.deepEqual(fiction.gaps, []);
});

test("gaps are only computed when the caller asks for them", () => {
	const model = buildCoverage([radio()]);
	assert.deepEqual(model.gaps, []);
	assert.equal(coverageGaps(model.cells).length, 8);
});

test("an empty model claims nothing", () => {
	const model = buildCoverage([], { gaps: true });
	assert.deepEqual(model.cells, []);
	assert.deepEqual(model.gaps, []);
	assert.equal(model.cellSpanKm, null);
	assert.equal(model.bestSnrDb, null);
	assert.equal(model.firstHeardMs, null);
	assert.equal(model.lastHeardMs, null);
	assert.equal(model.observations, 0);
});

test("a cell reports the box it draws, and its size on the ground", () => {
	const model = buildCoverage([radio()]);
	const cell = model.cells[0];
	// f.geohash_decode('9q9jh') ->
	// (37.44140625, 37.4853515625, -122.16796875, -122.1240234375).
	assert.deepEqual(cell.box, {
		latMin: 37.44140625,
		latMax: 37.4853515625,
		lonMin: -122.16796875,
		lonMax: -122.1240234375,
	});
	assert.ok(cell.box.latMin < PALO_ALTO.lat && cell.box.latMax > PALO_ALTO.lat);
	assert.ok(cell.box.lonMin < PALO_ALTO.lon && cell.box.lonMax > PALO_ALTO.lon);
	assert.ok(Math.abs(cell.center.lat - PALO_ALTO.lat) < 0.05);
	const span = model.cellSpanKm;
	assert.ok(span !== null);
	assert.ok(Math.abs(span.heightKm - 4.9) < 0.1, `${span?.heightKm} km tall`);
	// 37.4 N: the box is 4.9 km tall and about 3.9 km wide.
	assert.ok(
		span.widthKm > 3.7 && span.widthKm < 4.0,
		`${span?.widthKm} km wide`,
	);
});
