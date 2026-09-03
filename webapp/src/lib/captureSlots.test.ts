// Self-check: node --import tsx --test src/lib/captureSlots.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activeSlot,
	CAPTURE_FRAME_LIMIT,
	type CaptureSlot,
	emptySlots,
	FRAME_RETAINED_BYTES,
	MAX_OPEN_CAPTURES,
	OPEN_CAPTURE_BUDGET_BYTES,
	type SlotAction,
	type SlotState,
	slotBadges,
	slotsReducer,
	slotTitle,
} from "./captureSlots";

/** The per-capture view state, standing in for the Traffic tab's own. */
interface View {
	selected: number;
	filter: string;
}

const view = (over: Partial<View> = {}): View => ({
	selected: 0,
	filter: "",
	...over,
});

type OpenAction = Extract<SlotAction<View>, { type: "open" }>;

const open = (key: string, over: Partial<OpenAction> = {}): OpenAction => ({
	type: "open",
	key,
	origin: "file",
	name: `${key}.lscap`,
	view: view(),
	...over,
});

function run(actions: SlotAction<View>[]): SlotState<View> {
	return actions.reduce(slotsReducer<View>, emptySlots<View>());
}

const names = (s: SlotState<View>) => s.slots.map((x) => x.key);
const active = (s: SlotState<View>) => activeSlot(s)?.key ?? null;

describe("opening captures", () => {
	it("starts empty", () => {
		const s = emptySlots<View>();
		assert.deepEqual(s.slots, []);
		assert.equal(activeSlot(s), null);
	});

	it("keeps more than one capture open, newest active", () => {
		const s = run([open("a"), open("b")]);
		assert.deepEqual(names(s), ["a", "b"]);
		assert.equal(active(s), "b");
	});

	it("gives every slot its own id", () => {
		const s = run([open("a"), open("b"), open("c")]);
		assert.equal(new Set(s.slots.map((x) => x.id)).size, 3);
	});

	it("reuses a slot when the same source is reopened", () => {
		// A permalink, or a second press of SAMPLE: one tab, refreshed.
		const s = run([
			open("a"),
			open("b"),
			{ ...open("a"), name: "a-again.lscap", view: view({ selected: 7 }) },
		]);
		assert.deepEqual(names(s), ["a", "b"]);
		assert.equal(active(s), "a");
		assert.equal(activeSlot(s)?.name, "a-again.lscap");
		assert.equal(activeSlot(s)?.view.selected, 7);
	});
});

describe("capacity", () => {
	it("evicts the least recently used slot past the cap", () => {
		const s = run([
			open("a"),
			open("b"),
			open("c"),
			open("d"),
			{ type: "activate", id: "slot-1" }, // a, used most recently
			open("e"),
		]);
		assert.equal(s.slots.length, MAX_OPEN_CAPTURES);
		assert.ok(!names(s).includes("b"), "b was the least recently used");
		assert.deepEqual(names(s), ["a", "c", "d", "e"]);
	});

	it("never evicts a recording — that capture cannot be re-fetched", () => {
		const s = run([
			{ ...open("rec"), origin: "live" },
			open("b"),
			open("c"),
			open("d"),
			open("e"),
		]);
		assert.ok(names(s).includes("rec"));
		assert.ok(!names(s).includes("b"));
	});

	it("never evicts the capture on screen", () => {
		const s = run([
			open("a"),
			open("b"),
			open("c"),
			open("d"),
			{ type: "activate", id: "slot-2" }, // b is active AND least recent
			open("e"),
		]);
		assert.ok(names(s).includes("b"));
		assert.ok(!names(s).includes("a"));
	});
});

