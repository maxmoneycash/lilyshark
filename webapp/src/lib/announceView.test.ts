/**
 * Announce aggregation for the TRAFFIC tab's ANNOUNCES panel (UI-013).
 *
 * Frames are built here the way the firmware's own announce test builds
 * them (test/reticulum_announce/test_reticulum_announce.cpp,
 * buildAnnounceFrame), so what this module aggregates is exactly what the
 * C++ semantic tier would read off the same bytes.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	type AnnounceSourceFrame,
	announceTicks,
	collectAnnounces,
	destinationFilterExpression,
	hopRangeLabel,
	summarizeAnnounces,
} from "./announceView";
import { parseFrameFilter } from "./frameFilter";

/* ── frame construction ──────────────────────────────────────────────── */

const HASH_BYTES = 16;
const PUBLIC_KEY = 64;
const NAME_HASH = 10;
const RANDOM_HASH = 10;
const RATCHET = 32;
const SIGNATURE = 64;

interface BuildOptions {
	destination: number;
	hops?: number;
	headerTwo?: boolean;
	transport?: number;
	ratchet?: boolean;
	appData?: number;
	/** Announce (1) by default; anything else stays a structural frame. */
	packetType?: number;
}

/** buildAnnounceFrame in test/reticulum_announce/test_reticulum_announce.cpp. */
function announceBytes(opts: BuildOptions): Uint8Array {
	const {
		destination,
		hops = 1,
		headerTwo = false,
		transport = 0x70,
		ratchet = false,
		appData = 0,
		packetType = 0x01,
	} = opts;
	const out: number[] = [];
	out.push(0x00); // RNode shim: complete frame
	out.push(
		(headerTwo ? 0x40 | 0x10 : 0) | (ratchet ? 0x20 : 0) | (packetType & 0x03),
	);
	out.push(hops);
	const ramp = (base: number, length: number) => {
		for (let i = 0; i < length; i++) out.push((base + i) & 0xff);
	};
	if (headerTwo) ramp(transport, HASH_BYTES);
	ramp(destination, HASH_BYTES);
	out.push(0x00); // context byte
	ramp(0x11, PUBLIC_KEY);
	ramp(0x21, NAME_HASH);
	ramp(0x31, RANDOM_HASH);
	if (ratchet) ramp(0x41, RATCHET);
	ramp(0x51, SIGNATURE);
	ramp(0x61, appData);
	return Uint8Array.from(out);
}

/** The hex a destination-hash ramp produces, so tests can name a row. */
function rampHex(base: number, length = HASH_BYTES): string {
	let out = "";
	for (let i = 0; i < length; i++)
		out += ((base + i) & 0xff).toString(16).padStart(2, "0");
	return out;
}

const DEST_A = rampHex(0xd0);
const DEST_B = rampHex(0x90);

function frameAt(
	seconds: number,
	bytes: Uint8Array,
	overrides: Partial<AnnounceSourceFrame> = {},
): AnnounceSourceFrame {
	return {
		timestampUs: BigInt(Math.round(seconds * 1e6)),
		bytes,
		truncated: false,
		profileId: 4, // RNODE EXAMPLE
		airtimeUs: null,
		...overrides,
	};
}

const T0 = 0n;

/* ── collection ──────────────────────────────────────────────────────── */

test("only Reticulum-profile frames are read, and only provable announces count", () => {
	const frames = [
		frameAt(0, announceBytes({ destination: 0xd0 })),
		// A Meshtastic-profile frame carrying announce-shaped bytes is never
		// reinterpreted: the dissector is profile-gated, as the firmware is.
		frameAt(1, announceBytes({ destination: 0xd0 }), { profileId: 1 }),
		// A Reticulum frame that is not an announce.
		frameAt(2, announceBytes({ destination: 0xd0, packetType: 0x02 })),
		// A truncated announce: the C++ reader refuses a malformed packet.
		frameAt(3, announceBytes({ destination: 0xd0 }), { truncated: true }),
	];
	const { observations, reticulumFrameCount } = collectAnnounces(frames, T0);
	assert.equal(reticulumFrameCount, 3, "the Meshtastic frame is not counted");
	assert.equal(observations.length, 1);
	assert.equal(observations[0].frameIndex, 0);
	assert.equal(observations[0].destinationHashHex, DEST_A);
});

test("a capture with no Reticulum frames has nothing to say", () => {
	const overview = summarizeAnnounces(
		[
			frameAt(0, announceBytes({ destination: 0xd0 }), { profileId: 1 }),
			frameAt(1, announceBytes({ destination: 0xd0 }), { profileId: 2 }),
		],
		T0,
	);
	assert.equal(overview.reticulumFrameCount, 0);
	assert.equal(overview.announceCount, 0);
	assert.deepEqual(overview.destinations, []);
	assert.equal(overview.shareIsAirtime, false);
});

