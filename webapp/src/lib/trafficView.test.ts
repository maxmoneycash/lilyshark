import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RF_FIELD } from "./lscap";
import {
	applyBrush,
	assembleExportView,
	brushLabel,
	buildIoSeries,
	chooseBucketS,
	exportFileName,
	frameTimeS,
	IO_MAX_BUCKETS,
	type IoFrame,
	normalizeBrush,
	pcapExclusionNote,
} from "./trafficView";

/** A minimal IO-graph frame at `tS` seconds on the capture clock. */
function frame(
	tS: number,
	opts: { snrDb?: number; crc?: string } = {},
): IoFrame {
	return {
		timestampUs: BigInt(Math.round(tS * 1e6)),
		presentFields: opts.snrDb !== undefined ? RF_FIELD.snr : 0,
		snrDb: opts.snrDb ?? 0,
		crc: opts.crc ?? "valid",
	};
}

describe("normalizeBrush", () => {
	it("orders the edges", () => {
		assert.deepEqual(normalizeBrush(5, 2), { startS: 2, endS: 5 });
		assert.deepEqual(normalizeBrush(2, 5), { startS: 2, endS: 5 });
	});

	it("rejects a zero-width drag and non-finite edges", () => {
		assert.equal(normalizeBrush(3, 3), null);
		assert.equal(normalizeBrush(Number.NaN, 3), null);
		assert.equal(normalizeBrush(0, Infinity), null);
	});
});

describe("applyBrush", () => {
	const frames = [frame(0), frame(1), frame(2), frame(3), frame(4)];

	it("is the identity with no brush — clearing restores the filter's set", () => {
		const shown = [0, 2, 4];
		assert.deepEqual(applyBrush(shown, frames, 0n, null), shown);
	});

	it("composes with the upstream filter set, edges inclusive", () => {
		// The filter already hid frame 2; the brush narrows what remains.
		assert.deepEqual(
			applyBrush([0, 1, 3, 4], frames, 0n, { startS: 1, endS: 3 }),
			[1, 3],
		);
	});

	it("measures from the capture's own t0", () => {
		const t0 = 10_000_000n; // frames at 10..14 s absolute, 0..4 s on the clock
		const shifted = frames.map((f) => ({
			...f,
			timestampUs: f.timestampUs + t0,
		}));
		assert.deepEqual(
			applyBrush([0, 1, 2, 3, 4], shifted, t0, { startS: 2, endS: 4 }),
			[2, 3, 4],
		);
	});

	it("returns empty when nothing falls inside", () => {
		assert.deepEqual(
			applyBrush([0, 1], frames, 0n, { startS: 8, endS: 9 }),
			[],
		);
	});
});

describe("brushLabel", () => {
	it("prints millisecond precision with the unit", () => {
		assert.equal(brushLabel({ startS: 1.2, endS: 3.45 }), "1.200–3.450 s");
	});
});

describe("chooseBucketS", () => {
	it("keeps the bucket count under the cap for any span", () => {
		for (const span of [0, 0.5, 3, 60, 600, 3600, 86_400, 900_000]) {
			const s = chooseBucketS(span);
			assert.ok(s > 0);
			assert.ok(span / s <= IO_MAX_BUCKETS, `span ${span}s → ${span / s}`);
		}
	});

	it("uses the finest bucket for a short capture", () => {
		assert.equal(chooseBucketS(2), 0.1);
	});
});

