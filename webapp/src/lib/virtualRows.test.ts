// Self-check: node --import tsx --test src/lib/virtualRows.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RawFrameFields } from "./deviceLink";
import { parseLscap } from "./lscap";
import { buildLscap } from "./lscapWrite";
import {
	computeRowWindow,
	DEFAULT_ROW_HEIGHT_PX,
	mapRowWindow,
	MAX_RENDERED_ROWS,
	paneSelfScrolls,
	ROW_OVERSCAN,
	rowInWindow,
	rowsPerPage,
	rowWindowPositions,
	scrollTopForRow,
	tableKeyNav,
	visibleSpan,
} from "./virtualRows";

const ROW = 30;
const VIEWPORT = 600;

const win = (rowCount: number, scrollTopPx: number, viewportPx = VIEWPORT) =>
	computeRowWindow({
		rowCount,
		rowHeightPx: ROW,
		scrollTopPx,
		viewportPx,
	});

describe("computeRowWindow", () => {
	it("renders nothing for an empty list", () => {
		assert.deepEqual(win(0, 0), {
			start: 0,
			end: 0,
			topPadPx: 0,
			bottomPadPx: 0,
		});
	});

	it("mounts the visible band plus overscan, and spaces out the rest", () => {
		const w = win(1000, 3000); // row 100 is at the top edge
		assert.equal(w.start, 100 - ROW_OVERSCAN);
		assert.equal(
			w.end,
			w.start + Math.ceil(VIEWPORT / ROW) + 1 + ROW_OVERSCAN * 2,
		);
		// The spacers stand in for exactly the rows that are not mounted, so the
		// scrollbar describes the whole capture and not just the window.
		assert.equal(w.topPadPx, w.start * ROW);
		assert.equal(w.bottomPadPx, (1000 - w.end) * ROW);
		assert.equal(
			w.topPadPx + (w.end - w.start) * ROW + w.bottomPadPx,
			1000 * ROW,
		);
	});

	it("never scrolls past the ends", () => {
		const top = win(1000, 0);
		assert.equal(top.start, 0);
		assert.equal(top.topPadPx, 0);
		const bottom = win(1000, 1000 * ROW - VIEWPORT);
		assert.equal(bottom.end, 1000);
		assert.equal(bottom.bottomPadPx, 0);
		// Scrolled far past the end (a shrinking filter, mid-flick): still valid.
		const past = win(1000, 999_999);
		assert.ok(past.start < 1000 && past.end <= 1000);
	});

	it("keeps the scrolled-to row inside the window", () => {
		for (const top of [0, 17, 999, 12_345, 480_000]) {
			const w = win(50_000, top);
			assert.ok(rowInWindow(w, Math.floor(top / ROW)), `row at ${top}px`);
		}
	});

	it("survives a garbage measurement rather than rendering nothing", () => {
		const w = computeRowWindow({
			rowCount: 500,
			rowHeightPx: 0,
			scrollTopPx: Number.NaN,
			viewportPx: Number.NaN,
		});
		assert.equal(w.start, 0);
		assert.ok(w.end > 0);
	});

	it("caps mounted rows even when the pane claims the whole list", () => {
		// The phone layout hands scrolling back to the page, so the pane's own
		// client height is the entire list: without the cap that mounts 50,000
		// rows at once.
		const w = win(50_000, 0, 50_000 * ROW);
		assert.equal(w.end - w.start, MAX_RENDERED_ROWS);
	});
});

describe("mapRowWindow", () => {
	const rows = Array.from({ length: 5000 }, (_, i) => `row-${i}`);

	it("calls the renderer only for mounted positions", () => {
		const w = win(rows.length, 30_000);
		const seen: number[] = [];
		const out = mapRowWindow(rows, w, (row, position) => {
			seen.push(position);
			return row;
		});
		assert.equal(out.length, w.end - w.start);
		assert.equal(seen.length, w.end - w.start);
		assert.equal(seen[0], w.start);
		assert.equal(seen[seen.length - 1], w.end - 1);
		assert.equal(out[0], `row-${w.start}`);
	});

	it("stops at the end of a list shorter than the window claims", () => {
		// A filter that shrank between the measurement and the render: the
		// window still names rows the list no longer has.
		const stale = { start: 4990, end: 5400, topPadPx: 0, bottomPadPx: 0 };
		assert.equal(mapRowWindow(rows, stale, (r) => r).length, 10);
	});
});