test("Reticulum frames with no announce among them say so honestly", () => {
	const overview = summarizeAnnounces(
		[
			frameAt(0, announceBytes({ destination: 0xd0, packetType: 0x00 })),
			frameAt(1, announceBytes({ destination: 0xd0, packetType: 0x02 })),
		],
		T0,
	);
	assert.equal(overview.reticulumFrameCount, 2);
	assert.equal(overview.announceCount, 0);
	assert.equal(overview.structuralOnlyCount, 2);
	assert.deepEqual(overview.destinations, []);
});

/* ── per-destination rollup ──────────────────────────────────────────── */

function corpus(): AnnounceSourceFrame[] {
	return [
		frameAt(0, announceBytes({ destination: 0xd0, hops: 1 })),
		frameAt(10, announceBytes({ destination: 0x90, hops: 0 })),
		frameAt(20, announceBytes({ destination: 0xd0, hops: 3, ratchet: true })),
		frameAt(
			30,
			announceBytes({
				destination: 0xd0,
				hops: 3,
				headerTwo: true,
				appData: 4,
			}),
		),
	];
}

test("each destination hash gets one row, with its cadence and hop range", () => {
	const overview = summarizeAnnounces(corpus(), T0);
	assert.equal(overview.announceCount, 4);
	assert.equal(overview.destinations.length, 2);
	assert.equal(overview.firstSeenS, 0);
	assert.equal(overview.lastSeenS, 30);

	const [a, b] = overview.destinations;
	assert.equal(a.destinationHashHex, DEST_A);
	assert.equal(a.prefix, DEST_A.slice(0, 8));
	assert.equal(a.count, 3);
	assert.equal(a.firstSeenS, 0);
	assert.equal(a.lastSeenS, 30);
	assert.equal(a.meanIntervalS, 15);
	assert.equal(a.minHops, 1);
	assert.equal(a.maxHops, 3);
	assert.equal(hopRangeLabel(a), "1–3");
	assert.equal(a.ratchetCount, 1);
	assert.equal(a.appDataCount, 1);
	assert.equal(a.transportedCount, 1);
	assert.equal(a.observations.map((o) => o.frameIndex).join(","), "0,2,3");

	assert.equal(b.destinationHashHex, DEST_B);
	assert.equal(b.count, 1);
	assert.equal(b.meanIntervalS, null, "one announce is not a cadence");
	assert.equal(hopRangeLabel(b), "0");
	assert.equal(b.ratchetCount, 0);
	assert.equal(b.appDataCount, 0);
});

test("a path change is a change in what this receiver observed", () => {
	const overview = summarizeAnnounces(corpus(), T0);
	const a = overview.destinations[0];
	// hops 1 → 3 is one change; 3 → 3 with a transport id appearing is another.
	assert.equal(a.pathChanges, 2);
	assert.equal(overview.destinations[1].pathChanges, 0);

	// Identical repeats are not path changes.
	const steady = summarizeAnnounces(
		[
			frameAt(0, announceBytes({ destination: 0xd0, hops: 2 })),
			frameAt(5, announceBytes({ destination: 0xd0, hops: 2 })),
			frameAt(9, announceBytes({ destination: 0xd0, hops: 2 })),
		],
		T0,
	);
	assert.equal(steady.destinations[0].pathChanges, 0);
});

test("announce share is a share of announces, by count when airtime is absent", () => {
	const overview = summarizeAnnounces(corpus(), T0);
	assert.equal(overview.shareIsAirtime, false);
	assert.equal(overview.destinations[0].countSharePercent, 75);
	assert.equal(overview.destinations[1].countSharePercent, 25);
	for (const d of overview.destinations) {
		assert.equal(d.airtimeSharePercent, null);
	}
	const total = overview.destinations.reduce(
		(s, d) => s + d.countSharePercent,
		0,
	);
	assert.ok(Math.abs(total - 100) < 1e-9, "shares total the announce set");
});

test("airtime share is offered only when every announce frame reports airtime", () => {
	const withAirtime = corpus().map((f, i) => ({
		...f,
		airtimeUs: i === 1 ? 900_000 : 100_000,
	}));
	const overview = summarizeAnnounces(withAirtime, T0);
	assert.equal(overview.shareIsAirtime, true);
	// One slow announce holds the channel for 900ms of the 1.2s of announce
	// airtime — three quarters of it, where a count share would have said a
	// quarter. Airtime is what an operator actually feels, so it leads.
	assert.equal(overview.destinations[0].destinationHashHex, DEST_B);
	assert.equal(overview.destinations[0].airtimeSharePercent, 75);
	assert.equal(overview.destinations[0].countSharePercent, 25);
	assert.equal(overview.destinations[1].airtimeSharePercent, 25);
	assert.equal(overview.destinations[1].countSharePercent, 75);

	// One missing figure and the panel falls back rather than under-counting.
	const partial = withAirtime.map((f, i) =>
		i === 0 ? { ...f, airtimeUs: null } : f,
	);
	const fallback = summarizeAnnounces(partial, T0);
	assert.equal(fallback.shareIsAirtime, false);
	assert.equal(fallback.destinations[0].airtimeSharePercent, null);
});

