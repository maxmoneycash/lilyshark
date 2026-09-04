import assert from "node:assert/strict";
import test from "node:test";
import { activityGrid, type Sighting } from "./activityGrid";

/** An hour bucket some way into 2026, so the numbers look like real ones. */
const NOW_HOUR = Math.floor(Date.UTC(2026, 8, 3, 4) / 3_600_000);

test("a cell agrees with the total beside it", () => {
	// The check the old code could not pass. It binned on a field the rows do
	// not have, so every count went under one `undefined` key: the totals came
	// out right (they sum values) and every cell came out 0 (they look up by
	// hour). Asserting the two against each other is what catches that.
	const rows: Sighting[] = [
		{ node: 0xa1, hourBucket: NOW_HOUR, n: 4 },
		{ node: 0xa1, hourBucket: NOW_HOUR - 1, n: 3 },
		{ node: 0xb2, hourBucket: NOW_HOUR - 2, n: 9 },
	];

	const grid = activityGrid(rows, 6, NOW_HOUR);

	for (const row of grid.rows) {
		const drawn = grid.hours.reduce((sum, h) => sum + (row.cells.get(h) ?? 0), 0);
		assert.equal(
			drawn,
			row.total,
			`node ${row.node.toString(16)}: the grid draws ${drawn} but totals ${row.total}`,
		);
	}
	assert.equal(grid.rows.length, 2);
});

test("counts land in the hour they were heard in", () => {
	const grid = activityGrid([{ node: 7, hourBucket: NOW_HOUR - 3, n: 5 }], 6, NOW_HOUR);
	const row = grid.rows[0];
	assert.equal(row.cells.get(NOW_HOUR - 3), 5, "in its own hour");
	assert.equal(row.cells.get(NOW_HOUR), undefined, "and in no other");
});

test("two sightings of one node in one hour add up in one cell", () => {
	const grid = activityGrid(
		[
			{ node: 7, hourBucket: NOW_HOUR, n: 2 },
			{ node: 7, hourBucket: NOW_HOUR, n: 3 },
		],
		4,
		NOW_HOUR,
	);
	assert.equal(grid.rows[0].cells.get(NOW_HOUR), 5);
	assert.equal(grid.rows[0].total, 5);
	// Shading scales on the combined cell, or a full cell would draw past full.
	assert.equal(grid.max, 5, "max follows the binned cell, not the largest row");
});

test("the window is the requested width, ending at the current hour", () => {
	const grid = activityGrid([], 48, NOW_HOUR);
	assert.equal(grid.hours.length, 48);
	assert.equal(grid.hours[47], NOW_HOUR, "the last column is the hour we are in");
	assert.equal(grid.hours[0], NOW_HOUR - 47, "and the first is 47 hours back");
});

test("an hour with nothing heard reads as zero, not as a gap", () => {
	// The grid is a record of what the radio decoded, so an hour with no row
	// is an hour in which nothing was heard. It has to draw 0 rather than
	// leave a cell that could be read as "not measured".
	const grid = activityGrid([{ node: 7, hourBucket: NOW_HOUR, n: 1 }], 3, NOW_HOUR);
	const quiet = grid.hours.filter((h) => h !== NOW_HOUR);
	assert.equal(quiet.length, 2);
	for (const h of quiet) {
		assert.equal(grid.rows[0].cells.get(h) ?? 0, 0);
	}
});

test("no sightings is an empty grid, not a crash", () => {
	const grid = activityGrid([], 24, NOW_HOUR);
	assert.deepEqual(grid.rows, []);
	assert.equal(grid.max, 1, "shading never divides by zero");
});

test("rows are ordered busiest first, and ties break stably", () => {
	const grid = activityGrid(
		[
			{ node: 0x30, hourBucket: NOW_HOUR, n: 1 },
			{ node: 0x10, hourBucket: NOW_HOUR, n: 1 },
			{ node: 0x20, hourBucket: NOW_HOUR, n: 9 },
		],
		4,
		NOW_HOUR,
	);
	assert.deepEqual(
		grid.rows.map((r) => r.node),
		[0x20, 0x10, 0x30],
		"busiest first, then by node so the grid does not reshuffle between renders",
	);
});
