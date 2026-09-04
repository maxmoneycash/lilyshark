import assert from "node:assert/strict";
import test from "node:test";
import {
	emptySlots,
	slotsReducer,
	type SlotState,
} from "../lib/captureSlots";
import type { LscapCapture, LscapFrame } from "../lib/lscap";
import {
	LIVE_CAP,
	SIM_LIVE_KEY,
	simLiveTick,
	startTrafficDemoInterval,
	TRAFFIC_DEMO_INTERVAL_MS,
} from "./trafficDemo";
import { demoNextFrame, emptyDemoCapture } from "../mesh/demo";

interface View {
	capture: LscapCapture;
	selected: number;
	filterText: string;
	note: string | null;
	containsSynthetic: boolean;
	brush: unknown;
}

/**
 * A capture standing in for a file off a microSD card: real, and big.
 *
 * Built by taking a genuine generated frame and clearing `synthetic`, rather
 * than hand-writing an object literal — a literal that drifts from LscapFrame
 * still typechecks under a cast and then the test proves nothing about the
 * frames the analyzer actually handles.
 */
function operatorCapture(frameCount: number): LscapCapture {
	const base = emptyDemoCapture();
	const frames: LscapFrame[] = [];
	for (let i = 0; i < frameCount; i += 1) {
		frames.push({
			...demoNextFrame(i, i * 1_000_000),
			sequence: BigInt(i),
			timestampUs: BigInt(i) * 1_000_000n,
			// The point of the test: these were HEARD.
			synthetic: false,
		});
	}
	return { ...base, frames };
}

/** Drive ticks through the real reducer, the way the component does. */
function run(
	initial: SlotState<View>,
	ticks: number,
): { state: SlotState<View>; claimed: string } {
	let state = initial;
	let claimed = "";
	let seq = 1000;
	for (let i = 0; i < ticks; i += 1) {
		claimed = simLiveTick(state, claimed, seq++, (action) => {
			state = slotsReducer(state, action);
		});
	}
	return { state, claimed };
}

test("the simulated stream never writes into the operator's capture", () => {
	// A 20,000-frame file, open and active — exactly the state in which
	// pressing SIM LIVE used to discard 19,750 of those frames.
	const opened = slotsReducer(emptySlots<View>(), {
		type: "open",
		key: "file:big-20k.lscap",
		origin: "file",
		name: "big-20k.lscap",
		view: {
			capture: operatorCapture(20_000),
			selected: 0,
			filterText: "",
			note: null,
			containsSynthetic: false,
			brush: null,
		},
	});
	const before = opened.slots[0];

	const { state } = run(opened, 12);

	const file = state.slots.find((s) => s.key === "file:big-20k.lscap");
	assert.ok(file, "the operator's capture is still open");
	assert.equal(
		file.view.capture.frames.length,
		20_000,
		"every frame the operator opened is still there",
	);
	assert.equal(
		file.view.containsSynthetic,
		false,
		"a capture of heard frames is never relabelled synthetic",
	);
	assert.equal(file.view.capture, before.view.capture, "its capture was not rewritten at all");
});

test("the stream opens and fills a slot of its own", () => {
	const { state, claimed } = run(emptySlots<View>(), 6);

	const sim = state.slots.find((s) => s.key === SIM_LIVE_KEY);
	assert.ok(sim, "the stream opened its own slot");
	assert.equal(sim.id, claimed, "and is feeding the slot it opened");
	assert.equal(sim.origin, "live", "marked live, so the LRU will not evict a running stream");
	assert.equal(sim.view.containsSynthetic, true, "and says every frame in it was generated");
	// Six ticks: the first opens the slot, the remaining five each add a frame.
	assert.equal(sim.view.capture.frames.length, 5);
	assert.ok(
		sim.view.capture.frames.every((f) => f.synthetic),
		"every frame in it is marked generated",
	);
});

test("restarting the stream continues in one tab instead of stacking tabs", () => {
	const first = run(emptySlots<View>(), 4);
	const framesBefore = first.state.slots.find((s) => s.key === SIM_LIVE_KEY)?.view.capture.frames
		.length;

	// SIM LIVE off and on again: the component drops its claim, nothing else.
	const second = run(first.state, 3);

	const sims = second.state.slots.filter((s) => s.key === SIM_LIVE_KEY);
	assert.equal(sims.length, 1, "still exactly one SIM LIVE tab");
	assert.equal(
		sims[0].view.capture.frames.length,
		(framesBefore ?? 0) + 3,
		"and it continued where it left off",
	);
});

test("the live window is bounded, and bounded only in the stream's own slot", () => {
	const { state } = run(emptySlots<View>(), LIVE_CAP + 60);
	const sim = state.slots.find((s) => s.key === SIM_LIVE_KEY);
	assert.ok(sim);
	assert.equal(
		sim.view.capture.frames.length,
		LIVE_CAP,
		"the stream stops growing at the cap rather than the page growing forever",
	);
});

test("a closed sim slot is reopened, not replaced by whatever is on screen", () => {
	const started = run(emptySlots<View>(), 3);
	const sim = started.state.slots.find((s) => s.key === SIM_LIVE_KEY);
	assert.ok(sim);

	// Operator closes the SIM tab while a file is open and active.
	const withFile = slotsReducer(started.state, {
		type: "open",
		key: "file:evidence.lscap",
		origin: "file",
		name: "evidence.lscap",
		view: {
			capture: operatorCapture(40),
			selected: 0,
			filterText: "",
			note: null,
			containsSynthetic: false,
			brush: null,
		},
	});
	const closed = slotsReducer(withFile, { type: "close", id: sim.id });

	const { state } = run(closed, 4);

	const file = state.slots.find((s) => s.key === "file:evidence.lscap");
	assert.ok(file);
	assert.equal(file.view.capture.frames.length, 40, "the open file is still untouched");
	assert.ok(
		state.slots.some((s) => s.key === SIM_LIVE_KEY),
		"and the stream opened itself a new slot rather than borrowing one",
	);
});

test("the ticker only runs while the app is in demo mode", () => {
	let started = 0;
	const stop = startTrafficDemoInterval(
		false,
		() => true,
		() => {},
		() => {
			started += 1;
			return 0 as unknown as ReturnType<typeof setInterval>;
		},
		() => {},
	);
	assert.equal(started, 0, "disabled means no interval at all");
	assert.equal(stop, undefined);
});

test("the ticker fires at the documented cadence", () => {
	let delay = -1;
	startTrafficDemoInterval(
		true,
		() => true,
		() => {},
		(_cb, ms) => {
			delay = ms;
			return 0 as unknown as ReturnType<typeof setInterval>;
		},
		() => {},
	);
	assert.equal(delay, TRAFFIC_DEMO_INTERVAL_MS);
});
