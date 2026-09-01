/**
 * Capture slots (UI-012): more than one capture open at a time.
 *
 * The analyzer used to hold exactly one capture, so opening a file threw away
 * whatever was on screen — and stopping a recording threw away the capture you
 * were reading in order to show the one you had just made. A slot is one open
 * capture and the whole view state that belongs to it (selection, display
 * filter, brush, resolve trace, publish result): switching slots swaps all of
 * it at once, which is what keeps two captures from bleeding into each other.
 *
 * This module is the slot bookkeeping only — identity, ordering, capacity and
 * the honest labels. The view payload is opaque here (`V`), so all of it is
 * arithmetic over plain data and runs under node:test (captureSlots.test.ts),
 * following trafficView.ts's precedent.
 *
 * ── Memory bound ────────────────────────────────────────────────────────
 *
 * MEASURED, not asserted (node 22 / V8, the same engine class the browser
 * runs): parsing a capture and building the index arrays the Traffic view
 * keeps retains 474 B per frame, flat from 50,000 to 200,000 frames and
 * independent of payload size —
 *
 *   the LscapFrame object (~28 fields), its two BigInts, its Uint8Array view,
 *   and one slot in each derived array (pointers, dest hashes, filter set,
 *   brushed set, shown frames, IO frames).
 *
 * The frame's bytes are not in that number: they stay in the capture's single
 * ArrayBuffer, which is the file itself — an 80 B record header plus payload,
 * so ≤ 335 B for a maximum-size LoRa frame and ~120 B for the ~40 B frames a
 * mesh channel actually carries.
 *
 *   474 B (measured) + 335 B (worst-case file bytes) = 809 B  →  1 KiB/frame
 *
 * Spend a 512 MiB budget for everything the tab holds open:
 *
 *   512 MiB / 1 KiB per frame          = 524,288 frames, all captures
 *   524,288 / MAX_OPEN_CAPTURES (4)    = 131,072 frames per capture
 *
 * rounded down to CAPTURE_FRAME_LIMIT = 128,000 frames, so four full captures
 * of maximum-size frames come to 500 MiB and four realistic ones (~594 B per
 * frame at a 40 B payload) to 290 MiB. A recording stops itself at the limit
 * and says so; a slot beyond the fourth evicts the least recently used one.
 * Neither number is a target — 128,000 frames is 24 h at a frame every 0.7 s.
 */

/** Worst-case bytes retained per frame — 474 B measured, rounded up with the
 *  capture file's own bytes (see the arithmetic above). */
export const FRAME_RETAINED_BYTES = 1024;

/** What the whole tab may hold across every open capture. */
export const OPEN_CAPTURE_BUDGET_BYTES = 512 * 1024 * 1024;

/** Captures open at once. The fifth evicts the least recently used slot. */
export const MAX_OPEN_CAPTURES = 4;

/** 512 MiB / 1 KiB per frame / 4 slots, rounded down to a round number. */
export const CAPTURE_FRAME_LIMIT = 128_000;

/** Where a slot's capture came from. Decides the label, nothing else. */
export type SlotOrigin = "live" | "file" | "sample" | "shelby";

export interface CaptureSlot<V> {
	id: string;
	/**
	 * Dedupe key: opening the same source twice reuses its slot instead of
	 * stacking duplicates (a permalink, the SAMPLE button, a re-fetched blob).
	 * A file pick is always a fresh key — the bytes on disk may have changed.
	 */
	key: string;
	origin: SlotOrigin;
	/** What the tab is called: the capture's file or blob name. */
	name: string;
	/** The whole per-capture view state. Never inspected here. */
	view: V;
	/** Monotonic stamp of the last activation, for least-recently-used eviction. */
	touchedSeq: number;
}

export interface SlotState<V> {
	slots: CaptureSlot<V>[];
	/** "" only while no capture is open at all. */
	activeId: string;
	/** Monotonic counter behind slot ids and LRU stamps. */
	seq: number;
}

export type SlotAction<V> =
	| {
			type: "open";
			key: string;
			origin: SlotOrigin;
			name: string;
			view: V;
	  }
	| { type: "activate"; id: string }
	| { type: "close"; id: string }
	/** Merge into one slot's view — the active slot unless `id` says otherwise. */
	| { type: "patch"; id?: string; view: Partial<V> }
	| { type: "rename"; id?: string; name: string; origin?: SlotOrigin };

export function emptySlots<V>(): SlotState<V> {
	return { slots: [], activeId: "", seq: 0 };
}

export function activeSlot<V>(state: SlotState<V>): CaptureSlot<V> | null {
	return state.slots.find((s) => s.id === state.activeId) ?? null;
}

/**
 * The slot a new capture would evict when the bar is full: the least recently
 * used one that is neither active nor the live recording session — a
 * recording in progress is not something an unrelated open may throw away.
 * Null when nothing may be evicted.
 */