describe("buildIoSeries", () => {
	it("returns empty series for no frames", () => {
		const s = buildIoSeries([], 0n);
		assert.deepEqual(s.xs, []);
		assert.deepEqual(s.rate, []);
	});

	it("bins rate, SNR and CRC failures onto one clock", () => {
		// Two frames in the first second, one (a CRC failure) in the third;
		// span 2.5 s → 0.1 s buckets.
		const frames = [
			frame(0.01, { snrDb: 4 }),
			frame(0.05, { snrDb: 8 }),
			frame(2.51, { crc: "invalid" }),
		];
		const s = buildIoSeries(frames, 0n);
		assert.equal(s.bucketS, 0.1);
		assert.equal(s.xs.length, s.rate.length);
		assert.equal(s.xs.length, s.snr.length);
		assert.equal(s.xs.length, s.crcFail.length);
		// First bucket: 2 frames / 0.1 s = 20 f/s, mean SNR 6, no failures.
		assert.equal(s.rate[0], 20);
		assert.equal(s.snr[0], 6);
		assert.equal(s.crcFail[0], null);
		// A silent bucket is a real zero rate but has no SNR reading.
		assert.equal(s.rate[1], 0);
		assert.equal(s.snr[1], null);
		// Last bucket holds the failure: 10 f/s, all failing.
		const last = s.xs.length - 1;
		assert.equal(s.rate[last], 10);
		assert.equal(s.crcFail[last], 10);
		// SNR was reported but the failure frame carries none.
		assert.equal(s.snr[last], null);
	});

	it("ignores an SNR value whose present bit is clear", () => {
		const f = frame(0);
		f.snrDb = 99; // garbage the radio never reported
		const s = buildIoSeries([f, frame(0.01, { snrDb: 3 })], 0n);
		assert.equal(s.snr[0], 3);
	});

	it("caps the point count on a large capture", () => {
		const frames: IoFrame[] = [];
		for (let i = 0; i < 5000; i++) frames.push(frame(i * 0.7));
		const s = buildIoSeries(frames, 0n);
		assert.ok(s.xs.length <= IO_MAX_BUCKETS, `plotted ${s.xs.length} points`);
		// Every frame is accounted for: total = Σ rate·bucket.
		const total = s.rate.reduce((n, r) => n + r * s.bucketS, 0);
		assert.ok(Math.abs(total - 5000) < 1e-6);
	});

	it("keeps the x axis on the full capture clock when filtered", () => {
		// A filtered set starting at 100 s must not be re-zeroed.
		const s = buildIoSeries([frame(100), frame(101)], 0n);
		assert.ok(s.xs[0] >= 100 - s.bucketS);
		assert.equal(frameTimeS(frame(100), 0n), 100);
	});
});

describe("assembleExportView", () => {
	const frames = [frame(0), frame(1), frame(2), frame(3)];

	it("selects the composed view in table order", () => {
		const view = assembleExportView(frames, [1, 3]);
		assert.deepEqual(
			view.frames.map((f) => f.timestampUs),
			[1_000_000n, 3_000_000n],
		);
	});

	it("measures time from the full capture's first frame", () => {
		const view = assembleExportView(frames, [2, 3]);
		assert.equal(view.timeReferenceUs, 0n);
	});

	it("handles an empty capture", () => {
		const view = assembleExportView([], []);
		assert.deepEqual(view.frames, []);
		assert.equal(view.timeReferenceUs, 0n);
	});
});

describe("exportFileName", () => {
	it("swaps the extension for a full-capture export", () => {
		assert.equal(
			exportFileName(
				"field-capture-0846.lscap",
				{ filtered: false, brushed: false },
				"pcap",
			),
			"field-capture-0846.pcap",
		);
	});

	it("marks any subset view", () => {
		assert.equal(
			exportFileName("cap.lscap", { filtered: true, brushed: false }, "csv"),
			"cap-view.csv",
		);
		assert.equal(
			exportFileName("cap.lscap", { filtered: false, brushed: true }, "json"),
			"cap-view.json",
		);
	});

	it("falls back when the capture has no name", () => {
		assert.equal(
			exportFileName("", { filtered: false, brushed: false }, "csv"),
			"capture.csv",
		);
	});
});

describe("pcapExclusionNote", () => {
	it("reports a clean write plainly", () => {
		assert.equal(
			pcapExclusionNote({
				written: 24,
				excludedSynthetic: 0,
				excludedUnencodable: 0,
			}),
			"24 frame(s) written",
		);
	});

	it("surfaces both exclusion counts honestly", () => {
		const note = pcapExclusionNote({
			written: 20,
			excludedSynthetic: 3,
			excludedUnencodable: 1,
		});
		assert.match(note, /20 frame\(s\) written/);
		assert.match(note, /3 synthetic frame\(s\) excluded/);
		assert.match(note, /no provenance channel/);
		assert.match(note, /1 frame\(s\) LoRaTap v0 cannot encode/);
	});

	it("says when annotations could not ride along", () => {
		const note = pcapExclusionNote({
			written: 24,
			excludedSynthetic: 0,
			excludedUnencodable: 0,
			annotationsOmitted: 2,
		});
		assert.match(note, /24 frame\(s\) written/);
		assert.match(note, /2 annotation\(s\) not written/);
		assert.match(note, /no annotation channel/);
		// Nothing to leave out, nothing said.
		assert.equal(
			pcapExclusionNote({
				written: 24,
				excludedSynthetic: 0,
				excludedUnencodable: 0,
				annotationsOmitted: 0,
			}),
			"24 frame(s) written",
		);
	});
});
