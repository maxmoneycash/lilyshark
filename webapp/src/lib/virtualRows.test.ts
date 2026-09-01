import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RawFrameFields } from "./deviceLink";
import { parseLscap } from "./lscap";
import { buildLscap } from "./lscapWrite";
import {
	computeRowWindow,
	DEFAULT_ROW_HEIGHT_PX,
	MAX_RENDERED_ROWS,
	ROW_OVERSCAN,
	rowInWindow,
	rowsPerPage,
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
 * A real capture of 50,000 frames, parsed by the analyzer's own reader, and
 * scrolled end to end: what the table mounts must stay bounded by a constant,
 * because that bound is the whole reason the 5,000-frame cap could go. */

describe("a 50,000-frame capture", () => {
	const N = 50_000;

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

	const records: RawFrameFields[] = [];
	for (let i = 0; i < N; i++) records.push(record(i));
	const capture = parseLscap(buildLscap(records).slice().buffer as ArrayBuffer);

	it("parses every frame", () => {
		assert.equal(capture.frames.length, N);
		assert.equal(capture.trailingBytes, 0);
	});

	it("mounts a bounded number of rows at every scroll position", () => {
		const shown = capture.frames.map((_, i) => i);
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
			Number(capture.frames[position].sequence),
			N - 1,
			"and it is the last frame of the capture",
		);
	});
});