describe("rowWindowPositions", () => {
	it("is the mounted positions and nothing else", () => {
		const w = win(5000, 30_000);
		const positions = rowWindowPositions(w);
		assert.equal(positions.length, w.end - w.start);
		assert.equal(positions[0], w.start);
		assert.equal(positions[positions.length - 1], w.end - 1);
	});

	it("is one window wide however long the list is", () => {
		// The sniffer reads its list newest-first; this is what it maps over
		// instead of reversing a copy of every frame it holds.
		assert.equal(rowWindowPositions(win(200_000, 900_000)).length, 45);
		assert.deepEqual(rowWindowPositions(win(0, 0)), []);
	});
});

describe("paneSelfScrolls", () => {
	it("is true only where the pane has something to scroll", () => {
		assert.equal(paneSelfScrolls(90_000, 600), true);
		assert.equal(paneSelfScrolls(600, 600), false);
		// A fractional layout height is not a scrollbar.
		assert.equal(paneSelfScrolls(600.4, 600), false);
	});
});

describe("rowsPerPage", () => {
	it("is a screenful less one row of overlap", () => {
		assert.equal(rowsPerPage(600, 30), 19);
		assert.equal(rowsPerPage(0, 30), 1); // never zero: PageDown must move
	});
});

describe("scrollTopForRow", () => {
	const at = (position: number, scrollTopPx: number) =>
		scrollTopForRow({
			position,
			rowHeightPx: ROW,
			scrollTopPx,
			viewportPx: VIEWPORT,
			headerPx: 40,
		});

	it("leaves the offset alone when the row is already on screen", () => {
		assert.equal(at(5, 0), 0);
	});

	it("scrolls up to a row above the band, down to one below", () => {
		assert.equal(at(10, 1000), 40 + 10 * ROW);
		assert.equal(at(100, 0), 40 + 101 * ROW - VIEWPORT);
	});

	it("never asks for a negative offset", () => {
		assert.equal(at(0, 0), 0);
	});
});

describe("visibleSpan", () => {
	it("reads the pane's own scroll when the pane scrolls", () => {
		assert.deepEqual(
			visibleSpan({
				scrollTopPx: 1200,
				clientHeightPx: 600,
				scrollHeightPx: 90_000,
				rectTopPx: 120,
				rectHeightPx: 600,
				windowHeightPx: 900,
			}),
			{ scrollTopPx: 1200, viewportPx: 600 },
		);
	});

	it("falls back to the page viewport where the pane has stopped scrolling", () => {
		// Phone layout: `.scroll-y` is `overflow: visible`, so the pane is as
		// tall as its content and the page is what moved.
		assert.deepEqual(
			visibleSpan({
				scrollTopPx: 0,
				clientHeightPx: 90_000,
				scrollHeightPx: 90_000,
				rectTopPx: -4000,
				rectHeightPx: 90_000,
				windowHeightPx: 800,
			}),
			{ scrollTopPx: 4000, viewportPx: 800 },
		);
	});

	it("counts only the part of the pane that is on screen", () => {
		const span = visibleSpan({
			scrollTopPx: 0,
			clientHeightPx: 300,
			scrollHeightPx: 300,
			rectTopPx: 600,
			rectHeightPx: 300,
			windowHeightPx: 800,
		});
		assert.equal(span.scrollTopPx, 0);
		assert.equal(span.viewportPx, 300);
	});
});

