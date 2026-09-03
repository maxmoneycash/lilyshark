/**
 * Tests for the SNIFFER screen's link machine.
 *
 * The first two cover failures a reviewer proved in an earlier version of the
 * screen, so they are written as the failure rather than as the feature:
 *
 *   1. a permalink pasted into an already-open tab was ignored, because the
 *      hash was only ever read at mount;
 *   2. merely arriving on the SNIFFER tab overwrote whatever hash the address
 *      bar held, destroying a link the operator had not followed yet.
 *
 * Self-check: node --import tsx --test src/mesh/frameLink.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	type FrameLinkState,
	frameLinkStep,
	INITIAL_FRAME_LINK,
	snifferSelectionHash,
} from "./frameLink";

/** A capture permalink for another screen, of the kind a paste can leave. */
const TRAFFIC_LINK = "#traffic?blob=captures%2Ffield.lscap&frame=9";

/* ── bug 1: a link that arrives after the screen is already open ─────── */

test("a permalink pasted into an open tab is honoured, not only one read at mount", () => {
	// Arrival: the tab was opened on a bare sniffer hash, so nothing is asked.
	const opened = frameLinkStep(INITIAL_FRAME_LINK, {
		kind: "url",
		hash: "#sniffer",
	});
	assert.equal(opened.state.pending, null);

	// The operator works the screen for a while, then pastes a link into the
	// address bar of that same tab. Nothing reloads: the hash simply changes.
	const pasted = frameLinkStep(
		{ ...opened.state, shown: 12 },
		{ kind: "url", hash: "#sniffer?frame=417" },
	);
	assert.equal(pasted.state.pending, 417);
	assert.equal(pasted.select, undefined, "417 is not listed yet");

	// …and the pasted frame opens as soon as the list carries it.
	const listed = frameLinkStep(pasted.state, {
		kind: "frames",
		seqs: [12, 416, 417],
	});
	assert.equal(listed.select, 417);
	assert.deepEqual(listed.state, { pending: null, shown: 417 });
});

/* ── bug 2: arriving on the tab must not rewrite the address bar ─────── */

test("opening the screen never writes the address bar", () => {
	for (const hash of [
		"",
		"#sniffer",
		"#sniffer?frame=417",
		TRAFFIC_LINK,
		"#docs",
	]) {
		assert.equal(
			frameLinkStep(INITIAL_FRAME_LINK, { kind: "url", hash }).hash,
			null,
			`arriving with ${hash || "no hash"} in the address bar`,
		);
	}
});

test("arriving with another screen's capture link leaves it whole and takes no frame from it", () => {
	// A capture permalink numbers frames inside a stored capture; the live
	// session's sequence numbers are a different space, so frame=9 here is not
	// a request this screen may answer.
	const step = frameLinkStep(INITIAL_FRAME_LINK, {
		kind: "url",
		hash: TRAFFIC_LINK,
	});
	assert.equal(step.hash, null);
	assert.equal(step.state.pending, null);
	assert.equal(step.select, undefined);
});

test("closing the pane leaves a hash this screen does not own alone", () => {
	// The operator pasted a capture link and closed the frame pane before
	// following it. Clearing the frame param here would take the link with it.
	assert.equal(snifferSelectionHash(TRAFFIC_LINK, null), null);
	assert.equal(snifferSelectionHash("#docs", null), null);
	assert.equal(snifferSelectionHash("", null), null);
	assert.equal(
		frameLinkStep(
			{ pending: null, shown: 417 },
			{
				kind: "pick",
				hash: TRAFFIC_LINK,
				seq: null,
			},
		).hash,
		null,
	);
});

/* ── the ordinary path ───────────────────────────────────────────────── */

test("a link opened before the session hears anything waits for its frame", () => {
	const asked = frameLinkStep(INITIAL_FRAME_LINK, {
		kind: "url",
		hash: "#sniffer?frame=417",
	});
	assert.equal(asked.state.pending, 417);

	// A quiet band: frames arrive, none of them the one asked for.
	const quiet = frameLinkStep(asked.state, { kind: "frames", seqs: [3, 4] });
	assert.equal(quiet.select, undefined);
	assert.equal(
		quiet.state.pending,
		417,
		"the request outlives frames that miss it",
	);

	const heard = frameLinkStep(quiet.state, {
		kind: "frames",
		seqs: [3, 4, 417],
	});
	assert.equal(heard.select, 417);
	assert.equal(heard.hash, null, "the hash already names 417");
});

test("a link naming the frame already open asks for nothing", () => {
	const step = frameLinkStep(
		{ pending: null, shown: 417 },
		{ kind: "url", hash: "#sniffer?frame=417" },
	);
	assert.equal(step.state.pending, null);
	assert.equal(step.hash, null);
});

test("the operator's own pick settles a link that is still waiting", () => {
	const waiting: FrameLinkState = { pending: 417, shown: null };
	const picked = frameLinkStep(waiting, {
		kind: "pick",
		hash: "#sniffer?frame=417",
		seq: 12,
	});
	assert.deepEqual(picked.state, { pending: null, shown: 12 });
	assert.equal(picked.hash, "#sniffer?frame=12");

	// 417 landing afterwards must not pull the pane off the frame they chose.
	const later = frameLinkStep(picked.state, {
		kind: "frames",
		seqs: [12, 417],
	});
	assert.equal(later.select, undefined);
});

test("picking a frame puts it in the address bar, and picking it twice writes nothing", () => {
	const first = frameLinkStep(INITIAL_FRAME_LINK, {
		kind: "pick",
		hash: "#sniffer",
		seq: 417,
	});
	assert.equal(first.hash, "#sniffer?frame=417");
	assert.equal(
		frameLinkStep(first.state, {
			kind: "pick",
			hash: "#sniffer?frame=417",
			seq: 417,
		}).hash,
		null,
	);
});

test("closing the pane takes back the frame this screen put in the hash", () => {
	assert.equal(snifferSelectionHash("#sniffer?frame=417", null), "#sniffer");
	assert.equal(snifferSelectionHash("#SNIFFER?frame=417", null), "#SNIFFER");
	// A malformed frame param names no frame but is still this screen's, so
	// closing the pane clears it rather than leaving a stale claim behind.
	assert.equal(snifferSelectionHash("#sniffer?frame=nope", null), "#sniffer");
	// Nothing to take back.
	assert.equal(snifferSelectionHash("#sniffer", null), null);
});

test("a frame without a sequence number clears the frame the hash claimed", () => {
	// Firmware older than the capture link sends a decoded summary and no raw
	// record, so the pane can show a frame no link is able to name.
	const step = frameLinkStep(
		{ pending: null, shown: 417 },
		{ kind: "pick", hash: "#sniffer?frame=417", seq: null },
	);
	assert.equal(step.hash, "#sniffer");
	assert.deepEqual(step.state, { pending: null, shown: null });
});

test("a frame list with nothing pending changes nothing", () => {
	const state: FrameLinkState = { pending: null, shown: 12 };
	const step = frameLinkStep(state, { kind: "frames", seqs: [12, 13] });
	assert.equal(step.state, state);
	assert.equal(step.select, undefined);
	assert.equal(step.hash, null);
});
