// Self-check: node --import tsx --test src/lib/annotations.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import {
	ANNOTATION_SIDECAR_KIND,
	ANNOTATION_SIDECAR_VERSION,
	annotatedSequences,
	describeCapture,
	emptySidecar,
	MAX_NOTE_LENGTH,
	noteFor,
	noteMap,
	parseSidecar,
	serializeSidecar,
	setNote,
	sidecarFileName,
	sidecarMismatches,
	sidecarSummary,
} from "./annotations";

/** setNote, asserting it succeeded. */
function write(
	sidecar: ReturnType<typeof emptySidecar>,
	sequence: number,
	text: string,
	nowUnix = 1_772_409_600,
) {
	const r = setNote(sidecar, sequence, text, nowUnix);
	assert.ok(r.ok, r.ok ? "" : r.error);
	return r.sidecar;
}

/* ── the sidecar itself ──────────────────────────────────────────────── */

test("an empty sidecar names its capture and holds no notes", () => {
	const sidecar = emptySidecar({ name: "field.lscap", frameCount: 24 });
	assert.equal(sidecar.kind, ANNOTATION_SIDECAR_KIND);
	assert.equal(sidecar.version, ANNOTATION_SIDECAR_VERSION);
	assert.deepEqual(sidecar.capture, {
		name: "field.lscap",
		frameCount: 24,
		commitment: null,
	});
	assert.deepEqual(sidecar.notes, []);
	assert.match(sidecarSummary(sidecar), /no notes yet/);
});

test("notes attach to sequence numbers and stay sorted by them", () => {
	let sidecar = emptySidecar({ name: "field.lscap" });
	sidecar = write(sidecar, 9, "interferer starts");
	sidecar = write(sidecar, 2, "first contact");
	sidecar = write(sidecar, 40, "packed up");
	assert.deepEqual(
		sidecar.notes.map((n) => n.sequence),
		[2, 9, 40],
	);
	assert.equal(noteFor(sidecar, 9)?.text, "interferer starts");
	assert.equal(noteFor(sidecar, 7), null);
	assert.deepEqual(
		[...annotatedSequences(sidecar)].sort((a, b) => a - b),
		[2, 9, 40],
	);
	assert.equal(noteMap(sidecar).get(40), "packed up");
});

test("rewriting a frame's note replaces it, and blank text removes it", () => {
	let sidecar = write(emptySidecar(), 9, "first thought", 1000);
	sidecar = write(sidecar, 9, "  second thought  ", 2000);
	assert.equal(sidecar.notes.length, 1);
	assert.equal(sidecar.notes[0].text, "second thought");
	assert.equal(sidecar.notes[0].updatedAtUnix, 2000);

	sidecar = write(sidecar, 9, "   ");
	assert.deepEqual(sidecar.notes, []);
	// An empty note would be a mark on the table meaning nothing.
	assert.equal(annotatedSequences(sidecar).size, 0);
});

test("setNote never mutates the sidecar it was handed", () => {
	const before = write(emptySidecar(), 1, "a");
	const after = write(before, 2, "b");
	assert.equal(before.notes.length, 1);
	assert.equal(after.notes.length, 2);
});

test("a note is refused rather than truncated, and needs a whole sequence", () => {
	const long = setNote(emptySidecar(), 1, "x".repeat(MAX_NOTE_LENGTH + 1));
	assert.ok(!long.ok);
	assert.match(long.error, new RegExp(String(MAX_NOTE_LENGTH)));
	const fractional = setNote(emptySidecar(), 1.5, "note");
	assert.ok(!fractional.ok);
	assert.match(fractional.error, /whole sequence number/);
	// Exactly at the limit is fine.
	assert.ok(setNote(emptySidecar(), 1, "x".repeat(MAX_NOTE_LENGTH)).ok);
});

test("the sidecar file name sits beside the capture, extension and all", () => {
	assert.equal(
		sidecarFileName("field-2026-03-01.lscap"),
		"field-2026-03-01.lscap.notes.json",
	);
	assert.equal(sidecarFileName(""), "capture.lscap.notes.json");
});

/* ── the round trip ──────────────────────────────────────────────────── */

