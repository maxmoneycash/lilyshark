// Self-check: node --import tsx --test src/lib/annotations.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import {
	addressFromHash,
	addressHash,
	addressKey,
	annotatedFrames,
	EMPTY_NOTES,
	type FrameAddress,
	type FrameNote,
	type FrameWitness,
	MAX_NOTE_LENGTH,
	type NoteBook,
	noteFor,
	noteStanding,
	notesForFrames,
	notesInScope,
	notesSummary,
	parseAddressKey,
	readNoteRows,
	scopeKey,
	setNote,
	SNIFFER_SCOPE,
	snifferNoteTarget,
	toNoteRow,
} from "./annotations.ts";
import type { HeardFrame, RawFrameFields } from "./deviceLink.ts";
import { hashRoute, readFrame, readPermalink } from "./permalink.ts";

const OWNER =
	"0x1111111111111111111111111111111111111111111111111111111111111111";
const COMMIT =
	"0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

function at(frame: number): FrameAddress {
	return { scope: SNIFFER_SCOPE, frame };
}

/** A witness whose two fields are distinct so a swapped pair would show. */
function witness(len: number, stamp: number): FrameWitness {
	return { len, stamp };
}

/** setNote, asserting it succeeded. */
function write(
	book: NoteBook,
	address: FrameAddress,
	text: string,
	w: FrameWitness = witness(12, 1_772_409_600_000),
	nowUnix = 1_772_409_600,
): NoteBook {
	const r = setNote(book, address, text, w, nowUnix);
	assert.ok(r.ok, r.ok ? "" : r.error);
	return r.book;
}

/* ── a note names a frame the way a permalink does ───────────────────── */

test("a sniffer note's address renders as the sniffer permalink", () => {
	const hash = addressHash(at(417));
	assert.equal(hash, "#sniffer?frame=417");
	// The permalink reader, not a second parser of our own, has to agree.
	assert.equal(hashRoute(hash), "#sniffer");
	assert.equal(readFrame(hash), 417);
	assert.deepEqual(addressFromHash(hash, OWNER), at(417));
});

test("a capture note's address renders as that capture's permalink", () => {
	const commit: FrameAddress = {
		scope: { kind: "commit", owner: OWNER, commitment: COMMIT },
		frame: 9,
	};
	const hash = addressHash(commit, OWNER);
	// The owner is left off when it is the default one, exactly as a permalink
	// to the same frame would leave it off.
	assert.equal(hash, `#traffic?commit=${COMMIT}&frame=9`);
	const read = readPermalink(hash, OWNER);
	assert.deepEqual(read.ref, {
		kind: "commit",
		owner: OWNER,
		commitment: COMMIT,
	});
	assert.equal(read.frame, 9);
	assert.deepEqual(addressFromHash(hash, OWNER), commit);

	const blob: FrameAddress = {
		scope: { kind: "blob", owner: OWNER, name: "captures/field.lscap" },
		frame: 3,
	};
	assert.deepEqual(addressFromHash(addressHash(blob, OWNER), OWNER), blob);
});

test("a hash that names no frame files no note", () => {
	assert.equal(addressFromHash("#sniffer", OWNER), null);
	assert.equal(addressFromHash("#traffic?blob=field.lscap", OWNER), null);
	// A frame number with no capture to put it in is not an address either.
	assert.equal(addressFromHash("#resolve?frame=4", OWNER), null);
});

test("keys are canonical, reversible, and separate one capture from another", () => {
	assert.equal(addressKey(at(9)), "sniffer/9");
	assert.deepEqual(parseAddressKey("sniffer/9"), at(9));

	// The same account written in two cases is one account, not two note piles.
	const upper = scopeKey({
		kind: "commit",
		owner: OWNER.toUpperCase(),
		commitment: COMMIT,
	});
	assert.equal(
		upper,
		scopeKey({ kind: "commit", owner: OWNER, commitment: COMMIT }),
	);

	// A slash inside a blob name must not split the key.
	const blob: FrameAddress = {
		scope: { kind: "blob", owner: OWNER, name: "captures/field.lscap" },
		frame: 3,
	};
	const key = addressKey(blob);
	assert.equal(key.split("/").length, 4, key);
	assert.deepEqual(parseAddressKey(key), blob);

	// The live session and a stored capture never share a key, even at the same
	// sequence number: their sequence numbers are different spaces.
	assert.notEqual(addressKey(at(3)), addressKey(blob));

	for (const bad of ["", "sniffer", "sniffer/x", "blob/only/two", "what/a/b/3"])
		assert.equal(parseAddressKey(bad), null, bad);
});