test("rows are ordered by share, with a stable tiebreak", () => {
	const overview = summarizeAnnounces(
		[
			frameAt(0, announceBytes({ destination: 0x90 })),
			frameAt(1, announceBytes({ destination: 0xd0 })),
			frameAt(2, announceBytes({ destination: 0xd0 })),
			frameAt(3, announceBytes({ destination: 0x20 })),
		],
		T0,
	);
	assert.deepEqual(
		overview.destinations.map((d) => d.count),
		[2, 1, 1],
	);
	// Equal counts: whoever announced first leads.
	assert.equal(overview.destinations[0].destinationHashHex, DEST_A);
	assert.equal(overview.destinations[1].destinationHashHex, DEST_B);
	assert.equal(overview.destinations[2].destinationHashHex, rampHex(0x20));
});

/* ── timeline ────────────────────────────────────────────────────────── */

test("timeline ticks sit on the capture's announce span and mark path changes", () => {
	const overview = summarizeAnnounces(corpus(), T0);
	const ticks = announceTicks(overview.destinations[0], overview);
	assert.deepEqual(
		ticks.map((t) => t.x),
		[0, 20 / 30, 1],
	);
	assert.deepEqual(
		ticks.map((t) => t.pathChange),
		[false, true, true],
	);
	assert.deepEqual(
		ticks.map((t) => t.frameIndex),
		[0, 2, 3],
	);
});

test("a zero-width span puts every tick at the left edge instead of dividing by zero", () => {
	const overview = summarizeAnnounces(
		[
			frameAt(4, announceBytes({ destination: 0xd0 })),
			frameAt(4, announceBytes({ destination: 0xd0 })),
		],
		T0,
	);
	const ticks = announceTicks(overview.destinations[0], overview);
	assert.deepEqual(
		ticks.map((t) => t.x),
		[0, 0],
	);
	for (const t of ticks) assert.ok(Number.isFinite(t.x));
});

/* ── filter integration ──────────────────────────────────────────────── */

test("a row's filter expression parses and selects exactly that destination", () => {
	const frames = corpus();
	const overview = summarizeAnnounces(frames, T0);
	for (const destination of overview.destinations) {
		const text = destinationFilterExpression(destination.destinationHashHex);
		const parsed = parseFrameFilter(text);
		assert.ok(parsed.ok, `"${text}" must parse`);
		assert.equal(parsed.empty, false);

		const matched: number[] = [];
		for (let i = 0; i < frames.length; i++) {
			const f = frames[i];
			const passes = parsed.predicate({
				sequence: i,
				capturedLength: f.bytes.length,
				centerFrequencyHz: 0,
				bandwidthHz: 0,
				spreadingFactor: 0,
				codingRateDenominator: 0,
				rssiDbm: 0,
				snrDb: 0,
				profileId: f.profileId ?? 0,
				direction: "rx",
				crc: "valid",
				synthetic: false,
				bytes: f.bytes,
			});
			if (passes) matched.push(i);
		}
		assert.deepEqual(
			matched,
			destination.observations.map((o) => o.frameIndex),
			`${destination.prefix}: the filter shows that destination's frames`,
		);
	}
});

test("the capture clock is the table's clock, not the wall clock", () => {
	// t0 is the capture's first frame, exactly as the TIME column reads.
	const t0 = 1_700_000_000_000_000n;
	const overview = summarizeAnnounces(
		[
			{
				timestampUs: t0,
				bytes: announceBytes({ destination: 0xd0 }),
				truncated: false,
				profileId: 4,
				airtimeUs: null,
			},
			{
				timestampUs: t0 + 2_500_000n,
				bytes: announceBytes({ destination: 0xd0 }),
				truncated: false,
				profileId: 4,
				airtimeUs: null,
			},
		],
		t0,
	);
	assert.equal(overview.destinations[0].firstSeenS, 0);
	assert.equal(overview.destinations[0].lastSeenS, 2.5);
	assert.equal(overview.destinations[0].meanIntervalS, 2.5);
});

test("aggregation never claims anything about announce contents", () => {
	// app_data is a length and nothing else — no field here carries payload
	// bytes, a name, or an identity.
	const overview = summarizeAnnounces(
		[frameAt(0, announceBytes({ destination: 0xd0, appData: 6 }))],
		T0,
	);
	const observation = overview.destinations[0].observations[0];
	assert.equal(observation.appDataLength, 6);
	assert.deepEqual(Object.keys(observation).sort(), [
		"airtimeUs",
		"appDataLength",
		"destinationHashHex",
		"frameIndex",
		"hasRatchet",
		"headerType",
		"hops",
		"timeS",
		"transportIdHex",
	]);
});