function evictable<V>(state: SlotState<V>): CaptureSlot<V> | null {
	let worst: CaptureSlot<V> | null = null;
	for (const s of state.slots) {
		if (s.id === state.activeId) continue;
		if (s.origin === "live") continue;
		if (!worst || s.touchedSeq < worst.touchedSeq) worst = s;
	}
	return worst;
}

export function slotsReducer<V>(
	state: SlotState<V>,
	action: SlotAction<V>,
): SlotState<V> {
	switch (action.type) {
		case "open": {
			const seq = state.seq + 1;
			const existing = state.slots.find((s) => s.key === action.key);
			if (existing) {
				// The same source reopened: replace its contents in place, so a
				// permalink or a second SAMPLE press does not grow the bar.
				return {
					...state,
					seq,
					activeId: existing.id,
					slots: state.slots.map((s) =>
						s.id === existing.id
							? {
									...s,
									origin: action.origin,
									name: action.name,
									view: action.view,
									touchedSeq: seq,
								}
							: s,
					),
				};
			}
			const slot: CaptureSlot<V> = {
				id: `slot-${seq}`,
				key: action.key,
				origin: action.origin,
				name: action.name,
				view: action.view,
				touchedSeq: seq,
			};
			let slots = state.slots;
			if (slots.length >= MAX_OPEN_CAPTURES) {
				const drop = evictable(state) ?? slots[0];
				slots = slots.filter((s) => s.id !== drop.id);
			}
			return { ...state, seq, activeId: slot.id, slots: [...slots, slot] };
		}

		case "activate": {
			if (!state.slots.some((s) => s.id === action.id)) return state;
			if (state.activeId === action.id) return state;
			const seq = state.seq + 1;
			return {
				...state,
				seq,
				activeId: action.id,
				slots: state.slots.map((s) =>
					s.id === action.id ? { ...s, touchedSeq: seq } : s,
				),
			};
		}

		case "close": {
			const slots = state.slots.filter((s) => s.id !== action.id);
			if (slots.length === state.slots.length) return state;
			if (state.activeId !== action.id)
				return { ...state, slots, activeId: state.activeId };
			// Closing the visible capture lands on the most recently used one
			// that is left, not on whatever happens to be first.
			let next: CaptureSlot<V> | null = null;
			for (const s of slots)
				if (!next || s.touchedSeq > next.touchedSeq) next = s;
			return { ...state, slots, activeId: next?.id ?? "" };
		}

		case "patch": {
			const id = action.id ?? state.activeId;
			if (!state.slots.some((s) => s.id === id)) return state;
			return {
				...state,
				slots: state.slots.map((s) =>
					s.id === id ? { ...s, view: { ...s.view, ...action.view } } : s,
				),
			};
		}

		case "rename": {
			const id = action.id ?? state.activeId;
			if (!state.slots.some((s) => s.id === id)) return state;
			return {
				...state,
				slots: state.slots.map((s) =>
					s.id === id
						? { ...s, name: action.name, origin: action.origin ?? s.origin }
						: s,
				),
			};
		}

		default:
			return state;
	}
}

/* ── honest labels ───────────────────────────────────────────────────────
 * A slot tab says what its capture IS, in the same words the rest of the
 * screen uses: which one the radio is recording right now, which one carries
 * frames that were generated rather than heard, and which one has an address
 * on Shelby. Nothing here may claim more than the facts it is handed. */

export interface SlotFacts {
	origin: SlotOrigin;
	/** The capture session is recording into this slot at this moment. */
	recording: boolean;
	/** At least one frame in it was generated, not received over the air. */
	synthetic: boolean;
	/** It has an address on Shelby — a permalink exists for it. */
	published: boolean;
	frameCount: number;
}

/** Short badges for a slot tab, in reading order. */
export function slotBadges(facts: SlotFacts): string[] {
	const out: string[] = [];
	if (facts.recording) out.push("● REC");
	else if (facts.origin === "live") out.push("LIVE");
	if (facts.synthetic) out.push("SIM");
	if (facts.published) out.push("PUB");
	return out;
}

/** The tab's tooltip: one sentence that says exactly what the slot holds. */
export function slotTitle(name: string, facts: SlotFacts): string {
	const parts: string[] = [
		`${name} · ${facts.frameCount.toLocaleString()} frame(s)`,
	];
	if (facts.recording) parts.push("recording now from the linked device");
	else if (facts.origin === "live")
		parts.push("recorded from the linked device");
	else if (facts.origin === "sample") parts.push("bundled synthetic sample");
	else if (facts.origin === "shelby") parts.push("fetched from Shelby");
	else parts.push("opened from a file");
	if (facts.synthetic)
		parts.push("contains simulate-mode frames — not received over the air");
	parts.push(
		facts.published
			? "published to Shelby — has a permalink"
			: "no address on Shelby — no permalink until it is published",
	);
	return parts.join(" · ");
}