/* ── writing notes ───────────────────────────────────────────────────── */

test("notes attach to sequence numbers and list in their order", () => {
	let book = write(EMPTY_NOTES, at(9), "interferer starts");
	book = write(book, at(2), "first contact");
	book = write(book, at(40), "packed up");
	assert.deepEqual(
		notesInScope(book, SNIFFER_SCOPE).map((n) => n.address.frame),
		[2, 9, 40],
	);
	assert.equal(noteFor(book, at(9))?.text, "interferer starts");
	assert.equal(noteFor(book, at(7)), null);
	assert.deepEqual(
		[...annotatedFrames(book, SNIFFER_SCOPE)].sort((a, b) => a - b),
		[2, 9, 40],
	);
});

test("rewriting a frame's note replaces it, and blank text removes it", () => {
	let book = write(
		EMPTY_NOTES,
		at(9),
		"first thought",
		witness(12, 1000),
		1000,
	);
	book = write(book, at(9), "  second thought  ", witness(12, 1000), 2000);
	const note = noteFor(book, at(9));
	assert.equal(book.size, 1);
	assert.equal(note?.text, "second thought");
	assert.equal(note?.updatedAtUnix, 2000);

	const cleared = setNote(book, at(9), "   ", witness(12, 1000), 3000);
	assert.ok(cleared.ok);
	assert.equal(cleared.removed, true);
	assert.equal(cleared.key, "sniffer/9");
	// An empty note would be a mark on the table meaning nothing.
	assert.equal(annotatedFrames(cleared.book, SNIFFER_SCOPE).size, 0);
});

test("setNote never mutates the book it was handed", () => {
	const before = write(EMPTY_NOTES, at(1), "a");
	const after = write(before, at(2), "b");
	assert.equal(before.size, 1);
	assert.equal(after.size, 2);
});

test("a note is refused rather than truncated, and needs a whole sequence", () => {
	const w = witness(12, 1000);
	const long = setNote(EMPTY_NOTES, at(1), "x".repeat(MAX_NOTE_LENGTH + 1), w);
	assert.ok(!long.ok);
	assert.match(long.error, new RegExp(String(MAX_NOTE_LENGTH)));
	const fractional = setNote(
		EMPTY_NOTES,
		{ scope: SNIFFER_SCOPE, frame: 1.5 },
		"n",
		w,
	);
	assert.ok(!fractional.ok);
	assert.match(fractional.error, /whole sequence number/);
	// Exactly at the limit is fine.
	assert.ok(setNote(EMPTY_NOTES, at(1), "x".repeat(MAX_NOTE_LENGTH), w).ok);
});

test("the summary says where a note lives, and where it does not", () => {
	assert.match(notesSummary(EMPTY_NOTES, SNIFFER_SCOPE), /No notes yet/);
	const book = write(EMPTY_NOTES, at(9), "note");
	assert.match(notesSummary(book, SNIFFER_SCOPE), /1 note on frame 9/);
	assert.match(
		notesSummary(book, SNIFFER_SCOPE),
		/never in the capture's bytes/,
	);
});

/* ── which frame a note is actually about ────────────────────────────── */

test("a note belongs to the frame it was written on, not to its number", () => {
	const written = witness(12, 1_772_409_600_000);
	const book = write(EMPTY_NOTES, at(12), "interferer starts", written);
	const note = noteFor(book, at(12));
	assert.ok(note);
	assert.equal(noteStanding(note, written), "same");
	// The deck was unplugged and restarted its count: frame 12 is a new frame.
	assert.equal(noteStanding(note, witness(31, 1_772_500_000_000)), "other");
	// Same length, different moment — still not the same frame.
	assert.equal(noteStanding(note, witness(12, 1_772_500_000_000)), "other");
	assert.equal(noteStanding(note, null), "absent");
});

test("an export carries only the notes written on the frames being exported", () => {
	const first = witness(12, 1_772_409_600_000);
	let book = write(EMPTY_NOTES, at(12), "interferer starts", first);
	book = write(book, at(13), "second note", witness(20, 1_772_409_601_000));

	// Frame 12 is the one the note was written on; frame 13 carries the same
	// sequence number as a note but is a different frame from a later run.
	const notes = notesForFrames(book, SNIFFER_SCOPE, [
		{ frame: 12, witness: first },
		{ frame: 13, witness: witness(7, 1_772_600_000_000) },
		{ frame: 99, witness: witness(4, 1) },
	]);
	assert.deepEqual([...notes.entries()], [[12, "interferer starts"]]);
});