test("a sidecar serializes and parses back identically", () => {
	let sidecar = emptySidecar({
		name: "field.lscap",
		frameCount: 24,
		commitment: "0xabc",
	});
	sidecar = write(sidecar, 9, "interferer starts");
	sidecar = write(sidecar, 3, "handheld powered on");

	const text = serializeSidecar(sidecar);
	assert.ok(text.endsWith("\n"));
	const parsed = parseSidecar(text);
	assert.ok(parsed.ok);
	assert.deepEqual(parsed.sidecar, sidecar);
	assert.deepEqual(parsed.skipped, []);
	// Stable bytes: the same notes serialize the same way whatever the order
	// they were written in.
	let other = emptySidecar({
		name: "field.lscap",
		frameCount: 24,
		commitment: "0xabc",
	});
	other = write(other, 3, "handheld powered on");
	other = write(other, 9, "interferer starts");
	assert.equal(serializeSidecar(other), text);
});

test("a document that is not this sidecar is refused, never guessed at", () => {
	for (const [text, pattern] of [
		["{", /not JSON/],
		["[]", /expected an object/],
		['{"kind":"something-else","version":1,"notes":[]}', /not an annotation/],
		[
			`{"kind":"${ANNOTATION_SIDECAR_KIND}","version":99,"notes":[]}`,
			/version 99/,
		],
		[`{"kind":"${ANNOTATION_SIDECAR_KIND}","version":1}`, /"notes" is missing/],
	] as [string, RegExp][]) {
		const parsed = parseSidecar(text);
		assert.ok(!parsed.ok, text);
		assert.match(parsed.error, pattern);
	}
});

test("unreadable entries are skipped by name, not silently dropped", () => {
	const parsed = parseSidecar(
		JSON.stringify({
			kind: ANNOTATION_SIDECAR_KIND,
			version: ANNOTATION_SIDECAR_VERSION,
			capture: { name: "field.lscap" },
			notes: [
				{ sequence: 4, text: "kept", updatedAtUnix: 12 },
				{ sequence: "seven", text: "bad sequence" },
				{ sequence: 5, text: "   " },
				{ sequence: 4, text: "duplicate" },
				"not an object",
			],
		}),
	);
	assert.ok(parsed.ok);
	assert.deepEqual(
		parsed.sidecar.notes.map((n) => n.sequence),
		[4],
	);
	assert.equal(parsed.skipped.length, 4);
	assert.match(parsed.skipped[0], /not a whole number/);
	assert.match(parsed.skipped[1], /empty or missing text/);
	assert.match(parsed.skipped[2], /already has a note/);
	assert.match(parsed.skipped[3], /not an object/);
});

test("a missing timestamp reads as zero rather than as now", () => {
	const parsed = parseSidecar(
		JSON.stringify({
			kind: ANNOTATION_SIDECAR_KIND,
			version: ANNOTATION_SIDECAR_VERSION,
			notes: [{ sequence: 1, text: "no stamp" }],
		}),
	);
	assert.ok(parsed.ok);
	assert.equal(parsed.sidecar.notes[0].updatedAtUnix, 0);
	assert.equal(parsed.sidecar.capture.name, "");
});

/* ── what a sidecar does and does not line up with ───────────────────── */

test("a sidecar from another capture loads, and says so", () => {
	let sidecar = emptySidecar({ name: "other.lscap" });
	sidecar = write(sidecar, 9, "note");
	sidecar = write(sidecar, 4000, "note off the end");
	const mismatches = sidecarMismatches(sidecar, {
		name: "field.lscap",
		sequences: new Set([1, 9, 12]),
	});
	assert.equal(mismatches.length, 2);
	assert.match(mismatches[0], /written for "other.lscap"/);
	assert.match(mismatches[1], /1 note\(s\) name frame sequence number\(s\)/);
	assert.match(mismatches[1], /4000/);
});

test("a matching sidecar reports no mismatch at all", () => {
	const sidecar = write(emptySidecar({ name: "field.lscap" }), 9, "note");
	assert.deepEqual(
		sidecarMismatches(sidecar, {
			name: "field.lscap",
			sequences: new Set([9]),
		}),
		[],
	);
});

test("the capture facts are refreshed without touching the notes", () => {
	const sidecar = write(emptySidecar({ name: "field.lscap" }), 9, "note");
	const renamed = describeCapture(sidecar, {
		name: "published.lscap",
		commitment: "0xfeed",
	});
	assert.equal(renamed.capture.name, "published.lscap");
	assert.equal(renamed.capture.commitment, "0xfeed");
	assert.deepEqual(renamed.notes, sidecar.notes);
	assert.match(sidecarSummary(renamed), /1 note\(s\) on frame\(s\) 9/);
	assert.match(sidecarSummary(renamed), /never in its bytes/);
});