describe("switching and closing", () => {
	it("switches without touching any slot's view", () => {
		const s0 = run([
			open("a"),
			{ type: "patch", view: { selected: 4, filter: "proto == meshtastic" } },
			open("b"),
			{ type: "patch", view: { selected: 9, filter: "snr > 3" } },
		]);
		const s1 = slotsReducer(s0, { type: "activate", id: "slot-1" });
		const a = s1.slots.find((x) => x.key === "a") as CaptureSlot<View>;
		const b = s1.slots.find((x) => x.key === "b") as CaptureSlot<View>;
		assert.equal(active(s1), "a");
		assert.deepEqual(a.view, { selected: 4, filter: "proto == meshtastic" });
		assert.deepEqual(b.view, { selected: 9, filter: "snr > 3" });
	});

	it("patches only the slot named — no bleeding", () => {
		const s0 = run([open("a"), open("b")]);
		const s1 = slotsReducer(s0, { type: "patch", view: { selected: 3 } });
		assert.equal(s1.slots.find((x) => x.key === "a")?.view.selected, 0);
		assert.equal(s1.slots.find((x) => x.key === "b")?.view.selected, 3);
	});

	it("ignores a patch or activate for a slot that is gone", () => {
		const s0 = run([open("a")]);
		assert.equal(slotsReducer(s0, { type: "patch", id: "nope", view: {} }), s0);
		assert.equal(slotsReducer(s0, { type: "activate", id: "nope" }), s0);
		assert.equal(slotsReducer(s0, { type: "close", id: "nope" }), s0);
	});

	it("closing the active capture lands on the most recently used one left", () => {
		const s0 = run([open("a"), open("b"), open("c")]);
		const s1 = slotsReducer(s0, { type: "activate", id: "slot-1" }); // a
		const s2 = slotsReducer(s1, { type: "activate", id: "slot-3" }); // c active, a next
		const s3 = slotsReducer(s2, { type: "close", id: "slot-3" });
		assert.deepEqual(names(s3), ["a", "b"]);
		assert.equal(active(s3), "a");
	});

	it("closing a background capture leaves the view alone", () => {
		const s0 = run([open("a"), open("b")]);
		const s1 = slotsReducer(s0, { type: "close", id: "slot-1" });
		assert.equal(active(s1), "b");
	});

	it("closing the last capture leaves nothing open", () => {
		const s = slotsReducer(run([open("a")]), { type: "close", id: "slot-1" });
		assert.deepEqual(s.slots, []);
		assert.equal(activeSlot(s), null);
	});
});

describe("renaming", () => {
	it("renames the active slot in place", () => {
		const s0 = run([open("a")]);
		const s1 = slotsReducer(s0, {
			type: "rename",
			name: "recorded.lscap",
			origin: "live",
		});
		assert.equal(activeSlot(s1)?.name, "recorded.lscap");
		assert.equal(activeSlot(s1)?.origin, "live");
		assert.equal(activeSlot(s1)?.key, "a", "identity survives a rename");
	});
});

describe("labels", () => {
	const facts = {
		origin: "file" as const,
		recording: false,
		synthetic: false,
		published: false,
		frameCount: 24,
	};

	it("says nothing about a plain opened file", () => {
		assert.deepEqual(slotBadges(facts), []);
	});

	it("marks the recording, the synthetic and the published", () => {
		assert.deepEqual(slotBadges({ ...facts, origin: "live", recording: true }), [
			"● REC",
		]);
		assert.deepEqual(slotBadges({ ...facts, origin: "live" }), ["LIVE"]);
		assert.deepEqual(slotBadges({ ...facts, synthetic: true }), ["SIM"]);
		assert.deepEqual(slotBadges({ ...facts, published: true }), ["PUB"]);
		assert.deepEqual(
			slotBadges({
				...facts,
				origin: "live",
				recording: true,
				synthetic: true,
				published: true,
			}),
			["● REC", "SIM", "PUB"],
		);
	});

	it("spells the whole state out in the tooltip", () => {
		const t = slotTitle("field.lscap", {
			...facts,
			origin: "shelby",
			synthetic: true,
			published: true,
		});
		assert.match(t, /field\.lscap · 24 frame\(s\)/);
		assert.match(t, /fetched from Shelby/);
		assert.match(t, /simulate-mode frames/);
		assert.match(t, /has a permalink/);
	});

	it("says a local capture has no permalink rather than implying one", () => {
		assert.match(slotTitle("x.lscap", facts), /no address on Shelby/);
	});
});

describe("the memory bound", () => {
	it("is the arithmetic the comment states", () => {
		const perSlot =
			OPEN_CAPTURE_BUDGET_BYTES / FRAME_RETAINED_BYTES / MAX_OPEN_CAPTURES;
		assert.equal(perSlot, 131_072);
		assert.ok(
			CAPTURE_FRAME_LIMIT <= perSlot,
			"the frame cap must fit inside the budget it is derived from",
		);
		assert.equal(
			CAPTURE_FRAME_LIMIT * FRAME_RETAINED_BYTES * MAX_OPEN_CAPTURES,
			500 * 1024 * 1024,
			"four full captures come to 500 MiB",
		);
	});

	it("leaves room for the measurement it was derived from", () => {
		// scripts/measure-capture-retention.ts reports 569 B retained per frame
		// on node v22.22.1; the worst-case .lscap record is an 80 B header plus a
		// 255 B maximum LoRa payload. The per-frame budget has to cover both, or
		// four full captures overrun the 512 MiB the slots are allowed.
		const measuredRetainedBytes = 569;
		const worstCaseFileBytes = 80 + 255;
		assert.ok(
			measuredRetainedBytes + worstCaseFileBytes <= FRAME_RETAINED_BYTES,
			`${measuredRetainedBytes + worstCaseFileBytes} B per frame does not fit in ${FRAME_RETAINED_BYTES} B`,
		);
	});
});