test("a capture's notes never leak into another capture's export", () => {
	const w = witness(12, 1000);
	const otherCapture = {
		kind: "blob" as const,
		owner: OWNER,
		name: "other.lscap",
	};
	const book = write(
		EMPTY_NOTES,
		{ scope: otherCapture, frame: 12 },
		"theirs",
		w,
	);
	assert.equal(
		notesForFrames(book, SNIFFER_SCOPE, [{ frame: 12, witness: w }]).size,
		0,
	);
	assert.equal(annotatedFrames(book, SNIFFER_SCOPE).size, 0);
	assert.equal(annotatedFrames(book, otherCapture).size, 1);
});

/* ── persistence round trip ──────────────────────────────────────────── */

test("a note stored as a row reads back identically", () => {
	let book = write(
		EMPTY_NOTES,
		at(9),
		"interferer starts",
		witness(12, 1000),
		5,
	);
	book = write(book, at(3), "handheld powered on", witness(8, 900), 4);
	const rows = [...book.values()].map(toNoteRow);
	assert.deepEqual(rows[0], {
		key: "sniffer/9",
		scope: "sniffer",
		frame: 9,
		text: "interferer starts",
		updatedAtUnix: 5,
		witnessLen: 12,
		witnessStamp: 1000,
	});
	const read = readNoteRows(rows);
	assert.deepEqual(read.skipped, []);
	assert.deepEqual([...read.book.entries()].sort(), [...book.entries()].sort());
});

test("unreadable rows are skipped by name, not silently dropped", () => {
	const good = toNoteRow({
		address: at(4),
		text: "kept",
		updatedAtUnix: 12,
		witness: witness(12, 1000),
	} satisfies FrameNote);
	const read = readNoteRows([
		good,
		"not an object",
		{ ...good, key: "not-an-address" },
		{ ...good, key: "sniffer/5", frame: 6 },
		{ ...good, key: "sniffer/6", frame: 6, text: "   " },
		{
			...good,
			key: "sniffer/7",
			frame: 7,
			text: "x".repeat(MAX_NOTE_LENGTH + 1),
		},
		{ ...good, key: "sniffer/8", frame: 8, witnessStamp: "yesterday" },
	]);
	assert.deepEqual([...read.book.keys()], ["sniffer/4"]);
	assert.equal(read.skipped.length, 6);
	assert.match(read.skipped[0], /not an object/);
	assert.match(read.skipped[1], /not a frame address/);
	assert.match(read.skipped[2], /contradict its key/);
	assert.match(read.skipped[3], /empty or missing text/);
	assert.match(read.skipped[4], new RegExp(String(MAX_NOTE_LENGTH)));
	assert.match(read.skipped[5], /no record of the frame it was written on/);
});

test("a missing timestamp reads as zero rather than as now", () => {
	const read = readNoteRows([
		{
			key: "sniffer/1",
			scope: "sniffer",
			frame: 1,
			text: "no stamp",
			witnessLen: 3,
			witnessStamp: 7,
		},
	]);
	assert.deepEqual(read.skipped, []);
	assert.equal(read.book.get("sniffer/1")?.updatedAtUnix, 0);
});

/* ── the live session's frames ───────────────────────────────────────── */

/** A heard frame carrying its raw record, as the SNIFFER screen sees it. */
function heard(seq: number, len: number, atMs: number): HeardFrame {
	return {
		src: 1,
		dst: 0xffffffff,
		proto: "MESHTASTIC",
		port: 1,
		rssiX10: -900,
		snrX10: 50,
		kind: "TEXT",
		sim: false,
		atMs,
		raw: { seq, bytes: new Uint8Array(len) } as unknown as RawFrameFields,
	};
}

test("a live frame's note target is its sequence number and its own witness", () => {
	const target = snifferNoteTarget(heard(417, 12, 1_772_409_600_000));
	assert.deepEqual(target, {
		address: { scope: SNIFFER_SCOPE, frame: 417 },
		witness: { len: 12, stamp: 1_772_409_600_000 },
	});
	// A frame that arrived without its raw record has no sequence number, so no
	// link can name it and no note can be filed against it.
	const summaryOnly: HeardFrame = { ...heard(1, 1, 1), raw: undefined };
	assert.equal(snifferNoteTarget(summaryOnly), null);
});
