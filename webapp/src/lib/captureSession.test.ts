// Self-check: node --import tsx --test src/lib/captureSession.test.ts
//
// The whole path, end to end: the exact line the firmware prints, parsed the
// way the link parses it, recorded into a session, written as .lscap, and read
// back by the analyzer's own parser. If any link in that chain drifts, a
// capture recorded in the browser stops being the frame the radio heard.
import assert from "node:assert";
import test from "node:test";
import { parseLskLine } from "./deviceLink.ts";
import { parseLscap } from "./lscap.ts";
import {
	CAPTURE_FRAME_LIMIT,
	captureElapsedMs,
	captureFileName,
	captureToLscap,
	clearCapture,
	getCaptureSession,
	recordFrame,
	startCapture,
	stopCapture,
} from "./captureSession.ts";

/** One `LSK F` line shaped exactly as sim_main.cpp prints it. */
function lskFrame(over: Record<string, unknown> = {}): string {
	const body = {
		src: 305419896, dst: 4294967295, proto: "Meshtastic", port: 1, hops: 2,
		rssi_x10: -915, snr_x10: 62, kind: "TEXT", sim: false,
		text: "hello mesh",
		seq: 12, ts: 987654321, pf: 255, freq: 906875000, bw: 250000,
		br: 1200, fdev: 0, air: 84600, ferr: -1200,
		pre: 16, sync: 43, prof: 1, rstat: 0, txp: 22,
		sf: 11, cr: 5, ch: 0, ridx: 0,
		mod: 1, dir: 1, crc: 2, mflags: 0, olen: 5,
		hex: "0a0b0c0d0e",
		...over,
	};
	return `LSK F ${JSON.stringify(body)}`;
}

function frameFrom(line: string) {
	const parsed = parseLskLine(line);
	assert.ok(parsed && parsed.kind === "F", "line should parse as a frame");
	return parsed.frame;
}

test("a device frame carries the whole record", () => {
	const f = frameFrom(lskFrame());
	assert.ok(f.raw, "raw record must be present");
	assert.equal(f.raw.seq, 12);
	assert.equal(f.raw.timestampUs, 987654321n);
	assert.deepEqual([...f.raw.bytes], [0x0a, 0x0b, 0x0c, 0x0d, 0x0e]);
	assert.equal(f.text, "hello mesh");
});

test("nothing is recorded until a session is armed", () => {
	clearCapture();
	recordFrame(frameFrom(lskFrame()));
	assert.equal(getCaptureSession().frames.length, 0);
});

test("a session records, stops, and writes a capture the analyzer reads", () => {
	clearCapture();
	startCapture(1000);
	for (let i = 0; i < 3; i++) {
		recordFrame(frameFrom(lskFrame({ seq: i, hex: "aabb", olen: 2 })));
	}
	const done = stopCapture(4000);

	assert.equal(done.recording, false);
	assert.equal(done.frames.length, 3);
	assert.equal(captureElapsedMs(done), 3000);

	const cap = parseLscap(captureToLscap(done).slice().buffer as ArrayBuffer);
	assert.equal(cap.frames.length, 3);
	assert.equal(cap.trailingBytes, 0);
	assert.equal(cap.frames[0].sequence, 0n);
	assert.equal(cap.frames[2].sequence, 2n);
	assert.deepEqual([...cap.frames[1].bytes], [0xaa, 0xbb]);
	assert.equal(cap.frames[0].rssiDbm, -91.5);
	assert.equal(cap.frames[0].snrDb, 6.2);
	assert.equal(cap.frames[0].centerFrequencyHz, 906_875_000);
	assert.equal(cap.frames[0].spreadingFactor, 11);
	assert.equal(cap.frames[0].crc, "valid");
});

test("frames with no payload are counted, not silently dropped", () => {
	clearCapture();
	startCapture();
	// A pre-capture firmware sends the decoded view with no hex/seq.
	const legacy = `LSK F ${JSON.stringify({
		src: 1, dst: 2, proto: "MeshCore", port: 0,
		rssi_x10: -800, snr_x10: 40, kind: "RAW", sim: false,
	})}`;
	const f = frameFrom(legacy);
	assert.equal(f.raw, undefined, "no record without hex");
	recordFrame(f);
	const s = getCaptureSession();
	assert.equal(s.frames.length, 0);
	assert.equal(s.skippedNoPayload, 1, "the gap has to be visible");
});

test("simulate-mode traffic is flagged in the capture", () => {
	clearCapture();
	startCapture();
	recordFrame(frameFrom(lskFrame({ mflags: 4, sim: true })));
	const done = stopCapture();
	assert.equal(done.containsSynthetic, true);
	const cap = parseLscap(captureToLscap(done).slice().buffer as ArrayBuffer);
	assert.equal(cap.frames[0].synthetic, true, "synthetic must survive to the file");
});

test("a runaway session stops itself at the frame limit", () => {
	clearCapture();
	startCapture();
	for (let i = 0; i < CAPTURE_FRAME_LIMIT + 5; i++) {
		recordFrame(frameFrom(lskFrame({ seq: i })));
	}
	const s = getCaptureSession();
	assert.equal(s.recording, false, "it stops rather than growing without bound");
	assert.equal(s.frames.length, CAPTURE_FRAME_LIMIT);
});

test("the file name is stamped from the session start", () => {
	clearCapture();
	startCapture(Date.UTC(2026, 7, 17, 12, 0, 0));
	const name = captureFileName(getCaptureSession());
	assert.match(name, /^lilyshark-capture-\d{8}-\d{6}\.lscap$/);
});
