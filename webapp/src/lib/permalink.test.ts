/**
 * Tests for the permalink hash arithmetic: splitting and joining the hash
 * query bag non-destructively, routing a hash that carries one, and
 * building/parsing capture+frame permalinks so a link round-trips to
 * exactly what it named.
 *
 * Self-check: node --import tsx --test src/lib/permalink.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	hashRoute,
	joinHash,
	permalinkHash,
	permalinkUrl,
	readFrame,
	readPermalink,
	snifferFrameHash,
	splitHash,
	updateHashParams,
} from "./permalink";

const OWNER = `0x${"ab".repeat(32)}`;
const OTHER = `0x${"cd".repeat(32)}`;
const COMMIT = `0x${"12".repeat(32)}`;

/* ── hash bag arithmetic ────────────────────────────────────────────── */

test("splitHash separates the routing token from the query bag", () => {
	assert.deepEqual(splitHash("").base, "");
	assert.deepEqual(splitHash("#traffic").base, "#traffic");
	const p = splitHash("#traffic?filter=snr+%3E+5&frame=9");
	assert.equal(p.base, "#traffic");
	assert.equal(p.params.get("filter"), "snr > 5");
	assert.equal(p.params.get("frame"), "9");
});

test("a hash carrying a query bag still routes to its tab", () => {
	// Without this a permalink lands on the intro screen, because the tab
	// table is keyed by the bare token.
	assert.equal(hashRoute("#SNIFFER?frame=9"), "#sniffer");
	assert.equal(hashRoute("#Traffic"), "#traffic");
	assert.equal(hashRoute(""), "");
	assert.equal(hashRoute("#some-doc-heading"), "#some-doc-heading");
});

test("joinHash never plants a bare #traffic on an empty URL", () => {
	assert.equal(joinHash("", new URLSearchParams()), "");
	assert.equal(joinHash("#resolve", new URLSearchParams()), "#resolve");
	// …but a query with no base must route somewhere to be readable at all.
	assert.equal(
		joinHash("", new URLSearchParams("frame=9")),
		"#traffic?frame=9",
	);
	assert.equal(
		joinHash("", new URLSearchParams("frame=9"), "#sniffer"),
		"#sniffer?frame=9",
	);
	assert.equal(
		joinHash("#resolve", new URLSearchParams("frame=9")),
		"#resolve?frame=9",
	);
});

test("updateHashParams edits only the named params", () => {
	const h = "#traffic?filter=snr%3E5&frame=9";
	assert.equal(
		updateHashParams(h, { frame: "12" }),
		"#traffic?filter=snr%3E5&frame=12",
	);
	assert.equal(updateHashParams(h, { frame: null }), "#traffic?filter=snr%3E5");
	// Deleting an absent param is the identity — callers compare to skip
	// a replaceState that would change nothing.
	assert.equal(updateHashParams(h, { blob: null }), h);
	assert.equal(updateHashParams("", { frame: null }), "");
	// The base token is preserved verbatim, whatever it is.
	assert.equal(
		updateHashParams("#resolve?filter=x", { frame: "3" }),
		"#resolve?filter=x&frame=3",
	);
});

/* ── frame links ────────────────────────────────────────────────────── */

test("readFrame accepts a sequence number and nothing else", () => {
	assert.equal(readFrame("#sniffer?frame=417"), 417);
	assert.equal(readFrame("#sniffer?frame=0"), 0, "frame 0 is a real frame");
	assert.equal(readFrame("#sniffer"), null);
	assert.equal(readFrame(""), null);
	assert.equal(readFrame("#sniffer?frame=ninth"), null);
	assert.equal(readFrame("#sniffer?frame=-2"), null);
	assert.equal(readFrame("#sniffer?frame="), null);
});

test("a sniffer frame link names the sniffer whatever it replaces", () => {
	assert.equal(snifferFrameHash(417), "#sniffer?frame=417");
	assert.equal(snifferFrameHash(0), "#sniffer?frame=0");
	assert.equal(snifferFrameHash(null), "#sniffer");
	assert.equal(readFrame(snifferFrameHash(417)), 417);
	assert.equal(hashRoute(snifferFrameHash(417)), "#sniffer");
});

test("permalinkUrl replaces the fragment and leaves the rest alone", () => {
	assert.equal(
		permalinkUrl("#sniffer?frame=9", "https://lilyshark.com/#docs"),
		"https://lilyshark.com/#sniffer?frame=9",
	);
	// A query string on the page itself belongs to the deploy, not to us.
	assert.equal(
		permalinkUrl("#sniffer", "https://lilyshark.com/?utm=x#traffic?frame=3"),
		"https://lilyshark.com/?utm=x#sniffer",
	);
	assert.equal(
		permalinkUrl("", "https://lilyshark.com/#sniffer?frame=9"),
		"https://lilyshark.com/",
	);
});