describe("tableKeyNav", () => {
	it("walks the logical list, not the mounted rows", () => {
		assert.deepEqual(tableKeyNav(10, 50_000, "ArrowDown"), {
			position: 11,
			activate: false,
		});
		assert.deepEqual(tableKeyNav(10, 50_000, "ArrowUp"), {
			position: 9,
			activate: false,
		});
		assert.deepEqual(tableKeyNav(10, 50_000, "End"), {
			position: 49_999,
			activate: false,
		});
		assert.deepEqual(tableKeyNav(10, 50_000, "Home"), {
			position: 0,
			activate: false,
		});
		assert.deepEqual(tableKeyNav(10, 50_000, "PageDown", 19), {
			position: 29,
			activate: false,
		});
		assert.deepEqual(tableKeyNav(10, 50_000, "PageUp", 19), {
			position: 0,
			activate: false,
		});
	});

	it("clamps at both ends instead of wrapping", () => {
		assert.deepEqual(tableKeyNav(0, 5, "ArrowUp"), {
			position: 0,
			activate: false,
		});
		assert.deepEqual(tableKeyNav(4, 5, "ArrowDown"), {
			position: 4,
			activate: false,
		});
	});

	it("selects in place on Enter and Space", () => {
		assert.deepEqual(tableKeyNav(7, 50, "Enter"), {
			position: 7,
			activate: true,
		});
		assert.deepEqual(tableKeyNav(7, 50, " "), { position: 7, activate: true });
	});

	it("ignores keys the table does not own, and an empty list", () => {
		assert.equal(tableKeyNav(0, 50, "Tab"), null);
		assert.equal(tableKeyNav(0, 50, "a"), null);
		assert.equal(tableKeyNav(0, 0, "ArrowDown"), null);
	});
});

/* ── the size the caps were lifted to ────────────────────────────────────
 * Real captures, parsed by the analyzer's own reader and scrolled end to end:
 * what a table mounts must stay bounded by a constant, because that bound is
 * the whole reason a capture is allowed to run past a few thousand frames. */

function record(i: number): RawFrameFields {
	return {
		seq: i,
		timestampUs: BigInt(i) * 2_400_000n,
		rssiX10: -900 - (i % 300),
		snrX10: 60 - (i % 90),
		presentFields: 0xffff,
		centerFrequencyHz: 906_875_000,
		bandwidthHz: 250_000,
		bitRateBps: 0,
		frequencyDeviationHz: 0,
		airtimeUs: 84_600,
		frequencyErrorHz: -1200,
		preambleSymbols: 16,
		syncWord: 0x2b,
		profileId: 1,
		radioStatus: 0,
		txPowerDbm: 22,
		spreadingFactor: 11,
		codingRateDenominator: 5,
		channelIndex: 0,
		radioIndex: 0,
		modulation: 1,
		direction: 1,
		crc: 2,
		metadataFlags: 0,
		originalLength: 40,
		bytes: new Uint8Array(40).fill(i & 0xff),
	};
}

function capture(n: number) {
	const records: RawFrameFields[] = [];
	for (let i = 0; i < n; i++) records.push(record(i));
	return parseLscap(buildLscap(records).slice().buffer as ArrayBuffer);
}