/* ── reading permalinks ─────────────────────────────────────────────── */

test("readPermalink parses a commit reference with explicit owner", () => {
	const s = readPermalink(
		`#traffic?commit=${COMMIT}&owner=${OTHER}&frame=9`,
		OWNER,
	);
	assert.deepEqual(s.ref, { kind: "commit", owner: OTHER, commitment: COMMIT });
	assert.equal(s.frame, 9);
	assert.equal(s.filter, "");
});

test("readPermalink fills the default owner in for owner-less refs", () => {
	const c = readPermalink(`#traffic?commit=${COMMIT}`, OWNER);
	assert.deepEqual(c.ref, { kind: "commit", owner: OWNER, commitment: COMMIT });
	const b = readPermalink("#traffic?blob=captures%2Ffield.lscap", OWNER);
	assert.deepEqual(b.ref, {
		kind: "blob",
		owner: OWNER,
		name: "captures/field.lscap",
	});
});

test("readPermalink accepts the FETCH input's owner/name blob grammar", () => {
	const s = readPermalink(
		`#traffic?blob=${encodeURIComponent(`${OTHER}/captures/x.lscap`)}`,
		OWNER,
	);
	assert.deepEqual(s.ref, {
		kind: "blob",
		owner: OTHER,
		name: "captures/x.lscap",
	});
});

test("readPermalink ignores what it cannot honestly resolve", () => {
	// A malformed commitment is never sent to the indexer.
	assert.equal(readPermalink("#traffic?commit=0x1234", OWNER).ref, null);
	assert.equal(readPermalink("#traffic?blob=", OWNER).ref, null);
	assert.equal(readPermalink("#traffic", OWNER).ref, null);
	// A malformed frame number selects nothing rather than frame NaN.
	assert.equal(readPermalink("#traffic?frame=ninth", OWNER).frame, null);
	assert.equal(readPermalink("#traffic?frame=-2", OWNER).frame, null);
});

test("a commit reference wins when a link carries both", () => {
	const s = readPermalink(`#traffic?blob=x.lscap&commit=${COMMIT}`, OWNER);
	assert.equal(s.ref?.kind, "commit");
});

test("filter text rides along unharmed", () => {
	const s = readPermalink(
		"#traffic?filter=proto+%3D%3D+meshtastic+%26%26+snr+%3E+-5&frame=3",
		OWNER,
	);
	assert.equal(s.filter, "proto == meshtastic && snr > -5");
	assert.equal(s.frame, 3);
});

/* ── building permalinks ────────────────────────────────────────────── */

test("permalinkHash round-trips through readPermalink", () => {
	const ref = { kind: "commit", owner: OTHER, commitment: COMMIT } as const;
	const h = permalinkHash(ref, {
		frame: 9,
		filter: "snr > 5",
		defaultOwner: OWNER,
	});
	const back = readPermalink(h, OWNER);
	assert.deepEqual(back.ref, ref);
	assert.equal(back.frame, 9);
	assert.equal(back.filter, "snr > 5");
	assert.equal(hashRoute(h), "#traffic");
});

test("permalinkHash omits the owner exactly when it is the default", () => {
	const short = permalinkHash(
		{ kind: "commit", owner: OWNER, commitment: COMMIT },
		{ defaultOwner: OWNER },
	);
	assert.equal(short, `#traffic?commit=${COMMIT}`);
	const blobShort = permalinkHash(
		{
			kind: "blob",
			owner: OWNER.toUpperCase().replace("0X", "0x"),
			name: "a.lscap",
		},
		{ defaultOwner: OWNER },
	);
	assert.equal(blobShort, "#traffic?blob=a.lscap"); // owner compare is case-blind
	const long = permalinkHash(
		{ kind: "blob", owner: OTHER, name: "a.lscap" },
		{ defaultOwner: OWNER },
	);
	assert.deepEqual(readPermalink(long, OWNER).ref, {
		kind: "blob",
		owner: OTHER,
		name: "a.lscap",
	});
});

test("frame and filter are carried only when present", () => {
	const bare = permalinkHash(
		{ kind: "commit", owner: OWNER, commitment: COMMIT },
		{ frame: null, filter: "", defaultOwner: OWNER },
	);
	assert.equal(bare, `#traffic?commit=${COMMIT}`);
	assert.equal(readPermalink(bare, OWNER).frame, null);
	// Frame 0 is a real frame, not an absent one.
	const zero = permalinkHash(
		{ kind: "commit", owner: OWNER, commitment: COMMIT },
		{ frame: 0, defaultOwner: OWNER },
	);
	assert.equal(readPermalink(zero, OWNER).frame, 0);
});