describe("a 10,000-frame capture, rendered", () => {
	const N = 10_000;
	const parsed = capture(N);

	it("parses every frame", () => {
		assert.equal(parsed.frames.length, N);
		assert.equal(parsed.trailingBytes, 0);
	});

	it("materialises a window, not the capture", () => {
		// This is the property the whole change rests on: the table's render
		// callback — the thing that would build 10,000 <tr> subtrees — runs
		// once per MOUNTED row and not at all for the rest. `built` counts the
		// rows a browser would actually have to lay out.
		const shown = parsed.frames.map((_, i) => i);
		const w = computeRowWindow({
			rowCount: shown.length,
			rowHeightPx: DEFAULT_ROW_HEIGHT_PX,
			scrollTopPx: 150_000, // row 5,000: the middle of the capture
			viewportPx: VIEWPORT,
		});

		let built = 0;
		const rendered = mapRowWindow(shown, w, (index, position) => {
			built++;
			return { position, sequence: Number(parsed.frames[index].sequence) };
		});

		const screenful = Math.ceil(VIEWPORT / DEFAULT_ROW_HEIGHT_PX) + 1;
		assert.equal(built, screenful + ROW_OVERSCAN * 2, "one screenful + overscan");
		assert.equal(built, 45);
		assert.ok(built < N / 100, `${built} rows built out of ${N}`);

		// The window is a window ONTO the capture, not a re-numbering of it:
		// the first row built is frame 5,000 minus the overscan, and the rows
		// carry their own positions in the full 10,000.
		assert.equal(rendered[0].position, 5000 - ROW_OVERSCAN);
		assert.equal(rendered[0].sequence, 5000 - ROW_OVERSCAN);
		assert.equal(rendered[rendered.length - 1].position, w.end - 1);
		assert.equal(rendered[rendered.length - 1].sequence, w.end - 1);

		// And the 9,955 rows that were never built are still accounted for, so
		// the scrollbar describes the whole capture.
		assert.equal(
			w.topPadPx + built * DEFAULT_ROW_HEIGHT_PX + w.bottomPadPx,
			N * DEFAULT_ROW_HEIGHT_PX,
		);
	});

	it("stays bounded at every scroll position, top to bottom", () => {
		const shown = parsed.frames.map((_, i) => i);
		const totalPx = shown.length * DEFAULT_ROW_HEIGHT_PX;
		let widest = 0;
		let builtEndToEnd = 0;
		for (let step = 0; step <= 1000; step++) {
			const w = computeRowWindow({
				rowCount: shown.length,
				rowHeightPx: DEFAULT_ROW_HEIGHT_PX,
				scrollTopPx: (totalPx * step) / 1000,
				viewportPx: VIEWPORT,
			});
			const mounted = mapRowWindow(shown, w, (index) => index).length;
			builtEndToEnd += mounted;
			widest = Math.max(widest, mounted);
			assert.ok(
				mounted <= MAX_RENDERED_ROWS,
				`${mounted} rows mounted at step ${step}`,
			);
			assert.equal(
				w.topPadPx + mounted * DEFAULT_ROW_HEIGHT_PX + w.bottomPadPx,
				totalPx,
			);
		}
		assert.ok(
			widest <=
				Math.ceil(VIEWPORT / DEFAULT_ROW_HEIGHT_PX) + 1 + ROW_OVERSCAN * 2,
			`widest window was ${widest}`,
		);
		// Scrolling the whole capture in 1,001 steps costs about 45 rows per
		// step, not 10,000 — the DOM never holds the capture even once.
		assert.ok(builtEndToEnd < 1001 * 46, `${builtEndToEnd} rows over the pass`);
	});
});

describe("a 50,000-frame capture", () => {
	const N = 50_000;
	const parsed = capture(N);

	it("parses every frame", () => {
		assert.equal(parsed.frames.length, N);
		assert.equal(parsed.trailingBytes, 0);
	});

	it("mounts a bounded number of rows at every scroll position", () => {
		const shown = parsed.frames.map((_, i) => i);
		const totalPx = shown.length * DEFAULT_ROW_HEIGHT_PX;
		let widest = 0;
		// 1,000 positions from the first row to past the last.
		for (let step = 0; step <= 1000; step++) {
			const w = computeRowWindow({
				rowCount: shown.length,
				rowHeightPx: DEFAULT_ROW_HEIGHT_PX,
				scrollTopPx: (totalPx * step) / 1000,
				viewportPx: VIEWPORT,
			});
			const mounted = w.end - w.start;
			widest = Math.max(widest, mounted);
			assert.ok(
				mounted <= MAX_RENDERED_ROWS,
				`${mounted} rows mounted at step ${step}`,
			);
			// The spacers always account for the frames that are not mounted.
			assert.equal(
				w.topPadPx + mounted * DEFAULT_ROW_HEIGHT_PX + w.bottomPadPx,
				totalPx,
			);
			// Every mounted row is a real frame.
			assert.ok(w.end <= shown.length && w.start >= 0);
		}
		// A screenful and its overscan — 0.1% of the capture, not 50,000 rows.
		assert.ok(
			widest <=
				Math.ceil(VIEWPORT / DEFAULT_ROW_HEIGHT_PX) + 1 + ROW_OVERSCAN * 2,
		);
	});

	it("navigates the whole capture without touching the DOM", () => {
		let position = 0;
		for (let i = 0; i < N - 1; i++) {
			const nav = tableKeyNav(position, N, "ArrowDown");
			assert.ok(nav);
			position = nav.position;
		}
		assert.equal(position, N - 1, "ArrowDown reaches the last frame");
		assert.equal(
			Number(parsed.frames[position].sequence),
			N - 1,
			"and it is the last frame of the capture",
		);
	});
});
